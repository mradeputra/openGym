# F3 — AI Explainer

**Bagian dari:** openGym Coach Features (lihat `2026-09-01-opengym-coach-features-design.md`)
**Status:** Draft
**Effort:** Besar
**Dependensi:** `callAI` helper (dibuat di F4, fase 3) — reuse.

---

## 1. Tujuan

Chat panel pasca-sesi yang menjelaskan rekomendasi rule engine (F2) dalam bahasa natural (mengikuti bahasa UI). **LLM hanya menjelaskan; tidak pernah mengubah/menambah rekomendasi.**

---

## 2. Arsitektur

- **Client** mengirim context (exercise + hint + history ringkas) ke server proxy.
- **Server** memanggil AI provider via helper `callAI` (lihat `api/ai.js` di bawah), key dari env.
- **Key tidak pernah sampai ke client.**

---

## 3. Server Proxy

### 3.1 Helper `callAI` (modul `api/ai.js`) — dipakai F3 & F4

```js
// api/ai.js — OpenAI-compatible client, env-configured.
// Swap provider by changing env, never code: AI_BASE_URL / AI_API_KEY / AI_MODEL.

const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.deepseek.com/v1'
const AI_API_KEY  = process.env.AI_API_KEY
const AI_MODEL    = process.env.AI_MODEL || 'deepseek-v4-flash'
const AI_PROVIDER = process.env.AI_PROVIDER || 'deepseek'   // label for logging/i18n

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
        { role: 'user', content: prompt },
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

**Catatan generalisasi (sesuai keputusan Tingkat A):**
- Satu implementasi OpenAI-compatible — DeepSeek, OpenRouter, Ollama/LM Studio lokal, Groq, Together semuanya berbicara shape yang sama.
- **Pindah provider = ubah env var, bukan kode.**
- `json` param memungkinkan output terstruktur (F4), `system`+`prompt` memungkinkan instruksi (F3).
- Jika nanti mau Anthropic/Google (shape beda) → tambah adapter; YAGNI sekarang (spesifikasi: "openai compatible model lainnya").

### 3.2 Endpoint `POST /api/explain`

- Body: `{ lang, exerciseId, hint: CoachHint, recentHistory: [...] }`
- Server memanggil `callAI` dengan system prompt (guardrail) + context.
- Jika `AI_API_KEY` tidak ada → `503 { error: 'not_configured' }`.
- **Jangan pernah** kirim key ke client.

### 3.3 Guardrail (dari GymTrainer)

- **System prompt:** "Kamu tidak boleh mengubah, menambah, atau menawarkan rekomendasi berbeda. Tugasmu menerjemahkan rekomendasi + reasoning ke bahasa natural. Kalau pengguna bertanya di luar konteks, arahkan kembali."
- **Post-process guardrail:** scan output LLM untuk angka beban/reps. Jika ada angka yang tidak muncul di `reasoning[]`/`recentHistory` → warning + tampilkan teks rule engine sebagai fallback.

### 3.4 Env var baru

```
AI_BASE_URL=https://api.deepseek.com/v1   # ganti untuk provider lain
AI_API_KEY=...                            # required, di .env server
AI_MODEL=deepseek-v4-flash                # ganti model kapan saja
AI_PROVIDER=deepseek                      # label (logging/i18n)
```

Didokumentasikan di `.env.example` / `docs/SELF_HOSTING.md`.

---

## 4. Frontend Chat Panel

- Di `FinishSummary` setelah hint (F2) → tombol "Jelaskan" / "Kenapa?".
- Panel chat kecil: satu pesan asli (penjelasan LLM), input follow-up (pertanyaan bebas).
- **Offline/demo:** tombol nonaktif, fallback menampilkan `reasoning[]` sebagai teks terstruktur (tetap berguna tanpa LLM).

---

## 5. Implementasi

### 5.1 File berubah

| File | Perubahan |
|---|---|
| `api/ai.js` | **(dibuat di F4)** helper `callAI` |
| `api/server.js` | Endpoint `POST /api/explain` (reuse `callAI`) |
| `frontend/src/lib/coach.js` | Helper menyusun context (exercise + hint + history ringkas) untuk `callAI` |
| `frontend/src/sheets.jsx` | Panel chat di `FinishSummary` |
| `frontend/src/lib/api.js` | `api('/api/explain', ...)` |

---

## 6. Testing

- **Server:** unit test `callAI` (mock fetch) — request shape benar (base URL + model + messages), error handling (`not_configured`, non-2xx, invalid JSON), **key tidak pernah masuk response**.
- **Guardrail:** unit test post-process scan — angka LLM yang tidak ada di context → fallback.
- **Manual:** offline → tombol nonaktif; online → penjelasan muncul; follow-up pertanyaan berfungsi.

---

## 7. Out-of-Scope

- LLM menyarankan rekomendasi baru (melanggar prinsip GymTrainer) — hanya menjelaskan.
- Streaming response (UX premium, effort lebih; YAGNI untuk MVP).
- Chat history tersimpan lintas sesi — cukup per-panel di FinishSummary.
