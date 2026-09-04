import { describe, it, expect } from 'vitest'
import { EXDB, byMuscle, sortByMusclePrimary, isKnownEquipment } from './exercises.js'
import { musclesOf, normalizeMuscleName } from './muscles.js'

// primary = full weight from tg, via the production predicate
const isPrimary = (e, slug) => musclesOf(e)[slug] >= 1

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

  it('falls back to body part for a custom exercise with no tg', () => {
    const custom = [{ id: 'c1', bp: 'chest', tg: '', sm: [] }]
    expect(byMuscle(custom, 'chest').length).toBe(1)
  })

  it('returns [] for an empty list', () => {
    expect(byMuscle([], 'chest')).toEqual([])
  })
})

describe('sortByMusclePrimary', () => {
  it('puts primary exercises before secondary ones for a muscle', () => {
    const hits = byMuscle(EXDB, 'biceps')
    const sorted = sortByMusclePrimary(hits, 'biceps')
    const prim = new Set(hits.filter(e => isPrimary(e, 'biceps')).map(e => e.id))
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
  it('normalizeMuscleName accepts canonical slugs as-is', () => {
    expect(normalizeMuscleName('gluteal')).toBe('gluteal')
    expect(normalizeMuscleName('hamstring')).toBe('hamstring')
    expect(normalizeMuscleName('upper-back')).toBe('upper-back')
  })
})
