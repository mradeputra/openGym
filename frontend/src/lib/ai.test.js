import { describe, it, expect, vi, afterEach } from 'vitest'

// Env vars set before importing the module.
const OLD = { ...process.env }
afterEach(() => {
  vi.unstubAllGlobals()
  for (const k of Object.keys(process.env)) if (!(k in OLD) && k.startsWith('AI_')) delete process.env[k]
  Object.assign(process.env, OLD)
})

async function freshCallAI() {
  vi.resetModules()
  const mod = await import('../../../api/ai.js')
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