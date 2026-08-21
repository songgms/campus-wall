const express = require('express');
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const SECRET = 'campus-wall-secret-key';

// ---------- 数据持久化 ----------
const DEFAULT_DATA = {
  messages: [],
  config: {
    allowAnonymous: true,
    allowedStyles: ['plain', 'rounded', 'color'],
    maxTextLength: 200,
    adminUser: 'admin',
    adminPass: 'admin123'
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

function save() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

// ---------- 工具 ----------
function genId() {
  return Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
}

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
}

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
function publicMessage(m) {
  const copy = Object.assign({}, m);
  if (copy.blocked) copy.text = '【该内容已被管理员屏蔽】';
  if (!copy.showName) copy.nickname = null;
  return copy;
}

// ---------- HTTP 服务 ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 登录
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (username === db.config.adminUser && password === db.config.adminPass) {
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

// 公开留言列表（用户端初始加载）
app.get('/api/messages', (req, res) => {
  res.json(db.messages.map(publicMessage));
});

// 新增留言
app.post('/api/messages', (req, res) => {
  const { text, style, nickname, showName, authorId, x, y } = req.body || {};
  const cfg = db.config;
  if (!text || !text.trim()) return res.status(400).json({ error: '留言内容不能为空' });
  if (text.trim().length > cfg.maxTextLength) {
    return res.status(400).json({ error: `留言不能超过 ${cfg.maxTextLength} 字` });
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
    nickname: nickname || null,
    showName: !!showName,
    blocked: false,
    createdAt: Date.now()
  };
  db.messages.push(msg);
  save();
  broadcast({ type: 'create', payload: publicMessage(msg) });
  res.json(msg);
});

// 编辑自己的留言
app.patch('/api/messages/:id', (req, res) => {
  const msg = db.messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: '留言不存在' });
  if (msg.authorId !== (req.body || {}).authorId) {
    return res.status(403).json({ error: '只能编辑自己的留言' });
  }
  const { text, style, nickname, showName } = req.body;
  if (text !== undefined) {
    if (!text.trim()) return res.status(400).json({ error: '留言内容不能为空' });
    if (text.trim().length > db.config.maxTextLength) {
      return res.status(400).json({ error: `留言不能超过 ${db.config.maxTextLength} 字` });
    }
    msg.text = text.trim();
  }
  if (style !== undefined && db.config.allowedStyles.includes(style)) msg.style = style;
  if (nickname !== undefined) msg.nickname = nickname || null;
  if (showName !== undefined) msg.showName = !!showName;
  save();
  broadcast({ type: 'update', payload: publicMessage(msg) });
  res.json(msg);
});

// 删除自己的留言
app.delete('/api/messages/:id', (req, res) => {
  const idx = db.messages.findIndex(m => m.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: '留言不存在' });
  if (db.messages[idx].authorId !== req.query.authorId) {
    return res.status(403).json({ error: '只能删除自己的留言' });
  }
  const [removed] = db.messages.splice(idx, 1);
  save();
  broadcast({ type: 'delete', payload: { id: removed.id } });
  res.json({ ok: true });
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
  broadcast({ type: 'update', payload: publicMessage(msg) });
  res.json(msg);
});

// 重置全部卡片位置
app.post('/api/admin/reset-positions', requireAdmin, (req, res) => {
  db.messages.forEach(m => {
    m.x = Math.random() * 70 + 5;
    m.y = Math.random() * 70 + 8;
  });
  save();
  broadcast({ type: 'reset', payload: db.messages.map(publicMessage) });
  res.json({ ok: true });
});

// 配置管理
app.get('/api/admin/config', requireAdmin, (req, res) => {
  res.json(db.config);
});

app.put('/api/admin/config', requireAdmin, (req, res) => {
  const { allowAnonymous, allowedStyles, maxTextLength, adminUser, adminPass } = req.body || {};
  if (allowAnonymous !== undefined) db.config.allowAnonymous = !!allowAnonymous;
  if (Array.isArray(allowedStyles) && allowedStyles.length) db.config.allowedStyles = allowedStyles;
  if (maxTextLength !== undefined) {
    const n = parseInt(maxTextLength, 10);
    if (!n || n < 1 || n > 2000) return res.status(400).json({ error: '字数上限需在 1-2000 之间' });
    db.config.maxTextLength = n;
  }
  if (adminUser && adminUser.trim()) db.config.adminUser = adminUser.trim();
  if (adminPass && adminPass.trim()) db.config.adminPass = adminPass.trim();
  save();
  const { allowAnonymous: a, allowedStyles: s, maxTextLength: l } = db.config;
  broadcast({ type: 'config', payload: { allowAnonymous: a, allowedStyles: s, maxTextLength: l } });
  res.json(db.config);
});

// 统计
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const total = db.messages.length;
  const today = db.messages.filter(m => m.createdAt >= todayStart).length;
  const anonymous = db.messages.filter(m => !m.showName).length;
  res.json({ total, today, anonymous, percent: total ? Math.round(anonymous / total * 100) : 0 });
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

wss.on('connection', ws => {
  // 客户端拖拽移动卡片（松手后提交）
  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (data.type === 'move') {
      const msg = db.messages.find(m => m.id === data.payload.id);
      if (!msg || msg.authorId !== data.payload.authorId) return; // 只能移动自己的卡片
      msg.x = Math.max(0, Math.min(95, +data.payload.x || 0));
      msg.y = Math.max(0, Math.min(90, +data.payload.y || 0));
      save();
      broadcast({ type: 'move', payload: { id: msg.id, x: msg.x, y: msg.y } });
    }
  });
});

server.listen(PORT, () => {
  console.log(`校园留言墙已启动: http://localhost:${PORT}`);
  console.log(`管理端: http://localhost:${PORT}/admin.html  (默认账号 admin / admin123)`);
});
