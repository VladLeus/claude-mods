import type { EngineInterface, Register } from 'claude-code'

import type { FinalReason, Run, TokenWindow } from '../types'
import {
  CONTINUE_PROMPT,
  DEFAULT_CEILING,
  DEFERRED_NOTE,
  FULL_WAIT_TOOL,
  RESTART_TOOL,
  RESUME_AFTER_WAIT_PROMPT,
  WAIT_REASONS,
  WAIT_TOOL,
  afterTurn,
  askAnswer,
  autoAnswersQuestions,
  effectiveTrigger,
  endsWait,
  finalPrompt,
  followsNewSessionId,
  formatLeft,
  goalState,
  goalVerdictsFromRows,
  identityFromRows,
  isDoneAnswer,
  isValidHandoffPath,
  kickoffPrompt,
  limitAction,
  namedSkills,
  parseCommand,
  parseWaitInput,
  resolveHandoffPath,
  restartsText,
  roleSection,
  shouldDropStopBlock,
  triggerCeiling,
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
const autopilotDir = () => `${home}/.claude/autopilot`
const clockTime = (ms: number) => new Date(ms).toISOString().slice(11, 16)

async function save($: EngineInterface): Promise<void> {
  if (!sessionId) return
  if (!run) {
    await $.store.delete(storeKey(sessionId))
    if (home) await $.fs.write(`${autopilotDir()}/${sessionId}.json`, JSON.stringify({ isOn: false }))
    return
  }
  await $.store.set(storeKey(sessionId), run)
  if (!home) return
  // Read by the fleet dashboard for its badge.
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
    }),
  )
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
 * run's own /clear (phase restarting) moves it to the new id; any other new
 * id is another conversation, which the run does not drive: it stays stored
 * under its old id, and the new id's own run, if any, is loaded.
 */
async function syncId($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (id === sessionId) return
  const previous = sessionId
  sessionId = id
  if (run && followsNewSessionId(run.phase)) {
    if (previous) await $.store.delete(storeKey(previous))
    await save($)
    return
  }
  run = ((await $.store.get(storeKey(id))) as Run | undefined) ?? null
}

/** Moves the run to its final phase; the goal loop stops so it cannot outrun the handoff. */
async function enterFinal($: EngineInterface, reason: FinalReason): Promise<string | null> {
  if (!run) return null
  run.phase = 'final'
  run.finalReason = reason
  // A declared wait ends with the run's last stage (the time running out while awaiting).
  run.awaiting = null
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
  await log($, `5-hour token window at ${run.fiveHourStop}%+: parked until ${clockTime(action.waitUntil)} UTC`)
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
  const check = awaiting.timeoutAt ? ` · checks at ${clockTime(awaiting.timeoutAt)} UTC` : ''

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

function statusText(now: number): string {
  if (!run) return 'Autopilot is off.'

  return [
    `Autopilot: ${run.phase}${run.waitUntil ? ` until ${clockTime(run.waitUntil)} UTC` : ''} · ${formatLeft(run.until - now)} left · handoff at ${effectiveTrigger(run, ceiling)}% (asked ${run.threshold}%, ceiling ${ceiling}% below auto-compact) · restarts ${restartsText(run)}`,
    ...waitingLines(now),
    `Token limits: park at ${run.fiveHourStop}% of the 5-hour window, stop at ${run.weekStop}% of the week`,
    ...(run.askUser === true ? ['Asks the person: critical only'] : []),
    `Role: ${run.role}`,
    ...(run.skills.length ? [`Skills recognised in the role: ${run.skills.map(name => `/${name}`).join(', ')}`] : []),
    ...(run.goal ? [`Goal: ${run.goal}${isGoalSet ? '' : ' (not set right now)'}`] : []),
    home ? `Log: ${autopilotDir()}/${sessionId}.log` : 'Log: none (HOME is not set)',
  ].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const rawHome = (await $.env.get('HOME')) ?? ''
    home = rawHome.startsWith('/') ? rawHome : ''
    // State and logs are the person's alone: the folder is closed to other users.
    if (home) {
      await $.process.run(['/bin/mkdir', '-p', autopilotDir()]).catch(() => undefined)
      await $.process.run(['/bin/chmod', '700', autopilotDir()]).catch(() => undefined)
    }
    sessionId = await $.session.id()
    run = ((await $.store.get(storeKey(sessionId))) as Run | undefined) ?? null
    await readCeiling($)

    await $.command.register({
      name: 'autopilot',
      description: 'Run this session on autopilot with a fixed role; no args shows status, "0 0 stop" hands back',
      argumentHint: '<time> <threshold%> [max restarts] "<role>" [--goal "…"] [--5h 95] [--week 80] [--ask-user] | 0 0 stop',
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

    // Time and the 5-hour reset can come while the session sits idle (or after a reload lost the timers).
    $.clock.every(30_000, () => {
      void (async () => {
        await syncId($)
        if (!run || isTurnRunning) return
        const now = await $.clock.now()
        if ((run.phase === 'running' || run.phase === 'waiting' || run.phase === 'awaiting') && now >= run.until) {
          const instruction = await enterFinal($, 'time')
          if (instruction) queue($, instruction)
          return
        }
        if (run.phase === 'waiting' && run.waitUntil && now >= run.waitUntil) await wake($)
        await checkWaitTimeout($, now)
      })()
    })

    return next(e)
  })

  on('command.run', { command: 'autopilot' }, async ($, e) => {
    await syncId($)
    const now = await $.clock.now()
    const command = parseCommand(e.args)

    if (command.kind === 'status') return { text: statusText(now) }
    if (command.kind === 'error') return { text: command.message }
    if (command.kind === 'stop') {
      if (run) await log($, 'stopped by the person')
      await clearGoal($)
      run = null
      await save($)
      $.ui.status(undefined)

      return { text: 'Autopilot is off. You have the wheel.' }
    }

    const limit = await readCeiling($)
    const capNote =
      command.threshold > limit
        ? `\nNote: you asked for ${command.threshold}%, but auto-compact in this session leaves room for a handoff only up to ${limit}% (auto-compact minus 10 points), so ${limit}% is used. To get exactly ${command.threshold}% next time, raise autoCompactWindow in ~/.claude/settings.json.`
        : ''

    const [identity, commands] = await Promise.all([readIdentity($), $.command.list().catch(() => [])])
    const skillNames = commands.filter(info => info.source !== 'builtin').map(info => info.name)
    run = {
      role: command.role,
      name: identity.name,
      color: identity.color,
      startedAt: now,
      until: now + command.durationMs,
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
    }
    await save($)
    await log(
      $,
      `started: ${formatLeft(command.durationMs)}, trigger ${command.threshold}%, restarts ${restartsText(run)}, 5h ${command.fiveHourStop}%, week ${command.weekStop}%${command.goal ? `, goal: ${command.goal}` : ''}${command.askUser ? ', asks the person: critical only' : ''}; role: ${command.role}`,
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

    return { text: `${statusText(now)}${capNote}\nStop any time with /autopilot 0 0 stop.` }
  }).catch(() => ({ text: 'Autopilot: the command failed; nothing changed. Try again.' }))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!run) return composed

    return {
      sections: [
        ...composed.sections,
        { id: 'autopilot:role', text: roleSection(run, await $.clock.now()), scope: 'session' as const },
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

  on('turn.start', async ($, e, next) => {
    isTurnRunning = true
    toolsThisTurn = 0
    turnSeq += 1
    await syncId($)
    // turn.start carries no agentId: it is the main loop's turn.
    await endWait($)
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
    const now = await $.clock.now()
    // Check, parse and flip before the first await: a parallel tool call may move the phase meanwhile.
    if (!run) return { deny: 'Autopilot is not driving right now: no wait needed.' }
    const phaseRefusal = waitPhaseRefusal(run.phase)
    if (phaseRefusal) return { deny: phaseRefusal }
    const isRepeat = run.phase === 'awaiting'
    const parsed = parseWaitInput(e, now, run.until)
    if (parsed.kind === 'error') return { deny: parsed.message }
    const refusal = waitRefusal(parsed.awaiting, run.askUser === true)
    if (refusal) {
      await log($, `wait refused (${parsed.awaiting.reason}): ${refusal}`)
      return { deny: refusal }
    }

    const previous = { phase: run.phase, awaiting: run.awaiting ?? null }
    run.phase = 'awaiting'
    run.awaiting = parsed.awaiting
    run.idleTurns = 0
    try {
      await save($)
      const timeout = parsed.awaiting.timeoutAt ? `, checks at ${clockTime(parsed.awaiting.timeoutAt)} UTC` : ', no timeout'
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
    const givenPath = String((e as unknown as { handoffPath?: unknown }).handoffPath ?? '')
    const root = await $.session.root()
    if (!isValidHandoffPath(root, givenPath)) {
      await log($, `restart refused: handoff path ${JSON.stringify(givenPath.slice(0, 300))} is not a .md file under thoughts/shared/handoffs/`)
      return {
        deny: `Refused: the handoff must be a .md file under ${root}/thoughts/shared/handoffs/ (no "..", no control characters). Write it there with /create-handoff-doc, then call ${RESTART_TOOL} with its path.`,
      }
    }
    const handoffPath = resolveHandoffPath(root, givenPath)
    if (!(await $.fs.exists(handoffPath))) {
      return { deny: `No handoff document at "${handoffPath}". Write it with /create-handoff-doc first, then call ${RESTART_TOOL} with the path to the handoff .md under thoughts/shared/handoffs/ (absolute or relative to the project root).` }
    }

    run.restarts += 1
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
      await log($, `question answered by autopilot (decide yourself): ${JSON.stringify(e).slice(0, 400)}`)
      return { deny: askAnswer(run.askUser === true) }
    }

    const ran = await next(e)
    if (ran.deny !== undefined) {
      if (!isAway) return ran
      await log($, `deferred (refused by the permission mode): ${e.tool}: ${ran.deny.slice(0, 300)}`)
      return { deny: `${ran.deny}\n\n${DEFERRED_NOTE}` }
    }

    const usage = await $.session.usage().catch(() => null)
    const percent = usage?.context.percent ?? null
    const now = await $.clock.now()

    // Token limits come before the context trigger.
    const limitInstruction = await applyLimits($, usage?.rateLimits ?? [], now)
    if (limitInstruction) return { ...ran, context: [...(ran.context ?? []), limitInstruction] }

    // Parallel tool calls finish together: decide and flip the phase with no
    // await in between, so only the first of them carries the instruction.
    const action = wrapMidTurn(run, now, percent, ceiling)
    if (!action) return ran
    const reason = now >= run.until ? 'time' : 'restarts'
    run.phase = action === 'wrapup' ? 'wrapping' : 'final'
    if (action === 'final') run.finalReason = reason
    await save($)
    await log($, `${action} requested mid-turn at ${percent ?? '?'}% context (trigger ${effectiveTrigger(run, ceiling)}%)`)
    if (action === 'final') await clearGoal($)
    const instruction = action === 'wrapup' ? wrapupPrompt(run, percent) : finalPrompt(run, reason)

    return { ...ran, context: [...(ran.context ?? []), instruction] }
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
      // With a goal set, its own loop starts the next turn; autopilot only watches.
      if (run.goal && isGoalSet) watchGoal($)
      else queue($, CONTINUE_PROMPT)
    }
    if (action === 'resume-done') {
      run.phase = 'running'
      run.idleTurns = 0
      await readCeiling($)
      await save($)
      await log($, `resumed from the handoff at ${percent ?? '?'}% context; next handoff at ${effectiveTrigger(run, ceiling)}%`)
      // With a goal: setting it again starts the next turn, so no prompt of ours.
      if (run.goal) await setGoal($)
      else queue($, CONTINUE_PROMPT)
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
