import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  AskContext,
  FactsPort,
  HostIo,
  IdentityRunResult,
  InitIo,
  OpenQuestion,
  PaneState,
  PortRead,
} from '../types'
import { parseCommand } from './command/command'
import { helpText } from './command/usage'
import { isObject } from './core/json'
import { detectText } from './detect/report'
import { runEpic } from './epic/create'
import { runEpicDone } from './epic/done'
import { isRuntimeIdentityArgv } from './framework/gsd/identity'
import { detectRefusal } from './guards/refusals'
import { consentedGsdCheck, runInit } from './init/run'
import type { InitOptions } from './init/run'
import { CHANGE_SOMETHING_LABEL } from './init/stages/review'
import { setMissingSlotSink, t } from './locales/t'
import { runRegen } from './regen/run'
import type { RegenOptions } from './regen/run'
import { collectFacts, collectGsdIdentity, locationsOf, rootUnknownFacts } from './scan/facts/collect'
import { normalizeFacts } from './scan/facts/normalize'
import { pluginVersionOf, portProbeOf, portTextOf } from './scan/port-read'
import { runStart } from './start/run'
import { runStatus } from './status/run'
import { paneQuestionText } from './ui/ask'
import { paneBlockOf, paneColumns, panePlacement, paneRows, paneSpans, questionScroll } from './ui/pane'
import { answersFromNotes, dialogPlan, latestColumns, tuiTranscriptRows } from './ui/preview'
import { surfaceOf } from './ui/surface'
import type { Surface } from './ui/surface'

/** The id of the cadre init side pane (D-133). */
const PANE = 'cadre-init'
/** The title the cadre init side pane opens with (D-133). */
const PANE_TITLE = t('register.paneTitle')
/** The pane state with no question open and no step running: the pane draws its empty frame (D-303, D-304). */
const IDLE_PANE: PaneState = { open: null, loader: null }
/**
 * The one value the cadre init pane draws (D-303): the question cadre has open now and the long step a run on a pane
 * surface waits for, written in one update per change, by the init port's ask, its answer and its progress and by the
 * run's start and end, and read once per drawing; the pane draws the open question's own context, else the loader
 * alone, else its empty frame (paneBlockOf, D-299, D-301).
 */
const paneState = atom({ plugin: 'cadre', key: 'pane' }, IDLE_PANE)
/**
 * The placement the last terminal render of the cadre init pane reported (D3); null before any. A run resets it when
 * it opens the pane and clears it when it closes the pane, so a dialog after the run never carries the pane.
 */
let lastPlacement: 'dock' | 'inline' | null = null
/**
 * The terminal's columns the last `/cadre` command ran with (CommandPresentation, D-231), as the event gave them; null
 * before any. The preview of a dialog option wraps its lines to them less the dialog's option column when no terminal
 * drawing reported a width since (latestColumns).
 */
let presentationColumns: unknown = null
/**
 * The terminal's columns the newest terminal ui.render reported since the last `/cadre` command (#163), as the event
 * gave them; null before any. The preview of a dialog option wraps to them first (latestColumns).
 */
let viewportColumns: unknown = null
/**
 * Where the last `/cadre` command shows its context (D-208), as the command.run hook decided it before anything
 * opened; a pane surface before any. The AskUserQuestion hook previews the open question's context on the TUI default.
 */
let runSurface: Surface = 'pane'

/** How long the user-level runtime identity call may run before it is given up. */
const IDENTITY_TIMEOUT_MS = 10_000
/**
 * What runIdentity answers for an argv that is not the one runtimeIdentityArgv builds for its cwd: could-not-run, as
 * for a call that threw, and the host is never asked (E4).
 */
const REFUSED_IDENTITY_RUN: IdentityRunResult = { stdout: null, problem: 'could-not-run' }
/** The most tokens one model completion for init may answer with (D-83). */
const COMPLETE_MAX_TOKENS = 2048
/** How long one model completion for init may take before it is given up (D-83). */
const COMPLETE_TIMEOUT_MS = 60_000

/**
 * The runtime identity call, run with the GSD folder as its working folder so it never runs in the repo (WR-01). A
 * non-zero exit gives no stdout and no problem. Any throw (node missing, a timeout, a refusal) gives `could-not-run`;
 * the error itself is never read (IN-05).
 */
async function identityRun($: EngineInterface, argv: readonly string[], cwd: string): Promise<IdentityRunResult> {
  try {
    const result = await $.process.run(argv, { cwd, timeoutMs: IDENTITY_TIMEOUT_MS })

    return { stdout: result.exitCode === 0 ? result.stdout : null, problem: null }
  } catch {
    return { stdout: null, problem: 'could-not-run' }
  }
}

/**
 * The `/cadre detect` reply. The locations are resolved first (D-39), then the refusal runs before any listing, read,
 * settings or process call (D-36): the file system root is always refused, and every root form, as given and as
 * resolved, is checked against every home form (WR-06). A GSD install found but not proven is asked about before its
 * own check runs (consentedGsdCheck, D-243).
 */
async function detectReply($: EngineInterface, isAdapters: boolean, io: InitIo): Promise<string> {
  const sessionRoot = await $.session.root().catch(() => null)
  if (sessionRoot === null) {
    const unknown = rootUnknownFacts()

    return detectText(normalizeFacts(unknown, null, unknown.root), isAdapters)
  }
  const locations = await locationsOf(factsPortOf($), sessionRoot)
  const refusal = detectRefusal([locations.givenRoot, locations.root], [locations.givenHome, locations.home])
  if (refusal !== null) return refusal

  const { raw, gsdUserDir } = await collectFacts(factsPortOf($), locations)
  const collected = { facts: normalizeFacts(raw, locations.configDir, locations.givenRoot), gsdUserDir }
  const checked = await consentedGsdCheck(io, collected, locations)

  return detectText(checked.facts, isAdapters)
}

/**
 * A file as the init port reads it (Pitfall 6). A file is read only when the host says the path is there and its stat
 * shows a regular file within `maxBytes`: a failed probe, a failed stat or a folder, FIFO or device is `unknown` and
 * never read. A read that fails is `unknown`; the text is checked again by its UTF-8 bytes.
 * The decisions are portProbeOf and portTextOf; this only asks the host.
 */
async function portRead($: EngineInterface, path: string, maxBytes: number): Promise<PortRead> {
  const isThere = await $.fs.exists(path).catch(() => null)
  const stat = isThere === true ? await $.fs.stat(path).catch(() => null) : null
  const before = portProbeOf(isThere, stat, maxBytes)
  if (before !== null) return before

  return portTextOf(await $.fs.read(path).catch(() => null), maxBytes)
}

/**
 * One command run's pane handle: whether it opened the cadre-init pane (D2), set when an init or regen run on a pane
 * surface opens it as it starts (openPane, D-324) and read once the run settles, where the run shows its context
 * (D-208), decided before anything opens, the context the TUI default printed last, whether the run set a status
 * line, and whether a step runs now.
 */
type PaneRun = {
  isOpened: boolean
  readonly surface: Surface
  /** The context the TUI default last printed above a dialog this run (WD-S4); null before any. */
  printed: AskContext | null
  /**
   * Whether the run set a status line on the TUI default, set by its first progress with a text and read once the run
   * settles, which then clears the line; a run that set none clears none (D-257, edge #2, U-11).
   */
  hasStatus: boolean
  /**
   * Whether a long step runs now: set by a progress with a text, cleared by progress(null), by each ask and by the
   * run's end. While it is set, a line the run logs on a pane surface is the loader's summary line (D-325).
   */
  isLoading: boolean
}

/**
 * What the TUI default does as a dialog opens: it clears the status line (D-232), then prints a context too long for
 * the preview as transcript rows right above the dialog, its title first, each line cleaned and uncut, once per
 * question: a question asked again with the context the run printed last prints nothing (tuiTranscriptRows, D-228,
 * WD-S4); the preview ends with how many lines it left out. A context that fits, and the Review, print nothing.
 */
function beforeTuiDialog($: EngineInterface, pane: PaneRun, context: AskContext | null): void {
  $.ui.status(undefined)
  const rows = tuiTranscriptRows(context, pane.printed)
  if (rows.length === 0) return
  for (const row of rows) $.ui.log(row)
  pane.printed = context
}

/**
 * The port one init run goes through (P8): plain closures over `$`, built here because `$` cannot cross into another
 * file, so the pure modules never see it. Every member except `ask` turns a host failure into null or unknown, never
 * into absent (statForWrite answers absent only when the host says the path is not there), and none reads an error
 * message. `ask` rejects when the person dismisses the dialog (D-45); it writes the question with its header, context
 * and typed-answer flag into the pane state in one update before the dialog, no loader with it, and the idle state in
 * one update after it (D-303), scrolls a pane the run opened back to its start for each question (questionScroll,
 * D-209; a scroll the host refuses is swallowed), and gives the dialog only its options, header and multi-select
 * (D-203, D-229). On a pane surface it asks, and keeps as the open question's text, the question's sentence and one
 * context line (paneQuestionText, D-255), so the dialog hook still pairs the dialog with it. `show` draws nothing on
 * any surface: it stays for the port (D-326), as the pane draws only the open question's context or the loader
 * (D-299). On a pane surface `progress` writes the step's label and summary as the loader in one update, which the
 * pane draws alone between questions (D-301, D-327), and `log` writes a line logged while that step runs as the
 * loader's summary line in one update and prints nothing (D-325, OC-03-N); a line logged with no step running goes to
 * the transcript. A state write the host refuses is swallowed, so it never cancels init (D-133, T-02-50). The pane
 * itself is opened by the command handler as an init or regen run starts (openPane, D-324), which also writes the idle
 * state and closes the pane once the run settles (D2, D-304). On the TUI default `progress` sets the one status line,
 * the label alone (`$.ui.status`), `log` logs every line, and `ask` clears the status line before each dialog (D-232)
 * and prints a context too long for the preview above it (beforeTuiDialog, D-228).
 */
function initIoOf($: EngineInterface, pane: PaneRun): InitIo {
  return {
    ask: async (question, spec) => {
      const { options, header, multiSelect, context, acceptsTyped } = spec
      // A pane surface asks the sentence and one context line, the pane holding the rest (D-255); the TUI default and
      // a run with no surface ask the question as given.
      const text = pane.surface === 'pane' ? paneQuestionText(question, context ?? null) : question
      const open: OpenQuestion = {
        question: text,
        header: header ?? null,
        context: context ?? null,
        acceptsTyped: acceptsTyped === true,
      }
      // One write puts the question in the pane state with no loader (D-303); the pane draws only its context (D-299).
      // No step runs while it is open, so a line logged after it goes to the transcript (D-325).
      pane.isLoading = false
      await update($, paneState, () => ({ open, loader: null })).catch(() => undefined)
      // Each new question scrolls an open pane back to its start (D-209); a scroll the host refuses never blocks it.
      const scroll = questionScroll(PANE, open, pane.isOpened)
      if (scroll !== null) await $.ui.scroll(scroll).catch(() => undefined)
      if (pane.surface === 'tui-default') beforeTuiDialog($, pane, open.context)
      try {
        const dialog = {
          options,
          ...(header === undefined ? {} : { header }),
          ...(multiSelect === undefined ? {} : { multiSelect }),
        }

        return await $.ui.ask(text, dialog)
      } finally {
        await update($, paneState, () => IDLE_PANE).catch(() => undefined)
      }
    },
    // A line logged on a pane surface while a step runs is the loader's summary line and is not printed (D-325, the
    // OC-03-N pick); a state write the host refuses is swallowed. Any other line goes to the transcript.
    log: text => {
      if (pane.surface === 'pane' && pane.isLoading) {
        void update($, paneState, state =>
          state.loader === null ? state : { ...state, loader: { ...state.loader, summary: text } },
        ).catch(() => undefined)
        return
      }
      $.ui.log(text)
    },
    // Kept for the port (D-326): the pane draws only the open question's context or the loader (D-299).
    show: async () => undefined,
    // Progress is one status line on the TUI default, the label alone (D-232), and, on a pane surface, the loader in
    // the pane state, the label and the step's summary drawn alone between questions (D-301, D-327); a state write the
    // host refuses is swallowed. A text says a step runs, null that none does (D-325).
    progress: async (text, summary) => {
      pane.isLoading = text !== null
      if (pane.surface === 'tui-default') {
        if (text !== null) pane.hasStatus = true
        $.ui.status(text ?? undefined)
        return
      }
      if (pane.surface !== 'pane') return
      await update($, paneState, state =>
        text === null
          ? { ...state, loader: null }
          : { open: state.open, loader: { label: text, summary: summary ?? null } },
      ).catch(() => undefined)
    },
    complete: async (prompt, system) => {
      const model = await $.session.model().catch(() => null)
      if (model === null) return null
      const result = await $.model
        .complete({
          model,
          prompt,
          system,
          maxTokens: COMPLETE_MAX_TOKENS,
          timeoutMs: COMPLETE_TIMEOUT_MS,
          effort: 'low',
        })
        .catch(() => null)

      return result !== null && result.isAnswered ? result.text : null
    },
    isInteractive: async () => {
      const surfaces = await $.session.surfaces().catch(() => null)

      return surfaces === null ? null : surfaces.length > 0
    },
    locations: async () => {
      const root = await $.session.root().catch(() => null)

      return root === null ? null : locationsOf(factsPortOf($), root)
    },
    facts: async locations => {
      const { raw, gsdUserDir } = await collectFacts(factsPortOf($), locations)

      return { facts: normalizeFacts(raw, locations.configDir, locations.givenRoot), gsdUserDir }
    },
    gsdIdentity: locations => collectGsdIdentity(factsPortOf($), locations).catch(() => null),
    sessionId: () => $.session.id().catch(() => null),
    now: () => $.clock.now().catch(() => null),
    cadreVersion: async () => {
      const text = await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`).catch(() => null)

      return typeof text === 'string' ? pluginVersionOf(text) : null
    },
    list: path => $.fs.list(path).catch(() => null),
    stat: path => $.fs.stat(path, { resolve: true }).catch(() => null),
    statForWrite: async path => {
      const stat = await $.fs.stat(path, { resolve: true }).catch(() => null)
      if (stat !== null) return stat
      const isThere = await $.fs.exists(path).catch(() => null)

      return isThere === false ? 'absent' : 'failed'
    },
    read: (path, maxBytes) => portRead($, path, maxBytes),
    ancestors: names => $.fs.ancestors({ names: [...names] }).catch(() => null),
    settings: source => $.settings.read({ source }).catch(() => null),
    commands: () => $.command.list().catch(() => null),
    tools: () => $.tool.list().catch(() => null),
  }
}

/**
 * The read port the facts collector goes through (MUST 18): plain closures over `$`, built here because `$` cannot
 * cross into another file. Every member but runIdentity maps a host failure to null and never reads an error text.
 * runIdentity is identityRun, the one gated call, and it runs only the exact argv runtimeIdentityArgv builds for its
 * cwd (isRuntimeIdentityArgv); any other argv answers REFUSED_IDENTITY_RUN without asking the host (E4). The env
 * names are string literals, as the host reads only literal names: one case per name FactsPort allows, and any other
 * name throws (E5).
 */
function factsPortOf($: EngineInterface): FactsPort {
  return {
    exists: path => $.fs.exists(path).catch(() => null),
    list: path => $.fs.list(path).catch(() => null),
    read: path => $.fs.read(path).catch(() => null),
    stat: path => $.fs.stat(path, { resolve: true }).catch(() => null),
    env: async name => {
      switch (name) {
        case 'HOME':
          return $.env.get('HOME').catch(() => null)
        case 'CLAUDE_CONFIG_DIR':
          return $.env.get('CLAUDE_CONFIG_DIR').catch(() => null)
      }
      throw new Error(`factsPortOf: no env read for ${name satisfies never}`)
    },
    settings: source => $.settings.read({ source }).catch(() => null),
    runIdentity: async (argv, cwd) => {
      if (!isRuntimeIdentityArgv(argv, cwd)) return REFUSED_IDENTITY_RUN

      return identityRun($, argv, cwd)
    },
  }
}

/**
 * The write and run port apply and `/cadre start` run through, beside InitIo: plain closures over `$`, built only for
 * plain init, plain regen, /cadre start and /cadre status, which takes its run member only (runStatus is typed
 * `Pick<HostIo, 'run'>`, #63 A3). InitIo never gets these members, so the paths given only an InitIo (detect, every
 * --dry-run, every refusal and cancel) get no HostIo write or run port; the only run they can make is the gated GSD
 * runtime identity call, and only after the user said Yes (D-243, T-03-01).
 * Every member maps a host failure to false or null and never reads an error text. A run passes its cwd, stdin and env
 * only when given; the env names are string literals, as the host reads only literal names.
 */
function hostIoOf($: EngineInterface): HostIo {
  return {
    write: (path, text) => $.fs.write(path, text).then(() => true, () => false),
    run: async (argv, options) => {
      const { cwd, stdin, env, timeoutMs } = options
      const init = {
        timeoutMs,
        ...(cwd === undefined ? {} : { cwd }),
        ...(stdin === undefined ? {} : { stdin }),
        ...(env === undefined ? {} : { env: { ...env } }),
      }
      try {
        const { exitCode, stdout, stderr } = await $.process.run(argv, init)

        return { exitCode, stdout, stderr }
      } catch {
        return null
      }
    },
    env: async name => {
      const read = name === 'TMUX' ? $.env.get('TMUX') : $.env.get('TERM_PROGRAM')
      const value = await read.catch(() => null)

      return typeof value === 'string' && value !== '' ? value : null
    },
  }
}

/**
 * Opens the cadre-init pane as an init or regen run on a pane surface starts (D-324), before its first question, so
 * the ~/.claude.json consent shows its context: the pane state is written idle first, so the pane draws its empty
 * frame until a question opens or a step runs, the open is recorded in the run's pane handle (D2), and the placement
 * an earlier run reported is dropped (D3). A write or an open the host refuses is swallowed, so neither cancels the run
 * (T-02-50).
 */
async function openPane($: EngineInterface, pane: PaneRun): Promise<void> {
  await update($, paneState, () => IDLE_PANE).catch(() => undefined)
  pane.isOpened = true
  lastPlacement = null
  await $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
}

/**
 * The reply of one `/cadre` run: the subcommand parsed from `args`, run with an InitIo over `pane`. An init or regen
 * run on a pane surface opens the cadre-init pane as it starts (openPane, D-324); no other command opens it.
 */
async function commandReply($: EngineInterface, args: string, pane: PaneRun): Promise<{ text: string }> {
  const command = parseCommand(args)
  switch (command.kind) {
    case 'help':
      return { text: helpText(command.unknown) }
    case 'detect':
      return { text: await detectReply($, command.adapters, initIoOf($, pane)) }
    case 'init': {
      const { surface } = pane
      const options: InitOptions = command.dryRun
        ? { dryRun: true, surface }
        : { dryRun: false, host: hostIoOf($), surface }
      if (surface === 'pane') await openPane($, pane)

      return { text: await runInit(initIoOf($, pane), options) }
    }
    case 'regen': {
      const { id } = command
      const options: RegenOptions = command.dryRun ? { id, dryRun: true } : { id, dryRun: false, host: hostIoOf($) }
      if (pane.surface === 'pane') await openPane($, pane)

      return { text: await runRegen(initIoOf($, pane), options) }
    }
    case 'start':
      return { text: await runStart(initIoOf($, pane), hostIoOf($), { id: command.id, terminal: command.terminal }) }
    case 'status':
      return { text: await runStatus(initIoOf($, pane), hostIoOf($), { id: command.id }) }
    case 'epic': {
      const { key, title, terminal } = command

      return { text: await runEpic(initIoOf($, pane), hostIoOf($), { key, title, terminal }) }
    }
    case 'epic-done':
      return { text: await runEpicDone(initIoOf($, pane), hostIoOf($), { key: command.key, force: command.force }) }
    default: {
      const unreachable: never = command
      return unreachable
    }
  }
}

/**
 * Closes the cadre-init pane once the run that opened it settled (D2); a close the host refuses is swallowed. The
 * placement is cleared after it, so the model's own dialogs after the run get no preview of the pane (D3), and the
 * pane state is written idle, so the pane draws its empty frame (D-304); a write the host refuses is swallowed.
 */
async function closePane($: EngineInterface): Promise<void> {
  await $.ui.close({ id: PANE }).catch(() => undefined)
  lastPlacement = null
  await update($, paneState, () => IDLE_PANE).catch(() => undefined)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    // A locale slot with no value renders as {name} and its line goes to the debug log (D-224).
    setMissingSlotSink(text => void $.ui.log(text, { to: 'debug' }))
    await $.command.register({
      name: 'cadre',
      description: t('register.commandDescription'),
      argumentHint:
        'detect [--adapters] | init [--dry-run] | regen <id> [--dry-run] | ' +
        'start <id> [--terminal[=terminal|iterm|tmux]] | status <id> | ' +
        'epic <KEY> [title] [--terminal[=terminal|iterm|tmux]] | epic done <KEY> [--force]',
    })

    return next(e)
  })

  // A run decides its surface before it opens anything (D-208), and once it settles (finished, cancelled, refused or
  // thrown) no step runs any more (D-325), it writes the idle pane state, whatever its surface (D-304), clears the
  // status line when it set one (D-257, edge #2), and closes the cadre-init pane if it opened it (D2).
  on('command.run', { command: 'cadre' }, async ($, e) => {
    // A command a test kit runs, or one from a host that stamps no presentation, may carry none (previewColumns).
    const presentation: unknown = e.presentation
    presentationColumns = isObject(presentation) ? presentation.columns : null
    viewportColumns = null
    runSurface = surfaceOf(presentation, await $.session.surfaces().catch(() => null))
    const pane: PaneRun = { isOpened: false, surface: runSurface, printed: null, hasStatus: false, isLoading: false }
    try {
      return await commandReply($, e.args, pane)
    } finally {
      pane.isLoading = false
      await update($, paneState, () => IDLE_PANE).catch(() => undefined)
      try {
        if (pane.hasStatus) $.ui.status(undefined)
      } catch {
        // A status line the host cannot clear never fails the run's end.
      }
      if (pane.isOpened) await closePane($)
    }
  })

  // The cadre init side pane (D-133): the one block of its state (paneBlockOf), the own context of the question cadre
  // has open now, else the loader of the long step a run waits for, drawn alone, else its empty frame (D-299, D-301).
  // The state is read once, at the top, and the tree is built from that one snapshot (D-303), in the rows of paneRows
  // wrapped to the columns of the pane's body (paneColumns, D-231), coloured by paneSpans (D1). A terminal render
  // records where the pane is seated (D3) and the width it was drawn at (#163).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, paneState)
    const { Box, Text } = $.ui.resolve(e)
    if (e.surface === 'terminal') lastPlacement = panePlacement(e.props)
    if (e.surface === 'terminal' && isObject(e.viewport)) viewportColumns = e.viewport.columns
    const block = paneBlockOf(state)
    if (block === null) return <Text>{t('register.paneEmpty')}</Text>

    return (
      <Box flexDirection="column">
        {paneRows([block], paneColumns(e.props)).map((row, at) => (
          <Text key={at}>
            {row.text === ''
              ? ' '
              : paneSpans(row).map(span => (
                  <Text
                    {...(span.color === undefined ? {} : { color: span.color })}
                    {...(span.bold === true ? { bold: true } : {})}
                    {...(span.dim === true ? { dimColor: true } : {})}
                  >
                    {span.text}
                  </Text>
                ))}
          </Text>
        ))}
      </Box>
    )
  })

  // A drawn AskUserQuestion dialog on the terminal records the width it was drawn at (#163); it records the width only:
  // any dialog, cadre's or not, is drawn as the engine draws it (D-239).
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    if (e.surface === 'terminal' && isObject(e.viewport)) viewportColumns = e.viewport.columns

    return await next(e)
  })

  // The dialog of the question cadre has open is decided by dialogPlan (WD-S2); this hook reads the open question of
  // the pane state, which the init port's ask writes, and writes no state (R1, D-203, D-303). With no open question or
  // no plan the call passes through untouched, and so does its result (D-239). Else the dialog shows the plan's
  // questions, or the call's own when the plan has none, and notes typed in it become the answers of the plan's notes
  // (A3, ASKED #24). A deny, an error and a result of another shape pass through unchanged. Apart from the read of the
  // open question, the hook has no .catch on purpose: a hook that throws is skipped and next(e) runs in its place, a
  // fail-safe pass-through (C1).
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const raw: unknown = e.questions
    const open = (await read($, paneState).catch(() => null))?.open ?? null
    if (open === null) return await next(e)
    const columns = latestColumns(viewportColumns, presentationColumns)
    const plan = dialogPlan(raw, open, runSurface, lastPlacement, columns, CHANGE_SOMETHING_LABEL)
    if (plan === null) return await next(e)

    // withPreviews checked the shape of the questions before it rewrote them, so this boundary cast hides no
    // mismatch.
    const { questions, notes } = plan
    const r = await next(questions === null ? e : { ...e, questions: questions as typeof e.questions })
    if (r.deny !== undefined) return r
    if (r.isError === true) return r
    const resultValue: unknown = r.result
    const answers = answersFromNotes(notes, resultValue)
    if (answers === null) return r

    return { ...r, result: { ...r.result, answers } }
  })
}
