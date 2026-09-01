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
    expect(pl).toBeTruthy()
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
