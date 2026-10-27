import admin from 'firebase-admin'
import fs from 'fs'

let app = null
let db = null

export function initFirebase() {
  if (app) return { app, db }

  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json'

  if (!fs.existsSync(keyPath)) {
    console.warn('[firebase] File service account tidak ditemukan di', keyPath)
    console.warn('[firebase] Login & database user TIDAK AKTIF sampai file ini ada.')
    return { app: null, db: null }
  }

  const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf-8'))

  app = admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  })

  db = admin.firestore()

  console.log('[firebase] Firebase Admin siap, Firestore terhubung.')
  return { app, db }
}

export function getDb() {
  if (!db) initFirebase()
  return db
}

// Middleware Express: cek header Authorization: Bearer <idToken> dari Firebase Auth.
// Untuk endpoint SSE (EventSource browser nggak bisa kirim header custom), token
// juga boleh dikirim lewat query string ?token=xxx.
export function requireAuth() {
  return async (req, res, next) => {
    if (!app) initFirebase()
    if (!app) {
      return res.status(503).json({ ok: false, error: 'Login belum dikonfigurasi di server (Firebase belum disetup).' })
    }

    const header = req.headers.authorization || ''
    const token = (header.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token || null

    if (!token) {
      return res.status(401).json({ ok: false, error: 'Belum login.' })
    }

    try {
      const decoded = await admin.auth().verifyIdToken(token)
      req.user = { uid: decoded.uid, email: decoded.email || null }
      next()
    } catch (e) {
      return res.status(401).json({ ok: false, error: 'Token login tidak valid atau kedaluwarsa.' })
    }
  }
}

// Ambil / buat profil user di Firestore (role, kedaluwarsa, dll)
export async function getOrCreateUserProfile(uid, email) {
  const firestore = getDb()
  if (!firestore) return null

  const ref = firestore.collection('users').doc(uid)
  const snap = await ref.get()

  if (snap.exists) return snap.data()

  const defaultProfile = {
    email: email || null,
    role: 'free',
    expiredAt: null, // null = tidak ada batas / belum punya plan berbayar
    createdAt: Date.now()
  }

  await ref.set(defaultProfile)
  return defaultProfile
}

export async function getUserProfile(uid) {
  const firestore = getDb()
  if (!firestore) return null
  const snap = await firestore.collection('users').doc(uid).get()
  return snap.exists ? snap.data() : null
}

// Simpan kepemilikan instance bot supaya ketauan punya siapa
export async function recordInstanceOwner(instanceId, uid) {
  const firestore = getDb()
  if (!firestore) return
  await firestore.collection('instances').doc(instanceId).set({
    uid,
    updatedAt: Date.now()
  }, { merge: true })
}

export async function getInstanceOwner(instanceId) {
  const firestore = getDb()
  if (!firestore) return null
  const snap = await firestore.collection('instances').doc(instanceId).get()
  return snap.exists ? snap.data().uid : null
}
