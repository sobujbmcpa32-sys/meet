import { Hono } from 'hono'
import { generateId, generateMeetingCode, hashPassword, generateToken, getAvatarColor } from '../lib/utils'

type Bindings = { DB: D1Database }

export const apiRoutes = new Hono<{ Bindings: Bindings }>()

// ─── AUTH ───────────────────────────────────────────────────────

// Register
apiRoutes.post('/auth/register', async (c) => {
  try {
    const { name, email, password } = await c.req.json()
    if (!name || !email || !password) return c.json({ error: 'All fields required' }, 400)

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()
    if (existing) return c.json({ error: 'Email already registered' }, 409)

    const id = generateId()
    const passwordHash = await hashPassword(password)
    const avatarColor = getAvatarColor()

    await c.env.DB.prepare(
      'INSERT INTO users (id, name, email, password_hash, avatar_color) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, name, email, passwordHash, avatarColor).run()

    const token = generateToken()
    const sessionId = generateId()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await c.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, id, expiresAt).run()

    return c.json({ token: sessionId, user: { id, name, email, avatarColor } })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Login
apiRoutes.post('/auth/login', async (c) => {
  try {
    const { email, password } = await c.req.json()
    if (!email || !password) return c.json({ error: 'All fields required' }, 400)

    const user = await c.env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first() as any
    if (!user) return c.json({ error: 'Invalid credentials' }, 401)

    const passwordHash = await hashPassword(password)
    if (user.password_hash !== passwordHash) return c.json({ error: 'Invalid credentials' }, 401)

    const sessionId = generateId()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    await c.env.DB.prepare(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'
    ).bind(sessionId, user.id, expiresAt).run()

    return c.json({
      token: sessionId,
      user: { id: user.id, name: user.name, email: user.email, avatarColor: user.avatar_color }
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get current user
apiRoutes.get('/auth/me', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (!token) return c.json({ error: 'Unauthorized' }, 401)

    const session = await c.env.DB.prepare(
      'SELECT s.*, u.name, u.email, u.avatar_color FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")'
    ).bind(token).first() as any
    if (!session) return c.json({ error: 'Unauthorized' }, 401)

    return c.json({ user: { id: session.user_id, name: session.name, email: session.email, avatarColor: session.avatar_color } })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Logout
apiRoutes.post('/auth/logout', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    if (token) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(token).run()
    }
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── AUTH MIDDLEWARE HELPER ─────────────────────────────────────
async function getUser(db: D1Database, token: string | undefined) {
  if (!token) return null
  const t = token.replace('Bearer ', '')
  const session = await db.prepare(
    'SELECT s.*, u.name, u.email, u.avatar_color FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.id = ? AND s.expires_at > datetime("now")'
  ).bind(t).first() as any
  if (!session) return null
  return { id: session.user_id, name: session.name, email: session.email, avatarColor: session.avatar_color }
}

// ─── MEETINGS ───────────────────────────────────────────────────

// Create meeting
apiRoutes.post('/meetings', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const { title, password, isWaitingRoom, scheduledAt } = await c.req.json()
    if (!title) return c.json({ error: 'Title required' }, 400)

    const id = generateId()
    const meetingCode = generateMeetingCode()

    await c.env.DB.prepare(
      'INSERT INTO meetings (id, title, host_id, meeting_code, password, is_waiting_room_enabled, scheduled_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(id, title, user.id, meetingCode, password || null, isWaitingRoom ? 1 : 0, scheduledAt || null).run()

    return c.json({ id, meetingCode, title })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get meeting by code
apiRoutes.get('/meetings/code/:code', async (c) => {
  try {
    const code = c.req.param('code')
    const meeting = await c.env.DB.prepare(
      'SELECT m.*, u.name as host_name FROM meetings m JOIN users u ON m.host_id = u.id WHERE m.meeting_code = ?'
    ).bind(code).first() as any
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404)
    return c.json({
      id: meeting.id,
      title: meeting.title,
      hostName: meeting.host_name,
      hostId: meeting.host_id,
      meetingCode: meeting.meeting_code,
      hasPassword: !!meeting.password,
      isWaitingRoom: !!meeting.is_waiting_room_enabled,
      status: meeting.status,
      scheduledAt: meeting.scheduled_at
    })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get my meetings
apiRoutes.get('/meetings', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const meetings = await c.env.DB.prepare(
      'SELECT * FROM meetings WHERE host_id = ? ORDER BY created_at DESC LIMIT 20'
    ).bind(user.id).all()

    return c.json({ meetings: meetings.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Start meeting
apiRoutes.post('/meetings/:id/start', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const id = c.req.param('id')
    await c.env.DB.prepare(
      "UPDATE meetings SET status = 'active', started_at = datetime('now') WHERE id = ? AND host_id = ?"
    ).bind(id, user.id).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// End meeting
apiRoutes.post('/meetings/:id/end', async (c) => {
  try {
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    if (!user) return c.json({ error: 'Unauthorized' }, 401)

    const id = c.req.param('id')
    await c.env.DB.prepare(
      "UPDATE meetings SET status = 'ended', ended_at = datetime('now') WHERE id = ? AND host_id = ?"
    ).bind(id, user.id).run()

    // Remove all participants
    await c.env.DB.prepare(
      "UPDATE participants SET status = 'left', left_at = datetime('now') WHERE meeting_id = ? AND status = 'active'"
    ).bind(id).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── PARTICIPANTS ──────────────────────────────────────────────

// Join meeting
apiRoutes.post('/meetings/:id/join', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    const body = await c.req.json()
    const displayName = user?.name || body.displayName || 'Guest'

    const meeting = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(meetingId).first() as any
    if (!meeting) return c.json({ error: 'Meeting not found' }, 404)

    // Check password
    if (meeting.password && body.password !== meeting.password) {
      return c.json({ error: 'Incorrect meeting password' }, 403)
    }

    // Check if waiting room enabled (non-host users go to waiting room)
    const isHost = user && user.id === meeting.host_id
    if (meeting.is_waiting_room_enabled && !isHost) {
      const waitId = generateId()
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO waiting_room (id, meeting_id, user_id, display_name) VALUES (?, ?, ?, ?)'
      ).bind(waitId, meetingId, user?.id || null, displayName).run()
      return c.json({ waitingRoom: true, waitId })
    }

    // Join directly
    const participantId = generateId()
    await c.env.DB.prepare(
      'INSERT INTO participants (id, meeting_id, user_id, display_name, is_host) VALUES (?, ?, ?, ?, ?)'
    ).bind(participantId, meetingId, user?.id || null, displayName, isHost ? 1 : 0).run()

    // Mark meeting active if host
    if (isHost) {
      await c.env.DB.prepare(
        "UPDATE meetings SET status = 'active', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?"
      ).bind(meetingId).run()
    }

    return c.json({ participantId, displayName, isHost: !!isHost })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get participants list
apiRoutes.get('/meetings/:id/participants', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const participants = await c.env.DB.prepare(
      "SELECT * FROM participants WHERE meeting_id = ? AND status = 'active' ORDER BY joined_at ASC"
    ).bind(meetingId).all()
    return c.json({ participants: participants.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Update participant status (mute/video)
apiRoutes.put('/meetings/:id/participants/:pid', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const pid = c.req.param('pid')
    const { isMuted, isVideoOff, isScreenSharing } = await c.req.json()

    let query = 'UPDATE participants SET '
    const updates: string[] = []
    const values: any[] = []

    if (isMuted !== undefined) { updates.push('is_muted = ?'); values.push(isMuted ? 1 : 0) }
    if (isVideoOff !== undefined) { updates.push('is_video_off = ?'); values.push(isVideoOff ? 1 : 0) }
    if (isScreenSharing !== undefined) { updates.push('is_screen_sharing = ?'); values.push(isScreenSharing ? 1 : 0) }

    if (updates.length === 0) return c.json({ error: 'No updates' }, 400)
    query += updates.join(', ') + ' WHERE id = ? AND meeting_id = ?'
    values.push(pid, meetingId)

    await c.env.DB.prepare(query).bind(...values).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Remove participant (host action)
apiRoutes.delete('/meetings/:id/participants/:pid', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const pid = c.req.param('pid')
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)

    const meeting = await c.env.DB.prepare('SELECT host_id FROM meetings WHERE id = ?').bind(meetingId).first() as any
    if (!meeting || !user || meeting.host_id !== user.id) return c.json({ error: 'Unauthorized' }, 403)

    await c.env.DB.prepare(
      "UPDATE participants SET status = 'removed', left_at = datetime('now') WHERE id = ? AND meeting_id = ?"
    ).bind(pid, meetingId).run()

    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Leave meeting
apiRoutes.post('/meetings/:id/leave', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const { participantId } = await c.req.json()
    await c.env.DB.prepare(
      "UPDATE participants SET status = 'left', left_at = datetime('now') WHERE id = ? AND meeting_id = ?"
    ).bind(participantId, meetingId).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── WAITING ROOM ───────────────────────────────────────────────

// Get waiting room list
apiRoutes.get('/meetings/:id/waiting', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    const meeting = await c.env.DB.prepare('SELECT host_id FROM meetings WHERE id = ?').bind(meetingId).first() as any
    if (!meeting || !user || meeting.host_id !== user.id) return c.json({ error: 'Unauthorized' }, 403)

    const waiting = await c.env.DB.prepare(
      'SELECT * FROM waiting_room WHERE meeting_id = ? ORDER BY requested_at ASC'
    ).bind(meetingId).all()
    return c.json({ waiting: waiting.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Admit from waiting room
apiRoutes.post('/meetings/:id/waiting/:wid/admit', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const wid = c.req.param('wid')
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
    const user = await getUser(c.env.DB, token)
    const meeting = await c.env.DB.prepare('SELECT host_id FROM meetings WHERE id = ?').bind(meetingId).first() as any
    if (!meeting || !user || meeting.host_id !== user.id) return c.json({ error: 'Unauthorized' }, 403)

    const waiting = await c.env.DB.prepare('SELECT * FROM waiting_room WHERE id = ?').bind(wid).first() as any
    if (!waiting) return c.json({ error: 'Not found' }, 404)

    const participantId = generateId()
    await c.env.DB.prepare(
      'INSERT INTO participants (id, meeting_id, user_id, display_name, is_host) VALUES (?, ?, ?, ?, 0)'
    ).bind(participantId, meetingId, waiting.user_id, waiting.display_name).run()

    await c.env.DB.prepare('DELETE FROM waiting_room WHERE id = ?').bind(wid).run()
    return c.json({ success: true, participantId })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Deny from waiting room
apiRoutes.delete('/meetings/:id/waiting/:wid', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const wid = c.req.param('wid')
    await c.env.DB.prepare('DELETE FROM waiting_room WHERE id = ? AND meeting_id = ?').bind(wid, meetingId).run()
    return c.json({ success: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Check waiting room status (for guest)
apiRoutes.get('/meetings/:id/waiting/:wid/status', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const wid = c.req.param('wid')
    const still = await c.env.DB.prepare('SELECT id FROM waiting_room WHERE id = ? AND meeting_id = ?').bind(wid, meetingId).first()
    const admitted = await c.env.DB.prepare(
      "SELECT id FROM participants WHERE meeting_id = ? AND status = 'active'"
    ).bind(meetingId).all()

    return c.json({ waiting: !!still })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── CHAT ───────────────────────────────────────────────────────

// Send message
apiRoutes.post('/meetings/:id/chat', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const { senderName, message, senderId } = await c.req.json()
    if (!message?.trim()) return c.json({ error: 'Message required' }, 400)

    const id = generateId()
    await c.env.DB.prepare(
      'INSERT INTO chat_messages (id, meeting_id, sender_id, sender_name, message) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, meetingId, senderId || null, senderName || 'Guest', message.trim()).run()

    return c.json({ id, senderName, message, createdAt: new Date().toISOString() })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Get messages
apiRoutes.get('/meetings/:id/chat', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const since = c.req.query('since')
    let query = 'SELECT * FROM chat_messages WHERE meeting_id = ?'
    const params: any[] = [meetingId]
    if (since) { query += ' AND created_at > ?'; params.push(since) }
    query += ' ORDER BY created_at ASC LIMIT 100'

    const messages = await c.env.DB.prepare(query).bind(...params).all()
    return c.json({ messages: messages.results })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// ─── WEBRTC SIGNALING ────────────────────────────────────────────

// Send a signal (offer / answer / ice-candidate)
apiRoutes.post('/meetings/:id/signal', async (c) => {
  try {
    const meetingId = c.req.param('id')
    const { fromParticipant, toParticipant, type, payload } = await c.req.json()
    if (!fromParticipant || !toParticipant || !type || !payload) {
      return c.json({ error: 'Missing fields' }, 400)
    }
    const id = generateId()
    await c.env.DB.prepare(
      'INSERT INTO webrtc_signals (id, meeting_id, from_participant, to_participant, type, payload) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, meetingId, fromParticipant, toParticipant, type, JSON.stringify(payload)).run()

    // Clean old signals (>2 min) to keep DB small
    await c.env.DB.prepare(
      "DELETE FROM webrtc_signals WHERE meeting_id = ? AND created_at < datetime('now', '-2 minutes')"
    ).bind(meetingId).run()

    return c.json({ id })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Poll signals directed to me
apiRoutes.get('/meetings/:id/signal/:participantId', async (c) => {
  try {
    const meetingId    = c.req.param('id')
    const participantId = c.req.param('participantId')
    const since        = c.req.query('since') || ''

    let query = 'SELECT * FROM webrtc_signals WHERE meeting_id = ? AND to_participant = ?'
    const params: any[] = [meetingId, participantId]
    if (since) { query += ' AND created_at > ?'; params.push(since) }
    query += ' ORDER BY created_at ASC LIMIT 50'

    const rows = await c.env.DB.prepare(query).bind(...params).all() as any
    const signals = (rows.results || []).map((r: any) => ({
      id: r.id,
      fromParticipant: r.from_participant,
      type: r.type,
      payload: JSON.parse(r.payload),
      createdAt: r.created_at
    }))
    return c.json({ signals })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})

// Delete processed signals
apiRoutes.delete('/meetings/:id/signal/:signalId', async (c) => {
  try {
    const signalId = c.req.param('signalId')
    await c.env.DB.prepare('DELETE FROM webrtc_signals WHERE id = ?').bind(signalId).run()
    return c.json({ ok: true })
  } catch (e: any) {
    return c.json({ error: e.message }, 500)
  }
})
