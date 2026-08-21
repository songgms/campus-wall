/* ===== 校园留言墙 - 用户端 ===== */
(function () {
  'use strict';

  // ---- DOM ----
  const wall = document.getElementById('wall');
  const emptyTip = document.getElementById('emptyTip');
  const styleSelect = document.getElementById('styleSelect');
  const addBtn = document.getElementById('addBtn');
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modalTitle');
  const textInput = document.getElementById('textInput');
  const nicknameInput = document.getElementById('nicknameInput');
  const showNameInput = document.getElementById('showNameInput');
  const charHint = document.getElementById('charHint');
  const submitBtn = document.getElementById('submitBtn');
  const cancelBtn = document.getElementById('cancelBtn');
  const toastEl = document.getElementById('toast');

  const STYLE_NAMES = { plain: '简约方框', rounded: '圆角便签', color: '彩色便签' };

  // ---- 用户身份（浏览器随机ID）----
  let userId = localStorage.getItem('wall_user_id');
  if (!userId) {
    userId = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('wall_user_id', userId);
  }

  // ---- 状态 ----
  let config = { allowAnonymous: true, allowedStyles: ['plain', 'rounded', 'color'], maxTextLength: 200 };
  let messages = [];
  let editingId = null; // 当前正在编辑的留言 id
  let toastTimer = null;

  // ---- 工具 ----
  function toast(text, isErr) {
    toastEl.textContent = text;
    toastEl.classList.toggle('err', !!isErr);
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.hidden = true; }, 2200);
  }

  // 页面内自定义确认框（替代原生 confirm）
  function customConfirm(msg, okText, danger) {
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'confirm-mask';
      mask.innerHTML = `
        <div class="confirm-box">
          <div class="confirm-msg">${esc(msg)}</div>
          <div class="confirm-actions">
            <button class="btn confirm-cancel">取消</button>
            <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} confirm-ok">${esc(okText || '确定')}</button>
          </div>
        </div>`;
      const done = val => {
        document.removeEventListener('keydown', onKey);
        mask.remove();
        resolve(val);
      };
      const onKey = e => { if (e.key === 'Escape') done(false); };
      mask.querySelector('.confirm-ok').addEventListener('click', () => done(true));
      mask.querySelector('.confirm-cancel').addEventListener('click', () => done(false));
      mask.addEventListener('click', e => { if (e.target === mask) done(false); });
      document.addEventListener('keydown', onKey);
      document.body.appendChild(mask);
      mask.querySelector('.confirm-ok').focus();
    });
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  function timeStr(ts) {
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // 按 id 稳定取一个色号 / 倾斜角，保证同一卡片在所有人屏幕上长得一样
  function hashNum(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return h;
  }

  // ---- 配置应用 ----
  function applyConfig(cfg) {
    Object.assign(config, cfg);
    // 刷新样式下拉框，只保留被允许的样式
    const prev = styleSelect.value;
    styleSelect.innerHTML = '';
    config.allowedStyles.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = STYLE_NAMES[s] || s;
      styleSelect.appendChild(opt);
    });
    if (config.allowedStyles.includes(prev)) styleSelect.value = prev;
    // 字数上限
    textInput.maxLength = config.maxTextLength;
    updateCharHint();
  }

  function updateCharHint() {
    charHint.textContent = `${textInput.value.length} / ${config.maxTextLength}`;
  }

  // ---- 渲染 ----
  function renderCard(m) {
    const old = wall.querySelector(`[data-id="${m.id}"]`);
    if (old) old.remove();

    const card = document.createElement('div');
    card.className = 'card style-' + (STYLE_NAMES[m.style] ? m.style : 'plain');
    if (m.style === 'color') card.classList.add('c' + hashNum(m.id) % 5);
    if (m.blocked) card.classList.add('blocked');

    const own = m.authorId === userId;
    if (own) card.classList.add('own');

    card.dataset.id = m.id;
    card.style.left = m.x + '%';
    card.style.top = m.y + '%';
    card.style.setProperty('--tilt', ((hashNum(m.id) % 5) - 2) + 'deg');
    card.style.transform = `rotate(${(hashNum(m.id) % 5) - 2}deg)`;

    const authorHtml = m.showName && m.nickname
      ? `<span class="card-author">${esc(m.nickname)}</span>`
      : `<span class="card-author">匿名</span>`;

    card.innerHTML = `
      ${own ? `<div class="card-actions">
        <button class="edit" title="编辑">✎</button>
        <button class="del" title="删除">✕</button>
      </div>` : ''}
      <div class="card-text">${esc(m.text)}</div>
      <div class="card-meta">
        ${authorHtml}
        <span class="card-time">${timeStr(m.createdAt)}</span>
      </div>
    `;

    if (own) {
      card.querySelector('.edit').addEventListener('click', e => { e.stopPropagation(); openEditModal(m); });
      card.querySelector('.del').addEventListener('click', e => { e.stopPropagation(); removeMessage(m.id); });
      enableDrag(card, m);
    }

    wall.appendChild(card);
    return card;
  }

  function renderAll() {
    wall.querySelectorAll('.card').forEach(c => c.remove());
    messages.forEach(renderCard);
    emptyTip.hidden = messages.length > 0;
  }

  // ---- 拖拽（仅自己的卡片）----
  function enableDrag(card, m) {
    card.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      if (e.target.closest('.card-actions')) return; // 点编辑/删除按钮不触发拖拽

      const rect = wall.getBoundingClientRect();
      const cardW = card.offsetWidth, cardH = card.offsetHeight;
      // 鼠标在卡片内的偏移
      const offX = e.clientX - card.getBoundingClientRect().left;
      const offY = e.clientY - card.getBoundingClientRect().top;

      card.classList.add('dragging');

      function onMove(ev) {
        let x = ev.clientX - rect.left - offX;
        let y = ev.clientY - rect.top - offY;
        // 边界约束
        x = Math.max(0, Math.min(rect.width - cardW, x));
        y = Math.max(0, Math.min(rect.height - cardH, y));
        card.style.left = (x / rect.width * 100) + '%';
        card.style.top = (y / rect.height * 100) + '%';
      }

      function onUp() {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        card.classList.remove('dragging');
        // 松手后把百分比位置提交给服务端广播
        const x = parseFloat(card.style.left);
        const y = parseFloat(card.style.top);
        const local = messages.find(t => t.id === m.id);
        if (local) { local.x = x; local.y = y; }
        sendWS({ type: 'move', payload: { id: m.id, authorId: userId, x, y } });
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  // ---- WebSocket 实时同步 ----
  let ws;
  function connectWS() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);

    ws.onmessage = ev => {
      let data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      const p = data.payload;
      switch (data.type) {
        case 'create':
          if (!messages.find(m => m.id === p.id)) messages.push(p);
          renderCard(p);
          emptyTip.hidden = messages.length > 0;
          break;
        case 'update': {
          const i = messages.findIndex(m => m.id === p.id);
          if (i >= 0) messages[i] = p; else messages.push(p);
          renderCard(p);
          break;
        }
        case 'move': {
          const i = messages.findIndex(m => m.id === p.id);
          if (i >= 0) { messages[i].x = p.x; messages[i].y = p.y; }
          const card = wall.querySelector(`[data-id="${p.id}"]`);
          if (card && !card.classList.contains('dragging')) {
            card.style.left = p.x + '%';
            card.style.top = p.y + '%';
          }
          break;
        }
        case 'delete':
          messages = messages.filter(m => m.id !== p.id);
          {
            const card = wall.querySelector(`[data-id="${p.id}"]`);
            if (card) card.remove();
          }
          emptyTip.hidden = messages.length > 0;
          break;
        case 'reset':
          messages = p;
          renderAll();
          toast('管理员已重置全部卡片位置');
          break;
        case 'config':
          applyConfig(p);
          toast('配置已更新');
          break;
      }
    };

    ws.onclose = () => setTimeout(connectWS, 1500); // 断线重连
  }

  function sendWS(data) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
  }

  // ---- 弹窗 ----
  function openCreateModal() {
    editingId = null;
    modalTitle.textContent = '新增留言';
    submitBtn.textContent = '发布到墙上';
    textInput.value = '';
    nicknameInput.value = localStorage.getItem('wall_nickname') || '';
    showNameInput.checked = true;
    if (!config.allowAnonymous) {
      showNameInput.checked = true;
      showNameInput.disabled = true;
    } else {
      showNameInput.disabled = false;
    }
    applyCheckDisabledStyle();
    modal.hidden = false;
    textInput.focus();
    updateCharHint();
  }

  function openEditModal(m) {
    editingId = m.id;
    modalTitle.textContent = '编辑留言';
    submitBtn.textContent = '保存修改';
    textInput.value = m.blocked ? '' : m.text;
    nicknameInput.value = m.nickname || localStorage.getItem('wall_nickname') || '';
    showNameInput.checked = !!m.showName;
    if (!config.allowAnonymous) {
      showNameInput.checked = true;
      showNameInput.disabled = true;
    } else {
      showNameInput.disabled = false;
    }
    applyCheckDisabledStyle();
    modal.hidden = false;
    textInput.focus();
    updateCharHint();
  }

  function applyCheckDisabledStyle() {
    showNameInput.parentElement.classList.toggle('disabled', showNameInput.disabled);
  }

  function closeModal() {
    modal.hidden = true;
    editingId = null;
  }

  async function submitModal() {
    const text = textInput.value.trim();
    const nickname = nicknameInput.value.trim();
    const showName = showNameInput.checked;

    if (!text) return toast('留言内容不能为空', true);
    if (showName && !nickname) return toast('公开姓名时请填写昵称', true);
    if (nickname) localStorage.setItem('wall_nickname', nickname);

    submitBtn.disabled = true;
    try {
      if (editingId) {
        const res = await fetch(`/api/messages/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, nickname, showName, authorId: userId })
        });
        if (!res.ok) throw new Error((await res.json()).error || '保存失败');
      } else {
        const res = await fetch('/api/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text, nickname, showName, authorId: userId,
            style: styleSelect.value
          })
        });
        if (!res.ok) throw new Error((await res.json()).error || '发布失败');
      }
      closeModal();
      toast(editingId ? '已保存' : '已发布到墙上');
    } catch (err) {
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  }

  async function removeMessage(id) {
    if (!(await customConfirm('确定删除这条留言吗？', '删除', true))) return;
    const res = await fetch(`/api/messages/${id}?authorId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
    if (!res.ok) {
      toast((await res.json()).error || '删除失败', true);
      return;
    }
    toast('已删除');
  }

  // ---- 事件绑定 ----
  addBtn.addEventListener('click', openCreateModal);
  cancelBtn.addEventListener('click', closeModal);
  submitBtn.addEventListener('click', submitModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  textInput.addEventListener('input', updateCharHint);
  showNameInput.addEventListener('change', () => {
    nicknameInput.disabled = !showNameInput.checked && config.allowAnonymous;
  });

  // ---- 初始化 ----
  (async function init() {
    const [cfgRes, msgRes] = await Promise.all([
      fetch('/api/config'),
      fetch('/api/messages')
    ]);
    applyConfig(await cfgRes.json());
    messages = await msgRes.json();
    renderAll();
    connectWS();
  })();
})();
