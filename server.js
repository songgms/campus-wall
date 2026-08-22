const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SECRET = process.env.SECRET || 'campus-wall-secret-key';

// ---------- 数据持久化 ----------
const DEFAULT_DATA = {
  messages: [],
  config: {
    allowAnonymous: true,
    allowedStyles: ['plain', 'rounded', 'color'],
    maxTextLength: 200,
    adminUser: 'admin',
    adminPass: 'admin123',
    sensitiveWords: ['傻逼', '操你', '草你', '妈的', '他妈', '去死', '垃圾人', '废物'],
    enableSensitiveFilter: true,
    saveMode: 'auto',
    autoSaveInterval: 30,
    backupLimit: 5
  }
};

function loadData() {
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return {
      messages: Array.isArray(raw.messages) ? raw.messages : [],
      config: Object.assign({}, DEFAULT_DATA.config, raw.config || {})
    };
  } catch (e) {
    return JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

const db = loadData();

// ---------- 保存机制 ----------
let dirty = false;          // 是否有未保存的变更
let lastSaveTime = 0;       // 上次保存时间（0 表示尚未保存过）
let saveTimer = null;       // 自动保存定时器

// 真正写入磁盘（数据文件 + 备份）
function writeToDisk() {
  const backupLimit = db.config.backupLimit || 5;
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  // 自动备份
  try {
    const backupDir = path.join(__dirname, 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(backupDir, `data-${stamp}.json`), JSON.stringify(db, null, 2));
    const backups = fs.readdirSync(backupDir).filter(f => f.startsWith('data-') && f.endsWith('.json')).sort();
    while (backups.length > backupLimit) {
      fs.unlinkSync(path.join(backupDir, backups.shift()));
    }
  } catch (e) {
    console.error('[备份失败]', e.message);
  }
  dirty = false;
  lastSaveTime = Date.now();
}

// 数据变更后调用：标记 dirty，由自动保存定时器或手动保存写入磁盘
function save() {
  dirty = true;
  // 自动保存模式下，如果间隔很短（<=5秒）则立即写入，避免频繁操作丢失
  if (db.config.saveMode === 'auto' && (db.config.autoSaveInterval || 30) <= 5) {
    writeToDisk();
  }
}

// 手动保存（管理员触发）
function manualSave() {
  if (!dirty) return { ok: true, skipped: true, message: '没有需要保存的变更' };
  writeToDisk();
  return { ok: true, saved: true, lastSave: lastSaveTime };
}

// 启动/重启自动保存定时器
function startAutoSave() {
  if (saveTimer) { clearInterval(saveTimer); saveTimer = null; }
  if (db.config.saveMode === 'auto') {
    const interval = Math.max(5, db.config.autoSaveInterval || 30) * 1000;
    saveTimer = setInterval(() => {
      if (dirty) {
        writeToDisk();
        broadcast({ type: 'save-status', payload: { dirty: false, lastSave: lastSaveTime } });
      }
    }, interval);
  }
}

// 获取保存状态
function getSaveStatus() {
  return {
    mode: db.config.saveMode,
    dirty,
    lastSave: lastSaveTime,
    autoSaveInterval: db.config.autoSaveInterval || 30,
    backupLimit: db.config.backupLimit || 5
  };
}

// ---------- 启动迁移 ----------
function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

(function migrate() {
  let changed = false;
  // 旧留言补发编辑令牌（此前的留言没有令牌，作者将无法再编辑/移动，属安全加固的必要代价）
  db.messages.forEach(m => {
    if (!m.editToken) { m.editToken = crypto.randomBytes(16).toString('hex'); changed = true; }
  });
  // 管理员密码从明文迁移为 SHA-256 哈希（64位hex = 已是哈希，跳过）
  if (db.config.adminPass && !/^[0-9a-f]{64}$/.test(db.config.adminPass)) {
    db.config.adminPass = sha256(db.config.adminPass);
    changed = true;
  }
  if (changed) writeToDisk();
})();

// ---------- 工具 ----------
function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

// 敏感词检测：返回命中的敏感词列表，未命中返回空数组
function findSensitiveWords(text) {
  if (!db.config.enableSensitiveFilter || !Array.isArray(db.config.sensitiveWords)) return [];
  const lower = String(text || '').toLowerCase();
  return db.config.sensitiveWords.filter(w => w && lower.includes(String(w).toLowerCase()));
}

// 在线人数
let onlineCount = 0;

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

const TOKEN_TTL = 24 * 3600 * 1000; // 管理 token 有效期 24 小时

function makeToken() {
  const payload = 'admin:' + Date.now();
  return payload + '.' + sign(payload);
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const idx = token.lastIndexOf('.');
  if (idx < 0) return false;
  const payload = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  if (!payload.startsWith('admin:')) return false;
  const ts = Number(payload.slice(6));
  if (!ts || Date.now() - ts > TOKEN_TTL) return false; // 过期即失效
  try {
    return crypto.timingSafeEqual(Buffer.from(sign(payload)), Buffer.from(sig));
  } catch (e) {
    return false;
  }
}

function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!verifyToken(token)) return res.status(401).json({ error: '未登录或登录已失效' });
  next();
}

// 面向普通用户的留言（屏蔽的隐藏内容；匿名的隐藏真实昵称）
// 不下发 authorId / editToken：是否为"自己的卡片"由服务端按观察者计算 own 标记，
// 编辑/删除/移动必须出示只有作者持有的 editToken
function publicMessage(m, viewerId) {
  const copy = Object.assign({}, m);
  if (copy.blocked) copy.text = '【该内容已被管理员屏蔽】';
  if (!copy.showName) copy.nickname = null;
  copy.likesCount = Array.isArray(m.likes) ? m.likes.length : 0;
  copy.likedByMe = !!viewerId && Array.isArray(m.likes) && m.likes.includes(viewerId);
  copy.own = !!viewerId && m.authorId === viewerId;
  delete copy.likes;
  delete copy.authorId;
  delete copy.editToken;
  return copy;
}

// ---------- HTTP 服务 ----------
const app = express();
app.use(express.json());
// 页面与脚本禁止长缓存：每次请求都向服务器校验新鲜度，保证发版后所有客户端立即拿到新代码
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  setHeaders: (res, filePath) => {
    if (/\.(html|js|css)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
  }
}));

// 登录（密码以 SHA-256 哈希比对）
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === db.config.adminUser && sha256(password || '') === db.config.adminPass) {
    res.json({ ok: true, token: makeToken() });
  } else {
    res.status(401).json({ error: '账号或密码错误' });
  }
});

// 公开配置（用户端获取）
app.get('/api/config', (req, res) => {
  const { allowAnonymous, allowedStyles, maxTextLength } = db.config;
  res.json({ allowAnonymous, allowedStyles, maxTextLength });
});

// 公开留言列表（用户端初始加载，按观察者计算 own/likedByMe）
app.get('/api/messages', (req, res) => {
  const viewer = String(req.query.userId || '');
  res.json(db.messages.map(m => publicMessage(m, viewer)));
});

// 新增留言
app.post('/api/messages', (req, res) => {
  const { text, style, nickname, showName, authorId, x, y } = req.body || {};
  const cfg = db.config;
  if (!text || !text.trim()) return res.status(400).json({ error: '留言内容不能为空' });
  if (text.trim().length > cfg.maxTextLength) {
    return res.status(400).json({ error: `留言不能超过 ${cfg.maxTextLength} 字` });
  }
  const hits = findSensitiveWords(text);
  if (hits.length) {
    return res.status(400).json({ error: `留言包含敏感词：${hits.join('、')}，请修改后再发布` });
  }
  const validStyles = cfg.allowedStyles.length ? cfg.allowedStyles : ['plain'];
  if (!validStyles.includes(style)) return res.status(400).json({ error: '该卡片样式未被允许' });
  if (!cfg.allowAnonymous && !showName) {
    return res.status(400).json({ error: '当前已禁止匿名留言' });
  }
  if (showName && !nickname) return res.status(400).json({ error: '公开姓名时请填写昵称' });

  const msg = {
    id: genId(),
    text: text.trim(),
    style,
    x: typeof x === 'number' ? x : Math.random() * 70 + 5,
    y: typeof y === 'number' ? y : Math.random() * 70 + 8,
    authorId: authorId || genId(),
    editToken: crypto.randomBytes(16).toString('hex'), // 仅返回给作者本人
    nickname: nickname || null,
    showName: !!showName,
    blocked: false,
    likes: [],
    createdAt: Date.now()
  };
  db.messages.push(msg);
  save();
  broadcastSmart('create', msg);
  res.json(msg); // 原样返回给作者（含 editToken，客户端需保存）
});

// 编辑自己的留言（需出示该留言的 editToken）
app.patch('/api/messages/:id', (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: '留言不存在' });
  const { text, style, nickname, showName, editToken } = req.body || {};
  if (!editToken || editToken !== msg.editToken) {
    return res.status(403).json({ error: '身份校验失败，只能编辑自己的留言' });
  }
  if (text !== undefined) {
    if (!text.trim()) return res.status(400).json({ error: '留言内容不能为空' });
    if (text.trim().length > db.config.maxTextLength) {
      return res.status(400).json({ error: `留言不能超过 ${db.config.maxTextLength} 字` });
    }
    const hits = findSensitiveWords(text);
    if (hits.length) {
      return res.status(400).json({ error: `留言包含敏感词：${hits.join('、')}，请修改后再保存` });
    }
    msg.text = text.trim();
  }
  if (style !== undefined && db.config.allowedStyles.includes(style)) msg.style = style;
  if (nickname !== undefined) msg.nickname = nickname || null;
  if (showName !== undefined) msg.showName = !!showName;
  save();
  broadcastSmart('update', msg);
  res.json(publicMessage(msg, msg.authorId));
});

// 删除自己的留言（需出示该留言的 editToken）
app.delete('/api/messages/:id', (req, res) => {
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '留言不存在' });
  if (req.query.editToken !== db.messages[idx].editToken) {
    return res.status(403).json({ error: '身份校验失败，只能删除自己的留言' });
  }
  const [removed] = db.messages.splice(idx, 1);
  save();
  broadcast({ type: 'delete', payload: { id: removed.id } });
  res.json({ ok: true });
});

// 点赞 / 取消点赞（切换）
app.post('/api/messages/:id/like', (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: '留言不存在' });
  const { authorId } = req.body || {};
  if (!authorId) return res.status(400).json({ error: '缺少用户标识' });
  if (!Array.isArray(msg.likes)) msg.likes = [];
  const idx = msg.likes.indexOf(authorId);
  let liked;
  if (idx >= 0) { msg.likes.splice(idx, 1); liked = false; }
  else { msg.likes.push(authorId); liked = true; }
  save();
  const payload = { id: msg.id, likesCount: msg.likes.length };
  broadcast({ type: 'like', payload });
  res.json({ ok: true, liked, likesCount: msg.likes.length });
});

// ---------- 管理接口 ----------
// 全部留言（含匿名提交人信息）
app.get('/api/admin/messages', requireAdmin, (req, res) => {
  res.json(db.messages);
});

// 管理员删除
app.delete('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '留言不存在' });
  const [removed] = db.messages.splice(idx, 1);
  save();
  broadcast({ type: 'delete', payload: { id: removed.id } });
  res.json({ ok: true });
});

// 管理员批量删除
app.post('/api/admin/messages/batch-delete', requireAdmin, (req, res) => {
  const ids = new Set((req.body || {}).ids || []);
  db.messages = db.messages.filter(m => {
    if (ids.has(m.id)) { broadcast({ type: 'delete', payload: { id: m.id } }); return false; }
    return true;
  });
  save();
  res.json({ ok: true, deleted: ids.size });
});

// 屏蔽/解除屏蔽
app.patch('/api/admin/messages/:id', requireAdmin, (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: '留言不存在' });
  if ((req.body || {}).blocked !== undefined) msg.blocked = !!req.body.blocked;
  save();
  broadcastSmart('update', msg);
  res.json(msg);
});

// 重置全部卡片位置
app.post('/api/admin/reset-positions', requireAdmin, (req, res) => {
  db.messages.forEach(m => {
    m.x = Math.random() * 70 + 5;
    m.y = Math.random() * 70 + 8;
  });
  save();
  broadcastSmart('reset', db.messages);
  res.json({ ok: true });
});

// 配置管理（不返回密码哈希）
app.get('/api/admin/config', requireAdmin, (req, res) => {
  const { adminPass, ...safeConfig } = db.config;
  res.json(safeConfig);
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
  const body = req.body || {};
  const updates = {}; // 收集待应用的修改，全部验证通过后才统一写入

  // —— 无验证的布尔/字符串字段 ——
  if (body.allowAnonymous !== undefined) updates.allowAnonymous = !!body.allowAnonymous;
  if (body.enableSensitiveFilter !== undefined) updates.enableSensitiveFilter = !!body.enableSensitiveFilter;
  if (body.adminUser && body.adminUser.trim()) updates.adminUser = body.adminUser.trim();
  if (body.adminPass && body.adminPass.trim()) updates.adminPass = sha256(body.adminPass); // 落库前哈希

  // —— 需要验证的字段：任何一个失败都直接 return，不修改任何配置 ——
  if (body.allowedStyles !== undefined) {
    if (!Array.isArray(body.allowedStyles) || !body.allowedStyles.length) {
      return res.status(400).json({ error: '至少保留一种卡片样式' });
    }
    updates.allowedStyles = body.allowedStyles;
  }

  if (body.maxTextLength !== undefined) {
    const n = parseInt(body.maxTextLength, 10);
    if (!n || n < 1 || n > 2000) {
      return res.status(400).json({ error: '字数上限需在 1-2000 之间' });
    }
    updates.maxTextLength = n;
  }

  if (body.sensitiveWords !== undefined) {
    if (!Array.isArray(body.sensitiveWords)) {
      return res.status(400).json({ error: '敏感词列表必须是数组' });
    }
    updates.sensitiveWords = body.sensitiveWords.map(s => String(s).trim()).filter(Boolean);
  }

  if (body.saveMode !== undefined) {
    if (!['auto', 'manual'].includes(body.saveMode)) {
      return res.status(400).json({ error: '保存模式只能是 auto 或 manual' });
    }
    updates.saveMode = body.saveMode;
  }

  if (body.autoSaveInterval !== undefined) {
    const n = parseInt(body.autoSaveInterval, 10);
    if (!n || n < 5 || n > 3600) {
      return res.status(400).json({ error: '自动保存间隔需在 5-3600 秒之间' });
    }
    updates.autoSaveInterval = n;
  }

  if (body.backupLimit !== undefined) {
    const n = parseInt(body.backupLimit, 10);
    if (!n || n < 1 || n > 100) {
      return res.status(400).json({ error: '备份数量上限需在 1-100 之间' });
    }
    updates.backupLimit = n;
  }

  // —— 全部验证通过，统一应用修改 ——
  Object.assign(db.config, updates);
  save();
  startAutoSave(); // 配置变更后重启自动保存定时器
  const { allowAnonymous, allowedStyles, maxTextLength } = db.config;
  broadcast({ type: 'config', payload: { allowAnonymous, allowedStyles, maxTextLength } });
  res.json(db.config);
});

// 导出全部留言数据（JSON）
app.get('/api/admin/export', requireAdmin, (req, res) => {
  const data = {
    exportedAt: new Date().toISOString(),
    messages: db.messages.map(m => ({
      id: m.id,
      text: m.text,
      style: m.style,
      nickname: m.nickname,
      showName: m.showName,
      blocked: m.blocked,
      likesCount: Array.isArray(m.likes) ? m.likes.length : 0,
      createdAt: m.createdAt,
      createdAtStr: new Date(m.createdAt).toLocaleString('zh-CN')
    }))
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campus-wall-export-${Date.now()}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

// 保存状态
app.get('/api/admin/save-status', requireAdmin, (req, res) => {
  res.json(getSaveStatus());
});

// 手动保存
app.post('/api/admin/save', requireAdmin, (req, res) => {
  const result = manualSave();
  broadcast({ type: 'save-status', payload: { dirty: false, lastSave: lastSaveTime } });
  res.json(result);
});

// 统计
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const total = db.messages.length;
  const today = db.messages.filter(m => m.createdAt >= todayStart).length;
  const anonymous = db.messages.filter(m => !m.showName).length;
  const blocked = db.messages.filter(m => m.blocked).length;
  const totalLikes = db.messages.reduce((sum, m) => sum + (Array.isArray(m.likes) ? m.likes.length : 0), 0);
  res.json({ total, today, anonymous, blocked, totalLikes, percent: total ? Math.round(anonymous / total * 100) : 0 });
});

// 全局错误处理（Express 4 要求错误中间件注册在所有路由之后才能捕获路由/解析错误）
app.use((err, req, res, next) => {
  console.error('[服务器错误]', err);
  res.status(500).json({ error: '服务器内部错误，请稍后重试' });
});

// ---------- WebSocket ----------
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const str = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(str);
  });
}

// 携带 own/likedByMe 标记的广播：每个连接按其上报的 userId 定制 payload
function broadcastSmart(type, msgs) {
  const list = Array.isArray(msgs) ? msgs : [msgs];
  wss.clients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    const viewer = client.userId || '';
    const payload = list.map(m => publicMessage(m, viewer));
    client.send(JSON.stringify({ type, payload: Array.isArray(msgs) ? payload : payload[0] }));
  });
}

function broadcastOnline() {
  broadcast({ type: 'online', payload: { count: onlineCount } });
}

wss.on('connection', ws => {
  onlineCount++;
  broadcastOnline();
  // 连接后立即推送当前在线人数
  ws.send(JSON.stringify({ type: 'online', payload: { count: onlineCount } }));

  ws.on('close', () => {
    onlineCount = Math.max(0, onlineCount - 1);
    broadcastOnline();
  });

  // 客户端拖拽移动卡片（松手后提交，需出示 editToken）
  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (data.type === 'hello') {
      // 客户端上报身份，用于广播时计算 own/likedByMe 标记
      const uid = data.payload && data.payload.userId;
      if (typeof uid === 'string' && uid.length <= 64) ws.userId = uid;
      return;
    }
    if (data.type === 'move') {
      const msg = db.messages.find(m => m.id === data.payload.id);
      if (!msg) return;
      if (!data.payload.editToken || data.payload.editToken !== msg.editToken) return; // 只能移动自己的卡片
      msg.x = Math.max(0, Math.min(95, +data.payload.x || 0));
      msg.y = Math.max(0, Math.min(90, +data.payload.y || 0));
      save();
      broadcast({ type: 'move', payload: { id: msg.id, x: msg.x, y: msg.y } });
    }
  });
});

// 启动自动保存定时器
startAutoSave();

// 进程退出前保存数据
function gracefulShutdown() {
  if (dirty) {
    console.log('检测到未保存的变更，正在保存...');
    writeToDisk();
    console.log('数据已保存');
  }
  process.exit(0);
}
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);
// 兜底：任何正常退出路径（含未捕获异常）都尽力把未落盘的变更写回磁盘
process.on('exit', () => {
  if (dirty) { try { writeToDisk(); } catch (e) { /* 退出阶段无法再处理 */ } }
});
process.on('uncaughtException', err => {
  console.error('[未捕获异常]', err);
  try { if (dirty) writeToDisk(); } catch (e) {}
  process.exit(1); // 触发 exit 钩子再兜底一次
});

server.listen(PORT, () => {
  console.log(`校园留言墙已启动: http://localhost:${PORT}`);
  console.log(`管理端: http://localhost:${PORT}/admin.html  (默认账号 admin / admin123)`);
  console.log(`保存模式: ${db.config.saveMode === 'auto' ? `自动（每 ${db.config.autoSaveInterval} 秒）` : '手动'}`);
});
