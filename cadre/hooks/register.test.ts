import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { AskSpec } from '../types'
import { NO_USABLE_ANSWER_REASON, refusalLine, withContext } from './ask'
import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, isObject } from './facts'
import { cadreJsonText, roleJsonText } from './generate'
import { sha256Hex } from './hash'
import {
  cancelledReply,
  CLAUDE_JSON_QUESTION,
  FRAMEWORK_QUESTION_PREFIX,
  GIT_POLICY_CONTEXT,
  GIT_POLICY_DISMISSED_REASON,
  GIT_POLICY_QUESTION,
  INIT_FILE_SYSTEM_ROOT_REPLY,
  INIT_HOME_ROOT_REPLY,
  MANIFEST_SKIPPED_NOTE,
  NEXT_STEP_NOTE,
  NOT_INTERACTIVE_REPLY,
  policyLine,
  PRIVATE_FILES_HEADING,
  privateFoldersUnknownWarning,
  REGEN_NO_STATE,
  regenNoRole,
  REVIEW_QUESTION,
  ROLES_DISMISSED_REASON,
  ROLES_QUESTION,
} from './init'
import { stableJson } from './plan'
import { autopilotReply, CHECKOUT_ARGV } from './scan'
import { GIT_COMMON_DIR_ARGV } from './start'
import {
  ABSOLUTE_PATH_MARKERS,
  answerFor,
  entry,
  INIT_ANSWERS,
  leaks,
  SECRET_FIXTURES,
  secretUserSettings,
  templateRole,
} from './testkit'

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
 * What the fake host saw: every fs, process and settings op in order, the argv of each process call, the working
 * folder each process call asked for ('' when it asked for none), each dialog question as `ask <question>`, the
 * option labels each dialog showed, the preview of each option of each dialog (D3), each text the plugin logged to the
 * transcript, each side pane it opened as `ui.open <id> <title>`, each pane it closed as `ui.close <id>`, each value it
 * set the init pane's state to (D-133), and each path it wrote, in order.
 */
type HostLog = {
  readonly ops: string[]
  readonly runs: string[][]
  readonly cwds: string[]
  readonly asks: string[]
  readonly askOptions: string[][]
  readonly askPreviews: unknown[][]
  readonly logs: string[]
  readonly panes: string[]
  readonly closes: string[]
  readonly paneWrites: unknown[]
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
 * too, but streams, so fakeHost hooks it with a generator. `state.set` is forbidden too, except the init pane's own
 * state (D-133, T-02-49), so fakeHost hooks it on its own. `process.run` is not here: it is logged, and only the
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
    logs: [],
    panes: [],
    closes: [],
    paneWrites: [],
    writes: [],
  }
}

/** One block of the init side pane as the fake host saw its state written (D-133). */
type PaneBlock = {
  readonly key: string
  readonly title: string
  readonly lines: readonly string[]
}

/** Whether a value in the init pane's state is one block: a key, a title and its lines, all text. */
function isPaneBlock(value: unknown): value is PaneBlock {
  if (!isObject(value)) return false
  const { key, title, lines } = value

  return (
    typeof key === 'string' &&
    typeof title === 'string' &&
    Array.isArray(lines) &&
    lines.every(line => typeof line === 'string')
  )
}

/** The init pane as it stands after a run, newest block first: the last value its state was set to (D-133). */
function paneOf(log: HostLog): PaneBlock[] {
  const last = log.paneWrites.at(-1)

  return Array.isArray(last) ? last.filter(isPaneBlock) : []
}

/** The lines of the init pane's block of this key; empty when the pane has no such block. */
function paneLines(log: HostLog, key: string): readonly string[] {
  return paneOf(log).find(block => block.key === key)?.lines ?? []
}

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
 * Answers the host ops `/cadre detect`, `/cadre init` and `/cadre regen` may use from `world` and logs each fs,
 * process and settings op into `log`; a dialog is answered from `world.answers` and logged as an ask, and a transcript
 * text is kept in `log.logs`. A side pane is placed and kept in `log.panes`, and each value of the init pane's state is
 * kept in `log.paneWrites` and stored, unless `world.denyPane` refuses both. A pane closed is kept in `log.closes`,
 * and the close is refused when `world.denyClose`. The model answers `world.replies` in
 * order. A process call answers its runResults entry, else `runtime`. `fs.write` is answered as done, and its path
 * kept in `log.writes`, only when `world.isWriteAllowed`. Every other forbidden op, a `state.set` of any other state
 * included, is answered with a refusal, so a call to one would show up in the log and fail its call.
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
  // The init pane's blocks are the plugin's own state (D-133, T-02-49); a write of any other state is forbidden.
  on('state.set', async (_$, e, next) => {
    if (e.plugin !== 'cadre' || e.key !== 'initPane') {
      log.ops.push('forbidden state.set')

      return { deny: 'detect uses no such op' }
    }
    log.paneWrites.push(e.value)
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

  test('a runtime identity answer for another package never makes the GSD row installed', async ($, on) => {
    const log = newLog()
    const decoy = {
      ...ambiguousWorld(),
      listings: { '/repo': [entry('docs', 'dir')], '/repo/docs': [entry('superpowers', 'dir')] },
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"get-shit-done-cc","note":"@opengsd/gsd-core"}' },
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
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
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
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a symlinked repo root that lands in the home folder is refused by init too', async ($, on) => {
    const log = newLog()
    const linked = initWorld({ root: '/link/repo', realPaths: { '/link/repo': '/home/u', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session at the file system root is refused with the init wording, even with no HOME', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/', env: {}, realPaths: { '/': '/' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(INIT_FILE_SYSTEM_ROOT_REPLY)
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
    expect(log.logs.at(-1)).toBe(GIT_POLICY_DISMISSED_REASON)
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
    const asked = `ask ${withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)}`
    const again = `ask ${refusal}\n${withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT)}`
    expect(log.asks.slice(log.asks.indexOf(asked))).toEqual([asked, again, again])
    expect(refusal).toBe("'whatever' isn't one of: definitions, all, ignore.")
    expect(log.logs.at(-1)).toBe(NO_USABLE_ANSWER_REASON)
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

  test('init guards before it scans, asks the ~/.claude.json consent first and shows both scans', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.asks[0]?.startsWith('ask Read ~/.claude.json for MCP server names?')).toBe(true)
    const lines = paneLines(log, 'scan')
    expect(lines[0]).toBe('Repo scan (read-only):')
    expect(lines).toContain('User setup (names only):')
    expect(log.logs.join('\n')).not.toContain('Repo scan (read-only):')
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    const guardAt = log.ops.indexOf('fs.exists /home/u/.claude/autopilot/s1.json')
    expect(guardAt >= 0 && guardAt < log.ops.indexOf('fs.list /repo')).toBe(true)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops.filter(op => op === 'process.run').length <= 1).toBe(true)
    expect(out.text.split('\n').at(-1)).toBe('Dry run: nothing was written.')
  })

  test('init --dry-run opens the cadre-init pane before the first question after the scan', async ($, on) => {
    const log = newLog()
    // With no session history the roles question is the first one after the scan, so a dismissal ends init there.
    fakeHost(on, initWorld({ answers: answersWithout('Use these roles?') }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(cancelledReply(ROLES_DISMISSED_REASON))
    expect(askHeads(log)).toEqual([`ask ${CLAUDE_JSON_QUESTION}`, `ask ${ROLES_QUESTION}`])
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    expect(paneLines(log, 'scan')[0]).toBe('Repo scan (read-only):')
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
    expect(log.paneWrites.length).toBeGreaterThan(0)
    expect(log.logs.join('\n')).not.toContain('Repo scan (read-only):')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('init --dry-run keeps every block in the pane, newest first, and logs one-line notes only', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(paneOf(log).map(block => block.key)).toEqual(['review', 'recommendations', 'roles', 'scan'])
    expect(paneOf(log).map(block => block.title)).toEqual(['Review', 'Recommendations', 'Roles', 'Scan'])
    expect(log.logs.every(text => !text.includes('\n'))).toBe(true)
    expect(log.panes).toEqual(['ui.open cadre-init cadre init'])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('the first block of a run replaces whatever an earlier run left in the pane (D-133)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const firstRun = log.paneWrites.length
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const restart = log.paneWrites[firstRun]
    expect(Array.isArray(restart) ? restart.filter(isPaneBlock).map(block => block.key) : []).toEqual(['scan'])
    expect(paneOf(log).map(block => block.key)).toEqual(['review', 'recommendations', 'roles', 'scan'])
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

  test('init --dry-run shows the security plugin lines and commands under the recommendations (#39)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const lines = paneLines(log, 'recommendations')
    const headingAt = lines.indexOf('Recommendations (print-only; init asks before it installs any):')
    const claudeSecurity =
      "- claude-security for Security: claude-security gives the Security role Anthropic's review skill " +
      '(needs Python 3.9 or newer)'
    const securityAt = lines.indexOf(claudeSecurity)
    expect(headingAt).toBeGreaterThanOrEqual(0)
    expect(securityAt).toBeGreaterThan(headingAt)
    expect(lines.slice(headingAt + 1, securityAt).filter(line => !/^(- |    run: )/.test(line))).toEqual([])
    expect(lines.slice(securityAt, securityAt + 4)).toEqual([
      claudeSecurity,
      '    run: claude plugin install claude-security@claude-plugins-official',
      '- security-guidance for Security: no hooks warn the Security role about risky edits',
      '    run: claude plugin install security-guidance@claude-plugins-official',
    ])
    expect(lines.filter(line => line.includes('/security-review'))).toEqual([])
  })
})

describe('the init pane as the option preview of a dialog on the main screen (D3)', () => {
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
  const PANE_ON_TERMINAL = { plugin: 'cadre', surface: 'terminal', component: 'Pane', requestId: 'cadre-init' } as const

  /** The Pane props a terminal draws the cadre-init pane with on its main screen: inline, above the prompt. */
  const INLINE_PANE = {
    title: 'cadre init',
    isFocused: false,
    bodyColumns: 60,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  } as const

  /** The same pane docked beside the transcript, as a fullscreen terminal seats it. */
  const DOCK_PANE = { ...INLINE_PANE, placement: 'dock' } as const

  /** The options with no preview of PICK_QUESTION, as the fake host sees a dialog passed through. */
  const NO_PREVIEWS = [[undefined, undefined]]

  /** What $.ui.ask is given for `Pick one?` (A3): options A and B under the chip Pick. */
  const PICK_SPEC: AskSpec = { options: ['A', 'B'], header: 'Pick' }

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

  /**
   * Runs `init --dry-run`, so the pane holds the run's blocks, then has the terminal draw the cadre-init pane with
   * `props`: inline on the main screen, or docked as fullscreen seats it. It gives the ask of a test that loads ASKER.
   * Every `$.command.run` of this describe goes through it, but the one of the test with no render.
   */
  async function seatAfterRun($: Engine, props: typeof INLINE_PANE | typeof DOCK_PANE): Promise<Ask> {
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    await $.ui.mount({ ...PANE_ON_TERMINAL, props })

    return async (question, spec) => {
      const { text } = await $.command.run({ command: 'ask-probe', args: JSON.stringify({ question, spec }) })
      const reply: unknown = JSON.parse(text)

      return isObject(reply) && typeof reply.answer === 'string' ? reply.answer : null
    }
  }

  /** initWorld with `Pick one?` answered `answer` and, when given, `notes` typed in that dialog's notes (A3). */
  function pickWorld(answer: string, notes?: string): World {
    const answers = { ...INIT_ANSWERS, 'Pick one?': answer }

    return initWorld(notes === undefined ? { answers } : { answers, notes: { 'Pick one?': notes } })
  }

  test('after a run, each option of an inline pane dialog gets the same preview, the review first', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askOptions.slice(before)).toEqual([['A', 'B', 'Describe your own']])
    const seen = log.askPreviews.slice(before)
    expect(seen).toHaveLength(1)
    const [first, ...rest] = seen[0] ?? []
    expect(typeof first === 'string' && first.startsWith('**Review**')).toBe(true)
    expect(rest).toEqual([first, first])
  })

  test('a docked pane gives no preview', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, DOCK_PANE)
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('with no terminal render of the pane after the run, no preview is given', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('a multi-select question gets no preview', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, multiSelect: true }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('a question with no options makes the whole call pass through unchanged', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [PICK_QUESTION, { ...PICK_QUESTION, question: 'Empty?', options: [] }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('an inline pane with no block yet gives no preview', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.ui.mount({ ...PANE_ON_TERMINAL, props: INLINE_PANE })
    const before = log.askPreviews.length
    await $.tool.call({ tool: 'AskUserQuestion', questions: [PICK_QUESTION] }).catch(() => null)
    expect(log.askPreviews.slice(before)).toEqual(NO_PREVIEWS)
  })

  test('a question with the Roles chip gets the roles block as the preview of every option (B1)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, header: 'Roles' }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    const seen = log.askPreviews.slice(before)[0] ?? []
    expect(seen).toHaveLength(3)
    expect(seen.every(preview => typeof preview === 'string' && preview.startsWith('**Roles**'))).toBe(true)
  })

  test('a chip with no block of its own, as Git policy, gets the newest block: the review (B1)', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await seatAfterRun($, INLINE_PANE)
    const before = log.askPreviews.length
    const questions = [{ ...PICK_QUESTION, header: 'Git policy' }]
    await $.tool.call({ tool: 'AskUserQuestion', questions }).catch(() => null)
    const seen = log.askPreviews.slice(before)[0] ?? []
    expect(seen).toHaveLength(3)
    expect(seen.every(preview => typeof preview === 'string' && preview.startsWith('**Review**'))).toBe(true)
  })

  test('a note typed in the dialog is what $.ui.ask resolves to, trimmed (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('A', '  my words  '), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('my words')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('Describe your own with no note resolves to an empty answer (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('Describe your own'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('an option chosen with no note resolves to its label (A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('B'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('B')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
  })

  test('a 4-option question gets the hint line and keeps its answer key (A2, A3)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('C'), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', { options: ['A', 'B', 'C', 'D'], header: 'Pick' })).toBe('C')
    expect(log.asks.at(-1)).toBe('ask Pick one?\nOr press n, type your own answer, then Enter.')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'C', 'D'])
  })

  test('a docked pane adds no option and takes no note as the answer (A1)', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, pickWorld('A', '  my words  '), log)
    const ask = await seatAfterRun($, DOCK_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe('A')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B'])
  })

  test('a dismissed dialog still rejects $.ui.ask: the deny passes through', WITH_ASKER, async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const ask = await seatAfterRun($, INLINE_PANE)
    expect(await ask('Pick one?', PICK_SPEC)).toBe(null)
    expect(log.asks.at(-1)).toBe('ask Pick one?')
    expect(log.askOptions.at(-1)).toEqual(['A', 'B', 'Describe your own'])
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
      expect(paneLines(log, 'review').join('\n')).toContain(expected.card)
    })
  }

  test(
    'GSD only with a runtime-proven install: init --dry-run makes only the one identity call (D-82)',
    async ($, on) => {
      const log = newLog()
      const world = gsdOnlyWorld({
        denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
        runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
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
    expect(paneLines(log, 'history')).toEqual([])
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('history answered Yes: names and counts are shown, never transcript text (SCAN-03, T-02-41)', async ($, on) => {
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
    expect(paneLines(log, 'history')).toEqual(['Session history (names and counts only):', '  gsd-plan-phase  2'])
    expect(leaks([dry, ...log.logs, JSON.stringify(log.paneWrites)].join('\n'), ['SENTINEL_SECRET_VALUE'])).toEqual([])
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
    const base = initWorld()
    const world = initWorld({
      settings: { user: secretUserSettings(), project: {}, local: {} },
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
    expect(paneLines(log, 'scan').join('\n')).toContain('MCP servers: datadog, linear, sentry')
    expect(paneLines(log, 'scan').join('\n')).toContain('CLAUDE.md files: <repo>/CLAUDE.md')
    expect(log.ops).toContain(`fs.read ${HISTORY_DIR}/${token}.jsonl`)
    expect(paneLines(log, 'history')).toEqual([
      'Session history (names and counts only):',
      '  codex:rescue  1',
      '  gsd-plan-phase  1',
    ])
    // Every value the pane's state was set to, so a block shown and later replaced is scanned too.
    const pane = JSON.stringify(log.paneWrites)
    const shown = [out.text, ...log.logs, pane, ...log.asks, ...log.askOptions.flat()].join('\n')
    expect(leaks(shown, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])).toEqual([])
  })
})
