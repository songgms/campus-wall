/* ===== 校园留言墙 - 管理端 ===== */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  const loginPage = $('loginPage');
  const adminPage = $('adminPage');
  const loginErr = $('loginErr');
  const toastEl = $('toast');
  const msgTable = $('msgTable');

  let token = localStorage.getItem('wall_admin_token') || '';
  let messages = [];
  let toastTimer = null;

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
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  async function api(path, options) {
    const res = await fetch(path, Object.assign({
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }
    }, options));
    if (res.status === 401) { showLogin(); throw new Error('登录已失效，请重新登录'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  // ---- 登录/登出 ----
  function showLogin() {
    localStorage.removeItem('wall_admin_token');
    token = '';
    adminPage.hidden = true;
    loginPage.hidden = false;
  }

  function showAdmin() {
    loginPage.hidden = true;
    adminPage.hidden = false;
    refreshAll();
  }

  async function doLogin() {
    const username = $('loginUser').value.trim();
    const password = $('loginPass').value;
    loginErr.textContent = '';
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登录失败');
      token = data.token;
      localStorage.setItem('wall_admin_token', token);
      toast('登录成功');
      showAdmin();
    } catch (err) {
      loginErr.textContent = err.message;
    }
  }

  // ---- 数据加载 ----
  async function loadMessages() {
    messages = await api('/api/admin/messages');
    renderTable();
  }

  async function loadStats() {
    const s = await api('/api/admin/stats');
    $('statTotal').textContent = s.total;
    $('statToday').textContent = s.today;
    $('statAnon').textContent = s.anonymous;
    $('statPercent').textContent = s.percent + '%';
    $('statBlocked').textContent = s.blocked || 0;
    $('statLikes').textContent = s.totalLikes || 0;
  }

  async function refreshAll() {
    try {
      await Promise.all([loadMessages(), loadStats()]);
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---- 留言列表 ----
  function renderTable() {
    if (!messages.length) {
      msgTable.innerHTML = '<tr><td colspan="7" class="empty-row">暂无留言</td></tr>';
      return;
    }
    msgTable.innerHTML = messages.map(m => `
      <tr data-id="${m.id}">
        <td><input type="checkbox" class="row-check"></td>
        <td>
          <div class="msg-text">${esc(m.text)}</div>
          ${m.blocked ? '<span class="msg-blocked">⚠ 已屏蔽</span>' : ''}
        </td>
        <td>${timeStr(m.createdAt)}</td>
        <td>
          <div>${esc(m.nickname || '（未填昵称）')}</div>
          <div class="raw-author">ID: ${esc(m.authorId)}</div>
        </td>
        <td>♥ ${Array.isArray(m.likes) ? m.likes.length : (m.likesCount || 0)}</td>
        <td>${m.showName
          ? '<span class="tag tag-named">实名</span>'
          : '<span class="tag tag-anon">匿名</span>'}</td>
        <td>
          <button class="btn btn-sm act-block">${m.blocked ? '解除屏蔽' : '屏蔽内容'}</button>
          <button class="btn btn-sm btn-danger act-del">删除</button>
        </td>
      </tr>
    `).join('');
  }

  msgTable.addEventListener('click', async e => {
    const tr = e.target.closest('tr[data-id]');
    if (!tr) return;
    const id = tr.dataset.id;
    try {
      if (e.target.classList.contains('act-del')) {
        if (!(await customConfirm('确定删除这条留言？', '删除', true))) return;
        await api(`/api/admin/messages/${id}`, { method: 'DELETE' });
        toast('已删除');
      } else if (e.target.classList.contains('act-block')) {
        const m = messages.find(t => t.id === id);
        await api(`/api/admin/messages/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ blocked: !m.blocked })
        });
        toast(!m.blocked ? '已屏蔽该内容' : '已解除屏蔽');
      } else {
        return;
      }
      refreshAll();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 全选
  $('selAllBtn').addEventListener('click', () => {
    const checks = msgTable.querySelectorAll('.row-check');
    const allChecked = [...checks].every(c => c.checked);
    checks.forEach(c => { c.checked = !allChecked; });
  });

  // 批量删除
  $('batchDelBtn').addEventListener('click', async () => {
    const ids = [...msgTable.querySelectorAll('.row-check')]
      .filter(c => c.checked)
      .map(c => c.closest('tr').dataset.id);
    if (!ids.length) return toast('请先勾选要删除的留言', true);
    if (!(await customConfirm(`确定批量删除 ${ids.length} 条留言？`, '批量删除', true))) return;
    try {
      await api('/api/admin/messages/batch-delete', {
        method: 'POST',
        body: JSON.stringify({ ids })
      });
      toast(`已删除 ${ids.length} 条留言`);
      refreshAll();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 重置卡片位置
  $('resetPosBtn').addEventListener('click', async () => {
    if (!(await customConfirm('确定重置全部卡片位置？所有卡片将被重新随机排布。'))) return;
    try {
      await api('/api/admin/reset-positions', { method: 'POST' });
      toast('已重置全部卡片位置');
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('refreshBtn').addEventListener('click', refreshAll);

  // 保存状态
  async function refreshSaveStatus() {
    // 仅在设置页可见时刷新，避免引用不存在的元素
    if ($('pageSettings').hidden) return;
    try {
      const s = await api('/api/admin/save-status');
      const statusEl = $('saveStatusText');
      const lastTimeEl = $('saveLastTime');
      if (s.dirty) {
        statusEl.textContent = '有未保存的变更';
        statusEl.style.color = '#d97706';
      } else {
        statusEl.textContent = '已保存';
        statusEl.style.color = '#16a34a';
      }
      lastTimeEl.textContent = s.lastSave ? new Date(s.lastSave).toLocaleString('zh-CN') : '尚未保存';
      $('manualSaveBtn').disabled = !s.dirty;
    } catch (e) {
      // 静默失败
    }
  }

  $('manualSaveBtn').addEventListener('click', async () => {
    try {
      const r = await api('/api/admin/save', { method: 'POST' });
      if (r.skipped) toast(r.message);
      else toast('数据已保存到磁盘');
      refreshSaveStatus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  // 定时刷新保存状态（每 10 秒）
  setInterval(refreshSaveStatus, 10000);

  // 导出数据
  $('exportBtn').addEventListener('click', () => {
    // 直接打开下载链接（带 token 通过 query 不太安全，改用 fetch + blob）
    fetch('/api/admin/export', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(res => {
        if (!res.ok) throw new Error('导出失败');
        return res.blob();
      })
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `campus-wall-export-${Date.now()}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast('数据已导出');
      })
      .catch(err => toast(err.message, true));
  });

  // ---- 导航 ----
  function switchPage(page) {
    $('pageHome').hidden = page !== 'home';
    $('pageSettings').hidden = page !== 'settings';
    $('navHome').classList.toggle('active', page === 'home');
    $('navSettings').classList.toggle('active', page === 'settings');
    if (page === 'settings') loadConfigForm();
  }

  $('navHome').addEventListener('click', () => { switchPage('home'); refreshAll(); });
  $('navSettings').addEventListener('click', () => switchPage('settings'));

  // ---- 设置页 ----
  async function loadConfigForm() {
    try {
      const cfg = await api('/api/admin/config');
      $('cfgAnonymous').checked = cfg.allowAnonymous;
      document.querySelectorAll('.cfg-styles input').forEach(cb => {
        cb.checked = cfg.allowedStyles.includes(cb.value);
      });
      $('cfgMaxLen').value = cfg.maxTextLength;
      $('cfgSensitiveFilter').checked = cfg.enableSensitiveFilter !== false;
      $('cfgSensitiveWords').value = (cfg.sensitiveWords || []).join('\n');
      // 保存设置
      document.querySelectorAll('input[name="cfgSaveMode"]').forEach(radio => {
        radio.checked = radio.value === (cfg.saveMode || 'auto');
      });
      $('cfgAutoSaveInterval').value = cfg.autoSaveInterval || 30;
      $('cfgBackupLimit').value = cfg.backupLimit || 5;
      refreshSaveStatus();
    } catch (err) {
      toast(err.message, true);
    }
  }

  $('saveCfgBtn').addEventListener('click', async () => {
    const allowedStyles = [...document.querySelectorAll('.cfg-styles input')]
      .filter(cb => cb.checked).map(cb => cb.value);
    if (!allowedStyles.length) return toast('至少保留一种卡片样式', true);
    const sensitiveWords = $('cfgSensitiveWords').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    const saveMode = document.querySelector('input[name="cfgSaveMode"]:checked')?.value || 'auto';
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({
          allowAnonymous: $('cfgAnonymous').checked,
          allowedStyles,
          maxTextLength: $('cfgMaxLen').value,
          enableSensitiveFilter: $('cfgSensitiveFilter').checked,
          sensitiveWords,
          saveMode,
          autoSaveInterval: $('cfgAutoSaveInterval').value,
          backupLimit: $('cfgBackupLimit').value
        })
      });
      toast('设置已保存并实时生效');
      refreshSaveStatus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  $('saveAdminBtn').addEventListener('click', async () => {
    const adminUser = $('cfgAdminUser').value.trim();
    const adminPass = $('cfgAdminPass').value;
    if (!adminUser && !adminPass) return toast('请填写要修改的账号或密码', true);
    try {
      await api('/api/admin/config', {
        method: 'PUT',
        body: JSON.stringify({ adminUser: adminUser || undefined, adminPass: adminPass || undefined })
      });
      $('cfgAdminUser').value = '';
      $('cfgAdminPass').value = '';
      toast('管理员账号已更新');
    } catch (err) {
      toast(err.message, true);
    }
  });

  // ---- 登录事件 ----
  $('loginBtn').addEventListener('click', doLogin);
  $('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  $('logoutBtn').addEventListener('click', () => { showLogin(); toast('已退出登录'); });

  // ---- 初始化：已有 token 则直接进入 ----
  if (token) {
    api('/api/admin/stats').then(showAdmin).catch(showLogin);
  }
})();
