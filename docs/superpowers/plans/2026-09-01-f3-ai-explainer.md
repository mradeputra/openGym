# F3 — AI Explainer: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chat panel pasca-sesi yang menjelaskan rekomendasi rule engine (F2 coach hints) dalam bahasa natural. LLM hanya menjelaskan, tidak pernah menambah/mengubah rekomendasi.

**Architecture:** Endpoint server `POST /api/explain` memanggil helper `callAI` (dibuat di F4) dengan system prompt guardrail. Frontend `FinishSummary` menampilkan tombol "Jelaskan" per hint → panel chat kecil. Fallback offline menampilkan `reasoning[]` sebagai teks.

**Tech Stack:** Node 20+ (fetch global), React 19. Reuse `callAI` dari `api/ai.js` (F4).

**Spec:** `docs/superpowers/specs/2026-09-01-f3-ai-explainer-design.md`
**Dependensi:** F4 Task 1 (`callAI`), F2 Task 1 (`coachHints`), F2 Task 2 (hints di FinishSummary).

## Global Constraints

- `callAI` reuse dari F4 — tidak menulis ulang. Jika F4 belum dikerjakan, kerjakan F4 Task 1 dulu.
- Guardrail: system prompt menegaskan LLM tidak boleh mengubah rekomendasi; post-process scan angka yang tidak ada di context → fallback.
- Key tidak pernah sampai client (server proxy).
- Offline/demo: tombol nonaktif, fallback `reasoning[]`.
- `api()` helper frontend (existing).

---

### Task 1: Endpoint `POST /api/explain` di server

**Files:**
- Modify: `api/server.js` (import callAI + route)
- Test: manual (curl) / extend ai.test.js

**Interfaces:**
- Consumes: `callAI` dari `./ai.js` (F4 Task 1); `readBody` (existing).
- Produces: `POST /api/explain` menerima `{ lang, exerciseId, hint, recentHistory }`, returns `{ ok: true, text }` atau `{ error }`.

- [ ] **Step 1: Add route**

`api/server.js`, tambah handler ke `routes` (setelah `POST /api/exercise/suggest`):

```js
'POST /api/explain': async (req, res) => {
  let body = {};
  try { body = await readBody(req); } catch (e) { return json(res, 400, { error: 'bad request' }); }
  const { lang, exerciseId, hint, recentHistory } = body;
  if (!hint || typeof hint !== 'object') return json(res, 400, { error: 'hint required' });
  const system = 'You are a hypertrophy coach explaining a recommendation produced by a deterministic rule engine. '
    + 'You must NOT change, add, or offer a different recommendation. '
    + 'Translate the recommendation + reasoning into natural language the user can act on. '
    + 'If the user asks something outside the recommendation context, steer back to the given recommendation. '
    + 'You only explain what the system decided; you never invent new weights, reps, or actions.';
  const context = JSON.stringify({ exerciseId, hint, recentHistory: recentHistory || [] });
  const r = await callAI({ prompt: `Explain this recommendation in plain language:\n${context}`, lang, system });
  if (!r.ok) return json(res, r.status || 500, { error: r.error || 'ai error' });
  return json(res, 200, { text: r.text });
},
```

- [ ] **Step 2: Test manual dengan curl**

Run server (dengan `AI_API_KEY`): 
```bash
curl -s -X POST http://localhost:3001/api/explain \
  -H 'Content-Type: application/json' \
  -d '{"lang":"id","exerciseId":"0101","hint":{"ruleId":"plateau","tier":2,"messageKey":"Plateau — substitute to a variation","reasoning":["Same weight for 4 sessions"]},"recentHistory":[{"d":"2026-01-01","sets":[[40,10],[40,10]]}]}'
```
Expected: `{"text": "...penjelasan Bahasa Indonesia..."}` atau error `not_configured` (aman).

- [ ] **Step 3: Commit**

```bash
git add api/server.js
git commit -m "feat(f3): POST /api/explain endpoint"
```

---

### Task 2: Guardrail post-process di frontend

**Files:**
- Create: `frontend/src/lib/explain-guard.js`
- Create: `frontend/src/lib/explain-guard.test.js`

**Interfaces:**
- Consumes: nothing (pure).
- Produces:
  - `guardExplain(text, context)` → `{ ok: boolean, warning?: string, text }` — scan angka di `text` yang tidak muncul di context.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/explain-guard.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { guardExplain } from './explain-guard.js'

const context = {
  hint: { messageKey: 'Plateau — substitute to a variation', reasoning: ['Same weight for 4 sessions'] },
  recentHistory: [{ d: '2026-01-01', sets: [[40, 10], [40, 10]] }]
}

describe('guardExplain', () => {
  it('passes when numbers in text appear in context', () => {
    const r = guardExplain('Coba naikkan ke 40 kg selama 4 sesi', context)
    expect(r.ok).toBe(true)
    expect(r.warning).toBeUndefined()
  })
  it('flags a number that does not appear in context', () => {
    const r = guardExplain('Angkat 999 kg minggu ini', context)
    expect(r.ok).toBe(false)
    expect(r.warning).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- explain-guard.test.js`
Expected: FAIL — module tidak ada.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/lib/explain-guard.js`:

```js
// Post-process guardrail for AI explanations (spec F3 §3.3): if the LLM's output
// contains a number that never appears in the context we gave it, flag it — the
// explanation may be drifting from the deterministic recommendation.

function numbersIn(str) {
  return (String(str).match(/\d+(\.\d+)?/g) || []).map(Number)
}
function contextNumbers(ctx) {
  const all = []
  if (ctx.hint) {
    all.push(...numbersIn(ctx.hint.messageKey || ''), ...numbersIn(ctx.hint.reasoning || []))
  }
  ;(ctx.recentHistory || []).forEach(h => {
    all.push(...numbersIn(h.d))
    ;(h.sets || []).forEach(s => all.push(...s.map(numbersIn).flat()))
  })
  return new Set(all)
}

export function guardExplain(text, ctx) {
  const allowed = contextNumbers(ctx)
  const out = numbersIn(text).filter(n => !allowed.has(n))
  if (out.length === 0) return { ok: true, text }
  return {
    ok: false,
    warning: `AI explanation contains numbers (${out.join(', ')}) not present in the recommendation — treating it as advisory only.`,
    text,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- explain-guard.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/explain-guard.js frontend/src/lib/explain-guard.test.js
git commit -m "feat(f3): post-process guardrail for AI explanation numbers"
```

---

### Task 3: Panel chat "Jelaskan" di FinishSummary

**Files:**
- Modify: `frontend/src/sheets.jsx` (FinishSummary, F2 Task 2 menambah hints)
- Test: manual

**Interfaces:**
- Consumes: `api()` dari `./lib/api.js`; `guardExplain` (Task 2); `getLang` dari `./lib/i18n.js`; hint object (F2).
- Produces: tombol "Jelaskan" per hint; panel chat dengan satu pesan + input follow-up; fallback `reasoning[]`.

- [ ] **Step 1: Add imports**

`frontend/src/sheets.jsx`, tambah:

```jsx
import { api } from './lib/api.js'
import { guardExplain } from './lib/explain-guard.js'
import { getLang } from './lib/i18n.js'
```

- [ ] **Step 2: Add explain sub-component**

Di `sheets.jsx`, tambah komponen kecil `ExplainButton` (di atas FinishSummary):

```jsx
function ExplainButton({ hint }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [text, setText] = useState('')
  const [q, setQ] = useState('')
  const [warning, setWarning] = useState(null)

  async function explain() {
    setBusy(true); setOpen(true); setWarning(null)
    try {
      const r = await api('/api/explain', { method: 'POST', body: JSON.stringify({ lang: getLang(), exerciseId: hint.exerciseId, hint, recentHistory: [] }) })
      const g = guardExplain(r.text, { hint, recentHistory: [] })
      setText(g.ok ? r.text : r.text + (g.warning ? '\n\n⚠ ' + g.warning : ''))
      setWarning(g.ok ? null : g.warning)
    } catch (e) {
      setText(hint.reasoning.join(' '))   // fallback: structured reasoning
      setWarning(e.message || null)
    } finally {
      setBusy(false)
    }
  }
  async function ask() {
    if (!q.trim()) return
    setBusy(true)
    try {
      const r = await api('/api/explain', { method: 'POST', body: JSON.stringify({ lang: getLang(), exerciseId: hint.exerciseId, hint, recentHistory: [], followUp: q.trim() }) })
      setText(r.text)
      setQ('')
    } catch (e) { setText(hint.reasoning.join(' ')); setWarning(e.message || null) }
    finally { setBusy(false) }
  }

  return <div style={{ marginTop: 6 }}>
    <Button size="sm" variant="ghost" icon="lightbulb" onClick={explain} disabled={busy}>
      {busy ? t('Thinking…') : t('Explain')}
    </Button>
    {open && <div className="card" style={{ marginTop: 8, textAlign: 'left' }}>
      <div className="small" style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{text || t('AI not available offline — showing the rule reasoning.')}</div>
      {warning && <div className="small dim" style={{ marginBottom: 8 }}>{warning}</div>}
      <div className="row" style={{ gap: 6 }}>
        <input className="input" value={q} onChange={e => setQ(e.target.value)} placeholder={t('Ask a follow-up…')} onKeyDown={e => { if (e.key === 'Enter') ask() }} />
        <Button size="sm" icon="chevronRight" onClick={ask} disabled={busy} />
      </div>
    </div>}
  </div>
}
```

- [ ] **Step 3: Render di FinishSummary**

Di `FinishSummary` (setelah kartu hint dari F2), tambah tombol "Jelaskan" per hint:

```jsx
{hints.map(h => (
  <div key={h.exerciseId} className="card" style={{ textAlign: 'left', marginBottom: 10 }}>
    <div className="row between" style={{ marginBottom: 6 }}>
      <span className="tt capitalize">{(EXIDX[h.exerciseId] || {}).n || h.exerciseId}</span>
      <span className="tag acc nocap">{t(h.messageKey)}</span>
    </div>
    {h.reasoning.map((r, i) => <div key={i} className="small dim" style={{ marginBottom: 4 }}>{r}</div>)}
    <ExplainButton hint={h} />
  </div>
))}
```

- [ ] **Step 4: Manual test**

Selesaikan workout dengan hint → FinishSummary → "Explain" → penjelasan muncul; follow-up pertanyaan bekerja; matikan server (atau tanpa AI_API_KEY) → fallback reasoning.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/sheets.jsx
git commit -m "feat(f3): AI explain panel in FinishSummary with guardrail fallback"
```

---

### Task 4: i18n strings untuk F3

**Files:**
- Modify: `frontend/src/locales/id.js` (+ lainnya opsional)
- Test: manual

**Interfaces:**
- Produces: key baru:
  - `'Explain'`
  - `'Thinking…'`
  - `'Ask a follow-up…'`
  - `'AI not available offline — showing the rule reasoning.'`

- [ ] **Step 1: Tambah ke id.js**

```js
'Explain': 'Jelaskan',
'Ask a follow-up…': 'Tanya lanjutan…',
'AI not available offline — showing the rule reasoning.': 'AI tidak tersedia saat offline — menampilkan alasan aturan.',
```

- [ ] **Step 2: Verifikasi + commit**

```bash
cd frontend && npm test
git add frontend/src/locales/
git commit -m "feat(f3): i18n AI explainer strings"
```

---

## Self-Review

**1. Spec coverage (F3 spec):**
- §3.2 endpoint `POST /api/explain` ✓ (Task 1)
- §3.3 guardrail (system prompt + post-process scan) ✓ (Task 1 system prompt, Task 2 guardExplain)
- §4 frontend panel ✓ (Task 3)
- §3.1 `callAI` reuse ✓ (dependensi F4)
- §6 testing ✓ (Tasks 1,2)

**2. Placeholder scan:** Tidak ada TBD/TODO. Semua kode konkret. Satu asumsi: `readBody` sudah ada (diverifikasi di server.js:224). ✓

**3. Type consistency:**
- `callAI` dari F4 Task 1: signature `{ prompt, lang, system, json }`. F3 memakai tanpa `json` → returns `{ok, text}`. ✓
- `guardExplain(text, ctx)` konsisten Task 2 → Task 3. ✓
- `hint` object dari F2: `{ ruleId, tier, severity, exerciseId, messageKey, params, suggestedAction?, reasoning }`. Task 3 memakai `hint.exerciseId`, `hint.messageKey`, `hint.reasoning`. ✓
- `getLang` dari i18n (verified). ✓

**4. Gap yang saya temukan:**
- Task 3 `ask()` mengirim `followUp` ke `/api/explain`, tapi Task 1 route tidak membaca `followUp`. Ini harus konsisten — saya perlu tambahkan `followUp` handling di Task 1 route (atau hilangkan dari Task 3). Keputusan: **tambahkan `followUp` ke route** — append sebagai user message kedua. Saya perbaiki Task 1.

- [ ] **Fix Task 1: handle followUp**

Update route di Task 1 agar menerima `followUp` (jika ada, jadikan user message kedua):

```js
const { lang, exerciseId, hint, recentHistory, followUp } = body;
...
const userMsg = followUp
  ? `Explain this recommendation in plain language:\n${context}\n\nFollow-up: ${followUp}`
  : `Explain this recommendation in plain language:\n${context}`;
const r = await callAI({ prompt: userMsg, lang, system });
```

Ditandai sebagai perbaikan konsistensi — `followUp` tidak boleh di-ignore oleh route.

---

## Execution Handoff

Plan selesai dan disimpan ke `docs/superpowers/plans/2026-09-01-f3-ai-explainer.md`.
