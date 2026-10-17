import { describe, expect, test } from 'claude-code/testing'

import type { PortRead } from '../types'
import { MAX_READ_BYTES } from './facts'
import { AUTOPILOT_FRESH_MS, autopilotReply, autopilotRunState, autopilotStatusPath } from './scan'
import { memIo, memWorld } from './testkit'

const NOW = 1_000_000

/** The read of a status file that holds this value as JSON. */
function statusOf(value: unknown): PortRead {
  return { state: 'text', text: JSON.stringify(value) }
}

/** The read of a status file that holds exactly this text. */
function rawStatus(text: string): PortRead {
  return { state: 'text', text }
}

/** The status path of session s1 under /home/u; the test fails when there is none, so it never passes without one. */
function s1Path(): string {
  const path = autopilotStatusPath('/home/u', 's1')
  if (path === null) throw new Error('no status path for session s1')

  return path
}

describe('autopilot guard', () => {
  test('a status file is fresh for 60 seconds, twice the 30 second heartbeat autopilot writes', () => {
    expect(AUTOPILOT_FRESH_MS).toBe(60_000)
  })

  test('isOn true with a beat inside the window is an active run, in any phase', () => {
    const phases = ['running', 'wrapping', 'restarting', 'resuming', 'waiting', 'final', 'paused', 'awaiting']
    for (const phase of phases) {
      expect(autopilotRunState(statusOf({ isOn: true, phase, beat: NOW }), NOW)).toBe('active')
    }
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 1 }), NOW)).toBe('active')
  })

  test('a beat exactly 60 seconds old is active and one millisecond older is no run', () => {
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 60_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW - 60_001 }), NOW)).toBe('none')
  })

  test('a beat in the future counts by its absolute difference to now', () => {
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 30_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 60_000 }), NOW)).toBe('active')
    expect(autopilotRunState(statusOf({ isOn: true, beat: NOW + 60_001 }), NOW)).toBe('none')
  })

  test('a stale beat is a dead session, so no run', () => {
    expect(autopilotRunState(statusOf({ isOn: true, phase: 'running', beat: NOW - 10 * 60_000 }), NOW)).toBe('none')
  })

  test('isOn false is no run, whatever else the file holds', () => {
    expect(autopilotRunState(statusOf({ isOn: false }), NOW)).toBe('none')
    expect(autopilotRunState(statusOf({ isOn: false, phase: 'paused', beat: 'junk' }), NOW)).toBe('none')
  })

  test('an absent file is no run', () => {
    expect(autopilotRunState({ state: 'absent' }, NOW)).toBe('none')
  })

  test('an unreadable file is unknown, never no run', () => {
    expect(autopilotRunState({ state: 'unknown' }, NOW)).toBe('unknown')
  })

  test('a file over the read cap is unknown', () => {
    expect(autopilotRunState({ state: 'too-large', bytes: MAX_READ_BYTES + 1 }, NOW)).toBe('unknown')
  })

  test('text that is not JSON is unknown', () => {
    for (const text of ['', ' ', '{', 'not json', '{"isOn":true', "{'isOn':true}"]) {
      expect(autopilotRunState(rawStatus(text), NOW)).toBe('unknown')
    }
  })

  test('JSON that is not an object is unknown', () => {
    for (const text of ['null', '[]', '1', '"x"', 'true', '[{"isOn":true,"beat":1000000}]']) {
      expect(autopilotRunState(rawStatus(text), NOW)).toBe('unknown')
    }
  })

  test('an isOn that is not a boolean is unknown', () => {
    for (const value of [{}, { isOn: 'true' }, { isOn: 1 }, { isOn: null }, { isOn: [] }, { beat: NOW }]) {
      expect(autopilotRunState(statusOf(value), NOW)).toBe('unknown')
    }
  })

  test('isOn true with a beat that is missing or not a finite number is unknown', () => {
    const beats = [undefined, null, '1000000', {}, [], true]
    for (const beat of beats) {
      const value = beat === undefined ? { isOn: true } : { isOn: true, beat }
      expect(autopilotRunState(statusOf(value), NOW)).toBe('unknown')
    }
    expect(autopilotRunState(rawStatus('{"isOn":true,"beat":1e999}'), NOW)).toBe('unknown')
    expect(autopilotRunState(rawStatus('{"isOn":true,"beat":-1e999}'), NOW)).toBe('unknown')
  })

  test('a clock that is not a finite number cannot judge a beat, so a run that says it is on is unknown', () => {
    const on = statusOf({ isOn: true, beat: NOW })
    expect(autopilotRunState(on, Number.NaN)).toBe('unknown')
    expect(autopilotRunState(on, Number.POSITIVE_INFINITY)).toBe('unknown')
    expect(autopilotRunState({ state: 'absent' }, Number.NaN)).toBe('none')
  })

  test('the status file of a session is under the home folder, named by the session id', () => {
    expect(autopilotStatusPath('/home/u', 's1')).toBe('/home/u/.claude/autopilot/s1.json')
    expect(autopilotStatusPath('/home/u', 'a-b_C9')).toBe('/home/u/.claude/autopilot/a-b_C9.json')
  })

  test('a session id outside 1 to 128 letters, digits, underscores and dashes gives no path', () => {
    const longest = 'a'.repeat(128)
    expect(autopilotStatusPath('/home/u', longest)).toBe(`/home/u/.claude/autopilot/${longest}.json`)
    for (const id of ['', '../x', 'a/b', 'a b', 'a.b', 'a\nb', 'x\u202Ey', 'a'.repeat(129)]) {
      expect(autopilotStatusPath('/home/u', id)).toBeNull()
    }
  })

  test('a home folder that is not an absolute path gives no path, so the guard cannot look at the wrong file', () => {
    expect(autopilotStatusPath('', 's1')).toBeNull()
    expect(autopilotStatusPath('home/u', 's1')).toBeNull()
  })

  test('the session status file read through the port is an active run', async () => {
    const files = { '/home/u/.claude/autopilot/s1.json': '{"isOn":true,"phase":"paused","beat":1000000}' }
    const run = memIo(memWorld({ files }), [])
    const path = s1Path()

    expect(autopilotRunState(await run.io.read(path, MAX_READ_BYTES), NOW)).toBe('active')
    expect(run.reads).toEqual(['/home/u/.claude/autopilot/s1.json'])
  })

  test('through the port a missing file is no run and a file that cannot be read is unknown', async () => {
    const path = s1Path()
    const missing = memIo(memWorld({}), [])
    expect(autopilotRunState(await missing.io.read(path, MAX_READ_BYTES), NOW)).toBe('none')
    const unreadable = memIo(memWorld({ unknownPaths: [path] }), [])
    expect(autopilotRunState(await unreadable.io.read(path, MAX_READ_BYTES), NOW)).toBe('unknown')
    const huge = memIo(memWorld({ files: { [path]: 'x'.repeat(MAX_READ_BYTES + 1) } }), [])
    expect(autopilotRunState(await huge.io.read(path, MAX_READ_BYTES), NOW)).toBe('unknown')
  })

  test('an active run is refused with the init wording and the unknown state with the regen wording', () => {
    expect(autopilotReply('active', 'init')).toBe(
      'cadre init does not run inside an active autopilot run in this session. ' +
        'Stop it with /autopilot stop, or run /cadre init in another session.',
    )
    expect(autopilotReply('unknown', 'regen')).toBe(
      "cadre regen can't tell whether autopilot is running in this session " +
        '(its status file could not be read), so it stopped.',
    )
  })

  test('each reply names its own command', () => {
    expect(autopilotReply('active', 'regen')).toContain('cadre regen does not run inside an active autopilot run')
    expect(autopilotReply('active', 'regen')).toContain('or run /cadre regen in another session.')
    expect(autopilotReply('unknown', 'init')).toContain("cadre init can't tell whether autopilot is running")
  })

  test('no run gives no reply', () => {
    expect(autopilotReply('none', 'init')).toBeNull()
    expect(autopilotReply('none', 'regen')).toBeNull()
  })
})
