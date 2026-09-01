import { describe, it, expect } from 'vitest'
import { EXDB, byMuscle, sortByMusclePrimary } from './exercises.js'

// Muscle up trains the upper back (primary), plus biceps/chest as secondary
// (muscles.js SECONDARY=0.4) — a single exercise that appears under both filters.
const muscleUp = EXDB.find(e => e.n === 'muscle up')

describe('byMuscle', () => {
  it('includes exercises whose musclesOf maps the slug', () => {
    const hits = byMuscle(EXDB, 'chest')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some(e => e.id === muscleUp.id)).toBe(true)
  })

  it('includes exercises that train the muscle as secondary', () => {
    // biceps is a secondary muscle of muscle up
    const hits = byMuscle(EXDB, 'biceps')
    expect(hits.some(e => e.id === muscleUp.id)).toBe(true)
  })

  it('excludes exercises that do not train the muscle', () => {
    const hits = byMuscle(EXDB, 'calves')
    expect(hits.some(e => e.id === muscleUp.id)).toBe(false)
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
