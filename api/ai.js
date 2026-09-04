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
