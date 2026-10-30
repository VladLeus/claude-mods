/**
 * The runner of /cadre init (D-43, D-45, D-58, D-105, D-230, A1), a layer 11 module: runInit, the one place init
 * performs its effects. It starts from initialState, shows each state's outputs in order, performs the state's one
 * effect (an ask through askOnce, a host operation, or a legacy step through today's step function) and feeds what
 * it gave to nextStage, until an end effect gives the reply. On Confirm of a plain init the apply writes through the
 * HostIo its InitOptions hold; a --dry-run holds no host, so it writes and runs nothing. register.tsx and the tests
 * import it, and no init module does.
 */
import type { HostIo, InitIo } from '../../types'
import { initGuard } from '../guards/repo'
import { gatherScans } from '../scan/gather'
import { listSessions, scanHistory } from '../scan/history'
import { askOnce, noteLine, showBlock } from '../ui/ask'
import { goBack, teamStep } from './flow'
import { applyConfirmed } from './initapply'
import { planStep } from './initplan'
import { initialState, nextStage } from './machine'
import type { Answer, Effect, IoCall, IoResult, LegacyResult, LegacyStep, Output } from './state'
import { launchStartStep } from './stages/launch'

/**
 * How `/cadre init` runs (D-105, T-03-16): --dry-run prints the plan and holds no host, so it can neither write nor
 * run; plain init writes the plan through `host` after Confirm.
 */
export type InitOptions = { readonly dryRun: true } | { readonly dryRun: false; readonly host: HostIo }

/** Shows one output of a state (D-133): a side-pane block (showBlock), a note (noteLine), or one line logged as is. */
async function showOutput(io: InitIo, output: Output): Promise<void> {
  switch (output.kind) {
    case 'show':
      return showBlock(io, output.block.key, output.block.lines)
    case 'note':
      return noteLine(io, output.line)
    case 'log':
      return io.log(output.text)
    default: {
      const unreachable: never = output
      return unreachable
    }
  }
}

/**
 * Performs one host operation of a stage (D-230): the guard (initGuard), the scans (gatherScans), the listing of the
 * session folder (listSessions) or the history scan (scanHistory).
 */
async function performIo(io: InitIo, call: IoCall): Promise<IoResult> {
  switch (call.id) {
    case 'guard':
      return { id: 'guard', result: await initGuard(io, 'init') }
    case 'scan':
      return { id: 'scan', result: await gatherScans(io, call.locations, call.readUserMcp) }
    case 'list-sessions':
      return { id: 'list-sessions', result: await listSessions(io, call.dir) }
    case 'scan-history':
      return { id: 'scan-history', result: await scanHistory(io, call.dir, call.sessions) }
    default: {
      const unreachable: never = call
      return unreachable
    }
  }
}

/**
 * Runs one legacy step with today's step function and the draft fields it carries (D-230, until 02.1-26): the role
 * steps from the proposal, the launcher start, the review's plan (planStep) and its go-backs (goBack), and Confirm's
 * apply through the run's host, which a --dry-run does not hold.
 */
async function performLegacy(io: InitIo, options: InitOptions, step: LegacyStep): Promise<LegacyResult> {
  switch (step.id) {
    case 'team':
      return { id: 'team', result: await teamStep(io, step.base, step.base.proposal, null) }
    case 'launch':
      return { id: 'launch', result: await launchStartStep(io, step.root, step.roles) }
    case 'plan':
      return { id: 'plan', result: await planStep(io, step.input) }
    case 'go-back':
      return { id: 'go-back', result: await goBack(io, step.draft, step.item) }
    case 'apply':
      return { id: 'apply', result: options.dryRun ? null : await applyConfirmed(io, options.host, step.reviewed) }
    default: {
      const unreachable: never = step
      return unreachable
    }
  }
}

/** Performs a state's effect (D-230): an ask through askOnce (null when dismissed), a host operation, a legacy step. */
async function perform(
  io: InitIo,
  options: InitOptions,
  effect: Exclude<Effect, { readonly kind: 'end' }>,
): Promise<Answer> {
  switch (effect.kind) {
    case 'ask':
      return { kind: 'answer', text: await askOnce(io, effect.question, effect.spec) }
    case 'io':
      return { kind: 'io', result: await performIo(io, effect.call) }
    case 'legacy':
      return { kind: 'legacy', result: await performLegacy(io, options, effect.step) }
    default: {
      const unreachable: never = effect
      return unreachable
    }
  }
}

/**
 * `/cadre init`. It runs the guard before it reads or asks anything (initGuard), asks the ~/.claude.json consent
 * (consentStage), runs the scans and shows them with their warnings, then runs the history stage (historyStage), which
 * asks before it reads any session transcript and keeps names and counts only (SCAN-03, D-59), then the role steps
 * (teamStep): the roles and their frameworks, the recommendations (ROLE-03), the security plugins a team with a
 * Security role misses (decision #39), the autopilot duration once for every role, each role's model and effort, the
 * MCP servers and skills, the instructions and memories (instructionsStep: the content consent, then the instruction
 * parts or the whole-file questions; G-02-1f), the carried env names, the autonomy hunks of the frameworks in use, and
 * the claude-md-management install when a role got a built file and it is missing (D-141). It then asks the git policy
 * (policyStage) and, once for the repo, where the launchers start (launchStartStep), shows the one final review with
 * every role's scope card for that start (the one place the cards are shown; reviewLines, ROLE-06, A5) and the exact
 * file plan, each role's built CLAUDE.md included, where the person confirms or goes back to change one item
 * (reviewStage, D-43). --dry-run then replies with the confirmed plan and the note that nothing was written, and
 * installs nothing (D-82); plain init writes it (applyConfirmed, D-105), asking only Keep mine or Take new for each
 * conflicted file (D-67), running the accepted hunks first, then installing the plugins answered Install from the home
 * folder, and writing the plan made again from the disk (D-120), with the improver pass on each built role file before
 * the manifest (D-141), and replies with the plan as written and what the apply did (initReplyText). Every step gives a
 * StepResult (A1): runInit checks its kind before it uses the value, and for a cancelled step prints the reason as its
 * own line and answers cancelledReply with the step's reason (D-45), so only values the person accepted reach the steps
 * after it, and nothing is written or installed before Confirm. Every answer lives in memory for this one run, and
 * nothing is kept for the next (D-45, D-82). The order, the merges and the cancels are the stage machine's
 * (init/machine, D-230): runInit only shows each state's outputs, performs its effect and feeds the answer back.
 */
export async function runInit(io: InitIo, options: InitOptions): Promise<string> {
  let state = initialState(options.dryRun)
  for (;;) {
    for (const output of state.outputs) await showOutput(io, output)
    const { effect } = state
    if (effect.kind === 'end') return effect.reply
    state = nextStage({ ...state, outputs: [] }, await perform(io, options, effect))
  }
}
