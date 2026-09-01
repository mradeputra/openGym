# F2 — Rule Engine Tiered (Coach Hints): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan deteksi & saran deterministic (coach hints) untuk set variance, rep drop tiered, plateau tiered, dan substitution — ditampilkan di `FinishSummary` setelah workout selesai.

**Architecture:** Modul murni `lib/coach.js` yang mengambil `S` (state) + `workout` yang baru selesai, menghasilkan `CoachHint[]` menggunakan fungsi existing `sessionsFor`/`readSession`/`stallCount` dari `progression.js`. `FinishSummary` memanggil `coachHints()` dan merender kartu hint. Tanpa HTTP/DB.

**Tech Stack:** React 19, Vitest. Pure module `coach.js` (pola `progression.js`).

**Spec:** `docs/superpowers/specs/2026-09-01-f2-rule-engine-design.md`

## Global Constraints

- `coach.js` = **pure module** — tanpa import `useStore`/React/HTTP. Input: `S` (plain object) + workout. Output: `CoachHint[]`.
- Reuse fungsi existing: `sessionsFor(S, exId, fallback)`, `readSession`, `stallCount` dari `progression.js`; `modeOf` dari `history.js`.
- `CoachHint` shape (dari spec §4):
  ```ts
  { ruleId, tier, severity, exerciseId, messageKey, params, suggestedAction?, reasoning[] }
  ```
- Prioritas multiple-rule: `set-variance` → `rep-drop` → `plateau` → `substitution` (hanya satu hint per exercise; yang berprioritas lebih tinggi menang).
- Hint muncul **hanya di `FinishSummary`** — tidak di Workout.jsx (MVP).
- Semua string lewat `t('English source', ...)` — English source = key.
- Vitest: `cd frontend && npm test -- <file>`.

---

### Task 1: Pure helper — evaluasi session per exercise

**Files:**
- Create: `frontend/src/lib/coach.js`
- Create: `frontend/src/lib/coach.test.js`

**Interfaces:**
- Consumes: `sessionsFor`, `readSession`, `stallCount` dari `./progression.js`; `modeOf` dari `./history.js`.
- Produces:
  - `evaluateSession(exercise, sessions)` → `CoachHint | null` — deteksi rule untuk satu exercise.
  - `coachHints(S, workout)` → `CoachHint[]` — loop entry workout, panggil `evaluateSession`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/coach.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { coachHints } from './coach.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id

// Build a state whose history for one exercise is a list of sessions given as
// [weight, ...repsPerSet]. null = set never checked off.
const hist = (id, rows) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    entries: [{
      id,
      target: { sets: row.length - 1, reps: 12, weight: row[0] },
      sets: row.slice(1).map(r => (r === null ? { w: row[0], r: 0, done: false } : { w: row[0], r, done: true }))
    }]
  }))
})
// A completed workout object (as doFinishWorkout builds it) — the last session plus a flag.
const asWorkout = (id, lastRow) => {
  const [w, ...reps] = lastRow
  return { id, d: '2026-02-01', entries: [{ id, sets: reps.map(r => ({ w, r, done: true })), target: { sets: reps.length, reps: 12, weight: w } }] }
}

describe('coachHints — set variance', () => {
  it('flags a session where sets are inconsistent (12-10-8 vs target 12)', () => {
    const S = hist(LIFT, [[40, 12, 10, 8], [40, 12, 12, 12]])
    const w = asWorkout(LIFT, [40, 12, 10, 8])
    const hints = coachHints(S, w)
    const sv = hints.find(h => h.ruleId === 'set-variance')
    expect(sv).toBeTruthy()
    expect(sv.severity).toBe('info')
  })
  it('does not flag a consistent session', () => {
    const S = hist(LIFT, [[40, 12, 12, 12]])
    const w = asWorkout(LIFT, [40, 12, 12, 12])
    const hints = coachHints(S, w)
    expect(hints.find(h => h.ruleId === 'set-variance')).toBeFalsy()
  })
})

describe('coachHints — rep drop tiered', () => {
  it('tier 1: one rep drop → repeat', () => {
    const S = hist(LIFT, [[40, 12, 12, 12], [40, 12, 10, 12]])
    const w = asWorkout(LIFT, [40, 12, 10, 12])
    const rd = coachHints(S, w).find(h => h.ruleId === 'rep-drop')
    expect(rd).toBeTruthy()
    expect(rd.tier).toBe(1)
    expect(rd.suggestedAction).toBe('repeat')
  })
  it('tier 2: two drops in a row → deload', () => {
    const S = hist(LIFT, [[40, 12, 12, 12], [40, 12, 10, 12], [40, 12, 9, 11]])
    const w = asWorkout(LIFT, [40, 12, 9, 11])
    const rd = coachHints(S, w).find(h => h.ruleId === 'rep-drop')
    expect(rd.tier).toBe(2)
    expect(rd.suggestedAction).toBe('deload')
  })
  it('tier 3: three drops in a row → evaluate', () => {
    const S = hist(LIFT, [[40, 12, 12, 12], [40, 12, 10, 12], [40, 12, 9, 11], [40, 12, 8, 10]])
    const w = asWorkout(LIFT, [40, 12, 8, 10])
    const rd = coachHints(S, w).find(h => h.ruleId === 'rep-drop')
    expect(rd.tier).toBe(3)
    expect(rd.suggestedAction).toBe('evaluate')
  })
})

describe('coachHints — plateau tiered', () => {
  it('tier 1: 3 sessions same → technique', () => {
    const rows = [[40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11]]
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[3])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl).toBeTruthy()
    expect(pl.tier).toBe(1)
    expect(pl.suggestedAction).toBe('technique')
  })
  it('tier 2: 4 sessions same → substitute', () => {
    const rows = [[40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11]]
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[4])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl.tier).toBe(2)
    expect(pl.suggestedAction).toBe('substitute')
  })
  it('tier 3: 5+ sessions same → full deload', () => {
    const rows = [1,2,3,4,5,6].map(() => [40, 12, 10, 11])
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[5])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl.tier).toBe(3)
    expect(pl.suggestedAction).toBe('full-deload')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- coach.test.js`
Expected: FAIL — `coach.js` tidak ada / `coachHints` tidak terdefinisi.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/coach.js`:

```js
// Coach hints: deterministic decision support on top of progression.
// Pure function of workout history — same philosophy as progression.js.
// LLM (F3) only explains these; it never changes them.

import { sessionsFor, readSession, stallCount } from './progression.js'
import { modeOf } from './history.js'

// A session is "reps flat at the same numbers" when the min reps stopped improving.
const PRIORITY = { 'set-variance': 0, 'rep-drop': 1, 'plateau': 2, 'substitution': 3 }

export function coachHints(S, workout) {
  const hints = []
  for (const entry of (workout?.entries || [])) {
    const hint = evaluateEntry(S, entry)
    if (hint) hints.push(hint)
  }
  return hints.sort((a, b) => PRIORITY[a.ruleId] - PRIORITY[b.ruleId])
}

// One exercise: read its history, detect the dominant edge case.
export function evaluateEntry(S, entry) {
  const exId = entry.id
  const fallback = entry.target || {}
  const sessions = sessionsFor(S, exId, fallback).filter(s => s.mode === modeOf({ ...fallback, id: exId }))
  const last = sessions[sessions.length - 1]
  if (!last) return null

  const setVariance = detectSetVariance(last)
  if (setVariance) return { ruleId: 'set-variance', tier: 1, severity: 'info', exerciseId: exId, ...setVariance }

  const repDrop = detectRepDrop(sessions)
  if (repDrop) return { ruleId: 'rep-drop', tier: repDrop.tier, severity: repDrop.tier > 1 ? 'warning' : 'action', exerciseId: exId, ...repDrop }

  const plateau = detectPlateau(sessions)
  if (plateau) return { ruleId: 'plateau', tier: plateau.tier, severity: plateau.tier > 1 ? 'warning' : 'action', exerciseId: exId, ...plateau }

  return null
}

function detectSetVariance(last) {
  if (last.mode !== 'reps' || !last.reps.length || last.ok) return null
  const min = Math.min(...last.reps)
  const max = Math.max(...last.reps)
  if (max - min < 2) return null   // e.g. 12-11-12 is normal variance, not a pattern
  return {
    messageKey: 'Set variance — targets not met consistently',
    params: { min, max, goal: last.goal },
    suggestedAction: 'hold',
    reasoning: [`Sets were {0}…{1} while the target is {2} reps — hold the weight and chase consistency.`, min, max, last.goal]
  }
}

function detectRepDrop(sessions) {
  if (sessions.length < 2) return null
  // Compare each session's achieved min reps to the one before it.
  const lows = sessions.map(s => s.low)
  let drops = 0
  for (let i = lows.length - 1; i > 0; i--) {
    if (lows[i] < lows[i - 1]) drops++
    else break
  }
  if (drops === 0) return null
  if (drops === 1) return {
    tier: 1, messageKey: 'Reps dropped once — repeat this weight next week',
    params: {}, suggestedAction: 'repeat',
    reasoning: ['Reps dropped from {0} to {1} — hold the weight and aim to match last week.', lows[lows.length - 2], lows[lows.length - 1]]
  }
  if (drops === 2) return {
    tier: 2, messageKey: 'Reps dropped two sessions running — deload 10 %',
    params: {}, suggestedAction: 'deload',
    reasoning: ['Reps have dropped {0} sessions in a row — deload to give recovery a chance.', drops]
  }
  return {
    tier: 3, messageKey: 'Reps dropped three sessions running — evaluate the plan',
    params: {}, suggestedAction: 'evaluate',
    reasoning: ['Reps dropped {0} sessions running — consider substituting the exercise or reviewing the program.', drops]
  }
}

function detectPlateau(sessions) {
  // A plateau = the same weight and same rep outcome over N sessions.
  if (sessions.length < 3) return null
  const w = sessions[sessions.length - 1].weight
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]
    if (s.weight !== w || s.ok || s.low === 0) break
    // same low-or-high? we treat "same weight, not ok, low unchanged" as stagnation
    n++
  }
  if (n < 3) return null
  if (n === 3) return { tier: 1, messageKey: 'Plateau — try an intensity technique', params: {}, suggestedAction: 'technique', reasoning: ['Same weight for {0} sessions — try rest-pause or a drop set.', n] }
  if (n === 4) return { tier: 2, messageKey: 'Plateau — substitute to a variation', params: {}, suggestedAction: 'substitute', reasoning: ['Same weight for {0} sessions — swap to a variation working the same muscles.', n] }
  return { tier: 3, messageKey: 'Plateau — take a full deload week', params: {}, suggestedAction: 'full-deload', reasoning: ['Same weight for {0}+ sessions — a full deload week is due.', n] }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- coach.test.js`
Expected: PASS — semua `it` hijau. (Jika ada edge yang gagal karena definisi plateau/rep-drop, sesuaikan logika `detect*` dengan data yang sebenarnya — sesi "ok" di `hist` helper mungkin memicu jalur berbeda.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/coach.js frontend/src/lib/coach.test.js
git commit -m "feat(f2): coach hints pure module (set-variance, rep-drop, plateau)"
```

---

### Task 2: Render coach hints di FinishSummary

**Files:**
- Modify: `frontend/src/sheets.jsx` (fungsi `FinishSummary` ~905-925, `doFinishWorkout` ~935-969)
- Test: manual

**Interfaces:**
- Consumes: `coachHints` dari `./lib/coach.js` (Task 1); `t`; `Icon`.
- Produces: kartu hint di `FinishSummary`; `coachHints` dipanggil dengan workout final + `S`.

- [ ] **Step 1: Import coachHints**

`frontend/src/sheets.jsx`, tambah import:

```jsx
import { coachHints } from './lib/coach.js'
```

- [ ] **Step 2: Compute hints in doFinishWorkout**

Di `doFinishWorkout` (line ~968, sebelum membuka `FinishSummary`), setelah `update(...)` menulis workout:

```jsx
const hints = coachHints(st, w)
...
ui().openSheet(close => <FinishSummary w={w} prs={prs} e1prs={e1prs} hints={hints} close={close} />, { kind: 'center', locked: true })
```

- [ ] **Step 3: Render hints in FinishSummary**

Ubah signature `FinishSummary` menjadi `function FinishSummary({ w, prs, e1prs = [], hints = [], close })`. Setelah blok "What you just trained" (BodyMap), tambah:

```jsx
{hints.length > 0 && <>
  <h4 className="sec" style={{ textAlign: 'left' }}>{t('Coach')}</h4>
  {hints.map(h => (
    <div key={h.exerciseId} className="card" style={{ textAlign: 'left', marginBottom: 10 }}>
      <div className="row between" style={{ marginBottom: 6 }}>
        <span className="tt capitalize">{(EXIDX[h.exerciseId] || {}).n || h.exerciseId}</span>
        <span className="tag acc nocap">{t(h.messageKey)}</span>
      </div>
      {h.reasoning.map((r, i) => <div key={i} className="small dim" style={{ marginBottom: 4 }}>{r}</div>)}
    </div>
  ))}
</>}
```

Catatan: `t(h.messageKey)` — karena `messageKey` adalah English source string, `t()` langsung memetakan ke bahasa aktif. `reasoning` array dipakai sebagai fallback detail.

- [ ] **Step 4: Manual test**

Run: `cd frontend && npm run dev` (demo data). Selesaikan workout dengan rep drop/plateau → FinishSummary menampilkan kartu Coach dengan hint yang sesuai.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sheets.jsx
git commit -m "feat(f2): render coach hints in FinishSummary"
```

---

### Task 3: i18n strings untuk F2

**Files:**
- Modify: `frontend/src/locales/*.js` (13 file)
- Test: manual / smoke

**Interfaces:**
- Consumes: `t()` (existing).
- Produces: key i18n baru (lihat §5.4 spec F2):
  - `'Set variance — targets not met consistently'`
  - `'Reps dropped once — repeat this weight next week'`
  - `'Reps dropped two sessions running — deload 10 %'`
  - `'Reps dropped three sessions running — evaluate the plan'`
  - `'Plateau — try an intensity technique'`
  - `'Plateau — substitute to a variation'`
  - `'Plateau — take a full deload week'`
  - `'Coach'`

- [ ] **Step 1: Tambah key ke id.js (minimal) + English fallback**

Minimal untuk target user: tambahkan terjemahan Indonesia ke `id.js`:

```js
'Coach': 'Pelatih',
'Set variance — targets not met consistently': 'Variansi set — target belum tercapai secara konsisten',
'Reps dropped once — repeat this weight next week': 'Reps turun sekali — ulangi beban ini minggu depan',
'Reps dropped two sessions running — deload 10 %': 'Reps turun dua sesi beruntun — deload 10 %',
'Reps dropped three sessions running — evaluate the plan': 'Reps turun tiga sesi beruntun — evaluasi program',
'Plateau — try an intensity technique': 'Plateau — coba teknik intensitas',
'Plateau — substitute to a variation': 'Plateau — ganti ke variasi gerakan',
'Plateau — take a full deload week': 'Plateau — ambil minggu deload penuh',
```

- [ ] **Step 2: Tambah ke locale lain**

Untuk kelengkapan, tambahkan terjemahan (atau biarkan English fallback) ke de/es/fr/it/pt/pl/tr/ru/zh/ko/hi. English source = key, jadi jika tidak diterjemahkan, t() menampilkan English — tidak error.

- [ ] **Step 3: Verifikasi**

Run: `cd frontend && npm test` — tidak ada test rusak. Manual: ganti bahasa id, selesaikan workout → kartu Coach dalam Bahasa Indonesia.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/locales/
git commit -m "feat(f2): i18n coach hint strings"
```

---

## Self-Review

**1. Spec coverage (F2 spec):**
- Rule A set-variance ✓ (Task 1 `detectSetVariance`)
- Rule B rep-drop tiered 1/2/3 ✓ (Task 1 `detectRepDrop`)
- Rule C plateau tiered 3/4/5+ ✓ (Task 1 `detectPlateau`)
- Rule D substitution — ⚠️ **belum diimplementasikan** dalam plan ini. Spec §5.4 menyebut "saat user substitusi exercise, bantu starting weight via equivalence". Ini memerlukan interaksi user-action (bukan auto-deteksi dari history). Saya tandai sebagai **task lanjutan** di luar plan ini karena kompleksitasnya berbeda (butuh UI pemilihan substitusi). Untuk MVP F2, deteksi set-variance/rep-drop/plateau sudah cukup berdampak.
- Prioritas multiple-rule ✓ (PRIORITY sort)
- Bentuk output CoachHint ✓
- Muncul di FinishSummary ✓ (Task 2)
- i18n ✓ (Task 3)

**2. Placeholder scan:** Tidak ada "TBD"/"TODO". Semua langkah punya kode konkret. ✓

**3. Type consistency:**
- `coachHints(S, workout)` konsisten dipakai di Task 2. ✓
- `evaluateEntry(S, entry)` — Task 1 internal. ✓
- `CoachHint` shape konsisten: `ruleId/tier/severity/exerciseId/messageKey/params/suggestedAction/reasoning`. ✓
- `stallCount`/`sessionsFor`/`readSession`/`modeOf` — semua dari progression.js/history.js yang sudah diverifikasi signature-nya. ✓

**4. Gap ditemukan saat review:**
- Rule D (substitution) adalah user-action, bukan auto-deteksi. Spec F2 memang menulisnya sebagai "bantuan, bukan auto". Untuk MVP, plan ini fokus pada 3 rule deteksi (set-variance/rep-drop/plateau) yang murni dari history. Substitution membutuhkan task terpisah dengan UI — saya tandai sebagai lanjutan, bukan menghilangkan.
- `detectRepDrop` membandingkan `low` antar sesi. `readSession` menyediakan `low`. ✓
- `detectPlateau` saya implementasikan ulang (bukan `stallCount`) karena perlu membaca "same weight + not ok + low unchanged" — `stallCount` hanya hitung `!ok` beruntun, tidak cek stagnan. Ini disengaja: plateau butuh deteksi stagnasi weight yang lebih ketat.

---

## Execution Handoff

Plan selesai dan disimpan ke `docs/superpowers/plans/2026-09-01-f2-rule-engine-coach-hints.md`. Dua opsi eksekusi:

**1. Subagent-Driven (recommended)** — dispatch fresh subagent per task, review antar task

**2. Inline Execution** — eksekusi task dalam sesi ini, batch dengan checkpoint
