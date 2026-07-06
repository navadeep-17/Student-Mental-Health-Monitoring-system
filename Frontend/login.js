const roleStudent = document.getElementById('roleStudent');
const roleTeacher = document.getElementById('roleTeacher');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginMessage = document.getElementById('loginMessage');
const toastStack = document.getElementById('toastStack');

let selectedRole = 'student';

function showToast(message, kind = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.textContent = message;
  toastStack.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

function setRole(role) {
  selectedRole = role;
  roleStudent.classList.toggle('active', role === 'student');
  roleTeacher.classList.toggle('active', role === 'teacher');
}

async function login() {
  loginMessage.textContent = '';
  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: selectedRole,
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    showToast(`Welcome ${data.username}`, 'success');
    window.location.assign(data.role === 'teacher' ? '/teacher' : '/student');
  } catch (error) {
    loginMessage.textContent = error.message;
    showToast(error.message, 'error');
  }
}

async function bootstrapSession() {
  try {
    const response = await fetch('/api/session');
    const data = await response.json();
    if (data.authenticated) {
      window.location.assign(data.role === 'teacher' ? '/teacher' : '/student');
    }
  } catch (error) {
    // no-op
  }
}

roleStudent.addEventListener('click', () => setRole('student'));
roleTeacher.addEventListener('click', () => setRole('teacher'));
loginBtn.addEventListener('click', login);
passwordInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    login();
  }
});

bootstrapSession();
