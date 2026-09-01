# F4 — AI Bantu Buat Custom Exercise

**Bagian dari:** openGym Coach Features (lihat `2026-09-01-opengym-coach-features-design.md`)
**Status:** Draft
**Effort:** Sedang
**Dependensi:** helper `callAI` (dibuat di sini, fase 3) — dipakai juga F3.

---

## 1. Tujuan

User mengetik deskripsi exercise (misal "cable rear delt fly"), AI mengisi form custom-exercise **termasuk field kaya** (`tg`, `eq`, `sm`, `st`), user **menyetujui** → disimpan sebagai custom exercise yang lebih berguna (ikut muscle map, search, progression).

**Keputusan:** Form 2 (AI bantu buat custom) — bukan AI cari dataset luar. Aman (tanpa lisensi/media baru), sesuai arsitektur server proxy, self-hosted penuh.

---

## 2. Keputusan Backward-Compatibility (dikonfirmasi user)

**Keputusan: Backward-compat tanpa migrasi.** Custom exercise lama (hanya `name/bp/desc`) tetap berfungsi penuh tanpa mengubah data. Custom baru (dengan `tg/eq/sm/st`) langsung lebih kaya.

**Kenapa aman tanpa migrasi — analisa codebase:**

| Pembaca field | Custom lama (`tg:''`, `sm:undefined`, `eq:'custom'`) | Custom baru (`tg` real, `sm[]`, `eq` real) |
|---|---|---|
| `musclesOf()` (`lib/muscles.js:73`) | `ALIAS['']` → undefined → fallback `BY_BODYPART[bp]` | `ALIAS[real]` → dipetakan benar |
| search `e.tg.includes(ql)` (Library:19, sheets:422) | `''.includes()` aman (string kosong) | aman (string real) |
| display `t(e.tg || e.bp)` / `t(e.eq)` (beberapa tempat) | `e.eq='custom'` → tampil "custom" | tampil equipment real |
| `loadOf`/`loadOfRoutine` (muscle map) | via `BY_BODYPART` | via `tg`/`sm` — lebih akurat |

**Kesimpulan:** field custom exercise sudah dirancang toleran. `tg` selalu string (`''` untuk lama), `sm` selalu array-opsional, `eq` selalu ada. **Tidak ada migrasi data, tidak ada versi bump schema.**

---

## 3. Alur

```
User ketik deskripsi di CustomExForm (tombol "AI bantu isi")
  → POST /api/exercise/suggest { lang, description }
  → server: callAI → JSON terstruktur { name, bp, eq, tg, sm, st }
  → frontend: VALIDASI terhadap enum yang ada
  → tampil preview form terisi (termasuk field kaya)
  → user edit & setuju → simpan sebagai custom exercise
```

### 3.1 Server: `POST /api/exercise/suggest`

- Body: `{ lang, description }`
- Server panggil `callAI({ prompt, lang, system, json: true })`.
- System prompt meminta output **JSON murni** dengan schema tetap:
  ```json
  {
    "name": "Cable Rear Delt Fly",
    "bp": "shoulders",
    "eq": "cable",
    "tg": "deltoids",
    "sm": ["rear deltoids"],
    "st": ["step 1…", "step 2…"]
  }
  ```
- Jika `AI_API_KEY` tidak ada → `503 { error: 'not_configured' }`.

### 3.2 Guardrail Validasi (frontend, deterministic)

| Field | Validasi |
|---|---|
| `bp` | Wajib ∈ `BODYPARTS` (dari `exercises.js`). Jika tidak dikenali → kosongkan, minta user pilih. |
| `eq` | Wajib ∈ set equipment yang dikenal. Jika tidak → default `'body weight'` atau minta user. |
| `tg` | Normalisasi via `ALIAS` (dari `muscles.js`). Jika tidak dikenali → kosongkan, fallback `BY_BODYPART[bp]` saat display. |
| `sm` | Array, tiap item dinormalisasi via `ALIAS`. Item tak dikenal → drop. |
| `st` | Array string, truncate tiap step ke panjang wajar (misal 200 char). |
| `name` | Tidak boleh kosong, tidak boleh duplikat (`save()` sudah memvalidasi). |

**Output AI tidak pernah ditulis langsung — selalu lewat form yang bisa diedit user.**

---

## 4. Skema Custom Exercise Baru

Custom exercise yang dibuat F4 menyimpan field kaya (opsional untuk custom lama):

```js
{ id, n: 'Cable Rear Delt Fly', bp: 'shoulders', eq: 'cable', tg: 'deltoids',
  sm: ['rear deltoids'], st: ['…'], desc: '…', custom: true }
```

**Konsekuensi ke field custom lama:** custom lama (`tg:''`, `eq:'custom'`, tanpa `sm/st`) **tetap valid** — semuanya opsional, pembaca sudah toleran (lihat §2).

---

## 5. Implementasi

### 5.1 File berubah

| File | Perubahan |
|---|---|
| `api/ai.js` | **(baru)** helper `callAI` (dibuat di sini, fase 3) |
| `api/server.js` | Endpoint `POST /api/exercise/suggest` (reuse `callAI`) |
| `frontend/src/sheets.jsx` (`CustomExForm`) | Tombol "AI bantu isi" + preview terisi (`name/bp/eq/tg/sm/st`) + normalisasi |
| `frontend/src/lib/exercises.js` | Expose helper validasi enum (bp/eq set) |
| `frontend/src/lib/muscles.js` | Expose `normalizeMuscleName()` (pecah dari `ALIAS` internal) |
| `frontend/src/lib/api.js` | `api('/api/exercise/suggest', ...)` |

### 5.2 CustomExForm — perluasan field

Saat ini `CustomExForm` (sheets.jsx:345) hanya punya `name/bp/desc`. F4 menambahkan **display field kaya hasil AI** setelah user klik "AI bantu isi":
- `eq` — chip/pilih equipment
- `tg` — display target muscle (dari normalisasi)
- `sm` — display secondary muscles (read-only / chips)
- `st` — preview instructions (list)
- User bisa **edit** sebelum simpan.

Field kaya disimpan hanya jika user memilihnya — custom exercise yang dibuat manual (tanpa AI) tetap bisa minimal seperti sekarang.

---

## 6. Testing

### Unit (server `callAI`)

- Request shape benar (base URL + model + messages + `response_format` saat `json:true`).
- Error handling: `not_configured`, non-2xx, invalid JSON.

### Unit (frontend normalisasi)

- `bp` tak dikenal → kosongkan + minta user.
- `eq` tak dikenal → default 'body weight'.
- `tg`/`sm` tak dikenal → di-drop / fallback.
- Output AI yang bukan JSON → fallback aman (form tetap bisa diedit manual).

### Manual

- Alur ketik → preview terisi kaya → edit → simpan.
- Exercise hasil AI muncul di muscle map (body part → muscle benar).
- Search menemukan exercise hasil AI via `tg`/`eq`.
- Custom lama (tanpa field kaya) tetap berfungsi normal.

---

## 7. Out-of-Scope

- AI mencari dataset luar / auto-import exercise (Form 1) — keputusan user: Form 2 dulu. Arsitektur endpoint dipisah agar bisa di-upgrade nanti.
- Auto-save tanpa konfirmasi user — selalu lewat form.
- Foto/animasi untuk custom exercise — tetap tanpa media (pola established openGym).
