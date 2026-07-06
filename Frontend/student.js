const sliderConfig = [
  { id: 'anxiety', label: 'Anxiety', min: 1, max: 5, step: 1, value: 3 },
  { id: 'depression', label: 'Depression', min: 1, max: 5, step: 1, value: 3 },
  { id: 'academic_pressure', label: 'Academic Pressure', min: 1, max: 5, step: 1, value: 3 },
  { id: 'study_satisfaction', label: 'Study Satisfaction', min: 1, max: 5, step: 1, value: 3 },
  { id: 'average_sleep', label: 'Average Sleep Hours', min: 2, max: 8, step: 0.5, value: 5 },
  { id: 'social_relationships', label: 'Social Relationships', min: 1, max: 5, step: 1, value: 3 },
  { id: 'academic_workload', label: 'Academic Workload', min: 1, max: 5, step: 1, value: 3 },
  { id: 'financial_concerns', label: 'Financial Concerns', min: 1, max: 5, step: 1, value: 3 },
  { id: 'isolation', label: 'Isolation', min: 1, max: 5, step: 1, value: 3 },
  { id: 'future_insecurity', label: 'Future Insecurity', min: 1, max: 5, step: 1, value: 3 },
];

const state = { username: '' };
let historyTimer = null;
let healthTimer = null;

const sessionPill = document.getElementById('sessionPill');
const logoutBtn = document.getElementById('logoutBtn');
const liveDot = document.getElementById('liveDot');
const liveText = document.getElementById('liveText');
const toastStack = document.getElementById('toastStack');
const mentorName = document.getElementById('mentorName');
const mentorMeta = document.getElementById('mentorMeta');
const sliderContainer = document.getElementById('sliderContainer');
const moodInput = document.getElementById('moodInput');
const predictBtn = document.getElementById('predictBtn');
const resetBtn = document.getElementById('resetBtn');
const loadHistoryBtn = document.getElementById('loadHistoryBtn');
const predictError = document.getElementById('predictError');
const historyTable = document.getElementById('historyTable');
const historyLastSync = document.getElementById('historyLastSync');
const historyTrend = document.getElementById('historyTrend');
const riskBadge = document.getElementById('riskBadge');
const riskLabel = document.getElementById('riskLabel');
const riskInsight = document.getElementById('riskInsight');
const riskMeterText = document.getElementById('riskMeterText');
const riskMeterFill = document.getElementById('riskMeterFill');
const lowBar = document.getElementById('lowBar');
const mediumBar = document.getElementById('mediumBar');
const highBar = document.getElementById('highBar');
const lowProb = document.getElementById('lowProb');
const mediumProb = document.getElementById('mediumProb');
const highProb = document.getElementById('highProb');
const mentalHealth = document.getElementById('mentalHealth');
const academicLoad = document.getElementById('academicLoad');
const lifestyleRisk = document.getElementById('lifestyleRisk');
const socialSupport = document.getElementById('socialSupport');
const suggestionText = document.getElementById('suggestionText');
const insightText = document.getElementById('insightText');
const chatLog = document.getElementById('chatLog');
const chatInput = document.getElementById('chatInput');
const chatSendBtn = document.getElementById('chatSendBtn');

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function sliderMarkup(config) {
  return `
    <div class="slider-card">
      <label for="${config.id}">${config.label}</label>
      <input id="${config.id}" type="range" min="${config.min}" max="${config.max}" step="${config.step}" value="${config.value}" />
      <strong id="${config.id}_value">${Number(config.value).toFixed(config.step === 0.5 ? 1 : 0)}</strong>
      <div class="field-error" id="${config.id}_error" hidden></div>
    </div>
  `;
}

function buildSliders() {
  sliderContainer.innerHTML = sliderConfig.map(sliderMarkup).join('');
  sliderConfig.forEach((item) => {
    const input = document.getElementById(item.id);
    const valueTag = document.getElementById(`${item.id}_value`);
    input.addEventListener('input', () => {
      valueTag.textContent = Number(input.value).toFixed(item.step === 0.5 ? 1 : 0);
    });
  });
}

function payload() {
  const values = Object.fromEntries(sliderConfig.map((s) => [s.id, Number(document.getElementById(s.id).value)]));
  return { ...values, mood: moodInput.value.trim() };
}

function setRisk(label) {
  riskBadge.className = 'risk';
  if (label === 'Low Risk') {
    riskBadge.classList.add('low');
    riskBadge.textContent = 'Low';
  } else if (label === 'Medium Risk') {
    riskBadge.classList.add('medium');
    riskBadge.textContent = 'Medium';
  } else if (label === 'High Risk') {
    riskBadge.classList.add('high');
    riskBadge.textContent = 'High';
  } else {
    riskBadge.classList.add('neutral');
    riskBadge.textContent = 'Awaiting prediction';
  }
}

function setConfidence(probabilities) {
  const low = probabilities.low * 100;
  const med = probabilities.medium * 100;
  const high = probabilities.high * 100;
  lowProb.textContent = `${low.toFixed(2)}%`;
  mediumProb.textContent = `${med.toFixed(2)}%`;
  highProb.textContent = `${high.toFixed(2)}%`;
  lowBar.style.width = `${low}%`;
  mediumBar.style.width = `${med}%`;
  highBar.style.width = `${high}%`;
}

function drawTrend(rows) {
  const width = 420;
  const height = 170;
  const pad = 24;
  if (!rows.length) {
    historyTrend.innerHTML = `<text x="50%" y="50%" fill="#93a9c7" text-anchor="middle" dominant-baseline="middle">No trend data yet</text>`;
    return;
  }
  const pts = rows.slice().reverse().map((row, i, arr) => {
    const x = pad + (i / Math.max(1, arr.length - 1)) * (width - pad * 2);
    const y = height - pad - (Math.max(0, Math.min(1, Number(row.high_prob || 0))) * (height - pad * 2));
    return [x, y];
  });
  const path = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const dots = pts.map(([x, y]) => `<circle cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="2.8" fill="#ff7f7f" />`).join('');
  historyTrend.innerHTML = `
    <line x1="${pad}" y1="${height - pad}" x2="${width - pad}" y2="${height - pad}" stroke="#ffffff26" />
    <line x1="${pad}" y1="${pad}" x2="${pad}" y2="${height - pad}" stroke="#ffffff26" />
    <path d="${path}" fill="none" stroke="#ff7f7f" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" />
    ${dots}
  `;
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

async function predict() {
  predictError.hidden = true;
  clearFieldErrors();
  predictBtn.disabled = true;
  predictBtn.textContent = 'Analyzing...';
  try {
    const response = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    let data;
    try {
      data = await response.json();
    } catch (err) {
      throw new Error('Invalid server response');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        window.location.assign('/');
        return;
      }
      if (response.status === 400 && data.field_errors) {
        // show per-field messages
        showFieldErrors(data.field_errors);
        predictError.hidden = false;
        predictError.innerHTML = 'Validation failed — please fix highlighted fields.';
        showToast('Validation failed', 'error');
        return;
      }
      throw new Error(data.error || 'Prediction failed');
    }

    setRisk(data.label);
    riskLabel.textContent = data.label;
    riskInsight.textContent = data.insight;
    riskMeterText.textContent = `${data.risk_meter}%`;
    riskMeterFill.style.width = `${data.risk_meter}%`;
    setConfidence(data.probabilities);
    mentalHealth.textContent = data.breakdown.mental_health_index.toFixed(2);
    academicLoad.textContent = data.breakdown.academic_load.toFixed(2);
    lifestyleRisk.textContent = data.breakdown.lifestyle_risk.toFixed(2);
    socialSupport.textContent = data.breakdown.social_support.toFixed(2);
    suggestionText.textContent = data.suggestion;
    insightText.textContent = data.insight;
    showToast(`Prediction complete: ${data.label}`, 'success');
    await loadHistory();
  } catch (error) {
    predictError.hidden = false;
    predictError.textContent = error.message;
    showToast(error.message, 'error');
  } finally {
    predictBtn.disabled = false;
    predictBtn.textContent = 'Predict Stress Level';
  }
}

function clearFieldErrors() {
  sliderConfig.forEach((s) => {
    const el = document.getElementById(`${s.id}_error`);
    if (el) {
      el.hidden = true;
      el.textContent = '';
    }
  });
  const moodErr = document.getElementById('mood_error');
  if (moodErr) {
    moodErr.hidden = true;
    moodErr.textContent = '';
  }
}

function showFieldErrors(errors) {
  Object.entries(errors).forEach(([field, msg]) => {
    const el = document.getElementById(`${field}_error`);
    if (el) {
      el.hidden = false;
      el.textContent = Array.isArray(msg) ? msg.join('; ') : String(msg);
    }
  });
}

async function loadHistory() {
  const response = await fetch('/api/history');
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.assign('/');
    }
    return;
  }
  historyLastSync.textContent = nowLabel();
  const rows = data.history || [];
  historyTable.innerHTML = rows.length
    ? rows.map((r) => `<tr><td>${r.created_at || '-'}</td><td>${r.label || '-'}</td><td>${((r.high_prob || 0) * 100).toFixed(1)}%</td><td>${r.mood || '-'}</td><td>${Number(r.stress_score || 0).toFixed(2)}</td></tr>`).join('')
    : '<tr><td colspan="5">No records yet.</td></tr>';
  drawTrend(rows);
}

async function loadMentor() {
  const response = await fetch('/api/student/teacher');
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      window.location.assign('/');
    }
    return;
  }

  const assignment = data.assignment;
  if (!assignment) {
    mentorName.textContent = 'Unassigned';
    mentorMeta.textContent = 'No teacher has been assigned yet.';
    return;
  }

  mentorName.textContent = assignment.teacher_username;
  mentorMeta.textContent = `Assigned on ${assignment.assigned_at}`;
}

function resetSliders() {
  sliderConfig.forEach((item) => {
    const slider = document.getElementById(item.id);
    const valueTag = document.getElementById(`${item.id}_value`);
    slider.value = item.value;
    valueTag.textContent = Number(item.value).toFixed(item.step === 0.5 ? 1 : 0);
  });
  moodInput.value = '';
}

function appendChatBubble(text, who) {
  const bubble = document.createElement('p');
  bubble.className = `chat-bubble ${who}`;
  bubble.textContent = text;
  chatLog.appendChild(bubble);
  chatLog.scrollTop = chatLog.scrollHeight;
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
      body: JSON.stringify({ message, role: 'student' }),
    });
    const data = await response.json();
    appendChatBubble(data.response || 'No response available.', 'bot');
  } catch {
    appendChatBubble('Unable to reach support assistant right now.', 'bot');
  }
}

async function logout() {
  await fetch('/api/logout', { method: 'POST' });
  window.location.assign('/');
}

async function bootstrap() {
  const response = await fetch('/api/session');
  const data = await response.json();
  if (!data.authenticated || data.role !== 'student') {
    window.location.assign('/');
    return;
  }
  state.username = data.username;
  sessionPill.textContent = `STUDENT | ${data.username}`;

  await loadHistory();
  await loadMentor();
  updateHealth();
  historyTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      loadHistory();
      loadMentor();
    }
  }, 20000);
  healthTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      updateHealth();
    }
  }, 10000);
}

predictBtn.addEventListener('click', predict);
loadHistoryBtn.addEventListener('click', loadHistory);
resetBtn.addEventListener('click', resetSliders);
logoutBtn.addEventListener('click', logout);
chatSendBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') sendChat();
});

buildSliders();
appendChatBubble('Hello. I am your support assistant. Ask me about stress, sleep, or exam pressure.', 'bot');
bootstrap();
