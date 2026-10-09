import { describe, expect, test } from 'claude-code/testing'

import type { Run } from '../types'
import {
  CONTINUE_PROMPT,
  afterTurn,
  canRestart,
  effectiveTrigger,
  finalPrompt,
  goalState,
  isDoneAnswer,
  limitAction,
  namedSkills,
  parseCommand,
  parseDuration,
  pickIdentity,
  roleSection,
  triggerCeiling,
  wrapMidTurn,
} from './autopilot'

function run(over: Partial<Run>): Run {
  return {
    role: 'Scout of military tech, responsible for evidence pages',
    name: 'Mil-tech',
    color: 'green',
    startedAt: 0,
    until: 1_000_000,
    threshold: 60,
    maxRestarts: null,
    restarts: 0,
    phase: 'running',
    handoffPath: null,
    idleTurns: 0,
    goal: null,
    skills: [],
    fiveHourStop: 95,
    weekStop: 80,
    waitUntil: null,
    finalReason: null,
    ...over,
  }
}

const START_DEFAULTS = { goal: null, fiveHourStop: 95, weekStop: 80 }

describe('command', () => {
  test('durations', async () => {
    expect(parseDuration('90m')).toBe(90 * 60_000)
    expect(parseDuration('2h')).toBe(120 * 60_000)
    expect(parseDuration('1h30m')).toBe(90 * 60_000)
    expect(parseDuration('45')).toBe(45 * 60_000)
    expect(parseDuration('soon')).toBe(null)
  })

  test('status, stop, start with and without a restart limit', async () => {
    expect(parseCommand('')).toEqual({ kind: 'status' })
    expect(parseCommand('0 0 stop')).toEqual({ kind: 'stop' })
    expect(parseCommand('stop')).toEqual({ kind: 'stop' })
    expect(parseCommand('2h 60 3 "You are the Mil-tech scout"')).toEqual({
      kind: 'start', durationMs: 120 * 60_000, threshold: 60, maxRestarts: 3, role: 'You are the Mil-tech scout', ...START_DEFAULTS,
    })
    expect(parseCommand('2h 60% "You are the Mil-tech scout"')).toEqual({
      kind: 'start', durationMs: 120 * 60_000, threshold: 60, maxRestarts: null, role: 'You are the Mil-tech scout', ...START_DEFAULTS,
    })
  })

  test('flags: goal with spaces, 5-hour and weekly stops, in any order after the role', async () => {
    expect(parseCommand('10h 65 "You are the Mil-tech scout" --goal "all briefs collected" --5h 90 --week 75')).toEqual({
      kind: 'start', durationMs: 600 * 60_000, threshold: 65, maxRestarts: null, role: 'You are the Mil-tech scout',
      goal: 'all briefs collected', fiveHourStop: 90, weekStop: 75,
    })
    expect(parseCommand('10h 65 "You are the Mil-tech scout" --week 70').kind === 'start' &&
      (parseCommand('10h 65 "You are the Mil-tech scout" --week 70') as { weekStop: number }).weekStop).toBe(70)
    expect(parseCommand('10h 65 "You are the Mil-tech scout" --5h 0').kind).toBe('error')
  })

  test('refuses an unreadable time, a wild threshold, a missing role', async () => {
    expect(parseCommand('soon 60 "You are the Mil-tech scout"').kind).toBe('error')
    expect(parseCommand('2h 99 "You are the Mil-tech scout"').kind).toBe('error')
    expect(parseCommand('2h 60 3').kind).toBe('error')
  })
})

describe('after a turn', () => {
  test('continues, wraps up, or finishes on time', async () => {
    expect(afterTurn(run({}), 10, 30, true)).toBe('continue')
    expect(afterTurn(run({}), 10, 61, true)).toBe('wrapup')
    expect(afterTurn(run({}), 1_000_000, 30, true)).toBe('final')
  })

  test('no limit restarts as long as time allows; a limit ends in a final handoff', async () => {
    expect(canRestart(run({ restarts: 40 }))).toBe(true)
    expect(afterTurn(run({ maxRestarts: 2, restarts: 2 }), 10, 61, true)).toBe('final')
  })

  test('two turns without tools pause it', async () => {
    expect(afterTurn(run({ idleTurns: 0 }), 10, 30, false)).toBe('continue')
    expect(afterTurn(run({ idleTurns: 1 }), 10, 30, false)).toBe('pause')
  })

  test('phases: restart resumes, final finishes, wrapping and paused wait', async () => {
    expect(afterTurn(run({ phase: 'restarting' }), 10, 5, true)).toBe('none')
    expect(afterTurn(run({ phase: 'resuming' }), 10, 5, true)).toBe('resume-done')
    expect(afterTurn(run({ phase: 'final' }), 10, 5, true)).toBe('finish')
    expect(afterTurn(run({ phase: 'wrapping' }), 10, 90, true)).toBe('none')
    expect(afterTurn(run({ phase: 'paused' }), 10, 90, true)).toBe('none')
  })

  test('mid-turn only fires while running', async () => {
    expect(wrapMidTurn(run({}), 10, 61)).toBe('wrapup')
    expect(wrapMidTurn(run({ phase: 'wrapping' }), 10, 99)).toBe(null)
    expect(wrapMidTurn(run({ phase: 'resuming', threshold: 12, restarts: 1 }), 10, 23)).toBe('wrapup')
  })
})

describe('trigger', () => {
  test('the ceiling sits 10 points below auto-compact; unknown means 90', async () => {
    expect(triggerCeiling(920_000, 1_000_000)).toBe(82)
    expect(triggerCeiling(undefined, 1_000_000)).toBe(90)
  })

  test('a smaller compaction window (800k of 1M) puts the ceiling on the 1M scale', async () => {
    expect(triggerCeiling(760_000, 1_000_000)).toBe(66)
  })

  test('under 50%, every handoff after the first comes 10 points later; 50% and up stays put', async () => {
    expect(effectiveTrigger(run({ threshold: 12, restarts: 0 }), 82)).toBe(12)
    expect(effectiveTrigger(run({ threshold: 12, restarts: 1 }), 82)).toBe(22)
    expect(effectiveTrigger(run({ threshold: 12, restarts: 5 }), 82)).toBe(22)
    expect(effectiveTrigger(run({ threshold: 50, restarts: 3 }), 82)).toBe(50)
    expect(effectiveTrigger(run({ threshold: 70, restarts: 3 }), 82)).toBe(70)
  })

  test('never past the ceiling below auto-compact', async () => {
    expect(effectiveTrigger(run({ threshold: 45, restarts: 1 }), 50)).toBe(50)
  })

  test('a resumed session at the old threshold does not wrap up again at once', async () => {
    const resumed = run({ threshold: 12, restarts: 1 })
    expect(afterTurn(resumed, 10, 13, true, 82)).toBe('continue')
    expect(afterTurn(resumed, 10, 22, true, 82)).toBe('wrapup')
  })
})

describe('identity', () => {
  test('the last name and color win; a transcript without them gives null', async () => {
    const rows = [
      '"type":"custom-title","customTitle":"Old"',
      '"type":"agent-color","agentColor":"blue"',
      '"type":"custom-title","customTitle":"Autopilot-test"',
      '"type":"agent-color","agentColor":"red"',
    ].join('\n')
    expect(pickIdentity(rows)).toEqual({ name: 'Autopilot-test', color: 'red' })
    expect(pickIdentity('')).toEqual({ name: null, color: null })
  })
})

describe('skills in the role', () => {
  test('only /names the session knows as skills count, each once', async () => {
    const role = 'Ти — скаут. Use /explore for the map, then /create-handoff-doc. Not a path: wiki/topics, not /unknown. /explore again.'
    expect(namedSkills(role, ['explore', 'create-handoff-doc', 'review'])).toEqual(['explore', 'create-handoff-doc'])
  })

  test('the pinned section tells the model they are skills', async () => {
    const text = roleSection(run({ skills: ['explore'] }), 10)
    expect(text).toContain('/explore')
    expect(text).toContain('Skill tool')
  })
})

describe('token limits', () => {
  const now = Date.parse('2026-10-09T22:00:00Z')

  test('the weekly window past its stop ends the run for good', async () => {
    expect(limitAction(run({}), [{ kind: 'seven_day', percentUsed: 80 }], now)).toEqual({ kind: 'week' })
    expect(limitAction(run({}), [{ kind: 'seven_day', percentUsed: 79.9 }], now)).toBe(null)
  })

  test('the 5-hour window past its stop parks until the reset plus 2 minutes', async () => {
    const windows = [{ kind: 'five_hour', percentUsed: 95, resetsAt: '2026-10-09T23:30:00Z' }]
    expect(limitAction(run({}), windows, now)).toEqual({
      kind: 'five-hour',
      waitUntil: Date.parse('2026-10-09T23:32:00Z'),
    })
  })

  test('an unknown reset time waits 30 minutes; the weekly stop wins over the 5-hour one', async () => {
    expect(limitAction(run({}), [{ kind: 'five_hour', percentUsed: 99 }], now)).toEqual({
      kind: 'five-hour',
      waitUntil: now + 30 * 60_000,
    })
    expect(
      limitAction(run({}), [{ kind: 'five_hour', percentUsed: 99 }, { kind: 'seven_day', percentUsed: 85 }], now),
    ).toEqual({ kind: 'week' })
  })

  test('a waiting run queues nothing after a turn', async () => {
    expect(afterTurn(run({ phase: 'waiting' }), 10, 30, true)).toBe('none')
  })

  test('the weekly stop asks for a phone notification', async () => {
    expect(finalPrompt(run({}), 'week')).toContain('PushNotification')
  })
})

describe('done marker', () => {
  test('the continue prompt offers it and an answer carrying it counts as done', async () => {
    expect(CONTINUE_PROMPT).toContain('AUTOPILOT_DONE')
    expect(isDoneAnswer('AUTOPILOT_DONE: all 59 summaries are in the file')).toBe(true)
    expect(isDoneAnswer('Continuing with file 34')).toBe(false)
    expect(finalPrompt(run({}), 'done')).toContain('complete')
  })
})

describe('goal status', () => {
  test('the last verdict for this condition decides', async () => {
    const goal = 'перші 15 файлів'
    const verdicts = [
      '{"type":"goal_status","met":false,"sentinel":true,"condition":"перші 15 файлів"}',
      '{"type":"goal_status","met":true,"condition":"перші 15 файлів","reason":"done"}',
    ].join('\n')
    expect(goalState(verdicts, goal)).toBe('achieved')
    expect(goalState(verdicts.split('\n')[0] ?? '', goal)).toBe('active')
    expect(goalState('{"type":"goal_status","met":true,"condition":"інша ціль"}', goal)).toBe('active')
    expect(goalState('', goal)).toBe('active')
  })
})

describe('role section', () => {
  test('carries role, name, color and the deferral rule', async () => {
    const text = roleSection(run({}), 10)
    expect(text).toContain('Scout of military tech')
    expect(text).toContain('Mil-tech')
    expect(text).toContain('green')
    expect(text).toContain('deferred')
    expect(text).toContain('PushNotification')
    expect(text).toContain("autopilot's call")
  })
})
