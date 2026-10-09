/**
 * Where an autopilot run stands:
 * - running: working toward the goal, nudged on after every turn
 * - wrapping: past the context threshold, writing a handoff before a restart
 * - restarting: the restart tool was called; /clear is queued behind the turn
 * - resuming: /resume-handoff-doc was issued; its turn ending means resumed
 * - waiting: the 5-hour token window is nearly used up; parked until it resets
 * - final: time, restarts, the weekly limit or the goal: a last handoff, no restart
 * - paused: stalled twice in a row; waits for the person
 * - awaiting: the session declared it waits for something (wait_for); not nudged until a new turn starts
 */
export type Phase = 'running' | 'wrapping' | 'restarting' | 'resuming' | 'waiting' | 'final' | 'paused' | 'awaiting'

/** What a session waits for when it calls wait_for. */
export type WaitReason =
  | 'user-input'
  | 'user-answer'
  | 'session-answer'
  | 'session-ping'
  | 'workflow-end'
  | 'subagent-result'
  | 'background-task'
  | 'other'

/** A wait the session declared: what for, from whom, since when, and when autopilot checks on it. */
export type Awaiting = {
  reason: WaitReason
  /** Who the answer comes from (a session name, a subagent); null when not given. */
  from: string | null
  note: string | null
  since: number
  /** When autopilot asks once whether the wait is stuck; null for never. */
  timeoutAt: number | null
  /** Whether that check was already sent. */
  pinged: boolean
}

export type FinalReason = 'time' | 'restarts' | 'week' | 'goal' | 'done'

/** One autopilot run, kept in $.store under `run:<session id>`. */
export type Run = {
  role: string
  /** The session's /rename name and /color at the start, so a handoff keeps them. */
  name: string | null
  color: string | null
  startedAt: number
  until: number
  threshold: number
  /** null: as many restarts as the time allows. */
  maxRestarts: number | null
  restarts: number
  phase: Phase
  /** The handoff a queued restart resumes from. */
  handoffPath: string | null
  /** Turns in a row that called no tool. */
  idleTurns: number
  /** The /goal condition the run sets and keeps set across /clear; null for none. */
  goal: string | null
  /** Skills the role names (`/explore`), confirmed against the session's commands. */
  skills: string[]
  /** Park at this % of the 5-hour token window and resume after it resets. */
  fiveHourStop: number
  /** Stop for good at this % of the weekly token window. */
  weekStop: number
  /** While waiting: when the 5-hour window resets (plus a margin). */
  waitUntil: number | null
  /** Why the run is in its final phase. */
  finalReason: FinalReason | null
  /** The wait the session declared; null when not waiting. Missing in runs stored by older versions. */
  awaiting: Awaiting | null
  /** Whether questions go to the person (--ask-user) instead of being answered by autopilot. Missing in older runs. */
  askUser: boolean
}

export type StartCommand = {
  kind: 'start'
  durationMs: number
  threshold: number
  maxRestarts: number | null
  role: string
  goal: string | null
  fiveHourStop: number
  weekStop: number
  askUser: boolean
}

export type Command =
  | { kind: 'status' }
  | { kind: 'stop' }
  | StartCommand
  | { kind: 'error'; message: string }

/** A token window as `$.session.usage().rateLimits` reports it. */
export type TokenWindow = { kind: string; percentUsed: number; resetsAt?: string }
