let dashboardTimer = null;
let healthTimer = null;

const sessionPill = document.getElementById('sessionPill');
const logoutBtn = document.getElementById('logoutBtn');
const refreshDashboardBtn = document.getElementById('refreshDashboardBtn');
const teacherTable = document.getElementById('teacherTable');
const dashboardLastSync = document.getElementById('dashboardLastSync');
const kpiTotal = document.getElementById('kpiTotal');
const kpiHigh = document.getElementById('kpiHigh');
const kpiMedium = document.getElementById('kpiMedium');
const kpiLow = document.getElementById('kpiLow');
const kpiAvgHigh = document.getElementById('kpiAvgHigh');
const liveDot = document.getElementById('liveDot');
const liveText = document.getElementById('liveText');
const toastStack = document.getElementById('toastStack');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function appendChatBubble(text, who) {
  const bubble = document.createElement('p');
  bubble.className = `chat-bubble ${who}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
}

async function updateHealth() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    liveDot.classList.add('online');
    liveDot.classList.remove('offline');
    liveText.textContent = `Server online · ${nowLabel()}`;
  } catch {
    liveDot.classList.remove('online');
    liveDot.classList.add('offline');
    liveText.textContent = 'Server offline';
  }
}

async function refreshDashboard() {
  const response = await fetch('/api/teacher/dashboard');
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.assign('/');
      return;
    }
    showToast(data.error || 'Dashboard fetch failed', 'error');
    return;
  }

  dashboardLastSync.textContent = nowLabel();
  const summary = data.summary || {};
  kpiTotal.textContent = summary.total_predictions || 0;
  kpiHigh.textContent = summary.high_risk_count || 0;
  kpiMedium.textContent = summary.medium_risk_count || 0;
  kpiLow.textContent = summary.low_risk_count || 0;
  kpiAvgHigh.textContent = `${((summary.avg_high_probability || 0) * 100).toFixed(1)}%`;

  const rows = data.recent_predictions || [];
  teacherTable.innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${r.username || '-'}</td><td>${r.label || '-'}</td><td>${((r.high_prob || 0) * 100).toFixed(1)}%</td><td>${r.mood || '-'}</td><td>${r.created_at || '-'}</td></tr>`).join('')
    : '<tr><td colspan="5">No records for assigned students yet.</td></tr>';
}

async function sendChat() {
  const message = chatInput.value.trim();
  if (!message) return;
  appendChatBubble(message, 'user');
  chatInput.value = '';
  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, role: 'teacher' }),
    });
    const data = await response.json();
    appendChatBubble(data.response || 'No response available.', 'bot');
  } catch {
    appendChatBubble('Unable to reach support assistant right now.', 'bot');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  showToast('Logged out', 'warn');
  window.location.assign('/');
}

async function bootstrap() {
  const response = await fetch('/api/session');
  const data = await response.json();
  if (!data.authenticated || data.role !== 'teacher') {
    window.location.assign('/');
    return;
  }
  sessionPill.textContent = `TEACHER | ${data.username}`;

  await refreshDashboard();
  updateHealth();
  dashboardTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshDashboard();
    }
  }, 15000);
  healthTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      updateHealth();
    }
  }, 10000);
}

refreshDashboardBtn.addEventListener('click', refreshDashboard);
logoutBtn.addEventListener('click', logout);
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendChat();
});

appendChatBubble('Teacher assistant is online. Ask for intervention ideas or stress reduction strategies.', 'bot');
bootstrap();
