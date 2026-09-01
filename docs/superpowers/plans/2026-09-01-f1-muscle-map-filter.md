# F1 — Peta Otot → Filter Exercise: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan filter "pilih exercises berdasarkan otot yang diklik dari grafik tubuh" di Library dan ExercisePicker, menggunakan BodyMap yang sudah ada.

**Architecture:** Tambahkan state `muscle` (slug otot) di `Library` dan `ExercisePicker`. Filter daftar exercise dengan `musclesOf(ex)[slug] > 0` (helper `byMuscle`), lalu sortir primary-first (`sortByMusclePrimary`). BodyMap di-render ulang dengan `onMuscle`/`selected` (sudah ada di komponen) sebagai mode filter otot.

**Tech Stack:** React 19, Vitest, module `exercises.js`/`muscles.js` yang sudah ada. Tanpa dependensi baru.

**Spec:** `docs/superpowers/specs/2026-09-01-f1-muscle-map-filter-design.md`

## Global Constraints

- Helper baru ditaruh di `frontend/src/lib/exercises.js` (pola existing, di-export, pure).
- Semua string UI baru pakai `t('English source', ...)` sebagai key — English fallback otomatis.
- BodyMap **tidak diubah** — pakai prop `onMuscle`/`selected` yang sudah ada.
- Test dengan Vitest (`npm test` di `frontend/`), pola `describe/it/expect`.
- Sortir: primary (`tg`) dulu, secondary (`sm`) setelah — didasarkan pada `musclesOf(ex)[slug] >= 1` (primary = full weight dari `tg`).
- Interaksi filter otot = `AND` dengan filter `bp`/`eq`/search yang sudah ada.
- Tidak ada CSS baru — `.bodymap.tappable`, `.mchips`, `.chips` sudah ada di `index.css`.

---

### Task 1: Helper murni `byMuscle` dan `sortByMusclePrimary` di `exercises.js`

**Files:**
- Modify: `frontend/src/lib/exercises.js`
- Create: `frontend/src/lib/exercises.test.js`

**Interfaces:**
- Consumes: `musclesOf` dari `./muscles.js` (sudah ada, export), `EXIDX` (sudah ada).
- Produces:
  - `byMuscle(list, slug)` → `Exercise[]` — item yang `musclesOf(item)[slug] > 0`
  - `sortByMusclePrimary(list, slug)` → `Exercise[]` — sorted, primary first, non-mutating

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/exercises.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { EXDB, byMuscle, sortByMusclePrimary } from './exercises.js'

// Bench press trains chest (primary), plus biceps/deltoids as secondary (muscles.js SECONDARY=0.4).
const bench = EXDB.find(e => e.n === 'Bench Press') || EXDB.find(e => e.tg === 'chest')
const row = EXDB.find(e => e.tg === 'biceps')

describe('byMuscle', () => {
  it('includes exercises whose musclesOf maps the slug', () => {
    const hits = byMuscle(EXDB, 'chest')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some(e => e.id === bench.id)).toBe(true)
  })

  it('includes exercises that train the muscle as secondary', () => {
    // biceps is a secondary muscle of bench press
    const hits = byMuscle(EXDB, 'biceps')
    expect(hits.some(e => e.id === bench.id)).toBe(true)
  })

  it('excludes exercises that do not train the muscle', () => {
    const hits = byMuscle(EXDB, 'calves')
    expect(hits.some(e => e.id === bench.id)).toBe(false)
  })

  it('returns [] for an unknown slug', () => {
    expect(byMuscle(EXDB, 'not-a-muscle')).toEqual([])
  })
})

describe('sortByMusclePrimary', () => {
  it('puts primary exercises before secondary ones for a muscle', () => {
    const hits = byMuscle(EXDB, 'biceps')
    const sorted = sortByMusclePrimary(hits, 'biceps')
    const prim = new Set(hits.filter(e => musclesPrimary(e, 'biceps')).map(e => e.id))
    // index of first primary < index of first secondary
    const firstSecondary = sorted.findIndex(e => !prim.has(e.id))
    const lastPrimary = sorted.findLastIndex(e => prim.has(e.id))
    expect(lastPrimary).toBeLessThan(firstSecondary)
  })

  it('does not mutate its input', () => {
    const hits = byMuscle(EXDB, 'chest')
    const before = hits.map(e => e.id)
    sortByMusclePrimary(hits, 'chest')
    expect(hits.map(e => e.id)).toEqual(before)
  })
})

// tiny local helper for the test (primary = full weight from tg)
function musclesPrimary(e, slug) {
  const m = {}
  const add = (name, w) => { const s = name && name.toLowerCase().trim(); if (s) m[s] = Math.max(m[s] || 0, w) }
  add(e.tg, 1)
  ;(e.sm || []).forEach(x => add(x, 0.4))
  return m[slug] >= 1
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- exercises.test.js`
Expected: FAIL — `byMuscle` / `sortByMusclePrimary` tidak terdefinisi (ReferenceError / module resolution fail).

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/lib/exercises.js`:

```js
import { musclesOf } from './muscles.js'

// Exercises whose musclesOf map includes the slug — primary or secondary.
export function byMuscle(list, slug) {
  return list.filter(e => musclesOf(e)[slug] > 0)
}

// Sort: exercises training the muscle as PRIMARY (tg, full weight) first,
// secondary after. Non-mutating.
export function sortByMusclePrimary(list, slug) {
  const prim = new Set()
  list.forEach(e => { if (musclesOf(e)[slug] >= 1) prim.add(e.id) })
  return [...list].sort((a, b) =>
    (prim.has(b.id) ? 1 : 0) - (prim.has(a.id) ? 1 : 0))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- exercises.test.js`
Expected: PASS — semua `it` hijau.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/exercises.js frontend/src/lib/exercises.test.js
git commit -m "feat(f1): add byMuscle and sortByMusclePrimary helpers"
```

---

### Task 2: Filter otot di Library

**Files:**
- Modify: `frontend/src/views/Library.jsx`
- Test: manual (komponen React, tidak ada test UI di codebase)

**Interfaces:**
- Consumes: `byMuscle`, `sortByMusclePrimary` (Task 1); `BodyMap`, `BodyMapLegend` dari `../components/BodyMap.jsx`; `MUSCLE_NAME` dari `../lib/muscles.js`; `t` dari `../lib/i18n.js`.
- Produces: state `muscle` (string slug | null). Filter otot aktif → list disortir primary-first.

- [ ] **Step 1: Add imports**

`frontend/src/views/Library.jsx`, import baru (gabung dengan import `exercises.js` yang sudah ada):

```jsx
import { EXDB, BODYPARTS, allExercises, equipmentOf, byMuscle, sortByMusclePrimary } from '../lib/exercises.js'
import BodyMap, { BodyMapLegend } from '../components/BodyMap.jsx'
import { MUSCLE_NAME } from '../lib/muscles.js'
```

- [ ] **Step 2: Add muscle state**

Setelah `const [eq, setEq] = useState('')`, tambah:

```jsx
const [muscle, setMuscle] = useState(null)   // null = all, else a muscle slug
```

- [ ] **Step 3: Apply filter + sort**

Di `Library`, setelah `base` dihitung, tambah filter otot sebelum equipment filter. Ganti blok yang menghitung `base`/`f`:

Saat ini:
```jsx
const base = allExercises(S).filter(e => (!bp || e.bp === bp) && ...)
const eqOpts = equipmentOf(base)
const eqOn = eqOpts.includes(eq) ? eq : ''
const f = eqOn ? base.filter(e => e.eq === eqOn) : base
```

Menjadi:
```jsx
let base = allExercises(S).filter(e => (!bp || e.bp === bp) && ...)
if (muscle) base = sortByMusclePrimary(byMuscle(base, muscle), muscle)
const eqOpts = equipmentOf(base)
const eqOn = eqOpts.includes(eq) ? eq : ''
const f = eqOn ? base.filter(e => e.eq === eqOn) : base
```

- [ ] **Step 4: Render BodyMap filter + chips**

Di `Library`, setelah baris chips equipment dan sebelum `<div className="list">`, tambah blok filter otot (collapsible toggle):

```jsx
<div className="sect-b" style={{ margin: '6px 0 10px' }}>
  <Button size="sm" variant={muscle ? 'tinted' : 'ghost'} icon="figureStrength"
    onClick={() => setMuscle(muscle ? null : 'chest')}>
    {muscle ? t('By muscle: {0}', t(MUSCLE_NAME[muscle])) : t('Filter by muscle')}
  </Button>
</div>
{muscle && <>
  <BodyMap className="tappable" load={{}} body={S.body} selected={muscle}
    onMuscle={m => { setMuscle(s => (s === m ? null : m)); setShown(40) }} />
  <BodyMapLegend />
</>}
```

Catatan: `load={{}}` membuat semua otot level 0 (tidak tervalidasi); `selected={muscle}` menandai otot yang aktif dengan stroke; klik otot toggle. Saat `muscle` null, BodyMap disembunyikan agar tidak selalu makan ruang.

- [ ] **Step 5: Manual test**

Run: `cd frontend && npm run dev` (butuh server API + media; atau jalankan demo build). Verifikasi:
- Klik "Filter by muscle" → BodyMap muncul.
- Klik otot "Biceps" → daftar menampilkan exercise yang melatih biceps (termasuk bench press sebagai secondary).
- Klik ulang otot → kembali ke semua.
- Kombinasi filter otot + body-part + equipment + search berjalan.
- Clear filter → daftar penuh.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/Library.jsx
git commit -m "feat(f1): muscle-map filter in Library"
```

---

### Task 3: Filter otot di ExercisePicker

**Files:**
- Modify: `frontend/src/sheets.jsx` (fungsi `ExercisePicker`, baris 411-456)
- Test: manual

**Interfaces:**
- Consumes: `byMuscle`, `sortByMusclePrimary` (Task 1); `BodyMap`, `BodyMapLegend` (sudah di-import di sheets.jsx baris 16); `MUSCLE_NAME` dari `../lib/muscles.js` (perlu import); `t`.
- Produces: state `muscle` di ExercisePicker.

- [ ] **Step 1: Add imports**

`frontend/src/sheets.jsx`, import MUSCLE_NAME:

```jsx
import { byMuscle, sortByMusclePrimary } from './lib/exercises.js'
import { MUSCLE_NAME } from './lib/muscles.js'
```

(Cek dulu apakah sudah ada `import { ... } from './lib/muscles.js'` di sheets.jsx — jika ya, gabung.)

- [ ] **Step 2: Add muscle state + filter**

Di `ExercisePicker` (baris ~417, setelah `const [eq, setEq] = useState('')`):

```jsx
const [muscle, setMuscle] = useState(null)
```

Lalu setelah `base` dihitung, sebelum equipment filter:

```jsx
if (muscle) base = sortByMusclePrimary(byMuscle(base, muscle), muscle)
```

- [ ] **Step 3: Render toggle + BodyMap**

Di `ExercisePicker`, setelah baris chips equipment dan sebelum `<div className="list">` (baris ~441):

```jsx
<div className="sect-b" style={{ margin: '6px 0 10px' }}>
  <Button size="sm" variant={muscle ? 'tinted' : 'ghost'} icon="figureStrength"
    onClick={() => setMuscle(muscle ? null : 'chest')}>
    {muscle ? t('By muscle: {0}', t(MUSCLE_NAME[muscle])) : t('Filter by muscle')}
  </Button>
</div>
{muscle && <>
  <BodyMap className="tappable" load={{}} body={S.body} selected={muscle}
    onMuscle={m => { setMuscle(s => (s === m ? null : m)); setShown(50) }} />
  <BodyMapLegend />
</>}
```

Catatan: `S` di ExercisePicker = `st` (state dari `useStore`). Gunakan `st.body`.

- [ ] **Step 4: Manual test**

Buka routine editor → "Add exercise" → tombol "Filter by muscle" → klik otot → daftar tersaring. Verifikasi seperti Task 2, dan hasil pick mengisi config exercise normal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sheets.jsx
git commit -m "feat(f1): muscle-map filter in ExercisePicker"
```

---

### Task 4: i18n strings untuk F1

**Files:**
- Modify: `frontend/src/lib/i18n.js` (English source = key, tidak perlu edit untuk English)
- Modify: `frontend/src/locales/*.js` (13 file) — tambah key baru

**Interfaces:**
- Consumes: `t()` dari i18n (sudah ada).
- Produces: key i18n baru: `'Filter by muscle'`, `'By muscle: {0}'`.

- [ ] **Step 1: Tambah key baru ke semua locale**

Key English (source):
- `'Filter by muscle'`
- `'By muscle: {0}'`

Untuk masing-masing 13 locale (`en` inline, plus de/es/fr/it/pt/pl/tr/ru/zh/ko/hi/id), tambah pasangan. Contoh:
- `de.js`: `'Filter by muscle': 'Nach Muskel filtern'`, `'By muscle: {0}': 'Nach Muskel: {0}'`
- `id.js`: `'Filter by muscle': 'Filter berdasarkan otot'`, `'By muscle: {0}': 'Berdasarkan otot: {0}'`

Untuk locale yang belum diterjemahkan, biarkan English fallback (t() menangani). Minimal: tambahkan ke `id.js` (target user) dan biarkan sisanya — tapi untuk kelengkapan, tambah ke semua yang punya terjemahan aktif.

- [ ] **Step 2: Verifikasi**

Run: `cd frontend && npm test` (smoke — pastikan tidak ada test rusak). Manual: ganti bahasa ke `id`, buka Library, filter otot → label "Filter berdasarkan otot" tampil.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/locales/ frontend/src/lib/i18n.js
git commit -m "feat(f1): i18n strings for muscle filter"
```

---

## Self-Review

**1. Spec coverage (F1 spec):**
- §4.1 tujuan ✓ (Task 1-3)
- §4.2 perilaku: klik otot filter ✓ (Task 2/3), toggle ✓, sortir primary-first ✓ (Task 1), AND dengan filter ✓, custom exercise otomatis ✓ (musclesOf fallback, tidak perlu kode tambahan)
- §4.3 implementasi: helper baru ✓ (Task 1), Library ✓ (Task 2), ExercisePicker ✓ (Task 3)
- §4.4 data flow ✓
- §4.5 testing: unit ✓ (Task 1), manual ✓ (Task 2/3)

**2. Placeholder scan:** Tidak ada "TBD"/"TODO". Semua langkah punya kode konkret. ✓

**3. Type consistency:**
- `byMuscle(list, slug)` dan `sortByMusclePrimary(list, slug)` — konsisten dipakai Task 2 & 3. ✓
- `MUSCLE_NAME[muscle]` — konsisten dengan `MUSCLES` slugs di muscles.js. ✓
- `S.body` di Library vs `st.body` di ExercisePicker — sesuai variabel yang ada di masing-masing komponen. ✓

**4. Gap yang saya temukan saat review:** Task 2 Step 4 memakai `S.body` dan `t`, Task 3 `st.body`. Keduanya sudah ada di komponen. Tidak perlu CSS baru (sudah ada). Icon `figureStrength` (siluet tubuh) dipakai untuk tombol filter — sudah diverifikasi ada di Icon.jsx, tidak perlu glyph baru.

---

## Execution Handoff

Plan selesai dan disimpan ke `docs/superpowers/plans/2026-09-01-f1-muscle-map-filter.md`. Dua opsi eksekusi:

**1. Subagent-Driven (recommended)** — saya dispatch subagent fresh per task, review antar task, iterasi cepat

**2. Inline Execution** — eksekusi task dalam sesi ini, batch dengan checkpoint

Pilih yang mana?
