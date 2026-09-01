# openGym Coach Features — Design Spec

**Tanggal:** 2026-09-01
**Status:** Draft
**Dasar:** Proposal GymTrainer (decision support engine untuk progressive overload) diterapkan sebagai lapisan fitur di atas tracker openGym yang sudah matang.

---

## 1. Executive Summary

openGym sudah menjadi tracker yang sangat lengkap: 1.324 exercise, guided workout, rest timer, progression policies (linear / Greyskull / **double progression** / time), 1RM, effort RIR/RPE, muscle map yang sudah bisa diklik, custom exercise, 12 bahasa, offline, passkeys. Yang belum ada adalah **layer keputusan** — "apa yang harus saya lakukan minggu depan berdasarkan data ini?" — yang justru merupakan inti dari proposal GymTrainer.

Spec ini merancang **5 fitur** yang menambahkan lapisan coach/decision support di atas fondasi openGym yang sudah ada, tanpa mengubah filosofi aplikasi (self-hosted, offline-first, no telemetry, i18n penuh):

1. **Peta otot → filter exercise** — menyelesaikan akar masalah "user perlu nambah exercise manual" (exercise ada di katalog tapi tidak ketemu).
2. **Rule engine tiered** — plateau (3/4/5+ minggu) & rep drop (1x/2x/3x) & set variance menghasilkan saran deterministic sebagai coach hint.
3. **AI Explainer** — chat panel pasca-sesi yang menjelaskan rekomendasi dalam bahasa natural; server proxy menyembunyikan API key.
4. **AI bantu buat custom exercise** — ketik deskripsi → AI isi field otomatis → user setuju → simpan sebagai custom exercise.
5. **i18n** — string aturan/rekomendasi baru ke 12 locale; AI mengikuti bahasa UI.

**Prinsip kunci dari GymTrainer yang dipertahankan:** semua keputusan deterministic dan bisa diaudit (rule engine murni); LLM tidak pernah mengubah rekomendasi, hanya menjelaskan.

---

## 2. Konteks Codebase (Temuan Eksplorasi)

### 2.1 Dataset exercise SUDAH lengkap

Perbandingan langsung dengan sumber upstream `hasaneyldrm/exercises-dataset`:

| | Upstream | openGym `EXDB` |
|---|---|---|
| Total exercise | 1.324 | 1.324 |
| Cakupan | chest 163 · back 203 · upper arms 292 · upper legs 227 · waist 169 · shoulders 143 · lower legs 59 · lower arms 37 · cardio 29 · neck 2 | identik |

**Snapshot openGym = salinan penuh upstream.** Tidak ada exercise yang terlewat. Struktur field upstream (`category`, `body_part`, `equipment`, `muscle_group`, `secondary_muscles`, `target`, `instruction_steps` multi-bahasa) sudah ditransformasi ke `bp/eq/tg/mg/sm/st` dengan benar.

**Kesimpulan:** "user perlu nambah exercise manual" hampir pasti bukan karena data kosong, tapi karena **discovery** — exercise ada tapi tidak ketemu:
- Library & ExercisePicker cuma filter `bp` (body part) + `eq` (equipment) + search nama/tag/desc.
- **Tidak ada filter berdasarkan otot yang dilatih.**
- Contoh: user mau latihan *rear deltoid*. Filter "shoulders" menampilkan body-part shoulders, tapi latihan yang melatih rear delts dari body-part lain (row, face pull) tidak muncul — padahal ada di katalog.
- Fitur peta otot → filter menyelesaikan ini: otot yang diklik memetakan ke `musclesOf()` yang sudah tahu semua exercise melatih otot itu (termasuk secondary).

### 2.2 Fondasi yang sudah ada

| Aset | Lokasi | Relevansi |
|---|---|---|
| `BodyMap` (klik-able, `onMuscle`/`selected`) | `frontend/src/components/BodyMap.jsx` | Dipakai di Stats (`onMuscle={m => setSel(...)}`) — tinggal dipakai ulang untuk filter |
| `musclesOf(ex)` → `{slug: bobot}` | `frontend/src/lib/muscles.js` | Memetakan tiap exercise → otot yang dilatih (primary `tg` + secondary `sm` × 0.4) |
| `MUSCLES` (18 otot) + `ALIAS` + `BY_BODYPART` | `frontend/src/lib/muscles.js` | Daftar otot yang bisa digambar peta |
| Double progression + deload | `frontend/src/lib/progression.js` | `readSession`, `stallCount`, `nextPrescription` — sebagian besar rule engine spec sudah ada |
| `ExercisePicker` | `frontend/src/sheets.jsx:411` | Punya filter `bp` + `eq` + search — target filter otot |
| `Library` | `frontend/src/views/Library.jsx` | Punya filter `bp` + `eq` + search — target filter otot |
| Server API (node:http, `routes` map) | `api/server.js` | Tempat `POST /api/explain` & `POST /api/exercise/suggest` |
| `FinishSummary` (post-workout) | `frontend/src/sheets.jsx:905` | Tempat rekomendasi muncul (dibuka `locked`) |
| `doFinishWorkout` | `frontend/src/sheets.jsx:935-969` | Titik workout final ditulis → pemicu evaluasi rule |
| i18n `t()` + 12 locale packs | `frontend/src/lib/i18n.js` | English source string = key; locale file lazy-loaded |
| `useStore` zustand, state sync | `frontend/src/store/useStore.js` | `update()` mutates S + persist; `DEF` default state |

### 2.3 Gap yang diisi spec ini

1. Filter otot tidak ada di Library & ExercisePicker.
2. Progression tidak **tiered** (plateau 3/4/5+ minggu → aksi beda; rep drop 1x/2x/3x → aksi beda; set variance tidak diinterpretasi).
3. Tidak ada lapisan saran/coach hint — hanya prescription otomatis.
4. Tidak ada AI Explainer.
5. Tidak ada AI-assisted custom exercise creation.

---

## 3. Arsitektur Umum

```
┌────────────────────────────────────────────────────────────┐
│ FRONTEND (React 19, Vite, PWA, offline-first)              │
│                                                            │
│  Library / ExercisePicker  →  BodyMap filter otot (F1)     │
│  CustomExForm               →  AI suggest (F4)             │
│  FinishSummary              →  Coach hints (F2) + chat (F3)│
│  lib/coach.js (pure rules)  →  rule engine (F2)            │
│  lib/api.js                 →  fetch proxy endpoints       │
└────────────────────────────────────────────────────────────┘
                              │  HTTP (same-origin proxy)
┌────────────────────────────────────────────────────────────┐
│ SERVER API (api/server.js, node:http)                      │
│                                                            │
│  POST /api/explain            → DeepSeek (OpenAI-compat)   │
│  POST /api/exercise/suggest   → DeepSeek (OpenAI-compat)   │
│  key dibaca dari env (DEEPSEEK_API_KEY) — tidak di client  │
└────────────────────────────────────────────────────────────┘
```

**Prinsip:**
- **Rule engine = pure module frontend** (`lib/coach.js`), tanpa dependency HTTP/DB — bisa di-test isolasi (pola `progression.js` yang sudah ada). Ini jantung nilai dampak (dari GymTrainer).
- **LLM = hanya server proxy.** Client tidak pernah pegang API key. Guardrail: LLM hanya menjelaskan/mengisi form, tidak menambah rekomendasi baru.
- **Offline-first dipertahankan:** rule engine jalan di client (offline). AI Explainer & AI suggest butuh server (nonaktif saat offline/demo, fallback ke teks rule engine).
- **i18n penuh:** semua string baru masuk ke 12 locale; AI mengikuti bahasa UI (dikirim sebagai `lang` di request).

---

## 4. Fitur 1 — Peta Otot → Filter Exercise

### 4.1 Tujuan

User melihat grafik tubuh, mengklik otot (misal "Biceps"), dan Library/ExercisePicker menampilkan **semua exercise yang melatih otot itu** — termasuk yang `bp`-nya berbeda tapi `musclesOf()` menandai otot itu sebagai primary atau secondary.

### 4.2 Perilaku

- Di `Library` dan `ExercisePicker`, tambahkan **mode toggle otot** — BodyMap kecil yang bisa di-klik.
- Klik otot `slug` → filter exercise dengan `musclesOf(ex)[slug] > 0`.
- Klik lagi otot yang sama (atau tombol "All") → clear filter.
- Otot yang dipilih → hasil disortir: exercise dengan otot itu sebagai **primary** (`tg`) lebih dulu, secondary (`sm`) menyusul.
- **Interaksi dengan filter yang ada:** filter otot `AND` dengan `bp`, `eq`, search (berlaku bersamaan). Tapi logika sortir primary-first berlaku saat filter otot aktif.
- Exercise custom: `musclesOf()` sudah menangani (fallback ke `BY_BODYPART`), jadi otomatis ikut.
- BodyMap reusable: prop baru `onPick`? Tidak — pakai `onMuscle`/`selected` yang sudah ada. `BodyMap` tidak berubah; yang berubah adalah **view yang memakainya**.

### 4.3 Implementasi

**File berubah:**
- `frontend/src/views/Library.jsx` — tambah state `muscle`; filter `base` tambah kondisi `musclesOf(e)[muscle] > 0`; render BodyMap saat mode otot aktif; tombol toggle.
- `frontend/src/sheets.jsx` (`ExercisePicker`) — sama, tambah state `muscle` + filter + BodyMap.
- `frontend/src/lib/exercises.js` — tambah helper `byMuscle(list, slug)` dan `sortByMusclePrimary(list, slug)` (pure, bisa di-test).
- `frontend/src/lib/exercises.test.js` — unit test.

**Reuse:** `BodyMap`, `musclesOf`, `MUSCLES`, `MUSCLE_NAME` — semua sudah ada, tidak berubah.

### 4.4 Data Flow

```
User klik otot "biceps" di BodyMap
  → setMuscle('biceps')
  → base = allExercises(S).filter(e => byMuscle([e], 'biceps'))  // musclesOf(e).biceps > 0
  → sort primary-first via sortByMusclePrimary
  → tampil di list (dengan equipment filter tetap berlaku)
```

### 4.5 Testing

- Unit: `byMuscle` benar (bench press → chest primary, biceps secondary; row → biceps primary). `sortByMusclePrimary` urutan benar. Custom exercise fallback benar.
- Manual: klik tiap otot → daftar wajar; kombinasi dengan eq filter.

---

## 5. Fitur 2 — Rule Engine Tiered (Coach Hints)

### 5.1 Tujuan

Menambahkan **deteksi** dan **saran deterministic** untuk empat edge case progressive overload dari proposal GymTrainer — sebagai coach hint yang bisa diaudit, bukan otomatisasi yang mengambil alih.

**Keputusan:** rule sebagai saran (bukan AI yang menyarankan rekomendasi baru; bukan juga auto-apply).

### 5.2 Aturan (dari GymTrainer, diadaptasi ke data openGym)

Menggunakan data yang sudah ada: `S.workouts`, `entries[].sets[]`, `target` (prescription), `effort` (RIR/RPE, opsional).

**Rule A — Set variance checker**
- Kondisi: dalam satu session, set tidak konsisten (misal 12-10-8 saat target 12).
- Interpretasi: `double` progression membaca "semua set capai target" — set variance membuat ambiguitas.
- Saran: HOLD (target belum tercapai) vs UP (semua set capai). Ini mengoreksi interpretasi data terlebih dahulu.

**Rule B — Rep drop tiered**
- Kondisi: reps working set turun vs minggu sebelumnya.
- Tier:
  - 1x drop → "Ulangi beban yang sama minggu depan"
  - 2x drop berturut-turut → "Deload 10%"
  - 3x drop berturut-turut → "Evaluasi: substitusi exercise atau periksa program"
- Dasar: `readSession`/`stallCount` di `progression.js` (sudah ada sebagian).

**Rule C — Plateau tiered**
- Kondisi: progression stagnan di angka sama.
- Tier:
  - 3 minggu → "Coba intensity technique (rest-pause / drop set)"
  - 4 minggu → "Substitusi ke exercise variasi otot sama"
  - 5+ minggu → "Deload penuh seminggu"
- Dasar: `stallCount` + window mingguan.

**Rule D — Exercise substitution** (bantuan, bukan auto)
- Saat user substitusi exercise (misal bench → DB press), bantu starting weight via **equivalence**.
- Untuk katalog: gunakan hubungan otot (`musclesOf`) — exercise yang melatih otot sama (primary sama) sebagai basis carry-over.
- Untuk custom: mode kalibrasi — saran "1-2 set di sesi pertama, catat dan kalibrasi".

### 5.3 Prioritas Rule (bila multiple fire)

`set-variance` → `rep-drop` → `plateau` → `substitution` (dari GymTrainer). Set-variance mengoreksi interpretasi data; rep-drop paling akut; plateau multi-week; substitution adalah user action.

### 5.4 Bentuk Output: Coach Hint

Setiap hint adalah objek:

```typescript
type CoachHint = {
  ruleId: 'set-variance' | 'rep-drop' | 'plateau' | 'substitution'
  tier: 1 | 2 | 3
  severity: 'info' | 'action' | 'warning'
  exerciseId: string
  messageKey: string        // i18n key (English source)
  params: Record<string, unknown>   // untuk t() args
  suggestedAction?: 'repeat' | 'deload' | 'substitute' | 'technique' | 'calibrate' | 'full-deload'
  reasoning: string[]       // facts, untuk AI Explainer & audit
}
```

**Di mana muncul:** **Utama — `FinishSummary` (post-workout)**, karena data session final baru lengkap setelah workout ditulis (lihat §5.5). **Tidak** muncul di tengah sesi (Workout.jsx) di MVP ini — menambahkan hint di tengah logging berisiko mengganggu alur cepat pencatatan; ini bisa jadi fase lanjutan. Keputusan ini mengunci scope: hanya `FinishSummary` yang menyentuh rule engine di MVP.

### 5.5 Implementasi

**File baru:**
- `frontend/src/lib/coach.js` — pure module. Input: `S` (state) + exercise context. Output: `CoachHint[]`. Tanpa HTTP/DB. (Pola `progression.js`.)
- `frontend/src/lib/coach.test.js` — unit test skenario GymTrainer (12+ scenario).

**File berubah:**
- `frontend/src/sheets.jsx` (`FinishSummary`) — panggil `coachHints(S, w)` setelah workout ditulis; render kartu hint.
- `frontend/src/views/Workout.jsx` — (opsional) hint di exercise berikutnya.

### 5.6 Testing

Unit test skenario (dari GymTrainer):
| # | Skenario | Input | Expected |
|---|---|---|---|
| 1 | Target capai semua set | 3x12 @40kg, range 8-12 | UP |
| 2 | Set variance | 12-10-8 @40kg | HOLD |
| 3 | Rep drop 1x | 3x11→3x9 | repeat |
| 4 | Rep drop 2x | 3x11→3x9→3x8 | deload 10% |
| 5 | Rep drop 3x | turun 3 mgg | evaluate |
| 6 | Plateau 3 mgg | same 3x10, 3 sesi | technique |
| 7 | Plateau 4 mgg | same 3x10, 4 sesi | substitute |
| 8 | Plateau 5+ mgg | same 3x10, 5+ sesi | full deload |

---

## 6. Fitur 3 — AI Explainer

### 6.1 Tujuan

Chat panel pasca-sesi yang menjelaskan rekomendasi rule engine dalam bahasa natural (mengikuti bahasa UI). LLM hanya menjelaskan; tidak pernah mengubah/menambah rekomendasi.

### 6.2 Server Proxy

**Endpoint baru:** `POST /api/explain`
- Body: `{ lang, exerciseId, hint: CoachHint, recentHistory: [...] }`
- Server memanggil DeepSeek (OpenAI-compatible) dengan `baseURL` di-override.
- Key dari `process.env.DEEPSEEK_API_KEY`. Jika tidak ada → `503 { error: 'not_configured' }`.
- **Jangan pernah** kirim key ke client.
- Model: `deepseek-v4-flash` (cost-effective).

**Guardrail (dari GymTrainer):**
- Prompt: "Kamu tidak boleh mengubah, menambah, atau menawarkan rekomendasi berbeda. Tugasmu menerjemahkan rekomendasi + reasoning ke bahasa natural."
- Post-process: scan output LLM untuk angka beban/reps. Jika ada angka yang tidak muncul di `reasoning[]`/`recentHistory` → warning + tampilkan teks rule engine sebagai fallback.

### 6.3 Frontend Chat Panel

- Di `FinishSummary` setelah hint → tombol "Kenapa?" / "Jelaskan".
- Panel chat kecil: satu pesan asli (penjelasan LLM), input follow-up (pertanyaan bebas).
- **Offline/demo:** tombol nonaktif, fallback menampilkan `reasoning[]` sebagai teks terstruktur (tetap berguna tanpa LLM).

### 6.4 Implementasi

**File berubah:**
- `api/server.js` — endpoint `POST /api/explain`; helper `callDeepSeek(prompt, lang)`.
- `frontend/src/lib/coach.js` — helper untuk menyusun context (exercise + hint + history ringkas).
- `frontend/src/sheets.jsx` — panel chat di FinishSummary.
- `frontend/src/lib/api.js` — `api('/api/explain', ...)`.

**Env var baru:** `DEEPSEEK_API_KEY` (documented di `.env.example` / `docs/SELF_HOSTING.md`).

### 6.5 Testing

- Server: unit test `callDeepSeek` (mock fetch) — request shape benar, error handling, key tidak bocor.
- Manual: offline → tombol nonaktif; online → penjelasan muncul.

---

## 7. Fitur 4 — AI Bantu Buat Custom Exercise

### 7.1 Tujuan

User mengetik deskripsi exercise (misal "cable rear delt fly"), AI mengisi form custom-exercise yang sudah ada, user **menyetujui** → disimpan sebagai custom exercise. Menghilangkan kebutuhan menambah exercise manual untuk hal yang sebenarnya sudah dikenal.

**Keputusan:** Form 2 (AI bantu buat custom) — bukan AI cari dataset luar. Aman (tanpa lisensi/media baru), sesuai arsitektur server proxy, self-hosted penuh.

### 7.2 Batasan Form Custom Exercise (pentiing untuk scope)

`CustomExForm` openGym saat ini (`frontend/src/sheets.jsx:345`) **hanya** punya 3 field: `name`, `bp` (body part), `desc` (deskripsi opsional). Custom exercise sengaja minimal — `tg`/`eq`/`sm`/`st` tidak ada; `musclesOf()` fallback ke `BY_BODYPART[bp]`. Ini pola established openGym dan **tidak diubah oleh fitur ini**.

**Implikasi:** AI suggest mengisi hanya field yang ada di form — `name`, `bp`, `desc`. Tidak menambah field baru, tidak mengubah skema custom exercise.

### 7.3 Alur

```
User ketik deskripsi di CustomExForm (tombol "AI bantu isi")
  → POST /api/exercise/suggest { lang, description }
  → server: DeepSeek → JSON terstruktur { name, bp, desc }
  → frontend: VALIDASI bp ∈ BODYPARTS
  → tampil preview form terisi (name + bp + desc)
  → user edit & setuju → simpan via alur existing (save())
```

### 7.4 Guardrail Validasi (di frontend, deterministic)

- `bp` harus ∈ set `BODYPARTS` (dari `exercises.js`). Jika tidak dikenali → kosongkan / minta user pilih (user tetap harus memilih body part — ini satu-satunya field wajib di save()).
- `name` tidak boleh kosong dan tidak boleh duplikat (save() sudah memvalidasi).
- `desc` di-truncate ke 1000 char (save() sudah melakukannya).
- Output AI tidak pernah ditulis langsung — selalu lewat form yang bisa diedit user.

### 7.5 Implementasi

**File berubah:**
- `api/server.js` — helper `callDeepSeek(prompt, lang, json=true)` (dibuat di sini, fase 3) + endpoint `POST /api/exercise/suggest`.
- `frontend/src/sheets.jsx` (`CustomExForm`) — tombol "AI bantu isi" + preview terisi (`name` + `bp` + `desc`).
- `frontend/src/lib/api.js` — `api('/api/exercise/suggest', ...)`.

**Catatan:** `callDeepSeek` pertama kali dibuat di F4 (fase 3) sebagai helper server umum; F3 (AI Explainer, fase 4) kemudian memakai ulang helper yang sama.

**Catatan:** tidak perlu menyentuh `muscles.js`/`exercises.js` untuk validasi enum karena F4 hanya mengisi `name/bp/desc` — dan `bp` divalidasi di komponen terhadap `BODYPARTS` yang sudah di-import `CustomExForm`.

### 7.6 Testing

- Unit (helper `callDeepSeek` di server): request shape benar, JSON parsing, error handling.
- Manual: alur ketik → preview terisi → edit → simpan; deskripsi tak jelas → form tetap aman (user pilih body part).
- Edge: deskripsi kosong → tombol nonaktif; server `not_configured` → fallback aman.

---

## 8. Fitur 5 — i18n

### 8.1 Tujuan

Semua string baru (rule messages, hint, panel AI, tombol "Jelaskan", "AI bantu isi") tersedia di **12 locale** (en, de, es, fr, it, pt, pl, tr, ru, zh, ko, hi). AI mengikuti bahasa UI (dikirim sebagai `lang` di request).

### 8.2 Implementasi

- `t()` sudah mendukung multi-arg (`{0}`, `{1}`) + English fallback — pakai itu.
- String baru masuk ke `frontend/src/lib/i18n.js` sebagai English source + tambah ke 12 file `frontend/src/locales/*.js`.
- **Pendekatan:** tambahkan string baru ke tiap locale. Untuk yang belum ada terjemahan, English source = fallback (t() sudah menangani). Terjemahan lengkap bisa menyusul — tidak memblokir.
- AI `lang` dikirim dari `getLang()`.

### 8.3 Testing

- Verifikasi `t()` lookup bekerja untuk tiap string baru di tiap locale (smoke test script).

---

## 9. Urutan Implementasi

Rekomendasi: dari yang paling murah & menyelesaikan akar masalah, ke yang paling kompleks.

| Fase | Fitur | Effort | Alasan |
|---|---|---|---|
| 1 | Peta otot → filter (F1) | Kecil | Menyelesaikan "user nambah manual"; fondasi ada |
| 2 | Rule engine tiered (F2) | Sedang | Jantung nilai dampak; pure module, testable |
| 3 | AI bantu custom (F4) | Sedang | Menghilangkan kebutuhan manual sisanya; server proxy |
| 4 | AI Explainer (F3) | Besar | Nilai paling terlihat, butuh server proxy + chat UX |
| 5 | i18n (F5) | Sedang | Menyentuh semua locale |

F1 & F2 independen — bisa dikerjakan berurutan atau paralel (F1 murni frontend, F2 murni lib + sheets). F4 & F3 berbagi server proxy (`callDeepSeek`) — kerjakan F4 dulu (lebih kecil) lalu F3.

---

## 10. Out-of-Scope (YAGNI)

- AI mencari dataset luar / auto-import exercise dari dataset lain (Form 1) — keputusan user: Form 2 dulu. Arsitektur endpoint dipisah agar bisa di-upgrade nanti.
- Auto-apply rekomendasi (tanpa persetujuan user) — semua saran butuh konfirmasi.
- Multi-tenant / coach view.
- Sentry observability (per proposal GymTrainer) — bertentangan filosofi no-telemetry openGym.
- Per-language instruction pack baru (de/pt tidak ada upstream) — di luar scope, fallback English sudah ada.

---

## 11. Prinsip Pemangkasan

Setiap fitur di atas berkontribusi ke satu tujuan: **mengubah openGym dari logger menjadi decision support** untuk praktisi hipertrofi — tanpa melanggar DNA self-hosted, offline-first, no-telemetry. Yang dihilangkan adalah yang menambah surface area tanpa dampak terukur pada 4 pain point progressive overload.
