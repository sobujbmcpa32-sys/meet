// ======================================================
// ZoomClone - Main App (auth + dashboard)
// ======================================================

const API = '/api'
let currentUser = null
let authToken = null

// ── Helpers ──────────────────────────────────────────
function getToken() { return localStorage.getItem('zc_token') }
function setToken(t) { localStorage.setItem('zc_token', t) }
function removeToken() { localStorage.removeItem('zc_token') }
function getUser() { return JSON.parse(localStorage.getItem('zc_user') || 'null') }
function setUser(u) { localStorage.setItem('zc_user', JSON.stringify(u)) }
function removeUser() { localStorage.removeItem('zc_user') }

async function apiFetch(path, opts = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) }
  if (token) headers['Authorization'] = 'Bearer ' + token
  const res = await fetch(API + path, { ...opts, headers })
  return res
}

function showToast(msg, type = 'info') {
  const icons = { success: 'fa-check-circle text-green-400', error: 'fa-times-circle text-red-400', info: 'fa-info-circle text-indigo-400', warning: 'fa-exclamation-triangle text-yellow-400' }
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.innerHTML = `<i class="fas ${icons[type] || icons.info}"></i><span>${msg}</span>`
  document.body.appendChild(t)
  setTimeout(() => { t.style.animation = 'slideOutRight 0.3s ease forwards'; setTimeout(() => t.remove(), 300) }, 3500)
}

function formatDate(d) {
  if (!d) return ''
  return new Date(d).toLocaleString('bn-BD', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── App Render ────────────────────────────────────────
async function initApp() {
  const appEl = document.getElementById('app')
  const token = getToken()
  if (!token) { renderAuth(appEl); return }

  // Verify token
  const res = await apiFetch('/auth/me')
  if (!res.ok) { removeToken(); removeUser(); renderAuth(appEl); return }
  const data = await res.json()
  currentUser = data.user
  setUser(currentUser)
  renderDashboard(appEl)
}

// ── AUTH PAGE ─────────────────────────────────────────
function renderAuth(container) {
  container.innerHTML = `
  <div class="min-h-screen bg-gradient-dark flex items-center justify-center p-4" style="background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);">
    <div class="w-full max-w-md">
      <!-- Logo -->
      <div class="text-center mb-8 fade-in">
        <div class="inline-flex items-center gap-3 mb-4">
          <div class="w-14 h-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
            <i class="fas fa-video text-white text-2xl"></i>
          </div>
        </div>
        <h1 class="text-3xl font-bold text-white tracking-tight">ZoomClone</h1>
        <p class="text-gray-400 mt-1">HD Video Conferencing Platform</p>
      </div>

      <!-- Auth Card -->
      <div class="auth-card fade-in" id="auth-card">
        <!-- Tabs -->
        <div class="flex gap-1 bg-gray-800/50 rounded-xl p-1 mb-6" id="auth-tabs">
          <button onclick="switchTab('login')" id="tab-login" class="flex-1 py-2 rounded-lg text-sm font-semibold transition-all bg-indigo-600 text-white">
            <i class="fas fa-sign-in-alt mr-1"></i> Login
          </button>
          <button onclick="switchTab('register')" id="tab-register" class="flex-1 py-2 rounded-lg text-sm font-semibold transition-all text-gray-400 hover:text-white">
            <i class="fas fa-user-plus mr-1"></i> Register
          </button>
        </div>

        <!-- Login Form -->
        <form id="login-form" onsubmit="handleLogin(event)">
          <div class="space-y-4">
            <div>
              <label class="text-gray-400 text-sm mb-1 block">Email</label>
              <input type="email" id="login-email" class="form-input" placeholder="you@example.com" required/>
            </div>
            <div>
              <label class="text-gray-400 text-sm mb-1 block">Password</label>
              <div class="relative">
                <input type="password" id="login-password" class="form-input pr-12" placeholder="••••••••" required/>
                <button type="button" onclick="togglePwd('login-password')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <i class="fas fa-eye text-sm"></i>
                </button>
              </div>
            </div>
            <button type="submit" id="login-btn" class="btn-primary mt-2">
              <i class="fas fa-sign-in-alt mr-2"></i> Sign In
            </button>
          </div>
        </form>

        <!-- Register Form -->
        <form id="register-form" onsubmit="handleRegister(event)" class="hidden">
          <div class="space-y-4">
            <div>
              <label class="text-gray-400 text-sm mb-1 block">Full Name</label>
              <input type="text" id="reg-name" class="form-input" placeholder="John Doe" required/>
            </div>
            <div>
              <label class="text-gray-400 text-sm mb-1 block">Email</label>
              <input type="email" id="reg-email" class="form-input" placeholder="you@example.com" required/>
            </div>
            <div>
              <label class="text-gray-400 text-sm mb-1 block">Password</label>
              <div class="relative">
                <input type="password" id="reg-password" class="form-input pr-12" placeholder="Min. 6 characters" required minlength="6"/>
                <button type="button" onclick="togglePwd('reg-password')" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300">
                  <i class="fas fa-eye text-sm"></i>
                </button>
              </div>
            </div>
            <button type="submit" id="reg-btn" class="btn-primary mt-2">
              <i class="fas fa-user-plus mr-2"></i> Create Account
            </button>
          </div>
        </form>
      </div>

      <!-- Quick join as guest -->
      <div class="text-center mt-6 fade-in">
        <p class="text-gray-500 text-sm mb-3">Have a meeting link?</p>
        <button onclick="showGuestJoin()" class="btn-secondary text-sm">
          <i class="fas fa-link mr-2"></i> Join as Guest
        </button>
      </div>
    </div>
  </div>
  `
}

function switchTab(tab) {
  const loginForm = document.getElementById('login-form')
  const regForm = document.getElementById('register-form')
  const tabLogin = document.getElementById('tab-login')
  const tabReg = document.getElementById('tab-register')
  if (tab === 'login') {
    loginForm.classList.remove('hidden')
    regForm.classList.add('hidden')
    tabLogin.classList.replace('text-gray-400', 'text-white')
    tabLogin.classList.add('bg-indigo-600')
    tabReg.classList.remove('bg-indigo-600', 'text-white')
    tabReg.classList.add('text-gray-400')
  } else {
    regForm.classList.remove('hidden')
    loginForm.classList.add('hidden')
    tabReg.classList.replace('text-gray-400', 'text-white')
    tabReg.classList.add('bg-indigo-600')
    tabLogin.classList.remove('bg-indigo-600', 'text-white')
    tabLogin.classList.add('text-gray-400')
  }
}

function togglePwd(id) {
  const inp = document.getElementById(id)
  inp.type = inp.type === 'password' ? 'text' : 'password'
}

async function handleLogin(e) {
  e.preventDefault()
  const btn = document.getElementById('login-btn')
  const email = document.getElementById('login-email').value
  const password = document.getElementById('login-password').value
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Signing in...'
  try {
    const res = await fetch(API + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Login failed')
    setToken(data.token); setUser(data.user)
    currentUser = data.user
    showToast('Welcome back, ' + data.user.name + '!', 'success')
    renderDashboard(document.getElementById('app'))
  } catch (err) {
    showToast(err.message, 'error')
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-sign-in-alt mr-2"></i> Sign In'
  }
}

async function handleRegister(e) {
  e.preventDefault()
  const btn = document.getElementById('reg-btn')
  const name = document.getElementById('reg-name').value
  const email = document.getElementById('reg-email').value
  const password = document.getElementById('reg-password').value
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Creating...'
  try {
    const res = await fetch(API + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Registration failed')
    setToken(data.token); setUser(data.user)
    currentUser = data.user
    showToast('Account created! Welcome, ' + data.user.name + '!', 'success')
    renderDashboard(document.getElementById('app'))
  } catch (err) {
    showToast(err.message, 'error')
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-user-plus mr-2"></i> Create Account'
  }
}

function showGuestJoin() {
  showModal(`
    <h2 class="text-xl font-bold mb-4"><i class="fas fa-link mr-2 text-indigo-400"></i>Join Meeting</h2>
    <p class="text-gray-400 text-sm mb-4">Enter meeting ID or paste meeting link</p>
    <input type="text" id="guest-code" class="form-input mb-3" placeholder="Meeting ID (e.g. abc-1234-def)"/>
    <input type="text" id="guest-name" class="form-input mb-4" placeholder="Your display name"/>
    <div class="flex gap-3">
      <button onclick="closeModal()" class="btn-secondary flex-1">Cancel</button>
      <button onclick="guestJoin()" class="btn-primary flex-1">Join Now</button>
    </div>
  `)
}

async function guestJoin() {
  const code = document.getElementById('guest-code').value.trim()
  const name = document.getElementById('guest-name').value.trim()
  if (!code) { showToast('Enter meeting ID', 'error'); return }
  if (!name) { showToast('Enter your name', 'error'); return }
  const cleanCode = code.replace(/.*\//g, '').trim()
  localStorage.setItem('zc_guest_name', name)
  window.location.href = '/room/' + cleanCode
}

// ── DASHBOARD ─────────────────────────────────────────
async function renderDashboard(container) {
  const user = getUser()
  if (!user) { renderAuth(container); return }

  container.innerHTML = `
  <div class="min-h-screen" style="background: linear-gradient(135deg, #0f0c29, #302b63, #24243e);">
    <!-- Header -->
    <header class="sticky top-0 z-50 bg-gray-900/80 backdrop-blur-lg border-b border-gray-700/50">
      <div class="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-9 h-9 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center">
            <i class="fas fa-video text-white text-sm"></i>
          </div>
          <span class="text-xl font-bold text-white">ZoomClone</span>
        </div>
        <div class="flex items-center gap-4">
          <div class="flex items-center gap-3">
            <div class="avatar" style="background:${user.avatarColor || '#6366f1'}">
              ${user.name.charAt(0).toUpperCase()}
            </div>
            <div class="hidden sm:block">
              <p class="text-white text-sm font-semibold">${user.name}</p>
              <p class="text-gray-400 text-xs">${user.email}</p>
            </div>
          </div>
          <button onclick="handleLogout()" class="text-gray-400 hover:text-white transition-colors p-2 rounded-lg hover:bg-gray-700" title="Logout">
            <i class="fas fa-sign-out-alt"></i>
          </button>
        </div>
      </div>
    </header>

    <main class="max-w-6xl mx-auto px-6 py-8">
      <!-- Quick Actions -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 fade-in">
        <button onclick="showCreateMeeting()" class="group bg-indigo-600 hover:bg-indigo-500 rounded-2xl p-6 text-left transition-all transform hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/20">
          <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <i class="fas fa-plus text-white text-xl"></i>
          </div>
          <h3 class="text-white font-bold text-lg">New Meeting</h3>
          <p class="text-indigo-200 text-sm mt-1">Start an instant meeting</p>
        </button>

        <button onclick="showJoinMeeting()" class="group bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/50 rounded-2xl p-6 text-left transition-all transform hover:-translate-y-1">
          <div class="w-12 h-12 bg-indigo-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <i class="fas fa-link text-indigo-400 text-xl"></i>
          </div>
          <h3 class="text-white font-bold text-lg">Join Meeting</h3>
          <p class="text-gray-400 text-sm mt-1">Enter meeting ID or link</p>
        </button>

        <button onclick="showScheduleMeeting()" class="group bg-gray-800/80 hover:bg-gray-700/80 border border-gray-700/50 rounded-2xl p-6 text-left transition-all transform hover:-translate-y-1">
          <div class="w-12 h-12 bg-purple-500/20 rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
            <i class="fas fa-calendar-plus text-purple-400 text-xl"></i>
          </div>
          <h3 class="text-white font-bold text-lg">Schedule</h3>
          <p class="text-gray-400 text-sm mt-1">Plan a meeting for later</p>
        </button>
      </div>

      <!-- Meetings List -->
      <div class="fade-in">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-white font-bold text-xl">My Meetings</h2>
          <button onclick="loadMeetings()" class="text-indigo-400 hover:text-indigo-300 text-sm transition-colors">
            <i class="fas fa-sync-alt mr-1"></i> Refresh
          </button>
        </div>
        <div id="meetings-list" class="grid gap-3">
          <div class="text-center py-12 text-gray-500">
            <div class="spinner mx-auto mb-4"></div>
            <p>Loading meetings...</p>
          </div>
        </div>
      </div>
    </main>
  </div>
  `

  loadMeetings()
}

async function loadMeetings() {
  const container = document.getElementById('meetings-list')
  if (!container) return
  try {
    const res = await apiFetch('/meetings')
    const data = await res.json()
    const meetings = data.meetings || []
    if (meetings.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 text-gray-500 bg-gray-800/20 rounded-2xl border border-gray-700/30">
          <i class="fas fa-video text-4xl mb-4 opacity-30"></i>
          <p class="font-medium">No meetings yet</p>
          <p class="text-sm mt-1">Create your first meeting to get started</p>
        </div>
      `
      return
    }
    container.innerHTML = meetings.map(m => `
      <div class="meeting-card fade-in">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-3 flex-1">
            <div class="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center flex-shrink-0">
              <i class="fas fa-video text-indigo-400"></i>
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-white font-semibold truncate">${escapeHtml(m.title)}</h3>
              <p class="text-gray-400 text-sm mt-0.5">
                <span class="font-mono text-indigo-300 text-xs">${m.meeting_code}</span>
                ${m.scheduled_at ? '· <i class="fas fa-clock mr-1"></i>' + formatDate(m.scheduled_at) : ''}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2 ml-4">
            <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${m.status === 'active' ? 'bg-green-500/20 text-green-400' : m.status === 'ended' ? 'bg-gray-700 text-gray-400' : 'bg-indigo-500/20 text-indigo-400'}">
              ${m.status === 'active' ? '🟢 Live' : m.status === 'ended' ? '⏹ Ended' : '📅 Scheduled'}
            </span>
            <button onclick="copyMeetingLink('${m.meeting_code}')" class="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-gray-700 transition-colors" title="Copy link">
              <i class="fas fa-copy text-sm"></i>
            </button>
            <button onclick="joinMeetingByCode('${m.meeting_code}')" class="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors">
              ${m.status === 'ended' ? 'Restart' : 'Start'}
            </button>
          </div>
        </div>
      </div>
    `).join('')
  } catch (err) {
    container.innerHTML = '<p class="text-red-400 text-center py-8">Failed to load meetings</p>'
  }
}

function copyMeetingLink(code) {
  const link = window.location.origin + '/room/' + code
  navigator.clipboard.writeText(link).then(() => showToast('Meeting link copied!', 'success'))
}

function joinMeetingByCode(code) {
  window.location.href = '/room/' + code
}

// ── CREATE MEETING ────────────────────────────────────
function showCreateMeeting() {
  showModal(`
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
        <i class="fas fa-plus text-indigo-400"></i>
      </div>
      <h2 class="text-xl font-bold text-white">New Meeting</h2>
    </div>
    <div class="space-y-4">
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Meeting Title</label>
        <input type="text" id="create-title" class="form-input" placeholder="Weekly Standup" required value="My Meeting"/>
      </div>
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Password (optional)</label>
        <input type="password" id="create-password" class="form-input" placeholder="Leave empty for no password"/>
      </div>
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" id="create-waiting" class="w-4 h-4 rounded accent-indigo-500"/>
        <span class="text-gray-300 text-sm">Enable waiting room</span>
      </label>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-secondary flex-1">Cancel</button>
      <button onclick="createAndJoin()" id="create-btn" class="btn-primary flex-1">
        <i class="fas fa-video mr-2"></i> Create & Start
      </button>
    </div>
  `)
}

async function createAndJoin() {
  const title = document.getElementById('create-title').value.trim()
  const password = document.getElementById('create-password').value
  const isWaitingRoom = document.getElementById('create-waiting').checked
  const btn = document.getElementById('create-btn')
  if (!title) { showToast('Enter meeting title', 'error'); return }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Creating...'
  try {
    const res = await apiFetch('/meetings', {
      method: 'POST',
      body: JSON.stringify({ title, password: password || null, isWaitingRoom })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    showToast('Meeting created!', 'success')
    closeModal()
    setTimeout(() => window.location.href = '/room/' + data.meetingCode, 300)
  } catch (err) {
    showToast(err.message, 'error')
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-video mr-2"></i> Create & Start'
  }
}

// ── JOIN MEETING ──────────────────────────────────────
function showJoinMeeting() {
  showModal(`
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 bg-indigo-500/20 rounded-xl flex items-center justify-center">
        <i class="fas fa-link text-indigo-400"></i>
      </div>
      <h2 class="text-xl font-bold text-white">Join Meeting</h2>
    </div>
    <div class="space-y-4">
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Meeting ID or Link</label>
        <input type="text" id="join-code" class="form-input" placeholder="abc-1234-xyz or https://..."/>
      </div>
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Password (if required)</label>
        <input type="password" id="join-password" class="form-input" placeholder="Optional"/>
      </div>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-secondary flex-1">Cancel</button>
      <button onclick="doJoinMeeting()" class="btn-primary flex-1">
        <i class="fas fa-sign-in-alt mr-2"></i> Join
      </button>
    </div>
  `)
}

function doJoinMeeting() {
  const code = document.getElementById('join-code').value.trim().replace(/.*\//g, '')
  if (!code) { showToast('Enter meeting ID', 'error'); return }
  closeModal()
  window.location.href = '/room/' + code
}

// ── SCHEDULE MEETING ──────────────────────────────────
function showScheduleMeeting() {
  const now = new Date()
  now.setMinutes(now.getMinutes() + 30)
  const dtLocal = now.toISOString().slice(0, 16)
  showModal(`
    <div class="flex items-center gap-3 mb-6">
      <div class="w-10 h-10 bg-purple-500/20 rounded-xl flex items-center justify-center">
        <i class="fas fa-calendar-plus text-purple-400"></i>
      </div>
      <h2 class="text-xl font-bold text-white">Schedule Meeting</h2>
    </div>
    <div class="space-y-4">
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Meeting Title</label>
        <input type="text" id="sched-title" class="form-input" placeholder="Team Sync" value="Team Sync"/>
      </div>
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Date & Time</label>
        <input type="datetime-local" id="sched-time" class="form-input" value="${dtLocal}"/>
      </div>
      <div>
        <label class="text-gray-400 text-sm mb-1 block">Password (optional)</label>
        <input type="password" id="sched-password" class="form-input" placeholder="Optional"/>
      </div>
      <label class="flex items-center gap-3 cursor-pointer">
        <input type="checkbox" id="sched-waiting" class="w-4 h-4 rounded accent-indigo-500"/>
        <span class="text-gray-300 text-sm">Enable waiting room</span>
      </label>
    </div>
    <div class="flex gap-3 mt-6">
      <button onclick="closeModal()" class="btn-secondary flex-1">Cancel</button>
      <button onclick="scheduleMeeting()" id="sched-btn" class="btn-primary flex-1">
        <i class="fas fa-calendar-check mr-2"></i> Schedule
      </button>
    </div>
  `)
}

async function scheduleMeeting() {
  const title = document.getElementById('sched-title').value.trim()
  const time = document.getElementById('sched-time').value
  const password = document.getElementById('sched-password').value
  const isWaitingRoom = document.getElementById('sched-waiting').checked
  const btn = document.getElementById('sched-btn')
  if (!title) { showToast('Enter meeting title', 'error'); return }
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Scheduling...'
  try {
    const res = await apiFetch('/meetings', {
      method: 'POST',
      body: JSON.stringify({ title, password: password || null, isWaitingRoom, scheduledAt: time || null })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error)
    showToast('Meeting scheduled! Code: ' + data.meetingCode, 'success')
    closeModal()
    loadMeetings()
  } catch (err) {
    showToast(err.message, 'error')
    btn.disabled = false; btn.innerHTML = '<i class="fas fa-calendar-check mr-2"></i> Schedule'
  }
}

// ── LOGOUT ────────────────────────────────────────────
async function handleLogout() {
  await apiFetch('/auth/logout', { method: 'POST' })
  removeToken(); removeUser()
  showToast('Logged out', 'info')
  renderAuth(document.getElementById('app'))
}

// ── MODAL ─────────────────────────────────────────────
function showModal(content) {
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'; overlay.id = 'modal-overlay'
  overlay.innerHTML = `<div class="modal-box">${content}</div>`
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal() })
  document.body.appendChild(overlay)
}
function closeModal() {
  document.getElementById('modal-overlay')?.remove()
}

// ── UTILS ─────────────────────────────────────────────
function escapeHtml(str) {
  const d = document.createElement('div'); d.textContent = str; return d.innerHTML
}

// ── INIT ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', initApp)
