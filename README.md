# JadiBot Manager (Backend)

Ini adalah "otak" dari fitur JadiBot — dia yang beneran menyalakan bot baru tiap ada
orang mendaftar lewat website. Jalan di salah satu panel Pterodactyl kamu (bukan Vercel,
karena harus nyala 24/7).

## Cara pasang

1. Buat server Node.js baru di salah satu panel Pterodactyl kamu, upload semua isi
   folder `jadibot-manager` ini ke sana.

2. **Taruh source code Adin MD di dalamnya.** Copy seluruh folder bot Adin MD kamu
   (yang isinya `main.js`, `plugins/`, `config.js`, dll) ke:

   ```
   jadibot-manager/bots/adin-md/
   ```

   Jadi strukturnya jadi begini:
   ```
   jadibot-manager/
     bots/
       adin-md/
         main.js
         config.js
         plugins/
         lib/
         ...
   ```

   PENTING: pakai Adin MD yang sudah ada fix dari `main.js` (yang support env
   `JADIBOT_SESSION_PATH`, `JADIBOT_PAIRING_NUMBER`, `JADIBOT_SUBBOT`) — itu sudah
   disiapkan di percakapan kita, pastikan file `main.js` di dalam `bots/adin-md/`
   adalah versi yang sudah diedit itu.

3. Install dependency:
   ```
   npm install
   ```

4. Copy `.env.example` jadi `.env`, isi:
   - `ALLOWED_ORIGINS` → domain Vercel kamu nanti (boleh dikosongin dulu pas development)
   - `MAX_CONCURRENT_BOTS` → sesuaikan sama kekuatan server
   - `RATE_LIMIT_PER_IP_PER_HOUR` → biar nggak di-spam orang iseng

5. Jalankan:
   ```
   npm start
   ```

   Pastikan di Pterodactyl, startup command-nya `node src/server.js`, dan port yang
   dibuka sesuai `PORT` di `.env`.

## Setup Firebase (buat login)

1. Buka [console.firebase.google.com](https://console.firebase.google.com), buat project baru (gratis, pilih paket **Spark**).
2. Di menu **Authentication** → tab **Sign-in method** → aktifkan **Email/Password** (atau tambah **Google** juga kalau mau login pakai akun Google).
3. Aktifkan **Firestore Database** (mode production, pilih region terdekat misal `asia-southeast2`).
4. Buka **Project Settings** (ikon gerigi) → tab **Service Accounts** → klik **Generate new private key**. Ini akan download file JSON.
5. Rename file itu jadi `firebase-service-account.json`, taruh di folder root `jadibot-manager/` (sejajar sama `package.json`). **JANGAN taruh file ini di Vercel/public, ini rahasia!**
6. Selesai — begitu server dijalankan ulang, bagian login otomatis aktif.

Nanti di bagian frontend (Vercel), kamu juga perlu config Firebase yang **beda** (config publik untuk client SDK, bukan file service account ini) — itu dari **Project Settings → General → Your apps → Web app**. Aku kasih tau detailnya pas bikin frontend-nya.

## Cara kerja singkat

- Tiap ada yang daftar lewat website → manager ini `spawn` proses Node baru yang
  menjalankan `bots/adin-md/main.js`, dengan folder sesi sendiri di
  `instances/<id>/` — jadi nggak bentrok sama bot utama ataupun sub-bot lain.
- Kode pairing yang muncul di log proses anak langsung ditangkap dan dikirim
  ke website lewat API.
- Log langsung (real-time) dikirim ke website lewat Server-Sent Events (SSE).

## ⚠️ Keamanan

File `firebase-service-account.json` itu kunci penuh ke project Firebase kamu.
Jangan pernah upload ke GitHub public repo, jangan taruh di folder yang bisa diakses
lewat URL (misal folder `public/`). `.gitignore` di sini sudah menutup file ini &
`.env` secara default — pastikan tetap begitu.

## Nambah SC lain nanti

Taruh source code baru di `bots/<nama-sc>/`, lalu tambahkan entrinya di
`src/processManager.js` pada object `AVAILABLE_SC`. Pastikan `main.js` SC itu juga
sudah di-support env var yang sama (`JADIBOT_SESSION_PATH`, `JADIBOT_PAIRING_NUMBER`,
`JADIBOT_SUBBOT`) biar bisa di-jadibot-in juga.

## Endpoint API

Semua endpoint di bawah ini (kecuali `sc-list` dan `health`) butuh header:
`Authorization: Bearer <firebase-id-token>`

| Method | Endpoint | Fungsi |
|---|---|---|
| GET | `/api/jadibot/sc-list` | daftar SC yang tersedia |
| GET | `/api/jadibot/me` | profil user yang login (role, kedaluwarsa) |
| POST | `/api/jadibot/start` | `{ phone, scId }` → mulai bot baru |
| GET | `/api/jadibot/status/:id` | cek status + kode pairing |
| GET | `/api/jadibot/logs/:id` | live log (SSE) |
| POST | `/api/jadibot/stop/:id` | matikan bot |
| POST | `/api/jadibot/delete/:id` | matikan + hapus sesi |
| GET | `/api/jadibot/list` | semua instance aktif |
| GET | `/api/jadibot/health` | cek jumlah bot aktif |
