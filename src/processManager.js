import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const BOTS_DIR = path.join(__dirname, '..', 'bots')
const INSTANCES_DIR = path.join(__dirname, '..', 'instances')

if (!fs.existsSync(INSTANCES_DIR)) fs.mkdirSync(INSTANCES_DIR, { recursive: true })

// Daftar SC (source code) yang tersedia untuk dipilih.
// Tambah entri baru di sini kalau nanti mau nambah SC lain — folder-nya taruh di /bots/<id>/
export const AVAILABLE_SC = {
  'adin-md': {
    name: 'Adin MD',
    folder: 'adin-md',
    entry: 'main.js'
  }
}

// instances: Map<id, { id, phone, scId, child, status, logs: [], pairingCode, createdAt }>
const instances = new Map()
const MAX_LOG_LINES = 300

function sanitizePhone(phone) {
  return String(phone || '').replace(/[^0-9]/g, '')
}

function makeId(scId, phone) {
  return `${scId}_${sanitizePhone(phone)}`
}

function pushLog(instance, line) {
  instance.logs.push({ t: Date.now(), line })
  if (instance.logs.length > MAX_LOG_LINES) instance.logs.shift()
  instance.listeners?.forEach(fn => {
    try { fn(line) } catch {}
  })
}

export function getInstance(id) {
  return instances.get(id)
}

export function listInstances() {
  return [...instances.values()].map(i => ({
    id: i.id,
    phone: i.phone,
    scId: i.scId,
    status: i.status,
    createdAt: i.createdAt
  }))
}

export function countActive() {
  return [...instances.values()].filter(i => i.status !== 'stopped' && i.status !== 'logged_out').length
}

export function startInstance({ phone, scId = 'adin-md' }) {
  const sc = AVAILABLE_SC[scId]
  if (!sc) throw new Error(`SC "${scId}" tidak ditemukan`)

  const phoneDigits = sanitizePhone(phone)
  if (!/^\d{8,15}$/.test(phoneDigits)) throw new Error('Nomor WhatsApp tidak valid')

  const id = makeId(scId, phoneDigits)

  const existing = instances.get(id)
  if (existing && existing.status !== 'stopped' && existing.status !== 'logged_out') {
    return existing
  }

  const sessionPath = path.join(INSTANCES_DIR, id)
  const botCwd = path.join(BOTS_DIR, sc.folder)

  if (!fs.existsSync(botCwd)) {
    throw new Error(`Folder source code untuk "${scId}" belum ada di server (bots/${sc.folder}). Upload dulu SC-nya.`)
  }

  const instance = {
    id,
    phone: phoneDigits,
    scId,
    status: 'connecting',
    pairingCode: null,
    logs: [],
    listeners: new Set(),
    createdAt: Date.now(),
    child: null
  }
  instances.set(id, instance)

  const child = spawn('node', [sc.entry], {
    cwd: botCwd,
    env: {
      ...process.env,
      JADIBOT_SUBBOT: '1',
      JADIBOT_SESSION_PATH: sessionPath,
      JADIBOT_PAIRING_NUMBER: phoneDigits
    }
  })

  instance.child = child

  child.stdout.on('data', chunk => {
    const text = chunk.toString()
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/\x1b\[[0-9;]*m/g, '').trim() // buang kode warna ANSI
      if (!line) continue

      if (line.includes('JADIBOT_PAIRING_CODE:')) {
        instance.pairingCode = line.split('JADIBOT_PAIRING_CODE:')[1].trim()
        instance.status = 'waiting_pairing'
      } else if (line.includes('JADIBOT_STATUS:connected')) {
        instance.status = 'connected'
      } else if (line.includes('JADIBOT_STATUS:logged_out')) {
        instance.status = 'logged_out'
      }

      pushLog(instance, line)
    }
  })

  child.stderr.on('data', chunk => {
    pushLog(instance, `[error] ${chunk.toString().trim()}`)
  })

  child.on('exit', code => {
    if (instance.status !== 'logged_out') instance.status = 'stopped'
    pushLog(instance, `[system] Proses berhenti (exit code ${code})`)
  })

  return instance
}

export function stopInstance(id) {
  const instance = instances.get(id)
  if (!instance) return false
  try {
    instance.child?.kill()
  } catch {}
  instance.status = 'stopped'
  return true
}

export function deleteInstance(id) {
  const instance = instances.get(id)
  if (instance) {
    try { instance.child?.kill() } catch {}
    instances.delete(id)
  }
  const sessionPath = path.join(INSTANCES_DIR, id)
  if (fs.existsSync(sessionPath)) {
    fs.rmSync(sessionPath, { recursive: true, force: true })
  }
  return true
}

export function subscribeLogs(id, fn) {
  const instance = instances.get(id)
  if (!instance) return () => {}
  instance.listeners.add(fn)
  return () => instance.listeners.delete(fn)
}
