// Coach hints: deterministic decision support on top of progression.
// Pure function of workout history — same philosophy as progression.js.
// LLM (F3) only explains these; it never changes them.

import { sessionsFor, readSession } from './progression.js'
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
// `entry` is the just-finished session from the workout being reviewed; S's history
// is the log it sits in (including that session once the workout is written).
export function evaluateEntry(S, entry) {
  const exId = entry.id
  const fallback = entry.target || {}
  const history = sessionsFor(S, exId, fallback).filter(s => s.mode === modeOf({ ...fallback, id: exId }))
  const current = readSession(entry, fallback)

  const setVariance = detectSetVariance(current)
  if (setVariance) return { ruleId: 'set-variance', tier: 1, severity: 'info', exerciseId: exId, ...setVariance }

  const repDrop = detectRepDrop(history)
  if (repDrop) return { ruleId: 'rep-drop', tier: repDrop.tier, severity: repDrop.tier > 1 ? 'warning' : 'action', exerciseId: exId, ...repDrop }

  const plateau = detectPlateau(history)
  if (plateau) return { ruleId: 'plateau', tier: plateau.tier, severity: plateau.tier > 1 ? 'warning' : 'action', exerciseId: exId, ...plateau }

  return null
}

function detectSetVariance(last) {
  if (last.mode !== 'reps' || !last.reps.length || last.ok) return null
  const min = Math.min(...last.reps)
  const max = Math.max(...last.reps)
  // A real variance pattern is a fade: every set a little worse than the one before
  // it (12-10-8). Ordinary scatter like 12-10-12 or 12-9-11 is not a set-variance
  // story — that belongs to the rep-drop / plateau rules instead.
  const fades = last.reps.every((r, i) => i === 0 || r < last.reps[i - 1])
  if (!fades || max - min < 2) return null   // e.g. 12-11-12 is normal variance, not a pattern
  return {
    messageKey: 'Set variance — targets not met consistently',
    params: { min, max, goal: last.goal },
    suggestedAction: 'hold',
    reasoning: [`Sets were {0}…{1} while the target is {2} reps — hold the weight and chase consistency.`, min, max, last.goal]
  }
}

function detectRepDrop(sessions) {
  if (sessions.length < 2) return null
  if (sessions[0].mode !== 'reps') return null   // rep counts only exist for reps mode
  if (sessions.at(-1).ok) return null            // a session that met its target is not a drop
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
  if (sessions[0].mode !== 'reps') return null   // plateau reads reps (low), not timed holds
  const w = sessions[sessions.length - 1].weight
  if (w <= 0) return null                        // bodyweight: no load to plateau on
  let n = 0
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i]
    if (s.weight !== w || s.ok || s.low === 0) break
    // same low-or-high? we treat "same weight, not ok, low unchanged" as stagnation
    n++
  }
  // `n` is the run of identical sessions ending at the one just finished (the log
  // already holds it) — the plateau the user is living through, not the one before it.
  if (n < 3) return null
  if (n === 3) return { tier: 1, messageKey: 'Plateau — try an intensity technique', params: {}, suggestedAction: 'technique', reasoning: ['Same weight for {0} sessions — try rest-pause or a drop set.', n] }
  if (n === 4) return { tier: 2, messageKey: 'Plateau — substitute to a variation', params: {}, suggestedAction: 'substitute', reasoning: ['Same weight for {0} sessions — swap to a variation working the same muscles.', n] }
  return { tier: 3, messageKey: 'Plateau — take a full deload week', params: {}, suggestedAction: 'full-deload', reasoning: ['Same weight for {0}+ sessions — a full deload week is due.', n] }
}
