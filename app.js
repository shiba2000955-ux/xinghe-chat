const seedConversations = [
  { id: 'zhi', name: '周芷若', handle: '@zhi_ruo', note: '产品设计师', avatar: '周', tone: '', preview: '好的，那我们下午三点同步一下？', time: '10:42', unread: 2, online: true, group: false, messages: [{ author: '周芷若', text: '早上好！昨天的界面方案我又顺了一遍。', time: '10:26', mine: false }, { author: '我', text: '看到了，整体很舒服，层级也更清楚了。', time: '10:31', mine: true }, { author: '周芷若', text: '好的，那我们下午三点同步一下？', time: '10:42', mine: false }] },
  { id: 'team', name: '产品共创组', handle: '@product-lab', note: '12 位成员', avatar: '共', tone: 'group', preview: '陈默：新的用户访谈记录已上传', time: '09:18', unread: 0, online: true, group: true, messages: [{ author: '陈默', text: '新的用户访谈记录已上传，大家午休前看一下。', time: '09:18', mine: false }] },
  { id: 'chen', name: '陈默', handle: '@chenmo', note: '内容策略', avatar: '陈', tone: 'orange', preview: '文件 · 用户访谈记录.pdf', time: '昨天', unread: 0, online: false, group: false, messages: [{ author: '我', text: '访谈记录收到了，谢谢。', time: '昨天', mine: true }] },
  { id: 'studio', name: '周末工作室', handle: '@weekend-studio', note: '5 位成员', avatar: '周', tone: 'blue', preview: '林夏：这个周末见！', time: '周日', unread: 4, online: true, group: true, messages: [{ author: '林夏', text: '这个周末见！我带一台拍立得过去。', time: '周日', mine: false }] },
  { id: 'lin', name: '林夏', handle: '@linxia', note: '摄影师', avatar: '林', tone: 'purple', preview: '你：下次一起去看展吧', time: '周六', unread: 0, online: false, group: false, messages: [{ author: '我', text: '下次一起去看展吧。', time: '周六', mine: true }] }
];
const seedContacts = [
  { id: 'zhi', name: '周芷若', handle: '@zhi_ruo', note: '产品设计师', avatar: '周', tone: '', online: true, relation: '好友' },
  { id: 'chen', name: '陈默', handle: '@chenmo', note: '内容策略', avatar: '陈', tone: 'orange', online: false, relation: '好友' },
  { id: 'lin', name: '林夏', handle: '@linxia', note: '摄影师', avatar: '林', tone: 'purple', online: false, relation: '好友' },
  { id: 'miao', name: '苗苗', handle: '@miaomiao', note: '城市漫游者', avatar: '苗', tone: 'blue', online: true, relation: '待处理' }
];
const defaultProfile = { name: '林舟', handle: '@linzhou', bio: '保持好奇，认真生活', avatar: '林', avatarUrl: '' };
const state = { conversations: load('nova-conversations', seedConversations), contacts: load('nova-contacts', seedContacts), profile: load('nova-profile', defaultProfile), settings: load('nova-settings', { notifications: true, sounds: true, networkUrl: '' }), activeId: 'zhi', filter: 'all', query: '' };
let currentUser = JSON.parse(localStorage.getItem('nova-user') || 'null');
let authToken = localStorage.getItem('nova-token') || '';
let socket = null;
let quoteMessage = null;
let peerConnection = null;
let localStream = null;
const $ = selector => document.querySelector(selector);
const list = $('#conversationList');
function load(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; } }
function save(key, value) { localStorage.setItem(key, JSON.stringify(value)); }
function persist() { save('nova-conversations', state.conversations); save('nova-contacts', state.contacts); save('nova-profile', state.profile); save('nova-settings', state.settings); }
function activeConversation() { return state.conversations.find(item => item.id === state.activeId) || state.conversations[0]; }
function avatarClass(item) { return `avatar ${item.tone || ''}`; }
function renderAvatar(item) { return item.avatarUrl ? `<img src="${item.avatarUrl}" alt="头像" />` : item.avatar; }
function renderList() {
  const query = state.query.toLowerCase();
  const items = state.conversations.filter(item => `${item.name} ${item.preview}`.toLowerCase().includes(query) && (state.filter === 'all' || (state.filter === 'unread' && item.unread) || (state.filter === 'groups' && item.group)));
  list.innerHTML = items.length ? items.map(item => `<article class="conversation ${item.id === state.activeId ? 'selected' : ''}" data-id="${item.id}"><div class="${avatarClass(item)}">${renderAvatar(item)}</div><div><div class="conversation-name">${escapeHtml(item.name)}${item.online ? '<span class="online-dot"></span>' : ''}</div><p class="conversation-preview">${escapeHtml(item.preview)}</p></div><div class="conversation-meta"><span>${item.time}</span>${item.unread ? `<b class="unread-pill">${item.unread}</b>` : ''}</div></article>`).join('') : '<div class="empty-state">没有找到匹配的会话</div>';
  document.querySelectorAll('.conversation').forEach(item => item.addEventListener('click', () => selectConversation(item.dataset.id)));
  $('#allCount').textContent = state.conversations.length; $('#unreadCount').textContent = state.conversations.reduce((total, item) => total + (item.unread ? 1 : 0), 0);
}
function renderChat() {
  const item = activeConversation(); if (!item) return;
  ['activeAvatar', 'detailsAvatar'].forEach(id => { const node = $(`#${id}`); node.innerHTML = renderAvatar(item); node.className = `${avatarClass(item)} ${id === 'activeAvatar' ? 'avatar-large' : 'details-avatar avatar-xl'}`; });
  $('#activeName').textContent = item.name; $('#activeStatus').innerHTML = item.online ? '<span class="online-dot"></span> 在线，回复很快' : `<span>${escapeHtml(item.note)}</span>`;
  $('#detailsName').textContent = item.name; $('#detailsHandle').textContent = `${item.handle} · ${item.group ? item.note : '武汉'}`; $('#detailsNote').textContent = item.note;
  $('#messageArea').innerHTML = `<div class="date-divider">今天</div>${item.messages.map((message, index) => `<div class="message-row ${message.mine ? 'mine' : ''}" data-message-index="${index}">${message.mine ? '' : `<div class="${avatarClass(item)} message-avatar">${renderAvatar(item)}</div>`}<div class="bubble-wrap">${message.author && !message.mine ? `<div class="message-author">${escapeHtml(message.author)}</div>` : ''}${message.deleted ? '<div class="bubble deleted-message">这条消息已撤回</div>' : message.attachment ? `<a class="file-bubble" href="${message.attachment.dataUrl || '#'}" download="${escapeHtml(message.attachment.name)}">📎 <strong>${escapeHtml(message.attachment.name)}</strong><small>${formatBytes(message.attachment.size)} · 下载文件</small></a>` : `<div class="bubble">${message.quote ? `<small class="quoted-message">引用：${escapeHtml(message.quote.text)}</small>` : ''}${escapeHtml(message.text).replace(/\n/g, '<br>')}</div>`}<div class="message-time">${message.time}${message.mine ? ' · 已送达' : ''}</div></div></div>`).join('')}`;
  document.querySelectorAll('[data-message-index]').forEach(row => row.addEventListener('contextmenu', event => { event.preventDefault(); messageActions(Number(row.dataset.messageIndex)); }));
  $('#messageArea').scrollTop = $('#messageArea').scrollHeight;
}
function selectConversation(id) { state.activeId = id; const item = activeConversation(); item.unread = 0; persist(); renderList(); renderChat(); document.querySelector('.app-shell').classList.add('mobile-chat-open'); }
function escapeHtml(text) { return String(text).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function formatBytes(bytes) { if (!bytes) return '0 B'; if (bytes < 1024) return `${bytes} B`; if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`; return `${(bytes / 1024 / 1024).toFixed(1)} MB`; }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('show'); clearTimeout(window.toastTimer); window.toastTimer = setTimeout(() => toast.classList.remove('show'), 2400); }
async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), 'X-Auth-Token': authToken };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { ...options, headers });
  const raw = await response.text();
  let result = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = { error: `服务器返回了无效响应（HTTP ${response.status}）` }; }
  if (response.status === 401) {
    localStorage.removeItem('nova-token'); localStorage.removeItem('nova-user');
    authToken = ''; currentUser = null;
    if (socket) { socket.close(); socket = null; }
    $('#authScreen').hidden = false;
    showToast('登录已失效，请重新登录');
  }
  if (!response.ok) throw new Error(result.error || '网络请求失败');
  return result;
}
async function syncContacts() {
  if (!authToken) return;
  const result = await apiFetch('/api/contacts');
  state.contacts = result.contacts.map(contact => ({
    id: `remote-${contact.username}`, name: contact.name, handle: `@${contact.username}`,
    note: contact.relation === '待处理' ? '好友申请' : '已添加好友', avatar: contact.name.slice(0, 1),
    tone: 'blue', online: false, relation: contact.relation, requestId: contact.requestId,
    username: contact.username
  }));
  save('nova-contacts', state.contacts);
}
async function loadHistory() {
  if (!authToken || !currentUser) return;
  const result = await apiFetch('/api/history');
  result.messages.forEach(message => {
    const other = message.sender === currentUser.username ? message.recipient : message.sender;
    const item = state.conversations.find(conversation => String(conversation.handle || '').replace(/^@/, '') === other)
      || state.contacts.find(contact => String(contact.handle || '').replace(/^@/, '') === other);
    if (!item) return;
    let conversation = state.conversations.find(entry => entry.id === item.id);
    if (!conversation) {
      conversation = { ...item, preview: '', time: '刚刚', unread: 0, group: false, messages: [] };
      state.conversations.unshift(conversation);
    }
    const exists = conversation.messages.some(entry => entry.text === message.body && entry.serverTime === message.created_at);
    const attachment = message.body.startsWith('__attachment__') ? JSON.parse(message.body.slice(15)) : null;
    if (!exists) conversation.messages.push({ author: message.sender === currentUser.username ? state.profile.name : conversation.name, text: attachment ? attachment.name : message.body, attachment, time: new Date(`${message.created_at}Z`).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), serverTime: message.created_at, mine: message.sender === currentUser.username });
    conversation.preview = message.body; conversation.time = '刚刚';
  });
  persist(); renderList(); renderChat();
}
function openModal(title, body) { $('#modalTitle').textContent = title; $('#modalBody').innerHTML = body; $('#modalBackdrop').hidden = false; }
function closeModal() { $('#modalBackdrop').hidden = true; }
function sendMessage() {
  const input = $('#messageInput'); const text = input.value.trim(); if (!text) return;
  const item = activeConversation(); const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  const recipient = String(item.handle || '').replace(/^@/, '');
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'message', recipient, body: text, quote: quoteMessage }));
  }
  item.messages.push({ author: state.profile.name, text, time, mine: true, quote: quoteMessage }); quoteMessage = null;
  item.preview = text; item.time = '刚刚'; input.value = ''; input.style.height = '32px';
  persist(); renderList(); renderChat();
}
function messageActions(index) {
  const item = activeConversation(); const message = item.messages[index]; if (!message) return;
  openModal('消息操作', `<div class="message-action-list"><button id="quoteAction">引用回复</button>${message.mine && !message.deleted ? '<button id="retractAction">撤回消息</button>' : ''}</div>`);
  $('#quoteAction').addEventListener('click', () => { quoteMessage = message; $('#messageInput').focus(); closeModal(); showToast('已引用消息'); });
  if ($('#retractAction')) $('#retractAction').addEventListener('click', () => {
    message.deleted = true; message.text = ''; if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'retract', recipient: String(item.handle || '').replace(/^@/, ''), index }));
    persist(); renderChat(); closeModal(); showToast('消息已撤回');
  });
}
async function startCall(video) {
  const item = activeConversation(); if (!item || !socket || socket.readyState !== WebSocket.OPEN) return showToast('实时连接未建立');
  try { localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video }); } catch { return showToast('请允许浏览器使用麦克风或摄像头'); }
  peerConnection = new RTCPeerConnection(); localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = event => { $('#remoteVideo').srcObject = event.streams[0]; };
  peerConnection.onicecandidate = event => { if (event.candidate) socket.send(JSON.stringify({ type: 'call-signal', recipient: String(item.handle).replace(/^@/, ''), signal: { candidate: event.candidate } })); };
  const offer = await peerConnection.createOffer(); await peerConnection.setLocalDescription(offer);
  socket.send(JSON.stringify({ type: 'call-signal', recipient: String(item.handle).replace(/^@/, ''), signal: { offer, video } }));
  $('#callOverlay').hidden = false; $('#callTitle').textContent = `呼叫 ${item.name}`; $('#localVideo').srcObject = localStream; $('#acceptCallBtn').hidden = true;
}
function endCall() { if (peerConnection) peerConnection.close(); if (localStream) localStream.getTracks().forEach(track => track.stop()); peerConnection = null; localStream = null; $('#localVideo').srcObject = null; $('#remoteVideo').srcObject = null; $('#callOverlay').hidden = true; }
function insertText(text) {
  const input = $('#messageInput'); const start = input.selectionStart; const end = input.selectionEnd;
  input.value = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`; input.focus(); input.selectionStart = input.selectionEnd = start + text.length;
}
function openStickerPicker() {
  openModal('选择表情', `<div class="emoji-grid">${['😀','😄','😂','😊','😍','🤔','😎','😭','😡','👍','👏','🎉','❤️','✨','🔥','🙏','🌈','☕','🎵','🚀','💡','🙌','🤝','👋'].map(item => `<button class="emoji-choice" data-emoji="${item}">${item}</button>`).join('')}</div>`);
  document.querySelectorAll('[data-emoji]').forEach(button => button.addEventListener('click', () => { insertText(button.dataset.emoji); closeModal(); }));
}
function openNoteEditor() {
  const item = activeConversation(); if (!item) return;
  openModal('设置备注', `<div class="modal-section"><label class="modal-label">联系人备注</label><input class="modal-input" id="noteInput" value="${escapeHtml(item.note || '')}" maxlength="40" placeholder="例如：大学同学" /><div class="modal-actions"><button class="modal-btn primary" id="saveNote">保存备注</button></div>`);
  $('#saveNote').addEventListener('click', () => {
    item.note = $('#noteInput').value.trim() || '暂无备注';
    const contact = state.contacts.find(entry => entry.id === item.id || entry.username === String(item.handle || '').replace(/^@/, ''));
    if (contact) contact.note = item.note;
    persist(); renderChat(); closeModal(); showToast('备注已保存');
  });
}
function sendFile(file) {
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) return showToast('文件不能超过 2 MB');
  const reader = new FileReader();
  reader.onload = () => {
    const item = activeConversation(); const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    const attachment = { name: file.name, size: file.size, type: file.type || 'application/octet-stream', dataUrl: reader.result };
    const payload = { type: 'message', recipient: String(item.handle || '').replace(/^@/, ''), body: `__attachment__${JSON.stringify(attachment)}` };
    if (!socket || socket.readyState !== WebSocket.OPEN) return showToast('实时连接未建立，暂时无法发送文件');
    socket.send(JSON.stringify(payload));
    item.messages.push({ author: state.profile.name, text: file.name, attachment, time, mine: true });
    item.preview = `文件 · ${file.name}`; item.time = '刚刚'; persist(); renderList(); renderChat(); showToast('文件已发送');
  };
  reader.readAsDataURL(file);
}
function bindContactActions() {
  $('#findContact').addEventListener('click', findContact);
  $('#contactSearch').addEventListener('keydown', event => { if (event.key === 'Enter') findContact(); });
  document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
    const contact = state.contacts.find(item => item.id === button.dataset.id);
    if (!contact) return;
    try {
      if ((button.dataset.action === 'accept' || button.dataset.action === 'reject') && contact.requestId) {
        await apiFetch(`/api/friend-requests/${contact.requestId}`, { method: 'POST', body: JSON.stringify({ action: button.dataset.action }) });
      } else if (button.dataset.action === 'accept') {
        contact.relation = '好友';
      } else if (button.dataset.action === 'reject') {
        state.contacts = state.contacts.filter(item => item.id !== contact.id);
      } else if (button.dataset.action === 'chat') {
        ensureConversation(contact.id); closeModal(); return;
      }
      await syncContacts(); persist(); openContacts(); showToast(button.dataset.action === 'accept' ? '已添加为好友' : '已忽略好友申请');
    } catch (error) { showToast(error.message); }
  }));
}
async function openContacts() {
  try { await syncContacts(); } catch (error) { showToast(error.message); }
  openModal('联系人', `<div class="modal-section"><label class="modal-label">搜索用户或账号 ID</label><input class="modal-input" id="contactSearch" placeholder="例如：someone" /><div class="modal-actions"><button class="modal-btn primary" id="findContact">查找并添加</button></div></div><div class="modal-section"><label class="modal-label">我的联系人</label><div id="contactRows">${renderContactRows()}</div></div>`);
  bindContactActions();
}
function renderContactRows() { return state.contacts.map(contact => `<div class="request-row"><div class="${avatarClass(contact)}">${renderAvatar(contact)}</div><div><strong>${escapeHtml(contact.name)}</strong><small>${escapeHtml(contact.handle)} · ${escapeHtml(contact.note)}</small></div>${contact.relation === '待处理' ? `<div class="request-actions"><button data-action="accept" data-id="${contact.id}">同意</button><button data-action="reject" data-id="${contact.id}">忽略</button></div>` : contact.relation === '已发送' ? '<small>等待对方同意</small>' : `<div class="request-actions"><button data-action="chat" data-id="${contact.id}">聊天</button></div>`}</div>`).join('') || '<div class="empty-state">还没有联系人</div>'; }
async function findContact() {
  const query = $('#contactSearch').value.trim().replace(/^@/, '');
  if (!query) return showToast('请输入账号 ID');
  try {
    await apiFetch('/api/friend-requests', { method: 'POST', body: JSON.stringify({ username: query }) });
    await syncContacts(); openContacts(); showToast('好友申请已发送');
  } catch (error) { showToast(error.message); }
}
function openNewChat() { openModal('新建会话', `<div class="modal-section"><label class="modal-label">选择联系人</label><div class="modal-grid">${state.contacts.filter(item => item.relation === '好友').map(item => `<button class="modal-card" data-chat-id="${item.id}"><div class="${avatarClass(item)}">${renderAvatar(item)}</div><div><h4>${escapeHtml(item.name)}</h4><p>${escapeHtml(item.handle)}</p></div></button>`).join('')}</div></div><div class="modal-actions"><button class="modal-btn" id="newGroupBtn">创建群组</button></div>`); document.querySelectorAll('[data-chat-id]').forEach(button => button.addEventListener('click', () => { ensureConversation(button.dataset.chatId); closeModal(); })); $('#newGroupBtn').addEventListener('click', createGroup); }
function ensureConversation(id) { const contact = state.contacts.find(item => item.id === id); if (!contact) return; if (!state.conversations.some(item => item.id === id)) state.conversations.unshift({ ...contact, preview: '开始新的聊天吧', time: '刚刚', unread: 0, group: false, messages: [] }); state.activeId = id; persist(); renderList(); renderChat(); }
function createGroup() { const id = `group-${Date.now()}`; state.conversations.unshift({ id, name: '新建群组', handle: '@new-group', note: '仅自己', avatar: '群', tone: 'group', preview: '群组已创建', time: '刚刚', unread: 0, online: true, group: true, messages: [] }); state.activeId = id; persist(); closeModal(); renderList(); renderChat(); showToast('群组已创建'); }
function openProfile() { const profile = state.profile; openModal('我的资料', `<div class="profile-editor"><div class="profile-avatar" id="profileAvatar">${profile.avatarUrl ? `<img src="${profile.avatarUrl}" alt="头像" />` : escapeHtml(profile.avatar)}<button class="avatar-change" id="changeAvatar">＋</button></div><div><strong>${escapeHtml(profile.name)}</strong><div class="network-badge"><span class="status-dot"></span> 已登录本机账号</div></div></div><div class="modal-section"><label class="modal-label">昵称</label><input class="modal-input" id="profileName" value="${escapeHtml(profile.name)}" /></div><div class="modal-section"><label class="modal-label">个性签名</label><input class="modal-input" id="profileBio" value="${escapeHtml(profile.bio)}" /></div><div class="modal-section"><label class="modal-label">账号 ID</label><input class="modal-input" id="profileHandle" value="${escapeHtml(profile.handle)}" /></div><div class="modal-actions"><button class="modal-btn primary" id="saveProfile">保存资料</button></div>`); $('#changeAvatar').addEventListener('click', () => $('#avatarInput').click()); $('#saveProfile').addEventListener('click', saveProfile); }
function saveProfile() { state.profile.name = $('#profileName').value.trim() || state.profile.name; state.profile.bio = $('#profileBio').value.trim(); state.profile.handle = $('#profileHandle').value.trim() || state.profile.handle; document.querySelector('.profile-mini').textContent = state.profile.avatar || '林'; persist(); closeModal(); showToast('个人资料已保存'); }
function openSettings() { const settings = state.settings; openModal('设置', `<div class="modal-section"><div class="setting-row"><div><span>新消息通知</span><small>收到好友消息时提醒</small></div><button class="switch ${settings.notifications ? 'on' : ''}" data-setting="notifications"></button></div><div class="setting-row"><div><span>提示音</span><small>发送和接收消息音效</small></div><button class="switch ${settings.sounds ? 'on' : ''}" data-setting="sounds"></button></div></div><div class="modal-section"><label class="modal-label">网络服务地址</label><input class="modal-input" id="networkUrl" value="${escapeHtml(settings.networkUrl)}" placeholder="https://your-server.example.com" /><div class="network-badge ${settings.networkUrl ? '' : 'offline'}"><span class="status-dot"></span>${settings.networkUrl ? '已配置同步地址' : '当前为本机离线模式'}</div></div><div class="modal-actions"><button class="modal-btn" id="exportData">导出数据</button><button class="modal-btn danger" id="clearData">清空本机数据</button><button class="modal-btn primary" id="saveSettings">保存设置</button></div>`); document.querySelectorAll('[data-setting]').forEach(button => button.addEventListener('click', () => { const key = button.dataset.setting; settings[key] = !settings[key]; button.classList.toggle('on', settings[key]); })); $('#saveSettings').addEventListener('click', () => { settings.networkUrl = $('#networkUrl').value.trim(); persist(); closeModal(); showToast(settings.networkUrl ? '网络同步地址已保存' : '设置已保存'); }); $('#exportData').addEventListener('click', exportData); $('#clearData').addEventListener('click', clearData); }
function exportData() { const blob = new Blob([JSON.stringify({ profile: state.profile, contacts: state.contacts, conversations: state.conversations }, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'nova-messenger-backup.json'; link.click(); URL.revokeObjectURL(link.href); showToast('数据备份已下载'); }
function clearData() { if (!confirm('确定清空本机消息和联系人吗？')) return; ['nova-conversations', 'nova-contacts', 'nova-profile', 'nova-settings'].forEach(key => localStorage.removeItem(key)); location.reload(); }
$('#sendBtn').addEventListener('click', sendMessage); $('#messageInput').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); } }); $('#messageInput').addEventListener('input', event => { event.target.style.height = '32px'; event.target.style.height = `${Math.min(event.target.scrollHeight, 115)}px`; }); $('#searchInput').addEventListener('input', event => { state.query = event.target.value; renderList(); });
document.querySelectorAll('.filter-tab').forEach(tab => tab.addEventListener('click', () => { document.querySelectorAll('.filter-tab').forEach(node => node.classList.remove('active')); tab.classList.add('active'); state.filter = tab.dataset.filter; renderList(); }));
document.querySelectorAll('.rail-btn[data-view]').forEach(button => button.addEventListener('click', () => { document.querySelectorAll('.rail-btn').forEach(node => node.classList.remove('active')); button.classList.add('active'); if (button.dataset.view === 'contacts') openContacts(); if (button.dataset.view === 'files') showToast('文件中心：可在聊天中使用附件按钮'); if (button.dataset.view === 'chats') closeModal(); }));
$('#newChatBtn').addEventListener('click', openNewChat); $('#detailsClose').addEventListener('click', () => { $('#detailsPanel').style.display = 'none'; }); $('#moreBtn').addEventListener('click', () => { $('#detailsPanel').style.display = ''; showToast('已打开会话详情'); }); $('#callBtn').addEventListener('click', () => startCall(false)); $('#messageSearchBtn').addEventListener('click', () => { $('#searchInput').focus(); showToast('可搜索当前会话'); }); $('#settingsBtn').addEventListener('click', openSettings); $('.profile-mini').addEventListener('click', openProfile); $('#modalClose').addEventListener('click', closeModal); $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); }); $('#mobileBackBtn').addEventListener('click', () => document.querySelector('.app-shell').classList.remove('mobile-chat-open'));
$('#hangupBtn').addEventListener('click', endCall);
$('#stickerBtn').addEventListener('click', openStickerPicker); $('#attachBtn').addEventListener('click', () => $('#fileInput').click()); $('#imageBtn').addEventListener('click', () => { $('#fileInput').accept = 'image/*'; $('#fileInput').click(); }); $('#fileInput').addEventListener('change', event => { sendFile(event.target.files[0]); event.target.value = ''; }); $('#detailsNote').addEventListener('click', openNoteEditor);
$('#avatarInput').addEventListener('change', event => { const file = event.target.files[0]; if (!file) return; const reader = new FileReader(); reader.onload = () => { state.profile.avatarUrl = reader.result; state.profile.avatar = ''; persist(); openProfile(); showToast('头像已更新'); }; reader.readAsDataURL(file); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#searchInput').focus(); } });
async function authenticate(mode, username, password, name) {
  const response = await fetch(`/api/${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, name }) });
  const raw = await response.text();
  let result;
  try { result = JSON.parse(raw); } catch { throw new Error(`服务器暂时不可用（HTTP ${response.status}）`); }
  if (!response.ok) throw new Error(result.error || '登录失败');
  authToken = result.token; currentUser = result.user; localStorage.setItem('nova-token', authToken); localStorage.setItem('nova-user', JSON.stringify(currentUser)); state.profile.name = currentUser.name; state.profile.handle = `@${currentUser.username}`; persist(); await syncContacts(); await loadHistory(); connectSocket(); $('#authScreen').hidden = true;
}
function connectSocket() {
  if (!authToken) return;
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?token=${encodeURIComponent(authToken)}`);
  socket.addEventListener('open', () => { const status = document.querySelector('.sync-label'); if (status) status.textContent = '实时在线'; showToast('已连接到实时消息服务'); });
  socket.addEventListener('message', event => {
    const payload = JSON.parse(event.data);
    if (payload.sender === currentUser.username) return;
    if (payload.type === 'call-signal') { handleCallSignal(payload); return; }
    const sender = String(payload.sender).replace(/^@/, '');
    const item = state.conversations.find(conversation => String(conversation.handle || '').replace(/^@/, '') === sender)
      || state.contacts.find(contact => String(contact.handle || '').replace(/^@/, '') === sender);
    if (!item) return;
    let conversation = state.conversations.find(entry => entry.id === item.id);
    if (!conversation) {
      conversation = { ...item, preview: '', time: '刚刚', unread: 0, group: false, messages: [] };
      state.conversations.unshift(conversation);
    }
    if (payload.type === 'retract') { if (conversation.messages[payload.index]) conversation.messages[payload.index].deleted = true; persist(); renderChat(); return; }
    if (payload.type !== 'message' || !payload.body) return;
    let attachment = null;
    if (payload.body.startsWith('__attachment__')) { try { attachment = JSON.parse(payload.body.slice(15)); } catch { showToast('收到的附件无法读取'); } }
    conversation.messages.push({ author: conversation.name, text: attachment ? attachment.name : payload.body, quote: payload.quote, attachment, time: new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }), mine: false });
    conversation.preview = attachment ? `文件 · ${attachment.name}` : payload.body; conversation.time = '刚刚';
    if (state.activeId !== conversation.id) conversation.unread = (conversation.unread || 0) + 1;
    persist(); renderList(); renderChat();
  });
  socket.addEventListener('close', () => { const status = document.querySelector('.sync-label'); if (status) status.textContent = '连接断开'; });
}
async function handleCallSignal(payload) {
  const signal = payload.signal; if (!signal) return;
  if (signal.offer) { $('#callOverlay').hidden = false; $('#callTitle').textContent = '收到通话邀请'; $('#callStatus').textContent = '对方邀请你通话'; $('#acceptCallBtn').hidden = false; $('#acceptCallBtn').onclick = async () => { peerConnection = new RTCPeerConnection(); localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: signal.video }); localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream)); peerConnection.ontrack = event => { $('#remoteVideo').srcObject = event.streams[0]; }; await peerConnection.setRemoteDescription(signal.offer); const answer = await peerConnection.createAnswer(); await peerConnection.setLocalDescription(answer); socket.send(JSON.stringify({ type: 'call-signal', recipient: payload.sender, signal: { answer } })); $('#acceptCallBtn').hidden = true; $('#localVideo').srcObject = localStream; }; }
  if (signal.answer && peerConnection) await peerConnection.setRemoteDescription(signal.answer);
  if (signal.candidate && peerConnection) await peerConnection.addIceCandidate(signal.candidate);
}
function initAuth() {
  let mode = 'login';
  const nameLabel = $('.auth-name-label'); const nameInput = $('.auth-name-input');
  document.querySelectorAll('[data-auth-mode]').forEach(tab => tab.addEventListener('click', () => { mode = tab.dataset.authMode; document.querySelectorAll('[data-auth-mode]').forEach(node => node.classList.toggle('active', node === tab)); const register = mode === 'register'; nameLabel.hidden = !register; nameInput.hidden = !register; $('#authSubmit').textContent = register ? '注册并进入' : '登录并进入'; }));
  $('#authForm').addEventListener('submit', async event => { event.preventDefault(); $('#authError').textContent = ''; $('#authSubmit').disabled = true; try { await authenticate(mode, $('#authUsername').value.trim(), $('#authPassword').value, $('#authName').value.trim()); } catch (error) { $('#authError').textContent = error.message; } finally { $('#authSubmit').disabled = false; } });
  if (authToken && currentUser) { $('#authScreen').hidden = true; syncContacts().then(loadHistory).catch(() => {}); connectSocket(); } else { $('#authScreen').hidden = false; }
}
renderList(); renderChat(); initAuth();
