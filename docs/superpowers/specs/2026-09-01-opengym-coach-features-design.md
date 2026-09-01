# openGym Coach Features — Design Spec (Index)

**Tanggal:** 2026-09-01
**Status:** Draft
**Dasar:** Proposal GymTrainer (decision support engine untuk progressive overload) diterapkan sebagai lapisan fitur di atas tracker openGym yang sudah matang.

> **Struktur dokumen ini = index.** Detail per fitur ada di file terpisah (tautan di §4). Dokumen ini berisi executive summary, konteks codebase, keputusan bersama, dan arsitektur umum.

---

## 1. Executive Summary

openGym sudah menjadi tracker yang sangat lengkap: 1.324 exercise, guided workout, rest timer, progression policies (linear / Greyskull / **double progression** / time), 1RM, effort RIR/RPE, muscle map yang sudah bisa diklik, custom exercise, 13 bahasa, offline, passkeys. Yang belum ada adalah **layer keputusan** — "apa yang harus saya lakukan minggu depan berdasarkan data ini?" — yang justru merupakan inti dari proposal GymTrainer.

Spec ini merancang **5 fitur** yang menambahkan lapisan coach/decision support di atas fondasi openGym yang sudah ada, tanpa mengubah filosofi aplikasi (self-hosted, offline-first, no telemetry, i18n penuh):

1. **Peta otot → filter exercise** — menyelesaikan akar masalah "user perlu nambah exercise manual" (exercise ada di katalog tapi tidak ketemu).
2. **Rule engine tiered** — plateau (3/4/5+ minggu) & rep drop (1x/2x/3x) & set variance menghasilkan saran deterministic sebagai coach hint.
3. **AI Explainer** — chat panel pasca-sesi yang menjelaskan rekomendasi dalam bahasa natural; server proxy menyembunyikan API key.
4. **AI bantu buat custom exercise** — ketik deskripsi → AI isi field (termasuk `tg/eq/sm/st`) → user setuju → simpan.
5. **i18n** — tambah bahasa Indonesia + string fitur baru ke semua locale; AI mengikuti bahasa UI.

**Prinsip kunci dari GymTrainer yang dipertahankan:** semua keputusan deterministic dan bisa diaudit (rule engine murni); LLM tidak pernah mengubah rekomendasi, hanya menjelaskan.

---

## 2. Konteks Codebase (Temuan Eksplorasi)

### 2.1 Dataset exercise SUDAH lengkap

Perbandingan langsung dengan sumber upstream `hasaneyldrm/exercises-dataset`:

| | Upstream | openGym `EXDB` |
|---|---|---|
| Total exercise | 1.324 | 1.324 |
| Cakupan | chest 163 · back 203 · upper arms 292 · upper legs 227 · waist 169 · shoulders 143 · lower legs 59 · lower arms 37 · cardio 29 · neck 2 | identik |

**Snapshot openGym = salinan penuh upstream.** Struktur field upstream (`category`, `body_part`, `equipment`, `muscle_group`, `secondary_muscles`, `target`, `instruction_steps` multi-bahasa) sudah ditransformasi ke `bp/eq/tg/mg/sm/st` dengan benar.

**Kesimpulan:** "user perlu nambah exercise manual" bukan karena data kosong, tapi karena **discovery** — exercise ada tapi tidak ketemu (tidak ada filter berdasarkan otot yang dilatih). Ini yang diselesaikan F1.

### 2.2 Fondasi yang sudah ada

| Aset | Lokasi | Relevansi |
|---|---|---|
| `BodyMap` (klik-able, `onMuscle`/`selected`) | `frontend/src/components/BodyMap.jsx` | Dipakai di Stats — tinggal dipakai ulang untuk filter (F1) |
| `musclesOf(ex)` → `{slug: bobot}` | `frontend/src/lib/muscles.js` | Memetakan tiap exercise → otot (primary `tg` + secondary `sm`) — basis F1 & F4 |
| `MUSCLES` (18 otot) + `ALIAS` + `BY_BODYPART` | `frontend/src/lib/muscles.js` | Otot yang bisa digambar peta; alias & fallback |
| Double progression + deload | `frontend/src/lib/progression.js` | `readSession`, `stallCount`, `nextPrescription` — dasar F2 |
| `ExercisePicker` | `frontend/src/sheets.jsx:411` | Filter `bp`+`eq`+search — target filter otot (F1) |
| `Library` | `frontend/src/views/Library.jsx` | Filter `bp`+`eq`+search — target filter otot (F1) |
| Server API (node:http, `routes` map) | `api/server.js` | Tempat `POST /api/explain` & `POST /api/exercise/suggest` (F3/F4) |
| `FinishSummary` (post-workout) | `frontend/src/sheets.jsx:905` | Tempat coach hints + AI panel (F2/F3); dibuka `locked` |
| `doFinishWorkout` | `frontend/src/sheets.jsx:935-969` | Titik workout final ditulis → pemicu evaluasi rule (F2) |
| i18n `t()` + 12 locale packs | `frontend/src/lib/i18n.js` | English source = key; `import.meta.glob` lazy-load — tambah `id.js` otomatis ter-load (F5) |
| `useStore` zustand, state sync | `frontend/src/store/useStore.js` | `update()` mutates S + persist; `DEF` default state |
| `CustomExForm` | `frontend/src/sheets.jsx:345` | Form custom exercise — target AI suggest (F4) |

### 2.3 Gap yang diisi

1. Filter otot tidak ada di Library & ExercisePicker (F1).
2. Progression tidak **tiered** (F2).
3. Tidak ada lapisan saran/coach hint (F2).
4. Tidak ada AI Explainer (F3).
5. Tidak ada AI-assisted custom exercise creation (F4).
6. Belum ada bahasa Indonesia (F5).

---

## 3. Keputusan Bersama (dikonfirmasi user)

| Topik | Keputusan |
|---|---|
| Scope fitur | F1 peta otot + F2 rule engine + F3 AI explainer + F4 AI custom + F5 i18n |
| AI Explainer | Sertakan (server proxy, key di env) |
| Penempatan peta otot | Library + Routine editor (ExercisePicker) |
| Lokasi key AI | Server proxy (client tidak pegang key) |
| Kekuatan rule engine | Rule sebagai saran (coach hint), bukan AI yang menyarankan rekomendasi baru |
| Bahasa | i18n penuh semua locale; AI ikuti bahasa UI |
| Generalisasi AI helper | **`callAI`** (Tingkat A: env-config `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL`, OpenAI-compatible) |
| Masalah dataset | Ternyata lengkap — fokus discovery (F1), bukan nambah data |
| AI tambah exercise | **Form 2** (AI bantu buat custom), bukan cari dataset luar |
| Keluaran spec | Lengkap, dipisah per fitur |
| Kelengkapan id.js | Lengkap semua string (~557) |
| Instruksi exercise id | Tetap English (tidak masuk `INSTR_LANGS`) |
| Backward-compat F4 | **Tanpa migrasi** — custom lama tetap jalan (analisa codebase di F4) |

---

## 4. Daftar File Spec

| Fitur | File |
|---|---|
| F1 — Peta otot → filter exercise | `2026-09-01-f1-muscle-map-filter-design.md` |
| F2 — Rule engine tiered (coach hints) | `2026-09-01-f2-rule-engine-design.md` |
| F3 — AI Explainer | `2026-09-01-f3-ai-explainer-design.md` |
| F4 — AI bantu buat custom exercise | `2026-09-01-f4-ai-custom-exercise-design.md` |
| F5 — i18n (locale id + string fitur) | `2026-09-01-f5-i18n-design.md` |

---

## 5. Arsitektur Umum

```
┌────────────────────────────────────────────────────────────┐
│ FRONTEND (React 19, Vite, PWA, offline-first)              │
│                                                            │
│  Library / ExercisePicker  →  BodyMap filter otot (F1)     │
│  CustomExForm              →  AI suggest (F4)              │
│  FinishSummary             →  Coach hints (F2) + chat (F3) │
│  lib/coach.js (pure rules) →  rule engine (F2)             │
│  lib/api.js                →  fetch proxy endpoints         │
└────────────────────────────────────────────────────────────┘
                              │  HTTP (same-origin proxy)
┌────────────────────────────────────────────────────────────┐
│ SERVER API (api/server.js, node:http)                      │
│                                                            │
│  api/ai.js — callAI()  (env-config, OpenAI-compatible)     │
│  POST /api/explain            → AI provider                │
│  POST /api/exercise/suggest   → AI provider                │
│  key dari env (AI_API_KEY) — tidak pernah ke client        │
└────────────────────────────────────────────────────────────┘
```

**Prinsip:**
- **Rule engine = pure module frontend** (`lib/coach.js`), tanpa dependency HTTP/DB — bisa di-test isolasi (pola `progression.js`). Ini jantung nilai dampak.
- **LLM = hanya server proxy** (`api/ai.js` → `callAI`). Client tidak pernah pegang API key. Guardrail: LLM hanya menjelaskan/mengisi form, tidak menambah rekomendasi baru.
- **Offline-first dipertahankan:** rule engine jalan di client (offline). AI Explainer & AI suggest butuh server (nonaktif saat offline/demo, fallback teks rule engine).
- **i18n penuh:** semua string baru masuk ke 13 locale; AI mengikuti bahasa UI (`lang` di request).

---

## 6. Urutan Implementasi

Rekomendasi: dari yang paling murah & menyelesaikan akar masalah, ke yang paling kompleks.

| Fase | Fitur | Effort | Alasan |
|---|---|---|---|
| 1 | Peta otot → filter (F1) | Kecil | Menyelesaikan "user nambah manual"; fondasi ada |
| 2 | Rule engine tiered (F2) | Sedang | Jantung nilai dampak; pure module, testable |
| 3 | AI bantu custom (F4) | Sedang | Membuat helper `callAI` (dipakai F3); menghilangkan kebutuhan manual |
| 4 | AI Explainer (F3) | Besar | Nilai paling terlihat, reuse `callAI` dari F4 |
| 5 | i18n (F5) | Sedang | Menyentuh semua locale + bahasa Indonesia |

F1 & F2 independen — bisa dikerjakan berurutan atau paralel (F1 murni frontend, F2 murni lib + sheets). F4 & F3 berbagi `callAI` — kerjakan F4 dulu (buat helper), lalu F3 (reuse).

---

## 7. Out-of-Scope (YAGNI)

- AI mencari dataset luar / auto-import exercise dari dataset lain (Form 1) — keputusan user: Form 2 dulu. Arsitektur endpoint dipisah agar bisa di-upgrade nanti.
- Auto-apply rekomendasi (tanpa persetujuan user) — semua saran butuh konfirmasi.
- Multi-tenant / coach view.
- Sentry observability (per proposal GymTrainer) — bertentangan filosofi no-telemetry openGym.
- Pack instruksi exercise Indonesia — upstream tidak punya; fallback English.
- Streaming response AI — YAGNI untuk MVP.
