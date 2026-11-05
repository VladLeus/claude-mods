import { describe, expect, test } from 'claude-code/testing'
import type { Engine, MountTarget } from 'claude-code/testing'

import type { AskContext, AskSpec, ContextRow, ContextRowRole, ContextSection } from '../types'
import { MANIFEST_SKIPPED_NOTE, NEXT_STEP_NOTE, privateFoldersUnknownWarning } from './apply/run'
import { sha256Hex } from './core/hash'
import { isObject, stableJson } from './core/json'
import { attendedNote } from './framework/gsd/hunks'
import { cadreJsonText, roleJsonText } from './generate/docs'
import { CHECKOUT_ARGV } from './git/checkout'
import { GIT_COMMON_DIR_ARGV } from './git/common-dir'
import { GOLDEN_PANE_ROWS, GOLDEN_PREVIEWS } from './golden/register'
import { GOLDEN_TUI } from './golden/register-tui'
import { FILE_SYSTEM_ROOT_REPLY, fileSystemRootReply, HOME_ROOT_REPLY, homeRootReply } from './guards/refusals'
import { NOT_INTERACTIVE_REPLY } from './guards/repo'
import { cancelledReply } from './init/replies'
import { MODEL_PROGRESS, SCAN_PROGRESS, SCAN_SUMMARY } from './init/run'
import { CLAUDE_JSON_QUESTION } from './init/stages/consent'
import { DURATION_QUESTION } from './init/stages/duration'
import { FRAMEWORK_QUESTION_PREFIX, GSD_CHECK_QUESTION } from './init/stages/frameworks'
import { NO_HISTORY_NOTE } from './init/stages/history'
import { GIT_POLICY_DISMISSED_REASON, GIT_POLICY_QUESTION, policyLine } from './init/stages/policy'
import { PRIVATE_FILES_HEADING, REVIEW_QUESTION } from './init/stages/review'
import { ROLES_DISMISSED_REASON, ROLES_QUESTION } from './init/stages/roles'
import { SECURITY_INSTALL_PREFIX } from './init/stages/security'
import { t } from './locales/t'
import { autopilotReply } from './scan/autopilot'
import { REGEN_NO_STATE, regenNoRole } from './team'
import {
  ABSOLUTE_PATH_MARKERS,
  answerFor,
  BIDI_OVERRIDE,
  entry,
  INIT_ANSWERS,
  leaks,
  OWN_SKILLS_ENTRY_PREFIX,
  SECRET_FIXTURES,
  secretUserSettings,
  templateRole,
} from './testkit'
import { NO_USABLE_ANSWER_REASON, PANE_TITLES, refusalLine, withContext } from './ui/ask'
import { paneDrawn, paneRows, wrapLine } from './ui/pane'
import type { PaneBlock, PaneSpan } from './ui/pane'
import { NOTE_WORDING, OTHER_WORDING, OWN_ANSWER_HINT, PREVIEW_LINE_ROWS, PREVIEW_ROWS } from './ui/preview'

/** The `on` registrar a test callback receives, which answers the host ops a plugin calls. */
type HostOn = Parameters<Parameters<typeof test>[1]>[1]

/** One listing entry, as the `fs.list` op answers it. */
type FakeEntry = {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'other'
  readonly size: number
  readonly mtimeMs: number
  readonly isLink: boolean
}

/** The host state a test describes: what the session sees, what can be read, and what each op answers. */
type World = {
  readonly root: string
  readonly env: Readonly<Record<string, string>>
  /** Folder path to its listing; a folder that is not listed here cannot be listed. */
  readonly listings: Readonly<Record<string, readonly FakeEntry[]>>
  /** File path to its text; a file that is not listed here cannot be read. */
  readonly files: Readonly<Record<string, string>>
  /** Folders that exist without a listing behind them. */
  readonly dirs: readonly string[]
  readonly settings: Readonly<Partial<Record<'user' | 'project' | 'local', Readonly<Record<string, unknown>>>>>
  /** Paths whose list and read ops refuse, although the path exists. */
  readonly denyPaths: readonly string[]
  /** Where a path lands when its stat is asked with `resolve`; a listed path with no entry answers no realPath. */
  readonly realPaths: Readonly<Record<string, string>>
  /** Paths whose stat refuses, although the path exists. */
  readonly denyStat: readonly string[]
  /** The kind a path's stat answers when it is not the default: `file` for a file in `files`, else `dir`. */
  readonly statKinds: Readonly<Record<string, FakeEntry['kind']>>
  readonly denySettings: readonly string[]
  /** Paths whose exists probe refuses, although the path exists. */
  readonly denyExists: readonly string[]
  /** What `process.run` answers for an argv with no runResults key; null makes the call refuse with `runtimeDeny`. */
  readonly runtime: { readonly exitCode: number; readonly stdout: string } | null
  /**
   * What `process.run` answers for one argv, keyed by its words joined with one space; null makes the call refuse with
   * `runtimeDeny`. An argv with no key here gets `runtime`.
   */
  readonly runResults: Readonly<Record<string, { readonly exitCode: number; readonly stdout: string } | null>>
  /** Whether `fs.write` is answered as done and logged as `fs.write <path>`; when false it is a forbidden op. */
  readonly isWriteAllowed: boolean
  /**
   * A link planted once the review question was answered: from the `fromStat`-th stat of `path` after that answer on
   * (the first when it is absent), the stat answers a regular file that is a link landing on `realPath`, so a count of
   * 2 plants it after the plan apply makes again from the disk and before the write (D-120). Absent, nothing is
   * planted.
   */
  readonly linkAfterReview?: { readonly path: string; readonly realPath: string; readonly fromStat?: number }
  /** The reason a refused `process.run` gives; detect must never show it. */
  readonly runtimeDeny: string
  /** Makes `session.root` refuse, as a host that cannot say where the session is. */
  readonly denyRoot: boolean
  /** Files whose read answers no value at all, instead of a text or a refusal. */
  readonly undefinedReads: readonly string[]
  /** What `session.surfaces` answers; empty is a `claude -p` run, where nobody can be asked (D-42). */
  readonly surfaces: readonly string[]
  /** Makes `session.surfaces` refuse, as a host that cannot say whether anyone is there. */
  readonly denySurfaces: boolean
  /** Makes `ui.open` and the write of the init pane's state refuse, as a host that cannot place or keep the pane. */
  readonly denyPane: boolean
  /** Makes `ui.close` refuse, as a host that cannot take the pane away. */
  readonly denyClose: boolean
  /**
   * Question prefix to the answer the dialog gives. The longest prefix a question starts with wins, so a test stays
   * valid when a later plan adds questions; a question no prefix matches is dismissed, as Esc does.
   */
  readonly answers: Readonly<Record<string, string>>
  /**
   * The notes typed in a dialog, keyed by question prefix as answers are (A3); a dialog a key matches answers them as
   * its question's annotation.
   */
  readonly notes?: Readonly<Record<string, string>>
  /** Runs inside the fake dialog before it answers, so a test can look at the pane while a question is open (R1). */
  readonly onAsk?: () => Promise<void>
  /** Runs inside the fake model call before it answers, so a test can look at the pane while a step runs (D-257). */
  readonly onComplete?: () => Promise<void>
  /** What `clock.now` answers, in epoch milliseconds. */
  readonly now: number
  /** What `session.id` answers. */
  readonly sessionId: string
  /** What `fs.ancestors` answers, unvalidated. */
  readonly ancestors: unknown
  /** What `command.list` answers, unvalidated. */
  readonly commands: unknown
  /** What `tool.list` answers, unvalidated. */
  readonly tools: unknown
  /** The model's replies in order; once they run out, `model.complete` answers that the model gave no text. */
  readonly replies: readonly string[]
}

/**
 * What the fake host saw: every fs, process and settings op in order, the argv of each process call, the working folder
 * each process call asked for ('' when it asked for none), each dialog question as `ask <question>`, the option labels
 * each dialog showed, the preview of each option of each dialog (D3), the first question of each dialog as the tool
 * call gave it, each text the plugin logged to the transcript, each side pane it opened as `ui.open <id> <title>`, each
 * pane it closed as `ui.close <id>`, each value it wrote to the one pane state (D-303), and each path it wrote, in
 * order.
 */
type HostLog = {
  readonly ops: string[]
  readonly runs: string[][]
  readonly cwds: string[]
  readonly asks: string[]
  readonly askOptions: string[][]
  readonly askPreviews: unknown[][]
  readonly askQuestions: unknown[]
  readonly logs: string[]
  readonly panes: string[]
  readonly closes: string[]
  /** Each value written to the one pane state, its open question and its loader in one (D-303). */
  readonly paneStates: unknown[]
  /** Each status line the plugin set, null for a clear (D-232). */
  readonly statuses: (string | null)[]
  readonly writes: string[]
}

/**
 * The first line of each dialog question the fake host saw, as `ask <first line>`: every init question carries its
 * context line on its second line (D-136).
 */
function askHeads(log: HostLog): string[] {
  return log.asks.map(ask => ask.split('\n')[0] ?? '')
}

/**
 * Host ops that would change something or reach beyond the read-only reads (a second process call, the network, an
 * MCP tool, a tool registration); `/cadre detect`, every --dry-run and every refusal must never reach one, and only
 * plain init and regen write, in a world whose isWriteAllowed lets `fs.write` through. `process.spawn` is forbidden
 * too, but streams, so fakeHost hooks it with a generator. `state.set` is forbidden too, except the one pane state
 * (D-133, T-02-49, D-303), so fakeHost hooks it on its own. `process.run` is not here: it is logged, and only the
 * user-level identity call and the launcher chmods of an apply may use it.
 */
const FORBIDDEN_OPS: readonly string[] = [
  'fs.write',
  'store.set',
  'store.delete',
  'env.set',
  'http.fetch',
  'mcp.call',
  'tool.register',
]

/** An empty log, one per test. */
function newLog(): HostLog {
  return {
    ops: [],
    runs: [],
    cwds: [],
    asks: [],
    askOptions: [],
    askPreviews: [],
    askQuestions: [],
    logs: [],
    panes: [],
    closes: [],
    paneStates: [],
    statuses: [],
    writes: [],
  }
}

/** The question open in a value written to the pane state, null when none is (D-303). */
function openOf(state: unknown): unknown {
  return isObject(state) && isObject(state.open) ? state.open : null
}

/** The header chip of the question open in a value written to the pane state, null when none is (R1, D-203). */
function headerOf(state: unknown): unknown {
  const open = openOf(state)

  return isObject(open) ? open.header : null
}

/** The label of the loader in a value written to the pane state, null when no step runs (D-257, D-301). */
function loaderOf(state: unknown): unknown {
  return isObject(state) && isObject(state.loader) ? state.loader.label : null
}

/** The summary line of the loader in a value written to the pane state, null when no step runs (D-301, D-325). */
function loaderSummaryOf(state: unknown): unknown {
  return isObject(state) && isObject(state.loader) ? state.loader.summary : null
}

/**
 * The own context of the first question a run opened in the pane state whose text starts with `prefix` (D-299): what
 * the pane drew while it was open, its title and its lines; null when the run opened no such question with a context.
 */
function openedContext(log: HostLog, prefix: string): { readonly title: string; readonly lines: string[] } | null {
  const open = log.paneStates.map(openOf).find(value => isObject(value) && String(value.question).startsWith(prefix))
  if (!isObject(open) || !isObject(open.context)) return null
  const { title, lines } = open.context

  return { title: String(title), lines: Array.isArray(lines) ? lines.map(String) : [] }
}

/** Every role a structured context row may have (D-313), to read a row back from a logged pane state. */
const ROW_ROLES: readonly ContextRowRole[] = [
  'heading',
  'item',
  'description',
  'field',
  'recommended',
  'placeholder',
  'plain',
]

/** A structured row read back from a logged pane state (D-313); null when the value is not one. */
function loggedRowOf(value: unknown): ContextRow | null {
  if (!isObject(value) || typeof value.text !== 'string' || typeof value.indent !== 'number') return null
  const role = ROW_ROLES.find(known => known === value.role)
  if (role === undefined) return null
  const { text, indent } = value

  return typeof value.label === 'string' ? { role, label: value.label, text, indent } : { role, text, indent }
}

/** A section of structured rows read back from a logged pane state (D-313); its rows that are none are left out. */
function loggedSectionOf(value: unknown): ContextSection | null {
  if (!isObject(value) || !Array.isArray(value.rows)) return null
  const title = typeof value.title === 'string' ? value.title : null
  const rows = value.rows.flatMap(row => {
    const read = loggedRowOf(row)

    return read === null ? [] : [read]
  })

  return { title, rows }
}

/**
 * The block the pane draws for the own context of the first question a run opened whose text starts with `prefix`
 * (paneBlockOf, D-313): its title, summary and rows when it has rows, else its title and lines; null when there is
 * none.
 */
function openedBlock(log: HostLog, prefix: string): PaneBlock | null {
  const context = openedContext(log, prefix)
  const open = log.paneStates.map(openOf).find(value => isObject(value) && String(value.question).startsWith(prefix))
  if (context === null || !isObject(open) || !isObject(open.context)) return null
  const { rows, summary } = open.context
  if (!Array.isArray(rows)) return { ...context, summary: null, rows: null }
  const sections = rows.flatMap(row => {
    const read = loggedSectionOf(row)

    return read === null ? [] : [read]
  })

  return { ...context, summary: typeof summary === 'string' ? summary : null, rows: sections }
}

/** The pane state with no question open and no loader: what a run writes when it ends (D-303, D-304). */
const IDLE_STATE = { open: null, loader: null }

/**
 * A repo with `.planning/` and `docs/superpowers/`, a user-level GSD 1.16.0 with a proven identity, and superpowers
 * 6.4.1 enabled for the user. Pass `over` to change one part of it.
 */
function ambiguousWorld(over: Partial<World> = {}): World {
  return {
    root: '/repo',
    env: { HOME: '/home/u' },
    listings: {
      '/repo': [entry('.planning', 'dir'), entry('docs', 'dir')],
      '/repo/docs': [entry('superpowers', 'dir')],
    },
    files: {
      '/home/u/.claude/gsd-core/VERSION': '1.16.0\n',
      '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      '/home/u/.claude/gsd-core/bin/lib/cli-exit.cjs': '',
      '/home/u/.claude/plugins/installed_plugins.json':
        '{"plugins":{"superpowers@claude-plugins-official":[{"scope":"user","version":"6.4.1"}]}}',
    },
    dirs: ['/home/u/.claude/gsd-core'],
    settings: { user: { enabledPlugins: { 'superpowers@claude-plugins-official': true } }, project: {}, local: {} },
    denyPaths: [],
    realPaths: { '/repo': '/repo', '/home/u': '/home/u' },
    denyStat: [],
    statKinds: {},
    denySettings: [],
    denyExists: [],
    runtime: null,
    runResults: {},
    isWriteAllowed: false,
    runtimeDeny: 'no runtime in this world',
    denyRoot: false,
    undefinedReads: [],
    surfaces: ['terminal'],
    denySurfaces: false,
    denyPane: false,
    denyClose: false,
    answers: {},
    now: 1_000_000,
    sessionId: 's1',
    ancestors: [],
    commands: [],
    tools: [],
    replies: [],
    ...over,
  }
}

/** The answer that lets GSD's own check run: the GSD check asks before the identity call runs (D-243). */
const GSD_CHECK_YES: Readonly<Record<string, string>> = { "Run GSD's own check": 'Yes, run the check' }

/** The INIT_ANSWERS without the answer for one question prefix, so that question is dismissed. */
function answersWithout(prefix: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== prefix))
}

/**
 * The ambiguous repo of ambiguousWorld inside a git repo (`/repo/.git` is a folder), with every init question answered
 * by INIT_ANSWERS. Pass `over` to change one part of it.
 */
function initWorld(over: Partial<World> = {}): World {
  const base = ambiguousWorld()

  return { ...base, dirs: [...base.dirs, '/repo/.git'], answers: INIT_ANSWERS, ...over }
}

/**
 * The note the roles stage gives when the model answers a described structure with no text on every try (ROLE-02,
 * D-83): in notedWorld it comes while that step's loader is up (D-325).
 */
const DESCRIBED_FALLBACK_NOTE =
  'Could not use the described structure: the model gave no text. ' +
  'Using the template proposal; you can still adjust it.'

/** The note the hunk stage gives for the GSD hunks notedWorld declines, right after their dialogs (D-325). */
const ATTENDED_NOTE = attendedNote(['mode', 'workflow.text_mode'])

/**
 * initWorld with two notes (D-325): the roles question is first answered Describe my own structure, the structure is
 * typed (under Other on a pane surface, as the dialog's note on the TUI default, A3) and the model gives no text for
 * it, so the roles stage notes DESCRIBED_FALLBACK_NOTE while that step's loader is up; once the model was called the
 * roles question is answered Use these roles. The GSD hunks are declined, so the hunk stage notes ATTENDED_NOTE after
 * their dialogs, with no step running.
 */
function notedWorld(): World {
  // The describe question as both surfaces word it: its end differs (OTHER_WORDING, NOTE_WORDING).
  const describe = 'Describe your role structure'
  const description = 'A writer for the docs and a reviewer.'
  const answers: Record<string, string> = {
    ...INIT_ANSWERS,
    [ROLES_QUESTION]: 'Describe my own structure',
    [describe]: description,
    '.planning/config.json:': 'Decline',
  }
  const onComplete = async (): Promise<void> => {
    answers[ROLES_QUESTION] = 'Use these roles'
  }

  return initWorld({ answers, notes: { [describe]: description }, onComplete })
}

/**
 * The argv of each GSD hunk an init in initWorld accepts, in hunk order: the proven user-level gsd-tools sets mode and
 * workflow.text_mode. Plain init runs them with cwd /repo before it writes anything (D-120, D-71).
 */
const GSD_HUNK_RUNS: readonly (readonly string[])[] = [
  ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'mode', 'yolo'],
  ['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'config-set', 'workflow.text_mode', 'false'],
]

/**
 * The runs of a plain init in initWorld before its chmods: the accepted GSD hunks, then the git run that names the role
 * memory folders, which every plain init makes (02-GAPS-B3 C1), all with cwd /repo.
 */
const INIT_RUNS: readonly (readonly string[])[] = [...GSD_HUNK_RUNS, GIT_COMMON_DIR_ARGV]

/**
 * The warning of a plain init of the INIT_ANSWERS team in initWorld, whose git names no common dir: the private files
 * were not written (02-GAPS-B3 C1).
 */
const FOLDERS_UNKNOWN = `warning: ${privateFoldersUnknownWarning(['pm', 'security', 'tl'])}`

/**
 * The repo of initWorld after an init of one BE role on the built-in default: the `.cadre/` folder with its cadre.json,
 * BE's role.json and an empty manifest (B3). Pass `over` to change one part of it.
 */
function regenHostWorld(over: Partial<World> = {}): World {
  const base = initWorld()
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  })

  return {
    ...base,
    dirs: [...base.dirs, '/repo/.cadre'],
    files: {
      ...base.files,
      '/repo/.cadre/cadre.json': state,
      '/repo/.cadre/be/role.json': roleJsonText(templateRole('be')),
      '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: [] }),
    },
    ...over,
  }
}

/** The text of BE's launcher in startHostWorld; /cadre start reads only its hash, to compare it with the manifest. */
const START_LAUNCHER = '#!/bin/sh\n# the launcher of role be\nexit 0\n'

/** The per-launch folder of BE in startHostWorld (D-102). */
const START_RUNTIME = '/repo/.cadre/be/.runtime'

/** The cadre.json of startHostWorld's BE, listing these roles. */
function startStateText(roles: readonly string[]): string {
  return cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles,
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  })
}

/**
 * The repo of regenHostWorld after a plain init of BE (D-102, LNCH-04): its cadre.json and role.json, the folder
 * `.cadre/be` resolving inside the repo, the launcher `.cadre/bin/be` and a manifest whose `.cadre/bin/be` entry holds
 * the launcher's sha256. `claude --version` gives 2.1.304, git gives the common dir /repo/.git, the mkdirs of a render
 * and the chmod 700 of each level of BE's role memory folder (02-GAPS-B3 S7) exit 0, and writes are allowed. Pass
 * `over` to change one part of it.
 */
async function startHostWorld(over: Partial<World> = {}): Promise<World> {
  const base = regenHostWorld()
  const launcher = { path: '.cadre/bin/be', sha256: await sha256Hex(START_LAUNCHER), mode: 'exec' }
  const done = { exitCode: 0, stdout: '' }
  const slug = `/home/u/.claude/cadre/repo-${(await sha256Hex('/repo/.git')).slice(0, 8)}`
  // BE's private instructions folder, which the render makes and links from .runtime (D-140 q1-b).
  const privateFolder = `${slug}/be/instructions`
  const levels = ['/home/u/.claude/cadre', slug, `${slug}/be`, privateFolder]

  return {
    ...base,
    dirs: [...base.dirs, '/repo/.cadre/be'],
    files: {
      ...base.files,
      '/repo/.cadre/cadre.json': startStateText(['be']),
      '/repo/.cadre/bin/be': START_LAUNCHER,
      '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: [launcher] }),
    },
    realPaths: { ...base.realPaths, '/repo/.cadre/be': '/repo/.cadre/be' },
    runResults: {
      'claude --version': { exitCode: 0, stdout: '2.1.304 (Claude Code)\n' },
      'git rev-parse --path-format=absolute --git-common-dir': { exitCode: 0, stdout: '/repo/.git\n' },
      [`/bin/mkdir -p -- ${START_RUNTIME}`]: done,
      [`/bin/mkdir -p -- ${START_RUNTIME}/overlay`]: done,
      [`/bin/mkdir -p -- ${privateFolder}`]: done,
      ...Object.fromEntries(levels.map(level => [`/bin/chmod 700 ${level}`, done])),
      [`/bin/ln -sfn ${privateFolder} ${START_RUNTIME}/private-instructions`]: done,
    },
    isWriteAllowed: true,
    ...over,
  }
}

/** The folder of statusHostWorld's transcripts: the git root's folder under the user folder's projects (D-131). */
const STATUS_TRANSCRIPTS = '/home/u/.claude/projects/-repo'

/** The argv of the title grep of BE's transcript s9.jsonl in statusHostWorld (D-131). */
const STATUS_GREP: readonly string[] = [
  '/usr/bin/grep',
  '-E',
  '^\\{"type":"custom-title"',
  '--',
  `${STATUS_TRANSCRIPTS}/s9.jsonl`,
]

/**
 * The repo of startHostWorld after a run of BE (D-111, D-131): the git root's transcripts folder lists s9.jsonl, whose
 * title grep gives the custom-title row `cadre-be`, and autopilot's status file of s9 is off, with a log that ends
 * `finished (done)`. Pass `over` to change one part of it.
 */
async function statusHostWorld(over: Partial<World> = {}): Promise<World> {
  const base = await startHostWorld()
  const titleRow = '{"type":"custom-title","customTitle":"cadre-be","sessionId":"s9"}\n'

  return {
    ...base,
    listings: { ...base.listings, [STATUS_TRANSCRIPTS]: [entry('s9.jsonl')] },
    files: {
      ...base.files,
      '/home/u/.claude/autopilot/s9.json': '{"isOn":false}',
      '/home/u/.claude/autopilot/s9.log':
        '2026-10-20T01:00:00.000Z  final handoff requested (done)\n' +
        '2026-10-20T01:01:00.000Z  finished (done): handed back to the person\n',
    },
    runResults: { ...base.runResults, [STATUS_GREP.join(' ')]: { exitCode: 0, stdout: titleRow } },
    ...over,
  }
}

/** Whether the fake host has the path: a listed folder, a bare folder, or a file. */
function hasPath(world: World, path: string): boolean {
  return Object.hasOwn(world.listings, path) || world.dirs.includes(path) || Object.hasOwn(world.files, path)
}

/**
 * Answers the host ops `/cadre detect`, `/cadre init` and `/cadre regen` may use from `world` and logs each fs, process
 * and settings op into `log`; a dialog is answered from `world.answers` and logged as an ask, and a transcript text is
 * kept in `log.logs`. A side pane is placed and kept in `log.panes`, and each value of the one pane state, the open
 * question and the loader in one, is kept in `log.paneStates` and stored, unless `world.denyPane` refuses both (R1,
 * D-203, D-303). A pane closed is kept in `log.closes`, and the close is refused when `world.denyClose`. The model
 * answers `world.replies` in order, each call after `world.onComplete` ran. A process call answers its runResults
 * entry, else `runtime`. `fs.write` is answered as done, and its path kept in `log.writes`, only when
 * `world.isWriteAllowed`. Every other forbidden op, a `state.set` of any other state included, is answered with a
 * refusal, so a call to one would show up in the log and fail its call.
 */
function fakeHost(on: HostOn, world: World, log: HostLog): void {
  on('session.root', async () => (world.denyRoot ? { deny: 'no session root' } : { value: world.root }))
  on('session.surfaces', async () => (world.denySurfaces ? { deny: 'no surfaces' } : { value: world.surfaces }))
  on('session.id', async () => ({ value: world.sessionId }))
  on('session.model', async () => ({ value: 'opus' }))
  on('clock.now', async () => ({ value: world.now }))
  on('ui.log', async (_$, e) => {
    log.logs.push(e.text)

    return { value: undefined }
  })
  on('ui.status', async (_$, e) => {
    log.statuses.push(e.text ?? null)

    return { value: undefined }
  })
  on('ui.open', async (_$, e) => {
    log.panes.push(`ui.open ${e.id} ${e.title}`)
    if (world.denyPane) return { deny: 'no pane' }

    return { value: { isPlaced: true } }
  })
  on('ui.close', async (_$, e) => {
    log.closes.push(`ui.close ${e.id}`)
    if (world.denyClose) return { deny: 'no close' }

    return { value: undefined }
  })
  // The one pane state, the question open now and the loader in one, is the plugin's own state (D-133, T-02-49, R1,
  // D-203, D-303); a write of any other state is forbidden.
  on('state.set', async (_$, e, next) => {
    if (e.plugin !== 'cadre' || e.key !== 'pane') {
      log.ops.push('forbidden state.set')

      return { deny: 'detect uses no such op' }
    }
    log.paneStates.push(e.value)
    if (world.denyPane) return { deny: 'no pane state' }

    return next(e)
  })
  // Set once the review question is answered; only a world with linkAfterReview reads it.
  let isReviewAnswered = false
  // How often the planted path was stat-ed since the review question was answered.
  let plantedStats = 0
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const asked = e.questions[0]
    const question = asked?.question ?? ''
    log.asks.push(`ask ${question}`)
    log.askOptions.push((asked?.options ?? []).map(option => option.label))
    log.askPreviews.push((asked?.options ?? []).map(option => ('preview' in option ? option.preview : undefined)))
    log.askQuestions.push(asked)
    await world.onAsk?.()
    const answer = answerFor(world.answers, question)
    if (answer === undefined) return { deny: 'dismissed' }
    if (question.startsWith(REVIEW_QUESTION)) isReviewAnswered = true
    const notes = world.notes === undefined ? undefined : answerFor(world.notes, question)
    const annotations = notes === undefined ? {} : { annotations: { [question]: { notes } } }

    return { result: { questions: e.questions, answers: { [question]: answer }, ...annotations } }
  })
  on('command.list', async () => ({ value: world.commands }))
  on('tool.list', async () => ({ value: world.tools }))
  let nextReply = 0
  on('model.complete', async () => {
    await world.onComplete?.()
    const text = world.replies[nextReply]
    nextReply += 1
    const usage = { input_tokens: 1, output_tokens: 1 }
    if (text === undefined) return { value: { isAnswered: false, reason: 'no-text', usage } }

    return { value: { isAnswered: true, text, usage } }
  })
  on('fs.ancestors', async () => {
    log.ops.push('fs.ancestors')

    return { value: world.ancestors }
  })
  on('env.get', async (_$, e) => ({ value: world.env[e.name] }))
  on('fs.exists', async (_$, e) => {
    log.ops.push(`fs.exists ${e.path}`)
    if (world.denyExists.includes(e.path)) return { deny: 'exists refused' }

    return { value: hasPath(world, e.path) }
  })
  on('fs.list', async (_$, e) => {
    log.ops.push(`fs.list ${e.path}`)
    if (world.denyPaths.includes(e.path) || !Object.hasOwn(world.listings, e.path)) return { deny: 'missing' }

    return { value: world.listings[e.path] }
  })
  on('fs.read', async (_$, e) => {
    log.ops.push(`fs.read ${e.path}`)
    if (world.denyPaths.includes(e.path) || !Object.hasOwn(world.files, e.path)) return { deny: 'missing' }
    if (world.undefinedReads.includes(e.path)) return { value: undefined }

    return { value: world.files[e.path] }
  })
  on('fs.stat', async (_$, e) => {
    log.ops.push(`fs.stat ${e.path} resolve=${String(e.resolve)}`)
    if (world.denyStat.includes(e.path)) return { deny: 'stat refused' }
    const planted = world.linkAfterReview
    const isPlantedPath = planted !== undefined && isReviewAnswered && e.path === planted.path
    plantedStats += isPlantedPath ? 1 : 0
    if (isPlantedPath && plantedStats >= (planted.fromStat ?? 1)) {
      const realPath = planted.realPath

      return { value: { kind: 'file', size: 0, mtimeMs: 0, isLink: true, ...(e.resolve ? { realPath } : {}) } }
    }
    if (!Object.hasOwn(world.realPaths, e.path) && !hasPath(world, e.path)) return { deny: 'missing' }
    const isFile = Object.hasOwn(world.files, e.path)
    // A file lands on itself unless realPaths says otherwise; a folder with no realPaths entry answers none.
    const fileRealPath = isFile ? e.path : undefined
    const realPath = Object.hasOwn(world.realPaths, e.path) ? world.realPaths[e.path] : fileRealPath
    const defaultKind: FakeEntry['kind'] = isFile ? 'file' : 'dir'
    const kind = Object.hasOwn(world.statKinds, e.path) ? world.statKinds[e.path] : defaultKind

    return { value: { kind, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath } : {}) } }
  })
  on('settings.read', async (_$, e) => {
    log.ops.push(`settings.read ${e.source}`)
    if (e.source === undefined || world.denySettings.includes(e.source)) return { deny: 'unreadable' }

    return { value: world.settings[e.source] ?? {} }
  })
  on('process.run', async (_$, e) => {
    log.ops.push('process.run')
    log.runs.push([...e.argv])
    log.cwds.push(e.init?.cwd ?? '')
    const key = e.argv.join(' ')
    const scripted = Object.hasOwn(world.runResults, key) ? world.runResults[key] : undefined
    const result = scripted === undefined ? world.runtime : scripted
    if (result === null) return { deny: world.runtimeDeny }

    return { value: { ...result, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    log.ops.push('forbidden process.spawn')

    return { deny: 'detect uses no such op' }
  })
  if (world.isWriteAllowed) {
    on('fs.write', async (_$, e) => {
      log.ops.push(`fs.write ${e.path}`)
      log.writes.push(e.path)

      return { value: undefined }
    })
  }
  for (const op of FORBIDDEN_OPS) {
    if (op === 'fs.write' && world.isWriteAllowed) continue
    on(op, async () => {
      log.ops.push(`forbidden ${op}`)

      return { deny: 'detect uses no such op' }
    })
  }
}

/** The report row of one framework: the line that starts with its name, padded to the name column; '' if none. */
function rowOf(text: string, name: string): string {
  const row = new RegExp(`^${name} {2,}`)

  return text.split('\n').find(line => row.test(line)) ?? ''
}

describe('register with a faked host', () => {
  test('bare /cadre answers with help that lists both detect commands', async $ => {
    const out = await $.command.run({ command: 'cadre', args: '' })
    expect(out.text).toContain('/cadre detect --adapters')
  })

  test('an unknown subcommand is echoed on the first line of the reply', async $ => {
    const out = await $.command.run({ command: 'cadre', args: 'launch be' })
    expect(out.text.startsWith('Unknown subcommand: launch be')).toBe(true)
  })

  test('detect in an ambiguous repo prints the report and the ambiguous adapter line', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
    expect(out.text).toContain('docs/superpowers/')
  })

  test('detect --adapters adds the contract view after the report', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).toContain('Adapter contract')
    expect(out.text).toContain('built-in (none)')
  })

  test('a desktop detect run names the GSD install in its check dialog text (#39, D-310)', async ($, on) => {
    const log = newLog()
    const world = gsdOnlyWorld({
      surfaces: ['desktop'],
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      answers: { "Run GSD's own check": 'No, skip the check' },
    })
    fakeHost(on, world, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.asks).toEqual([`ask ${withContext(GSD_CHECK_QUESTION, '~/.claude/gsd-core: found, not proven')}`])
  })

  test('a session at the home folder is refused before any listing, read, settings or process call', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops).toContain('fs.stat /home/u resolve=true')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a session in a folder that contains the home folder is refused the same way', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a normal repo root beside the home folder is detected', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).not.toBe(HOME_ROOT_REPLY)
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a repo-local GSD folder alone is never run: the runtime identity call is not made', async ($, on) => {
    const log = newLog()
    const repoOnly = {
      // No user-level GSD files or folder: the repo-local folder is the only GSD candidate.
      ...ambiguousWorld(),
      files: {
        '/repo/.claude/gsd-core/VERSION': '1.16.0\n',
        '/repo/.claude/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/repo/.claude/gsd-core'],
      denyPaths: ['/repo/.claude/gsd-core/VERSION', '/repo/.claude/gsd-core/bin/lib/package-identity.cjs'],
    }
    fakeHost(on, repoOnly, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.exists /repo/.claude/gsd-core')
    expect(log.ops.some(op => op.includes('/home/u/.claude/gsd-core') && op.startsWith('fs.read'))).toBe(false)
    expect(log.runs).toEqual([])
    expect(log.ops).not.toContain('process.run')
    expect(log.ops).not.toContain('fs.exists /repo/.claude/gsd-core/bin/lib/cli-exit.cjs')
  })

  test('a user-level GSD folder that cannot be proven is run once, under the user folder only', async ($, on) => {
    const log = newLog()
    const userDenied = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, userDenied, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(log.runs[0][1].startsWith('/home/u/.claude/gsd-core/')).toBe(true)
    expect(log.runs[0].some(arg => arg.startsWith('/repo'))).toBe(false)
    expect(out.text).toContain('Warning: could not read ~/.claude/gsd-core/VERSION (treated as unknown)')
    // IN-05 (user decision 2026-10-16): a refused identity call gives the one generic could-not-run reason.
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run',
    )
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
    expect(out.text).not.toContain('/home/u')
  })

  test(
    'a VERSION exists probe the host refuses counts as present, so the read is tried and warns (fail open)',
    async ($, on) => {
      const versionPath = '/home/u/.claude/gsd-core/VERSION'
      fakeHost(on, { ...ambiguousWorld(), denyExists: [versionPath], denyPaths: [versionPath] }, newLog())
      const out = await $.command.run({ command: 'cadre', args: 'detect' })
      expect(out.text).toContain('Warning: could not read ~/.claude/gsd-core/VERSION (treated as unknown)')
    },
  )

  test('an interactive detect asks the GSD check; No runs nothing and leaves GSD unproven (D-243)', async ($, on) => {
    const log = newLog()
    const unproven = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
      answers: { "Run GSD's own check": 'No, skip the check' },
    }
    fakeHost(on, unproven, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    // A pane surface asks the check with the install it runs, its context's one line (D-255, edge #39).
    expect(log.asks).toEqual([
      "ask Run GSD's own check to confirm it's installed? (runs node gsd-tools runtime-identity)\n" +
        '~/.claude/gsd-core: found, not proven',
    ])
    expect(log.askOptions).toEqual([['No, skip the check', 'Yes, run the check']])
    expect(log.runs).toEqual([])
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
  })

  test('detect in claude -p never asks the GSD check and never runs the identity call (D-243)', async ($, on) => {
    const log = newLog()
    const unproven = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
      answers: GSD_CHECK_YES,
      surfaces: [],
    }
    fakeHost(on, unproven, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect([log.asks, log.runs]).toEqual([[], []])
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
  })

  test('a runtime identity answer for another package never makes the GSD row installed', async ($, on) => {
    const log = newLog()
    const decoy = {
      ...ambiguousWorld(),
      listings: { '/repo': [entry('docs', 'dir')], '/repo/docs': [entry('superpowers', 'dir')] },
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"get-shit-done-cc","note":"@opengsd/gsd-core"}' },
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, decoy, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(rowOf(out.text, 'GSD')).toContain('not found')
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
  })

  test('no mutating host op is called by a detect run or a detect --adapters run', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld(), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('settings values, hook commands and the home path never reach the output', async ($, on) => {
    const secrets = {
      ...ambiguousWorld(),
      settings: {
        user: {
          env: { TOKEN: 'SENTINEL_SECRET_123' },
          enabledPlugins: { 'superpowers@claude-plugins-official': true },
          hooks: {
            PostToolUse: [
              { matcher: '', hooks: [{ type: 'command', command: '"/home/u/secret/hooks/gsd-prompt-guard.js"' }] },
            ],
          },
        },
        project: {},
        local: {},
      },
    }
    fakeHost(on, secrets, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).not.toContain('SENTINEL_SECRET_123')
    expect(out.text).not.toContain('/home/u')
    expect(out.text).not.toContain('/repo/')
  })

  test('a root listing that fails gives a warning and still the five framework rows', async ($, on) => {
    fakeHost(on, { ...ambiguousWorld(), denyPaths: ['/repo'] }, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not list the repo root (treated as unknown)')
    for (const name of ['GSD', 'superpowers', 'AI-DLC', 'BMAD', 'spec-kit']) {
      expect(rowOf(out.text, name)).not.toBe('')
    }
  })

  test('a project settings read that fails gives a warning and the report still renders', async ($, on) => {
    fakeHost(on, { ...ambiguousWorld(), denySettings: ['project'] }, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read project settings (treated as unknown)')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('two detect runs on the same host give identical text', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const first = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    const second = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(second.text).toBe(first.text)
  })

  test('a symlinked docs/ is listed like a docs/ folder, so superpowers behind it is in use', async ($, on) => {
    const linked = {
      ...ambiguousWorld(),
      listings: {
        '/repo': [entry('.planning', 'dir'), entry('docs', 'other', true)],
        '/repo/docs': [entry('superpowers', 'dir')],
      },
    }
    fakeHost(on, linked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('docs/superpowers/')
    expect(rowOf(out.text, 'superpowers')).toContain('in use')
  })

  test('a plain file named docs is never listed as a folder', async ($, on) => {
    const log = newLog()
    const plainDocs = { ...ambiguousWorld(), listings: { '/repo': [entry('.planning', 'dir'), entry('docs', 'file')] } }
    fakeHost(on, plainDocs, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain('fs.list /repo/docs')
  })

  test('a symlinked repo root that lands in the home folder is refused like the home folder', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/home/u', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /link/repo resolve=true')
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a symlinked repo root is read through the place it lands', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.list /repo')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a CLAUDE_CONFIG_DIR that lands inside the repo is ignored with its warning', async ($, on) => {
    const log = newLog()
    const inRepo = ambiguousWorld({
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/cfg-link': '/repo/.cfg' },
    })
    fakeHost(on, inRepo, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /cfg-link resolve=true')
    expect(out.text).toContain('Warning: CLAUDE_CONFIG_DIR is ignored')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
    expect(log.ops.filter(op => !op.startsWith('fs.stat ')).some(op => op.includes('/repo/.cfg'))).toBe(false)
  })

  test('a CLAUDE_CONFIG_DIR that lands outside the repo is read at the place it lands', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const outside = {
      ...base,
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/cfg-link': '/opt/cfg' },
      files: {
        ...base.files,
        '/opt/cfg/gsd-core/VERSION': '1.16.0\n',
        '/opt/cfg/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/opt/cfg/gsd-core'],
    }
    fakeHost(on, outside, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.read /opt/cfg/gsd-core/VERSION')
    expect(log.ops.filter(op => !op.startsWith('fs.stat ')).some(op => op.includes('/cfg-link'))).toBe(false)
  })

  test('a repo root whose stat is refused is used as given, with a warning', async ($, on) => {
    fakeHost(on, ambiguousWorld({ denyStat: ['/repo'] }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve the repo root (used as given)')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a home folder whose stat answers no realPath is used as given, with a warning', async ($, on) => {
    const noRealPath = ambiguousWorld({
      realPaths: { '/repo': '/repo' },
      dirs: ['/home/u/.claude/gsd-core', '/home/u'],
    })
    fakeHost(on, noRealPath, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve the home folder (used as given)')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
  })

  test('a CLAUDE_CONFIG_DIR whose stat is refused is used as given, with a warning', async ($, on) => {
    const refused = ambiguousWorld({
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      denyStat: ['/cfg-link'],
    })
    fakeHost(on, refused, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve CLAUDE_CONFIG_DIR (used as given)')
  })

  test('resolving the paths adds no write and no process call', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('a session root the host refuses gives the unknown-root report with no read at all', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ denyRoot: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read the session root (treated as unknown)')
    for (const name of ['GSD', 'superpowers', 'AI-DLC', 'BMAD', 'spec-kit']) {
      expect(rowOf(out.text, name)).not.toBe('')
    }
    expect(log.ops).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('an installed_plugins.json over the read cap gives the could-not-read warning', async ($, on) => {
    const base = ambiguousWorld()
    const big = {
      ...base,
      files: { ...base.files, '/home/u/.claude/plugins/installed_plugins.json': 'x'.repeat(300 * 1024) },
    }
    fakeHost(on, big, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read ~/.claude/plugins/installed_plugins.json (treated as unknown)')
  })

  test('a file that is not JSON gives the could-not-parse warning', async ($, on) => {
    const base = ambiguousWorld()
    const broken = {
      ...base,
      files: { ...base.files, '/home/u/.claude/plugins/installed_plugins.json': '{"plugins": [' },
    }
    fakeHost(on, broken, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain(
      'Warning: could not parse ~/.claude/plugins/installed_plugins.json as JSON (treated as unknown)',
    )
  })

  test('a read that answers no text gives the could-not-read warning', async ($, on) => {
    const unreadable = ambiguousWorld({ undefinedReads: ['/home/u/.claude/plugins/installed_plugins.json'] })
    fakeHost(on, unreadable, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read ~/.claude/plugins/installed_plugins.json (treated as unknown)')
  })

  test('a relative HOME is never stat-ed or read', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ env: { HOME: 'rel/home' } }), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops.filter(op => op.startsWith('fs.stat ')).some(op => op.includes('rel/home'))).toBe(false)
    expect(log.ops.some(op => op.includes('rel/home'))).toBe(false)
    expect(log.runs).toEqual([])
  })

  test('a relative CLAUDE_CONFIG_DIR is never stat-ed or read', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: 'rel/cfg' } }), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops.filter(op => op.startsWith('fs.stat ')).some(op => op.includes('rel/cfg'))).toBe(false)
    expect(log.ops.some(op => op.includes('rel/cfg'))).toBe(false)
    expect(log.runs.some(run => JSON.stringify(run).includes('rel/cfg'))).toBe(false)
  })

  test('a runtime identity call that exits non-zero leaves the install unproven, with the warning', async ($, on) => {
    const log = newLog()
    const failed = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 1, stdout: '' },
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, failed, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
  })

  test('a user-level GSD folder with no built runtime is never run, and the warning says so (WR-01)', async ($, on) => {
    const log = newLog()
    const notBuilt = {
      ...ambiguousWorld(),
      files: {
        '/home/u/.claude/gsd-core/VERSION': '1.16.0\n',
        '/home/u/.claude/plugins/installed_plugins.json': '{"plugins":{}}',
      },
    }
    fakeHost(on, notBuilt, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs).toEqual([])
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: runtime not built (treated as unknown)',
    )
  })

  test('the runtime identity call runs in the user GSD folder, never in the repo (WR-01)', async ($, on) => {
    const log = newLog()
    const userDenied = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, userDenied, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.cwds).toEqual(['/home/u/.claude/gsd-core'])
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
  })

  test('an identity call the host refuses gives the generic warning and never the host text (IN-05)', async ($, on) => {
    const refused = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtimeDeny: 'SENTINEL_HOST_TEXT',
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, refused, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run ' +
        '(node missing or timed out); treated as unknown',
    )
    expect(out.text).not.toContain('SENTINEL_HOST_TEXT')
  })

  // Guard: passes before the fix by design; it proves a non-zero exit is not mistaken for a call that could not run.
  test('an identity call that exits non-zero is not reported as could-not-run (IN-05)', async ($, on) => {
    const failed = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 1, stdout: '' },
      answers: GSD_CHECK_YES,
    }
    fakeHost(on, failed, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).not.toContain('the identity call could not run')
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
  })

  // Guard: passes before the fix by design; it pins that a refused built-probe fails closed (no process call).
  test('a built-probe the host refuses is reported as not built and the identity call is not made', async ($, on) => {
    const log = newLog()
    const probeRefused = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      denyExists: ['/home/u/.claude/gsd-core/bin/lib/cli-exit.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
    }
    fakeHost(on, probeRefused, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs).toEqual([])
    expect(out.text).toContain('could not prove the GSD install at ~/.claude/gsd-core: runtime not built')
  })

  test('a plugin entry that names the root as given counts when the root resolves elsewhere (WR-04)', async ($, on) => {
    const base = ambiguousWorld()
    const linked = {
      ...base,
      root: '/link/repo',
      realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' },
      files: {
        ...base.files,
        '/home/u/.claude/plugins/installed_plugins.json':
          '{"version":2,"plugins":{"superpowers@x":' +
          '[{"scope":"project","projectPath":"/link/repo","version":"4.0.0"}]}}',
      },
      settings: { user: { enabledPlugins: { 'superpowers@x': true } }, project: {}, local: {} },
    }
    fakeHost(on, linked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(rowOf(out.text, 'superpowers')).toContain('4.0.0')
  })

  // Guard: passes before the fix by design; it pins today's behaviour for a root used as given (D-39).
  test('a root whose realpath failed skips its repo-local files with the warning, though they exist', async ($, on) => {
    const log = newLog()
    const versionPath = '/tmp/repo/.claude/gsd-core/VERSION'
    const unresolved = {
      ...ambiguousWorld(),
      root: '/tmp/repo',
      listings: { '/tmp/repo': [entry('.claude', 'dir')] },
      files: { ...ambiguousWorld().files, [versionPath]: '1.2.3\n' },
      dirs: [...ambiguousWorld().dirs, '/tmp/repo/.claude/gsd-core'],
      denyStat: ['/tmp/repo'],
      realPaths: { '/home/u': '/home/u', [versionPath]: `/private${versionPath}` },
    }
    fakeHost(on, unresolved, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain(`fs.read ${versionPath}`)
    expect(out.text).toContain('Warning: could not resolve the repo root (used as given)')
    expect(out.text).toContain('Warning: skipped <repo>/.claude/gsd-core/VERSION: not a regular file inside the repo')
  })

  test('a repo-local GSD file that links out of the repo is never read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const linkedOut = {
      ...base,
      files: { ...base.files, '/repo/.claude/gsd-core/VERSION': 'SENTINEL_KEY_MATERIAL' },
      dirs: [...base.dirs, '/repo/.claude/gsd-core'],
      realPaths: { ...base.realPaths, '/repo/.claude/gsd-core/VERSION': '/home/u/.ssh/id_ed25519' },
    }
    fakeHost(on, linkedOut, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /repo/.claude/gsd-core/VERSION resolve=true')
    expect(log.ops).not.toContain('fs.read /repo/.claude/gsd-core/VERSION')
    expect(out.text).toContain(
      'Warning: skipped <repo>/.claude/gsd-core/VERSION: not a regular file inside the repo (treated as unknown)',
    )
    expect(out.text).not.toContain('SENTINEL_KEY_MATERIAL')
  })

  test('a repo-local GSD file that is a device or a FIFO is never read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const statKinds: World['statKinds'] = { '/repo/.claude/gsd-file-manifest.json': 'other' }
    const device = { ...base, files: { ...base.files, '/repo/.claude/gsd-file-manifest.json': '{}' }, statKinds }
    fakeHost(on, device, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain('fs.read /repo/.claude/gsd-file-manifest.json')
    expect(out.text).toContain('Warning: skipped <repo>/.claude/gsd-file-manifest.json: not a regular file')
  })

  // Guard: passes before the fix by design; it proves the WR-02 check does not block a regular file inside the repo.
  test('a regular repo-local GSD file inside the repo is still read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const inside = {
      ...base,
      files: { ...base.files, '/repo/.claude/gsd-core/VERSION': '1.16.0\n' },
      dirs: [...base.dirs, '/repo/.claude/gsd-core'],
    }
    fakeHost(on, inside, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.read /repo/.claude/gsd-core/VERSION')
    expect(out.text).not.toContain('not a regular file inside the repo')
  })

  test('a root as given that equals HOME as resolved is refused (WR-06)', async ($, on) => {
    const log = newLog()
    const mixed = ambiguousWorld({
      root: '/home/u',
      env: { HOME: '/data/u' },
      realPaths: { '/home/u': '/srv/u', '/data/u': '/home/u' },
    })
    fakeHost(on, mixed, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a session at the file system root is refused even with no HOME (WR-06)', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/', env: {}, realPaths: { '/': '/' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(FILE_SYSTEM_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('with HOME unset, detect still runs and warns that the home-folder check was skipped (WR-06)', async ($, on) => {
    const noHome = ambiguousWorld({
      env: { CLAUDE_CONFIG_DIR: '/opt/cfg' },
      realPaths: { '/repo': '/repo', '/opt/cfg': '/opt/cfg' },
    })
    fakeHost(on, noHome, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: HOME is unset or not an absolute path: the home-folder check was skipped')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a .planning entry with a hidden character never makes GSD in use (WR-03)', async ($, on) => {
    const faked = { ...ambiguousWorld(), listings: { '/repo': [entry('.planning\u200B', 'dir')] }, files: {}, dirs: [] }
    fakeHost(on, faked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(rowOf(out.text, 'GSD')).toContain('not found')
    expect(out.text).toContain('Warning: ignored repo entry ".planning": its name has hidden characters or is too long')
    expect(out.text).not.toContain('\u200B')
  })

  test('a CLAUDE_CONFIG_DIR outside home is shown as $CLAUDE_CONFIG_DIR, never as its path (IN-03)', async ($, on) => {
    const outside = {
      ...ambiguousWorld(),
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/opt/cfg' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/opt/cfg': '/opt/cfg' },
      files: {
        '/opt/cfg/gsd-core/VERSION': '1.16.0\n',
        '/opt/cfg/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/opt/cfg/gsd-core'],
    }
    fakeHost(on, outside, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('gsd-core 1.16.0 at $CLAUDE_CONFIG_DIR/gsd-core')
    expect(out.text).not.toContain('/opt/cfg')
  })
})

describe('cadre init with a faked host', () => {
  const POLICY_ASK = 'ask Git policy for .cadre/?'

  /** INIT_ANSWERS with Install answered to the security plugins question (decision #39). */
  const INSTALL_ANSWERS = { ...INIT_ANSWERS, 'Install from claude-plugins-official': 'Install' }

  /** A new enough python3, and both plugin installs exiting 0; the hunk runs stay unscripted (decision #39). */
  const INSTALL_RESULTS = {
    'python3 --version': { exitCode: 0, stdout: 'Python 3.12.1\n' },
    'claude plugin install claude-security@claude-plugins-official': { exitCode: 0, stdout: '' },
    'claude plugin install security-guidance@claude-plugins-official': { exitCode: 0, stdout: '' },
  }

  test('init --dry-run asks the git policy and ends with the dry-run note', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text.split('\n')[0]).toBe('cadre init --dry-run')
    expect(out.text).toContain('Git policy: commit definitions')
    const lines = out.text.split('\n')
    expect(lines[lines.indexOf(policyLine('definitions')) + 1]).toBe('Launchers start in: the git root')
    expect(out.text).not.toContain('new worktrees')
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    const asks = askHeads(log)
    expect(asks.filter(ask => ask === POLICY_ASK)).toHaveLength(1)
    const launchAsk = asks[asks.indexOf(POLICY_ASK) + 1] ?? ''
    expect(launchAsk.startsWith('ask Where should the role launchers start')).toBe(true)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops).not.toContain('process.run')
  })

  test('plain init prints the same reply but ends with the applied lines', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ isWriteAllowed: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text.split('\n')[0]).toBe('cadre init')
    expect(out.text).toContain('Git policy: commit definitions')
    expect(out.text.split('\n').at(-1)).toBe(NEXT_STEP_NOTE)
    expect(out.text).not.toContain('Dry run')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs.filter(run => run[0] !== '/bin/chmod')).toEqual(INIT_RUNS)
    expect(log.cwds.filter((_, at) => log.runs[at]?.[0] !== '/bin/chmod')).toEqual(['/repo', '/repo', '/repo'])
  })

  test('init asks in order: consent, roles, framework, duration, model and effort, git policy', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const prefixes = [
      'ask Read ~/.claude.json',
      'ask Use these roles?',
      'ask Which framework do the roles use?',
      'ask Framework for all roles?',
      'ask Autopilot duration for roles?',
      'ask Model and effort: same for all roles, or per role?',
      'ask Model and effort for all roles?',
      POLICY_ASK,
    ]
    const order = log.asks.flatMap(ask => {
      const at = prefixes.findIndex(prefix => ask.startsWith(prefix))

      return at < 0 ? [] : [at]
    })
    expect(order).toEqual(prefixes.map((_, index) => index))
  })

  test('a GSD repo with no config file asks two hunks after the model questions, before the policy', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const hunkAts = log.asks.flatMap((ask, at) => (ask.startsWith('ask .planning/config.json:') ? [at] : []))
    const modelAt = askHeads(log).indexOf('ask Model and effort for all roles?')
    const policyAt = askHeads(log).indexOf(POLICY_ASK)
    expect(hunkAts).toHaveLength(2)
    expect(modelAt).not.toBe(-1)
    expect(hunkAts.map(at => at > modelAt && at < policyAt)).toEqual([true, true])
    expect(hunkAts.map(at => (log.asks[at] ?? '').split('\n')[0])).toEqual([
      'ask .planning/config.json: mode',
      'ask .planning/config.json: workflow.text_mode',
    ])
    expect(hunkAts.map(at => log.askOptions[at])).toEqual([
      ['Accept', 'Decline'],
      ['Accept', 'Decline'],
    ])
    expect(log.logs.some(text => text.includes('attended:'))).toBe(false)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('commit all prints its own policy line and no worktree line', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)')
    expect(out.text).not.toContain('new worktrees')
  })

  test('ignoring all of .cadre/ adds the line that role definitions will not exist in new worktrees', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Ignore all of .cadre/' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('Git policy: ignore all of .cadre/')
    expect(out.text.split('\n')).toContain("role definitions won't exist in new worktrees")
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  test('a typed word the policy parser knows counts, with the same reply as the label', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': ' Ignore ' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('Git policy: ignore all of .cadre/')
    expect(out.text.split('\n')).toContain("role definitions won't exist in new worktrees")
  })

  test('the dialog shows the three policies in the fixed order, default first', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const at = askHeads(log).indexOf(POLICY_ASK)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(log.askOptions[at]).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
  })

  test('in claude -p (no surfaces) init answers the refusal before any fs, settings or process op', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ surfaces: [] }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(NOT_INTERACTIVE_REPLY)
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a host that cannot say whether anyone is there is treated as non-interactive', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denySurfaces: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(NOT_INTERACTIVE_REPLY)
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session root the host refuses stops init before any read or question', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denyRoot: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe('cadre init could not read the session root, so it stopped before reading anything.')
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session at the home folder is refused with the init wording before any read or question', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(homeRootReply('init'))
    expect(out.text).toContain('cadre init needs a repo root other than your home folder')
    expect(out.text).toContain('run /cadre init again')
    expect(log.ops).toContain('fs.stat /home/u resolve=true')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session in a folder that contains the home folder is refused the same way', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(homeRootReply('init'))
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a symlinked repo root that lands in the home folder is refused by init too', async ($, on) => {
    const log = newLog()
    const linked = initWorld({ root: '/link/repo', realPaths: { '/link/repo': '/home/u', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(homeRootReply('init'))
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session at the file system root is refused with the init wording, even with no HOME', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/', env: {}, realPaths: { '/': '/' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(fileSystemRootReply('init'))
    expect(out.text).toContain('cadre init needs a repo root other than the file system root (/)')
    expect(out.text).toContain('run /cadre init again')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('detect at the home folder still answers the detect wording, byte for byte', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(out.text).toContain('cadre detect needs a repo root other than your home folder')
    expect(out.text).toContain('run /cadre detect again')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a dismissed dialog cancels with the fixed text and never the host rejection text', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Git policy') }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(cancelledReply(GIT_POLICY_DISMISSED_REASON))
    expect(log.logs).not.toContain(GIT_POLICY_DISMISSED_REASON)
    expect(askHeads(log).filter(ask => ask === POLICY_ASK)).toHaveLength(1)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('an answer that is not a listed choice is asked again, three asks in all, then init cancels', async ($, on) => {
    const log = newLog()
    // The asks after a refused answer start with the refusal (D-136), so the world answers that start too.
    const refusal = refusalLine('whatever', 'definitions, all, ignore')
    const answers = { ...INIT_ANSWERS, 'Git policy': 'whatever', [refusal]: 'whatever' }
    fakeHost(on, initWorld({ answers }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    // A pane surface asks the question with its summary, the default policy recommended, the refusal kept on top
    // (D-310).
    const line = 'Recommended: commit definitions'
    const asked = `ask ${withContext(GIT_POLICY_QUESTION, line)}`
    const again = `ask ${refusal}\n${withContext(GIT_POLICY_QUESTION, line)}`
    expect(log.asks.slice(log.asks.indexOf(asked))).toEqual([asked, again, again])
    expect(refusal).toBe("'whatever' isn't one of: definitions, all, ignore.")
    expect(log.logs).not.toContain(NO_USABLE_ANSWER_REASON)
    expect(out.text).toBe(cancelledReply(NO_USABLE_ANSWER_REASON))
  })

  test('init --dry-run makes no process call; plain init runs the accepted hunks, then the chmods', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ isWriteAllowed: true }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.runs).toEqual([])
    expect(log.ops).not.toContain('process.run')
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    const launchers = planRows(out.text).filter(row => row.path.startsWith('.cadre/bin/'))
    expect(launchers.length).toBeGreaterThan(0)
    const chmods = launchers.map(row => ['/bin/chmod', '755', `/repo/${row.path}`])
    expect(log.runs).toEqual([...INIT_RUNS, ...chmods])
    expect(log.cwds).toEqual([...INIT_RUNS.map(() => '/repo'), ...chmods.map(() => '')])
  })

  test('plain init writes every planned file, the manifest last, and makes each launcher executable', async ($, on) => {
    const log = newLog()
    const chmods = ['pm', 'security', 'tl'].map(id => ['/bin/chmod', '755', `/repo/.cadre/bin/${id}`])
    // The accepted GSD hunks exit 0 as well, so the apply is clean (D-120).
    const runs = [...GSD_HUNK_RUNS, ...chmods]
    const runResults = Object.fromEntries(runs.map(argv => [argv.join(' '), { exitCode: 0, stdout: '' }]))
    fakeHost(on, initWorld({ isWriteAllowed: true, runResults }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    const writes = log.ops.filter(op => op.startsWith('fs.write '))
    expect(writes.length).toBeGreaterThan(1)
    expect(writes.indexOf('fs.write /repo/.cadre/manifest.json')).toBe(writes.length - 1)
    expect(log.writes).toEqual(writes.map(op => op.slice('fs.write '.length)))
    expect(log.runs).toEqual([...INIT_RUNS, ...chmods])
    expect(log.cwds).toEqual([...INIT_RUNS.map(() => '/repo'), ...chmods.map(() => '')])
    for (const argv of chmods) expect(log.ops[log.ops.indexOf(`fs.write ${argv[2]}`) + 1]).toBe('process.run')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    const applied = `Applied: wrote ${writes.length} files (3 executable).`
    expect(out.text.split('\n').slice(-3)).toEqual([applied, FOLDERS_UNKNOWN, NEXT_STEP_NOTE])
  })

  test('init --dry-run in a world that allows writes still writes and runs nothing (PLAN-02)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ isWriteAllowed: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.ops.filter(op => op.startsWith('fs.write '))).toEqual([])
    expect(log.writes).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('a launcher link planted after the review gets no write and no chmod; no manifest', async ($, on) => {
    const log = newLog()
    const base = initWorld()
    // A source file keeps BE in the proposal, so its launcher is planned (D-85).
    const listings = {
      ...base.listings,
      '/repo': [...base.listings['/repo'], entry('src', 'dir')],
      '/repo/src': [entry('a.ts')],
    }
    // The plan apply makes again from the disk stats the launcher once and sees no link; the link is planted from the
    // second stat, apply's own right before the write (D-120).
    const linkAfterReview = { path: '/repo/.cadre/bin/be', realPath: '/elsewhere/be', fromStat: 2 }
    fakeHost(on, initWorld({ isWriteAllowed: true, listings, linkAfterReview }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    const beRows = planRows(out.text).filter(row => row.path === '.cadre/bin/be')
    expect(beRows).toEqual([{ kind: 'create', path: '.cadre/bin/be' }])
    expect(log.ops).not.toContain('fs.write /repo/.cadre/bin/be')
    expect(log.runs.filter(run => run.includes('/repo/.cadre/bin/be') || run.includes('/elsewhere/be'))).toEqual([])
    expect(log.ops).not.toContain('fs.write /repo/.cadre/manifest.json')
    for (const id of ['pm', 'security', 'tl']) {
      expect(log.ops).toContain(`fs.write /repo/.cadre/bin/${id}`)
      expect(log.runs.map(run => run.join(' '))).toContain(`/bin/chmod 755 /repo/.cadre/bin/${id}`)
    }
    const refused = 'refused to write .cadre/bin/be: it or a folder above it is a link, or not inside the repo'
    const lines = out.text.split('\n')
    expect(lines).toContain('warning: .cadre/bin/be was not made executable: its write was refused or failed')
    expect(lines).toContain(`warning: ${refused}`)
    expect(lines).toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('two init runs with the same answers give identical text', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), newLog())
    const first = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const second = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(second.text).toBe(first.text)
  })

  test('init guards before it scans, asks the ~/.claude.json consent first and logs no scan', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.asks[0]?.startsWith('ask Read ~/.claude.json for MCP server names?')).toBe(true)
    expect(log.logs.join('\n')).not.toContain('Repo scan (read-only):')
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    const guardAt = log.ops.indexOf('fs.exists /home/u/.claude/autopilot/s1.json')
    expect(guardAt >= 0 && guardAt < log.ops.indexOf('fs.list /repo')).toBe(true)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops.filter(op => op === 'process.run').length <= 1).toBe(true)
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  test('init --dry-run opens the cadre-init pane before its first question, the consent (D-324)', async ($, on) => {
    const log = newLog()
    const opensAtAsk: number[] = []
    const onAsk = async (): Promise<void> => void opensAtAsk.push(log.panes.length)
    // With no session history the roles question is the first one after the scan, so a dismissal ends init there.
    fakeHost(on, initWorld({ answers: answersWithout('Use these roles?'), onAsk }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(cancelledReply(ROLES_DISMISSED_REASON))
    expect(askHeads(log)).toEqual([`ask ${CLAUDE_JSON_QUESTION}`, `ask ${ROLES_QUESTION}`])
    expect([opensAtAsk, log.panes]).toEqual([[1, 1], ['ui.open cadre-init cadre init']])
    expect(log.logs.join('\n')).not.toContain('Repo scan (read-only):')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('init --dry-run still replies with its plan when the host refuses the pane (T-02-50)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denyPane: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('File plan:')
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    expect(log.paneStates.length).toBeGreaterThan(0)
    expect(log.logs.join('\n')).not.toContain('Repo scan (read-only):')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('init --dry-run writes the pane state only, no block, and logs one-line notes only (D-303)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const isPaneState = (state: unknown): boolean =>
      isObject(state) && Object.keys(state).sort().join() === 'loader,open'
    expect([log.paneStates.length > 0, log.paneStates.filter(state => !isPaneState(state))]).toEqual([true, []])
    expect(log.logs.every(text => !text.includes('\n'))).toBe(true)
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('a second run starts from the idle pane state the first left, and ends idle (D-133, D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const firstRun = log.paneStates.length
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect([firstRun > 0, log.paneStates[firstRun - 1], log.paneStates.at(-1)]).toEqual([true, IDLE_STATE, IDLE_STATE])
    expect(log.panes).toEqual(['ui.open cadre-init cadre init', 'ui.open cadre-init cadre init'])
  })

  test('init --dry-run closes the cadre-init pane once when it finishes (D2)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.closes).toEqual(['ui.close cadre-init'])
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
  })

  test('a run cancelled by a dismissed dialog still closes the pane it opened (D2)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Git policy') }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(cancelledReply(GIT_POLICY_DISMISSED_REASON))
    expect(log.closes).toEqual(['ui.close cadre-init'])
  })

  test('each of two init --dry-run runs closes the pane it opened (D2)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.closes).toEqual(['ui.close cadre-init', 'ui.close cadre-init'])
  })

  test('a run that shows no block closes no pane: detect and help (D2)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    await $.command.run({ command: 'cadre', args: '' })
    expect(log.closes).toEqual([])
  })

  test('detect, help, start and status open no pane: only init and regen do (D-324)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await statusHostWorld(), log)
    for (const args of ['detect', '', 'start be', 'status be']) await $.command.run({ command: 'cadre', args })
    expect([log.panes, log.closes]).toEqual([[], []])
  })

  test('a close the host refuses is swallowed, so init --dry-run still replies with its plan (D2)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denyClose: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('File plan:')
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.closes).toEqual(['ui.close cadre-init'])
  })

  test('the init port never reads a folder: a folder the scans probe is checked and left unread', async ($, on) => {
    const log = newLog()
    const folders = ['/repo/.cadre', '/home/u/.claude/agents']
    const world = initWorld({ dirs: [...initWorld().dirs, ...folders] })
    fakeHost(on, world, log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    for (const folder of folders) {
      expect(log.ops).toContain(`fs.exists ${folder}`)
      expect(log.ops.some(op => op.startsWith(`fs.stat ${folder} `))).toBe(true)
    }
    const known = [...Object.keys(world.listings), ...world.dirs]
    const read = log.ops.filter(op => op.startsWith('fs.read ')).map(op => op.slice('fs.read '.length))
    expect(read.filter(path => known.includes(path))).toEqual([])
  })

  test('plain init answered Install runs both plugin installs from home after Confirm (#39)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ isWriteAllowed: true, answers: INSTALL_ANSWERS, runResults: INSTALL_RESULTS }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    const installs = log.runs.flatMap((run, at) => (run[0] === 'claude' ? [{ run, cwd: log.cwds[at] }] : []))
    expect(installs).toEqual([
      { run: ['claude', 'plugin', 'install', 'claude-security@claude-plugins-official'], cwd: '/home/u' },
      { run: ['claude', 'plugin', 'install', 'security-guidance@claude-plugins-official'], cwd: '/home/u' },
    ])
    expect(out.text.split('\n')).toContain(
      'Installed claude-security@claude-plugins-official and security-guidance@claude-plugins-official: ' +
        'run /reload-plugins to load them in this session.',
    )
    expect(out.text.split('\n').at(-1)).toBe(NEXT_STEP_NOTE)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('init --dry-run answered Install asks the question but runs no process (#39, T-03-40)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ isWriteAllowed: true, answers: INSTALL_ANSWERS, runResults: INSTALL_RESULTS }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.asks.some(ask => ask.startsWith('ask Install from claude-plugins-official'))).toBe(true)
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.ops).not.toContain('process.run')
    expect([log.runs, log.writes]).toEqual([[], []])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('init --dry-run shows the missing security plugins in their question context (#39, D-299)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const lines = openedContext(log, SECURITY_INSTALL_PREFIX)?.lines ?? []
    // The team's recommendations fold first into the question's context, under their own heading line, the fold title
    // not repeated (D-302).
    const own = lines.slice(lines.indexOf('') + 1)
    expect([lines[0], own.map(line => line.split(': ')[0])]).toEqual([
      t('ui.recommendations.recommendationsHeading'),
      ['claude-security@claude-plugins-official', 'security-guidance@claude-plugins-official'],
    ])
    expect(lines.filter(line => line.includes('/security-review'))).toEqual([])
  })
})

/** A single-select question of the model's own, with two options and no preview. */
const PICK_QUESTION = {
  question: 'Pick one?',
  header: 'Pick',
  multiSelect: false,
  options: [
    { label: 'A', description: 'a' },
    { label: 'B', description: 'b' },
  ],
}

/** The cadre-init pane as the terminal asks cadre to draw it. */
const PANE_ON_TERMINAL: Omit<MountTarget<'terminal', 'Pane'>, 'props'> = {
  plugin: 'cadre',
  surface: 'terminal',
  component: 'Pane',
  requestId: 'cadre-init',
}

/** The Pane props a terminal draws the cadre-init pane with on its main screen: inline, above the prompt. */
const INLINE_PANE: MountTarget<'terminal', 'Pane'>['props'] = {
  title: 'cadre init',
  isFocused: false,
  bodyColumns: 60,
  placement: 'inline',
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

/** The same pane docked beside the transcript, as a fullscreen terminal seats it. */
const DOCK_PANE: MountTarget<'terminal', 'Pane'>['props'] = { ...INLINE_PANE, placement: 'dock' }

describe('the init pane as the option preview of a dialog on the main screen (D3)', () => {
  /** The options with no preview of PICK_QUESTION, as the fake host sees a dialog passed through. */
  const NO_PREVIEWS = [[undefined, undefined]]

  /** What $.ui.ask is given for `Pick one?` (A3): options A and B under the chip Pick. */
  const PICK_SPEC: AskSpec = { options: ['A', 'B'], header: 'Pick' }

  /** A question that offers a typed answer under Other, as a question of the model's own may (R4). */
  const NAME_QUESTION = 'Name it, or type one under Other.'

  /**
   * A plugin whose `/ask-probe` command asks the question in its args through the real $.ui.ask, as cadre's own init
   * asks do, and replies `{"answer":<text>}`, or `{}` when the ask rejects (A3). The kit's `$` has no $.ui.ask; this
   * ask runs through cadre's tool.call hook and the fake host beneath it. Its register closes over nothing of this
   * file, as the kit requires of an inline plugin.
   */
  const ASKER = {
    name: 'asker',
    register(on: HostOn) {
      on('command.run', { command: 'ask-probe' }, async ($, e) => {
        const { question, spec }: { readonly question: string; readonly spec: AskSpec } = JSON.parse(e.args)
        const text = await $.ui.ask(question, spec).then(
          answer => JSON.stringify({ answer }),
          () => '{}',
        )

        return { text }
      })
    },
  }

  /** The test options that load ASKER beside cadre. */
  const WITH_ASKER = { plugins: [ASKER] }

  /** A question asked through ASKER: the answer $.ui.ask resolved to, or null when it rejected. */
  type Ask = (question: string, spec: AskSpec) => Promise<string | null>

  /** The ask of a test that loads ASKER: ASKER's `/ask-probe` asks the question with the spec through $.ui.ask. */
  function probeAsk($: Engine): Ask {
    return async (question, spec) => {
      const { text } = await $.command.run({ command: 'ask-probe', args: JSON.stringify({ question, spec }) })
      if (text === undefined) return null
      const reply: unknown = JSON.parse(text)

      return isObject(reply) && typeof reply.answer === 'string' ? reply.answer : null
    }
  }

  /**
   * Runs `init --dry-run`, so the pane holds the run's blocks, then has the terminal draw the cadre-init pane with
   * `props`: inline on the main screen, or docked as fullscreen seats it. It gives the ask of a test that loads ASKER.
   * Every `$.command.run` of this describe goes through it, but the one of the test with no render.
   */
  async function seatAfterRun($: Engine, props: MountTarget<'terminal', 'Pane'>['props']): Promise<Ask> {
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    await $.ui.mount({ ...PANE_ON_TERMINAL, props })

    return probeAsk($)
  }

  /** The own context of the question openAsCadre opens unless a test gives another (D-203): one line, under a title. */
  const PICK_CONTEXT: AskContext = { title: 'Pick context', lines: ['What each pick means.'], kind: 'review' }

  /**
   * Has the host read `question` as the question cadre has open (D-239), with `context` as its own context (D-203),
   * one that takes a typed answer unless `acceptsTyped` says not (D-234) and a note when it takes a typed answer or
   * `takesNote` says so (D-270): every read of cadre's pane state gives it open with no loader (D-303), so a dialog
   * that asks it is cadre's own and the hook may rewrite it, as init's own questions are.
   */
  function openAsCadre(
    on: HostOn,
    question: string,
    context: AskContext | null = PICK_CONTEXT,
    acceptsTyped = true,
    takesNote = acceptsTyped,
  ): void {
    const open = { question, header: null, context, acceptsTyped, takesNote }
    on('state.get', async (_$, e, next) => {
      if (e.plugin !== 'cadre' || e.key !== 'pane') return next(e)

      return { value: { value: { open, loader: null }, version: 1 } }
    })
  }

  /** initWorld with `Pick one?` answered `answer` and, when given, `notes` typed in that dialog's notes (A3). */
  function pickWorld(answer: string, notes?: string): World {
    const answers = { ...INIT_ANSWERS, 'Pick one?': answer }

    return initWorld(notes === undefined ? { answers } : { answers, notes: { 'Pick one?': notes } })
  }

  test("after a run, each option of an inline pane dialog previews the open question's own context", async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askOptions.slice(before)).toEqual([['A', 'B', 'Describe your own']])
    const seen = log.askPreviews.slice(before)
    expect(seen).toHaveLength(1)
    const [first, ...rest] = seen[0] ?? []
    expect(first).toBe(['**Pick context**', '```', 'What each pick means.', '```'].join('\n'))
    expect(rest).toEqual([first, first])
  })

  test('a docked pane gives no preview', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, DOCK_PANE)
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('with no terminal render of the pane after the run, no preview is given', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('a multi-select question gets no preview', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, multiSelect: true }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('a question with no options makes the whole call pass through unchanged', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [PICK_QUESTION, { ...PICK_QUESTION, question: 'Empty?', options: [] }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test("an inline pane with no block yet still previews the open question's own context (D-203)", async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    const seen = log.askPreviews.slice(before)[0] ?? []
    expect(seen).toHaveLength(3)
    expect(seen.every(preview => typeof preview === 'string' && preview.startsWith('**Pick context**'))).toBe(true)
  })

  test('a question previews its own context, never the block its chip names (D-203)', async ($, on) => {
    const log = newLog()
    const lines = ['Commit all: only per-user files are ignored.']
    const policy: AskContext = { title: 'Git policy', lines, kind: 'git-policy' }
    openAsCadre(on, PICK_QUESTION.question, policy)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, header: 'Roles' }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    const seen = log.askPreviews.slice(before)[0] ?? []
    expect(seen).toHaveLength(3)
    expect(seen.every(preview => typeof preview === 'string' && preview.startsWith('**Git policy**'))).toBe(true)
  })

  test('a question with no context, as a hunk, gets no preview and no Describe your own (D-203)', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question, null)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, header: 'Hunk 1 of 2' }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    expect([log.askOptions.slice(before), log.askPreviews.slice(before)]).toEqual([[['A', 'B']], NO_PREVIEWS])
  })

  test('the own-skills entry and the instructions consent preview their own context (C12)', async ($, on) => {
    const log = newLog()
    // The pane is seated inline again at every ask, as a terminal main screen keeps it drawn (D3).
    const reseat = async (): Promise<void> => {
      const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
      await ui.unmount()
    }
    const world = initWorld({
      onAsk: reseat,
      ancestors: [{ dir: '/repo', name: 'CLAUDE.md', content: '# Rules', parts: [] }],
      commands: [{ name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' }],
      answers: {
        ...INIT_ANSWERS,
        'Read your CLAUDE.md files': 'No, skip it',
        [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group',
      },
    })
    fakeHost(on, world, log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const previewOf = (prefix: string): string => {
      const [preview] = log.askPreviews[log.asks.findIndex(ask => ask.startsWith(`ask ${prefix}`))] ?? []

      return typeof preview === 'string' ? preview : ''
    }
    const own = previewOf(OWN_SKILLS_ENTRY_PREFIX)
    const files = previewOf('Read your CLAUDE.md files')
    expect([own.split('\n')[0], files.split('\n')[0]]).toEqual(['**Your own skills**', '**Instruction files**'])
    expect([own.includes('deploy-notes: Write the release notes'), files.includes('repo/CLAUDE.md')]).toEqual([
      true,
      true,
    ])
    expect(files.includes('<repo>/')).toBe(false)
  })

  test('a question that takes no typed answer gets no Describe your own and no hint (D-234)', async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question, PICK_CONTEXT, false)
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.asks.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect([log.asks.slice(before), log.askOptions.slice(before)]).toEqual([['ask Pick one?'], [['A', 'B']]])
  })

  test('Roles keeps its own describe option alone; Duration takes a typed answer, gets one (D-234)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    // On the TUI default every question with a context of its own is previewed (D-208).
    const presentation = { isFullscreen: false, columns: 120 }
    await $.command.run({ command: 'cadre', args: 'init --dry-run', origin: { kind: 'composer' }, presentation })
    const at = (prefix: string): number => log.asks.findIndex(ask => ask.startsWith(`ask ${prefix}`))
    const [roles, duration] = [at(ROLES_QUESTION), at(DURATION_QUESTION)]
    expect(log.askOptions[roles]).toEqual(['Use these roles', 'Adjust them', 'Describe my own structure'])
    expect(log.asks[roles]?.includes(OWN_ANSWER_HINT)).toBe(false)
    expect([log.askOptions[duration]?.at(-1), log.asks[duration]?.endsWith(OWN_ANSWER_HINT)]).toEqual([
      'Describe your own',
      true,
    ])
  })

  test("each option previews its context wrapped to the box: the command's columns less 38 (D-231)", async ($, on) => {
    const log = newLog()
    const line = Array.from({ length: 20 }, () => 'word').join(' ')
    openAsCadre(on, PICK_QUESTION.question, { title: 'Wide', lines: [line], kind: 'review' })
    fakeHost(on, initWorld(), log)
    const presentation = { isFullscreen: false, columns: 80 }
    await $.command.run({ command: 'cadre', args: 'init --dry-run', origin: { kind: 'composer' }, presentation })
    await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    const [preview] = log.askPreviews.slice(before)[0] ?? []
    const rows = typeof preview === 'string' ? preview.split('\n').slice(2, -1) : []
    expect([rows.every(row => Array.from(row).length <= 42), rows.join(' '), rows.length]).toEqual([true, line, 3])
  })

  /** The preview rows of the next AskUserQuestion call of PICK_QUESTION, between its fences (D-231). */
  async function pickPreviewRows($: Engine, log: HostLog): Promise<string[]> {
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    const [preview] = log.askPreviews.slice(before)[0] ?? []

    return typeof preview === 'string' ? preview.split('\n').slice(2, -1) : []
  }

  test('each option follows a terminal resize: the width the pane render reported less 38 (#163)', async ($, on) => {
    const log = newLog()
    const line = Array.from({ length: 20 }, () => 'word').join(' ')
    openAsCadre(on, PICK_QUESTION.question, { title: 'Wide', lines: [line], kind: 'review' })
    fakeHost(on, initWorld(), log)
    const presentation = { isFullscreen: false, columns: 80 }
    await $.command.run({ command: 'cadre', args: 'init --dry-run', origin: { kind: 'composer' }, presentation })
    await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE, viewport: { columns: 100, rows: 48 } })
    const rows = await pickPreviewRows($, log)
    expect([rows.every(row => Array.from(row).length <= 62), rows.join(' '), rows.length]).toEqual([true, line, 2])
  })

  test('a note typed in the dialog is what $.ui.ask resolves to, trimmed (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('A', '  my words  '), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('my words')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('Describe your own with no note resolves to an empty answer (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('Describe your own'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('an option chosen with no note resolves to its label (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('B'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('B')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('a 4-option question gets the hint line and keeps its answer key (A2, A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('C'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', { options: ['A', 'B', 'C', 'D'], header: 'Pick' })).toBe('C')
    expect(log.asks.at(-1)).toBe('ask Pick one?\nOr press n, type your own answer, then Enter.')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'C', 'D'])
  })

  test('a docked pane adds no option and takes no note as the answer (A1)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('A', '  my words  '), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('A')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B'])
  })

  test('a dismissed dialog still rejects $.ui.ask: the deny passes through', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, initWorld(), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe(null)
    expect(log.asks.at(-1)).toBe(`ask Pick one?\n${OWN_ANSWER_HINT}`)
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('a 2-option question gets the hint line too, and keeps its answer key (R3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question)
    fakeHost(on, pickWorld('B'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('B')
    expect(log.asks.at(-1)).toBe(`ask Pick one?\n${OWN_ANSWER_HINT}`)
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test("an inline pane asks 'under Other' as a note, keyed as asked (R4)", WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, NAME_QUESTION)
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Name it': 'A' } }), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask(NAME_QUESTION, PICK_SPEC)).toBe('A')
    expect(log.asks.at(-1)).toBe(`ask Name it, or type one as a note (press n).\n${OWN_ANSWER_HINT}`)
  })

  test("a docked pane asks the question as it is, 'under Other' included (R4)", WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, NAME_QUESTION)
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Name it': 'A' } }), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask(NAME_QUESTION, PICK_SPEC)).toBe('A')
    expect(log.asks.at(-1)).toBe('ask Name it, or type one under Other.')
  })

  /** The review as a pane surface asks it on its last page: Confirm and Change something… (D-233, ASKED #24). */
  const CHANGE_SPEC: AskSpec = { options: ['Confirm', 'Change something…'], header: 'Review' }

  test('on a pane surface a note typed with Change something… is the answer (ASKED #24)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, 'Review it?', PICK_CONTEXT, false, true)
    const answers = { ...INIT_ANSWERS, 'Review it?': 'Change something…' }
    fakeHost(on, initWorld({ answers, notes: { 'Review it?': ' roles ' } }), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask('Review it?', CHANGE_SPEC)).toBe('roles')
    expect([log.asks.at(-1), log.askPreviews.at(-1)]).toEqual(['ask Review it?', [undefined, undefined]])
  })

  test('a pane question with no Change something… takes no note as answer (ASKED #24)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    openAsCadre(on, PICK_QUESTION.question, PICK_CONTEXT, false)
    fakeHost(on, pickWorld('A', 'roles'), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('A')
  })

  test("another plugin's Change something… passes through untouched (T-02.1-106)", WITH_ASKER, async ($, on) => {
    const log = newLog()
    const answers = { ...INIT_ANSWERS, 'Review it?': 'Change something…' }
    fakeHost(on, initWorld({ answers, notes: { 'Review it?': 'roles' } }), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask('Review it?', CHANGE_SPEC)).toBe('Change something…')
  })

  test("another plugin's question asked during a run passes through untouched (D-239)", WITH_ASKER, async ($, on) => {
    const log = newLog()
    const answers: (string | null)[] = []
    // With init's roles question open and the pane seated inline, ASKER asks a question of its own.
    const askAtRoles = async (): Promise<void> => {
      if (!(log.asks.at(-1) ?? '').startsWith(`ask ${ROLES_QUESTION}`)) return
      const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
      await ui.unmount()
      answers.push(await probeAsk($)('Pick one?', PICK_SPEC))
    }
    const world = pickWorld('A', '  my words  ')
    fakeHost(on, { ...world, onAsk: askAtRoles }, log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const at = log.asks.indexOf('ask Pick one?')
    expect(answers).toEqual(['A'])
    expect([log.askOptions[at], log.askPreviews[at]]).toEqual([['A', 'B'], [undefined, undefined]])
  })

  test("after the run, another plugin's question passes through untouched (D-239)", WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('A', '  my words  '), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('A')
    expect(log.asks.at(-1)).toBe('ask Pick one?')
    expect([log.askOptions.at(-1), log.askPreviews.at(-1)]).toEqual([['A', 'B'], [undefined, undefined]])
  })

  test('the git policy context goes to the open question, never to the dialog (D-203)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    const open: unknown[] = []
    const atPolicy = async (): Promise<void> => {
      if ((log.asks.at(-1) ?? '').startsWith(`ask ${GIT_POLICY_QUESTION}`)) open.push(openOf(log.paneStates.at(-1)))
    }
    fakeHost(on, initWorld({ onAsk: atPolicy }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const [policy] = open
    expect(open).toHaveLength(1)
    expect(isObject(policy) && isObject(policy.context) ? policy.context.kind : null).toBe('git-policy')
    expect(log.askQuestions.filter(asked => isObject(asked) && Object.hasOwn(asked, 'context'))).toEqual([])
  })

  test('golden: option previews of the init dry run on the main screen (D-219)', async ($, on) => {
    const log = newLog()
    const headers: unknown[] = []
    // The kit draws the pane only on a mount, and the first block of a run clears its seat (D3), so the pane is seated
    // inline again at every ask, as a terminal main screen keeps it drawn; the header open at that ask is kept.
    const reseat = async (): Promise<void> => {
      headers.push(headerOf(log.paneStates.at(-1)))
      const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
      await ui.unmount()
    }
    fakeHost(on, initWorld({ onAsk: reseat }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const asked = log.askOptions.map((options, at) => ({
      header: headers[at] ?? null,
      options,
      previews: (log.askPreviews[at] ?? []).map(preview => (typeof preview === 'string' ? preview : null)),
    }))
    expect(asked).toEqual(GOLDEN_PREVIEWS)
  })
})

describe('the init pane draws the block of the question being asked (R1)', () => {
  /**
   * `init --dry-run` as the person types it at the prompt, with the origin and presentation the engine stamps on a run:
   * the kit's types ask for both. The run is in the fullscreen layout, a pane surface, so the side pane opens (D-208);
   * on the terminal main screen the TUI default opens none.
   */
  const DRY_RUN: Parameters<Engine['command']['run']>[0] = {
    command: 'cadre',
    args: 'init --dry-run',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  }

  /** What one drawing of the cadre-init pane shows (R1): the text of its first row, and how many rows it has. */
  type Drawn = {
    readonly first: string | undefined
    readonly rows: number
  }

  /** What the pane showed while the test's own dialog was open, and the header last written by then (R1). */
  type Open = {
    readonly drawn: Drawn
    readonly header: unknown
  }

  /**
   * Has the terminal draw the cadre-init pane with `props` and gives what it shows, then lets the drawing go: the kit
   * holds one drawing of the pane at a time, so the next mount is a fresh one.
   */
  async function drawPane($: Engine, props: MountTarget<'terminal', 'Pane'>['props']): Promise<Drawn> {
    const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props })
    const box = await ui.find({ type: 'Box' })
    const first = await ui.find({ type: 'Text' })
    await ui.unmount()

    return { first: first?.text, rows: box?.children.length ?? 0 }
  }

  /**
   * What a drawing of only the own context of the first question the run opened with `prefix` shows (R1, D-299,
   * D-313): the rows the one renderer draws for it (paneDrawn), each wrapped to the 60 columns of the test's pane body
   * (D-231), its title first.
   */
  function contextDrawn(log: HostLog, prefix: string): Drawn {
    const block = openedBlock(log, prefix)
    if (block === null) return { first: undefined, rows: 0 }

    return { first: block.title, rows: paneDrawn(block, INLINE_PANE.bodyColumns).length }
  }

  /**
   * The runs of each row of a drawing of the cadre-init pane with `props`, each its text and its look as the Text that
   * draws it carries it (D1, D-313): its colour, bold and dim.
   */
  async function paneLooks($: Engine, props: MountTarget<'terminal', 'Pane'>['props']): Promise<PaneSpan[][]> {
    const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props })
    const box = await ui.find({ type: 'Box' })
    await ui.unmount()

    return (box?.children ?? []).map(row => {
      const spans: unknown[] = isObject(row) && Array.isArray(row.children) ? row.children : []

      return spans.flatMap((span): PaneSpan[] => {
        if (!isObject(span) || !Array.isArray(span.children)) return []
        const look = isObject(span.props) ? span.props : {}
        const color = look.color === 'claude' || look.color === 'success' ? look.color : undefined

        return [
          {
            text: span.children.join(''),
            ...(color === undefined ? {} : { color }),
            ...(look.bold === true ? { bold: true } : {}),
            ...(look.dimColor === true ? { dim: true } : {}),
          },
        ]
      })
    })
  }

  /** The span texts of each row of a drawing of the cadre-init pane with `props` (D1), as the goldens pin them. */
  async function paneTexts($: Engine, props: MountTarget<'terminal', 'Pane'>['props']): Promise<string[][]> {
    const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props })
    const box = await ui.find({ type: 'Box' })
    await ui.unmount()

    return (box?.children ?? []).map(row => {
      const spans: unknown[] = isObject(row) && Array.isArray(row.children) ? row.children : [row]

      return spans.map(span => (isObject(span) && Array.isArray(span.children) ? span.children.join('') : String(span)))
    })
  }

  /**
   * The onAsk of a world that has the terminal draw the pane with `props` at the run's first Review question, the
   * span texts of its rows going into `drawn` (D-219, D-299): the Review's own context, its first page on a pane
   * surface. Init's other dialogs are left alone.
   */
  function drawAtReview(
    $: Engine,
    log: HostLog,
    props: MountTarget<'terminal', 'Pane'>['props'],
    drawn: string[][][],
  ): () => Promise<void> {
    return async () => {
      if (drawn.length > 0 || !(log.asks.at(-1) ?? '').startsWith(`ask ${REVIEW_QUESTION}`)) return
      drawn.push(await paneTexts($, props))
    }
  }

  /**
   * The onAsk of a world that has the terminal draw the pane with `props` while init's own question `question` is open
   * (R1): what the pane showed and the header last written by then go into `open`. Init's other dialogs are left alone.
   */
  function drawWhileOpen(
    $: Engine,
    log: HostLog,
    props: MountTarget<'terminal', 'Pane'>['props'],
    open: Open[],
    question: string,
  ): () => Promise<void> {
    return async () => {
      if (!(log.asks.at(-1) ?? '').startsWith(`ask ${question}`)) return
      open.push({ drawn: await drawPane($, props), header: headerOf(log.paneStates.at(-1)) })
    }
  }

  /** What a drawing of the idle pane shows: the empty text alone, with no rows (D-299, D-324). */
  const EMPTY_DRAWN: Drawn = { first: t('register.paneEmpty'), rows: 0 }

  test('after a run, a mount of the pane draws the idle frame, no block of the run (D-299, D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run(DRY_RUN)
    expect(await drawPane($, INLINE_PANE)).toEqual(EMPTY_DRAWN)
  })

  test('each ask writes one pane state with its question open, its answer the idle one (D-303)', async ($, on) => {
    const log = newLog()
    const atAsk: { readonly at: number; readonly state: unknown }[] = []
    const onAsk = async (): Promise<void> => {
      atAsk.push({ at: log.paneStates.length, state: log.paneStates.at(-1) })
    }
    fakeHost(on, initWorld({ onAsk }), log)
    await $.command.run(DRY_RUN)
    const opened = atAsk.map(({ state }) =>
      isObject(state) && isObject(state.open) && state.loader === null ? `ask ${String(state.open.question)}` : null,
    )
    expect([opened.length > 5, opened]).toEqual([true, log.asks])
    expect(atAsk.map(({ at }) => log.paneStates[at])).toEqual(atAsk.map(() => IDLE_STATE))
  })

  test('a run that finishes writes the idle pane state last and closes the pane (D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run(DRY_RUN)
    expect([log.paneStates.at(-1), log.closes]).toEqual([IDLE_STATE, ['ui.close cadre-init']])
  })

  test('a run cancelled by a dismissed dialog writes the idle state last, its pane closed (D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Git policy') }), log)
    const out = await $.command.run(DRY_RUN)
    expect(out.text).toBe(cancelledReply(GIT_POLICY_DISMISSED_REASON))
    expect([log.paneStates.at(-1), log.closes]).toEqual([IDLE_STATE, ['ui.close cadre-init']])
  })

  test('while the history question is open the pane draws its own context, the scan (D-299)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    fakeHost(on, historyHostWorld({ onAsk: drawWhileOpen($, log, INLINE_PANE, open, HISTORY_QUESTION) }), log)
    await $.command.run(DRY_RUN)
    expect(open.map(entry => [entry.drawn.first, entry.drawn.rows > 1])).toEqual([['Scan', true]])
  })

  test('while the MCP entry question is open the pane draws its own context, the servers (D-300)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    const tools = [{ name: 'mcp__sentry__issues', description: 'Issues.', mcp: true }]
    const entry = 'Which roles get the MCP servers'
    fakeHost(on, initWorld({ tools, onAsk: drawWhileOpen($, log, INLINE_PANE, open, entry) }), log)
    await $.command.run(DRY_RUN)
    expect([open, open[0]?.drawn.first]).toEqual([[{ drawn: contextDrawn(log, entry), header: 'MCP' }], 'MCP servers'])
  })

  test('an inline pane drawn while a question is open draws its context, then the idle one (D-299)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    fakeHost(on, initWorld({ onAsk: drawWhileOpen($, log, INLINE_PANE, open, ROLES_QUESTION) }), log)
    await $.command.run(DRY_RUN)
    expect(open).toEqual([{ drawn: contextDrawn(log, ROLES_QUESTION), header: 'Roles' }])
    // The question's last write is the one that landed: the line logged on the scan's loader (D-325) moved the state's
    // version under the first one, which update tried again.
    const at = log.paneStates.map(headerOf).lastIndexOf('Roles')
    expect(log.paneStates.slice(at + 1, at + 2)).toEqual([IDLE_STATE])
    expect(await drawPane($, INLINE_PANE)).toEqual(EMPTY_DRAWN)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('a docked pane drawn while a question is open draws its own context too: every placement', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    fakeHost(on, initWorld({ onAsk: drawWhileOpen($, log, DOCK_PANE, open, ROLES_QUESTION) }), log)
    await $.command.run(DRY_RUN)
    expect(open).toEqual([{ drawn: contextDrawn(log, ROLES_QUESTION), header: 'Roles' }])
    // The question's last write is the one that landed, as for the inline pane (D-325).
    const at = log.paneStates.map(headerOf).lastIndexOf('Roles')
    expect(log.paneStates.slice(at + 1, at + 2)).toEqual([IDLE_STATE])
    expect(await drawPane($, DOCK_PANE)).toEqual(EMPTY_DRAWN)
  })

  test('the Git policy question draws its own context while open, not the newest block (D-203)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    fakeHost(on, initWorld({ onAsk: drawWhileOpen($, log, INLINE_PANE, open, GIT_POLICY_QUESTION) }), log)
    await $.command.run(DRY_RUN)
    // Its title, its summary (D-313), then its three policy lines, the first of 67 code points taking two rows of the
    // 60-column body (D-231).
    expect(open).toEqual([{ drawn: { first: 'Git policy', rows: 6 }, header: 'Git policy' }])
  })

  test('the security question draws its own context, the missing plugins, not a block (D-203)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    fakeHost(on, initWorld({ onAsk: drawWhileOpen($, log, DOCK_PANE, open, SECURITY_INSTALL_PREFIX) }), log)
    await $.command.run(DRY_RUN)
    expect(open.map(entry => [entry.drawn.first, entry.header])).toEqual([['Security plugins', 'Security']])
  })

  test('a dismissed dialog still writes the idle state, so the pane draws the empty frame (D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Use these roles?') }), log)
    await $.command.run(DRY_RUN)
    expect(askHeads(log).at(-1)).toBe(`ask ${ROLES_QUESTION}`)
    const at = log.paneStates.map(headerOf).lastIndexOf('Roles')
    // The dialog's own idle state, then the run's at its end and the pane's as it closes (D-304).
    expect(log.paneStates.slice(at + 1)).toEqual([IDLE_STATE, IDLE_STATE, IDLE_STATE])
    expect(await drawPane($, INLINE_PANE)).toEqual(EMPTY_DRAWN)
  })

  test('a run writes the idle state when it ends, after the idle state of its last dialog (D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run(DRY_RUN)
    // The last dialog's own idle state, then the run's at its end and the pane's as it closes.
    expect(log.paneStates.slice(-3)).toEqual([IDLE_STATE, IDLE_STATE, IDLE_STATE])
  })

  test('a scroll the host cannot do never blocks a question: init asks on and replies (D-209)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    // The kit has no ui.scroll, so each scroll to a new question's start fails once the pane is open (#156).
    const out = await $.command.run(DRY_RUN)
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    expect(askHeads(log).at(-1)).toBe(`ask ${REVIEW_QUESTION}`)
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  /**
   * initWorld with one skill of the user's own, so init makes one model call for its roles (G-02-1b), answered at once
   * with no recommendation, so the entry offers no Accept and the skill goes to the whole group (D-279); `onComplete`
   * runs inside that call.
   */
  function oneCallWorld(onComplete?: () => Promise<void>): World {
    const commands = [{ name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' }]
    const answers = { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }
    const world = { commands, answers, replies: ['{"skills":{},"groups":{}}'] }

    return initWorld(onComplete === undefined ? world : { ...world, onComplete })
  }

  test('the pane drawn while a model call runs draws its label and summary alone (D-299, D-301)', async ($, on) => {
    const log = newLog()
    const drawn: Drawn[] = []
    fakeHost(on, oneCallWorld(async () => void drawn.push(await drawPane($, INLINE_PANE))), log)
    await $.command.run(DRY_RUN)
    expect(drawn).toEqual([{ first: MODEL_PROGRESS.skills, rows: 2 }])
  })

  test('the own-skills entry draws its rows by their roles, the recommended roles bold (D-313)', async ($, on) => {
    const log = newLog()
    const drawn: PaneSpan[][][] = []
    const commands = [{ name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' }]
    const answers = { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }
    const onAsk = async (): Promise<void> => {
      if (drawn.length > 0 || !(log.asks.at(-1) ?? '').startsWith(`ask ${OWN_SKILLS_ENTRY_PREFIX}`)) return
      drawn.push(await paneLooks($, INLINE_PANE))
    }
    fakeHost(on, initWorld({ commands, answers, replies: ['{"skills":{"S1":["pm"]},"groups":{}}'], onAsk }), log)
    await $.command.run(DRY_RUN)
    const rows = drawn[0] ?? []
    expect(rows.slice(0, 2)).toEqual([
      [{ text: PANE_TITLES.skills, color: 'claude', bold: true }],
      [{ text: '1 skill, 1 recommended', dim: true }],
    ])
    // The skill is one item, `name → roles`, its description under it (D-311).
    expect(rows.slice(-2)).toEqual([
      [{ text: '  deploy-notes → ' }, { text: 'pm', bold: true }],
      [{ text: '    Write the release notes for a deploy.' }],
    ])
    // The heading rows are bold by their role; no row of the context is styled from its text (D-313).
    expect(rows.slice(2, -2).every(row => row.length === 1 && row[0]?.bold === true)).toBe(true)
  })

  test('the pane drawn at the next question shows its own context, with no loader row (D-257)', async ($, on) => {
    const log = newLog()
    const open: Open[] = []
    const onAsk = drawWhileOpen($, log, INLINE_PANE, open, OWN_SKILLS_ENTRY_PREFIX)
    fakeHost(on, { ...oneCallWorld(), onAsk }, log)
    await $.command.run(DRY_RUN)
    expect(open.map(entry => entry.drawn.first)).toEqual([PANE_TITLES.skills])
  })

  test('a run clears the loader when it ends, so the pane then draws the empty frame (D-257, D-304)', async ($, on) => {
    const log = newLog()
    fakeHost(on, oneCallWorld(), log)
    await $.command.run(DRY_RUN)
    const loaders = log.paneStates.map(loaderOf)
    // The scan's loader is written twice: with its summary, then with the line the run logs while it runs (D-325).
    const scans = log.paneStates.filter(state => loaderOf(state) === SCAN_PROGRESS).map(loaderSummaryOf)
    expect([loaders.filter(label => label !== null), scans]).toEqual([
      [SCAN_PROGRESS, SCAN_PROGRESS, MODEL_PROGRESS.skills],
      [SCAN_SUMMARY, NO_HISTORY_NOTE],
    ])
    expect(loaders.at(-1)).toBe(null)
    expect(await drawPane($, INLINE_PANE)).toEqual(EMPTY_DRAWN)
  })

  test('a note while a step runs is its loader summary line, not a transcript line (D-325)', async ($, on) => {
    const log = newLog()
    fakeHost(on, notedWorld(), log)
    await $.command.run(DRY_RUN)
    const loader = { label: MODEL_PROGRESS['describe-roles'], summary: DESCRIBED_FALLBACK_NOTE }
    const noted = log.paneStates.filter(state => loaderSummaryOf(state) === DESCRIBED_FALLBACK_NOTE)
    expect([noted, log.logs.includes(DESCRIBED_FALLBACK_NOTE)]).toEqual([[{ open: null, loader }], false])
    // Never a block: no question's context holds the note (D-302, D-325).
    expect(JSON.stringify(log.paneStates.map(openOf))).not.toContain(DESCRIBED_FALLBACK_NOTE)
  })

  test('a note with no step running is one transcript line, and never in the pane (D-325)', async ($, on) => {
    const log = newLog()
    fakeHost(on, notedWorld(), log)
    await $.command.run(DRY_RUN)
    expect(log.logs.filter(line => line === ATTENDED_NOTE)).toEqual([ATTENDED_NOTE])
    expect(JSON.stringify(log.paneStates)).not.toContain(ATTENDED_NOTE)
  })

  test('the pane wraps each row of the open context to its body columns, cutting none (D-231)', async ($, on) => {
    const log = newLog()
    const drawn: string[][][] = []
    fakeHost(on, initWorld({ onAsk: drawAtReview($, log, { ...INLINE_PANE, bodyColumns: 40 }, drawn) }), log)
    await $.command.run(DRY_RUN)
    const texts = drawn[0] ?? []
    const context = openedContext(log, REVIEW_QUESTION) ?? { title: '', lines: [] }
    expect(texts.every(row => Array.from(row.join('')).length <= 40)).toBe(true)
    expect(texts.length).toBe(paneRows([context], 40).length)
    expect(texts.length).toBeGreaterThan(1 + context.lines.length)
  })

  test('golden: the pane rows drawn inline at the Review question, each row its span texts (D-219)', async ($, on) => {
    const log = newLog()
    const drawn: string[][][] = []
    fakeHost(on, initWorld({ onAsk: drawAtReview($, log, INLINE_PANE, drawn) }), log)
    await $.command.run(DRY_RUN)
    expect(drawn[0]).toEqual(GOLDEN_PANE_ROWS.inline)
  })

  test('golden: the pane rows drawn docked at the Review question, each row its span texts (D-219)', async ($, on) => {
    const log = newLog()
    const drawn: string[][][] = []
    fakeHost(on, initWorld({ onAsk: drawAtReview($, log, DOCK_PANE, drawn) }), log)
    await $.command.run(DRY_RUN)
    expect(drawn[0]).toEqual(GOLDEN_PANE_ROWS.dock)
  })
})

/**
 * What the TUI default asked in the init dry run of skillWorld (TUI_RUN), as the fake host saw each dialog, at the base
 * of plan 02.2-02, pasted as printed: D-255 and D-283 change only what a pane surface asks, so the TUI default goes on
 * asking exactly these texts (checker warning 5). The one edit since: 02.2-03 asks a hunk by its key line alone, its
 * before, after and why moving into its context (D-287, D-300).
 */
const TUI_ASKS_AT_BASE: readonly string[] = [
  'ask Read ~/.claude.json for MCP server names? Only server names are kept; account data is never ' +
    'read into the plan.\nWithout it, init still finds MCP servers in .mcp.json, your plugins and this ' +
    'session.',
  'ask Use these roles?\nProposed: PM (pm), Team Lead (tl), Security (security); 3 changes from the ' +
    'scan.',
  'ask Which framework do the roles use? (asked because more than one framework is in use)\nRoles: ' +
    'pm, tl, security.',
  'ask Framework for all roles?\nRoles: pm, tl, security.\nOr press n, type your own answer, then ' +
    'Enter.',
  'ask Install from claude-plugins-official after you confirm the plan: claude-security and ' +
    'security-guidance? claude-security gives the Security role a review skill (/claude-security), ' +
    'needs Python 3.9 or newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo. ' +
    'security-guidance adds hooks that warn about risky edits.\nNothing is installed before you ' +
    'confirm the final review, and a --dry-run installs nothing.',
  'ask Autopilot duration for roles?\nApplies to every role: pm, tl, security.\nOr press n, type ' +
    'your own answer, then Enter.',
  'ask Model and effort: same for all roles, or per role?\nRoles: pm, tl, security.',
  'ask Model and effort for all roles?\nModels: opus, sonnet, haiku, fable; efforts: low, medium, ' +
    'high, xhigh, max.\nOr press n, type your own answer, then Enter.',
  'ask How do you want to hand out your own skills (1)?\n1 skill with no plugin; the pane shows what ' +
    'each does and the roles it is recommended for.',
  'ask Which roles get your own skills (1)? (e.g. BE, QA, or none)\nRoles: pm, tl, security. A role ' +
    'given these skills can run them in its session; a role not given them cannot.\nOr press n, type ' +
    'your own answer, then Enter.',
  'ask .planning/config.json: mode',
  'ask .planning/config.json: workflow.text_mode',
  'ask Git policy for .cadre/?\nCommit definitions: .cadre/ is committed except .cadre/*/.runtime/. ' +
    'Commit all: only per-user files are ignored. Ignore all: nothing in .cadre/ is committed.',
  'ask Where should the role launchers start their sessions? (asked once for this repo)\nThe ' +
    'launcher of each role (pm, tl, security) starts its session there.',
  'ask Review the plan shown in the cadre init pane. Confirm it, or go back to change one ' +
    'item.\nSummary: 25 create, 0 change, 0 leave, 0 conflict, 2 hunks (2 accepted); Git policy: ' +
    'commit definitions (.cadre/*/.runtime/ ignored); Launchers start in: the git root\nUse a button, ' +
    'or type duration, model, assignments, memory, env or hunks as a note (press n).',
]

describe('the TUI default: the terminal main screen draws no side pane (D-208)', () => {
  /** `init --dry-run` typed on the terminal main screen, as the engine stamps it: the TUI default (D-208). */
  const TUI_RUN: Parameters<Engine['command']['run']>[0] = {
    command: 'cadre',
    args: 'init --dry-run',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  }

  /**
   * initWorld with one skill of the user's own, so init asks the model for its roles (G-02-1b); the model gives no
   * text, so the entry offers no Accept (D-279) and the skills go to the whole-group question.
   */
  function skillWorld(): World {
    const commands = [{ name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' }]

    return initWorld({ commands, answers: { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' } })
  }

  test('init --dry-run opens no pane and writes no loader, while the model works too (D-208)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    const out = await $.command.run(TUI_RUN)
    expect(askHeads(log).some(ask => ask.startsWith(`ask ${OWN_SKILLS_ENTRY_PREFIX}`))).toBe(true)
    const loaders = log.paneStates.map(loaderOf).filter(label => label !== null)
    expect([log.panes, loaders, log.closes]).toEqual([[], [], []])
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  test('the TUI default replies with the same text as a run that draws the pane (D-208)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    const pane = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const tui = await $.command.run(TUI_RUN)
    expect(tui.text).toBe(pane.text)
  })

  test('a TUI run cancelled at Roles shows the reason only in the reply text (D-265)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Use these roles?') }), log)
    const out = await $.command.run(TUI_RUN)
    expect(out.text).toBe(cancelledReply(ROLES_DISMISSED_REASON))
    expect(askHeads(log).at(-1)).toBe(`ask ${ROLES_QUESTION}`)
    expect(log.logs.filter(text => text.includes(ROLES_DISMISSED_REASON))).toEqual([])
  })

  test('the TUI default previews the consent and a hunk dialog, with no Describe your own (D-266)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    await $.command.run(TUI_RUN)
    const ats = [CLAUDE_JSON_QUESTION, '.planning/config.json: mode'].map(head => askHeads(log).indexOf(`ask ${head}`))
    const isPreviewed = (at: number): boolean => {
      const previews = log.askPreviews[at] ?? []

      return previews.length > 0 && previews.every(preview => typeof preview === 'string' && preview !== '')
    }
    const typed = (at: number): boolean => (log.askOptions[at] ?? []).includes('Describe your own')
    expect(ats.map(at => [at >= 0, isPreviewed(at), typed(at)])).toEqual([
      [true, true, false],
      [true, true, false],
    ])
  })

  test('the Launch folder dialog offers Type a folder and Cancel init; a note is the folder (D-268)', async ($, on) => {
    const log = newLog()
    const dir = 'Type the folder the launchers start in'
    const start = { 'Where should the role launchers start': 'Another folder in this repo', [dir]: 'Type a folder' }
    const base = initWorld({ answers: { ...INIT_ANSWERS, ...start }, notes: { [dir]: 'packages/api' } })
    fakeHost(on, { ...base, realPaths: { ...base.realPaths, '/repo/packages/api': '/repo/packages/api' } }, log)
    const out = await $.command.run(TUI_RUN)
    const at = askHeads(log).findIndex(ask => ask.startsWith(`ask ${dir}`))
    expect([at >= 0, log.askOptions[at]]).toEqual([true, ['Type a folder', 'Cancel init']])
    expect(out.text.split('\n')).toContain('Launchers start in: packages/api/ under the git root')
  })

  test('a stray note leaves the consent as chosen; a label typed as a Review note picks it (D-270)', async ($, on) => {
    const log = newLog()
    const answers = { ...INIT_ANSWERS, 'Review the plan': 'Change something…' }
    fakeHost(on, initWorld({ answers, notes: { 'Read ~/.claude.json': 'sure', 'Review the plan': ' confirm ' } }), log)
    const out = await $.command.run(TUI_RUN)
    expect(askHeads(log).filter(ask => ask === `ask ${CLAUDE_JSON_QUESTION}`)).toHaveLength(1)
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  test('with no presentation, or in fullscreen, the terminal opens the pane as before (D-208)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    await $.command.run({ ...TUI_RUN, presentation: { isFullscreen: true, columns: 120 } })
    expect(log.panes).toEqual(['ui.open cadre-init cadre init', 'ui.open cadre-init cadre init'])
  })

  test('on the TUI default neither init nor regen opens the pane (D-324, D-208)', async ($, on) => {
    const log = newLog()
    fakeHost(on, regenHostWorld(), log)
    await $.command.run(TUI_RUN)
    await $.command.run({ ...TUI_RUN, args: 'regen be --dry-run' })
    expect([log.panes, log.closes]).toEqual([[], []])
  })

  test('a session drawn on the desktop too opens the pane, even on the main screen (D-208)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ surfaces: ['terminal', 'desktop'] }), log)
    await $.command.run(TUI_RUN)
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
  })

  test('each scan and model call sets one status line, cleared as the next question opens (D-232)', async ($, on) => {
    const log = newLog()
    const atAsk: unknown[] = []
    fakeHost(on, { ...skillWorld(), onAsk: async () => void atAsk.push(log.statuses.at(-1) ?? null) }, log)
    await $.command.run(TUI_RUN)
    const set = log.statuses.filter((text, at) => text !== null && log.statuses[at - 1] !== text)
    expect(set).toEqual([SCAN_PROGRESS, MODEL_PROGRESS.skills])
    expect([atAsk.length > 0, atAsk.every(text => text === null)]).toEqual([true, true])
  })

  test('on a pane surface progress sets no status line (D-232)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.statuses).toEqual([])
  })

  test('on the TUI default no loader text is written: a long step sets the status line (D-257)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    await $.command.run(TUI_RUN)
    expect(log.paneStates.map(loaderOf).filter(label => label !== null)).toEqual([])
    expect(log.statuses.includes(MODEL_PROGRESS.skills)).toBe(true)
  })

  test('the TUI default logs every note as before, a step running or not (D-325)', async ($, on) => {
    const log = newLog()
    fakeHost(on, notedWorld(), log)
    await $.command.run(TUI_RUN)
    const notes = [DESCRIBED_FALLBACK_NOTE, ATTENDED_NOTE]
    expect(log.logs.filter(line => notes.includes(line))).toEqual(notes)
  })

  test('a run with no progress makes no status call, not even a clear when it ends (edge #2, U-11)', async ($, on) => {
    const log = newLog()
    fakeHost(on, regenHostWorld(), log)
    // A regen of a role cadre.json does not list is refused before its scan, so it sets no loader (D-285, S-02).
    await $.command.run({ ...TUI_RUN, args: 'regen zz --dry-run' })
    await $.command.run({ ...TUI_RUN, args: '' })
    expect(log.statuses).toEqual([])
  })

  /**
   * initWorld with 25 skills of the user's own, the third one's description holding a control character built at run
   * time, so the own-skills question's context is longer than the preview (D-228); `onAsk` runs at each dialog.
   */
  function manySkillsWorld(onAsk?: () => Promise<void>): World {
    const commands = Array.from({ length: 25 }, (_, at) => ({
      name: `skill-${at + 1}`,
      source: 'user',
      description: at === 2 ? `Has ${BIDI_OVERRIDE} a control.` : `Skill ${at + 1}.`,
    }))
    const answers = { ...INIT_ANSWERS, [OWN_SKILLS_ENTRY_PREFIX]: 'Whole group' }

    return initWorld(onAsk === undefined ? { commands, answers } : { commands, answers, onAsk })
  }

  test('a context too long for the preview is printed above its dialog, a row per entry (D-262)', async ($, on) => {
    const log = newLog()
    const seen: { readonly logs: readonly string[]; readonly open: unknown }[] = []
    const atSkills = async (): Promise<void> => {
      if (!(log.asks.at(-1) ?? '').startsWith(`ask ${OWN_SKILLS_ENTRY_PREFIX}`)) return
      seen.push({ logs: [...log.logs], open: openOf(log.paneStates.at(-1)) })
    }
    fakeHost(on, manySkillsWorld(atSkills), log)
    await $.command.run(TUI_RUN)
    const [{ logs, open } = { logs: [], open: null }] = seen
    const context = isObject(open) && isObject(open.context) ? open.context : {}
    const rows = [context.title, ...(Array.isArray(context.lines) ? context.lines : [])]
    expect([rows[0], rows.length > PREVIEW_ROWS + 1]).toEqual(['Your own skills', true])
    // Each row is a transcript entry of its own, the title first, right above the dialog: the terminal stores a newline
    // inside an entry as U+FFFD, so rows are never joined (D-262, user 2026-11-04).
    expect(logs.slice(-rows.length)).toEqual(rows)
    expect(log.logs.some(line => line.includes(BIDI_OVERRIDE))).toBe(false)
    const [preview] = log.askPreviews[log.asks.findIndex(ask => ask.startsWith(`ask ${OWN_SKILLS_ENTRY_PREFIX}`))] ?? []
    const marker = typeof preview === 'string' ? preview.split('\n').at(-2) : null
    // At the preview's 82 columns the heading line wraps to two rows and every other line is one; the title and marker
    // rows count too, so 18 whole lines fit its 21 rows (D-260).
    expect([wrapLine(String(rows[1]), 82).length, rows.slice(2).every(line => String(line).length <= 82)]).toEqual([
      2,
      true,
    ])
    expect(marker).toBe(`+${rows.length - 1 - (PREVIEW_LINE_ROWS - 3)} more above`)
  })

  test('a refused answer is asked again and its long context is printed above it once (WD-S4)', async ($, on) => {
    const log = newLog()
    const answers = {
      ...INIT_ANSWERS,
      [OWN_SKILLS_ENTRY_PREFIX]: 'Nonsense',
      "'Nonsense' isn't one of": 'Whole group',
    }
    fakeHost(on, { ...manySkillsWorld(), answers }, log)
    await $.command.run(TUI_RUN)
    const asked = log.asks.filter(ask => ask.includes(OWN_SKILLS_ENTRY_PREFIX))
    expect([asked.length, log.logs.filter(line => line === 'Your own skills').length]).toEqual([2, 1])
  })

  test('a pane surface prints no context as transcript rows, however long (D-228)', async ($, on) => {
    const log = newLog()
    fakeHost(on, manySkillsWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.logs.includes('Your own skills')).toBe(false)
  })

  /**
   * The dialog text of the first question starting `prefix` in an init run over initWorld with `answers`, on a pane
   * surface that previews nothing and then on the TUI default (WD-M1); '' where the run never asks it.
   */
  async function typedDialogs(
    $: Engine,
    on: HostOn,
    answers: Readonly<Record<string, string>>,
    prefix: string,
  ): Promise<readonly [string, string]> {
    const log = newLog()
    fakeHost(on, initWorld({ answers }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const pane = log.asks.find(ask => ask.startsWith(`ask ${prefix}`)) ?? ''
    const at = log.asks.length
    await $.command.run(TUI_RUN)
    const tui = log.asks.slice(at).find(ask => ask.startsWith(`ask ${prefix}`)) ?? ''

    return [pane, tui]
  }

  test('the Adjust dialog says where to type, as a note on the TUI default (WD-M1)', async ($, on) => {
    const answers = { ...INIT_ANSWERS, [ROLES_QUESTION]: 'Adjust them' }
    const [pane, tui] = await typedDialogs($, on, answers, 'Adjust the roles')
    const wording = [pane.includes(OTHER_WORDING), tui.includes(NOTE_WORDING), tui.includes(OTHER_WORDING)]
    expect([pane !== '', tui !== '', ...wording]).toEqual([true, true, true, true, false])
  })

  test('the Describe dialog says where to type, as a note on the TUI default (WD-M1)', async ($, on) => {
    const answers = { ...INIT_ANSWERS, [ROLES_QUESTION]: 'Describe my own structure' }
    const [pane, tui] = await typedDialogs($, on, answers, 'Describe your role structure')
    const wording = [pane.includes(OTHER_WORDING), tui.includes(NOTE_WORDING), tui.includes(OTHER_WORDING)]
    expect([pane !== '', tui !== '', ...wording]).toEqual([true, true, true, true, false])
  })

  test('the launcher folder dialog says where to type, as a note on the TUI default (WD-M1)', async ($, on) => {
    const answers = { ...INIT_ANSWERS, 'Where should the role launchers start': 'Another folder in this repo' }
    const [pane, tui] = await typedDialogs($, on, answers, 'Type the folder the launchers start in')
    const wording = [pane.includes(OTHER_WORDING), tui.includes(NOTE_WORDING), tui.includes(OTHER_WORDING)]
    expect([pane !== '', tui !== '', ...wording]).toEqual([true, true, true, true, false])
  })

  test('golden: the TUI-default init dry run: panes, statuses, logs, asks, reply (D-208, D-219)', async ($, on) => {
    const log = newLog()
    const headers: unknown[] = []
    fakeHost(on, { ...skillWorld(), onAsk: async () => void headers.push(headerOf(log.paneStates.at(-1))) }, log)
    const out = await $.command.run(TUI_RUN)
    const asks = log.askOptions.map((options, at) => ({
      header: headers[at] ?? null,
      options,
      previews: (log.askPreviews[at] ?? []).map(preview => (typeof preview === 'string' ? preview : null)),
    }))
    const golden = { opens: log.panes, statuses: log.statuses, logs: log.logs, asks, reply: out.text.split('\n') }
    expect(golden).toEqual(GOLDEN_TUI)
  })

  test('the TUI default asks exactly the texts it asked at the plan base (D-255, D-283)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    await $.command.run(TUI_RUN)
    expect(log.asks).toEqual(TUI_ASKS_AT_BASE)
  })

  test('in fullscreen a question with a context asks its sentence, then its summary (D-310)', async ($, on) => {
    const log = newLog()
    fakeHost(on, skillWorld(), log)
    await $.command.run({ ...TUI_RUN, presentation: { isFullscreen: true, columns: 120 } })
    const opened = log.paneStates.map(openOf).filter(isObject)
    const contextual = opened.filter(open => isObject(open.context))
    // Its sentence, its context's summary on the next line, and on a paged Review page the page's title last.
    const unsummarised = contextual.flatMap(open => {
      const context = isObject(open.context) ? open.context : {}
      const [sentence, line, ...rest] = String(open.question).split('\n')
      const isPaged = context.kind === 'review' && rest.length === 1 && rest[0] === context.title
      const hasSummary = typeof context.summary === 'string' && context.summary !== '' && line === context.summary

      return hasSummary && (rest.length === 0 || isPaged) ? [] : [sentence]
    })
    expect([contextual.length > 10, unsummarised]).toEqual([true, []])
    // The dialog asks the open question's text itself, so the dialog hook pairs the two (dialogPlan). A write that
    // missed its version is tried again (update), so a question written twice in a row was asked once: the line logged
    // on the scan's loader (D-325) moves the version under the roles question's first write.
    const asked = opened.map(open => `ask ${String(open.question)}`)
    expect(asked.filter((text, at) => text !== asked[at - 1])).toEqual(log.asks)
  })
})

describe('cadre regen with a faked host', () => {
  test('regen be --dry-run replies with the plan of BE and asks nothing (B3, D-68)', async ($, on) => {
    const log = newLog()
    fakeHost(on, regenHostWorld(), log)
    const reply = (await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })).text
    const lines = reply.split('\n')
    expect([lines[0], lines.at(-1)]).toEqual(['cadre regen be --dry-run', 'Dry run: nothing was written.'])
    expect(reply).not.toBe(NOT_INTERACTIVE_REPLY)
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('regen on a pane surface opens the pane as it starts, and ends idle, the pane closed (D-324)', async ($, on) => {
    const log = newLog()
    fakeHost(on, regenHostWorld(), log)
    await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })
    const opened = ['ui.open cadre-init cadre init']
    expect([log.panes, log.closes, log.paneStates.at(-1)]).toEqual([opened, ['ui.close cadre-init'], IDLE_STATE])
  })

  test('in claude -p, or on a host that cannot say who is there, regen replies the same (B3, D-99)', async ($, on) => {
    const log = newLog()
    let surfaces: readonly string[] = ['terminal']
    let denySurfaces = false
    // The fake host reads both at each call, so one host answers as a terminal, as claude -p, then not at all.
    const world: World = {
      ...regenHostWorld(),
      get surfaces() {
        return surfaces
      },
      get denySurfaces() {
        return denySurfaces
      },
    }
    fakeHost(on, world, log)
    const regen = async (): Promise<string> =>
      (await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })).text
    const terminal = await regen()
    surfaces = []
    const print = await regen()
    denySurfaces = true
    const unknown = await regen()
    expect(terminal.split('\n')[0]).toBe('cadre regen be --dry-run')
    expect([print, unknown]).toEqual([terminal, terminal])
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })
})

describe('cadre start with a faked host', () => {
  test('start be renders .runtime with the stamp last, then prints the launcher command (D-102)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await startHostWorld(), log)
    const lines = (await $.command.run({ command: 'cadre', args: 'start be' })).text.split('\n')
    const written = ['settings.json', 'mcp.json', 'probe-expectations.json', 'inbox.md', 'stamp']
    expect(log.writes).toEqual(written.map(name => `${START_RUNTIME}/${name}`))
    expect(log.ops.filter(op => op.startsWith('fs.write ')).at(-1)).toBe(`fs.write ${START_RUNTIME}/stamp`)
    // The n-th process.run op is the n-th run, so the mkdir of .runtime is found among the ops by its run index.
    const mkdirAt = log.runs.findIndex(run => run.join(' ') === `/bin/mkdir -p -- ${START_RUNTIME}`)
    const runOps = log.ops.flatMap((op, at) => (op === 'process.run' ? [at] : []))
    const mkdirOp = runOps[mkdirAt] ?? -1
    expect(mkdirOp).toBeGreaterThanOrEqual(0)
    expect(log.ops.findIndex(op => op.startsWith('fs.write '))).toBeGreaterThan(mkdirOp)
    expect(lines.slice(0, 2)).toEqual(['cadre start be', 'Rendered .cadre/be/.runtime/ (1 link).'])
    const runAt = lines.indexOf('Run this in a terminal to start role be:')
    expect(runAt).toBeGreaterThan(1)
    expect(lines[runAt + 1]).toBe('  /repo/.cadre/bin/be')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('start be copies the printed command with pbcopy once the stamp is written (D-110)', async ($, on) => {
    const log = newLog()
    const world = await startHostWorld()
    const runResults = { ...world.runResults, '/usr/bin/pbcopy': { exitCode: 0, stdout: '' } }
    fakeHost(on, { ...world, runResults }, log)
    const lines = (await $.command.run({ command: 'cadre', args: 'start be' })).text.split('\n')
    const stampOp = log.ops.indexOf(`fs.write ${START_RUNTIME}/stamp`)
    // The n-th process.run op is the n-th run, so the pbcopy run is found among the ops by its run index.
    const copyAt = log.runs.findIndex(run => run.join(' ') === '/usr/bin/pbcopy')
    const runOps = log.ops.flatMap((op, at) => (op === 'process.run' ? [at] : []))
    expect(stampOp).toBeGreaterThanOrEqual(0)
    expect(runOps[copyAt] ?? -1).toBeGreaterThan(stampOp)
    expect(lines.slice(-2)).toEqual(['  /repo/.cadre/bin/be', 'Copied to the clipboard.'])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('start be --terminal=terminal on macOS copies with pbcopy, then opens Terminal (D-109)', async ($, on) => {
    const log = newLog()
    const world = await startHostWorld()
    const runResults = {
      ...world.runResults,
      '/usr/bin/pbcopy': { exitCode: 0, stdout: '' },
      '/usr/bin/uname -s': { exitCode: 0, stdout: 'Darwin\n' },
    }
    fakeHost(on, { ...world, runResults }, log)
    const out = await $.command.run({ command: 'cadre', args: 'start be --terminal=terminal' })
    expect(log.runs.map(run => run[0]).slice(-3)).toEqual(['/usr/bin/pbcopy', '/usr/bin/uname', '/usr/bin/osascript'])
    expect(log.runs.at(-1)?.at(-1)).toBe('cd -- /repo && /repo/.cadre/bin/be')
    // osascript has no scripted answer here, so the host refuses it: the reply says so, below the copied command.
    expect(out.text.split('\n').slice(-3)).toEqual([
      '  /repo/.cadre/bin/be',
      'Copied to the clipboard.',
      'Could not open a new Terminal window: run the command above yourself.',
    ])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('a cadre.json that does not list the role refuses with the no-role reply and writes nothing', async ($, on) => {
    const log = newLog()
    const world = await startHostWorld()
    fakeHost(on, { ...world, files: { ...world.files, '/repo/.cadre/cadre.json': startStateText(['pm']) } }, log)
    const out = await $.command.run({ command: 'cadre', args: 'start be' })
    expect(out.text).toBe(regenNoRole('be', ['pm']))
    expect(log.writes).toEqual([])
    expect(log.ops.filter(op => op.startsWith('fs.write ') || op.startsWith('forbidden '))).toEqual([])
  })
})

/** The first lines of statusHostWorld's `/cadre status be` reply: done, read from autopilot's log (D-111). */
const STATUS_DONE_LINES: readonly string[] = [
  'cadre status be',
  'state: done',
  'session: s9 (found by its name cadre-be)',
  'autopilot: finished (done): handed back to the person',
  'latest handoff: none yet',
]

describe('cadre status with a faked host', () => {
  test('status be finds the session by its name and reports done from the autopilot log (D-111)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await statusHostWorld(), log)
    const lines = (await $.command.run({ command: 'cadre', args: 'status be' })).text.split('\n')
    expect(lines.slice(0, STATUS_DONE_LINES.length)).toEqual(STATUS_DONE_LINES)
    expect(log.runs).toEqual([CHECKOUT_ARGV('/repo'), STATUS_GREP])
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('fs.write ') || op.startsWith('forbidden '))).toEqual([])
  })

  test('in claude -p, status be gives the same report and asks nothing (D-111)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await statusHostWorld({ surfaces: [] }), log)
    const lines = (await $.command.run({ command: 'cadre', args: 'status be' })).text.split('\n')
    expect(lines.slice(0, STATUS_DONE_LINES.length)).toEqual(STATUS_DONE_LINES)
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('fs.write ') || op.startsWith('forbidden '))).toEqual([])
  })
})

/**
 * The repo of initWorld with GSD alone: `.planning/` is in use, the user-level GSD has a proven identity, and there is
 * no superpowers folder and no superpowers plugin. Pass `over` to change one part of it.
 */
function gsdOnlyWorld(over: Partial<World> = {}): World {
  const base = initWorld()

  return {
    ...base,
    listings: { '/repo': [entry('.planning', 'dir')] },
    files: { ...base.files, '/home/u/.claude/plugins/installed_plugins.json': '{"plugins":{}}' },
    settings: { user: {}, project: {}, local: {} },
    ...over,
  }
}

/**
 * The repo of initWorld with superpowers alone: `docs/superpowers/` is in use, the plugin is enabled, and there is no
 * `.planning/` and no GSD install. Pass `over` to change one part of it.
 */
function superpowersOnlyWorld(over: Partial<World> = {}): World {
  const base = initWorld()

  return {
    ...base,
    listings: { '/repo': [entry('docs', 'dir')], '/repo/docs': [entry('superpowers', 'dir')] },
    files: {
      '/home/u/.claude/plugins/installed_plugins.json':
        '{"plugins":{"superpowers@claude-plugins-official":[{"scope":"user","version":"6.4.1"}]}}',
    },
    dirs: ['/repo/.git'],
    ...over,
  }
}

/** The repo of initWorld with no framework marker and nothing installed. Pass `over` to change one part of it. */
function noFrameworkWorld(over: Partial<World> = {}): World {
  const base = initWorld()

  return {
    ...base,
    listings: { '/repo': [entry('README.md')] },
    files: {},
    dirs: ['/repo/.git'],
    settings: { user: {}, project: {}, local: {} },
    ...over,
  }
}

/**
 * What only one framework world shows in its `init --dry-run`, so a fixture that drifts into another world fails (B2):
 * how many `.planning/config.json` hunk rows its plan holds, how often the framework question is asked, and a text its
 * scope cards log that names the chosen adapter, or null when no card text is checked.
 */
type WorldExpect = {
  readonly hunks: number
  readonly frameworkAsks: number
  readonly card: string | null
}

/** The four framework worlds of the matrix, each with the name its tests carry and what only that world shows. */
const FRAMEWORK_WORLDS: readonly (readonly [string, () => World, WorldExpect])[] = [
  ['GSD only', gsdOnlyWorld, { hunks: 2, frameworkAsks: 0, card: null }],
  ['superpowers only', superpowersOnlyWorld, { hunks: 0, frameworkAsks: 0, card: 'framework: superpowers;' }],
  ['ambiguous', initWorld, { hunks: 2, frameworkAsks: 1, card: null }],
  ['no framework', noFrameworkWorld, { hunks: 0, frameworkAsks: 0, card: 'framework: built-in;' }],
]

/**
 * The repo of initWorld after an init of BE and PM on the built-in default: the `.cadre/` folder with its cadre.json,
 * the role.json of both roles and a manifest that lists those three files with the hash of their text, so a regen of BE
 * has PM's entry to keep. The folders a scan lists are listed (the repo root with `.cadre`, `.cadre/` itself and
 * `docs/superpowers/`), so regen runs on a complete scan that warns about nothing (B3). Pass `over` to change one part
 * of it.
 */
async function regenMatrixWorld(over: Partial<World> = {}): Promise<World> {
  const base = initWorld()
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ['be', 'pm'],
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  })
  const texts: Readonly<Record<string, string>> = {
    '.cadre/be/role.json': roleJsonText(templateRole('be')),
    '.cadre/cadre.json': state,
    '.cadre/pm/role.json': roleJsonText(templateRole('pm')),
  }
  const entries = await Promise.all(
    Object.entries(texts).map(async ([path, text]) => ({ path, sha256: await sha256Hex(text), mode: 'file' })),
  )
  const onDisk = Object.entries(texts).map(([path, text]) => [`/repo/${path}`, text])

  return {
    ...base,
    listings: {
      ...base.listings,
      '/repo': [...base.listings['/repo'], entry('.cadre', 'dir')],
      '/repo/.cadre': [entry('be', 'dir'), entry('pm', 'dir'), entry('cadre.json'), entry('manifest.json')],
      '/repo/docs/superpowers': [],
    },
    dirs: [...base.dirs, '/repo/.cadre'],
    files: {
      ...base.files,
      ...Object.fromEntries(onDisk),
      '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: entries }),
    },
    ...over,
  }
}

/** A fresh autopilot status file for session s1 at the clock of the fake host: a run is on, in the running phase. */
const AUTOPILOT_RUNNING = '{"isOn":true,"phase":"running","beat":1000000}'

/** This repo's session folder for the fixture user /home/u: `projects/` and the mangled repo path /repo. */
const HISTORY_DIR = '/home/u/.claude/projects/-repo'

/** The history question for the two transcripts of historyHostWorld (SCAN-03, D-59). */
const HISTORY_QUESTION =
  "Scan this repo's session history (2 sessions) for frequently used commands and skills? " +
  'Only names and counts are kept.'

/** A session transcript that runs /gsd-plan-phase and holds SENTINEL_SECRET_VALUE outside every marker. */
const SENTINEL_TRANSCRIPT = [
  '{"type":"user","message":{"role":"user","content":"<command-name>/gsd-plan-phase</command-name>"}}',
  '{"type":"user","message":{"content":"the token is SENTINEL_SECRET_VALUE"}}',
].join('\n')

/**
 * The repo of initWorld with this repo's session folder: two `.jsonl` transcripts, a.jsonl the newer, each holding
 * SENTINEL_TRANSCRIPT. Pass `over` to change one part of it.
 */
function historyHostWorld(over: Partial<World> = {}): World {
  const base = initWorld()
  const sessions = [
    { ...entry('a.jsonl'), mtimeMs: 2 },
    { ...entry('b.jsonl'), mtimeMs: 1 },
  ]
  const paths = sessions.map(session => `${HISTORY_DIR}/${session.name}`)
  const transcripts = Object.fromEntries(paths.map(path => [path, SENTINEL_TRANSCRIPT]))

  return {
    ...base,
    listings: { ...base.listings, [HISTORY_DIR]: sessions },
    files: { ...base.files, ...transcripts },
    ...over,
  }
}

/** The lines of a reply between its first line and its last: the plan part of a --dry-run reply. */
function middleLines(reply: string): string[] {
  return reply.split('\n').slice(1, -1)
}

/** One op row of the file plan in a reply: the op kind (create, change, leave, conflict or hunk) and its path. */
type PlanRow = {
  readonly kind: string
  readonly path: string
}

/** The kind and the path of every op row in the file plan of a reply: two spaces, the op kind, then the path. */
function planRows(reply: string): PlanRow[] {
  return reply.split('\n').flatMap(line => {
    const [, kind, path] = /^ {2}(create|change|leave|conflict|hunk) +(\S+)/.exec(line) ?? []
    if (kind === undefined || path === undefined) return []

    return [{ kind, path }]
  })
}

/** Whether a plan row names a path a plan may touch (PLAN-06): in `.cadre/`, the root `.gitignore` or a GSD hunk. */
function isAllowedRow(row: PlanRow): boolean {
  if (row.path.startsWith('.cadre/')) return true
  if (row.path === '.gitignore') return true

  return row.kind === 'hunk' && row.path === '.planning/config.json'
}

describe('Phase 2 faked-host matrix', () => {
  for (const [name, build, expected] of FRAMEWORK_WORLDS) {
    test(`${name}: init and init --dry-run print one plan; only plain init writes`, async ($, on) => {
      const log = newLog()
      fakeHost(on, { ...build(), isWriteAllowed: true }, log)
      const plain = (await $.command.run({ command: 'cadre', args: 'init' })).text
      const dry = (await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text
      expect(plain).toContain('File plan:')
      expect(dry).toContain('File plan:')
      expect(plain.split('\n').at(-1)).toBe(NEXT_STEP_NOTE)
      expect(dry.split('\n').at(-1)).toBe('Dry run: nothing was written.')
      const plainLines = plain.split('\n')
      const appliedAt = plainLines.findIndex(line => line.startsWith('Applied: '))
      const dryLines = dry.split('\n')
      // A --dry-run reply also names the private files Confirm writes, right before its note (02-GAPS-B3 S4).
      const confirmAt = dryLines.indexOf(PRIVATE_FILES_HEADING)
      expect([appliedAt > 0, confirmAt > 0]).toEqual([true, true])
      expect(dryLines.slice(1, confirmAt)).toEqual(plainLines.slice(1, appliedAt))
      expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
      // Every hunk the plan shows is accepted and runnable in these worlds, so plain init runs each one (D-120), then
      // the git run that names the role memory folders (02-GAPS-B3 C1).
      const runs = [...GSD_HUNK_RUNS.slice(0, expected.hunks), GIT_COMMON_DIR_ARGV]
      expect(log.runs.filter(run => run[0] !== '/bin/chmod')).toEqual(runs)
      expect(log.cwds.filter((_, at) => log.runs[at]?.[0] !== '/bin/chmod')).toEqual(runs.map(() => '/repo'))
    })

    test(`${name}: every path of the init plan is allowed: .cadre/, .gitignore, GSD hunk (PLAN-06)`, async ($, on) => {
      fakeHost(on, build(), newLog())
      const rows = planRows((await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text)
      expect(rows.filter(row => !isAllowedRow(row))).toEqual([])
      expect(rows.some(row => row.path.startsWith('.cadre/'))).toBe(true)
      expect(rows.some(row => row.path === '.gitignore')).toBe(true)
    })

    test(`${name}: the world is the one it claims: hunks, framework question, card (B2)`, async ($, on) => {
      const log = newLog()
      fakeHost(on, build(), log)
      const dry = (await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text
      const hunks = planRows(dry).filter(row => row.kind === 'hunk' && row.path === '.planning/config.json')
      expect(hunks.length).toBe(expected.hunks)
      const frameworkAsks = log.asks.filter(ask => ask.startsWith(`ask ${FRAMEWORK_QUESTION_PREFIX}`))
      expect(frameworkAsks.length).toBe(expected.frameworkAsks)
      if (expected.card === null) return
      expect((openedContext(log, REVIEW_QUESTION)?.lines ?? []).join('\n')).toContain(expected.card)
    })
  }

  test(
    'GSD only with a runtime-proven install: init --dry-run makes only the one identity call (D-82)',
    async ($, on) => {
      const log = newLog()
      // No .planning/ is in use, so proving GSD changes the framework choice: the check is asked (D-269, edge #36).
      const world = gsdOnlyWorld({
        listings: { '/repo': [] },
        denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
        runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
        answers: { ...INIT_ANSWERS, ...GSD_CHECK_YES },
      })
      fakeHost(on, world, log)
      const dry = (await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text
      expect(log.runs).toEqual([['node', '/home/u/.claude/gsd-core/bin/gsd-tools.cjs', 'runtime-identity', '--raw']])
      expect(log.cwds).toEqual(['/home/u/.claude/gsd-core'])
      expect(dry.split('\n').at(-1)).toBe('Dry run: nothing was written.')
      expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    },
  )

  test('regen be, with and without --dry-run, asks nothing and plans no path of PM (D-68, D-82)', async ($, on) => {
    const log = newLog()
    // `.cadre` resolves inside the repo and the launcher chmod exits 0, so plain regen writes and warns about nothing.
    const world = await regenMatrixWorld({
      isWriteAllowed: true,
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/repo/.cadre': '/repo/.cadre' },
      runResults: { '/bin/chmod 755 /repo/.cadre/bin/be': { exitCode: 0, stdout: '' } },
    })
    fakeHost(on, world, log)
    const plain = (await $.command.run({ command: 'cadre', args: 'regen be' })).text
    const dry = (await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })).text
    for (const reply of [plain, dry]) {
      expect(reply).toContain('File plan:')
      expect(reply.split('\n').some(line => line.includes('.cadre/be/'))).toBe(true)
      expect(reply.split('\n').filter(line => line.includes('.cadre/pm/'))).toEqual([])
      expect(reply.split('\n').filter(line => line.startsWith('warning:'))).toEqual([])
    }
    expect(plain.split('\n').at(-1)).toBe(NEXT_STEP_NOTE)
    expect(dry.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    const plainLines = plain.split('\n')
    const appliedAt = plainLines.findIndex(line => line.startsWith('Applied: '))
    expect(appliedAt).toBeGreaterThan(0)
    expect(middleLines(dry)).toEqual(plainLines.slice(1, appliedAt))
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs.filter(run => run[0] !== '/bin/chmod')).toEqual([])
  })

  test(
    'plain regen refuses each write under a folder whose stat failed, asking exists only after the stat (D3, #44)',
    async ($, on) => {
      const log = newLog()
      // .cadre/be exists but its stat refuses, so apply cannot tell what it is; .cadre/bin does not exist.
      const world = await regenMatrixWorld({
        isWriteAllowed: true,
        realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/repo/.cadre': '/repo/.cadre' },
        runResults: { '/bin/chmod 755 /repo/.cadre/bin/be': { exitCode: 0, stdout: '' } },
        dirs: [...initWorld().dirs, '/repo/.cadre', '/repo/.cadre/be'],
        denyStat: ['/repo/.cadre/be'],
      })
      fakeHost(on, world, log)
      const lines = (await $.command.run({ command: 'cadre', args: 'regen be' })).text.split('\n')
      const statAt = log.ops.lastIndexOf('fs.stat /repo/.cadre/be resolve=true')
      expect(lines).toContain(
        'warning: refused to write .cadre/be/ROLE.md: it or a folder above it could not be checked (a stat failed)',
      )
      expect(lines).toContain(
        'warning: .cadre/manifest.json was not written because a file above was not written: ' +
          'run /cadre regen be again.',
      )
      expect(log.writes.filter(path => path.startsWith('/repo/.cadre/be/'))).toEqual([])
      expect(log.ops).not.toContain('fs.write /repo/.cadre/manifest.json')
      expect(log.ops).toContain('fs.write /repo/.cadre/bin/be')
      expect(statAt).toBeGreaterThanOrEqual(0)
      expect(log.ops[statAt + 1]).toBe('fs.exists /repo/.cadre/be')
      expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    },
  )

  test('every path of the regen plan is allowed: .cadre/, .gitignore, GSD hunk (PLAN-06)', async ($, on) => {
    fakeHost(on, await regenMatrixWorld(), newLog())
    const rows = planRows((await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })).text)
    expect(rows.filter(row => !isAllowedRow(row))).toEqual([])
    expect(rows.some(row => row.path.startsWith('.cadre/be/'))).toBe(true)
  })

  test('regen of a role cadre.json does not list answers the no-role refusal, asking nothing (D-68)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await regenMatrixWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'regen zz' })
    expect(out.text).toBe(regenNoRole('zz', ['be', 'pm']))
    expect(out.text).toBe('no role zz in .cadre/cadre.json (roles: be, pm)')
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('regen in a repo with no cadre.json answers REGEN_NO_STATE and asks nothing (D-68)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'regen be' })
    expect(out.text).toBe(REGEN_NO_STATE)
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('with a running autopilot, init and regen refuse before any listing or settings (SCAN-04)', async ($, on) => {
    const log = newLog()
    const world = await regenMatrixWorld()
    const running = { ...world.files, '/home/u/.claude/autopilot/s1.json': AUTOPILOT_RUNNING }
    fakeHost(on, { ...world, files: running }, log)
    const init = await $.command.run({ command: 'cadre', args: 'init' })
    const regen = await $.command.run({ command: 'cadre', args: 'regen be' })
    expect(init.text).toBe(autopilotReply('active', 'init'))
    expect(regen.text).toBe(autopilotReply('active', 'regen'))
    expect(log.ops.filter(op => op.startsWith('fs.list') || op.startsWith('settings.read'))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('in claude -p regen be --dry-run prints its plan and asks nothing (D-99)', async ($, on) => {
    const log = newLog()
    fakeHost(on, await regenMatrixWorld({ surfaces: [] }), log)
    const out = await $.command.run({ command: 'cadre', args: 'regen be --dry-run' })
    expect(out.text).not.toBe(NOT_INTERACTIVE_REPLY)
    expect(out.text).toContain('File plan:')
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.asks).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('in claude -p init --dry-run still answers the non-interactive refusal, with no op (D-99)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ surfaces: [] }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(NOT_INTERACTIVE_REPLY)
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('history answered No, skip it: no transcript is touched and no process runs (SCAN-03, D-59)', async ($, on) => {
    const log = newLog()
    fakeHost(on, historyHostWorld(), log)
    const dry = (await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text
    expect(dry.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    const at = askHeads(log).indexOf(`ask ${HISTORY_QUESTION}`)
    expect(at).toBeGreaterThanOrEqual(0)
    expect(log.askOptions[at]).toEqual(['No, skip it', 'Yes, scan names and counts'])
    expect(log.ops).toContain(`fs.list ${HISTORY_DIR}`)
    expect(log.ops.filter(op => op.startsWith('fs.read ') && op.endsWith('.jsonl'))).toEqual([])
    expect(log.ops.filter(op => op.endsWith('.jsonl'))).toEqual([])
    expect(log.logs.join('\n')).not.toContain('Session history')
    expect(JSON.stringify(log.paneStates)).not.toContain('Session history')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('history answered Yes: names and counts are read, never transcript text (SCAN-03, T-02-41)', async ($, on) => {
    const log = newLog()
    const answers = { ...INIT_ANSWERS, "Scan this repo's session history": 'Yes, scan names and counts' }
    const world = historyHostWorld({ answers })
    expect(leaks(JSON.stringify(world.files), ['SENTINEL_SECRET_VALUE'])).toEqual(['SENTINEL_SECRET_VALUE'])
    fakeHost(on, world, log)
    const dry = (await $.command.run({ command: 'cadre', args: 'init --dry-run' })).text
    expect(dry.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.ops.filter(op => op.startsWith('fs.read ') && op.endsWith('.jsonl'))).toEqual([
      `fs.read ${HISTORY_DIR}/a.jsonl`,
      `fs.read ${HISTORY_DIR}/b.jsonl`,
    ])
    expect(leaks([dry, ...log.logs, JSON.stringify(log.paneStates)].join('\n'), ['SENTINEL_SECRET_VALUE'])).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('no secret or home path reaches the reply, logs or pane, consent given (SCAN-02, PLAN-05)', async ($, on) => {
    const [apiKey, bearer, token, sentinel] = SECRET_FIXTURES
    const mcpJson = { mcpServers: { linear: { command: 'npx', env: { LINEAR_API_KEY: apiKey } } } }
    const claudeJson = {
      mcpServers: { datadog: { command: 'npx', env: { DD_API_KEY: token } } },
      oauthAccount: { emailAddress: bearer, accessToken: apiKey },
    }
    // This repo's session history: one transcript is named after a secret, and the others sit outside every marker.
    const sessions = [
      { ...entry(`${token}.jsonl`), mtimeMs: 2 },
      { ...entry('b.jsonl'), mtimeMs: 1 },
    ]
    const transcripts = {
      [`${HISTORY_DIR}/${token}.jsonl`]: [
        '{"type":"user","message":{"role":"user","content":"<command-name>/gsd-plan-phase</command-name>' +
          `<command-args>${apiKey} /home/u/notes</command-args>"}}`,
        `{"type":"user","message":{"content":"use ${bearer} from /home/u/.env"}}`,
      ].join('\n'),
      [`${HISTORY_DIR}/b.jsonl`]:
        `{"type":"tool_use","name":"Skill","input":{"skill":"codex:rescue","args":"${sentinel} /Users/v/key"}}`,
    }
    expect(leaks(JSON.stringify([sessions, transcripts]), SECRET_FIXTURES)).toEqual([...SECRET_FIXTURES])
    // The pane is seated inline again at every ask, as a terminal main screen keeps it drawn, so the dialog draws each
    // question's option previews too (D-203, E1).
    const reseat = async (): Promise<void> => {
      const ui = await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
      await ui.unmount()
    }
    const base = initWorld()
    const world = initWorld({
      onAsk: reseat,
      // The project settings approve the .mcp.json server linear, so the scan offers it (D-332).
      settings: { user: secretUserSettings(), project: { enabledMcpjsonServers: ['linear'] }, local: {} },
      listings: { ...base.listings, [HISTORY_DIR]: sessions },
      files: {
        ...base.files,
        ...transcripts,
        '/repo/.mcp.json': JSON.stringify(mcpJson),
        '/home/u/.claude.json': JSON.stringify(claudeJson),
      },
      ancestors: [{ dir: '/repo', name: 'CLAUDE.md', content: sentinel, parts: [] }],
      tools: [{ name: 'mcp__sentry__issues', description: apiKey, mcp: true }],
      commands: [{ name: 'codex:rescue', source: 'plugin', plugin: 'codex', description: bearer }],
      answers: {
        ...INIT_ANSWERS,
        'Read ~/.claude.json': 'Yes, read names only',
        "Scan this repo's session history": 'Yes, scan names and counts',
        'Read your CLAUDE.md files': 'No, skip it',
      },
    })
    // The world holds every fixture, so a clean reply means the scans dropped them, not that they were never there.
    const held = JSON.stringify([world.settings, world.files, world.ancestors, world.tools, world.commands])
    expect(leaks(held, SECRET_FIXTURES)).toEqual([...SECRET_FIXTURES])
    const log = newLog()
    fakeHost(on, world, log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
    expect(log.ops).toContain('fs.read /home/u/.claude.json')
    // The history question's own context is the scan the pane draws while it is open (D-299).
    const scan = (openedContext(log, "Scan this repo's session history")?.lines ?? []).join('\n')
    expect(scan).toContain('MCP servers: datadog, linear, sentry')
    expect(scan).toContain('CLAUDE.md files: repo/CLAUDE.md')
    expect(log.ops).toContain(`fs.read ${HISTORY_DIR}/${token}.jsonl`)
    // Every value the pane state was set to, each question's own context and each loader included (D-303), and the
    // option previews, which the pane and the dialog draw (D-203, E1).
    const pane = JSON.stringify(log.paneStates)
    const asked = JSON.stringify([log.paneStates.map(openOf), log.askPreviews])
    expect(asked).toContain('codex:rescue: ')
    expect(log.askPreviews.flat().some(preview => typeof preview === 'string')).toBe(true)
    // The dialog texts as the tool call gave them, each question's second line included (WD-S5).
    const dialogs = JSON.stringify(log.askQuestions)
    const shown = [out.text, ...log.logs, pane, asked, dialogs, ...log.asks, ...log.askOptions.flat()].join('\n')
    expect(leaks(shown, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })
})
