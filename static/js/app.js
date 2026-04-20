/* XChat — App JS */
const $ = id => document.getElementById(id);
const qs = (s,c=document) => c.querySelector(s);
const qsa = (s,c=document) => c.querySelectorAll(s);

let currentUser = null;
let currentChatId = null;
let socket = null;
let selectedFile = null;
let typingTimer = null;
let allChats = [];
let activeTab = 'chats';

const COLORS = ['#5B7FFF','#E8533F','#4CAF82','#9C6DD8','#F5A623','#00BCD4','#E91E8C','#FF7043','#8BC34A','#FF5722','#607D8B','#34c77b'];

document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupAuth();
  setupColorSwatches();
});

/* ── Auth ── */
async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) { const d = await r.json(); currentUser = d.user; showApp(); }
  } catch(e) {}
}

function setupAuth() {
  qsa('.auth-tab').forEach(t => t.addEventListener('click', () => {
    qsa('.auth-tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    qsa('.auth-form').forEach(f => f.classList.add('hidden'));
    $(`${t.dataset.tab}-form`).classList.remove('hidden');
  }));
  $('login-btn').addEventListener('click', doLogin);
  $('register-btn').addEventListener('click', doRegister);
  [$('login-username'),$('login-password')].forEach(el => el.addEventListener('keydown', e => e.key==='Enter'&&doLogin()));
  [$('reg-username'),$('reg-display'),$('reg-email'),$('reg-password')].forEach(el => el.addEventListener('keydown', e => e.key==='Enter'&&doRegister()));
}

async function doLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  showErr('login-error','');
  if (!username||!password) return showErr('login-error','Заполните все поля');
  const btn = $('login-btn'); btn.textContent='Вхожу...'; btn.disabled=true;
  try {
    const r = await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    const d = await r.json();
    if (!r.ok) return showErr('login-error',d.error);
    currentUser = d.user; showApp();
  } finally { btn.textContent='Войти'; btn.disabled=false; }
}

async function doRegister() {
  const username=$('reg-username').value.trim(), display_name=$('reg-display').value.trim();
  const email=$('reg-email').value.trim(), password=$('reg-password').value;
  showErr('reg-error','');
  if (!username||!email||!password) return showErr('reg-error','Заполните все поля');
  const btn=$('register-btn'); btn.textContent='Создаю...'; btn.disabled=true;
  try {
    const r = await fetch('/api/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,display_name,email,password})});
    const d = await r.json();
    if (!r.ok) return showErr('reg-error',d.error);
    currentUser = d.user; showApp();
  } finally { btn.textContent='Создать аккаунт'; btn.disabled=false; }
}

function showErr(id,msg) {
  const el=$(id); el.textContent=msg; el.style.display=msg?'block':'none';
}

/* ── App ── */
function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  initSocket();
  setupListeners();
  loadChats();
  populateSettings();
}

/* ── Nav ── */
function switchTab(tab) {
  activeTab = tab;
  qsa('.tab-page').forEach(p => p.classList.remove('active'));
  qsa('.nav-btn').forEach(b => b.classList.remove('active'));
  $(`tab-${tab}`).classList.add('active');
  qs(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
}

/* ── Socket ── */
function initSocket() {
  socket = io();
  socket.on('new_message', msg => {
    if (msg.chat_id === currentChatId) {
      appendMsg(msg); scrollBottom();
      fetch(`/api/chat/${msg.chat_id}/messages`);
    }
    loadChats();
  });
  socket.on('user_typing', d => {
    if (d.chat_id === currentChatId) showTyping();
  });
}

/* ── Chats ── */
async function loadChats() {
  try {
    const r = await fetch('/api/chats');
    const d = await r.json();
    allChats = d.chats || [];
    renderChats(allChats);
  } catch(e) {}
}

function renderChats(chats) {
  const el = $('chats-list');
  if (!chats.length) {
    el.innerHTML = `<div class="empty-chats"><div class="icon">💬</div><p>Нет чатов</p><p style="font-size:13px">Нажмите + чтобы начать</p></div>`;
    return;
  }
  el.innerHTML = chats.map((c,i) => {
    const avatarHtml = buildAvatarHtml(c.avatar_url, c.avatar_color, c.is_group ? '👥' : c.name[0]?.toUpperCase(), 'sm');
    const lm = c.last_message;
    const preview = lm ? (lm.msg_type!=='text' ? `📎 ${lm.file_name||'Файл'}` : lm.content) : 'Нет сообщений';
    const time = lm ? fmtTime(lm.created_at) : '';
    const badge = c.unread_count > 0 ? `<span class="unread-badge">${c.unread_count}</span>` : '';
    const active = c.id === currentChatId ? 'active' : '';
    return `<div class="chat-item ${active}" data-id="${c.id}" style="animation-delay:${i*0.03}s">
      ${avatarHtml}
      <div class="chat-item-content">
        <div class="chat-item-header">
          <span class="chat-item-name">${esc(c.name)}</span>
          <span class="chat-item-time">${time}</span>
        </div>
        <div class="chat-item-footer">
          <span class="chat-item-last">${esc(preview.slice(0,55))}</span>
          ${badge}
        </div>
      </div>
    </div>
    <div class="chat-item-sep"></div>`;
  }).join('');
  qsa('.chat-item').forEach(el => el.addEventListener('click', () => openChat(+el.dataset.id)));
}

function buildAvatarHtml(url, color, initials, size='sm') {
  const bg = url ? 'transparent' : color;
  const inner = url ? `<img src="${url}" alt="">` : (initials||'?');
  return `<div class="avatar ${size}" style="background:${bg}">${inner}</div>`;
}

/* ── Open Chat ── */
async function openChat(chatId) {
  currentChatId = chatId;
  const chat = allChats.find(c => c.id === chatId);

  // Show overlay
  const overlay = $('chat-view-overlay');
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => overlay.classList.add('visible'));

  if (chat) {
    const hdrAvatar = $('chat-hdr-avatar');
    if (chat.avatar_url) {
      hdrAvatar.innerHTML = `<img src="${chat.avatar_url}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:50%">`;
      hdrAvatar.style.background = 'transparent';
    } else {
      hdrAvatar.textContent = chat.is_group ? '👥' : chat.name[0]?.toUpperCase();
      hdrAvatar.style.background = chat.avatar_color;
      hdrAvatar.style.fontSize = '16px';
    }
    $('chat-name').textContent = chat.name;
    $('chat-sub').textContent = chat.is_group ? `Группа` : '';
  }

  qsa('.chat-item').forEach(el => el.classList.toggle('active', +el.dataset.id === chatId));
  if (socket) socket.emit('join_chat', {chat_id: chatId});

  $('messages-list').innerHTML = '<div style="text-align:center;padding:30px"><div class="spinner" style="margin:auto"></div></div>';

  try {
    const r = await fetch(`/api/chat/${chatId}/messages`);
    const d = await r.json();
    renderMsgs(d.messages || []);
  } catch(e) {}

  if (chat && !chat.is_group) getDmStatus(chatId);
  loadChats();
}

function closeChat() {
  const overlay = $('chat-view-overlay');
  overlay.classList.remove('visible');
  setTimeout(() => { overlay.classList.add('hidden'); currentChatId = null; }, 300);
  qsa('.chat-item').forEach(el => el.classList.remove('active'));
}

async function getDmStatus(chatId) {
  try {
    const r = await fetch(`/api/chat/${chatId}/info`);
    const d = await r.json();
    const other = d.chat.members.find(m => m.id !== currentUser.id);
    if (other) {
      $('chat-sub').textContent = other.status === 'online' ? '● В сети' : '○ Не в сети';
      $('chat-sub').style.color = other.status === 'online' ? 'var(--green)' : 'var(--text-2)';
    }
  } catch(e) {}
}

/* ── Messages ── */
function renderMsgs(msgs) {
  const list = $('messages-list');
  list.innerHTML = '';
  let lastDate = '';
  msgs.forEach(msg => {
    const d = new Date(msg.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    if (d !== lastDate) {
      lastDate = d;
      const sep = document.createElement('div');
      sep.className = 'date-sep'; sep.textContent = d;
      list.appendChild(sep);
    }
    list.appendChild(buildMsgEl(msg));
  });
  scrollBottom(false);
}

function appendMsg(msg) {
  $('messages-list').appendChild(buildMsgEl(msg));
  hideTyping();
}

function buildMsgEl(msg) {
  const mine = msg.sender_id === currentUser.id;
  const wrap = document.createElement('div');
  wrap.className = `msg-wrapper ${mine?'mine':''}`;

  const avatarHtml = !mine
    ? (msg.sender_avatar_url
        ? `<div class="msg-avatar-sm"><img src="${msg.sender_avatar_url}" alt=""></div>`
        : `<div class="msg-avatar-sm" style="background:${msg.sender_color}">${msg.sender_username[0]?.toUpperCase()}</div>`)
    : '';

  let content = '';
  if (msg.msg_type === 'image') {
    content = `<div class="msg-bubble" style="padding:6px">
      ${!mine?`<div class="msg-sender">${esc(msg.sender_username)}</div>`:''}
      <img class="msg-img" src="${msg.file_url}" alt="${esc(msg.file_name)}" loading="lazy" onclick="showLightbox('${msg.file_url}')">
      ${msg.content?`<div style="padding:4px 4px 2px;font-size:13px">${esc(msg.content)}</div>`:''}
      <div class="msg-time">${fmtTime(msg.created_at)}</div>
    </div>`;
  } else if (msg.msg_type === 'file') {
    content = `<div class="msg-bubble">
      ${!mine?`<div class="msg-sender">${esc(msg.sender_username)}</div>`:''}
      <a class="msg-file" href="${msg.file_url}" download="${esc(msg.file_name)}" target="_blank">
        <span class="msg-file-icon">${fileIcon(msg.file_name)}</span>
        <div class="msg-file-info">
          <div class="msg-file-name">${esc(msg.file_name)}</div>
          <div class="msg-file-size">${fmtSize(msg.file_size)}</div>
        </div>⬇️
      </a>
      <div class="msg-time">${fmtTime(msg.created_at)}</div>
    </div>`;
  } else {
    content = `<div class="msg-bubble">
      ${!mine?`<div class="msg-sender">${esc(msg.sender_username)}</div>`:''}
      ${esc(msg.content).replace(/\n/g,'<br>')}
      <div class="msg-time">${fmtTime(msg.created_at)}</div>
    </div>`;
  }

  wrap.innerHTML = avatarHtml + content;
  return wrap;
}

/* ── Send ── */
function setupListeners() {
  // Nav
  qsa('.nav-btn').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // Settings sub-tabs
  qsa('.stab').forEach(btn => btn.addEventListener('click', () => {
    qsa('.stab').forEach(b => b.classList.remove('active'));
    qsa('.stab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    $(`stab-${btn.dataset.stab}`).classList.add('active');
  }));

  // Chat back
  $('back-btn').addEventListener('click', closeChat);

  // Send
  $('send-btn').addEventListener('click', doSend);
  $('message-input').addEventListener('keydown', e => { if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend();} });
  $('message-input').addEventListener('input', () => { autoResize($('message-input')); emitTyping(); });

  // File
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', onFileSelect);
  $('remove-file-btn').addEventListener('click', clearFile);

  // New chat FAB
  $('new-chat-fab').addEventListener('click', () => openModal('modal-new-chat'));
  $('opt-direct').addEventListener('click', () => { closeModal('modal-new-chat'); openModal('modal-find-user'); });
  $('opt-group').addEventListener('click', () => { closeModal('modal-new-chat'); openModal('modal-new-group'); });

  // Search user
  $('search-user-input').addEventListener('input', debounce(doSearchUsers, 300));

  // Create group
  $('create-group-btn').addEventListener('click', doCreateGroup);

  // Chat info
  $('chat-info-btn').addEventListener('click', showChatInfo);

  // Chat search
  $('chat-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    renderChats(allChats.filter(c => c.name.toLowerCase().includes(q)));
  });

  // Settings
  $('avatar-upload-btn').addEventListener('click', () => $('avatar-file-input').click());
  $('avatar-file-input').addEventListener('change', doAvatarUpload);
  $('save-settings-btn').addEventListener('click', doSaveSettings);
  $('logout-btn').addEventListener('click', doLogout);

  // Modal closes
  qsa('.modal-close').forEach(btn => btn.addEventListener('click', () => closeModal(btn.closest('.modal-overlay'))));
  qsa('.modal-overlay').forEach(o => o.addEventListener('click', e => { if(e.target===o) closeModal(o); }));

  // Premium button (coming soon)
  qs('.btn-premium').addEventListener('click', () => alert('🚧 Оплата скоро будет доступна!'));
}

async function doSend() {
  if (!currentChatId) return;
  const input = $('message-input');
  const text = input.value.trim();
  if (!text && !selectedFile) return;
  if (selectedFile) await doSendFile(text);
  else socket.emit('send_message', {chat_id:currentChatId, content:text, msg_type:'text'});
  input.value = ''; input.style.height='auto'; clearFile();
}

async function doSendFile(caption='') {
  const fd = new FormData(); fd.append('file', selectedFile);
  const r = await fetch('/api/upload', {method:'POST',body:fd});
  const d = await r.json();
  if (!r.ok) return;
  socket.emit('send_message', {
    chat_id:currentChatId, content:caption,
    msg_type: selectedFile.type.startsWith('image/') ? 'image' : 'file',
    file_url:d.url, file_name:d.name, file_size:d.size
  });
}

function onFileSelect(e) {
  const f = e.target.files[0]; if (!f) return;
  selectedFile = f;
  $('file-preview').classList.remove('hidden');
  $('file-preview-name').textContent = f.name;
  $('file-preview-size').textContent = fmtSize(f.size);
}
function clearFile() { selectedFile=null; $('file-input').value=''; $('file-preview').classList.add('hidden'); }
function emitTyping() { if(!currentChatId||!socket) return; socket.emit('typing',{chat_id:currentChatId}); }
function showTyping() { const el=$('typing-indicator'); el.classList.remove('hidden'); clearTimeout(typingTimer); typingTimer=setTimeout(hideTyping,2500); }
function hideTyping() { $('typing-indicator').classList.add('hidden'); }

/* ── Modals ── */
function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(el) { if(typeof el==='string') el=$(el); el.classList.add('hidden'); }

async function doSearchUsers() {
  const q = $('search-user-input').value.trim();
  const res = $('user-search-results');
  if (!q) { res.innerHTML=''; return; }
  const r = await fetch(`/api/search_users?q=${encodeURIComponent(q)}`);
  const d = await r.json();
  if (!d.users.length) { res.innerHTML='<p style="color:var(--text-2);text-align:center;padding:16px">Не найдено</p>'; return; }
  res.innerHTML = d.users.map(u => {
    const av = u.avatar_url ? `<img src="${u.avatar_url}" alt="" style="width:38px;height:38px;object-fit:cover;border-radius:50%">` : u.display_name[0]?.toUpperCase();
    const bg = u.avatar_url ? 'transparent' : u.avatar_color;
    return `<div class="user-result-item" data-login="${esc(u.username)}">
      <div class="avatar md" style="background:${bg}">${av}</div>
      <div>
        <div class="user-result-name">${esc(u.display_name||u.username)}</div>
        <div class="user-result-login">@${esc(u.username)} • ${u.status==='online'?'● В сети':'○ Не в сети'}</div>
      </div>
    </div>`;
  }).join('');
  qsa('.user-result-item',res).forEach(el => el.addEventListener('click', async () => {
    const r = await fetch('/api/create_direct',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:el.dataset.login})});
    const d = await r.json();
    closeModal('modal-find-user');
    $('search-user-input').value=''; $('user-search-results').innerHTML='';
    await loadChats(); openChat(d.chat_id);
  }));
}

async function doCreateGroup() {
  const name=$('group-name-input').value.trim();
  const description=$('group-desc-input').value.trim();
  const members=$('group-members-input').value.split(',').map(s=>s.trim()).filter(Boolean);
  showErr('group-error','');
  if (!name) return showErr('group-error','Введите название');
  const r = await fetch('/api/create_group',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description,members})});
  const d = await r.json();
  if (!r.ok) return showErr('group-error',d.error);
  closeModal('modal-new-group');
  $('group-name-input').value=''; $('group-desc-input').value=''; $('group-members-input').value='';
  await loadChats(); openChat(d.chat_id);
}

async function showChatInfo() {
  if (!currentChatId) return;
  const r = await fetch(`/api/chat/${currentChatId}/info`);
  const d = await r.json(); const chat = d.chat;
  const body = $('chat-info-body');
  const av = chat.avatar_url ? `<img src="${chat.avatar_url}" alt="" style="width:90px;height:90px;object-fit:cover;border-radius:50%">` : (chat.is_group?'👥':chat.members[0]?.username[0]?.toUpperCase());
  const bg = chat.avatar_url ? 'transparent' : chat.avatar_color;
  const mems = chat.members.map(m => {
    const mav = m.avatar_url ? `<img src="${m.avatar_url}" alt="">` : (m.display_name||m.username)[0]?.toUpperCase();
    const mbg = m.avatar_url ? 'transparent' : m.avatar_color;
    return `<div class="info-member">
      <div class="avatar md" style="background:${mbg}">${mav}</div>
      <div><div class="info-member-name">${esc(m.display_name||m.username)}</div>
      <div class="info-member-role">${m.is_admin?'👑 Админ':'Участник'} • ${m.status==='online'?'● В сети':'○ Не в сети'}</div></div>
    </div>`;
  }).join('');
  body.innerHTML = `<div style="text-align:center;margin-bottom:16px">
    <div class="avatar xl" style="background:${bg};margin:0 auto 10px">${av}</div>
    <div style="font-size:20px;font-weight:800">${esc(chat.name)}</div>
    ${chat.description?`<div style="font-size:13px;color:var(--text-2);margin-top:4px">${esc(chat.description)}</div>`:''}
  </div>
  <div style="font-size:12px;color:var(--text-2);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">Участники (${chat.members.length})</div>
  ${mems}`;
  openModal('modal-chat-info');
}

/* ── Settings ── */
function populateSettings() {
  if (!currentUser) return;
  $('settings-display-name').value = currentUser.display_name || currentUser.username;
  $('settings-username').value = currentUser.username;
  $('settings-bio').value = currentUser.bio || '';
  $('settings-password').value = '';
  $('profile-display-name').textContent = currentUser.display_name || currentUser.username;
  $('profile-login').textContent = '@' + currentUser.username;
  const av = $('settings-avatar');
  setAvatarEl(av, currentUser);
  qsa('.color-swatch').forEach(s => s.classList.toggle('selected', s.dataset.color === currentUser.avatar_color));
}

function setAvatarEl(el, user) {
  if (!el) return;
  if (user.avatar_url) {
    el.innerHTML = `<img src="${user.avatar_url}" alt="">`;
    el.style.background = 'transparent';
  } else {
    el.innerHTML = (user.display_name||user.username)[0]?.toUpperCase()||'?';
    el.style.background = user.avatar_color;
  }
}

function setupColorSwatches() {
  const c = $('color-swatches');
  COLORS.forEach(col => {
    const sw = document.createElement('div');
    sw.className='color-swatch'; sw.style.background=col; sw.dataset.color=col;
    sw.addEventListener('click', () => {
      qsa('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      if (!currentUser?.avatar_url) $('settings-avatar').style.background = col;
    });
    c.appendChild(sw);
  });
}

async function doAvatarUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const fd = new FormData(); fd.append('avatar', file);
  $('avatar-upload-btn').style.opacity = '0.5';
  try {
    const r = await fetch('/api/upload_avatar',{method:'POST',body:fd});
    const d = await r.json();
    if (!r.ok) { showSettingsMsg(d.error, false); return; }
    currentUser = d.user;
    setAvatarEl($('settings-avatar'), currentUser);
    $('profile-display-name').textContent = currentUser.display_name||currentUser.username;
    showSettingsMsg('Фото обновлено!', true);
  } finally { $('avatar-upload-btn').style.opacity='1'; e.target.value=''; }
}

async function doSaveSettings() {
  const display_name = $('settings-display-name').value.trim();
  const username = $('settings-username').value.trim();
  const bio = $('settings-bio').value.trim();
  const new_password = $('settings-password').value;
  const avatar_color = qs('.color-swatch.selected')?.dataset.color || currentUser.avatar_color;
  const r = await fetch('/api/update_profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({display_name,username,bio,avatar_color,new_password:new_password||undefined})});
  const d = await r.json();
  if (!r.ok) { showSettingsMsg(d.error, false); return; }
  currentUser = d.user;
  populateSettings();
  loadChats();
  showSettingsMsg('✓ Сохранено!', true);
}

function showSettingsMsg(text, ok) {
  const el = $('settings-msg');
  el.textContent = text;
  el.className = `settings-msg ${ok?'success':'error'}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 3000);
}

async function doLogout() {
  await fetch('/api/logout',{method:'POST'});
  currentUser = null; currentChatId = null;
  if (socket) socket.disconnect();
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('login-username').value=''; $('login-password').value='';
}

/* ── Lightbox ── */
function showLightbox(url) {
  const o = document.createElement('div');
  o.className='lightbox-overlay';
  o.innerHTML=`<img src="${url}" alt="">`;
  o.addEventListener('click',()=>o.remove());
  document.body.appendChild(o);
}

/* ── Utils ── */
function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});
}
function fmtSize(b) {
  if (!b) return '';
  if (b<1024) return b+' Б';
  if (b<1024*1024) return (b/1024).toFixed(1)+' КБ';
  return (b/1024/1024).toFixed(1)+' МБ';
}
function fileIcon(n='') {
  const e=n.split('.').pop().toLowerCase();
  const m={pdf:'📄',doc:'📝',docx:'📝',xls:'📊',xlsx:'📊',zip:'🗜️',rar:'🗜️',mp3:'🎵',mp4:'🎬',txt:'📃',py:'🐍',js:'💛',html:'🌐'};
  return m[e]||'📁';
}
function esc(s) {
  if(!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function scrollBottom(smooth=true) {
  const c=$('messages-container');
  if(smooth) c.scrollTo({top:c.scrollHeight,behavior:'smooth'});
  else c.scrollTop=c.scrollHeight;
}
function autoResize(el) { el.style.height='auto'; el.style.height=Math.min(el.scrollHeight,110)+'px'; }
function debounce(fn,d) { let t; return (...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),d);}; }

window.showLightbox = showLightbox;
