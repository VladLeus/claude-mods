/**
 * Autopilot's status files as cadre reads them, a layer 3 module: the path of a session's status file and of its log,
 * whether an autopilot run is live in the session, and the reply that stops /cadre init or regen while one is (D-42,
 * D-111). It reads those files and never writes them. It imports core, paths and the types, so guards and status read
 * autopilot's state here.
 */
import type { PortRead } from '../../types'
import { isObject, parseJsonValue } from '../core/json'
import { t } from '../locales/t'
import { trimSlash } from '../paths'

/**
 * How long an autopilot status file's `beat` counts as alive: twice the 30 second heartbeat autopilot writes, because
 * autopilot itself drops a status older than two beats. The value is copied from autopilot, never imported (D-42).
 */
export const AUTOPILOT_FRESH_MS = 60_000

/** Whether autopilot runs in this session: `none`, `active`, or `unknown` when its status file cannot tell (D-42). */
export type RunState = 'none' | 'active' | 'unknown'

/** A session id as autopilot names its status file: 1 to 128 letters, digits, underscores and dashes. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The path of a session's autopilot status file, `<home>/.claude/autopilot/<id>.json`, with trailing slashes on the
 * home folder dropped so `/` never gives `//`. Null when the home folder is not an absolute path or the id is not a
 * plain session id, so a caller treats the run state as unknown and never reads some other file in its place (D-42).
 */
export function autopilotStatusPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${trimSlash(home)}/.claude/autopilot/${sessionId}.json`
}

/**
 * The path of a session's autopilot log, `<home>/.claude/autopilot/<id>.log`, beside its status file, with the guards
 * of autopilotStatusPath: null when the home folder is not an absolute path or the id is not a plain session id, so a
 * caller never reads some other file in its place (D-111, T-03-34).
 */
export function autopilotLogPath(home: string, sessionId: string): string | null {
  if (!home.startsWith('/')) return null
  if (!SESSION_ID_PATTERN.test(sessionId)) return null

  return `${trimSlash(home)}/.claude/autopilot/${sessionId}.log`
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

  const value = parseJsonValue(read.text)?.value
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
    return t('scan.autopilot.autopilotReply', { command })
  }

  return t('scan.autopilot.autopilotReply2', { command })
}
