/* XChat — app.js */
const $  = id => document.getElementById(id);
const qs = (s,c=document) => c.querySelector(s);
const qa = (s,c=document) => [...c.querySelectorAll(s)];

let ME = null, CID = null, sock = null, selFile = null, allChats = [];
let mediaRec = null, recStream = null, recChunks = [], recTimer = null, recSec = 0;
const COLORS = ['#5B7FFF','#E8533F','#4CAF82','#9C6DD8','#F5A623','#00BCD4','#E91E8C','#FF7043','#8BC34A','#34c77b','#FF5722','#607D8B'];

/* ═══ BOOT ═══ */
document.addEventListener('DOMContentLoaded', () => {
  checkAuth(); setupAuth(); buildSwatches();
});

async function checkAuth() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) { ME = (await r.json()).user; bootApp(); }
  } catch(e) {}
}

/* ═══ AUTH ═══ */
function setupAuth() {
  qa('.atab').forEach(t => t.addEventListener('click', () => {
    qa('.atab').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');
    qa('.aform').forEach(f=>f.classList.add('hidden'));
    $(`${t.dataset.tab}-form`).classList.remove('hidden');
  }));
  $('l-btn').onclick = doLogin;
  $('r-btn').onclick = doRegister;
  [$('l-user'),$('l-pass')].forEach(el=>el.addEventListener('keydown',e=>e.key==='Enter'&&doLogin()));
  [$('r-user'),$('r-nick'),$('r-mail'),$('r-pass')].forEach(el=>el.addEventListener('keydown',e=>e.key==='Enter'&&doRegister()));
}

async function doLogin() {
  const u=$('l-user').value.trim(), p=$('l-pass').value;
  aerr('l-err','');
  if(!u||!p) return aerr('l-err','Заполните все поля');
  const btn=$('l-btn'); btn.textContent='Вхожу...'; btn.disabled=true;
  try {
    const r=await post('/api/login',{username:u,password:p});
    if(!r.ok) return aerr('l-err',(await r.json()).error);
    ME=(await r.json()).user; bootApp();
  } finally {btn.textContent='Войти';btn.disabled=false;}
}

async function doRegister() {
  const u=$('r-user').value.trim(), n=$('r-nick').value.trim(), m=$('r-mail').value.trim(), p=$('r-pass').value;
  aerr('r-err','');
  if(!u||!m||!p) return aerr('r-err','Заполните все поля');
  const btn=$('r-btn'); btn.textContent='Создаю...'; btn.disabled=true;
  try {
    const r=await post('/api/register',{username:u,display_name:n,email:m,password:p});
    if(!r.ok) return aerr('r-err',(await r.json()).error);
    ME=(await r.json()).user; bootApp();
  } finally {btn.textContent='Создать аккаунт';btn.disabled=false;}
}

function aerr(id,msg){const e=$(id);e.textContent=msg;e.style.display=msg?'block':'none';}

/* ═══ APP BOOT ═══ */
function bootApp() {
  $('auth-screen').classList.add('hidden');
  $('app').classList.remove('hidden');
  initSock(); bindAll(); loadChats(); fillSettings();
  requestNotifPerm();
}

/* ═══ SOCKET ═══ */
function initSock() {
  sock = io();
  sock.on('new_message', msg => {
    if (msg.chat_id === CID) { appendMsg(msg); scrollBot(); fetch(`/api/chat/${msg.chat_id}/messages`); }
    loadChats();
    if (msg.sender_id !== ME.id && msg.chat_id !== CID) showToast(msg);
  });
  sock.on('user_typing', d => { if(d.chat_id===CID) showTyping(); });
  sock.on('chat_deleted', d => { if(d.chat_id===CID) { closeChat(); loadChats(); } });
  sock.on('member_left', d => { if(d.chat_id===CID && d.user_id===ME.id) { closeChat(); loadChats(); } });
}

/* ═══ NAV ═══ */
function switchTab(t) {
  qa('.tpage').forEach(p=>p.classList.remove('active'));
  qa('.nbtn').forEach(b=>b.classList.remove('active'));
  $(`tp-${t}`).classList.add('active');
  qs(`.nbtn[data-t="${t}"]`).classList.add('active');
}

/* ═══ CHATS ═══ */
async function loadChats() {
  try { allChats=(await (await fetch('/api/chats')).json()).chats||[]; renderChats(allChats); } catch(e){}
}

function renderChats(list) {
  const el=$('clist');
  if(!list.length){
    el.innerHTML=`<div class="empty"><svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z"/></svg><p>Нет чатов.<br>Нажмите + чтобы начать</p></div>`;
    return;
  }
  el.innerHTML = list.map((c,i)=>{
    const av = mkAv(c.avatar_url, c.avatar_color, c.is_group ? '#' : c.name[0]?.toUpperCase()||'?', 'sm');
    const lm = c.last_message;
    let prev = lm ? (lm.msg_type==='text' ? lm.content : lm.msg_type==='voice' ? '[голосовое]' : '[файл]') : 'Нет сообщений';
    const time = lm ? fmtT(lm.created_at) : '';
    const badge = c.unread_count>0 ? `<span class="ubadge">${c.unread_count}</span>` : '';
    return `<div class="ci${c.id===CID?' active':''}" data-id="${c.id}" style="animation-delay:${i*.03}s">
      ${av}<div class="ci-c">
        <div class="ci-h"><span class="ci-n">${esc(c.name)}</span><span class="ci-t">${time}</span></div>
        <div class="ci-f"><span class="ci-p">${esc(prev.slice(0,55))}</span>${badge}</div>
      </div></div><div class="cisep"></div>`;
  }).join('');
  qa('.ci').forEach(el=>el.addEventListener('click',()=>openChat(+el.dataset.id)));
}

/* ═══ OPEN CHAT ═══ */
async function openChat(id) {
  CID = id;
  const chat = allChats.find(c=>c.id===id);
  const cov = $('cov');
  cov.classList.remove('hidden');
  requestAnimationFrame(()=>cov.classList.add('open'));

  if(chat) {
    const cav = $('cav');
    setAvEl(cav, {avatar_url:chat.avatar_url, avatar_color:chat.avatar_color,
      display_name:chat.is_group?'#':chat.name, username:chat.name}, 'md');
    $('cname').textContent = chat.name;
    $('csub').textContent = chat.is_group ? 'Группа' : '';
    // store other_user_id for DM header click
    cov.dataset.otherUser = chat.other_user_id || '';
    cov.dataset.isGroup = chat.is_group ? '1' : '0';
    cov.dataset.chatId = id;
  }
  qa('.ci').forEach(el=>el.classList.toggle('active',+el.dataset.id===id));
  if(sock) sock.emit('join_chat',{chat_id:id});
  $('mlist').innerHTML='<div style="text-align:center;padding:30px"><div class="spin" style="margin:auto"></div></div>';
  try {
    const msgs=(await(await fetch(`/api/chat/${id}/messages`)).json()).messages||[];
    renderMsgs(msgs);
  } catch(e){}
  if(chat&&!chat.is_group) getDmSub(id);
  loadChats();
}

function closeChat() {
  const cov=$('cov');
  cov.classList.remove('open');
  setTimeout(()=>{ cov.classList.add('hidden'); CID=null; },300);
  qa('.ci').forEach(el=>el.classList.remove('active'));
}

async function getDmSub(id) {
  try {
    const d=(await(await fetch(`/api/chat/${id}/info`)).json()).chat;
    const o=d.members.find(m=>m.id!==ME.id);
    if(o){ $('csub').textContent=o.status==='online'?'● В сети':'○ Не в сети'; $('csub').style.color=o.status==='online'?'var(--grn)':'var(--t2)'; }
  } catch(e){}
}

/* ═══ MESSAGES ═══ */
function renderMsgs(msgs) {
  const list=$('mlist'); list.innerHTML=''; let lastD='';
  msgs.forEach(msg=>{
    const d=new Date(msg.created_at).toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
    if(d!==lastD){lastD=d;const s=document.createElement('div');s.className='dsep';s.textContent=d;list.appendChild(s);}
    list.appendChild(buildMsgEl(msg));
  });
  scrollBot(false);
}

function appendMsg(msg){ $('mlist').appendChild(buildMsgEl(msg)); hideTyping(); }

function buildMsgEl(msg) {
  const mine = msg.sender_id===ME.id;
  const wrap = document.createElement('div');
  wrap.className = `mw${mine?' me':''}`;

  // avatar (not mine)
  let avHtml='';
  if(!mine){
    if(msg.sender_avatar_url) avHtml=`<div class="mav"><img src="${msg.sender_avatar_url}" alt=""></div>`;
    else avHtml=`<div class="mav" style="background:${msg.sender_color}">${msg.sender_username[0]?.toUpperCase()}</div>`;
  }

  let body='';
  if(msg.msg_type==='image'){
    body=`<div class="mb" style="padding:6px">
      ${!mine?`<div class="msnd">${esc(msg.sender_username)}</div>`:''}
      <img class="mimg" src="${msg.file_url}" loading="lazy" onclick="lbox('${msg.file_url}')">
      ${msg.content?`<div style="padding:4px 2px 2px;font-size:13px">${esc(msg.content)}</div>`:''}
      <div class="mtm">${fmtT(msg.created_at)}</div></div>`;
  } else if(msg.msg_type==='file'){
    body=`<div class="mb">
      ${!mine?`<div class="msnd">${esc(msg.sender_username)}</div>`:''}
      <a class="mfile" href="${msg.file_url}" download="${esc(msg.file_name)}" target="_blank">
        <span class="mfi">${ficon(msg.file_name)}</span>
        <div><div class="mfn">${esc(msg.file_name)}</div><div class="mfs">${fmtSz(msg.file_size)}</div></div>
      </a>
      <div class="mtm">${fmtT(msg.created_at)}</div></div>`;
  } else if(msg.msg_type==='voice'){
    const dur = msg.duration||0;
    const uid = 'vox_'+msg.id;
    body=`<div class="mb">
      ${!mine?`<div class="msnd">${esc(msg.sender_username)}</div>`:''}
      <div class="mvox">
        <button class="vox-play" onclick="playVox('${msg.file_url}','${uid}')" title="Воспроизвести">
          <svg viewBox="0 0 24 24" id="${uid}-ico"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <div class="vox-bar" onclick="seekVox(event,'${msg.file_url}','${uid}')">
          <div class="vox-prog" id="${uid}-prog"></div>
        </div>
        <span class="vox-dur" id="${uid}-dur">${fmtDur(dur)}</span>
      </div>
      <div class="mtm">${fmtT(msg.created_at)}</div></div>`;
  } else {
    body=`<div class="mb">
      ${!mine?`<div class="msnd">${esc(msg.sender_username)}</div>`:''}
      ${esc(msg.content).replace(/\n/g,'<br>')}
      <div class="mtm">${fmtT(msg.created_at)}</div></div>`;
  }
  wrap.innerHTML = avHtml+body;
  return wrap;
}

/* ═══ VOICE PLAYER ═══ */
const audioMap = {};
function playVox(url, uid) {
  if(audioMap[uid]) {
    const a=audioMap[uid];
    if(a.paused){a.play();setVoxIco(uid,true);}
    else{a.pause();setVoxIco(uid,false);}
    return;
  }
  const a=new Audio(url);
  audioMap[uid]=a;
  a.addEventListener('timeupdate',()=>{
    const prog=$(`${uid}-prog`), dur=$(`${uid}-dur`);
    if(prog&&a.duration) prog.style.width=(a.currentTime/a.duration*100)+'%';
    if(dur) dur.textContent=fmtDur(Math.floor(a.currentTime));
  });
  a.addEventListener('ended',()=>{ setVoxIco(uid,false); const p=$(`${uid}-prog`); if(p) p.style.width='0%'; });
  a.play(); setVoxIco(uid,true);
}
function seekVox(e,url,uid){
  const a=audioMap[uid]; if(!a||!a.duration) return;
  const bar=e.currentTarget, rect=bar.getBoundingClientRect();
  a.currentTime=((e.clientX-rect.left)/rect.width)*a.duration;
}
function setVoxIco(uid,playing){
  const ico=$(`${uid}-ico`); if(!ico) return;
  ico.innerHTML=playing?'<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>':'<path d="M8 5v14l11-7z"/>';
}

/* ═══ VOICE RECORDING ═══ */
async function startRec() {
  try {
    recStream=await navigator.mediaDevices.getUserMedia({audio:true});
  } catch(e){ alert('Нет доступа к микрофону'); return; }
  recChunks=[]; recSec=0;
  mediaRec=new MediaRecorder(recStream);
  mediaRec.ondataavailable=e=>recChunks.push(e.data);
  mediaRec.onstop=sendVoice;
  mediaRec.start();
  $('voice-btn').classList.add('recording');
  $('voice-rec').classList.remove('hidden');
  $('msginp').classList.add('hidden');
  $('sendbtn').classList.add('hidden');
  $('vrec-time').textContent='0:00';
  recTimer=setInterval(()=>{ recSec++; $('vrec-time').textContent=fmtDur(recSec); },1000);
}

function stopRec() {
  if(mediaRec&&mediaRec.state!=='inactive') mediaRec.stop();
  if(recStream) recStream.getTracks().forEach(t=>t.stop());
  clearInterval(recTimer);
  $('voice-btn').classList.remove('recording');
  $('voice-rec').classList.add('hidden');
  $('msginp').classList.remove('hidden');
  $('sendbtn').classList.remove('hidden');
}

function cancelRec() {
  if(mediaRec&&mediaRec.state!=='inactive'){
    mediaRec.ondataavailable=null; mediaRec.onstop=null; mediaRec.stop();
  }
  if(recStream) recStream.getTracks().forEach(t=>t.stop());
  clearInterval(recTimer); recChunks=[];
  $('voice-btn').classList.remove('recording');
  $('voice-rec').classList.add('hidden');
  $('msginp').classList.remove('hidden');
  $('sendbtn').classList.remove('hidden');
}

async function sendVoice() {
  if(!recChunks.length||!CID) return;
  const blob=new Blob(recChunks,{type:'audio/webm'});
  const fd=new FormData(); fd.append('voice',blob,'voice.webm'); fd.append('duration',recSec);
  try {
    const r=await fetch('/api/upload_voice',{method:'POST',body:fd});
    const d=await r.json(); if(!r.ok) return;
    sock.emit('send_message',{chat_id:CID,content:'',msg_type:'voice',file_url:d.url,file_name:'voice.webm',file_size:d.size,duration:d.duration});
  } catch(e){}
}

/* ═══ SEND MESSAGE ═══ */
async function doSend() {
  if(!CID) return;
  const inp=$('msginp'), text=inp.value.trim();
  if(!text&&!selFile) return;
  if(selFile) await doSendFile(text);
  else sock.emit('send_message',{chat_id:CID,content:text,msg_type:'text'});
  inp.value=''; inp.style.height='auto'; clearSel();
}

async function doSendFile(cap='') {
  const fd=new FormData(); fd.append('file',selFile);
  const r=await fetch('/api/upload',{method:'POST',body:fd});
  const d=await r.json(); if(!r.ok) return;
  sock.emit('send_message',{chat_id:CID,content:cap,msg_type:selFile.type.startsWith('image/')?'image':'file',file_url:d.url,file_name:d.name,file_size:d.size});
}

function clearSel(){selFile=null;$('f-inp').value='';$('fprev').classList.add('hidden');}

/* ═══ NOTIFICATIONS ═══ */
function requestNotifPerm() {
  if('Notification' in window && Notification.permission==='default') Notification.requestPermission();
}

function showToast(msg) {
  // In-app toast
  const chat=allChats.find(c=>c.id===msg.chat_id);
  const name=chat?chat.name:msg.sender_username;
  const text=msg.msg_type==='text'?msg.content:msg.msg_type==='voice'?'[голосовое]':'[файл]';
  const t=document.createElement('div'); t.className='ntf';
  t.innerHTML=`<div class="ntf-av" style="background:${msg.sender_color}">${msg.sender_username[0]?.toUpperCase()}</div>
    <div class="ntf-body"><div class="ntf-from">${esc(name)}</div><div class="ntf-text">${esc(text.slice(0,60))}</div></div>`;
  t.onclick=()=>{ openChat(msg.chat_id); t.remove(); switchTab('chats'); };
  document.body.appendChild(t);
  setTimeout(()=>t.remove(),4000);

  // Browser notification
  if('Notification' in window && Notification.permission==='granted' && document.hidden) {
    new Notification(`XChat: ${name}`,{body:text.slice(0,80),tag:'xchat'});
  }
}

/* ═══ PROFILE OVERLAY ═══ */
async function openProfile(userId) {
  try {
    const u=(await(await fetch(`/api/user/${userId}`)).json()).user;
    const pov=$('prof-ov');
    const av=$('pov-av'); setAvEl(av,u,'xl');
    $('pov-name').textContent=u.display_name||u.username;
    $('pov-login').textContent='@'+u.username;
    $('pov-status').textContent=u.status==='online'?'● В сети':'○ Не в сети';
    $('pov-status').style.color=u.status==='online'?'var(--grn)':'var(--t2)';
    $('pov-bio').textContent=u.bio||'';
    $('pov-msg-btn').onclick=async()=>{
      const r=await post('/api/create_direct',{username:u.username});
      const d=await r.json();
      closeProfOv(); await loadChats(); openChat(d.chat_id); switchTab('chats');
    };
    pov.classList.remove('hidden');
    requestAnimationFrame(()=>pov.classList.add('open'));
  } catch(e){}
}
function closeProfOv(){ const p=$('prof-ov'); p.classList.remove('open'); setTimeout(()=>p.classList.add('hidden'),300); }

/* ═══ GROUP INFO ═══ */
async function openGroupInfo(chatId) {
  try {
    const d=(await(await fetch(`/api/chat/${chatId}/info`)).json()).chat;
    const body=$('gi-body'); const isAdmin=d.members.find(m=>m.id===ME.id)?.is_admin;
    const isOwner=d.created_by===ME.id;
    const mems=d.members.map(m=>{
      const avEl=mkAv(m.avatar_url,m.avatar_color,(m.display_name||m.username)[0]?.toUpperCase(),'md');
      const kickBtn=isAdmin&&m.id!==ME.id?`<button class="gm-kick" data-uid="${m.id}" title="Удалить из группы">&#10005;</button>`:'';
      return `<div class="gm">${avEl}<div class="gm-info"><div class="gm-name" data-uid="${m.id}" style="cursor:pointer">${esc(m.display_name||m.username)}</div><div class="gm-role">${m.is_admin?'Администратор':'Участник'} &bull; ${m.status==='online'?'В сети':'Не в сети'}</div></div>${kickBtn}</div>`;
    }).join('');

    body.innerHTML=`
      <div style="text-align:center;margin-bottom:14px">
        ${mkAv(d.avatar_url,d.avatar_color,'#','xl').replace('class="av xl"','class="av xl" style="margin:0 auto 10px"')}
        <div style="font-size:18px;font-weight:800">${esc(d.name)}</div>
        ${d.description?`<div style="font-size:13px;color:var(--t2);margin-top:3px">${esc(d.description)}</div>`:''}
      </div>
      <div style="font-size:11px;color:var(--t2);font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px">Участники (${d.members.length})</div>
      ${mems}
      <div style="display:flex;flex-direction:column;gap:8px;margin-top:14px">
        ${isAdmin?`<button class="abtn" id="gi-addmem">+ Добавить участника</button>`:''}
        <button class="abtn" id="gi-leave" style="background:rgba(255,107,107,.15);color:#ff6b6b;box-shadow:none">Покинуть группу</button>
        ${isOwner?`<button class="abtn" id="gi-del" style="background:rgba(255,60,60,.15);color:#ff4040;box-shadow:none">Удалить группу</button>`:''}
      </div>`;

    // Bind kicks
    qa('.gm-kick',body).forEach(btn=>btn.addEventListener('click',async()=>{
      if(!confirm('Удалить участника?')) return;
      await post(`/api/group/${chatId}/kick`,{user_id:+btn.dataset.uid});
      closeModal('m-grpinfo'); openGroupInfo(chatId);
    }));
    // Bind profile clicks
    qa('.gm-name',body).forEach(el=>el.addEventListener('click',()=>openProfile(+el.dataset.uid)));

    const addBtn=$('gi-addmem');
    if(addBtn) addBtn.onclick=()=>{ closeModal('m-grpinfo'); openModal('m-addmem'); $('add-btn').dataset.cid=chatId; };

    const leaveBtn=$('gi-leave');
    leaveBtn.onclick=async()=>{
      if(!confirm('Покинуть группу?')) return;
      await post(`/api/group/${chatId}/leave`,{});
      closeModal('m-grpinfo'); closeChat(); loadChats();
    };
    const delBtn=$('gi-del');
    if(delBtn) delBtn.onclick=async()=>{
      if(!confirm('Удалить группу навсегда?')) return;
      await post(`/api/group/${chatId}/delete`,{});
      closeModal('m-grpinfo'); closeChat(); loadChats();
    };

    openModal('m-grpinfo');
  } catch(e){}
}

/* ═══ BIND ALL ═══ */
function bindAll() {
  // Nav
  qa('.nbtn').forEach(b=>b.addEventListener('click',()=>switchTab(b.dataset.t)));
  // Settings subtabs
  qa('.stb').forEach(b=>b.addEventListener('click',()=>{
    qa('.stb').forEach(x=>x.classList.remove('active')); qa('.sc').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); $(`sc-${b.dataset.s}`).classList.add('active');
  }));
  // Chat overlay
  $('cov-back').onclick=closeChat;
  $('cov-info').onclick=()=>{
    const cov=$('cov');
    if(cov.dataset.isGroup==='1') openGroupInfo(+cov.dataset.chatId);
    else if(cov.dataset.otherUser) openProfile(+cov.dataset.otherUser);
  };
  // Click on chat header avatar/name opens profile/info
  $('cav').onclick=$('cinfo-wrap').onclick=$('cov-info').onclick;
  // Send
  $('sendbtn').onclick=doSend;
  $('msginp').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();doSend();}});
  $('msginp').addEventListener('input',()=>{autoR($('msginp'));if(CID&&sock)sock.emit('typing',{chat_id:CID});});
  // File attach
  $('att-btn').onclick=()=>$('f-inp').click();
  $('f-inp').addEventListener('change',e=>{
    const f=e.target.files[0]; if(!f) return;
    selFile=f; $('fprev').classList.remove('hidden');
    $('fp-name').textContent=f.name; $('fp-sz').textContent=fmtSz(f.size);
  });
  $('fp-rm').onclick=clearSel;
  // Voice
  $('voice-btn').addEventListener('mousedown',startRec);
  $('voice-btn').addEventListener('touchstart',e=>{e.preventDefault();startRec();});
  $('voice-btn').addEventListener('mouseup',stopRec);
  $('voice-btn').addEventListener('touchend',e=>{e.preventDefault();stopRec();});
  $('vrec-cancel').onclick=cancelRec;
  // Typing
  let tyT; const tyH=()=>{if(CID&&sock){sock.emit('typing',{chat_id:CID});clearTimeout(tyT);tyT=setTimeout(hideTyping,2500);}};
  // FAB new chat
  $('fab-new').onclick=()=>openModal('m-newchat');
  $('opt-dm').onclick=()=>{closeModal('m-newchat');openModal('m-finduser');};
  $('opt-grp').onclick=()=>{closeModal('m-newchat');openModal('m-newgrp');};
  // Search user
  $('usr-srch').addEventListener('input',debounce(doUsrSrch,300));
  // Create group
  $('grp-create').onclick=doCreateGrp;
  // Chat search
  $('chat-srch').addEventListener('input',e=>{const q=e.target.value.toLowerCase();renderChats(allChats.filter(c=>c.name.toLowerCase().includes(q)));});
  // Settings
  $('av-btn').onclick=()=>$('av-file').click();
  $('av-file').addEventListener('change',doAvUpload);
  $('s-save').onclick=doSaveSettings;
  $('s-out').onclick=doLogout;
  // Add member
  $('add-btn').onclick=async()=>{
    const cid=+$('add-btn').dataset.cid, login=$('add-login').value.trim();
    aerr('add-err','');
    if(!login) return aerr('add-err','Введите логин');
    const r=await post(`/api/group/${cid}/add_member`,{username:login});
    const d=await r.json();
    if(!r.ok) return aerr('add-err',d.error);
    closeModal('m-addmem'); $('add-login').value=''; openGroupInfo(cid);
  };
  // Profile overlay back
  $('prof-back').onclick=closeProfOv;
  // Modal closes
  qa('.mclose').forEach(b=>b.addEventListener('click',()=>closeModal(b.closest('.mover'))));
  qa('.mover').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o);}));
}

/* ═══ SEARCH USERS ═══ */
async function doUsrSrch() {
  const q=$('usr-srch').value.trim(), res=$('usr-res');
  if(!q){res.innerHTML='';return;}
  const d=await(await fetch(`/api/search_users?q=${encodeURIComponent(q)}`)).json();
  if(!d.users.length){res.innerHTML='<p style="color:var(--t2);text-align:center;padding:14px">Не найдено</p>';return;}
  res.innerHTML=d.users.map(u=>`<div class="uri" data-login="${esc(u.username)}">
    ${mkAv(u.avatar_url,u.avatar_color,(u.display_name||u.username)[0]?.toUpperCase(),'md')}
    <div><div class="urn">${esc(u.display_name||u.username)}</div><div class="url">@${esc(u.username)} &bull; ${u.status==='online'?'● В сети':'○ Не в сети'}</div></div>
  </div>`).join('');
  qa('.uri',res).forEach(el=>el.addEventListener('click',async()=>{
    const r=await post('/api/create_direct',{username:el.dataset.login});
    const d=await r.json();
    closeModal('m-finduser'); $('usr-srch').value=''; $('usr-res').innerHTML='';
    await loadChats(); openChat(d.chat_id); switchTab('chats');
  }));
}

async function doCreateGrp() {
  const name=$('grp-name').value.trim();
  aerr('grp-err','');
  if(!name) return aerr('grp-err','Введите название');
  const r=await post('/api/create_group',{name,description:$('grp-desc').value.trim(),members:$('grp-mems').value.split(',').map(s=>s.trim()).filter(Boolean)});
  const d=await r.json();
  if(!r.ok) return aerr('grp-err',d.error);
  closeModal('m-newgrp'); ['grp-name','grp-desc','grp-mems'].forEach(id=>$(id).value='');
  await loadChats(); openChat(d.chat_id); switchTab('chats');
}

/* ═══ SETTINGS ═══ */
function fillSettings() {
  if(!ME) return;
  $('s-dname').value=ME.display_name||ME.username;
  $('s-uname').value=ME.username;
  $('s-bio').value=ME.bio||'';
  $('s-pwd').value='';
  $('p-dname').textContent=ME.display_name||ME.username;
  $('p-login').textContent='@'+ME.username;
  setAvEl($('s-av'),ME,'xl');
  qa('.csw-dot').forEach(s=>s.classList.toggle('on',s.dataset.c===ME.avatar_color));
}

function buildSwatches() {
  const c=$('csw');
  COLORS.forEach(col=>{
    const s=document.createElement('div');
    s.className='csw-dot'; s.style.background=col; s.dataset.c=col;
    s.onclick=()=>{qa('.csw-dot').forEach(x=>x.classList.remove('on'));s.classList.add('on');if(!ME?.avatar_url)$('s-av').style.background=col;};
    c.appendChild(s);
  });
}

async function doAvUpload(e) {
  const f=e.target.files[0]; if(!f) return;
  const fd=new FormData(); fd.append('avatar',f);
  try {
    const r=await fetch('/api/upload_avatar',{method:'POST',body:fd});
    const d=await r.json(); if(!r.ok){sMsg(d.error,false);return;}
    ME=d.user; setAvEl($('s-av'),ME,'xl'); $('p-dname').textContent=ME.display_name||ME.username;
    sMsg('Фото обновлено!',true);
  } finally {e.target.value='';}
}

async function doSaveSettings() {
  const r=await post('/api/update_profile',{
    display_name:$('s-dname').value.trim(), username:$('s-uname').value.trim(),
    bio:$('s-bio').value.trim(), avatar_color:qs('.csw-dot.on')?.dataset.c||ME.avatar_color,
    new_password:$('s-pwd').value||undefined
  });
  const d=await r.json();
  if(!r.ok){sMsg(d.error,false);return;}
  ME=d.user; fillSettings(); loadChats(); sMsg('Сохранено!',true);
}

function sMsg(t,ok){const e=$('smsg');e.textContent=t;e.className=`smsg ${ok?'ok':'err'}`;e.classList.remove('hidden');setTimeout(()=>e.classList.add('hidden'),3000);}

async function doLogout() {
  await post('/api/logout',{});
  ME=null; CID=null; if(sock)sock.disconnect();
  $('app').classList.add('hidden'); $('auth-screen').classList.remove('hidden');
  $('l-user').value=''; $('l-pass').value='';
}

/* ═══ MODAL / OVERLAY HELPERS ═══ */
function openModal(id){$(id).classList.remove('hidden');}
function closeModal(el){if(typeof el==='string')el=$(el);el.classList.add('hidden');}

/* ═══ TYPING ═══ */
let tyT2;
function showTyping(){$('typi').classList.remove('hidden');clearTimeout(tyT2);tyT2=setTimeout(hideTyping,2500);}
function hideTyping(){$('typi').classList.add('hidden');}

/* ═══ LIGHTBOX ═══ */
function lbox(url){const o=document.createElement('div');o.className='lbox';o.innerHTML=`<img src="${url}">`;o.onclick=()=>o.remove();document.body.appendChild(o);}

/* ═══ AVATAR HELPERS ═══ */
function mkAv(url,color,init,size){
  const bg=url?'transparent':color;
  const inner=url?`<img src="${url}" alt="">`:esc(init||'?');
  return `<div class="av ${size}" style="background:${bg}">${inner}</div>`;
}
function setAvEl(el,user,size){
  if(!el) return;
  if(user.avatar_url){el.innerHTML=`<img src="${user.avatar_url}" alt="">`;el.style.background='transparent';}
  else{el.innerHTML=esc((user.display_name||user.username||'?')[0]?.toUpperCase());el.style.background=user.avatar_color;}
}

/* ═══ UTILS ═══ */
function post(url,data){return fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});}
function fmtT(iso){const d=new Date(iso);return d.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'});}
function fmtSz(b){if(!b)return '';if(b<1024)return b+' Б';if(b<1048576)return(b/1024).toFixed(1)+' КБ';return(b/1048576).toFixed(1)+' МБ';}
function fmtDur(s){return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60);}
function ficon(n=''){const e=n.split('.').pop().toLowerCase();const m={pdf:'[PDF]',doc:'[DOC]',docx:'[DOC]',xls:'[XLS]',xlsx:'[XLS]',zip:'[ZIP]',rar:'[RAR]',mp3:'[MP3]',mp4:'[MP4]',txt:'[TXT]',py:'[PY]',js:'[JS]',html:'[HTML]'};return m[e]||'[FILE]';}
function esc(s){if(!s)return '';return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
function scrollBot(sm=true){const c=$('msgs');if(sm)c.scrollTo({top:c.scrollHeight,behavior:'smooth'});else c.scrollTop=c.scrollHeight;}
function autoR(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,110)+'px';}
function debounce(fn,d){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),d);};}
window.lbox=lbox; window.playVox=playVox; window.seekVox=seekVox;
