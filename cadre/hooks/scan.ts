import type { PortRead } from '../types'
import { isObject } from './facts'

/**
 * How long an autopilot status file's `beat` counts as alive: twice the 30 second heartbeat autopilot writes, because
 * autopilot itself drops a status older than two beats. The value is copied from autopilot, never imported (D-42).
 */
export const AUTOPILOT_FRESH_MS = 60_000

/** Whether autopilot runs in this session: `none`, `active`, or `unknown` when its status file cannot tell (D-42). */
export type RunState = 'none' | 'active' | 'unknown'

/** A session id as autopilot names its status file: 1 to 128 letters, digits, underscores and dashes. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/** The value of a JSON text; undefined when the text is not JSON. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * The path of a session's autopilot status file, `<home>/.claude/autopilot/<id>.json`. Null when the home folder is not
 * an absolute path or the id is not a plain session id, so a caller treats the run state as unknown and never reads
 * some other file in its place (D-42).
 */
export function autopilotStatusPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${home}/.claude/autopilot/${sessionId}.json`
}

/**
 * Whether an autopilot run is live in this session, from a read of its status file (SCAN-04, D-42). It fails closed:
 * only an absent file, `isOn: false` or a stale beat is `none`. A file that is unreadable or over the read cap, is not
 * JSON or not an object, or holds a non-boolean `isOn`, or (when on) a `beat` that is not a finite number, is
 * `unknown`, and so is a clock that is not a finite number. Otherwise the run is `active`, in any phase, while the
 * beat is within AUTOPILOT_FRESH_MS of `now`, a beat ahead of the clock included. `now` is epoch milliseconds.
 */
export function autopilotRunState(read: PortRead, now: number): RunState {
  if (read.state === 'absent') return 'none'
  if (read.state !== 'text') return 'unknown'

  const value = parseJson(read.text)
  if (!isObject(value)) return 'unknown'
  if (value.isOn === false) return 'none'
  if (value.isOn !== true) return 'unknown'

  const beat = value.beat
  if (typeof beat !== 'number' || !Number.isFinite(beat) || !Number.isFinite(now)) return 'unknown'

  return Math.abs(now - beat) <= AUTOPILOT_FRESH_MS ? 'active' : 'none'
}

/**
 * The text that stops `/cadre init` or `/cadre regen` for a run state, or null when it may go on. An active run is
 * told how to stop it; an unknown state says the status file could not be read (D-42).
 */
export function autopilotReply(state: RunState, command: 'init' | 'regen'): string | null {
  if (state === 'none') return null
  if (state === 'active') {
    return (
      `cadre ${command} does not run inside an active autopilot run in this session. ` +
      `Stop it with /autopilot stop, or run /cadre ${command} in another session.`
    )
  }

  return (
    `cadre ${command} can't tell whether autopilot is running in this session ` +
    '(its status file could not be read), so it stopped.'
  )
}
