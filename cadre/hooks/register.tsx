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
import { settledWithin } from './core/settle'
import { detectText } from './detect/report'
import { runEpic } from './epic/create'
import { runEpicDone } from './epic/done'
import { isRuntimeIdentityArgv } from './framework/gsd/identity'
import { detectRefusal } from './guards/refusals'
import { consentedGsdCheck, runInit } from './init/run'
import type { InitOptions } from './init/run'
import { setMissingSlotSink, t } from './locales/t'
import { runRegen } from './regen/run'
import type { RegenOptions } from './regen/run'
import { collectFacts, collectGsdIdentity, locationsOf, rootUnknownFacts } from './scan/facts/collect'
import { normalizeFacts } from './scan/facts/normalize'
import { pluginVersionOf, portProbeOf, portTextOf } from './scan/port-read'
import { runStart } from './start/run'
import { runStatus } from './status/run'
import { paneBlockOf, paneColumns, paneDrawn, panePlacement, questionScroll } from './ui/pane'
import { answersFromNotes, latestColumns } from './ui/preview'
import type { SurfaceEffect, SurfaceModule } from './ui/surfaces/contract'
import { PANE_DESKTOP } from './ui/surfaces/pane-desktop'
import { surfaceModuleOf } from './ui/surfaces/select'

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
 * The body columns the newest Pane render reported (paneColumns, D-292); null before any, and reset to null at each
 * `/cadre` command, so a run never pages to the width of an earlier one.
 */
let paneBodyColumns: number | null = null
/**
 * The surface module the last `/cadre` command selected (surfaceModuleOf, D-208, D-353), as the command.run hook
 * selected it before anything opened; the desktop pane before any. The AskUserQuestion hook asks it for the dialog of
 * the open question (dialogPlan).
 */
let runSurface: SurfaceModule = PANE_DESKTOP

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
 * The longest a question waits for the pane scroll before it is asked (D-271, edge #1): a scroll that never settles
 * holds no question longer than this.
 */
const SCROLL_WAIT_MS = 2_000

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
 * One command run's pane handle: whether it opened the cadre-init pane (D2), set when an init or regen run opens it as
 * it starts, where the selected module asks for it (runStartEffects, openPane, D-324, D-353), and read once the run
 * settles, the module of the surface the run shows its context on (D-208, D-353), selected before anything opens,
 * whether the command came with a presentation (D-271), the context the TUI default printed last, whether the run set
 * a status line, and whether a step runs now.
 */
type PaneRun = {
  isOpened: boolean
  readonly surface: SurfaceModule
  /**
   * Whether the command came with a presentation, as a command a person ran does: on a host with no surfaces method
   * the run counts as interactive then (isInteractive, D-271, edge #11).
   */
  readonly hasPresentation: boolean
  /** The context the TUI default last printed above a dialog this run (WD-S4); null before any. */
  printed: AskContext | null
  /**
   * Whether the run set a status line, set by the first status effect with a text (the TUI default's progress, D-353)
   * and read once the run settles, which then clears the line; a run that set none clears none (D-257, edge #2, U-11).
   */
  hasStatus: boolean
  /**
   * Whether a long step runs now: set by a progress with a text, cleared by progress(null), by each ask and by the
   * run's end. The selected module reads it for each logged line: while it is set, a line the run logs on a pane
   * surface is the loader's summary line (logEffects, D-325, D-353).
   */
  isLoading: boolean
}

/**
 * The surfaces the session draws on, as the host answers them (D-271, edge #11): null when the host refuses to say,
 * and undefined when the call itself throws, as on a host with no surfaces method, so the caller can tell a host that
 * cannot say from one that never could and fall back to the command's presentation (surfaceModuleOf, isInteractive).
 */
async function surfacesRead($: EngineInterface): Promise<readonly string[] | null | undefined> {
  try {
    return await $.session.surfaces().catch(() => null)
  } catch {
    return undefined
  }
}

/**
 * Sets the status line to `text`, or clears it when `text` is undefined; a throw from the host is caught and ignored,
 * as a status line is cosmetic and never cancels init (D-271, edge #10).
 */
function safeStatus($: EngineInterface, text: string | undefined): void {
  try {
    $.ui.status(text)
  } catch {
    // A status line the host cannot set or clear changes nothing else (D-271).
  }
}

/**
 * Logs `text` to the transcript; a throw from the host is caught and ignored, as a transcript line is cosmetic and
 * never cancels init (D-271, edge #10).
 */
function safeLog($: EngineInterface, text: string): void {
  try {
    $.ui.log(text)
  } catch {
    // A line the host cannot log changes nothing else (D-271).
  }
}

/**
 * The effects of a logged line (logEffects, D-325, D-353), run at once, as the init port's log is synchronous: a
 * transcript line (safeLog), or the summary line of the loader shown now, written in one update the line does not wait
 * for, a write the host refuses swallowed (the OC-03-N pick). Any other effect is not one a logged line gives, and is
 * ignored.
 */
function runLogEffects($: EngineInterface, _pane: PaneRun, effects: readonly SurfaceEffect[]): void {
  for (const effect of effects) {
    if (effect.kind === 'transcript') safeLog($, effect.text)
    if (effect.kind !== 'loader-summary') continue
    const { text } = effect
    void update($, paneState, state =>
      state.loader === null ? state : { ...state, loader: { ...state.loader, summary: text } },
    ).catch(() => undefined)
  }
}

/**
 * Executes the host effects of the run's surface module in order (D-353), each as the run made it before the split:
 * the status line set, which marks that the run set one (D-257), or cleared (safeStatus, D-232); a transcript line and
 * the loader's summary line (runLogEffects, D-325); the context printed last above a dialog (WD-S4); the pane loader
 * written in one update, its label and summary, or cleared on a null label (D-301, D-327); the pane the run opened
 * scrolled back to its start for `open` (questionScroll, D-209), a scroll the host refuses swallowed and one that
 * never settles holding the question at most SCROLL_WAIT_MS (settledWithin, D-271); and the cadre-init pane opened as
 * an init or regen run starts (openPane, D-324). A status, log or state write the host refuses is swallowed, so no
 * cosmetic host failure cancels init (D-271, T-02-50).
 */
async function runEffects(
  $: EngineInterface,
  pane: PaneRun,
  effects: readonly SurfaceEffect[],
  open: OpenQuestion | null,
): Promise<void> {
  for (const effect of effects) {
    switch (effect.kind) {
      case 'status':
        if (effect.text !== null) pane.hasStatus = true
        safeStatus($, effect.text ?? undefined)
        break
      case 'transcript':
      case 'loader-summary':
        runLogEffects($, pane, [effect])
        break
      case 'printed':
        pane.printed = effect.context
        break
      case 'loader': {
        const { label, summary } = effect
        await update($, paneState, state =>
          label === null ? { ...state, loader: null } : { open: state.open, loader: { label, summary } },
        ).catch(() => undefined)
        break
      }
      case 'scroll-start': {
        const scroll = questionScroll(PANE, open, pane.isOpened)
        if (scroll !== null) await settledWithin($.ui.scroll(scroll), $.clock.sleep(SCROLL_WAIT_MS))
        break
      }
      case 'open-pane':
        await openPane($, pane)
        break
      default: {
        const unreachable: never = effect
        return unreachable
      }
    }
  }
}

/**
 * The port one init run goes through (P8): plain closures over `$`, built here because `$` cannot cross into another
 * file, so the pure modules never see it. Every member except `ask` turns a host failure into null or unknown, never
 * into absent (statForWrite answers absent only when the host says the path is not there), and none reads an error
 * message. `ask` rejects when the person dismisses the dialog (D-45); it writes the question with its header, context
 * and typed-answer flag into the pane state in one update before the dialog, no loader with it, and the idle state in
 * one update after it, whatever happens in between (D-303, D-271), and gives the dialog only its options, header and
 * multi-select (D-203, D-229). What differs by surface the run's selected module decides, and runEffects executes
 * (D-353): the text `ask` asks and keeps as the open question's text (askedText: on a pane surface the pane text of
 * the question's context, its sentence and summary, plus the page marker on a paged question, with the refusal line
 * on top of a refusal, paneQuestionText, D-255, D-310, so the dialog hook still pairs the dialog with it); what a
 * dialog does as it opens (dialogOpenEffects: a pane the run opened scrolls back to its start for each question,
 * questionScroll, D-209, a scroll the host refuses swallowed and one that never settles holding the question at most
 * SCROLL_WAIT_MS, D-271; the TUI default clears the status line, D-232, and prints a context too long for the preview
 * above the dialog, D-228); `progress` (progressEffects: on a pane surface the step's label and summary as the loader
 * in one update, which the pane draws alone between questions, D-301, D-327; on the TUI default the one status line,
 * the label alone, `$.ui.status`); and `log` (logEffects: on a pane surface a line logged while that step runs is the
 * loader's summary line, written in one update and not printed, D-325, OC-03-N; every other line goes to the
 * transcript). `show` draws nothing on any surface: it stays for the port (D-326), as the pane draws only the open
 * question's context or the loader (D-299). A state write the host refuses is swallowed, so it never cancels init
 * (D-133, T-02-50). The pane itself is opened by the command handler as an init or regen run starts (runStartEffects,
 * openPane, D-324), which also writes the idle state and closes the pane once the run settles (D2, D-304). A status or
 * log call the host throws on is ignored (safeStatus, safeLog), so no cosmetic host failure cancels init (D-271).
 */
function initIoOf($: EngineInterface, pane: PaneRun): InitIo {
  return {
    ask: async (question, spec) => {
      const { options, header, multiSelect, context, acceptsTyped, takesNote, endingLabels } = spec
      // The selected module decides the text the dialog asks (D-353): a pane surface asks the pane text of the
      // question's context, its sentence and summary, plus the page marker on a paged question (paneQuestionText,
      // D-310); the TUI default and a run with no surface ask it as given.
      const text = pane.surface.askedText(question, context ?? null)
      const open: OpenQuestion = {
        question: text,
        header: header ?? null,
        context: context ?? null,
        acceptsTyped: acceptsTyped === true,
        // A question that takes a typed answer takes a note too (D-270).
        takesNote: acceptsTyped === true || takesNote === true,
        // A pick of an option that ends the question stands over a typed note (D-350).
        ...(endingLabels === undefined ? {} : { endingLabels }),
      }
      // One write puts the question in the pane state with no loader (D-303); the pane draws only its context (D-299).
      // No step runs while it is open, so a line logged after it goes to the transcript (D-325).
      pane.isLoading = false
      await update($, paneState, () => ({ open, loader: null })).catch(() => undefined)
      // From here on the finally writes the idle state, so no host failure leaves the question open (D-271).
      try {
        // The preview is drawn at the newest width a terminal reported, as the dialog hook draws it (D-260).
        const columns = latestColumns(viewportColumns, presentationColumns)
        // What the dialog does as it opens is the selected module's (D-353): a pane scrolls back to its start for each
        // new question (D-209); the TUI default clears its status line and prints a context too long for the preview
        // above the dialog (D-228, D-232).
        await runEffects($, pane, pane.surface.dialogOpenEffects(open.context, pane.printed, columns), open)
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
    // The selected module decides a logged line (D-353): on a pane surface, while a step runs, it is the loader's
    // summary line and is not printed (D-325, the OC-03-N pick); a state write the host refuses is swallowed. Any
    // other line goes to the transcript.
    log: text => runLogEffects($, pane, pane.surface.logEffects(text, pane.isLoading)),
    // Kept for the port (D-326): the pane draws only the open question's context or the loader (D-299).
    show: async () => undefined,
    // The selected module decides the progress (D-353): one status line on the TUI default, the label alone (D-232),
    // and, on a pane surface, the loader in the pane state, the label and the step's summary drawn alone between
    // questions (D-301, D-327); a state write the host refuses is swallowed. A text says a step runs, null that none
    // does (D-325).
    progress: async (text, summary) => {
      pane.isLoading = text !== null
      await runEffects($, pane, pane.surface.progressEffects(text, summary ?? null), null)
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
    // A host with no surfaces method counts a command that came with a presentation as interactive, and cannot say
    // for one with none (D-271, edge #11).
    isInteractive: async () => {
      const surfaces = await surfacesRead($)
      if (surfaces === undefined) return pane.hasPresentation ? true : null

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
 * Opens the cadre-init pane as an init or regen run on a pane surface starts, the open-pane effect of its module
 * (D-324, D-353), before its first question, so the ~/.claude.json consent shows its context: the pane state is
 * written idle first, so the pane draws its empty frame until a question opens or a step runs, the open is recorded in
 * the run's pane handle (D2), and the placement an earlier run reported is dropped (D3). A write or an open the host
 * refuses is swallowed, so neither cancels the run (T-02-50).
 */
async function openPane($: EngineInterface, pane: PaneRun): Promise<void> {
  await update($, paneState, () => IDLE_PANE).catch(() => undefined)
  pane.isOpened = true
  lastPlacement = null
  await $.ui.open({ id: PANE, title: PANE_TITLE }).catch(() => undefined)
}

/**
 * The columns a page of the cadre-init pane is drawn at now on the surface of `surface` (its pageColumns, D-292,
 * D-353): from where the pane is seated, the dialog's preview columns and the body columns the newest Pane render
 * reported.
 */
function pageColumnsNow(surface: SurfaceModule): number | null {
  return surface.pageColumns(lastPlacement, latestColumns(viewportColumns, presentationColumns), paneBodyColumns)
}

/**
 * The reply of one `/cadre` run: the subcommand parsed from `args`, run with an InitIo over `pane`. An init or regen
 * run starts as the run's selected module says (runStartEffects, D-353): on a pane surface it opens the cadre-init
 * pane (openPane, D-324). Both read the page width before each step (pageColumnsNow, D-292) and, at each ask, where the
 * pane is seated, which the module's paged port reads, as no question is paged where the dialog previews it (paneSeat,
 * N-02); no other command opens the pane.
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
      const pageColumns = (): number | null => pageColumnsNow(surface)
      const options: InitOptions = command.dryRun
        ? { dryRun: true, surface, pageColumns, paneSeat: () => lastPlacement }
        : { dryRun: false, host: hostIoOf($), surface, pageColumns, paneSeat: () => lastPlacement }
      await runEffects($, pane, surface.runStartEffects(), null)

      return { text: await runInit(initIoOf($, pane), options) }
    }
    case 'regen': {
      const { id } = command
      const { surface } = pane
      const pageColumns = (): number | null => pageColumnsNow(surface)
      const options: RegenOptions = command.dryRun
        ? { id, dryRun: true, surface, pageColumns, paneSeat: () => lastPlacement }
        : { id, dryRun: false, host: hostIoOf($), surface, pageColumns, paneSeat: () => lastPlacement }
      await runEffects($, pane, surface.runStartEffects(), null)

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

  // A run selects its surface module once, before it opens anything (surfaceModuleOf, D-208, D-353), and once it
  // settles (finished, cancelled, refused or thrown) no step runs any more (D-325), it writes the idle pane state,
  // whatever its surface (D-304), clears the status line when it set one (D-257, edge #2), and closes the cadre-init
  // pane if it opened it (D2).
  on('command.run', { command: 'cadre' }, async ($, e) => {
    // A command a test kit runs, or one from a host that stamps no presentation, may carry none (previewColumns).
    const presentation: unknown = e.presentation
    presentationColumns = isObject(presentation) ? presentation.columns : null
    viewportColumns = null
    paneBodyColumns = null
    // A host with no surfaces method leaves them undefined: the surface comes from the presentation (D-271, edge #11).
    // The one selection point of the surface modules (D-353).
    runSurface = surfaceModuleOf(presentation, await surfacesRead($))
    const pane: PaneRun = {
      isOpened: false,
      surface: runSurface,
      hasPresentation: isObject(presentation),
      printed: null,
      hasStatus: false,
      isLoading: false,
    }
    // A slot with no value goes to the debug log of the session that ran the latest /cadre command (D-224, #19).
    setMissingSlotSink(text => void $.ui.log(text, { to: 'debug' }))
    try {
      return await commandReply($, e.args, pane)
    } finally {
      pane.isLoading = false
      await update($, paneState, () => IDLE_PANE).catch(() => undefined)
      // A status line the host cannot clear never fails the run's end (edge #2, D-271).
      if (pane.hasStatus) safeStatus($, undefined)
      if (pane.isOpened) await closePane($)
    }
  })

  // The cadre init side pane (D-133): the one block of its state (paneBlockOf), the own context of the question cadre
  // has open now, else the loader of the long step a run waits for, drawn alone, else its empty frame (D-299, D-301).
  // The state is read once, at the top, and the tree is built from that one snapshot (D-303), in the rows of the one
  // renderer, paneDrawn, wrapped to the columns of the pane's body (paneColumns, D-231) and styled by each row's role
  // (D-313); an empty row draws one space. A terminal render records where the pane is seated (D3) and the width it was
  // drawn at (#163), and every render the body columns a page is drawn at (paneBodyColumns, D-292).
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const state = await read($, paneState)
    const { Box, Text } = $.ui.resolve(e)
    if (e.surface === 'terminal') lastPlacement = panePlacement(e.props)
    if (e.surface === 'terminal' && isObject(e.viewport)) viewportColumns = e.viewport.columns
    const columns = paneColumns(e.props)
    paneBodyColumns = columns
    const block = paneBlockOf(state)
    if (block === null) return <Text>{t('register.paneEmpty')}</Text>

    return (
      <Box flexDirection="column">
        {paneDrawn(block, columns).map((row, at) => (
          <Text key={at}>
            {row.spans.length === 0
              ? ' '
              : row.spans.map(span => (
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

  // The dialog of the question cadre has open is decided by the selected module's dialogPlan (WD-S2, D-353); this hook
  // reads the open question of the pane state, which the init port's ask writes, and writes no state (R1, D-203,
  // D-303). With no open question or no plan the call passes through untouched, and so does its result (D-239). Else
  // the dialog shows the plan's questions, or the call's own when the plan has none, and notes typed in it become the
  // answers of the plan's notes (A3). A deny, an error and a result of another shape pass through
  // unchanged. Apart from the read of the open question, the hook has no .catch on purpose: a hook that throws is
  // skipped and next(e) runs in its place, a fail-safe pass-through (C1).
  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e, next) => {
    const raw: unknown = e.questions
    const open = (await read($, paneState).catch(() => null))?.open ?? null
    if (open === null) return await next(e)
    const columns = latestColumns(viewportColumns, presentationColumns)
    const plan = runSurface.dialogPlan(raw, open, lastPlacement, columns)
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
