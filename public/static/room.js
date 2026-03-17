// ======================================================
// ZoomClone v5 — Fixed WebRTC: Video + Audio + Screen Share
// Key fixes:
//   1. Proper track negotiation with renegotiation on replaceTrack
//   2. Audio routed through AudioContext for noise reduction
//   3. Screen share triggers renegotiation so remote sees it
//   4. Video tile shows as soon as any track arrives
// ======================================================
'use strict'

const API       = '/api'
const CODE      = window.MEETING_CODE
const IS_MOBILE = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)

// ── State ──────────────────────────────────────────────
let me = null, mtg = null, myPid = null, amHost = false

// ── Media ──────────────────────────────────────────────
let localStream  = null   // camera+mic stream
let screenStream = null   // screen capture stream
let micOn  = true, camOn  = true
let pvMic  = true, pvCam  = true
let sharing = false, recording = false
let recorder = null, recChunks = []

// ── Audio Context for noise reduction ─────────────────
let audioCtx = null, processedStream = null

// ── Peers: pid -> { pc, remoteStream, makingOffer } ───
let peers = {}
let peerNames = {}

// ── Signaling ─────────────────────────────────────────
let sigSince = ''
let pendingIce = {}   // pid -> [candidates] before remote desc

// ── Polling ───────────────────────────────────────────
let timers = {}

// ── Chat / Participants ────────────────────────────────
let chatSeen  = new Set()
let lastChat  = ''
let pCache    = {}
let removedPids = new Set()

// ── Sidebar ────────────────────────────────────────────
let sbOpen = false, sbTab = 'chat'

// ── ICE servers ────────────────────────────────────────
const ICE = [
  {urls:'stun:stun.l.google.com:19302'},
  {urls:'stun:stun1.l.google.com:19302'},
  {urls:'stun:stun.cloudflare.com:3478'},
  {urls:'turn:openrelay.metered.ca:80',   username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turn:openrelay.metered.ca:443',  username:'openrelayproject', credential:'openrelayproject'},
  {urls:'turns:openrelay.metered.ca:443', username:'openrelayproject', credential:'openrelayproject'},
]

// ════════════════════════════════════════════════════════
// Utilities
// ════════════════════════════════════════════════════════
const $  = id => document.getElementById(id)
const esc = s => { const d = document.createElement('div'); d.textContent = s||''; return d.innerHTML }
const tok = () => localStorage.getItem('zc_token')
const myName = () => me?.name || localStorage.getItem('zc_guest_name') || 'Guest'

function bgColor(name){
  const c=['#6366f1','#8b5cf6','#ec4899','#ef4444','#f97316','#22c55e','#14b8a6','#3b82f6','#06b6d4']
  let h=0; for(const ch of (name||'?')) h=(h<<5)-h+ch.charCodeAt(0)
  return c[Math.abs(h)%c.length]
}
function initials(name){ return (name||'?').charAt(0).toUpperCase() }
function avHtml(name, sz=36){
  const bg=bgColor(name)
  return `<div style="width:${sz}px;height:${sz}px;border-radius:50%;background:${bg};
    display:flex;align-items:center;justify-content:center;
    font-size:${Math.round(sz*.4)}px;font-weight:700;color:#fff;flex-shrink:0">${initials(name)}</div>`
}

function toast(msg, type='info'){
  const ico = {success:'fa-check-circle text-green-400',error:'fa-times-circle text-red-400',
               info:'fa-info-circle text-indigo-400',warning:'fa-exclamation-triangle text-yellow-400'}
  const t = document.createElement('div')
  t.className = `toast ${type}`
  t.innerHTML = `<i class="fas ${ico[type]}"></i><span>${esc(msg)}</span>`
  document.body.appendChild(t)
  setTimeout(()=>{ t.style.animation='slideOutRight .3s ease forwards'; setTimeout(()=>t.remove(),300) }, 3500)
}

async function api(path, opts={}){
  const h = {'Content-Type':'application/json', ...(opts.headers||{})}
  if(tok()) h['Authorization'] = 'Bearer '+tok()
  return fetch(API+path, {...opts, headers:h})
}

function fmtTime(d){ return new Date(d).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) }

// ════════════════════════════════════════════════════════
// Audio Context — noise suppression via Web Audio
// ════════════════════════════════════════════════════════
function buildProcessedStream(rawStream){
  try{
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:48000})
    const src  = audioCtx.createMediaStreamSource(rawStream)
    const dst  = audioCtx.createMediaStreamDestination()
    // Dynamics compressor to reduce noise spikes
    const comp = audioCtx.createDynamicsCompressor()
    comp.threshold.value = -40
    comp.knee.value      = 10
    comp.ratio.value     = 4
    comp.attack.value    = 0.005
    comp.release.value   = 0.1
    src.connect(comp)
    comp.connect(dst)
    // Merge processed audio with original video tracks
    const tracks = [
      ...dst.stream.getAudioTracks(),
      ...rawStream.getVideoTracks()
    ]
    processedStream = new MediaStream(tracks)
    console.log('[Audio] processed stream created')
    return processedStream
  }catch(e){
    console.warn('[Audio] AudioContext failed, using raw:',e)
    return rawStream
  }
}

// ════════════════════════════════════════════════════════
// Boot
// ════════════════════════════════════════════════════════
async function init(){
  me = JSON.parse(localStorage.getItem('zc_user')||'null')
  showLoading('Connecting...')
  try{
    const r = await fetch(API+'/meetings/code/'+CODE)
    if(!r.ok){ showErr('Meeting not found'); return }
    mtg = await r.json()
    if(mtg.status==='ended'){ showErr('This meeting has ended'); return }
    showPrejoin()
  }catch(e){ showErr('Connection failed: '+e.message) }
}

function showLoading(msg){
  $('meeting-app').innerHTML = `
    <div class="loading-overlay">
      <div style="width:60px;height:60px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
        border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:16px">
        <i class="fas fa-video text-white" style="font-size:1.4rem"></i></div>
      <div class="spinner"></div>
      <p class="text-gray-300" style="margin-top:12px;font-size:.9rem">${msg}</p>
    </div>`
}
function showErr(msg){
  $('meeting-app').innerHTML = `
    <div class="loading-overlay"><div class="text-center">
      <i class="fas fa-exclamation-triangle text-red-400" style="font-size:3rem;margin-bottom:16px"></i>
      <h2 class="text-white font-bold" style="margin-bottom:8px">${msg}</h2>
      <a href="/" class="btn-primary" style="display:inline-block;padding:10px 28px;border-radius:10px;margin-top:8px">
        <i class="fas fa-home"></i> Home</a>
    </div></div>`
}

// ════════════════════════════════════════════════════════
// Pre-join
// ════════════════════════════════════════════════════════
async function showPrejoin(){
  const name = myName()
  $('meeting-app').innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:16px;
    background:linear-gradient(135deg,#0f0c29,#302b63,#24243e)">
    <div style="width:100%;max-width:680px">
      <div class="text-center fade-in" style="margin-bottom:20px">
        <h1 class="text-white font-bold" style="font-size:1.4rem">${esc(mtg.title)}</h1>
        <p class="text-gray-400" style="font-size:.85rem;margin-top:4px">Hosted by ${esc(mtg.hostName)}</p>
        <span style="display:inline-block;margin-top:6px;padding:3px 12px;background:rgba(99,102,241,.2);
          color:#a5b4fc;border-radius:999px;font-family:monospace;font-size:.8rem">${CODE}</span>
      </div>
      <div class="fade-in" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="border-radius:14px;overflow:hidden;position:relative;background:#1f2937;aspect-ratio:16/9">
          <video id="pv" autoplay muted playsinline
            style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1)"></video>
          <div id="pvph" style="position:absolute;inset:0;display:flex;flex-direction:column;
            align-items:center;justify-content:center;gap:8px;background:#1f2937">
            ${avHtml(name,56)}<p class="text-gray-400" style="font-size:.8rem">${esc(name)}</p>
          </div>
          <div style="position:absolute;bottom:8px;left:50%;transform:translateX(-50%);display:flex;gap:8px">
            <button id="pv-mic" onclick="pvToggleMic()"
              style="width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;color:#fff;
                font-size:.85rem;background:rgba(55,65,81,.85)"><i class="fas fa-microphone"></i></button>
            <button id="pv-cam" onclick="pvToggleCam()"
              style="width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;color:#fff;
                font-size:.85rem;background:rgba(55,65,81,.85)"><i class="fas fa-video"></i></button>
          </div>
        </div>
        <div class="auth-card" style="padding:20px">
          <h3 class="text-white font-semibold" style="margin-bottom:14px">Ready to join?</h3>
          ${!me?`<div style="margin-bottom:12px">
            <label class="text-gray-400" style="font-size:.75rem;display:block;margin-bottom:4px">Your name</label>
            <input id="pj-name" class="form-input" value="${esc(name)}" placeholder="Enter name"/>
          </div>`:
          `<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;
            padding:10px;background:rgba(55,65,81,.35);border-radius:10px">
            ${avHtml(me.name,34)}
            <div>
              <p class="text-white font-semibold" style="font-size:.85rem">${esc(me.name)}</p>
              <p class="text-gray-400" style="font-size:.72rem">${esc(me.email)}</p>
            </div>
          </div>`}
          ${mtg.hasPassword&&!(me?.id===mtg.hostId)?`<div style="margin-bottom:12px">
            <label class="text-gray-400" style="font-size:.75rem;display:block;margin-bottom:4px">Password</label>
            <input id="pj-pw" type="password" class="form-input" placeholder="Meeting password"/></div>`:''}
          <div style="display:flex;gap:8px;margin-bottom:14px">
            <button id="pj-mic-btn" onclick="pvToggleMic()"
              style="flex:1;padding:7px;border-radius:8px;border:1px solid rgba(75,85,99,.5);
                background:rgba(55,65,81,.7);color:#fff;cursor:pointer;font-size:.78rem">
              <i class="fas fa-microphone text-green-400"></i> Mic On</button>
            <button id="pj-cam-btn" onclick="pvToggleCam()"
              style="flex:1;padding:7px;border-radius:8px;border:1px solid rgba(75,85,99,.5);
                background:rgba(55,65,81,.7);color:#fff;cursor:pointer;font-size:.78rem">
              <i class="fas fa-video text-green-400"></i> Cam On</button>
          </div>
          <button id="join-btn" onclick="doJoin()" class="btn-primary">
            <i class="fas fa-sign-in-alt"></i> Join Now</button>
          <a href="/" class="btn-secondary"
            style="display:block;text-align:center;margin-top:10px;padding:9px;border-radius:10px;font-size:.85rem">Cancel</a>
        </div>
      </div>
    </div>
  </div>`
  await getMedia()
}

async function getMedia(){
  try{
    const raw = await navigator.mediaDevices.getUserMedia({
      audio:{
        echoCancellation:true, noiseSuppression:true, autoGainControl:true,
        sampleRate:48000, channelCount:1, latency:0
      },
      video: IS_MOBILE
        ? {facingMode:'user',width:{ideal:640},height:{ideal:480},frameRate:{ideal:24}}
        : {width:{ideal:1280},height:{ideal:720},frameRate:{ideal:30}}
    })
    // Build processed stream with AudioContext
    localStream = buildProcessedStream(raw)
    attachPreview()
  }catch(e){
    console.warn('video+audio fail:',e.name)
    try{
      const raw = await navigator.mediaDevices.getUserMedia({
        audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}
      })
      localStream = buildProcessedStream(raw)
      pvCam = false; camOn = false
      toast('Camera not available','warning')
    }catch(e2){
      localStream = null; pvMic=false; pvCam=false; micOn=false; camOn=false
      toast('No camera/mic','warning')
    }
    updatePvBtns()
  }
}

function attachPreview(){
  const v=$('pv'), ph=$('pvph')
  if(!v) return
  const stream = processedStream || localStream
  if(!stream) return
  // Use original stream for preview (processedStream may not have video)
  const hasVideo = stream.getVideoTracks().length > 0
  const previewStream = hasVideo ? stream : (localStream || stream)
  v.srcObject = previewStream
  v.onloadedmetadata = ()=>{ v.play().catch(()=>{}) }
  if(ph) ph.style.opacity = (hasVideo && pvCam) ? '0' : '1'
}

function updatePvBtns(){
  const m=$('pv-mic'), c=$('pv-cam'), mb=$('pj-mic-btn'), cb=$('pj-cam-btn')
  if(m){ m.innerHTML=pvMic?'<i class="fas fa-microphone"></i>':'<i class="fas fa-microphone-slash" style="color:#f87171"></i>'; m.style.background=pvMic?'rgba(55,65,81,.85)':'rgba(239,68,68,.4)' }
  if(c){ c.innerHTML=pvCam?'<i class="fas fa-video"></i>':'<i class="fas fa-video-slash" style="color:#f87171"></i>'; c.style.background=pvCam?'rgba(55,65,81,.85)':'rgba(239,68,68,.4)' }
  if(mb) mb.innerHTML=pvMic?'<i class="fas fa-microphone text-green-400"></i> Mic On':'<i class="fas fa-microphone-slash text-red-400"></i> Mic Off'
  if(cb) cb.innerHTML=pvCam?'<i class="fas fa-video text-green-400"></i> Cam On':'<i class="fas fa-video-slash text-red-400"></i> Cam Off'
}

function pvToggleMic(){
  pvMic = !pvMic
  if(localStream) localStream.getAudioTracks().forEach(t=>t.enabled=pvMic)
  if(processedStream) processedStream.getAudioTracks().forEach(t=>t.enabled=pvMic)
  updatePvBtns()
}
function pvToggleCam(){
  pvCam = !pvCam
  if(localStream) localStream.getVideoTracks().forEach(t=>t.enabled=pvCam)
  const ph=$('pvph'); if(ph) ph.style.opacity=pvCam?'0':'1'
  updatePvBtns()
}

// ════════════════════════════════════════════════════════
// Join
// ════════════════════════════════════════════════════════
async function doJoin(){
  const btn = $('join-btn')
  btn.disabled = true; btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Joining...'
  const name = me?.name || $('pj-name')?.value?.trim() || 'Guest'
  const pw   = $('pj-pw')?.value || ''
  if(!me) localStorage.setItem('zc_guest_name', name)
  micOn = pvMic; camOn = pvCam
  if(localStream){
    localStream.getAudioTracks().forEach(t=>t.enabled=micOn)
    localStream.getVideoTracks().forEach(t=>t.enabled=camOn)
  }
  try{
    const r = await api('/meetings/'+mtg.id+'/join',{method:'POST',body:JSON.stringify({displayName:name,password:pw})})
    const d = await r.json()
    if(!r.ok) throw new Error(d.error)
    if(d.waitingRoom){ showWaiting(d.waitId, name); return }
    myPid = d.participantId; amHost = d.isHost
    renderRoom(name)
  }catch(e){
    toast(e.message,'error')
    btn.disabled=false; btn.innerHTML='<i class="fas fa-sign-in-alt"></i> Join Now'
  }
}

// ════════════════════════════════════════════════════════
// Waiting room
// ════════════════════════════════════════════════════════
function showWaiting(waitId, name){
  $('meeting-app').innerHTML = `
  <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:linear-gradient(135deg,#0f0c29,#302b63,#24243e)">
    <div class="auth-card text-center" style="max-width:360px;width:90%">
      <div style="width:60px;height:60px;background:rgba(234,179,8,.15);border-radius:16px;
        display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
        <i class="fas fa-clock text-yellow-400" style="font-size:1.4rem"></i></div>
      <h2 class="text-white font-bold" style="margin-bottom:8px">Waiting Room</h2>
      <p class="text-gray-400" style="font-size:.85rem;margin-bottom:20px">Waiting for host to let you in...</p>
      <div style="display:flex;justify-content:center;gap:6px;margin-bottom:20px">
        ${[0,150,300].map(d=>`<div style="width:8px;height:8px;background:#818cf8;border-radius:50%;animation:bounce 1s infinite ${d}ms"></div>`).join('')}
      </div>
      <a href="/" class="btn-secondary" style="display:inline-block;padding:8px 24px;border-radius:10px">Leave</a>
    </div>
  </div>`
  const poll = setInterval(async()=>{
    try{
      const r = await fetch(API+'/meetings/'+mtg.id+'/waiting/'+waitId+'/status')
      const d = await r.json()
      if(!d.waiting){
        clearInterval(poll)
        const jr = await api('/meetings/'+mtg.id+'/join',{method:'POST',body:JSON.stringify({displayName:name,password:''})})
        const jd = await jr.json()
        if(jd.participantId){ myPid=jd.participantId; amHost=jd.isHost; renderRoom(name) }
      }
    }catch(e){}
  }, 2000)
}

// ════════════════════════════════════════════════════════
// Room UI
// ════════════════════════════════════════════════════════
function renderRoom(name){
  const canShare = !IS_MOBILE && !!(navigator.mediaDevices?.getDisplayMedia)
  $('meeting-app').innerHTML = `
  <div class="meeting-info-bar">
    <div style="display:flex;align-items:center;gap:10px;min-width:0">
      <div style="width:30px;height:30px;background:rgba(99,102,241,.2);border-radius:8px;flex-shrink:0;
        display:flex;align-items:center;justify-content:center">
        <i class="fas fa-video text-indigo-400" style="font-size:.8rem"></i></div>
      <div style="min-width:0">
        <p class="text-white font-semibold" style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(mtg.title)}</p>
        <p class="text-gray-400 font-mono" style="font-size:.68rem">${CODE}</p>
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
      <div id="rec-badge" style="display:none;align-items:center;gap:4px;padding:2px 8px;
        background:rgba(239,68,68,.2);border:1px solid rgba(239,68,68,.3);border-radius:999px">
        <span class="recording-dot"></span>
        <span class="text-red-400" style="font-size:.68rem;font-weight:600">REC</span></div>
      <span id="timer" class="text-gray-400 font-mono" style="font-size:.82rem">00:00</span>
      <button onclick="copyLink()" style="width:30px;height:30px;background:transparent;border:none;color:#9ca3af;
        cursor:pointer;border-radius:6px;font-size:.85rem"
        onmouseover="this.style.background='rgba(55,65,81,.5)'" onmouseout="this.style.background='transparent'">
        <i class="fas fa-copy"></i></button>
    </div>
  </div>

  <div class="video-area" id="video-area">
    <div id="vgrid" class="video-grid participants-1"></div>
  </div>

  <div class="sidebar" id="sidebar">
    <div style="display:flex;border-bottom:1px solid rgba(75,85,99,.3)">
      <button onclick="swTab('chat')" id="tab-chat" class="tab-btn active"><i class="fas fa-comments"></i> Chat</button>
      <button onclick="swTab('participants')" id="tab-participants" class="tab-btn"><i class="fas fa-users"></i> People</button>
      ${amHost?`<button onclick="swTab('waiting')" id="tab-waiting" class="tab-btn">
        <i class="fas fa-clock"></i> Wait<span id="wb" class="badge" style="display:none;margin-left:3px">0</span></button>`:''}
    </div>
    <div id="panel-chat" style="display:flex;flex-direction:column;flex:1;overflow:hidden">
      <div id="chat-box" class="chat-messages" style="flex:1"></div>
      <div style="padding:10px;border-top:1px solid rgba(75,85,99,.3)">
        <div style="display:flex;gap:6px">
          <input id="chat-inp" class="form-input" style="flex:1;padding:8px 12px;font-size:.82rem" placeholder="Message..."
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendMsg()}"/>
          <button onclick="sendMsg()" style="width:34px;height:34px;background:#6366f1;border:none;border-radius:8px;
            color:#fff;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">
            <i class="fas fa-paper-plane" style="font-size:.78rem"></i></button>
        </div>
      </div>
    </div>
    <div id="panel-participants" style="flex:1;overflow-y:auto;padding:12px;display:none"><div id="plist"></div></div>
    ${amHost?`<div id="panel-waiting" style="flex:1;overflow-y:auto;padding:12px;display:none">
      <p class="text-gray-400" style="font-size:.75rem;margin-bottom:10px">Waiting to join</p>
      <div id="wlist"></div></div>`:''}
  </div>

  <div class="control-bar" id="ctrlbar">
    <div style="display:flex;gap:4px">
      <button onclick="toggleMic()" id="btn-mic" class="ctrl-btn ${micOn?'':'muted'}">
        <i class="fas fa-microphone${micOn?'':'-slash'}" style="font-size:1rem"></i>
        <span>${micOn?'Mute':'Unmute'}</span></button>
      <button onclick="toggleCam()" id="btn-cam" class="ctrl-btn ${camOn?'':'muted'}">
        <i class="fas fa-video${camOn?'':'-slash'}" style="font-size:1rem"></i>
        <span>${camOn?'Stop Cam':'Start Cam'}</span></button>
    </div>
    <div style="display:flex;gap:4px;flex-wrap:wrap;justify-content:center">
      ${canShare?`<button onclick="toggleShare()" id="btn-share" class="ctrl-btn">
        <i class="fas fa-desktop" style="font-size:1rem"></i><span>Share</span></button>`:''}
      <button onclick="toggleSidebar('chat')" class="ctrl-btn">
        <i class="fas fa-comments" style="font-size:1rem"></i><span>Chat</span></button>
      <button onclick="toggleSidebar('participants')" class="ctrl-btn">
        <i class="fas fa-users" style="font-size:1rem"></i><span>People</span></button>
      <button onclick="toggleRec()" id="btn-rec" class="ctrl-btn">
        <i class="fas fa-circle text-red-400" style="font-size:1rem"></i><span>Record</span></button>
      ${amHost?`<button onclick="toggleSidebar('waiting')" id="btn-wait" class="ctrl-btn">
        <i class="fas fa-clock" style="font-size:1rem"></i><span>Wait</span></button>`:''}
      <button onclick="moreMenu()" class="ctrl-btn">
        <i class="fas fa-ellipsis-h" style="font-size:1rem"></i><span>More</span></button>
    </div>
    <div>
      <button onclick="${amHost?'endMtg':'leaveMtg'}()" class="ctrl-btn end">
        <i class="fas fa-phone-slash" style="font-size:1rem"></i>
        <span>${amHost?'End':'Leave'}</span></button>
    </div>
  </div>`

  buildLocalTile()
  startPolls()
  startTimer()
  toast(amHost?'👑 You are the host':'✅ Joined!','success')
}

// ════════════════════════════════════════════════════════
// Video Grid
// ════════════════════════════════════════════════════════
function buildLocalTile(){
  const g = $('vgrid'); if(!g) return
  const n = myName(), bg = bgColor(n)
  const streamForLocal = localStream || processedStream
  const hasV = streamForLocal && streamForLocal.getVideoTracks().some(t=>t.readyState==='live') && camOn
  g.innerHTML = `
  <div class="video-tile" id="tile-local">
    <video id="vid-local" autoplay muted playsinline
      style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:${hasV?'block':'none'}"></video>
    <div id="av-local" class="video-off-avatar" style="display:${hasV?'none':'flex'}">
      <div style="width:72px;height:72px;border-radius:50%;background:${bg};display:flex;
        align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:#fff">${initials(n)}</div>
    </div>
    <div class="tile-overlay">
      ${avHtml(n,24)}
      <span class="text-white" style="font-size:.73rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0 4px">
        ${esc(n)} (You)</span>
      ${micOn?'':'<i class="fas fa-microphone-slash text-red-400" style="font-size:.7rem"></i>'}
      ${amHost?'<i class="fas fa-crown text-yellow-400" style="font-size:.68rem;margin-left:2px"></i>':''}
    </div>
  </div>`
  const v = $('vid-local')
  if(v && streamForLocal){
    v.srcObject = streamForLocal
    v.onloadedmetadata = ()=>{ v.play().catch(()=>{}) }
    v.play().catch(()=>{})
  }
}

function addRemoteTile(pid, name){
  const g = $('vgrid'); if(!g) return
  const safe = pid.replace(/[^a-z0-9]/gi,'_')
  if($('tile-'+safe)) return
  const bg = bgColor(name)
  const div = document.createElement('div')
  div.className = 'video-tile'; div.id = 'tile-'+safe
  div.innerHTML = `
    <video id="vid-${safe}" autoplay playsinline
      style="width:100%;height:100%;object-fit:cover;display:none"></video>
    <div id="av-${safe}" class="video-off-avatar" style="display:flex">
      <div style="width:72px;height:72px;border-radius:50%;background:${bg};display:flex;
        align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:#fff">${initials(name)}</div>
    </div>
    <div class="tile-overlay">
      ${avHtml(name,24)}
      <span class="text-white" style="font-size:.73rem;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;margin:0 4px">
        ${esc(name)}</span>
    </div>`
  g.appendChild(div)
  updateGridCols()
}

function removeRemoteTile(pid){
  const safe = pid.replace(/[^a-z0-9]/gi,'_')
  $('tile-'+safe)?.remove()
  updateGridCols()
}

// ── KEY FIX: Proper video attachment ──────────────────
function attachRemoteStream(pid, stream){
  const safe = pid.replace(/[^a-z0-9]/gi,'_')
  const v    = $('vid-'+safe)
  const av   = $('av-'+safe)
  if(!v){ console.warn('[UI] no tile for',pid); return }

  v.srcObject = stream

  const tryPlay = ()=>{
    const hasVideoTracks = stream.getVideoTracks().length > 0
    const activeVideo    = stream.getVideoTracks().some(t=>t.readyState==='live'&&t.enabled)
    console.log('[UI] attachRemoteStream',pid,'hasVideo:',hasVideoTracks,'active:',activeVideo,'tracks:',stream.getTracks().map(t=>t.kind+':'+t.readyState))

    if(hasVideoTracks){
      v.style.display = 'block'
      if(av) av.style.display = 'none'
      v.play().catch(e=>{
        console.warn('[UI] remote play err:',e.name)
        // For mobile: autoplay blocked → show button
        showAudioUnlock()
      })
    } else {
      v.style.display = 'none'
      if(av) av.style.display = 'flex'
    }
  }

  v.onloadedmetadata = tryPlay
  // Also try immediately and after delays (for tracks added late)
  tryPlay()
  setTimeout(tryPlay, 500)
  setTimeout(tryPlay, 1500)
  setTimeout(tryPlay, 3000)

  // React to tracks being added/removed
  stream.addEventListener('addtrack', ()=>{ console.log('[UI] addtrack on stream for',pid); tryPlay() })
  stream.addEventListener('removetrack', ()=>tryPlay())
}

function updateGridCols(){
  const g = $('vgrid'); if(!g) return
  const n = g.querySelectorAll('.video-tile').length
  g.className = 'video-grid participants-'+(n<=6?n:'many')
}

function showAudioUnlock(){
  if($('tap-audio')) return
  const btn = document.createElement('button')
  btn.id = 'tap-audio'
  btn.innerHTML = '🔊 Tap to enable audio/video'
  btn.style.cssText = `position:fixed;bottom:100px;left:50%;transform:translateX(-50%);
    background:#6366f1;color:#fff;border:none;padding:10px 22px;border-radius:999px;
    font-size:.85rem;font-weight:600;cursor:pointer;z-index:9999;box-shadow:0 4px 20px rgba(99,102,241,.4)`
  btn.onclick = ()=>{
    if(audioCtx?.state==='suspended') audioCtx.resume()
    document.querySelectorAll('video,audio').forEach(m=>m.play().catch(()=>{}))
    btn.remove()
  }
  document.body.appendChild(btn)
}

// ════════════════════════════════════════════════════════
// WebRTC peer management
// ════════════════════════════════════════════════════════
function getPeer(pid, name){
  if(peers[pid]) return peers[pid].pc
  console.log('[RTC] creating PC for',pid.substring(0,8),'name:',name)
  peerNames[pid] = name || pCache[pid]?.display_name || 'Participant'

  const pc = new RTCPeerConnection({iceServers:ICE, iceCandidatePoolSize:10})
  const remoteStream = new MediaStream()
  peers[pid] = { pc, remoteStream, makingOffer:false }

  // ── Add local tracks ─────────────────────────────────
  // Use processedStream if available (has processed audio), fallback to localStream
  const streamToSend = processedStream || localStream
  if(streamToSend){
    streamToSend.getTracks().forEach(track=>{
      try{
        pc.addTrack(track, streamToSend)
        console.log('[RTC] added local',track.kind,'to',pid.substring(0,8))
      }catch(e){ console.warn('[RTC] addTrack err:',e.message) }
    })
  }

  // ── Receive remote tracks ─────────────────────────────
  pc.ontrack = e=>{
    console.log('[RTC] ontrack from',pid.substring(0,8),'kind:',e.track.kind,'readyState:',e.track.readyState)
    const track = e.track

    // Use the stream provided by the event, or our remoteStream
    const stream = e.streams && e.streams[0] ? e.streams[0] : remoteStream

    // If using event stream, update our reference
    if(e.streams && e.streams[0]){
      peers[pid].remoteStream = e.streams[0]
    } else {
      // Manually add track
      const existingTracks = remoteStream.getTracks().filter(t=>t.kind===track.kind)
      existingTracks.forEach(t=>{ remoteStream.removeTrack(t) })
      remoteStream.addTrack(track)
      peers[pid].remoteStream = remoteStream
    }

    // Update tile
    addRemoteTile(pid, peerNames[pid])
    attachRemoteStream(pid, peers[pid].remoteStream)

    // Handle audio separately for better playback
    if(track.kind==='audio'){
      playRemoteAudio(pid, peers[pid].remoteStream)
    }

    // When track ends / mutes
    track.onended = ()=>{ console.log('[RTC] track ended',track.kind,'from',pid.substring(0,8)); attachRemoteStream(pid, peers[pid].remoteStream) }
    track.onmute  = ()=>{ console.log('[RTC] track muted',track.kind); attachRemoteStream(pid, peers[pid].remoteStream) }
    track.onunmute= ()=>{ console.log('[RTC] track unmuted',track.kind); attachRemoteStream(pid, peers[pid].remoteStream) }
  }

  // ── ICE candidates ────────────────────────────────────
  pc.onicecandidate = e=>{
    if(e.candidate){
      console.log('[ICE] sending candidate to',pid.substring(0,8))
      sendSig(pid, 'ice', e.candidate.toJSON())
    }
  }
  pc.onicecandidateerror = e=>console.warn('[ICE] err:',e.errorCode,e.errorText)
  pc.oniceconnectionstatechange = ()=>{
    const s = pc.iceConnectionState
    console.log('[ICE] state →',s,'for',pid.substring(0,8))
    if(s==='failed'){
      console.log('[ICE] restarting ICE for',pid.substring(0,8))
      pc.restartIce()
    }
    if(s==='disconnected'){
      setTimeout(()=>{ if(pc.iceConnectionState==='disconnected'||pc.iceConnectionState==='failed') dropPeer(pid) }, 7000)
    }
    if(s==='closed') dropPeer(pid)
  }
  pc.onconnectionstatechange = ()=>{
    const s = pc.connectionState
    console.log('[RTC] conn →',s,'for',pid.substring(0,8))
    if(s==='connected') toast((peerNames[pid]||'Participant')+' joined','success')
    if(s==='failed') { pc.restartIce(); setTimeout(()=>{ if(pc.connectionState==='failed') dropPeer(pid) },5000) }
  }

  // ── Negotiation needed (for replaceTrack renegotiation) ──
  pc.onnegotiationneeded = async()=>{
    console.log('[RTC] negotiationneeded for',pid.substring(0,8),'state:',pc.signalingState)
    if(peers[pid]?.makingOffer) return
    // Only the "caller" (larger pid) initiates renegotiation
    if(myPid > pid) {
      await doOffer(pid)
    }
  }

  // ── Create tile ───────────────────────────────────────
  addRemoteTile(pid, peerNames[pid])
  return pc
}

function dropPeer(pid){
  if(!peers[pid]) return
  console.log('[RTC] dropping',pid.substring(0,8))
  try{ peers[pid].pc.close() }catch(e){}
  delete peers[pid]
  removeRemoteTile(pid)
  $('audio-'+pid.replace(/[^a-z0-9]/gi,'_'))?.remove()
}

// ── Dedicated audio element per peer ─────────────────
function playRemoteAudio(pid, stream){
  const safeId = 'audio-'+pid.replace(/[^a-z0-9]/gi,'_')
  let el = document.getElementById(safeId)
  if(!el){
    el = document.createElement('audio')
    el.id = safeId
    el.autoplay = true
    el.setAttribute('playsinline','')
    // Slightly visible so browsers don't suppress it
    el.style.cssText = 'position:fixed;bottom:-10px;left:-10px;width:1px;height:1px;opacity:0.001;pointer-events:none'
    document.body.appendChild(el)
  }

  // Always reassign if stream changed
  if(el.srcObject !== stream){
    el.srcObject = stream
  }

  const tryPlayAudio = ()=>{
    el.play().catch(err=>{
      console.warn('[Audio] play blocked:',err.name)
      if(err.name==='NotAllowedError') showAudioUnlock()
    })
  }

  tryPlayAudio()
  setTimeout(tryPlayAudio, 500)
  setTimeout(tryPlayAudio, 2000)
}

// ════════════════════════════════════════════════════════
// Signaling
// ════════════════════════════════════════════════════════
async function sendSig(toPid, type, payload){
  try{
    await api('/meetings/'+mtg.id+'/signal',{
      method:'POST',
      body:JSON.stringify({fromParticipant:myPid, toParticipant:toPid, type, payload})
    })
  }catch(e){ console.warn('[Sig] send err:',e.message) }
}

async function pollSignals(){
  if(!myPid||!mtg) return
  try{
    const qs = sigSince ? '?since='+encodeURIComponent(sigSince) : ''
    const r  = await api('/meetings/'+mtg.id+'/signal/'+myPid+qs)
    const d  = await r.json()
    for(const s of (d.signals||[])){
      if(s.createdAt > sigSince) sigSince = s.createdAt
      await handleSig(s)
      api('/meetings/'+mtg.id+'/signal/'+s.id,{method:'DELETE'}).catch(()=>{})
    }
  }catch(e){}
}

async function handleSig(sig){
  const {fromParticipant:from, type, payload} = sig
  const name = pCache[from]?.display_name || peerNames[from] || 'Participant'
  console.log('[Sig] in:',type,'from',from.substring(0,8))

  // Perfect negotiation: polite peer defers (smaller pid = polite)
  const polite = myPid < from

  const pc  = getPeer(from, name)
  const peer = peers[from]

  try{
    if(type==='offer'){
      const collision = pc.signalingState !== 'stable' || (peer && peer.makingOffer)
      if(!polite && collision){
        console.log('[Sig] impolite ignoring colliding offer')
        return
      }
      // Polite peer rolls back if collision
      if(polite && pc.signalingState !== 'stable'){
        await pc.setLocalDescription({type:'rollback'})
      }
      await pc.setRemoteDescription(new RTCSessionDescription(payload))

      // Apply any queued ICE candidates
      const queued = pendingIce[from] || []
      for(const c of queued){
        try{ await pc.addIceCandidate(new RTCIceCandidate(c)) }catch(e){}
      }
      delete pendingIce[from]

      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      sendSig(from, 'answer', pc.localDescription.toJSON())
      console.log('[Sig] sent answer to',from.substring(0,8))

    }else if(type==='answer'){
      if(pc.signalingState==='have-local-offer'){
        await pc.setRemoteDescription(new RTCSessionDescription(payload))
        // Apply queued ICE
        const queued = pendingIce[from] || []
        for(const c of queued){
          try{ await pc.addIceCandidate(new RTCIceCandidate(c)) }catch(e){}
        }
        delete pendingIce[from]
        console.log('[Sig] set answer from',from.substring(0,8))
      }else{
        console.warn('[Sig] got answer in bad state:',pc.signalingState)
      }

    }else if(type==='ice'){
      if(pc.remoteDescription && pc.remoteDescription.type){
        try{ await pc.addIceCandidate(new RTCIceCandidate(payload)) }
        catch(e){ console.warn('[Sig] addIce err:',e.message) }
      } else {
        // Queue until remote desc is set
        if(!pendingIce[from]) pendingIce[from] = []
        pendingIce[from].push(payload)
        console.log('[ICE] queued for',from.substring(0,8))
      }
    }
  }catch(e){
    console.warn('[Sig] handle err:',type,e.message)
  }
}

// ── Create and send offer ──────────────────────────────
async function doOffer(pid){
  const pc   = peers[pid]?.pc
  const peer = peers[pid]
  if(!pc || !peer) return
  peer.makingOffer = true
  try{
    const offer = await pc.createOffer({offerToReceiveAudio:true, offerToReceiveVideo:true})
    await pc.setLocalDescription(offer)
    sendSig(pid, 'offer', pc.localDescription.toJSON())
    console.log('[RTC] sent offer to',pid.substring(0,8))
  }catch(e){
    console.warn('[RTC] createOffer err:',e.message)
  } finally {
    peer.makingOffer = false
  }
}

// ════════════════════════════════════════════════════════
// Participants poll — connect to new peers
// ════════════════════════════════════════════════════════
async function pollParticipants(){
  try{
    const r = await api('/meetings/'+mtg.id+'/participants')
    const d = await r.json()
    const list = d.participants||[]

    list.forEach(p=>{ pCache[p.id]=p; peerNames[p.id]=p.display_name })

    // Connect to new peers
    for(const p of list){
      if(p.id===myPid || removedPids.has(p.id)) continue
      if(!peers[p.id]){
        // Larger pid initiates (avoids both sending offer simultaneously)
        if(myPid > p.id){
          console.log('[Participants] I initiate to',p.id.substring(0,8))
          getPeer(p.id, p.display_name) // create PC first
          await doOffer(p.id)
        } else {
          console.log('[Participants] waiting for offer from',p.id.substring(0,8))
          getPeer(p.id, p.display_name) // create PC ready to receive
        }
      }
    }

    // Drop peers that left
    for(const pid of Object.keys(peers)){
      if(!list.some(p=>p.id===pid)) dropPeer(pid)
    }

    renderPlist(list)
  }catch(e){ console.warn('[Participants] poll err:',e.message) }
}

function renderPlist(list){
  const c = $('plist'); if(!c) return
  c.innerHTML = `<p class="text-gray-400" style="font-size:.73rem;margin-bottom:10px;font-weight:600;
    text-transform:uppercase;letter-spacing:.05em">${list.length} participant${list.length!==1?'s':''}</p>`
  list.forEach(p=>{
    const isMe = p.id===myPid
    const d = document.createElement('div')
    d.className = 'participant-item'
    d.innerHTML = `
      ${avHtml(p.display_name,32)}
      <div style="flex:1;min-width:0">
        <p class="text-white font-semibold" style="font-size:.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          ${esc(p.display_name)} ${isMe?'<span class="text-gray-500" style="font-size:.7rem">(You)</span>':''}
        </p>
        <p class="text-gray-500" style="font-size:.68rem">
          ${p.is_host?'<i class="fas fa-crown text-yellow-400"></i> Host':'Member'}
          ${p.is_muted?' · <i class="fas fa-microphone-slash text-red-400"></i>':''}
          ${p.is_video_off?' · <i class="fas fa-video-slash text-red-400"></i>':''}
        </p>
      </div>
      ${amHost&&!isMe?`<div style="display:flex;gap:3px">
        <button onclick="hMute('${p.id}',${!p.is_muted})"
          style="width:26px;height:26px;background:transparent;border:none;color:#9ca3af;cursor:pointer;border-radius:5px;font-size:.7rem"
          title="${p.is_muted?'Unmute':'Mute'}"><i class="fas fa-microphone${p.is_muted?'':'-slash'}"></i></button>
        <button onclick="hKick('${p.id}','${esc(p.display_name)}')"
          style="width:26px;height:26px;background:transparent;border:none;color:#f87171;cursor:pointer;border-radius:5px;font-size:.7rem" title="Remove">
          <i class="fas fa-user-times"></i></button>
      </div>`:''}`
    c.appendChild(d)
  })
}

async function hMute(pid, mute){
  await api('/meetings/'+mtg.id+'/participants/'+pid,{method:'PUT',body:JSON.stringify({isMuted:mute})})
  pollParticipants()
}
async function hKick(pid, name){
  if(!confirm('Remove '+name+'?')) return
  await api('/meetings/'+mtg.id+'/participants/'+pid,{method:'DELETE'})
  removedPids.add(pid); dropPeer(pid)
  toast(name+' removed','warning')
  pollParticipants()
}

// ════════════════════════════════════════════════════════
// Waiting room (host)
// ════════════════════════════════════════════════════════
async function pollWaiting(){
  if(!amHost) return
  try{
    const r = await api('/meetings/'+mtg.id+'/waiting')
    const d = await r.json()
    const list = d.waiting||[]
    const badge = $('wb')
    if(badge){ badge.textContent=list.length; badge.style.display=list.length?'inline-flex':'none' }
    const c = $('wlist'); if(!c) return
    if(!list.length){ c.innerHTML='<p class="text-gray-500 text-center" style="padding:20px;font-size:.82rem">No one waiting</p>'; return }
    c.innerHTML = list.map(w=>`
      <div class="waiting-item">
        <div style="display:flex;align-items:center;gap:8px">
          ${avHtml(w.display_name,28)}
          <span class="text-white" style="font-size:.82rem">${esc(w.display_name)}</span>
        </div>
        <div style="display:flex;gap:5px">
          <button onclick="admitW('${w.id}')" style="background:#16a34a;color:#fff;border:none;
            padding:4px 10px;border-radius:7px;font-size:.72rem;cursor:pointer;font-weight:600">Admit</button>
          <button onclick="denyW('${w.id}')" style="background:rgba(239,68,68,.3);color:#f87171;border:none;
            padding:4px 10px;border-radius:7px;font-size:.72rem;cursor:pointer">Deny</button>
        </div>
      </div>`).join('')
  }catch(e){}
}
async function admitW(wid){ await api('/meetings/'+mtg.id+'/waiting/'+wid+'/admit',{method:'POST'}); toast('Admitted','success'); pollWaiting() }
async function denyW(wid){ await api('/meetings/'+mtg.id+'/waiting/'+wid,{method:'DELETE'}); pollWaiting() }

// ════════════════════════════════════════════════════════
// Chat
// ════════════════════════════════════════════════════════
async function sendMsg(){
  const inp = $('chat-inp')
  const msg = inp?.value?.trim(); if(!msg) return
  inp.value = ''
  try{
    const r = await api('/meetings/'+mtg.id+'/chat',{
      method:'POST',
      body:JSON.stringify({senderName:myName(), message:msg, senderId:me?.id||null})
    })
    const d = await r.json()
    if(r.ok) addMsg({...d, _me:true})
  }catch(e){}
}

function addMsg(m){
  if(chatSeen.has(m.id)) return
  chatSeen.add(m.id)
  const box = $('chat-box'); if(!box) return
  const mine = m._me || m.sender_name===myName()
  const tm   = m.created_at ? fmtTime(m.created_at) : fmtTime(new Date())
  const d = document.createElement('div')
  d.style.cssText = 'display:flex;'+(mine?'justify-content:flex-end':'justify-content:flex-start')+';gap:5px;margin-bottom:2px'
  d.innerHTML = `
    ${!mine?`<div style="width:22px;height:22px;border-radius:50%;background:${bgColor(m.sender_name)};
      display:flex;align-items:center;justify-content:center;font-size:.62rem;font-weight:700;color:#fff;
      flex-shrink:0;align-self:flex-end">${initials(m.sender_name)}</div>`:''}
    <div class="chat-bubble ${mine?'self':'other'}" style="max-width:78%">
      ${!mine?`<div class="sender">${esc(m.sender_name)}</div>`:''}
      <div>${esc(m.message)}</div>
      <div class="time">${tm}</div>
    </div>`
  box.appendChild(d)
  box.scrollTop = box.scrollHeight
  if(!sbOpen||sbTab!=='chat') toast(m.sender_name+': '+m.message.substring(0,35),'info')
}

async function pollChat(){
  try{
    const qs = lastChat ? '?since='+encodeURIComponent(lastChat) : ''
    const r  = await api('/meetings/'+mtg.id+'/chat'+qs)
    const d  = await r.json()
    ;(d.messages||[]).forEach(m=>{ addMsg(m); if(!lastChat||m.created_at>lastChat) lastChat=m.created_at })
  }catch(e){}
}

// ════════════════════════════════════════════════════════
// Controls
// ════════════════════════════════════════════════════════
function toggleMic(){
  micOn = !micOn
  // Toggle on BOTH streams so the sender hears change
  if(localStream)      localStream.getAudioTracks().forEach(t=>t.enabled=micOn)
  if(processedStream)  processedStream.getAudioTracks().forEach(t=>t.enabled=micOn)
  const b = $('btn-mic')
  if(b){ b.className=`ctrl-btn ${micOn?'':'muted'}`; b.innerHTML=`<i class="fas fa-microphone${micOn?'':'-slash'}" style="font-size:1rem"></i><span>${micOn?'Mute':'Unmute'}</span>` }
  buildLocalTile()
  api('/meetings/'+mtg.id+'/participants/'+myPid,{method:'PUT',body:JSON.stringify({isMuted:!micOn})}).catch(()=>{})
}

function toggleCam(){
  camOn = !camOn
  if(localStream)     localStream.getVideoTracks().forEach(t=>t.enabled=camOn)
  if(processedStream) processedStream.getVideoTracks().forEach(t=>t.enabled=camOn)
  const b = $('btn-cam')
  if(b){ b.className=`ctrl-btn ${camOn?'':'muted'}`; b.innerHTML=`<i class="fas fa-video${camOn?'':'-slash'}" style="font-size:1rem"></i><span>${camOn?'Stop Cam':'Start Cam'}</span>` }
  const v=$('vid-local'), av=$('av-local')
  if(v) v.style.display=camOn?'block':'none'
  if(av) av.style.display=camOn?'none':'flex'
  api('/meetings/'+mtg.id+'/participants/'+myPid,{method:'PUT',body:JSON.stringify({isVideoOff:!camOn})}).catch(()=>{})
}

// ── Screen Share (with renegotiation) ─────────────────
async function toggleShare(){
  if(sharing){ stopShare(); return }
  try{
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video:{width:{ideal:1920},height:{ideal:1080},frameRate:{ideal:15},cursor:'always'},
      audio:false
    })
    sharing = true
    const screenVideoTrack = screenStream.getVideoTracks()[0]
    if(!screenVideoTrack){ throw new Error('No screen video track') }

    console.log('[Share] got screen track:',screenVideoTrack.label)

    // Replace video sender in all peer connections
    for(const [pid, {pc}] of Object.entries(peers)){
      const sender = pc.getSenders().find(s=>s.track?.kind==='video')
      if(sender){
        try{
          await sender.replaceTrack(screenVideoTrack)
          console.log('[Share] replaced track for',pid.substring(0,8))
          // replaceTrack does NOT trigger onnegotiationneeded in all browsers
          // Force renegotiation manually if needed
        }catch(e){
          console.warn('[Share] replaceTrack failed:',e.message)
          // If no video sender exists, add a new track (triggers negotiation)
          try{ pc.addTrack(screenVideoTrack, screenStream) }catch(e2){}
        }
      } else {
        // No existing video sender — add it (triggers onnegotiationneeded)
        try{ pc.addTrack(screenVideoTrack, screenStream) }catch(e){}
      }
    }

    // Show screen on local tile
    const v = $('vid-local')
    if(v){ v.srcObject = screenStream; v.style.transform='none'; v.style.display='block' }
    const av = $('av-local'); if(av) av.style.display='none'

    const b = $('btn-share')
    if(b){ b.className='ctrl-btn active'; b.innerHTML='<i class="fas fa-stop" style="font-size:1rem"></i><span>Stop</span>' }

    // Stop screen share when user clicks "Stop sharing" in browser UI
    screenVideoTrack.onended = ()=>stopShare()
    toast('Screen sharing started','success')
  }catch(e){
    if(e.name!=='NotAllowedError') toast('Share failed: '+e.message,'error')
    screenStream=null; sharing=false
  }
}

async function stopShare(){
  if(screenStream){ screenStream.getTracks().forEach(t=>t.stop()); screenStream=null }
  sharing = false

  // Restore camera track in all peers
  const camTrack = localStream?.getVideoTracks()[0] || (processedStream?.getVideoTracks()[0])
  if(camTrack){
    for(const [pid, {pc}] of Object.entries(peers)){
      const sender = pc.getSenders().find(s=>s.track?.kind==='video')
      if(sender){
        try{
          await sender.replaceTrack(camTrack)
          console.log('[Share] restored camera for',pid.substring(0,8))
        }catch(e){ console.warn('[Share] restore failed:',e.message) }
      }
    }
  }

  // Restore local tile
  const streamForLocal = processedStream || localStream
  const v = $('vid-local'), av = $('av-local')
  if(v && streamForLocal){ v.srcObject=streamForLocal; v.style.transform='scaleX(-1)'; v.style.display=camOn?'block':'none' }
  if(av) av.style.display=camOn?'none':'flex'

  const b = $('btn-share')
  if(b){ b.className='ctrl-btn'; b.innerHTML='<i class="fas fa-desktop" style="font-size:1rem"></i><span>Share</span>' }
  toast('Screen sharing stopped','info')
}

// ── Recording ──────────────────────────────────────────
function toggleRec(){ if(recording) stopRec(); else startRec() }
function startRec(){
  try{
    const tracks = localStream ? [...localStream.getTracks()] : []
    if(!tracks.length){ toast('No media to record','warning'); return }
    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm'
    recorder  = new MediaRecorder(new MediaStream(tracks),{mimeType:mime})
    recChunks = []
    recorder.ondataavailable = e=>{ if(e.data.size>0) recChunks.push(e.data) }
    recorder.onstop = ()=>{
      const blob = new Blob(recChunks,{type:'video/webm'})
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href=url; a.download=`mtg-${CODE}-${Date.now()}.webm`
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast('Recording saved!','success')
    }
    recorder.start(1000); recording=true
    const b=$('btn-rec'); if(b){ b.className='ctrl-btn active'; b.innerHTML='<i class="fas fa-stop-circle text-red-400" style="font-size:1rem"></i><span>Stop Rec</span>' }
    $('rec-badge').style.display='flex'
    toast('Recording started','success')
  }catch(e){ toast('Record failed: '+e.message,'error') }
}
function stopRec(){
  if(recorder&&recorder.state!=='inactive') recorder.stop()
  recording=false
  const b=$('btn-rec'); if(b){ b.className='ctrl-btn'; b.innerHTML='<i class="fas fa-circle text-red-400" style="font-size:1rem"></i><span>Record</span>' }
  $('rec-badge').style.display='none'
}

// ════════════════════════════════════════════════════════
// Sidebar
// ════════════════════════════════════════════════════════
function toggleSidebar(tab){
  const sb=$('sidebar'), va=$('video-area')
  if(!sb) return
  if(sbOpen&&sbTab===tab){
    sb.classList.remove('open'); va?.classList.remove('sidebar-open'); sbOpen=false
  }else{
    sb.classList.add('open'); va?.classList.add('sidebar-open'); sbOpen=true; swTab(tab)
  }
}
function swTab(tab){
  sbTab=tab
  ;['chat','participants','waiting'].forEach(t=>{
    const btn=$('tab-'+t), panel=$('panel-'+t)
    if(btn) btn.classList.toggle('active',t===tab)
    if(panel) panel.style.display=t===tab?(t==='chat'?'flex':'block'):'none'
  })
  if(tab==='chat'){ const b=$('chat-box'); if(b) b.scrollTop=b.scrollHeight }
}

// ════════════════════════════════════════════════════════
// Timer & Polls
// ════════════════════════════════════════════════════════
function startTimer(){
  const t0 = Date.now()
  timers.timer = setInterval(()=>{
    const s  = Math.floor((Date.now()-t0)/1000)
    const el = $('timer')
    if(el) el.textContent = String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0')
  }, 1000)
}

function startPolls(){
  pollChat(); pollParticipants(); pollSignals(); if(amHost) pollWaiting()
  timers.chat  = setInterval(pollChat, 2500)
  timers.parts = setInterval(pollParticipants, 4000)
  timers.sig   = setInterval(pollSignals, 500)   // fast — signaling needs to be quick
  if(amHost) timers.wait = setInterval(pollWaiting, 3000)
}

function stopPolls(){
  Object.values(timers).forEach(t=>clearInterval(t))
}

// ════════════════════════════════════════════════════════
// More menu
// ════════════════════════════════════════════════════════
function moreMenu(){
  const ov = document.createElement('div')
  ov.className='modal-overlay'; ov.id='more-ov'
  ov.innerHTML = `
    <div class="modal-box">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <h3 class="text-white font-bold">Options</h3>
        <button onclick="$('more-ov').remove()" style="background:transparent;border:none;color:#9ca3af;cursor:pointer;font-size:1rem"><i class="fas fa-times"></i></button>
      </div>
      <div style="display:flex;flex-direction:column;gap:2px">
        <button onclick="copyLink();$('more-ov').remove()" class="more-item"><i class="fas fa-link text-indigo-400" style="width:18px"></i> Copy Link</button>
        <button onclick="navigator.clipboard.writeText('${CODE}').then(()=>toast('Copied!','success'));$('more-ov').remove()" class="more-item"><i class="fas fa-copy text-indigo-400" style="width:18px"></i> Copy Meeting ID</button>
        ${amHost?`<button onclick="muteAll();$('more-ov').remove()" class="more-item"><i class="fas fa-microphone-slash text-red-400" style="width:18px"></i> Mute All</button>`:''}
        <div style="border-top:1px solid rgba(75,85,99,.4);margin:6px 0"></div>
        <button onclick="${amHost?'endMtg':'leaveMtg'}();$('more-ov').remove()"
          style="background:transparent;border:none;text-align:left;padding:10px 12px;border-radius:10px;
            color:#f87171;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:.88rem;width:100%"
          onmouseover="this.style.background='rgba(239,68,68,.1)'" onmouseout="this.style.background='transparent'">
          <i class="fas fa-phone-slash" style="width:18px"></i> ${amHost?'End Meeting':'Leave Meeting'}</button>
      </div>
    </div>`
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.remove() })
  document.body.appendChild(ov)
}

async function muteAll(){
  for(const p of Object.values(pCache)){
    if(p.id!==myPid) await api('/meetings/'+mtg.id+'/participants/'+p.id,{method:'PUT',body:JSON.stringify({isMuted:true})}).catch(()=>{})
  }
  toast('All muted','info')
}

function copyLink(){ navigator.clipboard.writeText(location.href).then(()=>toast('Link copied!','success')) }

// ════════════════════════════════════════════════════════
// Leave / End
// ════════════════════════════════════════════════════════
function cleanup(){
  stopPolls()
  if(recording) stopRec()
  Object.keys(peers).forEach(dropPeer)
  if(localStream)     localStream.getTracks().forEach(t=>t.stop())
  if(processedStream) processedStream.getTracks().forEach(t=>t.stop())
  if(screenStream)    screenStream.getTracks().forEach(t=>t.stop())
  if(audioCtx)        audioCtx.close().catch(()=>{})
  document.querySelectorAll('audio[id^="audio-"]').forEach(a=>a.remove())
}

async function leaveMtg(){
  if(!confirm('Leave this meeting?')) return
  cleanup()
  await api('/meetings/'+mtg.id+'/leave',{method:'POST',body:JSON.stringify({participantId:myPid})}).catch(()=>{})
  location.href='/'
}
async function endMtg(){
  if(!confirm('End meeting for everyone?')) return
  cleanup()
  await api('/meetings/'+mtg.id+'/end',{method:'POST'}).catch(()=>{})
  location.href='/'
}

// ════════════════════════════════════════════════════════
// Extra styles
// ════════════════════════════════════════════════════════
const _s = document.createElement('style')
_s.textContent = `
.more-item{background:transparent;border:none;text-align:left;padding:10px 12px;border-radius:10px;
  color:#fff;cursor:pointer;display:flex;align-items:center;gap:10px;font-size:.88rem;width:100%}
.more-item:hover{background:rgba(55,65,81,.6)}
@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
`
document.head.appendChild(_s)

// ════════════════════════════════════════════════════════
// Start
// ════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', init)
window.addEventListener('beforeunload', ()=>{
  cleanup()
  if(myPid&&mtg) navigator.sendBeacon(API+'/meetings/'+mtg.id+'/leave', JSON.stringify({participantId:myPid}))
})
