/* ═══════════════════════════════════════════════
   NovaMSG — Frontend App Logic
═══════════════════════════════════════════════ */

const $ = id => document.getElementById(id);
const qs = (sel, ctx = document) => ctx.querySelector(sel);
const qsa = (sel, ctx = document) => ctx.querySelectorAll(sel);

let currentUser = null;
let currentChatId = null;
let socket = null;
let selectedFile = null;
let typingTimer = null;
let allChats = [];

const AVATAR_COLORS = [
  '#5B9BD5','#E8533F','#4CAF82','#9C6DD8',
  '#F5A623','#00BCD4','#E91E8C','#FF7043',
  '#8BC34A','#FF5722','#607D8B','#795548'
];

// ── Init ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  setupAuthListeners();
  setupColorSwatches();
});

async function checkAuth() {
  try {
    const res = await fetch('/api/me');
    if (res.ok) {
      const data = await res.json();
      currentUser = data.user;
      showApp();
    }
  } catch(e) {}
}

// ── Auth ─────────────────────────────────────
function setupAuthListeners() {
  qsa('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      qsa('.auth-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      qsa('.auth-form').forEach(f => f.classList.add('hidden'));
      $(`${tab.dataset.tab}-form`).classList.remove('hidden');
    });
  });

  $('login-btn').addEventListener('click', handleLogin);
  $('register-btn').addEventListener('click', handleRegister);

  [$('login-username'), $('login-password')].forEach(el =>
    el.addEventListener('keydown', e => e.key === 'Enter' && handleLogin())
  );
  [$('reg-username'), $('reg-email'), $('reg-password')].forEach(el =>
    el.addEventListener('keydown', e => e.key === 'Enter' && handleRegister())
  );
}

async function handleLogin() {
  const username = $('login-username').value.trim();
  const password = $('login-password').value;
  showError('login-error', '');
  if (!username || !password) return showError('login-error', 'Заполните все поля');
  const btn = $('login-btn');
  btn.textContent = 'Вхожу...'; btn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username, password})
    });
    const data = await res.json();
    if (!res.ok) { showError('login-error', data.error); return; }
    currentUser = data.user;
    showApp();
  } finally { btn.textContent = 'Войти'; btn.disabled = false; }
}

async function handleRegister() {
  const username = $('reg-username').value.trim();
  const email = $('reg-email').value.trim();
  const password = $('reg-password').value;
  showError('reg-error', '');
  if (!username || !email || !password) return showError('reg-error', 'Заполните все поля');
  const btn = $('register-btn');
  btn.textContent = 'Создаю...'; btn.disabled = true;
  try {
    const res = await fetch('/api/register', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({username, email, password})
    });
    const data = await res.json();
    if (!res.ok) { showError('reg-error', data.error); return; }
    currentUser = data.user;
    showApp();
  } finally { btn.textContent = 'Создать аккаунт'; btn.disabled = false; }
}

function showError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

// ── App Setup ─────────────────────────────────
function showApp() {
  $('auth-screen').classList.add('hidden');
  $('app-screen').classList.remove('hidden');
  setupSocket();
  setupAppListeners();
  loadChats();
  updateUserWidget();
}

function updateUserWidget() {
  if (!currentUser) return;
  const avatar = $('my-avatar');
  avatar.textContent = currentUser.username[0].toUpperCase();
  avatar.style.background = currentUser.avatar_color;
  $('my-username').textContent = currentUser.username;
}

// ── Socket ────────────────────────────────────
function setupSocket() {
  socket = io();

  socket.on('connected', () => console.log('Socket connected'));

  socket.on('new_message', msg => {
    if (msg.chat_id === currentChatId) {
      appendMessage(msg);
      scrollToBottom();
      // Mark as read
      fetch(`/api/chat/${msg.chat_id}/messages`);
    }
    // Update sidebar
    loadChats();
  });

  socket.on('user_typing', data => {
    if (data.chat_id === currentChatId) {
      showTyping(data.username);
    }
  });
}

// ── Chat List ─────────────────────────────────
async function loadChats() {
  try {
    const res = await fetch('/api/chats');
    const data = await res.json();
    allChats = data.chats || [];
    renderChatList(allChats);
  } catch(e) {}
}

function renderChatList(chats) {
  const container = $('chats-list');
  if (!chats.length) {
    container.innerHTML = `
      <div class="empty-chats">
        <div class="icon">💬</div>
        <p>Нет чатов. Начните разговор!</p>
      </div>`;
    return;
  }
  container.innerHTML = chats.map((chat, i) => {
    const initial = chat.name[0]?.toUpperCase() || '?';
    const lastMsg = chat.last_message;
    const preview = lastMsg
      ? (lastMsg.msg_type !== 'text' ? `📎 ${lastMsg.file_name || 'Файл'}` : lastMsg.content)
      : 'Нет сообщений';
    const time = lastMsg ? formatTime(lastMsg.created_at) : '';
    const badge = chat.unread_count > 0
      ? `<span class="unread-badge">${chat.unread_count}</span>` : '';
    const isActive = chat.id === currentChatId ? 'active' : '';
    return `
      <div class="chat-item ${isActive}" data-id="${chat.id}" style="animation-delay:${i*0.04}s">
        <div class="avatar sm" style="background:${chat.avatar_color}">${chat.is_group ? '👥' : initial}</div>
        <div class="chat-item-content">
          <div class="chat-item-header">
            <span class="chat-item-name">${escHtml(chat.name)}</span>
            <span class="chat-item-time">${time}</span>
          </div>
          <div class="chat-item-preview">
            <span class="chat-item-last">${escHtml(preview.slice(0,50))}</span>
            ${badge}
          </div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.chat-item').forEach(el => {
    el.addEventListener('click', () => openChat(+el.dataset.id));
  });
}

// ── Open Chat ─────────────────────────────────
async function openChat(chatId) {
  currentChatId = chatId;
  const chat = allChats.find(c => c.id === chatId);

  $('welcome-screen').classList.add('hidden');
  $('chat-view').classList.remove('hidden');

  if (chat) {
    const avatar = $('chat-avatar');
    avatar.textContent = chat.is_group ? '👥' : chat.name[0]?.toUpperCase() || '?';
    avatar.style.background = chat.avatar_color;
    $('chat-name').textContent = chat.name;
    $('chat-sub').textContent = chat.is_group ? 'Группа' : '';
  }

  // Update active state
  qsa('.chat-item').forEach(el => {
    el.classList.toggle('active', +el.dataset.id === chatId);
  });

  if (socket) socket.emit('join_chat', { chat_id: chatId });

  // Load messages
  const msgList = $('messages-list');
  msgList.innerHTML = '<div style="text-align:center;color:var(--text-2);padding:20px"><div class="spinner" style="margin:auto"></div></div>';

  try {
    const res = await fetch(`/api/chat/${chatId}/messages`);
    const data = await res.json();
    renderMessages(data.messages || []);
  } catch(e) {}

  // Update header sub for DMs
  if (chat && !chat.is_group) {
    updateDmStatus(chatId);
  }

  loadChats(); // Refresh unread
}

async function updateDmStatus(chatId) {
  try {
    const res = await fetch(`/api/chat/${chatId}/info`);
    const data = await res.json();
    const other = data.chat.members.find(m => m.id !== currentUser.id);
    if (other) {
      $('chat-sub').textContent = other.status === 'online' ? '● В сети' : '○ Не в сети';
      $('chat-sub').style.color = other.status === 'online' ? '#4caf82' : 'var(--text-2)';
    }
  } catch(e) {}
}

// ── Render Messages ───────────────────────────
function renderMessages(messages) {
  const list = $('messages-list');
  list.innerHTML = '';
  let lastDate = '';

  messages.forEach(msg => {
    const msgDate = new Date(msg.created_at).toLocaleDateString('ru-RU', {day:'numeric', month:'long'});
    if (msgDate !== lastDate) {
      lastDate = msgDate;
      const sep = document.createElement('div');
      sep.className = 'date-sep';
      sep.textContent = msgDate;
      list.appendChild(sep);
    }
    list.appendChild(buildMessageEl(msg));
  });
  scrollToBottom(false);
}

function appendMessage(msg) {
  const list = $('messages-list');
  list.appendChild(buildMessageEl(msg));
  hideTyping();
}

function buildMessageEl(msg) {
  const isMine = msg.sender_id === currentUser.id;
  const wrapper = document.createElement('div');
  wrapper.className = `msg-wrapper ${isMine ? 'mine' : ''}`;

  const avatarHtml = !isMine
    ? `<div class="msg-avatar" style="background:${msg.sender_color}">${msg.sender_username[0]?.toUpperCase()}</div>`
    : '';

  let contentHtml = '';

  if (msg.msg_type === 'image') {
    contentHtml = `
      <div class="msg-bubble" style="padding:6px">
        ${!isMine ? `<div class="msg-sender">${escHtml(msg.sender_username)}</div>` : ''}
        <img class="msg-img" src="${msg.file_url}" alt="${escHtml(msg.file_name)}" loading="lazy" onclick="openLightbox('${msg.file_url}')">
        ${msg.content ? `<div style="padding:6px 4px 4px;font-size:13px">${escHtml(msg.content)}</div>` : ''}
        <div class="msg-time">${formatTime(msg.created_at)}</div>
      </div>`;
  } else if (msg.msg_type === 'file') {
    const icon = getFileIcon(msg.file_name);
    contentHtml = `
      <div class="msg-bubble" style="padding:4px">
        ${!isMine ? `<div class="msg-sender" style="padding:6px 10px 0">${escHtml(msg.sender_username)}</div>` : ''}
        <a class="msg-file" href="${msg.file_url}" download="${escHtml(msg.file_name)}" target="_blank">
          <span class="msg-file-icon">${icon}</span>
          <div class="msg-file-info">
            <div class="msg-file-name">${escHtml(msg.file_name)}</div>
            <div class="msg-file-size">${formatSize(msg.file_size)}</div>
          </div>
          <span style="opacity:.6">⬇️</span>
        </a>
        <div class="msg-time" style="padding:4px 10px 6px">${formatTime(msg.created_at)}</div>
      </div>`;
  } else {
    contentHtml = `
      <div class="msg-bubble">
        ${!isMine ? `<div class="msg-sender">${escHtml(msg.sender_username)}</div>` : ''}
        ${escHtml(msg.content).replace(/\n/g,'<br>')}
        <div class="msg-time">${formatTime(msg.created_at)}</div>
      </div>`;
  }

  wrapper.innerHTML = avatarHtml + contentHtml;
  return wrapper;
}

// ── Send Message ──────────────────────────────
function setupAppListeners() {
  // Send
  $('send-btn').addEventListener('click', sendMessage);
  $('message-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  $('message-input').addEventListener('input', () => {
    autoResizeTextarea($('message-input'));
    handleTyping();
  });

  // Attach file
  $('attach-btn').addEventListener('click', () => $('file-input').click());
  $('file-input').addEventListener('change', handleFileSelect);
  $('remove-file-btn').addEventListener('click', clearFile);

  // New chat modal
  $('new-chat-btn').addEventListener('click', () => openModal('modal-new-chat'));
  $('new-group-btn').addEventListener('click', () => openModal('modal-new-group'));

  // Search user
  $('search-user-input').addEventListener('input', debounce(searchUsers, 300));

  // Create group
  $('create-group-btn').addEventListener('click', createGroup);

  // Chat info
  $('chat-info-btn').addEventListener('click', showChatInfo);

  // Settings
  $('settings-btn').addEventListener('click', openSettings);
  $('settings-back').addEventListener('click', closeSettings);
  $('save-settings-btn').addEventListener('click', saveSettings);
  $('logout-btn').addEventListener('click', logout);

  // Modal closes
  qsa('.modal-close').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal-overlay')));
  });
  qsa('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal(overlay);
    });
  });

  // Chat search
  $('chat-search').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    const filtered = allChats.filter(c => c.name.toLowerCase().includes(q));
    renderChatList(filtered);
  });
}

async function sendMessage() {
  if (!currentChatId) return;
  const input = $('message-input');
  const content = input.value.trim();

  if (!content && !selectedFile) return;

  if (selectedFile) {
    await sendFile(content);
  } else {
    socket.emit('send_message', {
      chat_id: currentChatId,
      content,
      msg_type: 'text'
    });
  }

  input.value = '';
  input.style.height = 'auto';
  clearFile();
}

async function sendFile(caption = '') {
  const formData = new FormData();
  formData.append('file', selectedFile);
  try {
    const res = await fetch('/api/upload', { method:'POST', body: formData });
    const data = await res.json();
    if (!res.ok) return;

    const isImage = selectedFile.type.startsWith('image/');
    socket.emit('send_message', {
      chat_id: currentChatId,
      content: caption,
      msg_type: isImage ? 'image' : 'file',
      file_url: data.url,
      file_name: data.name,
      file_size: data.size
    });
  } catch(e) { console.error(e); }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedFile = file;
  $('file-preview').classList.remove('hidden');
  $('file-preview-name').textContent = file.name;
  $('file-preview-size').textContent = formatSize(file.size);
}

function clearFile() {
  selectedFile = null;
  $('file-input').value = '';
  $('file-preview').classList.add('hidden');
}

// ── Typing ────────────────────────────────────
function handleTyping() {
  if (!currentChatId || !socket) return;
  socket.emit('typing', { chat_id: currentChatId });
}

function showTyping(username) {
  const el = $('typing-indicator');
  el.classList.remove('hidden');
  el.title = `${username} печатает...`;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(hideTyping, 2500);
}
function hideTyping() {
  $('typing-indicator').classList.add('hidden');
}

// ── Modals ────────────────────────────────────
function openModal(id) {
  $(id).classList.remove('hidden');
}
function closeModal(el) {
  if (typeof el === 'string') el = $(el);
  el.classList.add('hidden');
}

async function searchUsers() {
  const q = $('search-user-input').value.trim();
  if (!q) { $('user-search-results').innerHTML = ''; return; }
  const res = await fetch(`/api/search_users?q=${encodeURIComponent(q)}`);
  const data = await res.json();
  const results = $('user-search-results');
  if (!data.users.length) {
    results.innerHTML = '<p style="color:var(--text-2);font-size:13px;text-align:center;padding:10px">Не найдено</p>';
    return;
  }
  results.innerHTML = data.users.map(u => `
    <div class="user-result-item" data-username="${escHtml(u.username)}">
      <div class="avatar md" style="background:${u.avatar_color}">${u.username[0].toUpperCase()}</div>
      <div class="user-result-info">
        <div class="user-result-name">${escHtml(u.username)}</div>
        <div class="user-result-status">${u.status === 'online' ? '● В сети' : '○ Не в сети'}</div>
      </div>
    </div>`).join('');

  results.querySelectorAll('.user-result-item').forEach(el => {
    el.addEventListener('click', async () => {
      const res = await fetch('/api/create_direct', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ username: el.dataset.username })
      });
      const data = await res.json();
      closeModal('modal-new-chat');
      $('search-user-input').value = '';
      $('user-search-results').innerHTML = '';
      await loadChats();
      openChat(data.chat_id);
    });
  });
}

async function createGroup() {
  const name = $('group-name-input').value.trim();
  const description = $('group-desc-input').value.trim();
  const membersRaw = $('group-members-input').value;
  const members = membersRaw.split(',').map(s => s.trim()).filter(Boolean);

  showError('group-error', '');
  if (!name) return showError('group-error', 'Введите название');

  const res = await fetch('/api/create_group', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ name, description, members })
  });
  const data = await res.json();
  if (!res.ok) return showError('group-error', data.error);

  closeModal('modal-new-group');
  $('group-name-input').value = '';
  $('group-desc-input').value = '';
  $('group-members-input').value = '';
  await loadChats();
  openChat(data.chat_id);
}

async function showChatInfo() {
  if (!currentChatId) return;
  const res = await fetch(`/api/chat/${currentChatId}/info`);
  const data = await res.json();
  const chat = data.chat;

  const body = $('chat-info-body');
  const membersHtml = chat.members.map(m => `
    <div class="info-member">
      <div class="avatar md" style="background:${m.avatar_color}">${m.username[0].toUpperCase()}</div>
      <div>
        <div class="info-member-name">${escHtml(m.username)}</div>
        <div class="info-member-role">${m.is_admin ? '👑 Администратор' : 'Участник'} • ${m.status === 'online' ? '● В сети' : '○ Не в сети'}</div>
      </div>
    </div>`).join('');

  body.innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div class="avatar xl" style="background:${chat.avatar_color};margin:0 auto 10px">${chat.is_group ? '👥' : chat.members[0]?.username[0]?.toUpperCase()}</div>
      <div style="font-size:18px;font-weight:700">${escHtml(chat.name)}</div>
      ${chat.description ? `<div style="font-size:13px;color:var(--text-2);margin-top:4px">${escHtml(chat.description)}</div>` : ''}
    </div>
    <div>
      <div style="font-size:12px;color:var(--text-2);text-transform:uppercase;letter-spacing:.08em;margin-bottom:10px">
        Участники (${chat.members.length})
      </div>
      ${membersHtml}
    </div>`;

  openModal('modal-chat-info');
}

// ── Settings ──────────────────────────────────
function openSettings() {
  if (!currentUser) return;
  $('settings-username').value = currentUser.username;
  $('settings-bio').value = currentUser.bio || '';
  $('settings-password').value = '';

  const avatar = $('settings-avatar');
  avatar.textContent = currentUser.username[0].toUpperCase();
  avatar.style.background = currentUser.avatar_color;

  // Mark selected color
  qsa('.color-swatch').forEach(sw => {
    sw.classList.toggle('selected', sw.dataset.color === currentUser.avatar_color);
  });

  $('settings-msg').classList.add('hidden');
  $('settings-panel').classList.remove('hidden');
}

function closeSettings() {
  $('settings-panel').classList.add('hidden');
}

function setupColorSwatches() {
  const container = $('color-swatches');
  AVATAR_COLORS.forEach(color => {
    const sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = color;
    sw.dataset.color = color;
    sw.addEventListener('click', () => {
      qsa('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      $('settings-avatar').style.background = color;
    });
    container.appendChild(sw);
  });
}

async function saveSettings() {
  const username = $('settings-username').value.trim();
  const bio = $('settings-bio').value.trim();
  const newPassword = $('settings-password').value;
  const selectedColor = qs('.color-swatch.selected')?.dataset.color || currentUser.avatar_color;

  const res = await fetch('/api/update_profile', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ username, bio, avatar_color: selectedColor, new_password: newPassword || undefined })
  });
  const data = await res.json();

  const msgEl = $('settings-msg');
  if (!res.ok) {
    msgEl.textContent = data.error;
    msgEl.style.background = 'rgba(255,107,107,0.15)';
    msgEl.style.color = '#ff6b6b';
  } else {
    currentUser = data.user;
    msgEl.textContent = '✓ Настройки сохранены';
    msgEl.style.background = 'rgba(76,175,130,0.15)';
    msgEl.style.color = '#4caf82';
    updateUserWidget();
    loadChats();
  }
  msgEl.classList.remove('hidden');
  setTimeout(() => msgEl.classList.add('hidden'), 3000);
}

async function logout() {
  await fetch('/api/logout', { method:'POST' });
  currentUser = null;
  currentChatId = null;
  if (socket) socket.disconnect();
  $('app-screen').classList.add('hidden');
  $('auth-screen').classList.remove('hidden');
  $('chats-list').innerHTML = '<div class="chats-loading"><div class="spinner"></div></div>';
  $('chat-view').classList.add('hidden');
  $('welcome-screen').classList.remove('hidden');
  $('settings-panel').classList.add('hidden');
}

// ── Lightbox ──────────────────────────────────
function openLightbox(url) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${url}" alt="image">`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
}

// ── Utilities ─────────────────────────────────
function formatTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });
}

function formatSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024*1024) return `${(bytes/1024).toFixed(1)} КБ`;
  return `${(bytes/1024/1024).toFixed(1)} МБ`;
}

function getFileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  const icons = {
    pdf:'📄', doc:'📝', docx:'📝', xls:'📊', xlsx:'📊',
    zip:'🗜️', rar:'🗜️', '7z':'🗜️', mp3:'🎵', wav:'🎵',
    mp4:'🎬', avi:'🎬', mov:'🎬', png:'🖼️', jpg:'🖼️',
    jpeg:'🖼️', gif:'🖼️', txt:'📃', py:'🐍', js:'💛', html:'🌐'
  };
  return icons[ext] || '📁';
}

function escHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
            .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function scrollToBottom(animate = true) {
  const container = $('messages-container');
  if (animate) {
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
  } else {
    container.scrollTop = container.scrollHeight;
  }
}

function autoResizeTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

function debounce(fn, delay) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

window.openLightbox = openLightbox;
