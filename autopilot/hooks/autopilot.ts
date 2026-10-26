import type {
  Avail,
  AvailCommand,
  Awaiting,
  AwayField,
  BadgeAvail,
  Command,
  Effective,
  FinalReason,
  FinishedRecord,
  LockOwner,
  Mode,
  Pending,
  Phase,
  Question,
  QueueInput,
  Run,
  StartCommand,
  TokenWindow,
  WaitReason,
} from '../types'

export const RESTART_TOOL = 'restart_session'
export const WAIT_TOOL = 'wait_for'
/** The wait tool as the engine names it in a tool call. */
export const FULL_WAIT_TOOL = `mcp__autopilot__${WAIT_TOOL}`
export const WAIT_REASONS: readonly WaitReason[] = [
  'user-input',
  'user-answer',
  'session-answer',
  'session-ping',
  'workflow-end',
  'subagent-result',
  'background-task',
  'other',
]
const MAX_WAIT_FROM = 64
const MAX_WAIT_NOTE = 200
export const MAX_IDLE_TURNS = 2
/**
 * A threshold below this sits close to what a resume alone loads, so every
 * handoff after the first fires RESUME_BUMP points later. At or above it the
 * threshold stands as given.
 */
export const LOW_THRESHOLD = 50
export const RESUME_BUMP = 10
/**
 * The trigger always fires this many points before auto-compact would: room
 * for the handoff itself (reading state, writing the document).
 */
export const COMPACT_MARGIN = 10
/** The ceiling when auto-compact is off or its threshold is unknown. */
export const DEFAULT_CEILING = 90
export const DEFAULT_FIVE_HOUR_STOP = 95
export const DEFAULT_WEEK_STOP = 80
/** Resume this long after the 5-hour window resets, and wait this long when the reset time is unknown. */
export const RESET_MARGIN_MS = 2 * 60_000
export const UNKNOWN_RESET_WAIT_MS = 30 * 60_000

/**
 * The highest context % a handoff may wait for: COMPACT_MARGIN below the
 * session's auto-compact threshold, so a handoff always comes first.
 */
export function triggerCeiling(autoCompactTokens: number | undefined, windowTokens: number | undefined): number {
  if (!autoCompactTokens || !windowTokens) return DEFAULT_CEILING

  return Math.max(1, Math.floor((autoCompactTokens / windowTokens) * 100) - COMPACT_MARGIN)
}

/**
 * The context % that triggers the handoff now: the person's threshold; under
 * LOW_THRESHOLD, every handoff after the first RESUME_BUMP points later so a
 * resumed session cannot loop; never above the ceiling below auto-compact.
 */
export function effectiveTrigger(run: Run, ceiling: number): number {
  const isBumped = run.threshold < LOW_THRESHOLD && run.restarts > 0

  return Math.min(isBumped ? run.threshold + RESUME_BUMP : run.threshold, ceiling)
}

/** "90m", "2h", "1h30m", "45" (minutes), units in any case ("2H") → milliseconds; null when unreadable. */
export function parseDuration(text: string): number | null {
  const ms = durationMs(text)
  if (ms === null || !Number.isFinite(ms)) return null

  return ms
}

function durationMs(text: string): number | null {
  if (/^\d+$/.test(text)) return Number(text) * 60_000
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/i.exec(text)
  if (!match || (!match[1] && !match[2])) return null

  return (Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0)) * 60_000
}

/** A moved end must stay at least this far ahead of now. */
const MIN_LEAD_MS = 60_000

/** How long after finishing on time or restarts the person can still bring a run back. */
export const GRACE_MS = 15 * 60_000

/** Whether a run that finished for this reason can be brought back (a time-out or used-up restarts only). */
export function isGraceEligible(reason: FinalReason | null): boolean {
  return reason === 'time' || reason === 'restarts'
}

export function isGraceLive(record: FinishedRecord, now: number): boolean {
  return now - record.finishedAt <= GRACE_MS
}

/** Whether a stored `finished:` value is a record still inside its grace period; anything malformed is not. */
export function isLiveFinishedValue(value: unknown, now: number): boolean {
  if (typeof value !== 'object' || value === null) return false
  const finishedAt = (value as { finishedAt?: unknown }).finishedAt
  if (typeof finishedAt !== 'number' || !Number.isFinite(finishedAt)) return false

  return isGraceLive(value as FinishedRecord, now)
}

/** What `/autopilot` says when there is no run but a finished one can still be brought back. */
export function graceStatusText(record: FinishedRecord, now: number): string {
  const minutesLeft = Math.max(0, Math.ceil((GRACE_MS - (now - record.finishedAt)) / 60_000))

  const ask = record.run.finalReason === 'restarts' ? 'extend --restarts N' : 'extend <time>'

  return `Autopilot finished (${record.run.finalReason}) at ${endClock(record.finishedAt, null)}; /autopilot ${ask} within ${minutesLeft}m brings it back from its handoff.`
}

/** How many times a grace resume asks the session to restart before it gives up. */
const MAX_GRACE_ASKS = 1

/**
 * What a finished main-loop turn means for a grace resume that is still
 * waiting for its restart: ask once more, or pause. Any
 * other run (an ordinary wrap-up included) is none of its business.
 */
export function graceTurnAction(run: Run): 'none' | 'ask' | 'pause' {
  if (run.phase !== 'wrapping' || !run.isGraceResume) return 'none'

  return (run.graceAsks ?? 0) < MAX_GRACE_ASKS ? 'ask' : 'pause'
}

/**
 * Whether a grace resume's handoff is the current one: written at or after the
 * final phase began (`ok`), older or unreadable (`stale`), or no start time to
 * compare with (`unknown`, which fails closed).
 */
export function graceHandoffCheck(mtimeMs: number | null, since: number | undefined): 'ok' | 'stale' | 'unknown' {
  if (since === undefined) return 'unknown'

  return mtimeMs !== null && mtimeMs >= since ? 'ok' : 'stale'
}

/** The handoff path a restart call carries: `handoffPath`, or `handoff_path` when the model guessed that name; "" when neither. */
export function handoffArg(input: unknown): string {
  const fields = (typeof input === 'object' && input !== null ? input : {}) as { handoffPath?: unknown; handoff_path?: unknown }

  return String(fields.handoffPath ?? fields.handoff_path ?? '')
}

/** The prompt that makes a finished run restart from the handoff it already wrote. */
export function graceResumePrompt(until: number, offsetMinutes: number | null): string {
  return `Autopilot: the person brought this run back until ${endClock(until, offsetMinutes)}. Call ${RESTART_TOOL} with {"handoffPath": "<path to the handoff .md>"}, the handoff you just wrote under thoughts/shared/handoffs/; autopilot will clear the session and resume from it. Do not start other work first.`
}

/** The most restarts a limit may reach. */
const MAX_RESTARTS = 99

/** The furthest the end of a run may be moved ahead of now. */
export const MAX_AHEAD_MS = 7 * 24 * 60 * 60_000

/** "18:30", "7:30" (24-hour) or "6pm", "6:30pm", "12am" (12-hour, no space, any case) → hours and minutes; null when unreadable. */
export function parseClock(text: string): { hours: number; minutes: number } | null {
  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/i.exec(text)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2] ?? 0)
  const suffix = match[3]?.toLowerCase()
  if (minutes > 59) return null
  if (!suffix) return match[2] === undefined || hours > 23 ? null : { hours, minutes }
  if (hours < 1 || hours > 12) return null

  return { hours: (hours % 12) + (suffix === 'pm' ? 12 : 0), minutes }
}

/** `date +%z` output ("+0300", "-0530") → minutes east of UTC; null when unreadable. */
export function parseUtcOffset(text: string): number | null {
  const match = /^([+-])(\d{2})(\d{2})$/.exec(text.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])

  return match[1] === '-' ? -minutes : minutes
}

/**
 * The next instant strictly after `now` whose local clock (UTC + offset) reads hours:minutes.
 * Today's offset is applied: a DST switch before the target shifts it by an hour.
 */
export function untilFromClock(hours: number, minutes: number, now: number, offsetMinutes: number): number {
  const DAY_MS = 24 * 60 * 60_000
  const localNow = now + offsetMinutes * 60_000
  const localMidnight = localNow - (((localNow % DAY_MS) + DAY_MS) % DAY_MS)
  const today = localMidnight + (hours * 60 + minutes) * 60_000 - offsetMinutes * 60_000

  return today > now ? today : today + DAY_MS
}

export const NOT_RUNNING_TEXT = 'Autopilot is not running. Start a new run: /autopilot <time> <threshold%> "<role>".'

/** Where a change to the run's end and restart limit lands. */
export type RetimeTarget = { until: number; maxRestarts: number | null }

export type RetimeAction =
  | ({ kind: 'set' } & RetimeTarget)
  | ({ kind: 'revive'; phase: 'running' | 'waiting'; waitUntil: number | null } & RetimeTarget)
  | { kind: 'refuse'; message: string }

type RetimeCommand = Extract<Command, { kind: 'extend' | 'shorten' | 'until' }>

/**
 * The end and restart limit a retime command asks for, with a note for the
 * reply when the restarts part changed nothing or hit zero left.
 */
export function targetChange(
  command: RetimeCommand,
  run: Run,
  now: number,
  offset: number | null,
): (RetimeTarget & { note: string | null }) | { refuse: string } {
  if (command.kind === 'until') {
    if (offset === null) return { refuse: 'Cannot read the local time zone; use /autopilot extend or shorten instead.' }

    return { until: untilFromClock(command.hours, command.minutes, now, offset), maxRestarts: run.maxRestarts, note: null }
  }

  const isExtend = command.kind === 'extend'
  const isRestartsOnly = command.deltaMs === 0
  if (isRestartsOnly && run.until <= now && !endsForGood(run)) {
    return {
      refuse: isExtend
        ? "The run's time is over; add time too, e.g. /autopilot extend 1h --restarts N."
        : "The run's time is over; restarts cannot be changed on a finished time, add time with /autopilot extend.",
    }
  }
  // A restarts-only change leaves the end alone (its past end is refused above); an extend counts from now when the end already passed.
  const until = isExtend && !isRestartsOnly ? Math.max(run.until, now) + command.deltaMs : run.until - command.deltaMs
  if (command.restarts === 0) return { until, maxRestarts: run.maxRestarts, note: null }

  if (isExtend) {
    const raised = (run.maxRestarts ?? run.restarts) + command.restarts

    return { until, maxRestarts: Math.max(run.restarts, Math.min(raised, MAX_RESTARTS)), note: raised > MAX_RESTARTS ? `Restart limit capped at ${MAX_RESTARTS}.` : null }
  }
  if (run.maxRestarts === null) {
    return { until, maxRestarts: null, note: 'Restarts are unlimited in this run; --restarts on shorten was ignored.' }
  }
  const lowered = run.maxRestarts - command.restarts
  const note = lowered <= run.restarts ? `No restarts left after this change (${run.restarts} used).` : null

  return { until, maxRestarts: Math.max(run.restarts, lowered), note }
}

const FINAL_REASON_TEXT: Record<string, string> = {
  goal: 'its goal is met',
  week: 'the weekly token limit was reached',
  restarts: 'it used all its restarts',
  done: 'the session reported its work complete',
}

/**
 * What moving the run to `target` does: set it, bring a finished run back
 * (a time-out, or an exhausted restart limit that was raised, with time left),
 * or refuse. `limit` is what the token windows call for now (limitAction): a
 * revive is refused at the weekly stop, and lands in `waiting` while a 5-hour
 * wait is pending or the 5-hour window is at its stop.
 */
export function retime(run: Run | null, target: RetimeTarget, now: number, limit: LimitAction = null): RetimeAction {
  if (!run) return { kind: 'refuse', message: NOT_RUNNING_TEXT }
  if (!Number.isFinite(target.until) || target.until - now > MAX_AHEAD_MS) {
    return { kind: 'refuse', message: 'The end can be at most 7 days from now.' }
  }
  const isFinal = run.phase === 'final'
  if (endsForGood(run)) return { kind: 'refuse', message: finishingText(run.finalReason) }
  if (target.until <= now) {
    return { kind: 'refuse', message: 'The new end would be in the past. To hand back now: /autopilot 0 0 stop.' }
  }
  if (target.until - now < MIN_LEAD_MS) {
    return { kind: 'refuse', message: 'The new end must be at least 1 minute ahead. To hand back now: /autopilot 0 0 stop.' }
  }
  const { until, maxRestarts } = target
  if (!isFinal) return { kind: 'set', until, maxRestarts }
  const isRestartsRaised = target.maxRestarts === null || target.maxRestarts > run.restarts
  if (run.finalReason === 'restarts' && !isRestartsRaised) return { kind: 'refuse', message: finishingText('restarts') }

  if (limit?.kind === 'week') {
    return { kind: 'refuse', message: `The weekly token limit is at its stop (${run.weekStop}%); the run cannot continue.` }
  }
  if (limit?.kind === 'five-hour') return { kind: 'revive', phase: 'waiting', waitUntil: limit.waitUntil, until, maxRestarts }
  if (run.waitUntil && run.waitUntil > now) return { kind: 'revive', phase: 'waiting', waitUntil: run.waitUntil, until, maxRestarts }

  return { kind: 'revive', phase: 'running', waitUntil: null, until, maxRestarts }
}

/** A final handoff that more time or restarts cannot undo (anything but a time-out or used-up restarts). */
function endsForGood(run: Run): boolean {
  return run.phase === 'final' && run.finalReason !== 'time' && run.finalReason !== 'restarts'
}

function finishingText(reason: FinalReason | null): string {
  const reasonText = (reason && FINAL_REASON_TEXT[reason]) || 'it is wrapping up'

  return `Autopilot is finishing because ${reasonText}; more time does not change that. Start a new run after it hands back.`
}

/** The furthest instant a Date can print; a value past it is broken or forged. */
const MAX_DATE_MS = 8_640_000_000_000_000

/** `HH:MM (HH:MM UTC)` on the clock `offsetMinutes` east of UTC, or `HH:MM UTC` when the offset is unknown. */
export function endClock(until: number, offsetMinutes: number | null): string {
  if (!Number.isFinite(until) || Math.abs(until) > MAX_DATE_MS) return 'an unreadable time'
  const utc = new Date(until).toISOString().slice(11, 16)
  if (offsetMinutes === null) return `${utc} UTC`

  return `${new Date(until + offsetMinutes * 60_000).toISOString().slice(11, 16)} (${utc} UTC)`
}

/**
 * The prompt that brings a finished run back to work. `restarts` is given when
 * the run was revived from used-up restarts: the text then names them, not the time.
 */
export function revivePrompt(until: number, offsetMinutes: number | null, restarts?: { used: number; limit: number | null }): string {
  const tail = 'The final handoff is cancelled: do not write it now. Keep working within your role.'
  const when = endClock(until, offsetMinutes)
  if (restarts) {
    return `Autopilot: the person added restarts (now ${restarts.used}/${restarts.limit ?? 'unlimited'}); the run continues until ${when}. ${tail}`
  }

  return `Autopilot: the person extended this run until ${when}. ${tail}`
}

/** Takes `--name value` out of the arguments; a quoted value may hold spaces. */
function takeFlag(text: string, name: string): { value: string | null; rest: string } {
  const pattern = new RegExp(`\\s--${name}\\s+(?:"([^"]*)"|“([^”]*)”|«([^»]*)»|'([^']*)'|(\\S+))`)
  const match = pattern.exec(` ${text}`)
  if (!match) return { value: null, rest: text }
  const value = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? ''

  return { value, rest: ` ${text}`.replace(match[0], '').trim() }
}

/** Takes every `--name` switch (no value) out of the arguments; whether there was one. */
function takeSwitch(text: string, name: string): { isOn: boolean; rest: string } {
  const pattern = new RegExp(`\\s--${name}(?=\\s|$)`, 'g')
  const rest = ` ${text}`.replace(pattern, '')

  return { isOn: rest.length !== text.length + 1, rest: rest.trim() }
}

function percentFlag(value: string | null, fallback: number, label: string): number | string {
  if (value === null) return fallback
  const number = Number(value)
  if (!Number.isFinite(number) || number < 1 || number > 100) return `${label} must be a percentage between 1 and 100.`

  return number
}

const ROLE_QUOTES: Record<string, string> = { '"': '"', '“': '”', '«': '»', "'": "'" }

const FLAG_NAMES = ['--goal', '--5h', '--week']
/** Flags that take no value. */
const SWITCH_NAMES = ['--ask-user']
const isSpace = (char: string | undefined): boolean => char !== undefined && /\s/.test(char)

/**
 * For each position, whether the text from there to the end is only flag
 * syntax, the same as `^(\s+--(goal|5h|week)\s+(<quoted value>|\S+)|\s+--ask-user(?=\s|$))*\s*$`
 * with the value quoted in any supported style. Read in one pass from the end,
 * each position's answer from one further on, so it stays linear: a regex
 * tried at every closing quote would rescan the tail for each of them.
 */
function flagsOnlyFrom(text: string): Uint8Array {
  const size = text.length
  const isFlagsOnly = new Uint8Array(size + 1)
  const nextSpace = new Int32Array(size + 1)
  const nextNonSpace = new Int32Array(size + 1)
  const nextCloser: Record<string, Int32Array> = {}
  for (const closer of Object.values(ROLE_QUOTES)) nextCloser[closer] = new Int32Array(size + 1).fill(-1)
  isFlagsOnly[size] = 1
  nextSpace[size] = size
  nextNonSpace[size] = size

  for (let at = size - 1; at >= 0; at -= 1) {
    const char = text.charAt(at)
    const isWhitespace = isSpace(char)
    nextSpace[at] = isWhitespace ? at : (nextSpace[at + 1] ?? size)
    nextNonSpace[at] = isWhitespace ? (nextNonSpace[at + 1] ?? size) : at
    for (const [closer, next] of Object.entries(nextCloser)) next[at] = char === closer ? at : (next[at + 1] ?? -1)
    if (!isWhitespace) continue

    const flagAt = nextNonSpace[at] ?? size
    if (flagAt === size) {
      isFlagsOnly[at] = 1
      continue
    }
    // A switch ends at the next space or the end; what follows it decides.
    const switchName = SWITCH_NAMES.find(flag => text.startsWith(flag, flagAt))
    const switchEnd = flagAt + (switchName?.length ?? 0)
    if (switchName && (switchEnd === size || isSpace(text[switchEnd]))) {
      isFlagsOnly[at] = isFlagsOnly[switchEnd] ?? 0
      continue
    }
    const name = FLAG_NAMES.find(flag => text.startsWith(flag, flagAt))
    if (!name || !isSpace(text[flagAt + name.length])) continue
    const valueAt = nextNonSpace[flagAt + name.length] ?? size
    if (valueAt === size) continue

    // A bare word runs to the next space; a quoted value to its closing quote.
    if (isFlagsOnly[nextSpace[valueAt] ?? size]) {
      isFlagsOnly[at] = 1
      continue
    }
    const closer = ROLE_QUOTES[text.charAt(valueAt)]
    const closeAt = closer ? (nextCloser[closer]?.[valueAt + 1] ?? -1) : -1
    if (closeAt !== -1 && isFlagsOnly[closeAt + 1]) isFlagsOnly[at] = 1
  }

  return isFlagsOnly
}

/**
 * Splits a quoted role off the arguments: `head` runs through the role's
 * closing quote, `rest` is what follows, the only place flags are read from.
 * The role closes at the first closing quote after which only flags follow,
 * so a quote or apostrophe inside the role stays in it. null when the role
 * is not quoted.
 */
function splitQuotedRole(text: string): { head: string; rest: string } | null {
  const match = /^(?:until\s+)?\S+\s+\d{1,3}%?\s+(?:\d{1,2}\s+)?(["“«'])/i.exec(text)
  if (!match) return null
  const opener = match[1] ?? ''
  const closer = ROLE_QUOTES[opener] ?? opener
  const isFlagsOnly = flagsOnlyFrom(text)
  for (let closeAt = text.indexOf(closer, match[0].length); closeAt !== -1; closeAt = text.indexOf(closer, closeAt + 1)) {
    if (isFlagsOnly[closeAt + 1]) return { head: text.slice(0, closeAt + 1), rest: text.slice(closeAt + 1) }
  }

  // Unclosed, or no closing quote is followed by flags alone: everything after the opening quote is the role.
  return { head: text, rest: '' }
}

const USAGE =
  'Usage: /autopilot <time | until <clock>> <threshold%> [max restarts] "<role>" [--goal "<condition>"] [--5h 95] [--week 80] [--ask-user]  ·  /autopilot extend [<time>] [--restarts N]  ·  /autopilot shorten [<time>] [--restarts N]  ·  /autopilot until HH:MM  ·  /autopilot 0 0 stop'
const MAX_ECHOED = 40

/** The person's raw text as an error reply shows it: invisible characters out, capped at 40 characters. */
function echoed(raw: string): string {
  const text = raw.replace(INVISIBLE_ALL, '')

  return text.length > MAX_ECHOED ? `${text.slice(0, MAX_ECHOED)}…` : text
}

const CLOCK_TEXT ='Give the end as HH:MM (24-hour) or with am/pm, e.g. until 18:30 or until 6:30pm (local time).'
const RESTARTS_FLAG_TEXT = '--restarts needs a whole number from 1 to 99.'

/**
 * `/autopilot` arguments: nothing (status), `stop` or `0 0 stop`, or
 * `<duration> <threshold%> [max restarts] "<role>"` with optional flags
 * `--goal "<condition>"`, `--5h <%>`, `--week <%>`, `--ask-user`. No max means as many
 * restarts as the time allows.
 */
export function parseCommand(args: string): Command {
  const text = args.trim()
  if (!text) return { kind: 'status' }
  if (/^(0\s+0\s+)?stop$/i.test(text)) return { kind: 'stop' }

  const dashed = /^--(extend|shorten|until)\b\s*(.*)$/i.exec(text)
  if (dashed) {
    const rest = echoed((dashed[2] ?? '').trim())

    return { kind: 'error', message: `Did you mean /autopilot ${dashed[1]?.toLowerCase()}${rest ? ` ${rest}` : ''}?` }
  }
  const retimeMatch = /^(extend|shorten)(?:\s+([\s\S]*))?$/i.exec(text)
  if (retimeMatch) {
    const kind = retimeMatch[1]?.toLowerCase() === 'extend' ? 'extend' : 'shorten'
    const usage = { kind: 'error', message: `Usage: /autopilot ${kind} [<time>] [--restarts N]` } as const
    const restartsFlag = takeFlag(retimeMatch[2] ?? '', 'restarts')
    const rawTime = restartsFlag.rest
    const restarts = restartsFlag.value === null ? 0 : Number(restartsFlag.value)
    if (restartsFlag.value !== null && (!/^\d{1,2}$/.test(restartsFlag.value) || restarts < 1)) {
      return { kind: 'error', message: RESTARTS_FLAG_TEXT }
    }
    if (/\s|^--/.test(rawTime)) return usage
    if (!rawTime && restarts === 0) return usage
    if (!rawTime) return { kind, deltaMs: 0, restarts }

    const deltaMs = parseDuration(rawTime)
    if (deltaMs === null || deltaMs <= 0) {
      return { kind: 'error', message: `Cannot read the time "${echoed(rawTime)}" (try 90m, 2h, 1h30m).` }
    }

    return { kind, deltaMs, restarts }
  }
  if (/^until$/i.test(text)) return { kind: 'error', message: 'Usage: /autopilot until HH:MM' }
  if (/^until\s/i.test(text) && /\s--restarts(?=\s|$)/i.test(text)) {
    return { kind: 'error', message: 'until takes no --restarts; use /autopilot extend --restarts N.' }
  }
  // `until <clock>` alone moves the end; with more after it, it is a start with an end time.
  const untilMatch = /^until\s+(\S+)$/i.exec(text)
  if (untilMatch) {
    const clock = parseClock(untilMatch[1] ?? '')
    if (!clock) return { kind: 'error', message: CLOCK_TEXT }

    return { kind: 'until', ...clock }
  }

  return parseStart(text)
}

/** A start: `<time | until <clock>> <threshold%> [max restarts] "<role>"` with the flags anywhere outside the role. */
function parseStart(args: string): Command {
  let text = args
  // Flags are read only outside a quoted role: a role may not carry its own --goal.
  const quoted = splitQuotedRole(text)
  let flagText = quoted ? quoted.rest : text
  const goalFlag = takeFlag(flagText, 'goal')
  flagText = goalFlag.rest
  const fiveHourFlag = takeFlag(flagText, '5h')
  flagText = fiveHourFlag.rest
  const weekFlag = takeFlag(flagText, 'week')
  flagText = weekFlag.rest
  // After the valued flags, so a quoted --goal holding the word keeps it.
  const askUserFlag = takeSwitch(flagText, 'ask-user')
  flagText = askUserFlag.rest
  text = quoted ? `${quoted.head}${flagText}`.trim() : flagText

  const fiveHourStop = percentFlag(fiveHourFlag.value, DEFAULT_FIVE_HOUR_STOP, '--5h')
  if (typeof fiveHourStop === 'string') return { kind: 'error', message: fiveHourStop }
  const weekStop = percentFlag(weekFlag.value, DEFAULT_WEEK_STOP, '--week')
  if (typeof weekStop === 'string') return { kind: 'error', message: weekStop }
  const goal = goalFlag.value?.trim() || null
  if (goalFlag.value !== null && !goal) return { kind: 'error', message: '--goal needs a condition in quotes.' }

  const match = /^(?:until\s+(\S+)|(?!until\s)(\S+))\s+(\d{1,3})%?\s+(?:(\d{1,2})\s+)?(["'“«][\s\S]+|[^\d\s][\s\S]*)$/i.exec(text)
  if (!match) return { kind: 'error', message: USAGE }
  const [, rawClock, rawDuration = '', rawThreshold = '', rawRestarts, rawRole = ''] = match
  const clock = rawClock === undefined ? null : parseClock(rawClock)
  if (rawClock !== undefined && !clock) return { kind: 'error', message: CLOCK_TEXT }
  const ms = parseDuration(rawDuration)
  if (!clock && (ms === null || ms <= 0)) {
    return { kind: 'error', message: `Cannot read the time "${echoed(rawDuration)}" (try 90m, 2h, 1h30m).` }
  }
  const end: StartCommand['end'] = clock ? { kind: 'clock', ...clock } : { kind: 'duration', ms: ms ?? 0 }
  const threshold = Number(rawThreshold)
  if (threshold < 1 || threshold > 95) return { kind: 'error', message: 'The context threshold must be between 1 and 95 (%).' }
  const role = rawRole.trim().replace(/^["'“«]|["'”»]$/g, '').trim()
  if (role.length < 10) {
    return { kind: 'error', message: 'Give the role in a sentence or more: who the session is and what it is responsible for.' }
  }

  return {
    kind: 'start',
    end,
    threshold,
    maxRestarts: rawRestarts === undefined ? null : Number(rawRestarts),
    role,
    goal,
    fiveHourStop,
    weekStop,
    askUser: askUserFlag.isOn,
  }
}

/**
 * The skills a role names as `/name`, kept only when the session has a
 * command of that name that is not built in (a skill, a plugin's command).
 */
export function namedSkills(role: string, skillNames: readonly string[]): string[] {
  const known = new Set(skillNames)
  const found: string[] = []
  for (const match of role.matchAll(/(?:^|[\s("'“«`])\/([a-z0-9][\w:.-]*)/gi)) {
    const name = trimTrailingPunctuation(match[1] ?? '')
    if (name && known.has(name) && !found.includes(name)) found.push(name)
  }

  return found
}

const TRAILING_PUNCTUATION = '.,;:!?)'

/** Drops trailing `.,;:!?)` in one linear pass (a regex here backtracks on long runs). */
function trimTrailingPunctuation(text: string): string {
  let end = text.length
  while (end > 0 && TRAILING_PUNCTUATION.includes(text.charAt(end - 1))) end -= 1

  return text.slice(0, end)
}

/** Whether another handoff restart is allowed; time alone limits a run with no max. */
export function canRestart(run: Run): boolean {
  return run.maxRestarts === null || run.restarts < run.maxRestarts
}

export function restartsText(run: Run): string {
  return `${run.restarts}/${run.maxRestarts ?? '∞'}`
}

export type LimitAction = { kind: 'week' } | { kind: 'five-hour'; waitUntil: number } | null

/**
 * What the token windows call for: the weekly one past its stop ends the run
 * for good; the 5-hour one past its stop parks it until the window resets.
 */
export function limitAction(run: Run, windows: readonly TokenWindow[], now: number): LimitAction {
  const week = windows.find(window => window.kind === 'seven_day')
  if (week && week.percentUsed >= run.weekStop) return { kind: 'week' }

  const fiveHour = windows.find(window => window.kind === 'five_hour')
  if (!fiveHour || fiveHour.percentUsed < run.fiveHourStop) return null
  const resetsAt = fiveHour.resetsAt ? Date.parse(fiveHour.resetsAt) : Number.NaN

  return {
    kind: 'five-hour',
    waitUntil: Number.isFinite(resetsAt) && resetsAt > now ? resetsAt + RESET_MARGIN_MS : now + UNKNOWN_RESET_WAIT_MS,
  }
}

export type TurnAction = 'continue' | 'wrapup' | 'final' | 'pause' | 'finish' | 'resume-done' | 'none'

/**
 * What to do when a main-loop turn ends, from the run, the context fill, the
 * time, whether the turn called any tool, and the ceiling below auto-compact.
 * The token windows are judged apart (limitAction), before this.
 */
export function afterTurn(
  run: Run,
  now: number,
  percent: number | null,
  calledTools: boolean,
  ceiling = DEFAULT_CEILING,
): TurnAction {
  // The turn that called the restart tool ends before /clear runs: queue nothing,
  // or a prompt could reach the fresh conversation ahead of the resume.
  if (run.phase === 'paused' || run.phase === 'restarting' || run.phase === 'waiting') return 'none'
  // The session declared a wait: no nudge; the next turn that starts wakes it.
  // The context trigger and the limits are checked again on that turn; time is the 30 s clock's.
  if (run.phase === 'awaiting') return 'none'
  // The turn /resume-handoff-doc started: the resume ran; back to work.
  if (run.phase === 'resuming') return 'resume-done'
  // A wrap-up turn ended; the model either called the restart tool or not.
  if (run.phase === 'wrapping') return 'none'
  if (run.phase === 'final') return 'finish'

  if (now >= run.until) return 'final'
  if (percent !== null && percent >= effectiveTrigger(run, ceiling)) return canRestart(run) ? 'wrapup' : 'final'
  if (!calledTools && run.idleTurns + 1 >= MAX_IDLE_TURNS) return 'pause'

  return 'continue'
}

/** Whether a tool result mid-turn should carry the wrap-up instruction now. */
export function wrapMidTurn(
  run: Run,
  now: number,
  percent: number | null,
  ceiling = DEFAULT_CEILING,
): 'wrapup' | 'final' | null {
  // A resume turn often does real work right away: it is watched as well.
  if (run.phase !== 'running' && run.phase !== 'resuming') return null
  if (now >= run.until) return 'final'
  if (percent !== null && percent >= effectiveTrigger(run, ceiling)) return canRestart(run) ? 'wrapup' : 'final'

  return null
}

/** Phases in which the session must be able to end its turn: a goal's Stop hook may not hold it. */
export function shouldDropStopBlock(phase: Phase): boolean {
  return phase === 'wrapping' || phase === 'restarting' || phase === 'final' || phase === 'awaiting'
}

/**
 * Whether autopilot answers AskUserQuestion and marks refused actions as
 * deferred: not while paused or waiting, when the person is in control.
 * A declared wait (awaiting) still counts as away.
 */
export function autoAnswersQuestions(phase: Phase): boolean {
  return phase !== 'paused' && phase !== 'waiting'
}

/** A free-text field: line breaks to a space, other invisible characters out, trimmed, capped; empty is null. `cut` says the cap shortened it. */
function waitField(value: unknown, name: string, max: number): { value: string | null; cut: boolean } | { error: string } {
  if (value === undefined) return { value: null, cut: false }
  if (typeof value !== 'string') return { error: `${name} must be a string.` }
  const whole = value.replace(LINE_BREAKS, ' ').replace(INVISIBLE_ALL, '').trim()
  const text = whole.slice(0, max).trim()

  return { value: text || null, cut: whole.length > max }
}

/**
 * The wait_for tool's input as a wait starting now: a known reason, optional
 * `from` and `note`, and an optional `timeout` ("30m", "1h") after which
 * autopilot checks once, never later than the run's end.
 */
export function parseWaitInput(
  input: unknown,
  now: number,
  until: number,
): { kind: 'ok'; awaiting: Awaiting } | { kind: 'error'; message: string } {
  if (!input || typeof input !== 'object') return { kind: 'error', message: 'wait_for needs an input object.' }
  const fields = input as Record<string, unknown>
  const reason = WAIT_REASONS.find(known => known === fields.reason)
  if (!reason) return { kind: 'error', message: `reason must be one of: ${WAIT_REASONS.join(', ')}.` }
  const from = waitField(fields.from, 'from', MAX_WAIT_FROM)
  if ('error' in from) return { kind: 'error', message: from.error }
  const note = waitField(fields.note, 'note', MAX_WAIT_NOTE)
  if ('error' in note) return { kind: 'error', message: note.error }

  let timeoutAt: number | null = null
  if (fields.timeout !== undefined) {
    if (typeof fields.timeout !== 'string') return { kind: 'error', message: 'timeout must be a string such as "30m" or "1h".' }
    const ms = parseDuration(fields.timeout.trim())
    if (ms === null || ms <= 0) return { kind: 'error', message: `Cannot read the timeout ${quoteValue(fields.timeout)} (try 30m, 1h, 1h30m).` }
    timeoutAt = Math.min(now + ms, until)
  }

  return { kind: 'ok', awaiting: { reason, from: from.value, note: note.value, since: now, timeoutAt, pinged: false } }
}

/** Whether a main-loop tool call ends a declared wait: any tool but the wait tool itself means the session went on working. */
export function endsWait(phase: Phase, tool: string): boolean {
  return phase === 'awaiting' && tool !== FULL_WAIT_TOOL
}

/**
 * Why wait_for is refused in this phase, or null when allowed: while running,
 * and again while awaiting (a repeat replaces the wait).
 */
export function waitPhaseRefusal(phase: Phase): string | null {
  if (phase === 'running' || phase === 'awaiting') return null
  if (phase === 'resuming') {
    return `Autopilot is finishing the resume from the handoff: end this turn normally; you can call ${WAIT_TOOL} in the next turn.`
  }

  return 'Autopilot is not driving right now: no wait needed.'
}

const PERSON_REASONS: readonly WaitReason[] = ['user-answer', 'user-input']

/**
 * Why a wait is refused, or null when allowed. Waiting for the person needs a
 * mode that asks them (asking, draining), and then the question or action as
 * its note; while they cannot answer, the question goes to the queue instead.
 */
export function waitRefusal(awaiting: Awaiting, mode: Mode): string | null {
  if (!PERSON_REASONS.includes(awaiting.reason)) return null
  if (mode === 'plain') {
    return 'This run does not wait for the person (no --ask-user): decide yourself, or send one PushNotification and continue with other work.'
  }
  if (mode === 'queueing') {
    return `The person cannot answer right now (away, or asking is off): do not wait for them. Call ${QUEUE_TOOL} with the question instead, then keep working on what is not blocked by it.`
  }
  if (mode === 'overdue') {
    return `The person's away time is over, but they have not written in this session yet, so they are not asked now: do not wait for them. Call ${QUEUE_TOOL} with the question instead; autopilot asks the queued questions one by one once they write. Keep working on what is not blocked by it.`
  }
  if (!awaiting.note) return `A wait for ${awaiting.reason} needs the question or the action for the person as its note.`

  return null
}

/** The wait as one short line: reason, who from, how long, the note. */
export function waitText(awaiting: Awaiting, now: number): string {
  return [
    awaiting.reason,
    ...(awaiting.from ? [` ← ${quoteValue(awaiting.from)}`] : []),
    ` · ${formatLeft(now - awaiting.since)}`,
    ...(awaiting.note ? [` — ${quoteValue(awaiting.note)}`] : []),
  ].join('')
}

/** The one check autopilot sends when a declared wait runs past its timeout. */
export function waitTimeoutPrompt(awaiting: Awaiting, now: number): string {
  const from = awaiting.from ? ` from ${quoteValue(awaiting.from)}` : ''
  const note = awaiting.note ? ` (${quoteValue(awaiting.note)})` : ''

  return `Autopilot: you have waited ${formatLeft(now - awaiting.since)} for ${awaiting.reason}${from}${note}. Check whether it arrived or is stuck; escalate within your role if needed (PushNotification for the person), then continue or call ${WAIT_TOOL} again.`
}

/** Above this many queued questions queue_question still accepts, with a warning. */
export const QUEUE_WARN = 20
export const QUEUE_TOOL = 'queue_question'
/** The queue tool as the engine names it in a tool call. */
export const FULL_QUEUE_TOOL = `mcp__autopilot__${QUEUE_TOOL}`
const MAX_QUESTION = 500
const MAX_PROVISIONAL = 200
const QUESTION_KINDS: readonly Question['kind'][] = ['answer', 'action']

/** A leading `#k` tag: digits not run on into a word, then any separator. */
const LEADING_TAG = /^\s*#(\d+)(?!\w)[\s:.)–—-]*/

/** The text without a leading `#k` tag the model may have copied from a wait note. */
export function stripTag(text: string): string {
  return text.replace(LEADING_TAG, '').trim()
}

/**
 * The queue_question tool's input: the question (tag stripped), its kind and
 * an optional provisional decision; a string is the error the model reads.
 */
export function parseQueueInput(input: unknown): QueueInput | string {
  if (!input || typeof input !== 'object') return `${QUEUE_TOOL} needs an input object.`
  const fields = input as Record<string, unknown>
  const question = waitField(fields.question, 'question', MAX_QUESTION)
  if ('error' in question) return question.error
  const text = stripTag(question.value ?? '')
  if (!text) return 'question must be the question or the action for the person, in a sentence or two.'
  const kind = QUESTION_KINDS.find(known => known === fields.kind)
  if (!kind) return 'kind must be answer (the person decides) or action (the person must do something).'
  const provisional = fields.provisional === null ? { value: null, cut: false } : waitField(fields.provisional, 'provisional', MAX_PROVISIONAL)
  if ('error' in provisional) return provisional.error
  const base = { question: text, kind, provisional: provisional.value }

  return question.cut || provisional.cut ? { ...base, cut: true } : base
}

/**
 * The next question id, never reused within the run: the stored counter, and
 * never at or below an id in the queue or the one being asked or waited on
 * (an older run has no counter).
 */
function nextQuestionId(run: Run): number {
  const ids = (run.questions ?? []).map(question => question.id)
  const inUse = Math.max(0, ...ids, run.askingId ?? 0, run.awaiting?.questionId ?? 0) + 1

  return Math.max(run.nextQuestionId ?? 1, inUse)
}

/** Appends a question as parseQueueInput returned it (tag already stripped); the same text again keeps the queued one. Nothing is ever dropped. */
export function addQuestion(run: Run, input: QueueInput, now: number): { run: Run; id: number; isNew: boolean; warn: boolean } {
  const questions = run.questions ?? []
  const text = input.question.trim()
  const same = questions.find(question => question.text === text)
  if (same) return { run, id: same.id, isNew: false, warn: questions.length > QUEUE_WARN }

  const id = nextQuestionId(run)
  const next = [...questions, { id, text, kind: input.kind, provisional: input.provisional, at: now }]

  return { run: { ...run, questions: next, nextQuestionId: id + 1 }, id, isNew: true, warn: next.length > QUEUE_WARN }
}

/** The queued question a wait note names with a leading `#k`; null when untagged or not queued. */
export function questionIdFromNote(note: string | null, questions: readonly Question[]): number | null {
  const match = note ? LEADING_TAG.exec(note) : null
  if (!match) return null
  const id = Number(match[1])

  return questions.some(question => question.id === id) ? id : null
}

/**
 * The run after the person answered during a drain: the wait's tagged
 * question goes, else the one the drain asked. No id, nothing removed. A
 * drain prompt still pending goes too: it names a question now answered.
 */
export function answeredQuestion(run: Run): Run {
  const id = run.awaiting?.questionId ?? run.askingId
  const questions = run.questions ?? []
  const left = questions.filter(question => question.id !== id)
  if (left.length === questions.length) return run
  const pending = run.pending ? { pending: run.pending.filter(entry => entry.kind !== 'drain') } : {}
  if (left.length === 0) return { ...run, ...pending, questions: left, drain: false, askingId: undefined }

  return { ...run, ...pending, questions: left, askingId: run.askingId === id ? undefined : run.askingId }
}

/** What the model reads when its wait for the person ends because the person is away or asking is off. */
export const RELEASE_PROMPT = `Autopilot: the person is not available now, so your wait for them has ended. The question is queued and will be asked when they are back; do not ask it again. Keep working on what is not blocked by it; new critical questions go through ${QUEUE_TOOL}.`

/** The `continue` text when a released wait had no note: nothing was queued, so the model queues the question itself. */
export const RELEASE_UNQUEUED_PROMPT = `Autopilot: the person is not available now, so your wait for them has ended. Your question was NOT queued because the wait had no note. Call ${QUEUE_TOOL} with it now so it is asked when they are back; do not ask it directly. Keep working on what is not blocked by it.`

/** "1 critical question is" / "N critical questions are": the count every ping and toast uses. */
export function criticalCount(n: number): string {
  return n === 1 ? '1 critical question is' : `${n} critical questions are`
}

/**
 * How to ask one queued question: as text, then a wait whose note starts with
 * its #k tag. Shared by drainPrompt and the draining role section (task 05).
 */
export function askQuestionText(q: Question): string {
  const meanwhile = q.provisional ? ` (meanwhile you went with: ${quoteValue(q.provisional, MAX_PROVISIONAL)})` : ''
  const reason = q.kind === 'action' ? 'user-input' : 'user-answer'

  return `Ask question #${q.id} now, and only it: ${quoteValue(q.text, MAX_QUESTION)}${meanwhile}. Write it to the person as text, call ${WAIT_TOOL} with reason ${reason} and a note that starts with "#${q.id}", then end your turn.`
}

/** The prompt for the one ping when a session's away time ends with questions queued (spec §7.2). */
export function expiryPingText(n: number): string {
  return `Autopilot: the away time is over; ${criticalCount(n)} queued. Send one PushNotification saying so (under 200 characters), then keep working without asking until the person writes in this session.`
}

/** The prompt that starts asking the queue: how many wait, then the head question. */
export function drainPrompt(q: Question, left: number): string {
  const count = left === 1 ? '1 queued question' : `${left} queued questions`

  return `Autopilot: the person is available again; ${count} to ask, one at a time. ${askQuestionText(q)} New critical questions still go through ${QUEUE_TOOL}.`
}

/** Adds a prompt to deliver; one of the same kind and key is replaced, so a burst of changes leaves one. */
export function pushPending(run: Run, p: Pending): Run {
  const pending = run.pending ?? []
  const at = pending.findIndex(entry => entry.kind === p.kind && entry.key === p.key)
  if (at === -1) return { ...run, pending: [...pending, p] }

  return { ...run, pending: pending.map((entry, index) => (index === at ? p : entry)) }
}

/** The run after a prompt reached the model: it leaves the queue; a delivered ping is remembered. */
export function deliveredPending(run: Run, p: Pending): Run {
  const pending = (run.pending ?? []).filter(entry => entry.kind !== p.kind || entry.key !== p.key)
  if (p.kind !== 'ping') return { ...run, pending }

  return { ...run, pending, pingedFor: p.key }
}

/** Whether a pending prompt may go to the model in this phase; otherwise it waits (toast only). */
export function canDeliver(phase: Phase): boolean {
  return phase === 'running' || phase === 'awaiting'
}

/** A person's own prompt: after an expired away it starts the drain (R10); before expiry it changes nothing. */
export function humanSubmit(run: Run, mode: Mode): Run {
  if (mode !== 'overdue') return run

  return { ...run, drain: true }
}

/** Puts a released wait's question at the queue head, unless the same text is already queued. */
function queueAtHead(run: Run, awaiting: Awaiting, now: number): Run {
  const text = stripTag(awaiting.note ?? '')
  const questions = run.questions ?? []
  if (!text || questions.some(question => question.text === text)) return run
  const kind: Question['kind'] = awaiting.reason === 'user-input' ? 'action' : 'answer'

  const id = nextQuestionId(run)

  return { ...run, nextQuestionId: id + 1, questions: [{ id, text, kind, provisional: null, at: now }, ...questions] }
}

/** No asking now: the drain stops, a stale drain prompt goes, and a wait for the person is released into the queue. */
function stopAsking(run: Run, now: number): Run {
  const pending = (run.pending ?? []).filter(entry => entry.kind !== 'drain')
  const stopped: Run = { ...run, drain: false, askingId: undefined, pending }
  const awaiting = run.awaiting ?? null
  if (run.phase !== 'awaiting' || !awaiting || !PERSON_REASONS.includes(awaiting.reason)) return stopped

  const released: Run = { ...stopped, phase: 'running', awaiting: null, idleTurns: 0 }
  const queued = awaiting.questionId === undefined ? queueAtHead(released, awaiting, now) : released
  const isQueued = awaiting.questionId !== undefined || stripTag(awaiting.note ?? '') !== ''

  return pushPending(queued, { kind: 'continue', text: isQueued ? RELEASE_PROMPT : RELEASE_UNQUEUED_PROMPT, key: 0 })
}

/** Away again or asking off: an undelivered "the away is over" ping is no longer true (D4, R8). */
function dropPings(run: Run): Run {
  return { ...run, pending: (run.pending ?? []).filter(entry => entry.kind !== 'ping' && entry.kind !== 'combined-ping') }
}

/** Starts asking the queue from its head; undelivered expiry pings (session or combined) are moot once the person is back. */
function startDrain(run: Run, head: Question): Run {
  const draining: Run = { ...dropPings(run), drain: true, askingId: head.id }

  return pushPending(draining, { kind: 'drain', text: drainPrompt(head, (run.questions ?? []).length), key: 0 })
}

/** The one ping for a session's own away that expired with questions queued (R8, D4). */
function pingOnExpiry(run: Run, eff: Effective, now: number): Run {
  const away = eff.away
  if (!eff.askOn || eff.awaySource !== 'session' || !away || !isAwayExpired(away, now)) return run
  if (run.pingedFor === away.setAt) return run

  return pushPending(run, { kind: 'ping', text: expiryPingText((run.questions ?? []).length), key: away.setAt })
}

/** Whether a global away just expired for this session: it joins the combined ping (§7.3). */
function isGlobalExpiry(prev: Mode | undefined, next: Mode, eff: Effective, now: number): boolean {
  if (prev !== 'queueing' || (next !== 'overdue' && next !== 'asking')) return false

  return eff.askOn && eff.awaySource === 'global' && isAwayExpired(eff.away, now)
}

/**
 * The run after its mode became `next` (spec §5.1), judged against the mode
 * the last trigger acted on. `combined` says a global away just ended here
 * (informational: the combined ping itself is task 10's combinedTick).
 */
export function applyMode(run: Run, next: Mode, eff: Effective, now: number): { run: Run; combined: boolean } {
  const prev = run.lastMode
  let out: Run = { ...run, lastMode: next }
  if (next === 'queueing' || next === 'overdue') out = stopAsking(out, now)
  if (next === 'queueing') out = dropPings(out)

  const head = (out.questions ?? [])[0]
  const isDrainStart = next === 'asking' || (next === 'draining' && prev !== 'asking' && prev !== 'draining')
  if (head && isDrainStart) out = startDrain(out, head)
  if (next === 'overdue' && prev !== 'overdue') out = pingOnExpiry(out, eff, now)

  return { run: out, combined: isGlobalExpiry(prev, next, eff, now) }
}

function parseRow(line: string): Record<string, unknown> | null {
  try {
    const row: unknown = JSON.parse(line)
    if (!row || typeof row !== 'object' || Array.isArray(row)) return null

    return row as Record<string, unknown>
  } catch {
    // A malformed line: skip it.
    return null
  }
}

export type GoalVerdict = { met: boolean; condition: string }

/**
 * The goal evaluator's verdicts from whole transcript lines. The engine writes
 * each as a top-level attachment row (`{"type":"attachment","attachment":
 * {"type":"goal_status","met":…,"condition":…}}`); a verdict anywhere else (a
 * tool input, message text) is not the engine's and is ignored. A row with
 * `"sentinel":true` only marks the goal set (`met:false`) or cleared without a
 * verdict (`met:true`, e.g. `/goal clear`): it never counts as met.
 */
export function goalVerdictsFromRows(lines: readonly string[]): GoalVerdict[] {
  const verdicts: GoalVerdict[] = []
  for (const line of lines) {
    const row = parseRow(line)
    if (!row || row.type !== 'attachment') continue
    const attachment = row.attachment as Record<string, unknown> | null | undefined
    if (!attachment || typeof attachment !== 'object' || attachment.type !== 'goal_status') continue
    if (typeof attachment.met !== 'boolean' || typeof attachment.condition !== 'string') continue
    verdicts.push({ met: attachment.met && attachment.sentinel !== true, condition: attachment.condition })
  }

  return verdicts
}

/** The last verdict for this condition decides. None yet, or not met, is still active. */
export function goalState(verdicts: readonly GoalVerdict[], condition: string): 'achieved' | 'active' {
  const matching = verdicts.filter(verdict => verdict.condition === condition)
  const last = matching[matching.length - 1]

  return last?.met === true ? 'achieved' : 'active'
}

const IDENTITY_KEYS: Record<string, string> = {
  'custom-title': 'customTitle',
  'agent-name': 'agentName',
  'agent-color': 'agentColor',
}

/** The color names a session can carry (the same keys as agent-fleet's SESSION_COLORS; not imported across mods). */
const SESSION_COLOR_NAMES: Record<string, true> = {
  red: true,
  blue: true,
  green: true,
  yellow: true,
  purple: true,
  orange: true,
  pink: true,
  cyan: true,
}

/** Whether a phase is the one where the run follows the session to its new id: only its own /clear restart. */
export function followsNewSessionId(phase: Phase): boolean {
  return phase === 'restarting'
}

/**
 * The session's name and color from whole transcript lines, only from
 * top-level identity rows, the last of each kind winning: /rename's title,
 * else the agent name.
 */
export function identityFromRows(lines: readonly string[]): { name: string | null; color: string | null } {
  const last: Record<string, string> = {}
  for (const line of lines) {
    const row = parseRow(line)
    const kind = typeof row?.type === 'string' ? row.type : ''
    const key = IDENTITY_KEYS[kind]
    if (!row || !key) continue
    const value = row[key]
    if (typeof value !== 'string' || !value) continue
    if (kind === 'agent-color' && !Object.hasOwn(SESSION_COLOR_NAMES, value)) continue
    last[kind] = value
  }

  return { name: last['custom-title'] ?? last['agent-name'] ?? null, color: last['agent-color'] ?? null }
}

const MAX_SHOWN_VALUE = 80

/**
 * Control and invisible characters: every control (Cc), format (Cf: bidi
 * marks, zero-width, soft hyphen, tag characters) and the line and paragraph
 * separators (Zl, Zp).
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const INVISIBLE_ALL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
/** Line breaks and tabs: read as one space, so the words on either side stay apart. */
const LINE_BREAKS = /[\t\n\v\f\r\u{85}\u{2028}\u{2029}]+/gu

/** Trailing slashes off a path, in one linear pass (a regex backtracks on a long run). */
function trimTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 0 && path[end - 1] === '/') end--

  return path.slice(0, end)
}

/** A value shown to the model as data: control and invisible characters out, capped at `max` (a transcript value: MAX_SHOWN_VALUE), JSON-quoted. */
function quoteValue(value: string, max = MAX_SHOWN_VALUE): string {
  return JSON.stringify(value.replace(INVISIBLE_ALL, '').slice(0, max))
}

/**
 * Whether a handoff path the model gave is one autopilot may resume from: a
 * `.md` file under `<root>/thoughts/shared/handoffs/`, relative paths taken
 * against the root, no control characters, no `..` segment.
 */
export function isValidHandoffPath(root: string, path: string): boolean {
  if (!path || INVISIBLE.test(path)) return false
  if (path.split('/').includes('..')) return false
  if (!path.endsWith('.md')) return false
  const handoffs = `${trimTrailingSlashes(root)}/thoughts/shared/handoffs/`
  const absolute = resolveHandoffPath(root, path)

  return absolute.startsWith(handoffs) && absolute.length > handoffs.length
}

/** A handoff path as an absolute one: relative paths are taken against the root. */
export function resolveHandoffPath(root: string, path: string): string {
  if (path.startsWith('/')) return path

  return `${trimTrailingSlashes(root)}/${path}`
}

export function formatLeft(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 60) return `${minutes}m`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

function skillsLine(run: Run): string[] {
  if (run.skills.length === 0) return []

  return [
    `- Skills named in your role: ${run.skills.map(name => `/${name}`).join(', ')}. These are skills, not plain text: invoke them with the Skill tool wherever your role calls for them.`,
  ]
}

function identityLines(run: Run): string {
  return [
    `- Role and responsibilities: ${run.role}`,
    ...skillsLine(run),
    ...(run.goal ? [`- Goal (completion condition): ${run.goal}`] : []),
    `- Session name: ${run.name ? quoteValue(run.name) : '(none set)'}`,
    `- Session color: ${run.color ? quoteValue(run.color) : '(none set)'}`,
  ].join('\n')
}

const PAUSED_SECTION =
  '# Autopilot is paused\nThe person is in control. Follow their messages as usual; the autopilot rules do not apply until it resumes.'

const WAITING_SECTION =
  '# Autopilot is waiting\nAutopilot is parked until the 5-hour token window resets, and the person is in control meanwhile. Follow their messages as usual; the autopilot rules do not apply until it resumes.'

/** When the person is truly required: the same test for asking now and for queueing. */
const CRITICAL_WHEN =
  'an irreversible or outward-facing action, missing access or credentials, a decision outside your role, or something that blocks all useful work and that autopilot cannot decide'

const PLAIN_PERSON_LINE =
  '- Only when a question truly cannot wait for the person and blocks all useful work, call the PushNotification tool with a one-line question (under 200 characters), then continue with whatever else you can do.'

const ASK_PERSON_LINE = `- Only when the person is truly required — ${CRITICAL_WHEN} — call PushNotification with the one-line question, then call ${WAIT_TOOL} with reason user-answer (or user-input for an action the person must take) and the question as note, and end your turn. Everything else you decide yourself.`

/** The paused section, with the questions still queued for the person when there are any. */
function pausedSection(run: Run): string {
  const queued = questionsBlock(run)
  if (!queued) return PAUSED_SECTION

  return [PAUSED_SECTION, queued, 'Mention them to the person when it fits. An answer given here does not take a question off the queue; a run started again in this session keeps them and asks them one by one.'].join('\n')
}

/** The rule for questions that need the person, by mode. */
function personLines(run: Run, mode: Mode): string[] {
  if (mode === 'plain') return [PLAIN_PERSON_LINE]
  if (mode === 'asking') return [ASK_PERSON_LINE]
  if (mode === 'queueing' || mode === 'overdue') {
    return [
      `- The person cannot answer right now. Only when the person is truly required — ${CRITICAL_WHEN} — call ${QUEUE_TOOL} with the question, kind "answer" (or "action" for something the person must do) and, if you go on with a provisional choice meanwhile, that choice as provisional; then keep working on what is not blocked by it. Do not send a PushNotification per question and do not wait for the person: autopilot asks the queued questions when they are back. Everything else you decide yourself.`,
      `- If everything left is blocked by queued questions: call ${WAIT_TOOL} with reason other and from "the person (queued)", then end your turn.`,
    ]
  }
  const head = drainingQuestion(run)
  // Draining with an empty queue does not last: ask as usual meanwhile.
  if (!head) return [ASK_PERSON_LINE]

  return [
    `- The person is back and answers the queued questions one at a time. ${askQuestionText(head)}`,
    `- A new question that truly needs the person (${CRITICAL_WHEN}): call ${QUEUE_TOOL} instead of asking it now; autopilot asks it after the queued ones. Everything else you decide yourself.`,
  ]
}

/**
 * The system prompt section pinned while a run is on; survives /clear. The
 * mode decides how questions for the person are handled; without one, the
 * run's own --ask-user flag picks asking or plain, as before.
 */
export function roleSection(run: Run, now: number, mode: Mode = run.askUser === true ? 'asking' : 'plain'): string {
  // Parked or stalled: the person may be back, and the away rules must not override them.
  if (run.phase === 'paused') return pausedSection(run)
  if (run.phase === 'waiting') return WAITING_SECTION
  const mayNeedPerson = mode === 'asking' || mode === 'draining'
  // Asking or draining, the person can be reached: the section must not say they are away.
  const heading = mayNeedPerson ? '# Autopilot: you are working on your own; the person answers critical questions' : '# Autopilot: you are working while the person is away'
  const rulesTitle = mayNeedPerson ? 'Rules while you work on your own:' : 'Rules while the person is away:'

  return [
    heading,
    'The person started this run with /autopilot. These lines are their instructions about who you are.',
    identityLines(run),
    `- Time left: ${formatLeft(run.until - now)}; context threshold ${run.threshold}%; restarts used ${restartsText(run)}.`,
    ...(run.handoffPath
      ? [`- Latest handoff: ${JSON.stringify(run.handoffPath)}. If you do not know where you are, read it and continue from there; never start the work over.`]
      : []),
    rulesTitle,
    '- Ordinary questions: decide yourself within your role, prefer the reversible option, and record the decision (question, options, choice, why) for your handoff.',
    '- Permissions stay exactly as they are. If an action is denied or needs the person (a push, a commit, anything the permission mode blocks), never retry it another way to get around the denial: note it as deferred until the person returns, and continue with other work.',
    ...personLines(run, mode),
    `- When you hand work to another session, a subagent, a workflow or a background task${mayNeedPerson ? ', or need the person' : ''}, and nothing else useful is left for you: call the ${WAIT_TOOL} tool with the reason (and who from), then end your turn. Do not invent work while waiting and do not poll; any incoming message wakes you. Autopilot will not nudge you meanwhile.`,
    ...(run.phase === 'awaiting' && run.awaiting ? [`- Right now you are waiting: ${waitText(run.awaiting, now)}.`] : []),
    '- You may refine the goal of the next stage. You may never change your purpose, role or responsibilities.',
    '- Ending this session is autopilot\'s call, not yours: never write a handoff or wind down on your own. Autopilot tells you when (context threshold, time, limits) and how. A previous handoff saying a session ended means that session, not this one: keep working.',
  ].join('\n')
}

export function kickoffPrompt(run: Run, now: number): string {
  return [
    `Autopilot is on for ${formatLeft(run.until - now)}. Your role:`,
    run.role,
    ...skillsLine(run),
    ...(run.goal ? [`Goal: ${run.goal}`] : []),
    'Work toward your goal now. Start by stating in two lines what you will do first, then do it.',
  ].join('\n')
}

/** The line a session answers with when everything its role covers is done. */
export const DONE_MARKER = 'AUTOPILOT_DONE'

export const CONTINUE_PROMPT = `Autopilot: keep going toward your goal within your role. If the current stage is done, pick the next most valuable step within your role and do it. Deferred actions wait for the person. If everything your role covers is complete and no valuable step is left, do not invent work: answer with the line ${DONE_MARKER} and a one-line reason. If you are waiting for another session, a subagent, a workflow or the person, call ${WAIT_TOOL} instead of working around it.`

/** Whether a turn's answer declares the role's work complete: the marker opens a line, never mid-sentence. */
export function isDoneAnswer(answer: string): boolean {
  // Spaces and tabs only: `\s` would match line breaks too and backtrack quadratically on blank lines.
  return /^[ \t]*AUTOPILOT_DONE\b/m.test(answer)
}

/** The queued questions for a handoff: the instruction and the list, or nothing when the queue is empty. */
function handoffQuestionLines(run: Run): string[] {
  const queued = questionsBlock(run)
  if (!queued) return []

  return ['   Also list these queued questions in the handoff, unanswered, for the person:', queued]
}

export function wrapupPrompt(run: Run, percent: number | null): string {
  return [
    `Autopilot: the context has reached the handoff point (${percent ?? run.threshold}%). Finish this session gracefully, before auto-compact:`,
    '1. Stop at the right moment: finish or safely park the step in progress. Start nothing new.',
    '2. Use the /create-handoff-doc skill. Put this block at the very top of the handoff, verbatim, as the initial prompt of the next session, marked as important and not to be ignored:',
    identityLines(run),
    '   Then: the goal of the next stage (you may refine it), what is done, what is next, the decisions you made yourself, and the deferred actions waiting for the person.',
    ...handoffQuestionLines(run),
    `3. Call ${RESTART_TOOL} with {"handoffPath": "<path to the handoff .md>"}. It clears this session and resumes from the handoff.`,
  ].join('\n')
}

const FINAL_OPENING: Record<FinalReason, (run: Run) => string> = {
  time: () => 'Autopilot: the autonomous time is over. Finish gracefully and hand back to the person:',
  restarts: run => `Autopilot: the restart limit (${restartsText(run)}) is reached. Finish gracefully and hand back to the person:`,
  goal: run => `Autopilot: the goal is achieved (${run.goal ?? ''}). Finish gracefully and hand back to the person:`,
  done: () => 'Autopilot: you reported the work your role covers as complete. Finish gracefully and hand back to the person:',
  week: run =>
    `Autopilot: ABSOLUTE STOP: the weekly token limit has reached ${run.weekStop}% used. Stop all work now and hand back to the person:`,
}

export function finalPrompt(run: Run, reason: FinalReason): string {
  return [
    FINAL_OPENING[reason](run),
    '1. Finish or safely park the step in progress. Start nothing new.',
    '2. Use the /create-handoff-doc skill, with this block at the top, verbatim:',
    identityLines(run),
    '   Then: what is done, what is next, the decisions you made yourself, and the deferred actions waiting for the person.',
    ...handoffQuestionLines(run),
    ...(reason === 'week'
      ? [
          `3. Call the PushNotification tool once: "Autopilot stopped: weekly token limit at ${run.weekStop}%. Handoff written, waiting for you."`,
          `4. Do NOT call ${RESTART_TOOL}. End with a short summary for the person.`,
        ]
      : [`3. Do NOT call ${RESTART_TOOL}. End with a short summary for the person.`]),
  ].join('\n')
}

export function waitPrompt(run: Run, waitUntil: number): string {
  return [
    `Autopilot: the 5-hour token window has reached ${run.fiveHourStop}% used. Park now:`,
    '1. Finish or safely park the step in progress so nothing is left half-done. Start nothing new.',
    `2. Write two lines on where you stopped and what comes next, then end your turn. Autopilot resumes you after the window resets (about ${new Date(waitUntil).toISOString().slice(11, 16)} UTC). No handoff, no restart.`,
  ].join('\n')
}

export const RESUME_AFTER_WAIT_PROMPT =
  'Autopilot: the 5-hour token window has reset. Continue from where you parked, within your role.'

/** The answer an AskUserQuestion gets while the person is away. */
export const ASK_ANSWER =
  'The person is away (autopilot). Decide this yourself within your role, prefer the reversible option, record the decision for the handoff, and continue. If it truly cannot wait and blocks all useful work, send one PushNotification with the question and continue with other work.'

/**
 * The AskUserQuestion answer for this mode; always a deny. Asking points to
 * the critical-only wait; while the person cannot answer, or while queued
 * questions are being asked one by one, a critical question goes to the queue.
 */
export function askAnswer(mode: Mode): string {
  if (mode === 'plain') return ASK_ANSWER
  if (mode === 'asking') {
    return `${ASK_ANSWER} If the person is truly required (see your rules), use PushNotification and ${WAIT_TOOL} user-answer instead of asking here.`
  }

  return `AskUserQuestion is not used under autopilot. Decide this yourself within your role, prefer the reversible option, record the decision for the handoff, and continue. If the person is truly required (see your rules), call ${QUEUE_TOOL} with the question and keep working on what is not blocked by it; autopilot asks the queued questions one by one.`
}

/** What the model reads after an action the permission mode refused. */
export const DEFERRED_NOTE =
  'Autopilot: this action was refused by the permission mode. Do not try to get around it. It is logged as deferred until the person returns; put it in your handoff and continue with other work.'

/** How far ahead of now a record's `setAt` may lie (two processes' clocks differ a little); further is a broken or forged write. */
const MAX_SET_AT_AHEAD_MS = 5 * 60_000

/** A record timestamp: a whole, non-negative number at most MAX_SET_AT_AHEAD_MS after now. */
function isSetAt(value: unknown, now: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= now + MAX_SET_AT_AHEAD_MS
}

/** A stored `away` field: null when not set, false when malformed. */
function awayField(value: unknown, now: number): AwayField | null | false {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return false
  const { until, back, setAt } = value as { until?: unknown; back?: unknown; setAt?: unknown }
  if (!isSetAt(setAt, now)) return false
  if (back !== undefined) return back === true ? { back: true, setAt } : false
  // An away this code writes ends between MIN_LEAD_MS and MAX_AHEAD_MS after it was set (awayUntil): anything else is not ours.
  if (typeof until !== 'number' || !Number.isInteger(until)) return false
  if (until < setAt || until - setAt > MAX_AHEAD_MS) return false

  return { until, setAt }
}

/** A stored `askUser` field: null when not set, false when malformed. */
function askField(value: unknown, now: number): { on: boolean; setAt: number } | null | false {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object') return false
  const { on, setAt } = value as { on?: unknown; setAt?: unknown }
  if (!isSetAt(setAt, now)) return false
  if (typeof on !== 'boolean') return false

  return { on, setAt }
}

/**
 * A stored availability record, or null when it is not one: wrong shape, a
 * version other than 1, or a `setAt` more than 5 minutes ahead of now. A
 * missing `away` or `askUser` reads as not set; only known fields are kept.
 */
export function validAvail(value: unknown, now: number): Avail | null {
  if (typeof value !== 'object' || value === null) return null
  const fields = value as { v?: unknown; away?: unknown; askUser?: unknown }
  if (fields.v !== 1) return null
  const away = awayField(fields.away, now)
  if (away === false) return null
  const askUser = askField(fields.askUser, now)
  if (askUser === false) return null

  return { v: 1, away, askUser }
}

/**
 * The global record after reading global.json: the file's record when it is
 * whole and valid; otherwise (missing, empty, half-written, wrong shape, set
 * in the future) the last good one, so a bad read never changes the status.
 */
export function globalFromText(text: string | null, now: number, last: Avail | null): Avail | null {
  if (text === null) return last
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return last
  }

  return validAvail(value, now) ?? last
}

/**
 * The status in force, per field (R5): the session record wins over the
 * global one even when older. Ask-user without a record anywhere falls back
 * to the run's --ask-user flag.
 */
export function effective(run: Run | null, session: Avail | null, global: Avail | null): Effective {
  const sessionAway = session?.away ?? null
  const away = sessionAway ?? global?.away ?? null
  const askUser = session?.askUser ?? global?.askUser ?? null

  return {
    away,
    awaySource: sessionAway ? 'session' : away ? 'global' : null,
    askOn: askUser ? askUser.on : run?.askUser === true,
    askRecorded: askUser !== null,
    askSetAt: askUser?.setAt ?? null,
  }
}

/** Whether an `until` away is still running; /back and no away are not. */
export function isAwayActive(away: AwayField | null, now: number): boolean {
  return away !== null && 'until' in away && now < away.until
}

/** Whether an `until` away has reached its end; /back and no away have not. */
export function isAwayExpired(away: AwayField | null, now: number): boolean {
  return away !== null && 'until' in away && now >= away.until
}

/** Whether the person turned asking on after the away ended: they are here, so nothing is overdue (R12). */
function isAskedSinceAway(eff: Effective): boolean {
  const away = eff.away
  if (!away || !('until' in away)) return false
  const askSetAt = eff.askSetAt ?? null

  return askSetAt !== null && askSetAt >= away.until
}

/** The run's mode: an ordered list, the first match wins (spec §4). */
export function availMode(run: Run, eff: Effective, now: number): Mode {
  if (!eff.askRecorded && run.askUser !== true) return 'plain'
  if (!eff.askOn) return 'queueing'
  if (isAwayActive(eff.away, now)) return 'queueing'
  const hasQuestions = (run.questions?.length ?? 0) > 0
  if (run.drain === true && hasQuestions) return 'draining'
  if (isAwayExpired(eff.away, now) && hasQuestions && !isAskedSinceAway(eff)) return 'overdue'

  return 'asking'
}

const AWAY_USAGE =
  'Usage: /away for <duration> [--global] (90m, 2h, 1h30m)  ·  /away until <clock> [--global] (15:00, 6pm, local time)'
const AWAY_CLOCK_TEXT = 'Give the time as HH:MM (24-hour) or with am/pm, e.g. /away until 15:00 or /away until 6pm (local time).'
const AWAY_TOO_SOON_TEXT = 'The away time must end at least 1 minute from now.'
const AWAY_TOO_FAR_TEXT = 'The away time can be at most 7 days from now.'
const BACK_USAGE = 'Usage: /back [--global]'
const ASK_USER_USAGE = 'Usage: /ask-user on|off [--global]'

type AwayEnd = Extract<AvailCommand, { kind: 'away' }>['end']

/** `/away` arguments: `for <duration>` or `until <clock>`, with `--global` anywhere. A bare /away is an error (R3). */
export function parseAway(args: string): AvailCommand {
  const scope = takeSwitch(args.trim(), 'global')
  const match = /^(for|until)\s+(\S+)$/i.exec(scope.rest)
  if (!match) return { kind: 'error', message: AWAY_USAGE }
  const [, word = '', raw = ''] = match
  if (word.toLowerCase() === 'until') {
    const clock = parseClock(raw)
    if (!clock) return { kind: 'error', message: AWAY_CLOCK_TEXT }

    return { kind: 'away', end: { kind: 'clock', ...clock }, global: scope.isOn }
  }
  const ms = parseDuration(raw)
  if (ms === null || ms <= 0) return { kind: 'error', message: `Cannot read the time "${echoed(raw)}" (try 90m, 2h, 1h30m).` }

  return { kind: 'away', end: { kind: 'duration', ms }, global: scope.isOn }
}

/** `/back` arguments: nothing but an optional `--global`. */
export function parseBack(args: string): AvailCommand {
  const scope = takeSwitch(args.trim(), 'global')
  if (scope.rest) return { kind: 'error', message: BACK_USAGE }

  return { kind: 'back', global: scope.isOn }
}

/** `/ask-user` arguments: `on` or `off`, with `--global` anywhere. */
export function parseAskUser(args: string): AvailCommand {
  const scope = takeSwitch(args.trim(), 'global')
  const match = /^(on|off)$/i.exec(scope.rest)
  if (!match) return { kind: 'error', message: ASK_USER_USAGE }

  return { kind: 'ask-user', on: match[1]?.toLowerCase() === 'on', global: scope.isOn }
}

/**
 * When an away ends: a duration from now, or the next local `hours:minutes`
 * on the clock `offsetMinutes` east of UTC (the session's offset now; see
 * untilFromClock about DST). An error text when it lands under MIN_LEAD_MS
 * or beyond MAX_AHEAD_MS from now.
 */
export function awayUntil(end: AwayEnd, now: number, offsetMinutes: number): number | string {
  const until = end.kind === 'duration' ? now + end.ms : untilFromClock(end.hours, end.minutes, now, offsetMinutes)
  if (until - now < MIN_LEAD_MS) return AWAY_TOO_SOON_TEXT
  if (until - now > MAX_AHEAD_MS) return AWAY_TOO_FAR_TEXT

  return until
}

/**
 * The record after a command: `/away` sets `away` to its end, `/back` sets
 * `away` to back, `/ask-user` sets `askUser`; the other field stays. The
 * caller picks the record by scope (`global`). Never changes `rec` in place.
 */
export function applyAvail(
  rec: Avail | null,
  cmd: Exclude<AvailCommand, { kind: 'error' }>,
  until: number | null,
  now: number,
): Avail {
  const base: Avail = { v: 1, away: rec?.away ?? null, askUser: rec?.askUser ?? null }
  if (cmd.kind === 'ask-user') return { ...base, askUser: { on: cmd.on, setAt: now } }
  if (cmd.kind === 'back') return { ...base, away: { back: true, setAt: now } }
  // An away whose end awayUntil refused: nothing to write.
  if (until === null) return base

  return { ...base, away: { until, setAt: now } }
}

/** The question a drain asks now: the head of the queue; null when the queue is empty. */
export function drainingQuestion(run: Run): Question | null {
  return run.questions?.[0] ?? null
}

/** What queue_question returns to the model; says when the text was cut, and warns once the queue is past its soft limit. */
export function queuedResult(id: number, warn: boolean, cut = false): string {
  const parts = [`Queued #${id}. Keep working on what is not blocked by it.`]
  if (cut) parts.push(`Your text was cut to ${MAX_QUESTION} characters (the provisional to ${MAX_PROVISIONAL}); the person reads only what was kept, so keep queued questions short.`)
  if (warn) parts.push(`The queue holds more than ${QUEUE_WARN} questions: queue only what truly needs the person.`)

  return parts.join(' ')
}

/** "7 critical questions are queued across 3 sessions" / "… across 1 session": the combined count (ping and toast). */
export function queuedAcross(total: number, sessions: number): string {
  return `${criticalCount(total)} queued across ${sessions} session${sessions === 1 ? '' : 's'}`
}

/** The one ping for all sessions when a global away ends with questions queued (R9). */
export function combinedPingText(total: number, sessions: number): string {
  return `Autopilot: the global away time is over; ${queuedAcross(total, sessions)}. Send one PushNotification saying so (under 200 characters), then keep working without asking until the person writes in this session.`
}

/** The unanswered queue as a list for the pause, wrap-up and final texts (D2); empty when nothing is queued. */
export function questionsBlock(run: Run): string {
  const questions = run.questions ?? []
  if (questions.length === 0) return ''

  return [
    `Critical questions queued for the person, still unanswered (${questions.length}):`,
    ...questions.map(question => {
      const meanwhile = question.provisional ? `; meanwhile: ${quoteValue(question.provisional, MAX_PROVISIONAL)}` : ''

      return `- #${question.id} (${question.kind}) ${quoteValue(question.text, MAX_QUESTION)}${meanwhile}`
    }),
  ].join('\n')
}

const MODE_TEXT: Record<Mode, string> = {
  plain: 'no asking and no queue (run without --ask-user)',
  queueing: 'queues critical questions and keeps working',
  overdue: 'away is over; queued questions wait until you write in this session',
  draining: 'asking the queued questions one by one',
  asking: 'asks you critical questions',
}

/** The away line of the status: until when, or back, or ended; with its source and age. */
function awayLine(eff: Effective, now: number, offsetMinutes: number | null): string {
  const away = eff.away
  if (!away) return 'Away: not set'
  const source = `${eff.awaySource ?? 'session'}, set ${formatLeft(now - away.setAt)} ago`
  if ('back' in away) return `Away: no, back (${source})`
  if (isAwayActive(away, now)) return `Away: until ${endClock(away.until, offsetMinutes)}, ${formatLeft(away.until - now)} left (${source})`

  return `Away: ended at ${endClock(away.until, offsetMinutes)} (${source})`
}

/**
 * The availability lines of a status or command reply: away, ask-user and
 * where each comes from; with a run, also the mode and the queue size.
 */
export function availStatusLines(
  eff: Effective,
  mode: Mode | null,
  run: Run | null,
  now: number,
  offsetMinutes: number | null,
): string[] {
  const askSource = eff.askRecorded ? 'set by /ask-user' : run?.askUser === true ? 'run started with --ask-user' : 'not set'
  const lines = [awayLine(eff, now, offsetMinutes), `Asks the person: ${eff.askOn ? 'on' : 'off'} (${askSource})`]
  if (mode) lines.push(`Mode: ${mode}, ${MODE_TEXT[mode]}`)
  if (run) lines.push(`Queued questions: ${(run.questions ?? []).length}`)

  return lines
}

/** How often the heartbeat runs in register.tsx; the combined ping measures liveness and lock age in beats. */
export const HEARTBEAT_MS = 30_000

/** Modes in which a global away is over and asking is on: the ones a combined ping may reach. */
const COMBINED_MODES: readonly Mode[] = ['overdue', 'draining', 'asking']

/**
 * Whether this session takes part in the combined ping for the global away
 * set at `globalSetAt`: a live run (`running` or `awaiting`) whose effective
 * away is that global record, with asking on and the away over. No run, a
 * session-sourced away, another global away, asking off (D4) or a plain run
 * (D5) never is, so such a session is never sent a prompt.
 */
export function eligibleForCombined(run: Run | null, eff: Effective, mode: Mode | null, globalSetAt: number): boolean {
  if (!run || mode === null) return false
  if (run.phase !== 'running' && run.phase !== 'awaiting') return false
  if (eff.awaySource !== 'global' || !eff.away || !('until' in eff.away)) return false
  if (eff.away.setAt !== globalSetAt || !eff.askOn) return false

  return COMBINED_MODES.includes(mode)
}

/**
 * Queued questions across sessions on the global away set at `setAt`: only
 * badges with that away, a heartbeat within two beats (dead sessions do not
 * count) and at least one question. `sessions` counts those badges.
 */
export function sumQueued(badges: readonly BadgeAvail[], setAt: number, now: number): { total: number; sessions: number } {
  let total = 0
  let sessions = 0
  for (const badge of badges) {
    if (badge.awaySource !== 'global' || badge.awaySetAt !== setAt) continue
    if (now - badge.beat > 2 * HEARTBEAT_MS) continue
    // Whole questions only: a broken badge with 0.5 adds no session it has no question for.
    const queued = Number.isFinite(badge.queued) ? Math.floor(badge.queued) : 0
    if (queued <= 0) continue
    total += queued
    sessions++
  }

  return { total, sessions }
}

/**
 * Whether another eligible session may take over a combined-ping lock: never
 * once `done` is written; yes when `owner.json` is missing or unreadable, or
 * its owner has not refreshed it for more than two heartbeats.
 */
export function lockStale(owner: LockOwner | null, done: boolean, now: number): boolean {
  if (done) return false
  if (!owner) return true

  return now - owner.at > 2 * HEARTBEAT_MS
}

/**
 * The away fields of one fleet badge file (`<session id>.json`), for the
 * combined ping. A badge written before 0.5.0, an off badge or anything
 * malformed is null: it counts no questions.
 */
export function parseBadgeAvail(value: unknown): BadgeAvail | null {
  if (typeof value !== 'object' || value === null) return null
  const badge = value as Record<string, unknown>
  if (badge.isOn !== true) return null
  const { queued, awaySource, awaySetAt, beat } = badge
  if (typeof queued !== 'number' || !Number.isFinite(queued)) return null
  if (!Number.isInteger(queued) || queued < 0 || queued > 10_000) return null
  if (typeof beat !== 'number' || !Number.isFinite(beat)) return null
  if (awaySource !== 'session' && awaySource !== 'global' && awaySource !== null) return null
  if (awaySetAt !== null && (typeof awaySetAt !== 'number' || !Number.isFinite(awaySetAt))) return null

  return { queued, awaySource, awaySetAt, beat }
}

/** The `owner.json` of a combined-ping lock; null when missing fields or malformed (the lock is then stale). */
export function parseLockOwner(value: unknown): LockOwner | null {
  if (typeof value !== 'object' || value === null) return null
  const { sid, at } = value as Record<string, unknown>
  if (typeof sid !== 'string' || sid === '' || sid.length > 128) return null
  if (typeof at !== 'number' || !Number.isFinite(at)) return null

  return { sid, at }
}
