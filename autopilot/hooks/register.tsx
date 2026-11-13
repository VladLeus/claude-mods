import type { EngineInterface, Register } from 'claude-code'

import type { Avail, AvailCommand, BadgeAvail, Effective, FinalReason, FinishedRecord, LockOwner, Mode, Pending, Run, TokenWindow } from '../types'
import {
  ASKING_QUEUE_REFUSAL,
  CONTINUE_PROMPT,
  DEFAULT_CEILING,
  DEFERRED_NOTE,
  FULL_QUEUE_TOOL,
  FULL_WAIT_TOOL,
  HEARTBEAT_MS,
  NOT_RUNNING_TEXT,
  QUEUE_TOOL,
  QUEUE_WARN,
  RESTART_TOOL,
  RESUME_AFTER_WAIT_PROMPT,
  WAIT_REASONS,
  WAIT_TOOL,
  addQuestion,
  afterTurn,
  answeredQuestion,
  applyAvail,
  applyMode,
  askAnswer,
  autoAnswersQuestions,
  availMode,
  availStatusLines,
  awayUntil,
  canDeliver,
  combinedPingText,
  criticalCount,
  deliveredPending,
  drainingQuestion,
  effective,
  effectiveTrigger,
  eligibleForCombined,
  endClock,
  endsWait,
  finalPrompt,
  followsNewSessionId,
  formatLeft,
  globalFromText,
  goalState,
  goalVerdictsFromRows,
  graceResumePrompt,
  graceHandoffCheck,
  graceStatusText,
  graceTurnAction,
  handoffArg,
  humanSubmit,
  identityFromRows,
  isDoneAnswer,
  isGraceEligible,
  isGraceLive,
  isLiveFinishedValue,
  isPermissionDeny,
  isValidHandoffPath,
  kickoffPrompt,
  limitAction,
  lockStale,
  namedSkills,
  parseAskUser,
  parseAway,
  parseBack,
  parseBadgeAvail,
  parseCommand,
  parseLockOwner,
  parseQueueInput,
  parseUtcOffset,
  parseWaitInput,
  passesQuestion,
  pushPending,
  questionIdFromNote,
  questionsBlock,
  queuedAcross,
  queuedResult,
  removesDrainedQuestion,
  resolveHandoffPath,
  restartsText,
  retime,
  revivePrompt,
  roleSection,
  shouldDropStopBlock,
  sumQueued,
  targetChange,
  triggerCeiling,
  untilFromClock,
  validAvail,
  waitPhaseRefusal,
  waitPrompt,
  waitRefusal,
  waitText,
  waitTimeoutPrompt,
  wrapMidTurn,
  wrapupPrompt,
} from './autopilot'

const FULL_RESTART_TOOL = 'mcp__autopilot__restart_session'
/** With a goal, the goal loop starts the next turn; if none starts within this, autopilot looks why. */
const GOAL_IDLE_MS = 20_000

let run: Run | null = null
let sessionId = ''
// Empty when HOME is unset: then no state or log file is written at all.
let home = ''
let isTurnRunning = false
let toolsThisTurn = 0
// Counts main turns, so a delayed check can tell whether a new turn started meanwhile.
let turnSeq = 0
// Whether this run's /goal is set right now (/clear removes it; autopilot sets it again).
let isGoalSet = false
// The highest context % a handoff may wait for, below auto-compact.
let ceiling = DEFAULT_CEILING
// The text of a pending submit that is scheduled and not yet answered; a second one waits for it.
let flushingText: string | null = null
// Toasts already shown: held pings (`kind:key`) and global-away toasts (`global:<setAt>`), so each shows once, not every heartbeat.
const heldToasts = new Set<string>()
/** Global away `setAt`s whose combined ping this module handed to the model: never pushed again, even when writing `done` failed. */
const deliveredCombined = new Set<number>()
// Whether the prompt that starts the next turn is the person's answer during a drain.
// A reload resets it: no question leaves the queue until this module sees the person write.
let lastSubmitHuman = false
// The availability records as last read: this session's ($.store) and the global one (global.json).
let sessionAvail: Avail | null = null
let globalAvail: Avail | null = null
// global.json's mtime at the last read; the heartbeat re-reads it only when this changes.
let globalMtime: number | null = null
// When the badge last carried a heartbeat time.
let lastBeat = 0

/**
 * Reads the session's auto-compact threshold and sets the ceiling below it.
 * The trigger compares against `context.percent`, which is over the model's
 * window, so the threshold is measured on that window too, never on the
 * smaller compaction window (`autoCompactWindow`) the breakdown counts in.
 */
async function readCeiling($: EngineInterface): Promise<number> {
  const usage = await $.session.usage({ breakdown: 'summary' }).catch(() => null)
  const breakdown = usage?.context.breakdown
  ceiling = triggerCeiling(
    breakdown?.isAutoCompactEnabled ? breakdown.autoCompactThreshold : undefined,
    usage?.context.window,
  )

  return ceiling
}

const storeKey = (id: string) => `run:${id}`
const finishedKey = (id: string) => `finished:${id}`
const availKey = (id: string) => `away:${id}`

/** The record of a run that finished on time or restarts, while the grace period lasts; an expired one is deleted. */
async function loadFinished($: EngineInterface, now: number): Promise<FinishedRecord | null> {
  if (!sessionId) return null
  const record = ((await $.store.get(finishedKey(sessionId))) as FinishedRecord | undefined) ?? null
  if (!record) return null
  if (isGraceLive(record, now)) return record
  await $.store.delete(finishedKey(sessionId)).catch(() => undefined)

  return null
}

/** A combined-ping lock lives this long; then the sweep removes it. */
const LOCK_TTL_MS = 24 * 60 * 60_000

/** Deletes every finished-run record, of any session, that is past its grace period or malformed, and old combined-ping locks. */
async function sweepFinished($: EngineInterface): Promise<void> {
  const now = await $.clock.now()
  for (const key of await $.store.keys()) {
    if (!key.startsWith('finished:')) continue
    const value = await $.store.get(key)
    if (!isLiveFinishedValue(value, now)) await $.store.delete(key)
  }
  if (!home) return
  const entries = await $.fs.list(statusDir()).catch(() => [])
  for (const entry of entries) {
    if (!/^ping-\d+\.lock$/.test(entry.name)) continue
    const path = `${statusDir()}/${entry.name}`
    if (entry.kind !== 'dir') {
      // A file or a link under a lock's name is not ours and blocks the combined ping for good.
      await $.process.run(['/bin/rm', '-f', '--', path]).catch(() => undefined)
      continue
    }
    // A list entry's mtimeMs is 0 for a directory, so stat it; a failed stat or a missing mtime keeps the lock.
    const stat = await $.fs.stat(path).catch(() => null)
    if (!stat || !(now - stat.mtimeMs >= LOCK_TTL_MS)) continue
    await $.process.run(['/bin/rm', '-rf', '--', path]).catch(() => undefined)
  }
}

const autopilotDir =() => `${home}/.claude/autopilot`
const statusDir = () => `${autopilotDir()}/status`
const globalFile = () => `${statusDir()}/global.json`

/** The machine's UTC offset in minutes east of UTC (`date +%z`); null when it cannot be read. */
async function utcOffset($: EngineInterface): Promise<number | null> {
  try {
    const result = await $.process.run(['/bin/date', '+%z'])

    return parseUtcOffset(result.stdout)
  } catch {
    return null
  }
}

/** This session's availability record, read again from the store; null when none or malformed. */
async function readSessionAvail($: EngineInterface): Promise<Avail | null> {
  if (!sessionId) {
    sessionAvail = null
    return null
  }
  const value = await $.store.get(availKey(sessionId)).catch(() => undefined)
  sessionAvail = validAvail(value, await $.clock.now())

  return sessionAvail
}

async function writeSessionAvail($: EngineInterface, rec: Avail): Promise<void> {
  if (!sessionId) return
  await $.store.set(availKey(sessionId), rec)
  sessionAvail = rec
}

/**
 * The global record. Re-read only when global.json changed (or `force`); a
 * missing, empty, half-written or future-dated file keeps the last good value.
 * Never throws.
 */
async function readGlobalAvail($: EngineInterface, force = false): Promise<Avail | null> {
  if (!home) return globalAvail
  const stat = await $.fs.stat(globalFile()).catch(() => null)
  if (!stat) return globalAvail
  if (!force && stat.mtimeMs === globalMtime) return globalAvail
  const isFirstRead = globalMtime === null
  const text = await $.fs.read(globalFile()).catch(() => null)
  const previous = globalAvail
  globalAvail = globalFromText(text, await $.clock.now(), globalAvail)
  globalMtime = stat.mtimeMs
  // A change this session did not write (another session's --global, or anything else that
  // wrote the file): the person sees it, not only the log.
  if (!isFirstRead && JSON.stringify(previous) !== JSON.stringify(globalAvail)) {
    $.ui.toast(`Autopilot: the global away/ask-user status changed outside this session (${globalFile()}); /autopilot shows it.`)
    await log($, `global status changed outside this session: ${JSON.stringify(globalAvail)}`)
  }

  return globalAvail
}

/** Writes global.json for every session: a temp file of this session, then an atomic rename. */
async function writeGlobalAvail($: EngineInterface, rec: Avail): Promise<void> {
  if (!home) throw new Error('HOME is not set')
  const target = await $.fs.stat(globalFile()).catch(() => null)
  if (target && (target.kind !== 'file' || target.isLink)) throw new Error(`${globalFile()} is not a regular file`)
  const tmp = `${globalFile()}.tmp-${sessionId}`
  const stale = await $.fs.stat(tmp).catch(() => null)
  if (stale) await $.process.run(['/bin/rm', '-f', '--', tmp])
  await $.fs.write(tmp, JSON.stringify(rec))
  const moved = await $.process.run(['/bin/mv', '-f', '--', tmp, globalFile()])
  if (moved.exitCode !== 0) throw new Error(`could not write ${globalFile()}: ${moved.stderr.trim()}`)
  const written = await $.fs.stat(globalFile()).catch(() => null)
  if (!written || written.kind !== 'file') throw new Error(`${globalFile()} is not a file after the write`)
  globalAvail = rec
  globalMtime = written.mtimeMs
}

/** The effective status: session record over global record per field, else the run's --ask-user flag. */
async function currentEffective($: EngineInterface): Promise<Effective> {
  await readSessionAvail($)
  await readGlobalAvail($)

  return effective(run, sessionAvail, globalAvail)
}

/** Whether questions go to the person now, from the records as last read (no I/O). */
function askOnNow(): boolean {
  return effective(run, sessionAvail, globalAvail).askOn
}

async function save($: EngineInterface): Promise<void> {
  if (!sessionId) return
  const now = await $.clock.now()
  if (!run) {
    await $.store.delete(storeKey(sessionId))
    if (home) await $.fs.write(`${autopilotDir()}/${sessionId}.json`, JSON.stringify({ isOn: false }))
    return
  }
  await $.store.set(storeKey(sessionId), run)
  if (!home) return
  const eff = effective(run, sessionAvail, globalAvail)
  // Read by the fleet dashboard for its badge; the last four fields only by the combined ping,
  // which counts only questions that will be asked: none while asking is off (D4).
  await $.fs.write(
    `${autopilotDir()}/${sessionId}.json`,
    JSON.stringify({
      isOn: true,
      phase: run.phase,
      until: run.until,
      threshold: run.threshold,
      restarts: run.restarts,
      maxRestarts: run.maxRestarts,
      waitUntil: run.waitUntil,
      hasGoal: run.goal !== null,
      waitingFor: run.awaiting?.reason ?? null,
      waitingFrom: run.awaiting?.from ?? null,
      waitingSince: run.awaiting?.since ?? null,
      queued: eff.askOn ? (run.questions?.length ?? 0) : 0,
      awaySource: eff.awaySource,
      awaySetAt: eff.away?.setAt ?? null,
      beat: now,
    }),
  )
  lastBeat = now
}

/** Appends one line to this session's autopilot log: decisions, deferrals, restarts. */
async function log($: EngineInterface, line: string): Promise<void> {
  if (!home) return
  const path = `${autopilotDir()}/${sessionId}.log`
  // Free text may carry line breaks; flattened, it cannot forge a log line.
  // Every other control, format and separator character goes too (same class as autopilot.ts).
  const flat = line
    .replace(/[\r\n\u{85}\u{2028}\u{2029}]/gu, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '')
  const stamp = new Date(await $.clock.now()).toISOString()
  let before = ''
  try {
    before = await $.fs.read(path)
  } catch {
    before = ''
  }
  await $.fs.write(path, `${before}${stamp}  ${flat}\n`).catch(() => undefined)
}

/**
 * Submits a prompt once the session is idle, outside the hook that decided
 * it. A submit lands as an interruption when a turn runs, so when one has
 * started meanwhile (the goal loop, the person), something else is driving:
 * the prompt is dropped.
 */
function queue($: EngineInterface, text: string): void {
  $.clock.after(300, () => {
    if (isTurnRunning) return
    void $.prompt.submit({ text }).catch(() => undefined)
  })
}

async function setGoal($: EngineInterface): Promise<void> {
  if (!run?.goal) return
  const goal = run.goal
  await $.command
    .run({ command: 'goal', args: goal })
    .then(() => {
      isGoalSet = true
    })
    .catch(async error => log($, `could not set the goal: ${String(error)}`))
}

async function clearGoal($: EngineInterface): Promise<void> {
  if (!isGoalSet) return
  isGoalSet = false
  await $.command
    .run({ command: 'goal', args: 'clear' })
    .catch(async error => log($, `could not clear the goal: ${String(error)}`).catch(() => undefined))
}

/**
 * The transcript lives under the project root's folder. Never the current
 * directory: a shell `cd` in the session moves that, not the root.
 */
async function transcriptOf($: EngineInterface, id: string): Promise<string> {
  const root = await $.session.root()

  return `${home}/.claude/projects/${root.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
}

/**
 * The whole transcript lines grep matches; empty when nothing or on failure.
 * Whole lines, so each is parsed as a row and judged by where a value sits.
 */
async function grepTranscript($: EngineInterface, pattern: string): Promise<string[]> {
  if (!home) return []
  let out = ''
  try {
    const grep = $.process.spawn({ argv: ['/usr/bin/grep', '-E', '-e', pattern, '--', await transcriptOf($, sessionId)] })
    for await (const chunk of grep) if (chunk.stream === 'stdout') out += chunk.text
  } catch {
    return []
  }

  return out.split('\n').filter(Boolean)
}

/** Reads the session's /rename name and /color from its own transcript's top-level identity rows. */
async function readIdentity($: EngineInterface): Promise<{ name: string | null; color: string | null }> {
  return identityFromRows(await grepTranscript($, '^\\{"type":"(custom-title|agent-name|agent-color)"'))
}

/**
 * Whether the goal evaluator has judged this run's goal met, from the
 * `goal_status` verdicts the engine keeps as top-level attachment rows.
 */
async function isGoalMet($: EngineInterface): Promise<boolean> {
  if (!run?.goal) return false
  const rows = await grepTranscript($, '"goal_status"')

  return goalState(goalVerdictsFromRows(rows), run.goal) === 'achieved'
}

/**
 * Keeps the run's name and color current. A transcript after /clear carries
 * the name but no color, so a value missing there never erases a known one.
 */
async function refreshIdentity($: EngineInterface): Promise<void> {
  if (!run) return
  const identity = await readIdentity($)
  const name = identity.name ?? run.name
  const color = identity.color ?? run.color
  if (name === run.name && color === run.color) return
  run.name = name
  run.color = color
  await save($)
}

/**
 * /clear and /resume change the session id under a running module. Only the
 * run's own /clear (phase restarting) moves it to the new id, with this
 * session's availability record; any other new id is another conversation,
 * which the run does not drive: it stays stored under its old id, and the new
 * id's own run and record, if any, are loaded.
 */
async function syncId($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (id === sessionId) return
  const previous = sessionId
  sessionId = id
  if (run && followsNewSessionId(run.phase)) {
    if (previous) {
      await $.store.delete(storeKey(previous))
      const away = await $.store.get(availKey(previous))
      if (away !== undefined) {
        await $.store.set(availKey(id), away)
        await $.store.delete(availKey(previous))
      }
    }
    await save($)
    return
  }
  run = ((await $.store.get(storeKey(id))) as Run | undefined) ?? null
  await readSessionAvail($)
}

/**
 * The mode rule, one place for every trigger (spec §5.1): recomputes the
 * mode from the records, applies its effects to the run and saves. Saves
 * at least every half heartbeat, so the badge's `beat` stays fresh. Null
 * when no run.
 */
async function refreshMode($: EngineInterface): Promise<Mode | null> {
  await currentEffective($)
  const now = await $.clock.now()
  if (!run) return null
  // Decided and applied with no await in between: a parallel trigger acts on the result.
  const eff = effective(run, sessionAvail, globalAvail)
  const prev = run.lastMode ?? null
  const before = JSON.stringify(run)
  const next = availMode(run, eff, now)
  const applied = applyMode(run, next, eff, now)
  run = applied.run
  const isChanged = JSON.stringify(run) !== before
  if (isChanged || now - lastBeat >= HEARTBEAT_MS / 2) await save($)
  if (prev !== next) await log($, `availability mode ${prev ?? 'none'} -> ${next}`)
  // Informational: the combined ping itself comes from the heartbeat's combinedTick (task 10).
  if (applied.combined) await log($, 'global away over here: the combined ping is decided by the heartbeat')

  return next
}

/** Moves the run to its final phase; the goal loop stops so it cannot outrun the handoff. */
async function enterFinal($: EngineInterface, reason: FinalReason): Promise<string | null> {
  if (!run) return null
  run.phase = 'final'
  run.finalReason = reason
  // A declared wait ends with the run's last stage (the time running out while awaiting).
  run.awaiting = null
  // The final handoff is written after this moment; a grace resume asks for a handoff newer than it.
  run.finalAt = await $.clock.now()
  await clearGoal($)
  await save($)
  await log($, `final handoff requested (${reason})`)
  if (reason === 'week') {
    $.ui.toast(`Autopilot: ABSOLUTE STOP, the weekly token limit is at ${run.weekStop}%. Writing a handoff, then waiting for you.`)
  }

  return finalPrompt(run, reason)
}

/** Ends a 5-hour wait: back to work, the goal set again. */
async function wake($: EngineInterface): Promise<void> {
  if (!run || run.phase !== 'waiting' || isTurnRunning) return
  run.phase = 'running'
  run.waitUntil = null
  run.idleTurns = 0
  await save($)
  await log($, 'the 5-hour token window reset: resuming')
  // Setting the goal again starts the next turn itself.
  if (run.goal) await setGoal($)
  else queue($, RESUME_AFTER_WAIT_PROMPT)
}

function scheduleWake($: EngineInterface, now: number): void {
  if (!run?.waitUntil) return
  $.clock.after(Math.max(1_000, run.waitUntil - now), () => void wake($))
}

/**
 * Applies the token windows: the weekly stop ends the run, the 5-hour stop
 * parks it until the reset. Returns the instruction for the model, if any.
 * The phase flips before the first await, so parallel calls act once.
 */
async function applyLimits($: EngineInterface, windows: readonly TokenWindow[], now: number): Promise<string | null> {
  if (!run || (run.phase !== 'running' && run.phase !== 'resuming' && run.phase !== 'waiting')) return null
  const action = limitAction(run, windows, now)
  if (!action) return null

  if (action.kind === 'week') return enterFinal($, 'week')
  if (run.phase === 'waiting') return null

  run.phase = 'waiting'
  run.waitUntil = action.waitUntil
  await clearGoal($)
  await save($)
  await log($, `5-hour token window at ${run.fiveHourStop}%+: parked until ${endClock(action.waitUntil, null)}`)
  scheduleWake($, now)

  return waitPrompt(run, action.waitUntil)
}

/** The goal met: the last handoff, then the wheel goes back to the person. */
async function finishOnGoal($: EngineInterface): Promise<void> {
  await log($, 'goal met (evaluator verdict in the transcript)')
  // The evaluator already cleared the goal; nothing to clear.
  isGoalSet = false
  const instruction = await enterFinal($, 'goal')
  if (instruction) queue($, instruction)
}

/**
 * With a goal, no new turn after GOAL_IDLE_MS means the goal loop stopped.
 * Met ends the run; otherwise the goal is gone (cleared, impossible) and the
 * continuing goes back to autopilot.
 */
function watchGoal($: EngineInterface): void {
  const seq = turnSeq
  $.clock.after(GOAL_IDLE_MS, () => {
    void (async () => {
      if (!run || run.phase !== 'running' || isTurnRunning || turnSeq !== seq) return
      if (await isGoalMet($)) {
        await finishOnGoal($)
        return
      }
      await log($, 'goal loop stopped without a met verdict: autopilot continues the work')
      isGoalSet = false
      queue($, CONTINUE_PROMPT)
    })()
  })
}

/** The wait as a status line, with the time of its one check if it has a timeout. */
function waitingLines(now: number): string[] {
  const awaiting = run?.awaiting ?? null
  if (run?.phase !== 'awaiting' || !awaiting) return []
  const check = awaiting.timeoutAt ? ` · checks at ${endClock(awaiting.timeoutAt, null)}` : ''

  return [`Waiting: ${waitText(awaiting, now)}${check}`]
}

/**
 * Ends a declared wait, back to running: a new turn started (something
 * arrived), or the session went on working (`tool` names the call).
 */
async function endWait($: EngineInterface, tool: string | null = null): Promise<void> {
  if (run?.phase !== 'awaiting') return
  const awaiting = run.awaiting ?? null
  // Flipped before the first await, so parallel tool calls end the wait once.
  run.phase = 'running'
  run.awaiting = null
  run.idleTurns = 0
  const now = await $.clock.now()
  await save($)
  if (tool) {
    await log($, `wait ended: the session went on working (${tool})`)
    return
  }
  await log($, awaiting ? `woke after ${formatLeft(now - awaiting.since)} waiting for ${awaiting.reason}` : 'woke from a wait')
}

/** Once a declared wait passes its timeout, autopilot asks the session to check on it. */
async function checkWaitTimeout($: EngineInterface, now: number): Promise<void> {
  const awaiting = run?.awaiting ?? null
  if (!run || run.phase !== 'awaiting' || !awaiting?.timeoutAt) return
  if (now < awaiting.timeoutAt || awaiting.pinged) return
  awaiting.pinged = true
  await save($)
  await log($, `wait timed out after ${formatLeft(now - awaiting.since)} (${awaiting.reason}): asking the session to check`)
  queue($, waitTimeoutPrompt(awaiting, now))
}

/** The combined-ping lock of the global away set at `setAt` (a directory: mkdir is atomic). */
const lockDir = (setAt: number) => `${statusDir()}/ping-${setAt}.lock`

async function readLockOwner($: EngineInterface, dir: string): Promise<LockOwner | null> {
  try {
    return parseLockOwner(JSON.parse(await $.fs.read(`${dir}/owner.json`)))
  } catch {
    return null
  }
}

/** The away fields of every session's badge; a missing, half-written or old badge is skipped. */
async function readBadges($: EngineInterface): Promise<BadgeAvail[]> {
  const entries = await $.fs.list(autopilotDir()).catch(() => [])
  const badges: BadgeAvail[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const badge = parseBadgeAvail(JSON.parse(await $.fs.read(`${autopilotDir()}/${entry.name}`)))
      if (badge) badges.push(badge)
    } catch {
      continue
    }
  }

  return badges
}

/**
 * Makes the lock (mkdir fails when it exists) or takes over one whose owner
 * stopped refreshing it. Either way this session acts as owner from the next
 * heartbeat on, if `owner.json` still names it then.
 */
async function claimLock($: EngineInterface, dir: string, owner: LockOwner | null, now: number): Promise<void> {
  const made = await $.process.run(['/bin/mkdir', dir]).catch(() => null)
  const isNew = made?.exitCode === 0
  if (!isNew) {
    const stat = await $.fs.stat(dir).catch(() => null)
    if (!stat || stat.kind !== 'dir' || stat.isLink) {
      await log($, `combined ping: ${dir} is not a directory; left alone`)
      return
    }
    if (!lockStale(owner, false, now)) return
  }
  await $.fs.write(`${dir}/owner.json`, JSON.stringify({ sid: sessionId, at: now }))
  await log($, isNew ? `combined ping: took the lock ${dir}` : `combined ping: took over a stale lock ${dir} (owner ${owner?.sid.slice(0, 64) ?? 'unknown'})`)
}

/**
 * A session on the global away that sends no combined ping ("others only
 * toast", §7.3): one toast per away, one heartbeat after the expiry, only
 * when questions are queued somewhere (R7).
 */
async function toastGlobal($: EngineInterface, away: { until: number; setAt: number }, now: number, tail: string): Promise<void> {
  const id = `global:${away.setAt}`
  if (heldToasts.has(id)) return
  // One heartbeat after the expiry every live badge is fresh, as for the owner's sum.
  if (now < away.until + HEARTBEAT_MS) return
  heldToasts.add(id)
  const { total, sessions } = sumQueued(await readBadges($), away.setAt, now)
  if (total === 0) return
  $.ui.toast(`Autopilot: the global away time is over; ${queuedAcross(total, sessions)}. ${tail}`)
}

/**
 * One heartbeat of the combined ping (§7.3, R9). Only an eligible session
 * (a live run on that global away, asking on, away over) touches the lock, so
 * a session with no run never gets a prompt. The owner waits one heartbeat
 * after the expiry, sums the live badges and queues one `combined-ping`;
 * `done` is written when that ping is handed to the model. Every other run on
 * the same away only toasts, once.
 */
async function combinedTick($: EngineInterface): Promise<void> {
  if (!home || !run) return
  const global = await readGlobalAvail($)
  const away = global?.away ?? null
  if (!away || !('until' in away)) return
  const now = await $.clock.now()
  // A day after the expiry the ping is moot and the sweep may have removed its lock: never a late or second one.
  const isLate = now - away.until >= LOCK_TTL_MS
  const isHeld = (run?.pending ?? []).some(p => p.kind === 'combined-ping' && p.key === away.setAt)
  if (isLate && isHeld && run) {
    // One held since (a parked run) goes too: a day late it would only mislead.
    run = { ...run, pending: (run.pending ?? []).filter(p => !(p.kind === 'combined-ping' && p.key === away.setAt)) }
    await save($)
  }
  if (isLate) return
  // This module already handed it to the model (writing `done` may have failed).
  if (deliveredCombined.has(away.setAt)) return
  const eff = await currentEffective($)
  // Stopped while the files were read.
  if (!run) return
  const dir = lockDir(away.setAt)
  // The owner holding its undelivered combined ping keeps the lock alive, eligible or not
  // (parked, or its own away changed): nobody takes over and sends a second ping (R9).
  if ((run.pending ?? []).some(p => p.kind === 'combined-ping' && p.key === away.setAt)) {
    await $.fs.write(`${dir}/owner.json`, JSON.stringify({ sid: sessionId, at: now }))
    return
  }
  // A session record beats the global one (R5), or asking is off (D4): this away is not ours.
  const isOnThisAway = eff.awaySource === 'global' && !!eff.away && 'until' in eff.away && eff.away.setAt === away.setAt && eff.askOn
  if (!isOnThisAway) return
  const mode = availMode(run, eff, now)
  // The person is back here: this session neither sends nor keeps the lock; after two beats
  // another session with questions takes it over and sends the one ping (editor's decision 2026-10-14).
  if (mode === 'draining') return
  if (!eligibleForCombined(run, eff, mode, away.setAt)) {
    // Parked, paused or wrapping: no prompt now, the person learns of it from a toast.
    if (run.phase !== 'running' && run.phase !== 'awaiting') {
      await toastGlobal($, away, now, `This session asks once it is back to work (now ${run.phase}).`)
    }
    return
  }

  const owner = await readLockOwner($, dir)
  if (await $.fs.exists(`${dir}/done`)) {
    // Another session sent the notification; the owner toasted when it delivered.
    if (owner?.sid !== sessionId) await toastGlobal($, away, now, 'Another session sent the notification; write here to answer this one.')
    return
  }
  if (owner?.sid !== sessionId) {
    await claimLock($, dir, owner, now)
    return
  }
  // Still alive: no one takes over while the owner waits for the sum.
  await $.fs.write(`${dir}/owner.json`, JSON.stringify({ sid: sessionId, at: now }))
  // One heartbeat after the expiry every live session has refreshed its badge.
  if (now < away.until + HEARTBEAT_MS) return

  const { total, sessions } = sumQueued(await readBadges($), away.setAt, now)
  if (total === 0) {
    // Nothing queued anywhere: silently over (R7).
    await $.fs.write(`${dir}/done`, String(now))
    await log($, 'combined ping: global away over, no questions queued in any session')
    return
  }
  if (!run) return
  run = pushPending(run, { kind: 'combined-ping', text: combinedPingText(total, sessions), key: away.setAt })
  await save($)
  await log($, `combined ping: ${total} questions in ${sessions} sessions, pending delivery`)
}

/** A run that cannot take a prompt now (parked, paused, wrapping…): the person still learns of a ping, once. */
function toastHeld($: EngineInterface, items: readonly Pending[], phase: string): void {
  for (const pending of items) {
    if (pending.kind !== 'ping' && pending.kind !== 'combined-ping') continue
    const id = `${pending.kind}:${pending.key}`
    if (heldToasts.has(id)) continue
    heldToasts.add(id)
    const when = phase === 'final' ? 'the run is finishing, so they go into its handoff' : `the session tells you once it is back to work (now ${phase})`
    $.ui.toast(`Autopilot: away time is over and questions are queued; ${when}.`)
  }
}

/** Records entries handed to the model: saved, logged, pings toasted, a combined ping's lock marked done. */
async function markDelivered($: EngineInterface, items: readonly Pending[], via: 'tool' | 'turn' | 'idle'): Promise<void> {
  // First, before any await that can fail: a combined ping handed over is never pushed again.
  for (const pending of items) if (pending.kind === 'combined-ping') deliveredCombined.add(pending.key)
  await save($)
  for (const pending of items) {
    heldToasts.delete(`${pending.kind}:${pending.key}`)
    await log($, `delivered ${pending.kind} (${via})`)
    if (pending.kind === 'ping') {
      $.ui.toast(`Autopilot: away time is over; ${criticalCount(run?.questions?.length ?? 0)} queued.`)
    }
    if (pending.kind !== 'combined-ping') continue
    $.ui.toast('Autopilot: away time is over; critical questions are queued in your sessions.')
    if (!home) continue
    await $.fs
      .write(`${lockDir(pending.key)}/done`, String(await $.clock.now()))
      .catch(async error => log($, `combined ping: could not mark the lock done: ${String(error)}`))
  }
}

/**
 * Submits pending entries once the session is idle. They leave the queue
 * before the submit, so a tool call of the turn it starts cannot hand them
 * over again; a dropped or failed submit puts them back.
 */
async function submitPending($: EngineInterface, items: readonly Pending[], via: 'turn' | 'idle'): Promise<void> {
  try {
    // A turn started meanwhile (the person, the goal loop) or the run moved on: they stay pending.
    if (isTurnRunning || !run || !canDeliver(run.phase)) return
    const pending = run.pending ?? []
    // A tool call may have taken some already.
    const taken = items.filter(item => pending.some(p => p.kind === item.kind && p.key === item.key))
    if (taken.length === 0) return
    run = taken.reduce((acc, item) => deliveredPending(acc, item), run)
    const answer = await $.prompt.submit({ text: taken.map(item => item.text).join('\n\n') }).catch(() => null)
    if (answer && answer.drop === undefined) {
      await markDelivered($, taken, via).catch(error => log($, `could not record a delivery: ${String(error)}`).catch(() => undefined))
      return
    }
    if (run) run = taken.reduce((acc, item) => pushPending(acc, item), run)
    await save($)
    await log($, `pending prompt not delivered (${via}): ${answer?.drop ?? 'the submit failed'}`)
  } finally {
    flushingText = null
  }
}

/**
 * Hands `run.pending` to the model (§7.1). `tool`: taken now, the text goes
 * into the tool result's context. `turn` / `idle`: one submit once idle; the
 * text returned means a prompt is on its way, so the caller queues nothing
 * else. Null when nothing is pending or the phase cannot take a prompt.
 */
async function flushPending($: EngineInterface, via: 'tool' | 'turn' | 'idle'): Promise<string | null> {
  if (!run) return null
  const items = run.pending ?? []
  if (items.length === 0) return null
  if (!canDeliver(run.phase)) {
    toastHeld($, items, run.phase)
    return null
  }
  const text = items.map(item => item.text).join('\n\n')
  if (via === 'tool') {
    // Taken before the first await: a parallel tool call finds nothing left.
    run = items.reduce((acc, item) => deliveredPending(acc, item), run)
    // Taken: the text goes to the model whatever the bookkeeping does.
    await markDelivered($, items, via).catch(error => log($, `could not record a delivery: ${String(error)}`).catch(() => undefined))

    return text
  }
  if (flushingText !== null) return flushingText
  flushingText = text
  const submitVia: 'turn' | 'idle' = via
  $.clock.after(300, () => void submitPending($, items, submitVia).catch(error => log($, `pending submit failed: ${String(error)}`).catch(() => undefined)))

  return text
}

/** `isAskShown` false when the caller appends availStatusLines, which has its own ask-user line. */
function statusText(now: number, isAskShown = true): string {
  if (!run) return 'Autopilot is off.'

  return [
    `Autopilot: ${run.phase}${run.waitUntil ? ` until ${endClock(run.waitUntil, null)}` : ''} · ${formatLeft(run.until - now)} left · handoff at ${effectiveTrigger(run, ceiling)}% (asked ${run.threshold}%, ceiling ${ceiling}% below auto-compact) · restarts ${restartsText(run)}`,
    ...waitingLines(now),
    `Token limits: park at ${run.fiveHourStop}% of the 5-hour window, stop at ${run.weekStop}% of the week`,
    ...(isAskShown && askOnNow() ? ['Asks the person: critical only'] : []),
    `Role: ${run.role}`,
    ...(run.skills.length ? [`Skills recognised in the role: ${run.skills.map(name => `/${name}`).join(', ')}`] : []),
    ...(run.goal ? [`Goal: ${run.goal}${isGoalSet ? '' : ' (not set right now)'}`] : []),
    home ? `Log: ${autopilotDir()}/${sessionId}.log` : 'Log: none (HOME is not set)',
  ].join('\n')
}

const AVAIL_FAILED_TEXT = 'Autopilot: the command failed; nothing changed. Try again.'

/** The first line of an /away, /back or /ask-user reply: what was recorded, and for whom. */
function availHeadline(cmd: Exclude<AvailCommand, { kind: 'error' }>, until: number | null, offset: number | null): string {
  const scope = cmd.global ? 'all sessions' : 'this session'
  if (cmd.kind === 'away') return `Away until ${endClock(until ?? 0, offset)} (${scope}).`
  if (cmd.kind === 'back') return `Back (${scope}).`

  return `Ask-user ${cmd.on ? 'on' : 'off'} (${scope}).`
}

/**
 * /away, /back and /ask-user: the person's own availability. Stored even with
 * no run, so it applies to a later one (R4). Errors write nothing; a record
 * written at its scope goes through the mode rule, which may release a wait,
 * start a drain or queue a ping.
 */
async function setAvail($: EngineInterface, isPerson: boolean, cmd: AvailCommand, typed: string): Promise<{ text: string }> {
  await syncId($)
  if (!isPerson) {
    await log($, `${typed} refused: not typed by the person`)

    return { text: 'Only the person can say they are away or back, or turn asking on or off (type it in the prompt or over Remote Control).' }
  }
  if (cmd.kind === 'error') {
    $.ui.toast(`Autopilot: ${cmd.message}`)

    return { text: cmd.message }
  }
  if (cmd.global && !home) {
    const text = 'Cannot use --global: HOME is not set, so there is no shared status file. Leave out --global to set it for this session.'
    $.ui.toast(`Autopilot: ${text}`)

    return { text }
  }
  // A clock end needs the offset; every reply shows times in it.
  const offset = await utcOffset($)
  // The process call took time: decide on the clock as it is now.
  const now = await $.clock.now()
  let until: number | null = null
  if (cmd.kind === 'away') {
    if (cmd.end.kind === 'clock' && offset === null) {
      const text = 'Cannot read the local time zone; use a duration such as /away for 2h instead.'
      $.ui.toast(`Autopilot: ${text}`)

      return { text }
    }
    const end = awayUntil(cmd.end, now, offset ?? 0)
    if (typeof end === 'string') {
      $.ui.toast(`Autopilot: ${end}`)

      return { text: end }
    }
    until = end
  }

  const session = await readSessionAvail($)
  // The global file may have changed in another session since the last heartbeat.
  const before = cmd.global ? await readGlobalAvail($, true) : session
  const next = applyAvail(before, cmd, until, now)
  try {
    if (cmd.global) await writeGlobalAvail($, next)
    else await writeSessionAvail($, next)
  } catch (error) {
    await log($, `could not record ${typed}: ${String(error)}`).catch(() => undefined)

    return { text: 'Autopilot could not record the change; nothing changed.' }
  }
  const headline = availHeadline(cmd, until, offset)
  await log($, `set by the person: ${headline}`).catch(() => undefined)

  // The record is written: a failure from here on must not claim that nothing changed.
  const mode = await refreshMode($).catch(async (error: unknown) => {
    await log($, `recorded ${typed}, but applying it failed: ${String(error)}`).catch(() => undefined)

    return undefined
  })
  if (mode === undefined) return { text: `${headline} Recorded; applying it to the run failed, so it takes effect at the next turn.` }
  // refreshMode just read both records: the cached ones are current, no second read.
  const eff = effective(run, sessionAvail, globalAvail)
  // A session record beats the global one per field, even when older (R5).
  const shadowed = cmd.global && (cmd.kind === 'ask-user' ? session?.askUser : session?.away)
  const notes = [
    ...(shadowed ? [`Note: this session has its own ${cmd.kind === 'ask-user' ? 'ask-user' : 'away'} setting, which wins over the global one here.`] : []),
    ...(cmd.kind === 'away' && mode === 'plain'
      ? ['Note: this run does not ask you (no --ask-user), so being away changes nothing until /ask-user on.']
      : []),
  ]

  return { text: [headline, ...notes, ...availStatusLines(eff, mode, run, now, offset)].join('\n') }
}

const QUEUE_FAILED_TEXT =
  'Autopilot could not queue the question. Decide it yourself within your role, record the decision for the handoff, and continue.'
const NO_QUEUE_TEXT = 'Autopilot is not driving right now: no queue.'

/** Why queue_question is refused in this mode, or null when it is accepted. */
function queueRefusal(mode: Mode | null): string | null {
  if (mode === 'queueing' || mode === 'overdue' || mode === 'draining') return null
  if (mode === 'asking') return ASKING_QUEUE_REFUSAL
  if (mode === 'plain') return 'This run does not ask the person (no --ask-user): decide yourself within your role, record the decision for the handoff, and continue.'

  return NO_QUEUE_TEXT
}

/**
 * The person answered during a drain: question `askedId` leaves the queue, by
 * default the tagged wait's, else the one the role section named. Runs before
 * endWait, which drops the wait and its tag. Nothing removed (no id, or the id
 * is no longer queued): nothing saved, nothing logged.
 */
async function removeAnswered($: EngineInterface, askedId?: number): Promise<void> {
  if (!run) return
  const id = askedId ?? run.awaiting?.questionId ?? run.askingId ?? null
  if (id === null) return
  const before = run.questions?.length ?? 0
  run = answeredQuestion(run, id)
  if ((run.questions?.length ?? 0) === before) return
  await save($)
  await log($, `the person answered #${id}: ${run?.questions?.length ?? 0} questions left`)
  await refreshMode($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const rawHome = (await $.env.get('HOME')) ?? ''
    home = rawHome.startsWith('/') ? rawHome : ''
    // State and logs are the person's alone: the folders are closed to other users.
    if (home) {
      await $.process.run(['/bin/mkdir', '-p', autopilotDir(), statusDir()]).catch(() => undefined)
      await $.process.run(['/bin/chmod', '700', autopilotDir(), statusDir()]).catch(() => undefined)
    }
    sessionId = await $.session.id()
    run = ((await $.store.get(storeKey(sessionId))) as Run | undefined) ?? null
    // The status applies even before a run starts (R4); a reload re-reads both records.
    await readSessionAvail($)
    await readGlobalAvail($, true)
    await readCeiling($)
    // Records of runs that finished long ago go; best effort, off the start's path.
    void sweepFinished($).catch(() => undefined)

    await $.command.register({
      name: 'autopilot',
      description: 'Run this session on autopilot with a fixed role; no args shows status, "extend|shorten [<time>] [--restarts N]" and "until 18:30|6:30pm" change the end, "0 0 stop" hands back',
      argumentHint: '<time | until 18:30|6:30pm> <threshold%> [max restarts] "<role>" [--goal "…"] [--5h 95] [--week 80] [--ask-user] | extend|shorten [<time>] [--restarts N] | until 18:30|6:30pm | 0 0 stop',
    })
    // Immediate: typed mid-turn they run at once, so stepping away never waits for a long turn.
    await $.command.register({
      name: 'away',
      description: 'Autopilot: you are away; critical questions are queued instead of asked, then asked one by one when you are back',
      argumentHint: 'for <90m|2h|1h30m> | until <15:00|6pm> [--global]',
      immediate: true,
    })
    await $.command.register({
      name: 'back',
      description: 'Autopilot: you are back; the queued questions are asked one by one',
      argumentHint: '[--global]',
      immediate: true,
    })
    await $.command.register({
      name: 'ask-user',
      description: 'Autopilot: turn asking you critical questions on or off (off queues them until you turn it on)',
      argumentHint: 'on|off [--global]',
      immediate: true,
    })
    await $.tool.register({
      name: RESTART_TOOL,
      description:
        'Autopilot only: after writing a handoff with /create-handoff-doc at the context threshold, call this with the handoff path. It clears the session and resumes from the handoff. Refused when autopilot is not wrapping up.',
      inputSchema: {
        type: 'object',
        properties: {
          handoffPath: {
            type: 'string',
            description: 'Path to the handoff .md under thoughts/shared/handoffs/ (absolute or relative to the project root)',
          },
        },
        required: ['handoffPath'],
      },
    })
    await $.tool.register({
      name: WAIT_TOOL,
      description:
        'Autopilot only: declares that this session is waiting for something (another session, a subagent, a workflow, a background task, the person), so autopilot stops nudging it. End your turn right after calling it; any new message wakes the session.',
      inputSchema: {
        type: 'object',
        properties: {
          reason: { type: 'string', enum: [...WAIT_REASONS], description: 'What the session waits for' },
          from: { type: 'string', description: 'Who the answer comes from: a session name, a subagent, a workflow' },
          note: { type: 'string', description: 'What is awaited, in one line (for the person: the question or the action)' },
          timeout: { type: 'string', description: 'When autopilot checks once whether the wait is stuck, e.g. "30m", "1h"' },
        },
        required: ['reason'],
      },
    })
    await $.tool.register({
      name: QUEUE_TOOL,
      description: `Autopilot only: while the person is away or has asking turned off, parks a critical question (one you would otherwise stop for with ${WAIT_TOOL} user-answer) for them to answer later, one by one. Keep working on what is not blocked by it. Refused when the person can be asked directly.`,
      inputSchema: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question or the action for the person, in one line, as they will read it' },
          kind: { type: 'string', enum: ['answer', 'action'], description: 'answer: a decision only the person can make; action: something the person must do' },
          provisional: { type: 'string', description: 'What you do meanwhile, if anything (prefer a reversible default)' },
        },
        required: ['question', 'kind'],
      },
    })

    // Time and the 5-hour reset can come while the session sits idle (or after a reload lost the timers).
    $.clock.every(HEARTBEAT_MS, () => {
      void (async () => {
        await syncId($)
        // Before the idle guard: an away running out or a global change by another
        // session (R2) changes the mode mid-turn too. No run: nothing is ever queued.
        // refreshMode also saves at least every half heartbeat, which keeps the badge's
        // beat fresh for the combined ping (live sessions only); no second save here.
        await refreshMode($).catch(error => log($, `mode refresh failed: ${String(error)}`).catch(() => undefined))
        await combinedTick($).catch(async error => log($, `combined ping failed: ${String(error)}`))
        if (!run || isTurnRunning) return
        const now = await $.clock.now()
        // The clock read is an await: the run may have ended meanwhile.
        if (!run) return
        if ((run.phase === 'running' || run.phase === 'waiting' || run.phase === 'awaiting') && now >= run.until) {
          const instruction = await enterFinal($, 'time')
          if (instruction) queue($, instruction)
          return
        }
        if (run.phase === 'waiting' && run.waitUntil && now >= run.waitUntil) {
          // The resumed turn's first tool call, or its end, carries what is pending.
          await wake($)
          return
        }
        // A delivered prompt wakes a wait too: its timeout check can wait a beat.
        if (await flushPending($, 'idle')) return
        await checkWaitTimeout($, now)
      })().catch(error => log($, `heartbeat failed: ${String(error)}`).catch(() => undefined))
    })

    return next(e)
  })

  on('command.run', { command: 'autopilot' }, async ($, e) => {
    await syncId($)
    let now = await $.clock.now()
    const command = parseCommand(e.args)

    if (command.kind === 'status') {
      const finished = run ? null : await loadFinished($, now)
      // The records first, so the status reads them fresh, not as of the last heartbeat.
      // A failed refresh must not hide the status: show it from the cached records.
      const mode = await refreshMode($).catch(() => null)
      // availStatusLines carries the one ask-user line, so statusText leaves its own out.
      const text = finished ? graceStatusText(finished, now) : statusText(now, false)
      // Away and ask-user show with or without a run, with their source (session or global).
      const offset = await utcOffset($)
      // refreshMode read both records (also with no run): the cached ones are current.
      const lines = availStatusLines(effective(run, sessionAvail, globalAvail), mode, run, now, offset)

      return { text: [text, ...lines].join('\n') }
    }
    if (command.kind === 'error') return { text: command.message }
    if (command.kind === 'extend' || command.kind === 'shorten' || command.kind === 'until') {
      if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') {
        await log($, `retime refused: origin ${e.origin.kind}`)

        return { text: 'Only the person can change the autopilot end time (type it in the prompt or over Remote Control).' }
      }
      // No run, but one that finished on time or restarts a moment ago: it is judged as a run in its final phase.
      const finished = run ? null : await loadFinished($, now)
      const subject = run ?? finished?.run ?? null
      if (!subject) return { text: NOT_RUNNING_TEXT }
      const offset = await utcOffset($)
      // The process call took time: decide on the clock as it is now.
      now = await $.clock.now()
      // The token windows only matter for a revive: a weekly stop at its limit refuses, a 5-hour stop parks.
      const usage = subject.phase === 'final' ? await $.session.usage().catch(() => null) : null
      const target = targetChange(command, subject, now, offset)
      if ('refuse' in target) return { text: target.refuse }
      const action = retime(subject, target, now, usage ? limitAction(subject, usage.rateLimits, now) : null)
      if (action.kind === 'refuse') return { text: action.message }

      const limit = (maxRestarts: number | null) => maxRestarts ?? 'unlimited'
      const restartsChange = action.maxRestarts === subject.maxRestarts ? '' : `, restart limit ${limit(subject.maxRestarts)} -> ${limit(action.maxRestarts)}`
      const note = target.note ? ` ${target.note}` : ''
      if (finished) {
        // A finished record is final/time or final/restarts, so retime can only revive it.
        if (action.kind !== 'revive') return { text: NOT_RUNNING_TEXT }
        // Back through the restart flow: the handoff is already written, so wrapping asks for the restart;
        // that restart is not counted. The wait is dropped: the limit checks after the resume park it again if needed.
        run = {
          ...finished.run,
          until: action.until,
          maxRestarts: action.maxRestarts,
          phase: 'wrapping',
          finalReason: null,
          idleTurns: 0,
          waitUntil: null,
          isGraceResume: true,
          graceSince: finished.run.finalAt,
          graceAsks: 0,
        }
        try {
          await save($)
        } catch (error) {
          run = null
          await save($).catch(() => undefined)
          await log($, `could not record the change: ${String(error)}`).catch(() => undefined)

          return { text: 'Autopilot could not record the change; nothing changed.' }
        }
        await $.store.delete(finishedKey(sessionId)).catch(() => undefined)
        await log($, `revived after finishing (${finished.run.finalReason}) by ${command.kind}: to ${endClock(run.until, null)}${restartsChange}`)
        queue($, graceResumePrompt(run.until, offset))

        return {
          text: `Autopilot end: ${endClock(run.until, offset)}, ${formatLeft(run.until - now)} left, restarts ${run.restarts}/${limit(run.maxRestarts)}.${note} Bringing the run back: the session will clear and resume from its handoff.`,
        }
      }
      // Stopped while the clock and usage were read.
      if (!run) return { text: NOT_RUNNING_TEXT }
      const wasReason = run.finalReason
      const previous = {
        until: run.until,
        maxRestarts: run.maxRestarts,
        phase: run.phase,
        finalReason: run.finalReason,
        idleTurns: run.idleTurns,
        waitUntil: run.waitUntil,
      }
      run.until = action.until
      run.maxRestarts = action.maxRestarts
      if (action.kind === 'revive') {
        run.phase = action.phase
        run.finalReason = null
        run.idleTurns = 0
        run.waitUntil = action.waitUntil
      }
      try {
        await save($)
      } catch (error) {
        // Not recorded: back to where it was, or the run would differ from what is stored.
        Object.assign(run, previous)
        await save($).catch(() => undefined)
        await log($, `could not record the change: ${String(error)}`).catch(() => undefined)

        return { text: 'Autopilot could not record the change; nothing changed.' }
      }
      const logLine = `to ${endClock(run.until, null)}${restartsChange}`
      const pausedNote = run.phase === 'paused' ? ' (paused; start it again to resume work)' : ''
      const reply = `Autopilot end: ${endClock(run.until, offset)}, ${formatLeft(run.until - now)} left, restarts ${run.restarts}/${limit(run.maxRestarts)}.${note}${pausedNote}`
      if (action.kind === 'set') {
        await log($, `end moved by the person (${command.kind}): ${logLine}`)

        return { text: reply }
      }

      await log($, `revived from final (${wasReason}) by ${command.kind}: ${logLine}`)
      // A 5-hour wait is pending (or the window is at its stop): the park's own wake brings the session back.
      if (action.phase === 'waiting') {
        await clearGoal($)
        scheduleWake($, now)

        return { text: `${reply} Back on the 5-hour wait: the final handoff is cancelled.` }
      }
      // Setting the goal starts a turn of its own, which already reads the pinned
      // role: a revive prompt after it would land behind work that may be done by then.
      if (run.goal) await setGoal($)
      else {
        const restarts = wasReason === 'restarts' ? { used: run.restarts, limit: run.maxRestarts } : undefined
        queue($, revivePrompt(run.until, offset, restarts))
      }

      return { text: `${reply} Back to work: the final handoff is cancelled.` }
    }
    if (command.kind === 'stop') {
      if (run) await log($, 'stopped by the person')
      // A stopped run asks nothing more: its open questions go to the person in the reply.
      const open = run ? questionsBlock(run) : ''
      await $.store.delete(finishedKey(sessionId)).catch(() => undefined)
      await clearGoal($)
      run = null
      await save($)
      $.ui.status(undefined)

      return { text: open ? `Autopilot is off. You have the wheel.\n${open}` : 'Autopilot is off. You have the wheel.' }
    }

    // A clock end is under 24 hours ahead, so the 7-day cap cannot be hit.
    const startOffset = await utcOffset($)
    now = await $.clock.now()
    if (command.end.kind === 'clock' && startOffset === null) {
      return { text: 'Cannot read the local time zone; use a duration such as 2h instead.' }
    }
    const until =
      command.end.kind === 'clock'
        ? untilFromClock(command.end.hours, command.end.minutes, now, startOffset ?? 0)
        : now + command.end.ms

    const limit = await readCeiling($)
    const capNote =
      command.threshold > limit
        ? `\nNote: you asked for ${command.threshold}%, but auto-compact in this session leaves room for a handoff only up to ${limit}% (auto-compact minus 10 points), so ${limit}% is used. To get exactly ${command.threshold}% next time, raise autoCompactWindow in ~/.claude/settings.json.`
        : ''

    const [identity, commands] = await Promise.all([readIdentity($), $.command.list().catch(() => [])])
    const skillNames = commands.filter(info => info.source !== 'builtin').map(info => info.name)
    // A new run in this session keeps what the run it replaces still had queued (a paused run is started again this way): no question is lost.
    const kept = run?.questions?.length ? { questions: run.questions, nextQuestionId: run.nextQuestionId, drain: run.drain, pingedFor: run.pingedFor } : {}
    const keptNote = kept.questions ? `\nKept from the previous run: ${criticalCount(kept.questions.length)} queued for you.` : ''
    run = {
      role: command.role,
      name: identity.name,
      color: identity.color,
      startedAt: now,
      until,
      threshold: command.threshold,
      maxRestarts: command.maxRestarts,
      restarts: 0,
      phase: 'running',
      handoffPath: null,
      idleTurns: 0,
      goal: command.goal,
      skills: namedSkills(command.role, skillNames),
      fiveHourStop: command.fiveHourStop,
      weekStop: command.weekStop,
      waitUntil: null,
      finalReason: null,
      awaiting: null,
      askUser: command.askUser,
      ...kept,
    }
    await save($)
    await $.store.delete(finishedKey(sessionId)).catch(() => undefined)
    await log(
      $,
      `started: ${formatLeft(until - now)} (until ${endClock(until, null)}), trigger ${command.threshold}%, restarts ${restartsText(run)}, 5h ${command.fiveHourStop}%, week ${command.weekStop}%${command.goal ? `, goal: ${command.goal}` : ''}${command.askUser ? ', asks the person: critical only' : ''}; role: ${command.role}`,
    )
    if (capNote) await log($, `threshold ${command.threshold}% capped to ${limit}% below auto-compact`)

    // Setting a goal starts a turn of its own, which already reads the pinned
    // role: a kickoff after it would land behind work that may be done by then.
    const started = run
    $.clock.after(300, () => {
      void (async () => {
        if (started.goal) {
          await setGoal($)
          return
        }
        await $.prompt.submit({ text: kickoffPrompt(started, now) }).catch(() => undefined)
      })()
    })

    return { text: `${statusText(now)}\nEnd: ${endClock(until, startOffset)}, ${formatLeft(until - now)} left.${capNote}${keptNote}\nStop any time with /autopilot 0 0 stop.` }
  }).catch(() => ({ text: 'Autopilot: the command failed; nothing changed. Try again.' }))

  // Human-only: another plugin, a peer or the SDK may not say the person is away or back.
  const isPerson = (kind: string) => kind === 'composer' || kind === 'bridge'

  on('command.run', { command: 'away' }, async ($, e) => setAvail($, isPerson(e.origin.kind), parseAway(e.args), '/away')).catch(() => ({
    text: AVAIL_FAILED_TEXT,
  }))

  on('command.run', { command: 'back' }, async ($, e) => setAvail($, isPerson(e.origin.kind), parseBack(e.args), '/back')).catch(() => ({
    text: AVAIL_FAILED_TEXT,
  }))

  on('command.run', { command: 'ask-user' }, async ($, e) =>
    setAvail($, isPerson(e.origin.kind), parseAskUser(e.args), '/ask-user'),
  ).catch(() => ({ text: AVAIL_FAILED_TEXT }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!run) return composed
    const now = await $.clock.now()
    if (!run) return composed
    // Read only: compose fires for every model request and for other plugins' $.prompt.compose(),
    // so it runs no mode effects and reads no file; the records were refreshed at turn.start.
    const mode = availMode(run, effective(run, sessionAvail, globalAvail), now)
    // While draining, the role section names the head question: that is the one an answer removes.
    const head = mode === 'draining' ? drainingQuestion(run) : null
    if (head && run.askingId !== head.id) {
      run.askingId = head.id
      await save($).catch(error => log($, `could not record the asked question: ${String(error)}`).catch(() => undefined))
      if (!run) return composed
    }

    return {
      sections: [
        ...composed.sections,
        { id: 'autopilot:role', text: roleSection(run, now, mode), scope: 'session' as const },
      ],
    }
  })

  // A goal's Stop hook re-prompts while its condition is unmet, so the turn
  // never ends and a queued /clear never runs. While a handoff, restart, final
  // or wait is under way, its block is dropped; the other Stop hooks still run.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (!run || !shouldDropStopBlock(run.phase) || result.block === undefined) return result
    await log($, `let the turn end during ${run.phase} (a Stop hook asked to continue: ${result.block.slice(0, 120)})`)

    return { ...result, block: undefined }
  }).catch(($, e, next) => next(e))

  // The ceiling should make this never happen; if it does, it is on record.
  on('session.compact', { trigger: 'auto' }, async ($, e, next) => {
    if (run && !e.agentId) {
      await log($, `WARNING: auto-compact ran before a handoff (phase ${run.phase}, ceiling ${ceiling}%)`)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The person writing after an away ended starts the drain (R10); during a
  // drain, their idle prompt is the answer the next turn starts with, but only
  // once the question was put to them. A prompt from a plugin, a peer, a
  // notification or the SDK answers nothing.
  on('prompt.submit', async ($, e, next) => {
    // Every prompt overwrites the flag: only the one that starts the turn counts.
    lastSubmitHuman = false
    // A slash command typed by the person is not a message to the session. (isPerson: task 08's helper.)
    if (!isPerson(e.origin.kind) || e.text.trimStart().startsWith('/')) return next(e)
    await syncId($)
    if (!run) return next(e)
    const mode = await refreshMode($)
    if (mode === 'overdue' && run) {
      run = humanSubmit(run, mode)
      await save($)
      await log($, 'the person wrote after the away time: asking the queued questions one by one')
      await refreshMode($)

      return next(e)
    }
    // Typed into a running turn (turnId set) it reaches that turn, not the next one.
    // Only an answer to a question put to the person counts: while the drain prompt
    // is still on its way, or the model has not asked yet, nothing leaves the queue
    // (spec §5.2: no question removed unasked).
    const awaitsPerson = run?.phase === 'awaiting' && (run.awaiting?.reason === 'user-answer' || run.awaiting?.reason === 'user-input')
    if (mode === 'draining' && !e.turnId && awaitsPerson) lastSubmitHuman = true

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    toolsThisTurn = 0
    turnSeq += 1
    // Read and reset before any await: only the prompt that starts this turn can be the answer.
    const isAnswer = lastSubmitHuman
    lastSubmitHuman = false
    await syncId($)
    // A failed removal must not skip ending the wait below.
    if (isAnswer) await removeAnswered($).catch(error => log($, `could not remove the answered question: ${String(error)}`).catch(() => undefined))
    // turn.start carries no agentId: it is the main loop's turn.
    await endWait($)
    // A turn start is a mode-rule trigger (spec §5.1): the wait just ended may change the mode.
    await refreshMode($)
    await refreshIdentity($)

    return next(e)
  })

  on('tool.call', { tool: FULL_WAIT_TOOL }, async ($, e) => {
    // Only the main loop waits; a subagent's turn ending is not the session's.
    if (e.agentId) {
      await log($, `wait refused: called by a subagent (${e.agentId})`)
      return { deny: 'Only the main session may wait under autopilot; a subagent may not.' }
    }
    await syncId($)
    // The mode first: everything from the clock read on stays free of awaits until the flip.
    const mode = await refreshMode($)
    const now = await $.clock.now()
    // Check, parse and flip before the first await: a parallel tool call may move the phase meanwhile.
    if (!run) return { deny: 'Autopilot is not driving right now: no wait needed.' }
    const phaseRefusal = waitPhaseRefusal(run.phase)
    if (phaseRefusal) return { deny: phaseRefusal }
    const isRepeat = run.phase === 'awaiting'
    const parsed = parseWaitInput(e, now, run.until)
    if (parsed.kind === 'error') return { deny: parsed.message }
    const refusal = waitRefusal(parsed.awaiting, mode ?? 'plain')
    if (refusal) {
      await log($, `wait refused (${parsed.awaiting.reason}): ${refusal}`)
      return { deny: refusal }
    }

    // A drain question asked: "#k" in the note names it, only while k is queued; untagged, the answer removes the question the role section named.
    if (parsed.awaiting.reason === 'user-answer' || parsed.awaiting.reason === 'user-input') {
      const questionId = questionIdFromNote(parsed.awaiting.note, run.questions ?? [])
      if (questionId !== null) parsed.awaiting.questionId = questionId
      // The drain is under way: a drain prompt still pending would wake this wait and have the question asked twice.
      if (mode === 'draining') run.pending = (run.pending ?? []).filter(entry => entry.kind !== 'drain')
    }

    const previous = { phase: run.phase, awaiting: run.awaiting ?? null }
    run.phase = 'awaiting'
    run.awaiting = parsed.awaiting
    run.idleTurns = 0
    try {
      await save($)
      const timeout = parsed.awaiting.timeoutAt ? `, checks at ${endClock(parsed.awaiting.timeoutAt, null)}` : ', no timeout'
      // A repeat in the same turn replaces the wait it declared.
      await log($, `${isRepeat ? 'wait updated: ' : 'waiting for '}${waitText(parsed.awaiting, now)}${timeout}`)
    } catch (error) {
      // Not recorded: back to where it was, or the session would sit in a wait nothing knows about.
      if (run) {
        run.phase = previous.phase
        run.awaiting = previous.awaiting
      }
      await save($).catch(() => undefined)
      await log($, `could not record the wait: ${String(error)}`).catch(() => undefined)
      return { deny: 'Autopilot could not record the wait. Continue your work.' }
    }

    return {
      result: `Waiting recorded (${waitText(parsed.awaiting, now)}). End your turn now; any incoming message (another session, a subagent, a workflow, the person) wakes you and autopilot will not nudge you meanwhile.`,
    }
  }).catch(() => ({ deny: 'Autopilot could not record the wait. Continue your work.' }))

  on('tool.call', { tool: FULL_QUEUE_TOOL }, async ($, e) => {
    // Only the main loop asks the person; a subagent reports to it instead.
    if (e.agentId) {
      await log($, `queue refused: called by a subagent (${e.agentId})`)
      return { deny: 'Only the main session may queue questions for the person under autopilot; a subagent may not.' }
    }
    await syncId($)
    const mode = await refreshMode($)
    const refusal = queueRefusal(mode)
    if (refusal) return { deny: refusal }
    const now = await $.clock.now()
    // Stopped while the clock was read.
    if (!run) return { deny: NO_QUEUE_TEXT }
    if (run.phase === 'final') return { deny: 'Autopilot is finishing this run: do not queue. Put the question in your handoff as an open question for the person.' }
    const input = parseQueueInput(e)
    if (typeof input === 'string') return { deny: input }

    // Add and swap before the next await: a parallel call queues after this one, never over it.
    const added = addQuestion(run, input, now)
    run = added.run
    try {
      await save($)
    } catch (error) {
      // Not recorded: take out only this call's question; a parallel call may have queued its own since.
      if (run && added.isNew) run.questions = (run.questions ?? []).filter(question => question.id !== added.id)
      await save($).catch(() => undefined)
      await log($, `could not record the question: ${String(error)}`).catch(() => undefined)
      return { deny: QUEUE_FAILED_TEXT }
    }
    const count = run?.questions?.length ?? 0
    const meanwhile = input.provisional ? ` · meanwhile: ${input.provisional}` : ''
    await log($, added.isNew ? `queued #${added.id} (${input.kind}, ${count} waiting): ${input.question}${meanwhile}` : `queue: same as #${added.id}, not added again`)
    $.ui.toast(added.isNew ? `Autopilot: question #${added.id} queued for you (${count} waiting).` : `Autopilot: question #${added.id} was already queued.`)
    // Never dropped (D6): past the mark the person only hears how many wait.
    if (added.warn) $.ui.toast(`Autopilot: ${count} questions are queued (more than ${QUEUE_WARN}); none is dropped. /back to answer them.`)

    return { result: queuedResult(added.id, added.warn, input.cut === true) }
  }).catch(() => ({ deny: QUEUE_FAILED_TEXT }))

  on('tool.call', { tool: FULL_RESTART_TOOL }, async ($, e) => {
    // Only the main loop restarts the session; a subagent never does.
    if (e.agentId) {
      await log($, `restart refused: called by a subagent (${e.agentId})`)
      return { deny: 'Only the main session may restart under autopilot; a subagent may not.' }
    }
    await syncId($)
    if (!run || run.phase !== 'wrapping') {
      return { deny: 'Autopilot is not wrapping up: no restart. Continue your work.' }
    }
    const givenPath = handoffArg(e)
    const root = await $.session.root()
    if (!isValidHandoffPath(root, givenPath)) {
      await log($, `restart refused: handoff path ${JSON.stringify(givenPath.slice(0, 300))} is not a .md file under thoughts/shared/handoffs/`)
      return {
        deny: `Refused: the handoff must be a .md file under ${root}/thoughts/shared/handoffs/ (no "..", no control characters). Write it there with /create-handoff-doc, then call ${RESTART_TOOL} with its path. Pass it as "handoffPath".`,
      }
    }
    const handoffPath = resolveHandoffPath(root, givenPath)
    if (!(await $.fs.exists(handoffPath))) {
      return { deny: `No handoff document at "${handoffPath}". Write it with /create-handoff-doc first, then call ${RESTART_TOOL} with the path to the handoff .md under thoughts/shared/handoffs/ (absolute or relative to the project root).` }
    }

    // A grace resume must use the handoff written when the run finished, not an older one.
    if (run.isGraceResume) {
      const stat = await $.fs.stat(handoffPath).catch(() => null)
      const check = graceHandoffCheck(stat?.mtimeMs ?? null, run.graceSince)
      if (check === 'unknown') {
        // Fail closed: without the final phase's start there is no telling which handoff is current.
        run.isGraceResume = false
        run.phase = 'paused'
        await save($)
        await log($, 'restart refused: a grace resume without the final handoff time; paused')

        return { deny: 'Refused: autopilot cannot tell which handoff is current; the person will restart the session.' }
      }
      if (check === 'stale') {
        await log($, `restart refused: handoff ${handoffPath} is older than the final handoff request`)

        return { deny: `Refused: use the handoff you wrote when the run finished (newer than ${endClock(run.graceSince ?? 0, null)}), not an older one.` }
      }
    }
    // A run the person brought back after it finished resumes without using up a restart.
    if (run.isGraceResume) run.isGraceResume = false
    else run.restarts += 1
    run.phase = 'restarting'
    run.handoffPath = handoffPath
    await save($)
    await log($, `restart ${restartsText(run)} from ${handoffPath}`)
    $.clock.after(500, () => {
      void (async () => {
        await $.command.run({ command: 'clear' })
        await syncId($)
        // /clear keeps the session's name but drops its color and its goal. The
        // color comes back now; the goal after the resume turn, since setting it
        // starts a turn of its own that would run ahead of the resume.
        isGoalSet = false
        const color = run?.color
        if (color) {
          await $.command
            .run({ command: 'color', args: color })
            .catch(async error => log($, `could not restore the color ${color}: ${String(error)}`))
        }
        if (run) {
          run.phase = 'resuming'
          await save($)
        }
        await $.command.run({ command: 'resume-handoff-doc', args: handoffPath })
      })().catch(async error => {
        await log($, `restart failed: ${String(error)}`)
        if (run) run.phase = 'paused'
        await save($)
        $.ui.toast('Autopilot: the restart failed and is paused. See the log.')
      })
    })

    return { result: 'Restart queued: the session will be cleared and resumed from the handoff. End your turn now.' }
  }).catch(() => ({ deny: 'Autopilot could not queue the restart. Continue your work; the person will restart the session.' }))

  on('tool.call', async ($, e, next) => {
    if (e.agentId || !run || run.phase === 'paused') return next(e)
    toolsThisTurn += 1
    // Working on after wait_for ends the wait; the call is then handled as usual.
    // A sibling call in the same parallel batch ends it too: working means not waiting.
    if (endsWait(run.phase, e.tool)) await endWait($, e.tool)

    // While waiting the person is in control: their questions and refusals are theirs.
    const isAway = autoAnswersQuestions(run.phase)
    if (isAway && e.tool === 'AskUserQuestion') {
      const mode = await refreshMode($)
      // The person can answer now: the dialog and its result are theirs, never rewritten.
      if (mode !== null && passesQuestion(mode)) {
        await log($, `question passed to the person (${mode})`)
        const asked = run?.questions?.find(question => question.id === run?.askingId) ?? null
        const ran = await next(e)
        if (asked === null || !removesDrainedQuestion(mode, ran, e, asked)) return ran
        await removeAnswered($, asked.id).catch(error =>
          log($, `could not remove the answered question: ${String(error)}`).catch(() => undefined),
        )

        return ran
      }
      await log($, `question answered by autopilot (decide yourself): ${JSON.stringify(e).slice(0, 400)}`)
      return { deny: askAnswer(mode ?? 'plain') }
    }

    const ran = await next(e)
    if (ran.deny !== undefined) {
      if (!isAway) return ran
      if (!isPermissionDeny(ran.deny)) return ran
      await log($, `deferred (refused by the permission mode): ${e.tool}: ${ran.deny.slice(0, 300)}`)
      return { deny: `${ran.deny}\n\n${DEFERRED_NOTE}` }
    }

    // What must reach the model (a ping, the drain, a released wait) rides on this result,
    // but not on wait_for or the restart: both tell the session to end its turn.
    const isTurnEnding = e.tool === FULL_WAIT_TOOL || e.tool === FULL_RESTART_TOOL
    const pendingText = isTurnEnding ? null : await flushPending($, 'tool')
    const pendingContext = pendingText ? [pendingText] : []

    // From here on the pending text is taken: a failure below must still hand it to the model.
    try {
      const usage = await $.session.usage().catch(() => null)
      const percent = usage?.context.percent ?? null
      const now = await $.clock.now()

      // Token limits come before the context trigger.
      const limitInstruction = await applyLimits($, usage?.rateLimits ?? [], now)
      if (limitInstruction) return { ...ran, context: [...(ran.context ?? []), ...pendingContext, limitInstruction] }

      // A run that ended during the awaits above gets no instruction; the pending text still goes out.
      if (!run) return { ...ran, context: [...(ran.context ?? []), ...pendingContext] }
      // Parallel tool calls finish together: decide and flip the phase with no
      // await in between, so only the first of them carries the instruction.
      const action = wrapMidTurn(run, now, percent, ceiling)
      if (!action) return pendingText ? { ...ran, context: [...(ran.context ?? []), ...pendingContext] } : ran
      const reason = now >= run.until ? 'time' : 'restarts'
      run.phase = action === 'wrapup' ? 'wrapping' : 'final'
      if (action === 'final') {
        run.finalReason = reason
        run.finalAt = now
      }
      await save($)
      if (!run) return { ...ran, context: [...(ran.context ?? []), ...pendingContext] }
      await log($, `${action} requested mid-turn at ${percent ?? '?'}% context (trigger ${effectiveTrigger(run, ceiling)}%)`)
      if (action === 'final') await clearGoal($)
      if (!run) return { ...ran, context: [...(ran.context ?? []), ...pendingContext] }
      const instruction = action === 'wrapup' ? wrapupPrompt(run, percent) : finalPrompt(run, reason)

      return { ...ran, context: [...(ran.context ?? []), ...pendingContext, instruction] }
    } catch (error) {
      await log($, `tool.call failed after taking pending prompts: ${String(error)}`).catch(() => undefined)

      return { ...ran, context: [...(ran.context ?? []), ...pendingContext] }
    }
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId) return result
    isTurnRunning = false
    await syncId($)
    if (!run) return result
    // An interrupted turn (the person, a command) decides nothing: reacting to it
    // with a prompt would interrupt the next one in turn.
    if (e.isAborted) return result

    // A grace resume still waiting for its restart is asked again, then paused; ordinary wrap-ups are untouched.
    const graceAction = graceTurnAction(run)
    if (graceAction === 'ask') {
      run.graceAsks = (run.graceAsks ?? 0) + 1
      await save($)
      await log($, 'grace resume: asked again')
      queue($, graceResumePrompt(run.until, await utcOffset($)))
      return result
    }
    if (graceAction === 'pause') {
      run.phase = 'paused'
      run.isGraceResume = false
      await save($)
      await log($, 'grace resume: no restart after the re-ask, paused')
      $.ui.toast('Autopilot: the run was brought back but the session did not restart from its handoff. Paused; /autopilot to see it.')
      return result
    }

    const now = await $.clock.now()
    const usage = await $.session.usage().catch(() => null)
    const percent = usage?.context.percent ?? null
    const calledTools = toolsThisTurn > 0

    // A turn with no tool calls never passed through the mid-turn check.
    const limitInstruction = await applyLimits($, usage?.rateLimits ?? [], now)
    if (limitInstruction) {
      queue($, limitInstruction)
      return result
    }

    // The evaluator writes its verdict as the turn ends: a met goal ends the run.
    if (run.goal && isGoalSet && (run.phase === 'running' || run.phase === 'resuming') && (await isGoalMet($))) {
      await finishOnGoal($)
      return result
    }

    // The session says its role's work is complete: hand back rather than nudge on.
    if ((run.phase === 'running' || run.phase === 'resuming') && isDoneAnswer(e.answer)) {
      await log($, `the session reported its work complete: ${e.answer.replace(/\s+/g, ' ').slice(0, 160)}`)
      const instruction = await enterFinal($, 'done')
      if (instruction) queue($, instruction)
      return result
    }

    const action = afterTurn(run, now, percent, calledTools, ceiling)

    if (action === 'continue') {
      run.idleTurns = calledTools ? 0 : run.idleTurns + 1
      await save($)
      if (!run) return result
      // With a goal set, its own loop starts the next turn; autopilot only watches.
      // Otherwise a pending prompt (a ping, the drain) is the next prompt instead of the nudge.
      if (run.goal && isGoalSet) watchGoal($)
      else if (!(await flushPending($, 'turn'))) queue($, CONTINUE_PROMPT)
    }
    if (action === 'resume-done') {
      run.phase = 'running'
      run.idleTurns = 0
      await readCeiling($)
      await save($)
      await log($, `resumed from the handoff at ${percent ?? '?'}% context; next handoff at ${effectiveTrigger(run, ceiling)}%`)
      // With a goal: setting it again starts the next turn, so no prompt of ours.
      // Otherwise what waited through the restart goes first.
      if (!run) return result
      if (run.goal) await setGoal($)
      else if (!(await flushPending($, 'turn'))) queue($, CONTINUE_PROMPT)
    }
    if (action === 'wrapup') {
      run.phase = 'wrapping'
      await save($)
      await log($, `context ${percent ?? '?'}% (trigger ${effectiveTrigger(run, ceiling)}%): handoff and restart requested`)
      queue($, wrapupPrompt(run, percent))
    }
    if (action === 'final') {
      const instruction = await enterFinal($, now >= run.until ? 'time' : 'restarts')
      if (instruction) queue($, instruction)
    }
    if (action === 'pause') {
      run.phase = 'paused'
      await clearGoal($)
      await save($)
      await log($, 'paused: two turns in a row without progress')
      $.ui.toast('Autopilot paused: no progress for two turns. /autopilot to see it, or start it again.')
    }
    if (action === 'finish') {
      const reason = run.finalReason
      await clearGoal($)
      await log($, `finished (${reason ?? 'done'}): handed back to the person`)
      // A time-out or used-up restarts can be undone for a while: keep the run as it ended.
      if (isGraceEligible(reason)) {
        const record: FinishedRecord = { run: { ...run, phase: 'final' }, finishedAt: now }
        await $.store.set(finishedKey(sessionId), record).catch(() => undefined)
      }
      run = null
      await save($)
      $.ui.toast(
        reason === 'week'
          ? 'Autopilot STOPPED: weekly token limit. Handoff written; it is waiting for you.'
          : 'Autopilot finished and handed back to you. The handoff and the log hold what it did.',
      )
    }

    return result
  })
}
