import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import {
  AVAILABLE_SC,
  startInstance,
  stopInstance,
  deleteInstance,
  getInstance,
  listInstances,
  countActive,
  subscribeLogs
} from './processManager.js'
import { requireAuth, getOrCreateUserProfile, recordInstanceOwner, getInstanceOwner } from './firebase.js'

const PORT = process.env.PORT || 3300
const MAX_CONCURRENT_BOTS = Number(process.env.MAX_CONCURRENT_BOTS || 20)
const RATE_LIMIT_PER_IP_PER_HOUR = Number(process.env.RATE_LIMIT_PER_IP_PER_HOUR || 5)
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)

const app = express()
app.use(express.json())
app.use(cors({
  origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true
}))

// ===== Rate limit sederhana per-IP (in-memory) =====
const rateLimitStore = new Map() // ip -> [timestamps]

function isRateLimited(ip) {
  const now = Date.now()
  const windowMs = 60 * 60 * 1000
  const hits = (rateLimitStore.get(ip) || []).filter(t => now - t < windowMs)
  rateLimitStore.set(ip, hits)
  return hits.length >= RATE_LIMIT_PER_IP_PER_HOUR
}

function recordHit(ip) {
  const hits = rateLimitStore.get(ip) || []
  hits.push(Date.now())
  rateLimitStore.set(ip, hits)
}

// ===== Routes =====

app.get('/api/jadibot/sc-list', (req, res) => {
  const list = Object.entries(AVAILABLE_SC).map(([id, v]) => ({ id, name: v.name }))
  res.json({ ok: true, data: list })
})

// Profil user yang lagi login (role, kedaluwarsa, dll)
app.get('/api/jadibot/me', requireAuth(), async (req, res) => {
  const profile = await getOrCreateUserProfile(req.user.uid, req.user.email)
  res.json({ ok: true, data: profile })
})

app.post('/api/jadibot/start', requireAuth(), async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress
  const { phone, scId } = req.body || {}

  if (!phone) {
    return res.status(400).json({ ok: false, error: 'Nomor WhatsApp wajib diisi' })
  }

  const profile = await getOrCreateUserProfile(req.user.uid, req.user.email)
  if (profile?.expiredAt && profile.expiredAt <= Date.now()) {
    return res.status(403).json({ ok: false, error: 'Masa aktif akun kamu sudah habis. Perpanjang dulu untuk bisa membuat bot.' })
  }

  if (countActive() >= MAX_CONCURRENT_BOTS) {
    return res.status(503).json({ ok: false, error: 'Server sedang penuh, coba lagi beberapa menit lagi.' })
  }

  if (isRateLimited(ip)) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak percobaan. Coba lagi nanti.' })
  }

  try {
    const instance = startInstance({ phone, scId })
    await recordInstanceOwner(instance.id, req.user.uid)
    recordHit(ip)
    res.json({
      ok: true,
      data: { id: instance.id, status: instance.status, pairingCode: instance.pairingCode }
    })
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message })
  }
})

async function assertOwner(req, res, id) {
  const ownerUid = await getInstanceOwner(id)
  if (ownerUid && ownerUid !== req.user.uid) {
    res.status(403).json({ ok: false, error: 'Bot ini bukan milik kamu.' })
    return false
  }
  return true
}

app.get('/api/jadibot/status/:id', requireAuth(), async (req, res) => {
  if (!(await assertOwner(req, res, req.params.id))) return
  const instance = getInstance(req.params.id)
  if (!instance) return res.status(404).json({ ok: false, error: 'Instance tidak ditemukan' })

  res.json({
    ok: true,
    data: {
      id: instance.id,
      status: instance.status,
      pairingCode: instance.pairingCode,
      createdAt: instance.createdAt
    }
  })
})

app.post('/api/jadibot/stop/:id', requireAuth(), async (req, res) => {
  if (!(await assertOwner(req, res, req.params.id))) return
  const ok = stopInstance(req.params.id)
  res.json({ ok })
})

app.post('/api/jadibot/delete/:id', requireAuth(), async (req, res) => {
  if (!(await assertOwner(req, res, req.params.id))) return
  const ok = deleteInstance(req.params.id)
  res.json({ ok })
})

// Admin-only sebenarnya, tapi dibiarkan perlu login dulu minimal
app.get('/api/jadibot/list', requireAuth(), (req, res) => {
  res.json({ ok: true, data: listInstances() })
})

// Live log streaming pakai Server-Sent Events
app.get('/api/jadibot/logs/:id', requireAuth(), async (req, res) => {
  if (!(await assertOwner(req, res, req.params.id))) return
  const instance = getInstance(req.params.id)
  if (!instance) return res.status(404).end()

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  })

  // kirim log yang udah ada dulu
  for (const { line } of instance.logs) {
    res.write(`data: ${JSON.stringify({ line })}\n\n`)
  }

  const unsubscribe = subscribeLogs(req.params.id, line => {
    res.write(`data: ${JSON.stringify({ line })}\n\n`)
  })

  req.on('close', unsubscribe)
})

app.get('/api/jadibot/health', (req, res) => {
  res.json({ ok: true, activeBots: countActive(), maxConcurrent: MAX_CONCURRENT_BOTS })
})

app.listen(PORT, () => {
  console.log(`JadiBot Manager jalan di port ${PORT}`)
})
