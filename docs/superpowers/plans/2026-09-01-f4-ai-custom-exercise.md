# F4 — AI Bantu Buat Custom Exercise: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User mengetik deskripsi exercise di `CustomExForm`, AI mengisi `name/bp/eq/tg/sm/st`, user menyetujui → disimpan sebagai custom exercise kaya (ikut muscle map + search). Backward-compat: custom lama tetap jalan tanpa migrasi.

**Architecture:** Helper server `api/ai.js` (`callAI` — OpenAI-compatible, env-config) dipanggil oleh endpoint `POST /api/exercise/suggest`. Frontend `CustomExForm` menampilkan tombol "AI bantu isi", memvalidasi output AI terhadap enum (BODYPARTS, equipment), dan menampilkan preview form yang bisa diedit user sebelum simpan.

**Tech Stack:** Node 20+ (fetch global), React 19, Vitest. Tanpa dependensi baru (pakai `fetch` global Node).

**Spec:** `docs/superpowers/specs/2026-09-01-f4-ai-custom-exercise-design.md`

## Global Constraints

- Helper `callAI` di `api/ai.js` — **env-config**: `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`, `AI_PROVIDER`. OpenAI-compatible (`POST {BASE}/chat/completions`).
- Key **tidak pernah** dikirim ke client.
- Guardrail (spec §3.2): `bp` ∈ `BODYPARTS`; `eq` ∈ set equipment; `tg`/`sm` dinormalisasi via `ALIAS`; output AI **selalu lewat form editable**, tidak pernah ditulis langsung.
- Custom exercise baru menyimpan field kaya; custom lama (`tg:''`, `sm` absent, `eq:'custom'`) tetap valid — semua pembaca sudah toleran (analisa spec F4 §2).
- `api()` helper frontend sudah ada (`fetch` + JSON + error status).

---

### Task 1: Helper `callAI` di server (`api/ai.js`)

**Files:**
- Create: `api/ai.js`
- Test: `api/ai.test.js` (vitest, mock global fetch)

**Interfaces:**
- Consumes: `process.env.AI_*` (dibaca saat module load).
- Produces:
  - `callAI({ prompt, lang, system, json })` → `{ ok: true, text }` atau `{ ok: true, data }` atau `{ ok: false, status, error, raw? }`

- [ ] **Step 1: Write the failing test**

Create `api/ai.test.js`:

```js
import { describe, it, expect, vi, afterEach } from 'vitest'

// Env vars set before importing the module.
const OLD = { ...process.env }
afterEach(() => { vi.unstubAllGlobals(); Object.assign(process.env, OLD) })

async function freshCallAI() {
  vi.resetModules()
  const mod = await import('./ai.js')
  return mod.callAI
}

describe('callAI', () => {
  it('returns not_configured when AI_API_KEY is missing', async () => {
    delete process.env.AI_API_KEY
    const callAI = await freshCallAI()
    const r = await callAI({ prompt: 'hi' })
    expect(r).toEqual({ ok: false, status: 503, error: 'not_configured' })
  })

  it('posts to the configured base URL + model and returns text', async () => {
    process.env.AI_API_KEY = 'test-key'
    process.env.AI_BASE_URL = 'https://example.com/v1'
    process.env.AI_MODEL = 'test-model'
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: 'hello' } }] })
    })
    vi.stubGlobal('fetch', fetchMock)
    const callAI = await freshCallAI()
    const r = await callAI({ prompt: 'hi', system: 'sys' })
    expect(r).toEqual({ ok: true, text: 'hello' })
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('https://example.com/v1/chat/completions')
    expect(opts.headers.Authorization).toBe('Bearer test-key')
    expect(JSON.parse(opts.body).model).toBe('test-model')
    expect(JSON.parse(opts.body).messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' }
    ])
    // key never echoes back
    expect(JSON.stringify(r)).not.toContain('test-key')
  })

  it('parses JSON when json=true', async () => {
    process.env.AI_API_KEY = 'k'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ choices: [{ message: { content: '{"name":"X"}' } }] })
    }))
    const callAI = await freshCallAI()
    const r = await callAI({ prompt: 'p', json: true })
    expect(r).toEqual({ ok: true, data: { name: 'X' } })
  })

  it('returns error on non-2xx without leaking key', async () => {
    process.env.AI_API_KEY = 'secret-abc'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 401, text: async () => 'unauthorized'
    }))
    const callAI = await freshCallAI()
    const r = await callAI({ prompt: 'p' })
    expect(r.ok).toBe(false)
    expect(r.status).toBe(401)
    expect(JSON.stringify(r)).not.toContain('secret-abc')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- ../api/ai.test.js`
Expected: FAIL — `./ai.js` tidak ada / import error.

- [ ] **Step 3: Write minimal implementation**

Create `api/ai.js`:

```js
// callAI — OpenAI-compatible chat client, env-configured.
// Swap provider by changing env, never code: AI_BASE_URL / AI_API_KEY / AI_MODEL.

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
const AI_API_KEY = process.env.AI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'deepseek-v4-flash'
export const AI_PROVIDER = process.env.AI_PROVIDER || 'deepseek'   // label for logging/i18n

export async function callAI({ prompt, lang, system, json = false }) {
  if (!AI_API_KEY) return { ok: false, status: 503, error: 'not_configured' }
  const res = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + AI_API_KEY,
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: [
        ...(system ? [{ role: 'system', content: system }] : []),
        { role: 'user', content: lang ? `(Reply in ${lang}.)\n\n` + prompt : prompt },
      ],
      ...(json ? { response_format: { type: 'json_object' } } : {}),
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: body.slice(0, 500) }
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content ?? ''
  if (json) {
    try { return { ok: true, data: JSON.parse(text) } }
    catch (e) { return { ok: false, status: 502, error: 'invalid_json', raw: text.slice(0, 500) } }
  }
  return { ok: true, text }
}
```

Catatan: `lang` disisipkan ke prompt sebagai instruksi bahasa (spec §3.4 — AI mengikuti bahasa UI).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- ../api/ai.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/ai.js api/ai.test.js
git commit -m "feat(f4): callAI OpenAI-compatible helper (env-config)"
```

---

### Task 2: Endpoint `POST /api/exercise/suggest` di server

**Files:**
- Modify: `api/server.js` (import callAI + tambah route)
- Test: manual (curl) / ekstensi ai.test.js

**Interfaces:**
- Consumes: `callAI` dari `./ai.js` (Task 1).
- Produces: `POST /api/exercise/suggest` menerima `{ lang, description }`, returns `{ ok: true, exercise: { name, bp, eq, tg, sm, st } }` atau `{ error }`.

- [ ] **Step 1: Import callAI**

`api/server.js`, dekat import lain:

```js
import { callAI } from './ai.js';
```

- [ ] **Step 2: Add route**

Di `api/server.js`, tambah handler ke object `routes` (setelah `POST /api/activity`, sebelum `GET /api/admin/users`):

```js
'POST /api/exercise/suggest': async (req, res) => {
  let body = {};
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'bad request' }); }
  const { description, lang } = body;
  if (!description || typeof description !== 'string') return json(res, 400, { error: 'description required' });
  const system = 'You turn a plain-text exercise description into structured exercise metadata as JSON only. '
    + 'Return exactly this shape: {"name": string, "bp": one of bodypart, "eq": equipment, "tg": muscle, "sm": [muscles], "st": [step strings]}. '
    + 'No extra text outside the JSON.';
  const r = await callAI({ prompt: `Describe this exercise: ${description}`, lang, system, json: true });
  if (!r.ok) return json(res, r.status || 500, { error: r.error || 'ai error' });
  return json(res, 200, { exercise: r.data });
},
```

**Catatan:** server.js tidak punya `readBody` helper? Cek pola handler yang menerima body (misal `POST /api/activity` di ~442). Ikuti pola yang ada — jika memakai `req.on('data')`, buat helper `readBody(req)` yang mengumpulkan chunks, atau ikuti implementasi existing route yang membaca body. Lihat baris ~442-459 untuk pola persisnya.

- [ ] **Step 3: Test manual dengan curl**

Run server: `cd api && PORT=3001 DATA_DIR=/tmp/opengym-test node server.js` (butuh `AI_API_KEY` di env).
Test:
```bash
curl -s -X POST http://localhost:3001/api/exercise/suggest \
  -H 'Content-Type: application/json' \
  -d '{"description":"cable rear delt fly","lang":"id"}'
```
Expected: `{"exercise": {"name": ..., "bp": ..., "eq": ..., "tg": ..., "sm": ..., "st": ...}}` (atau error `not_configured` jika key belum di-set — aman).

- [ ] **Step 4: Commit**

```bash
git add api/server.js
git commit -m "feat(f4): POST /api/exercise/suggest endpoint"
```

---

### Task 3: Frontend — validasi enum helper

**Files:**
- Modify: `frontend/src/lib/exercises.js` (expose equipment set)
- Modify: `frontend/src/lib/muscles.js` (expose `normalizeMuscleName`)
- Test: extend `exercises.test.js` / baru

**Interfaces:**
- Consumes: `EXDB`, `BODYPARTS` (existing).
- Produces:
  - `isKnownEquipment(eq)` → boolean (dari set equipment EXDB)
  - `normalizeMuscleName(name)` → slug | null (pecah dari `ALIAS`)

- [ ] **Step 1: Write the failing test**

Append ke `frontend/src/lib/exercises.test.js`:

```js
import { isKnownEquipment, byMuscle, sortByMusclePrimary } from './exercises.js'
import { normalizeMuscleName } from './muscles.js'

describe('AI suggest guardrail helpers', () => {
  it('isKnownEquipment accepts real equipment, rejects garbage', () => {
    expect(isKnownEquipment('barbell')).toBe(true)
    expect(isKnownEquipment('dumbbell')).toBe(true)
    expect(isKnownEquipment('cable')).toBe(true)
    expect(isKnownEquipment('quantum wibble')).toBe(false)
  })
  it('normalizeMuscleName maps alias spellings to a slug', () => {
    expect(normalizeMuscleName('deltoids')).toBe('deltoids')
    expect(normalizeMuscleName('Rear Deltoids')).toBe('deltoids')
    expect(normalizeMuscleName('latissimus dorsi')).toBe('upper-back')
    expect(normalizeMuscleName('not a muscle')).toBe(null)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- exercises.test.js`
Expected: FAIL — `isKnownEquipment` / `normalizeMuscleName` tidak terdefinisi.

- [ ] **Step 3: Write implementation**

`frontend/src/lib/exercises.js`, tambah:

```js
// Guardrail for AI-suggested fields: is this equipment real?
export function isKnownEquipment(eq) {
  return new Set(EXDB.map(e => e.eq)).has(eq)
}
```

`frontend/src/lib/muscles.js`, refactor `ALIAS` + expose:

```js
// ALIAS tetap ada (internal). Tambah export:
export function normalizeMuscleName(name) {
  return ALIAS[String(name || '').toLowerCase().trim()] ?? null
}
```

Lalu ganti pemakaian internal `ALIAS[...]` di `musclesOf` agar reuse `normalizeMuscleName` (DRY):

```js
export function musclesOf(ex) {
  if (!ex) return {}
  const out = {}
  const add = (name, w) => {
    const slug = normalizeMuscleName(name)
    if (slug) out[slug] = Math.max(out[slug] || 0, w)
  }
  add(ex.tg, 1)
  ;(ex.sm || []).forEach(m => add(m, SECONDARY))
  if (!Object.keys(out).length) Object.assign(out, BY_BODYPART[ex.bp] || {})
  return out
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- exercises.test.js`
Expected: PASS (termasuk test lama `byMuscle` yang bergantung pada `musclesOf`).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/exercises.js frontend/src/lib/muscles.js frontend/src/lib/exercises.test.js
git commit -m "feat(f4): guardrail helpers isKnownEquipment + normalizeMuscleName"
```

---

### Task 4: UI — tombol "AI bantu isi" di CustomExForm

**Files:**
- Modify: `frontend/src/sheets.jsx` (`CustomExForm` ~345-380)
- Test: manual

**Interfaces:**
- Consumes: `api()` dari `./lib/api.js`; `isKnownEquipment`; `normalizeMuscleName`; `BODYPARTS`; `t`; `toast`; `Button`.
- Produces: state AI fill (`aiFill` = object | null), tombol, preview editable.

- [ ] **Step 1: Add imports**

`frontend/src/sheets.jsx`, tambah:

```jsx
import { api } from './lib/api.js'
import { isKnownEquipment } from './lib/exercises.js'
import { normalizeMuscleName } from './lib/muscles.js'
```

- [ ] **Step 2: Add AI-fill state + handler**

Di `CustomExForm`, tambah state dan fungsi:

```jsx
const [aiFill, setAiFill] = useState(null)      // { name, bp, eq, tg, sm, st } or null
const [aiBusy, setAiBusy] = useState(false)

async function askAI() {
  if (!n || !n.trim()) { toast(t('Describe the exercise first')); return }
  setAiBusy(true)
  try {
    const r = await api('/api/exercise/suggest', { method: 'POST', body: JSON.stringify({ description: n.trim(), lang: getLang() }) })
    const e = r.exercise || {}
    // Guardrail: only accept valid enum values
    const bpOk = BODYPARTS.includes(e.bp) ? e.bp : ''
    const eqOk = isKnownEquipment(e.eq) ? e.eq : 'body weight'
    const tgOk = normalizeMuscleName(e.tg)
    const smOk = (Array.isArray(e.sm) ? e.sm : []).map(normalizeMuscleName).filter(Boolean)
    const stOk = (Array.isArray(e.st) ? e.st : []).map(s => String(s).slice(0, 200)).slice(0, 8)
    setAiFill({ name: String(e.name || n).slice(0, 80), bp: bpOk, eq: eqOk, tg: tgOk || '', sm: smOk, st: stOk })
    if (!bpOk) toast(t('Couldn’t match a body part — pick one below'))
  } catch (err) {
    toast(err.message || t('AI is not available'))
  } finally {
    setAiBusy(false)
  }
}
```

- [ ] **Step 3: Render tombol + preview**

Di `CustomExForm`, setelah textarea description, tambah:

```jsx
<div className="row" style={{ gap: 8, margin: '10px 0' }}>
  <Button variant="tinted" icon="sparkles" disabled={aiBusy} onClick={askAI}>
    {aiBusy ? t('Thinking…') : t('Fill with AI')}
  </Button>
</div>
{aiFill && <>
  <h4 className="sec">{t('AI suggestion — edit before saving')}</h4>
  <input className="input" value={aiFill.name} onChange={e => setAiFill(x => ({ ...x, name: e.target.value }))} placeholder={t('Exercise name')} />
  <div className="chips" style={{ margin: '12px 0' }}>
    {BODYPARTS.map(b => <button key={b} className={'chip' + (aiFill.bp === b ? ' on' : '')} onClick={() => setAiFill(x => ({ ...x, bp: b }))}>{t(b)}</button>)}
  </div>
  {aiFill.eq && <div className="small dim" style={{ marginBottom: 10 }}>{t('Equipment')}: <b>{t(aiFill.eq)}</b></div>}
  {aiFill.tg && <div className="small dim" style={{ marginBottom: 10 }}>{t('Target muscle')}: <b>{t(aiFill.tg)}</b></div>}
  {aiFill.st.length > 0 && <ol className="steps-list">{aiFill.st.map((s, i) => <li key={i}>{s}</li>)}</ol>}
</>}
```

- [ ] **Step 4: Wire save() to use aiFill**

Ubah `save()` agar ketika `aiFill` ada, field kaya disimpan. Di `save()`, untuk kasus create (bukan existing), tambah field kaya:

```jsx
else {
  id = 'c' + uid()
  update(s => { (s.customEx = s.customEx || []).push({
    id, n: name, bp, desc: d, custom: true,
    ...(aiFill && aiFill.eq ? { eq: aiFill.eq } : { eq: 'custom' }),
    ...(aiFill && aiFill.tg ? { tg: aiFill.tg } : { tg: '' }),
    ...(aiFill && aiFill.sm.length ? { sm: aiFill.sm } : {}),
    ...(aiFill && aiFill.st.length ? { st: aiFill.st } : {})
  }) })
}
```

**Penting:** `name`/`bp` di `save()` berasal dari state `n`/`bp` (yang bisa diisi dari aiFill via preview), dan validasi duplikat/empty tetap berlaku. Field kaya hanya disimpan jika ada — custom lama tanpa field ini tetap valid (backward-compat).

- [ ] **Step 5: Manual test**

Run: `cd frontend && npm run dev` (dengan server + AI_API_KEY). Buka Library → "Create your own exercise" → ketik "cable rear delt fly" → "Fill with AI" → preview terisi → edit → Create. Verifikasi: exercise muncul, muscle map menandainya, search menemukannya.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/sheets.jsx
git commit -m "feat(f4): AI-assisted custom exercise fill with guardrails"
```

---

### Task 5: i18n strings untuk F4

**Files:**
- Modify: `frontend/src/locales/id.js` (+ lainnya opsional)
- Test: manual

**Interfaces:**
- Produces: key baru:
  - `'Describe the exercise first'`
  - `'Fill with AI'` / `'Thinking…'`
  - `'AI suggestion — edit before saving'`
  - `'Equipment'` / `'Target muscle'`
  - `'Couldn't match a body part — pick one below'`
  - `'AI is not available'`

- [ ] **Step 1: Tambah ke id.js**

```js
'Fill with AI': 'Isi dengan AI',
'Thinking…': 'Memikirkan…',
'AI suggestion — edit before saving': 'Saran AI — edit sebelum menyimpan',
'Equipment': 'Peralatan',
'Target muscle': 'Otot sasaran',
'Describe the exercise first': 'Deskripsikan gerakannya dulu',
'Couldn’t match a body part — pick one below': 'Tidak dapat mencocokkan bagian tubuh — pilih di bawah',
'AI is not available': 'AI tidak tersedia',
```

- [ ] **Step 2: Verifikasi + commit**

```bash
cd frontend && npm test
git add frontend/src/locales/
git commit -m "feat(f4): i18n AI custom exercise strings"
```

---

## Self-Review

**1. Spec coverage (F4 spec):**
- §3.1 server `POST /api/exercise/suggest` ✓ (Task 2)
- §3.2 guardrail validasi (bp/eq/tg/sm/st) ✓ (Task 3 helpers + Task 4 frontend)
- §4 skema custom baru + backward-compat ✓ (Task 4 save)
- §5 implementasi (callAI, endpoint, form, helper) ✓ (Tasks 1-4)
- §6 testing ✓ (Tasks 1,3)

**2. Placeholder scan:** Tidak ada TBD/TODO. Satu catatan di Task 2 Step 2 (`readBody` pola) — saya tandai untuk mengikuti pola existing, bukan placeholder karena kode route sudah diberikan penuh; hanya cara membaca body yang perlu disesuaikan dengan helper yang ada di server.js. Saya akan verifikasi `readBody` saat implementasi.

**3. Type consistency:**
- `callAI` signature konsisten Task 1 → Task 2. ✓
- `normalizeMuscleName`, `isKnownEquipment` konsisten Task 3 → Task 4. ✓
- `api()` dari lib/api.js (verified signature). ✓
- `getLang` dari i18n (verified export). ✓

**4. Gap yang saya temukan:**
- Task 2 menggunakan `readBody` yang mungkin belum ada di server.js. Saya perlu cek pola route body-reading yang ada sebelum menulis kode definitif. Ditandai di Task 2 Step 2. Ini bukan blocker — mengikuti pola existing.
- `save()` existing menghapus field `tg:''`/`eq:'custom'` dari custom lama? Tidak — custom lama dibuat dengan `{ tg: '', eq: 'custom' }` eksplisit. Task 4 mempertahankan default ini untuk kasus manual, dan hanya menambah field kaya jika `aiFill` ada. Backward-compat aman.

---

## Execution Handoff

Plan selesai dan disimpan ke `docs/superpowers/plans/2026-09-01-f4-ai-custom-exercise.md`.
