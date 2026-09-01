import { describe, it, expect } from 'vitest'
import { coachHints } from './coach.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id

// Build a state whose history for one exercise is a list of sessions given as
// [weight, ...repsPerSet]. null = set never checked off.
const hist = (id, rows, reps = 12) => ({
  unit: 'kg',
  workouts: rows.map((row, i) => ({
    d: '2026-01-0' + (i + 1),
    entries: [{
      id,
      target: { sets: row.length - 1, reps, weight: row[0] },
      sets: row.slice(1).map(r => (r === null ? { w: row[0], r: 0, done: false } : { w: row[0], r, done: true }))
    }]
  }))
})
// A completed workout object (as doFinishWorkout builds it) — the last session plus a flag.
const asWorkout = (id, lastRow, reps = 12) => {
  const [w, ...r] = lastRow
  return { id, d: '2026-02-01', entries: [{ id, sets: r.map(rp => ({ w, r: rp, done: true })), target: { sets: r.length, reps, weight: w } }] }
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

describe('coachHints — rep drop vs ok sessions', () => {
  it('does not flag a drop when the latest session met its target', () => {
    // target 10: both weeks hit 11s/10s — the progression engine would say "up",
    // so a "repeat" hint would contradict it.
    const S = hist(LIFT, [[10, 11, 11, 11], [10, 10, 10, 10]], 10)
    const w = asWorkout(LIFT, [10, 10, 10, 10], 10)
    const hints = coachHints(S, w)
    expect(hints.find(h => h.ruleId === 'rep-drop')).toBeFalsy()
  })
})

describe('coachHints — rep drop vs set variance priority', () => {
  it('set-variance wins over rep-drop when both apply (strict fade + trailing drop)', () => {
    // The last session is a strict fade (12-10-8) AND its min (8) dropped vs last week (12) —
    // both set-variance and rep-drop could fire; the one returned must be set-variance.
    const S = hist(LIFT, [[40, 12, 12, 12], [40, 12, 10, 8]])
    const w = asWorkout(LIFT, [40, 12, 10, 8])
    const hints = coachHints(S, w)
    expect(hints.length).toBe(1)
    expect(hints[0].ruleId).toBe('set-variance')
    expect(hints[0].suggestedAction).toBe('hold')
  })
})

describe('coachHints — plateau tiered', () => {
  it('tier 1: 3 sessions same → technique', () => {
    const rows = [[40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11]]
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[2])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl).toBeTruthy()
    expect(pl.tier).toBe(1)
    expect(pl.suggestedAction).toBe('technique')
  })
  it('tier 2: 4 sessions same → substitute', () => {
    const rows = [[40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11], [40, 12, 10, 11]]
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[3])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl).toBeTruthy()
    expect(pl.tier).toBe(2)
    expect(pl.suggestedAction).toBe('substitute')
  })
  it('tier 3: 5+ sessions same → full deload', () => {
    const rows = [1,2,3,4,5].map(() => [40, 12, 10, 11])
    const S = hist(LIFT, rows)
    const w = asWorkout(LIFT, rows[4])
    const pl = coachHints(S, w).find(h => h.ruleId === 'plateau')
    expect(pl.tier).toBe(3)
    expect(pl.suggestedAction).toBe('full-deload')
  })
})
