import type {
  AskSpec,
  CadreState,
  CompiledScope,
  DesiredFile,
  EpicRecord,
  Facts,
  FileMode,
  FrameworkId,
  GitPolicy,
  GsdFact,
  HookScript,
  HostEnvName,
  HostIo,
  HostRun,
  HunkOp,
  InitFacts,
  InitIo,
  InitLocations,
  InstructionPart,
  InstructionTopic,
  ManifestEntry,
  McpRef,
  MemoryItem,
  PaneKey,
  Plan,
  PortEntry,
  PortRead,
  PortStat,
  RepoScan,
  RoleSpec,
  RunOptions,
  ScanFinding,
  ScanKind,
  ScopeCard,
  ScopeContext,
  SettingsSource,
  SettingsTemplate,
  SetupScan,
  ShownBlock,
  SkillRef,
  TemplateRoleId,
  TerminalChoice,
} from '../types'
import type { ConflictChoice } from './apply/conflict'
import type { ApplyStep } from './apply/private'
import type { ApplyOutcome } from './apply/run'
import { sha256Hex } from './core/hash'
import { isObject, stableJson } from './core/json'
import { DONE_MARKER_LINE } from './core/kickoff-text'
import { compareText, utf8Bytes } from './core/text'
import { runEpic } from './epic/create'
import { adapterOf } from './framework/registry'
import { desiredFiles } from './generate/files'
import { RUNTIME_KICKOFF_TEST } from './generate/launcher'
import { CHECKOUT_ARGV } from './git/checkout'
import type { Draft } from './init/draft'
import { nextStage, STAGES } from './init/machine'
import { perform, showOutput } from './init/run'
import { CONTENT_QUESTION, INSTRUCTIONS_ENTRY_QUESTION } from './init/stages/instructions'
import type { Answer, InitStage, InitState, IoCall, IoResult, Output, StageDef } from './init/state'
import { lintRuntimeDenyPattern } from './launch/deny'
import type { LaunchPlan } from './launch/plan'
import { RUNTIME_SETTINGS_KEYS } from './launch/settings'
import { gitignoreLines } from './plan/gitignore'
import { buildPlan } from './plan/plan'
import type { PlanInput } from './plan/plan'
import type { PartRecord } from './regen/part-changes'
import { INFRA_SKILLS } from './roles/infra'
import { proposeRoles } from './roles/propose'
import {
  AUTOPILOT_THRESHOLD,
  DEFAULT_DURATION,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  EMPTY_CARRY,
  ROLE_TEMPLATE,
  roleFromTemplate,
} from './roles/template'
import type { TemplateRole } from './roles/template'
import { gatherScans } from './scan/gather'
import type { Gathered } from './scan/gather'
import type { SetupContext } from './scan/setup/read'
import { scanSetup } from './scan/setup/setup'
import { compileScope } from './scope/compile'
import { infraViolations, roleOwnPaths } from './scope/lint'
import { scopesFor } from './team'
import type { StepResult } from './ui/ask'

/**
 * Support for the Phase 2 tests, not a test itself: it is deliberately not named `*.test.ts`, so `claude plugin test`
 * does not run it, and `npm run typecheck:cadre` checks it. It gives a pure test a scripted InitIo: answers in order
 * or by question, a rejection when the answers run out, files and folders in memory, tri-state reads, and the
 * secret and absolute-path fixtures the property tests scan for. It also gives the Phase 3 tests a scripted HostIo
 * that records every write and run in call order and answers each from a HostWorld, and the specs of the pure init
 * stages a state at a stage (stateAt) and a drive through the stage machine with scripted answers (driven, and
 * drivenWith, which performs the host operations through a scripted port).
 */

/** The session of the fixtures: the repo at /repo, a user whose home is /home/u, no CLAUDE_CONFIG_DIR, no warnings. */
export const DEFAULT_LOCATIONS: InitLocations = {
  root: '/repo',
  givenRoot: '/repo',
  home: '/home/u',
  givenHome: '/home/u',
  configDir: null,
  warnings: [],
}

/** Facts with every list empty: a repo where detection found nothing. */
export const EMPTY_FACTS: Facts = {
  repoEntries: [],
  docsEntries: [],
  enabledPlugins: [],
  hookScripts: [],
  superpowersVersions: [],
  gsd: [],
  warnings: [],
}

/** What a scripted port answers: the value behind each InitIo member, and the in-memory files and folders. */
export type MemWorld = {
  readonly interactive: boolean | null
  readonly locations: InitLocations | null
  readonly facts: InitFacts
  readonly sessionId: string | null
  readonly now: number | null
  readonly cadreVersion: string | null
  /** Absolute path to text. A path that is neither here nor in unknownPaths reads as absent. */
  readonly files: Readonly<Record<string, string>>
  /** Absolute folder path to its listing. A folder that is not here cannot be listed. */
  readonly dirs: Readonly<Record<string, readonly PortEntry[]>>
  /** Paths whose read, stat and listing fail, so they are unknown and never absent. */
  readonly unknownPaths: readonly string[]
  /** Where a path lands when its stat is asked. A path that is not here lands on itself. */
  readonly realPaths: Readonly<Record<string, string>>
  /** What `ancestors` answers, unvalidated. */
  readonly ancestors: unknown
  /** The value of each settings source. A source that is not here is unreadable. */
  readonly settings: Readonly<Partial<Record<SettingsSource, unknown>>>
  /** What `commands` answers, unvalidated. */
  readonly commands: unknown
  /** What `tools` answers, unvalidated. */
  readonly tools: unknown
  /** The model's replies in order. Once they run out, or at a null entry, the model gave no text. */
  readonly replies: readonly (string | null)[]
}

/**
 * A MemWorld of an interactive session at the repo /repo with nothing readable, nothing detected, session id `s1`,
 * the clock at 1_000_000 and cadre at 0.2.0. `over` changes the fields it names.
 */
export function memWorld(over: Partial<MemWorld>): MemWorld {
  return {
    interactive: true,
    locations: DEFAULT_LOCATIONS,
    facts: { facts: EMPTY_FACTS, gsdUserDir: null },
    sessionId: 's1',
    now: 1_000_000,
    cadreVersion: '0.2.0',
    files: {},
    dirs: {},
    unknownPaths: [],
    realPaths: {},
    ancestors: [],
    settings: { user: {}, project: {}, local: {} },
    commands: [],
    tools: [],
    replies: [],
    ...over,
  }
}

/**
 * A scripted port and what it was asked, in order: every question and spec, line logged, prompt, path read and folder
 * listed.
 */
export type MemRun = {
  readonly io: InitIo
  /** Every question asked, the dismissed ones included. */
  readonly asked: string[]
  readonly specs: AskSpec[]
  readonly logged: string[]
  /** Every block shown in the side pane, in order. */
  readonly shown: ShownBlock[]
  /** Every status line set, in order, null for each clear (D-232). */
  readonly progress: (string | null)[]
  /** Every completion asked, as `${system}\n---\n${prompt}`. */
  readonly prompts: string[]
  readonly reads: string[]
  /** Every folder path listed, in order. */
  readonly listed: string[]
}

/** Whether scripted answers are given in order, rather than by question prefix. */
function isScript(answers: readonly string[] | Readonly<Record<string, string>>): answers is readonly string[] {
  return Array.isArray(answers)
}

/** The value of the longest key the question starts with; undefined when no key matches. */
export function answerFor(answers: Readonly<Record<string, string>>, question: string): string | undefined {
  let longest: string | undefined
  for (const key of Object.keys(answers)) {
    if (!question.startsWith(key)) continue
    if (longest === undefined || key.length > longest.length) longest = key
  }

  return longest === undefined ? undefined : answers[longest]
}

/** The value under `key` when the record has it itself, so a key such as `constructor` is never found. */
function own<V>(record: Readonly<Record<string, V>>, key: string): V | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** A folder's listing, or null when it is not in the world or its path is unknown. */
function listOf(world: MemWorld, path: string): readonly PortEntry[] | null {
  if (world.unknownPaths.includes(path)) return null

  return own(world.dirs, path) ?? null
}

/** A path's stat: a file with its UTF-8 byte length as size, a listed folder, else null. A moved real path is a link. */
function statOf(world: MemWorld, path: string): PortStat | null {
  if (world.unknownPaths.includes(path)) return null
  const realPath = own(world.realPaths, path) ?? path
  const text = own(world.files, path)
  const isLink = realPath !== path
  if (text !== undefined) return { kind: 'file', size: utf8Bytes(text), isLink, realPath }
  if (own(world.dirs, path) !== undefined) return { kind: 'dir', size: 0, isLink, realPath }

  return null
}

/**
 * A path read: unknown first (a listed folder too, since the real port never reads a non-file), then absent, then
 * too-large over `maxBytes` UTF-8 bytes, else the text.
 */
function readOf(world: MemWorld, path: string, maxBytes: number): PortRead {
  if (world.unknownPaths.includes(path)) return { state: 'unknown' }
  if (own(world.dirs, path) !== undefined) return { state: 'unknown' }
  const text = own(world.files, path)
  if (text === undefined) return { state: 'absent' }
  const bytes = utf8Bytes(text)
  if (bytes > maxBytes) return { state: 'too-large', bytes }

  return { state: 'text', text }
}

/**
 * A port over `world` that records what it is asked. With an array of `answers`, `ask` answers in order and rejects
 * with `dismissed` when they run out. With a record, `ask` answers with the value of the longest key the question
 * starts with and rejects with `dismissed` when no key does, so a flow test survives a new question.
 * statForWrite answers an unknown path failed, a missing one absent, else its stat.
 */
export function memIo(world: MemWorld, answers: readonly string[] | Readonly<Record<string, string>>): MemRun {
  const asked: string[] = []
  const specs: AskSpec[] = []
  const logged: string[] = []
  const shown: ShownBlock[] = []
  const progress: (string | null)[] = []
  const prompts: string[] = []
  const reads: string[] = []
  const listed: string[] = []
  let nextAnswer = 0
  let nextReply = 0

  const isScripted = isScript(answers)

  const io: InitIo = {
    ask: async (question, spec) => {
      asked.push(question)
      specs.push(spec)
      const answer = isScripted ? answers[nextAnswer] : answerFor(answers, question)
      if (isScripted) nextAnswer += 1
      if (answer === undefined) throw new Error('dismissed')

      return answer
    },
    log: text => {
      logged.push(text)
    },
    show: async block => {
      shown.push(block)
    },
    progress: async text => {
      progress.push(text)
    },
    complete: async (prompt, system) => {
      prompts.push(`${system}\n---\n${prompt}`)
      const reply = world.replies[nextReply]
      nextReply += 1

      return reply ?? null
    },
    isInteractive: async () => world.interactive,
    locations: async () => world.locations,
    facts: async () => world.facts,
    sessionId: async () => world.sessionId,
    now: async () => world.now,
    cadreVersion: async () => world.cadreVersion,
    list: async path => {
      listed.push(path)

      return listOf(world, path)
    },
    stat: async path => statOf(world, path),
    statForWrite: async path => {
      if (world.unknownPaths.includes(path)) return 'failed'

      return statOf(world, path) ?? 'absent'
    },
    read: async (path, maxBytes) => {
      reads.push(path)

      return readOf(world, path, maxBytes)
    },
    ancestors: async () => world.ancestors,
    settings: async source => world.settings[source] ?? null,
    commands: async () => world.commands,
    tools: async () => world.tools,
  }

  return { io, asked, specs, logged, shown, progress, prompts, reads, listed }
}

/**
 * One scripted answer of the fake host's `run`: the argv it answers, compared element by element, and its result. A
 * null result is a run the host rejected (the command could not start, timed out or was refused).
 */
export type HostRunRule = {
  readonly argv: readonly string[]
  readonly result: HostRun | null
}

/**
 * What a scripted HostIo answers: the run rules (the first rule naming an argv answers it), the paths whose write
 * fails, and the environment variables that are set.
 */
export type HostWorld = {
  readonly runs: readonly HostRunRule[]
  readonly writeFails: readonly string[]
  /**
   * A name set to '' is answered as ''. The real HostIo answers null for an empty value, so leave the name
   * out to model unset or empty.
   */
  readonly env: Readonly<Partial<Record<HostEnvName, string>>>
}

/** The fake host's answer to an argv no rule names: exit 0 with no output. Frozen, so no test can change it. */
export const DEFAULT_RUN: HostRun = Object.freeze({ exitCode: 0, stdout: '', stderr: '' })

/** A HostWorld with no run rules, no failing write and no variable set. `over` changes the fields it names. */
export function hostWorld(over: Partial<HostWorld>): HostWorld {
  return {
    runs: [],
    writeFails: [],
    env: {},
    ...over,
  }
}

/** One write the fake host was asked for, and whether it answered that the write happened. */
export type HostWrite = {
  readonly path: string
  readonly text: string
  readonly isWritten: boolean
}

/** One run the fake host was asked for: a copy of its argv, and its options. */
export type HostCall = {
  readonly argv: readonly string[]
  readonly options: RunOptions
}

/** A scripted HostIo and what it was asked, in call order: every write and every run. */
export type MemHost = {
  readonly io: HostIo
  readonly writes: HostWrite[]
  readonly calls: HostCall[]
}

/**
 * A HostIo over `world` that records every write and run in call order. A write answers false for a path in
 * `writeFails`, else true. A run answers the result of the first rule whose argv has the same length and the same
 * element at every index (null for a rejected run), else DEFAULT_RUN. `env` answers the world's value, else null.
 */
export function memHost(world: HostWorld): MemHost {
  const writes: HostWrite[] = []
  const calls: HostCall[] = []

  const io: HostIo = {
    write: async (path, text) => {
      const isWritten = !world.writeFails.includes(path)
      writes.push({ path, text, isWritten })

      return isWritten
    },
    run: async (argv, options) => {
      calls.push({ argv: [...argv], options })
      const rule = world.runs.find(
        candidate =>
          candidate.argv.length === argv.length && candidate.argv.every((word, index) => word === argv[index]),
      )

      return rule === undefined ? DEFAULT_RUN : rule.result
    },
    env: async name => world.env[name] ?? null,
  }

  return { io, writes, calls }
}

/**
 * A new world whose `files` hold the text of every write with isWritten true, later writes winning, so a test can
 * re-run init or start over what a run wrote. The world given is not changed. It adds files only, not folders, so a
 * folder a run created is still not listed or stat-ed as a folder.
 */
export function withWrites(world: MemWorld, writes: readonly HostWrite[]): MemWorld {
  const files: Record<string, string> = { ...world.files }
  for (const write of writes) {
    if (!write.isWritten) continue
    files[write.path] = write.text
  }

  return { ...world, files }
}

/** A listing entry as the port gives it: a file unless told otherwise, and not a link unless told so. */
export function entry(name: string, kind: PortEntry['kind'] = 'file', isLink = false): PortEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink }
}

/** A symbolic link as the host lists it: kind other, isLink true. */
export function link(name: string): PortEntry {
  return entry(name, 'other', true)
}

/** A listing entry with its modification time, for the newest-first tests of `/cadre status`. */
export function entryAt(name: string, kind: PortEntry['kind'], mtimeMs: number, isLink = false): PortEntry {
  return { ...entry(name, kind, isLink), mtimeMs }
}

/** A right-to-left override (U+202E), the bidi character the hostile-text tests hide in names and titles. */
export const BIDI_OVERRIDE = '\u202E'

/** A zero-width space (U+200B), the invisible character the hostile-text tests hide in names and titles. */
export const ZERO_WIDTH_SPACE = '\u200B'

/** Fake secrets no output, question, log line or generated file may contain. */
export const SECRET_FIXTURES: readonly string[] = Object.freeze([
  'sk-FAKE-SECRET-0123456789',
  'Bearer FAKE-TOKEN-0123',
  'ghp_FAKEFAKEFAKEFAKEFAKE',
  'SENTINEL_SECRET_VALUE',
])

/** Absolute-path markers no generated file may contain; `/home/` also covers the fixture home `/home/u` (PLAN-05). */
export const ABSOLUTE_PATH_MARKERS: readonly string[] = Object.freeze(['/Users/', '/home/', '/private/'])

/** The needles found in the text, in needle order; empty when the text is clean. */
export function leaks(text: string, needles: readonly string[]): string[] {
  return needles.filter(needle => text.includes(needle))
}

/** The template role with this id, as init builds it: nothing assigned, every other field a default. */
export function templateRole(id: TemplateRoleId, over: Partial<RoleSpec> = {}): RoleSpec {
  const row = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (row === undefined) throw new Error(`no template role ${id}`)

  return { ...roleFromTemplate(row), ...over }
}

/**
 * A setup scan that found nothing; `over` changes the fields it names. A new SetupScan field is added here once, for
 * every test that builds a scan.
 */
export function emptySetupScan(over: Partial<SetupScan> = {}): SetupScan {
  return {
    plugins: [],
    installedPlugins: [],
    skills: [],
    mcp: [],
    isMcpPartial: false,
    agents: [],
    claudeMd: [],
    hasGlobalClaudeMd: false,
    memoryFiles: [],
    settingsKeys: [],
    hooks: [],
    carry: { autoCompactWindow: null, hasStatusLine: false, isGsdStatusline: false, envNames: [] },
    warnings: [],
    ...over,
  }
}

/** The three frameworks a role can run, in the order the property tests run them. */
export const FRAMEWORKS: readonly FrameworkId[] = ['gsd', 'superpowers', 'none']

/** An MCP server the live session lists. */
export function session(name: string): McpRef {
  return { name, source: 'session' }
}

/** A skill or plugin command the scan listed; `plugin` is null for a user or project skill. */
export function skillRef(name: string, plugin: string | null = null): SkillRef {
  return { name, plugin }
}

/**
 * The answers a whole /cadre init run needs, by question prefix (the longest prefix wins). Each entry answers a
 * question init asks now or a later step adds; a question no entry matches is dismissed. A new init question adds its
 * prefix here, once, for the init and the faked-host flow tests.
 */
export const INIT_ANSWERS: Readonly<Record<string, string>> = Object.freeze({
  'Read ~/.claude.json': 'No, skip it',
  'Use these roles?': 'Use these roles',
  'Which framework do the roles use': 'Same for all roles',
  'Framework for': 'GSD',
  'Autopilot duration': '4h',
  'Model and effort: same': 'Same for all roles',
  'Model and effort for': 'opus + medium',
  'Which roles get': 'None',
  'Which env variables': 'None',
  '.planning/config.json:': 'Accept',
  'Install from claude-plugins-official': 'Not now',
  'Git policy': 'Commit definitions (default)',
  'Where should the role launchers start': 'Git root of this repo',
  'Review the plan': 'Confirm',
  "Scan this repo's session history": 'No, skip it',
})

/**
 * User settings that hold a fake secret in every place a value can sit (B6): the env values of API_KEY
 * (sk-FAKE-SECRET-0123456789) and JIRA_URL (Bearer FAKE-TOKEN-0123), the gsd-statusline command (a bearer token and the
 * home path), and two PreToolUse hook commands: the GSD secret read guard (SENTINEL_SECRET_VALUE and the home path) and
 * a hook of the user's own (ghp_FAKEFAKEFAKEFAKEFAKE and the home path). A scan keeps only their names.
 */
export function secretUserSettings(): Record<string, unknown> {
  return {
    env: { API_KEY: 'sk-FAKE-SECRET-0123456789', JIRA_URL: 'Bearer FAKE-TOKEN-0123' },
    autoCompactWindow: 800000,
    statusLine: { type: 'command', command: '/home/u/.claude/hooks/gsd-statusline.js --t Bearer FAKE-TOKEN-0123' },
    hooks: {
      PreToolUse: [
        {
          hooks: [
            {
              type: 'command',
              command: 'SECRET=SENTINEL_SECRET_VALUE node /home/u/.claude/hooks/gsd-secret-read-guard.js',
            },
            { type: 'command', command: '/home/u/bin/my-hook.sh --key ghp_FAKEFAKEFAKEFAKEFAKE' },
          ],
        },
      ],
    },
  }
}

/**
 * A git repo at /repo whose user setup holds a fake secret wherever a value can sit (B6): the user settings of
 * secretUserSettings (the env values, the gsd-statusline command and two hook commands), the description of the
 * sentry MCP tool (sk-FAKE-SECRET-0123456789), the description of the codex:rescue skill (Bearer FAKE-TOKEN-0123), and
 * the text of the project CLAUDE.md (SENTINEL_SECRET_VALUE), of the global ~/.claude/CLAUDE.md
 * (sk-FAKE-SECRET-0123456789) and of the auto-memory notes.md (ghp_FAKEFAKEFAKEFAKEFAKE). The project and local
 * settings are empty. The scans keep the names: sentry, the codex skill, the three instruction groups, the env names
 * API_KEY and JIRA_URL, autoCompactWindow, the statusline and the two hook scripts. `over` changes the fields it names.
 */
export function secretWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({
    settings: { user: secretUserSettings(), project: {}, local: {} },
    tools: [{ name: 'mcp__sentry__issues', description: 'sk-FAKE-SECRET-0123456789', mcp: true }],
    commands: [{ name: 'codex:rescue', source: 'plugin', plugin: 'codex', description: 'Bearer FAKE-TOKEN-0123' }],
    ancestors: [{ dir: '/repo', name: 'CLAUDE.md', content: 'SENTINEL_SECRET_VALUE', parts: [] }],
    dirs: { '/repo/.git': [], '/home/u/.claude/projects/-repo/memory': [entry('notes.md')] },
    files: {
      '/home/u/.claude/CLAUDE.md': 'sk-FAKE-SECRET-0123456789',
      '/home/u/.claude/projects/-repo/memory/notes.md': 'ghp_FAKEFAKEFAKEFAKEFAKE',
    },
    ...over,
  })
}

/**
 * The first line of each question a run asked: the line the question constants and the INIT_ANSWERS keys match, since
 * every question carries its context line on its second line (D-136). A re-asked question starts with its refusal.
 */
export function firstLines(asked: readonly string[]): string[] {
  return asked.map(question => question.split('\n')[0] ?? '')
}

/**
 * The fixture user's config folder, listed with nothing in it: a private write lists it before it writes under
 * `<userDir>/cadre`, and refuses when it cannot (02-GAPS-B3 S3).
 */
export const USER_DIR_LISTED: Readonly<Record<string, readonly PortEntry[]>> = { '/home/u/.claude': [] }

/**
 * A session in the git repo /repo: its `.git` folder is there, the user's config folder lists (USER_DIR_LISTED), and
 * `over` changes the fields it names.
 */
export function gitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [], ...USER_DIR_LISTED }, ...over })
}

/** The port of a run that also records every path it was asked to stat, in order. */
export function withStats(run: MemRun): { readonly io: InitIo; readonly stats: string[] } {
  const stats: string[] = []
  const io: InitIo = {
    ...run.io,
    stat: async path => {
      stats.push(path)

      return run.io.stat(path)
    },
  }

  return { io, stats }
}

/**
 * The port of a run that also records its questions (as `ask <first line>`, firstLines), log entries and side-pane
 * blocks (as `show <key>`) in one list, in the order they happened.
 */
export function withEvents(run: MemRun): { readonly io: InitIo; readonly events: string[] } {
  const events: string[] = []
  const io: InitIo = {
    ...run.io,
    ask: async (question, spec) => {
      events.push(`ask ${question.split('\n')[0] ?? ''}`)

      return run.io.ask(question, spec)
    },
    log: text => {
      events.push(`log ${text}`)
      run.io.log(text)
    },
    show: async block => {
      events.push(`show ${block.key}`)
      await run.io.show(block)
    },
  }

  return { io, events }
}

/** The lines of the last side-pane block of this key a run showed; empty when it showed none (D-133). */
export function shownBlock(run: MemRun, key: PaneKey): readonly string[] {
  return run.shown.filter(block => block.key === key).at(-1)?.lines ?? []
}

/** Every title and line a run showed in the side pane, in order, to scan for what must never be shown. */
export function paneText(run: MemRun): string[] {
  return run.shown.flatMap(block => [block.title, ...block.lines])
}

/** A repo scan that found nothing; `over` changes the fields it names. */
export function repoScan(over: Partial<RepoScan> = {}): RepoScan {
  return {
    findings: [],
    languages: [],
    codeDirs: [],
    hasSource: false,
    cappedFolders: [],
    isOverallCapped: false,
    cadre: { dir: 'absent', manifest: null, manifestState: 'absent', state: null, stateState: 'absent' },
    warnings: [],
    ...over,
  }
}

/** The status file autopilot keeps for session s1 of the fixture user. */
export const STATUS_PATH = '/home/u/.claude/autopilot/s1.json'

/** The scans of a run in `world`, gathered as init gathers them; ~/.claude.json is read only when it is allowed. */
export async function scansOf(world: MemWorld, isClaudeJsonAllowed = false): Promise<Gathered> {
  return gatherScans(memIo(world, {}).io, DEFAULT_LOCATIONS, isClaudeJsonAllowed)
}

/**
 * The repo state the init fixtures plan: the built-in default, committed definitions, the git root, cadre 0.2.0 and
 * no consent to read ~/.claude.json.
 */
export function stateOf(roles: readonly RoleSpec[], over: Partial<CadreState> = {}): CadreState {
  return {
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: roles.map(role => role.id),
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
    ...over,
  }
}

/**
 * The files planned for these roles, as given, in `world`: every scope compiled on the state's default and for its
 * launch start (D-122), none attended, from scans that read ~/.claude.json only when the state records the consent
 * (A1). Init always passes repo parts, none here, so every role gets its header-only built CLAUDE.md (02-GAPS-B2 S1);
 * init also records them in role.json (initFiles), which a regen world of a role.json written before the records leaves
 * out.
 */
export async function plannedFiles(
  world: MemWorld,
  roles: readonly RoleSpec[],
  over: Partial<CadreState> = {},
): Promise<DesiredFile[]> {
  const state = stateOf(roles, over)
  const gathered = await scansOf(world, state.readUserMcp)
  const scopes = scopesFor(roles, state.framework, gathered, [], state.launchStart)

  return desiredFiles({ roles, scopes, state, only: null, repoParts: new Map() })
}

/** The text of each file at its absolute path under /repo. */
export function onDisk(files: readonly DesiredFile[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [`/repo/${file.path}`, file.content]))
}

/** The card of a role's compiled scope; a missing scope stops the test with a clear message. */
export function cardOf(scopes: ReadonlyMap<string, CompiledScope>, id: string): ScopeCard {
  const scope = scopes.get(id)
  if (scope === undefined) throw new Error(`no scope for ${id}`)

  return scope.card
}

/** A sha256 in hex for the manifest and state fixtures: 64 times the letter a. */
export const SHA_A = 'a'.repeat(64)

/** BE's role.json as a manifest file entry, recorded with SHA_A. */
export const BE_FILE = { path: '.cadre/be/role.json', sha256: SHA_A, mode: 'file' }

/** A manifest as JSON text with these file entries; `over` replaces or adds top-level fields. */
export function manifestText(files: readonly unknown[], over: Readonly<Record<string, unknown>> = {}): string {
  return JSON.stringify({ schema: 1, cadreVersion: '0.2.0', files, ...over })
}

/** A `.cadre/cadre.json` as JSON text; `over` replaces or adds fields. */
export function stateText(over: Readonly<Record<string, unknown>> = {}): string {
  const state = {
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'gsd',
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }

  return JSON.stringify({ ...state, ...over })
}

/** One backslash, built from its character code so the source holds none. */
export const BACKSLASH = String.fromCharCode(92)

/** A desired file; the mode is a plain file unless it says otherwise. */
export function file(path: string, content: string, mode: FileMode = 'file'): DesiredFile {
  return { path, content, mode }
}

/** The cadre version the fixture plan inputs and manifests carry. */
export const VERSION = '0.2.0'

/** A plain generated file. */
export const A = '.cadre/a.md'

/** No conflict was answered. */
export const NO_CHOICES: ReadonlyMap<string, ConflictChoice> = new Map()

/** A file read through the port: its text. */
export function text(content: string): PortRead {
  return { state: 'text', text: content }
}

/** A plan input with an empty disk, no manifest and no extras; `over` changes the fields it names. */
export function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    desired: [],
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: null,
    hunks: [],
    cadreVersion: VERSION,
    ...over,
  }
}

/** One `kind path` line per step: a compact way to compare the order and the kinds of the steps. */
export function stepLine(step: ApplyStep): string {
  return `${step.kind} ${step.path}`
}

/** The folder of the fixture user's role memory folders in the fixture repo: `<userDir>/cadre/<repo>-<hash8>`. */
export const SLUG_DIR = '/home/u/.claude/cadre/repo-1a2b3c4d'

/** Security's role memory folder (D-140 q2-a). */
export const SECURITY_DIR = `${SLUG_DIR}/security`

/** The Team Lead's role memory folder. */
export const TL_DIR = `${SLUG_DIR}/tl`

/** Security's private text file, in its own instructions/ subfolder on every load path (D-140). */
export const SECURITY_TEXT_FILE = `${SECURITY_DIR}/instructions/CLAUDE.md`

/** Security's hand-out record, beside the memories in its role memory folder (D-140 q2-a). */
export const SECURITY_RECORD = `${SECURITY_DIR}/instructions.json`

/** The plugin key of claude-security in Anthropic's official marketplace (decision #39). */
export const SECURITY_KEY = 'claude-security@claude-plugins-official'

/** The plugin key of security-guidance in Anthropic's official marketplace (decision #39). */
export const GUIDANCE_KEY = 'security-guidance@claude-plugins-official'

/** The launcher of the BE role, an executable file. */
export const LAUNCHER = '.cadre/bin/be'

/** An apply outcome in which nothing was written, failed or refused; `over` changes the fields it names. */
export function outcomeOf(over: Partial<ApplyOutcome> = {}): ApplyOutcome {
  return {
    written: [],
    executable: [],
    failed: [],
    refused: [],
    notExecutable: [],
    chmodRefusals: [],
    hunkFailures: [],
    attended: [],
    installed: [],
    installProblems: [],
    untrackedParts: [],
    privateProblems: [],
    manifestSkipped: false,
    improverWarnings: [],
    improved: null,
    ...over,
  }
}

/** Facts with every list empty. A test sets only the list it reads. */
export function facts(over: Partial<Facts>): Facts {
  return {
    repoEntries: [],
    docsEntries: [],
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: [],
    ...over,
  }
}

/** The branch of that worktree (D-146). */
export const BRANCH = 'epic/proj-1-add-retry'

/** A fake host rule that answers `argv` with this exit code and output; a null exit code is a run the host rejected. */
export function rule(argv: readonly string[], exitCode: number | null, stdout = ''): HostRunRule {
  return { argv, result: exitCode === null ? null : { exitCode, stdout, stderr: '' } }
}

/** The probe of /repo answered as the main checkout: its git dir is the common dir (D-165). */
export const MAIN_CHECKOUT = rule(CHECKOUT_ARGV('/repo'), 0, '/repo/.git\n/repo/.git\n')

/** `claude --version` of a claude new enough for cadre (D-107). */
export const CLAUDE_OK = rule(['claude', '--version'], 0, '2.1.304 (Claude Code)\n')

/** The rules every epic run falls back to, after its own: the main checkout at /repo and a claude new enough. */
export const BASE_RULES: readonly HostRunRule[] = [MAIN_CHECKOUT, CLAUDE_OK]

/**
 * The text of a role's launcher in the epic worlds: launcherRead compares only its sha256 with the manifest, and
 * /cadre epic also wants the line that picks the epic kickoff (D-158).
 */
export function launcherOf(id: string): string {
  const pick = `${RUNTIME_KICKOFF_TEST}"$root"/.cadre/${id}/kickoff.txt; fi`

  return `#!/bin/sh\n# the launcher of role ${id}\n${pick}\nexit 0\n`
}

/** The manifest entry of a role's launcher, holding the sha256 of launcherOf. */
export async function launcherEntry(id: string): Promise<ManifestEntry> {
  return { path: `.cadre/bin/${id}`, sha256: await sha256Hex(launcherOf(id)), mode: 'exec' }
}

/** What runEpic replied, and every write and run the fake host was asked for, in call order. */
export type EpicRun = {
  readonly reply: string
  readonly writes: readonly HostWrite[]
  readonly calls: readonly HostCall[]
  /** Each write as `write <path>` and each run as its argv joined by spaces, in the order of their shared counter. */
  readonly events: readonly string[]
  /** Every question the run asked, and the dialog spec of each, in order. */
  readonly asked: readonly string[]
  readonly specs: readonly AskSpec[]
}

/** What else an epic run is given: the answers to its questions, the host's environment and the `--terminal` value. */
export type EpicExtra = {
  readonly answers?: readonly string[] | Readonly<Record<string, string>>
  readonly env?: HostWorld['env']
  readonly terminal?: Exclude<TerminalChoice, 'none'>
}

/** The fake host of the epic specs and what it was asked: each write and run numbered by one counter they share. */
export type EpicHost = MemHost & {
  /** The counter value of each write, by its index in `writes`. */
  readonly writeAt: readonly number[]
  /** The counter value of each run, by its index in `calls`. */
  readonly callAt: readonly number[]
}

/**
 * The fake host of the epic specs, on top of memHost: these run rules first, then BASE_RULES; any other argv exits 0
 * with no output, and `env` holds the variables that are set. Each write and each run also takes the next value of one
 * counter they share, so a spec can tell whether a file was written before a command ran.
 */
export function epicHost(runs: readonly HostRunRule[], env: HostWorld['env'] = {}): EpicHost {
  const host = memHost(hostWorld({ runs: [...runs, ...BASE_RULES], env }))
  const writeAt: number[] = []
  const callAt: number[] = []
  let counter = 0
  const io: HostIo = {
    write: async (path, text) => {
      writeAt.push(counter)
      counter += 1

      return host.io.write(path, text)
    },
    run: async (argv, options) => {
      callAt.push(counter)
      counter += 1

      return host.io.run(argv, options)
    },
    env: host.io.env,
  }

  return { ...host, io, writeAt, callAt }
}

/** The writes of `host` as `write <path>` and its runs as their argv joined by spaces, in shared-counter order. */
export function eventsOf(host: EpicHost): string[] {
  const writes = host.writes.map((write, index) => ({ at: host.writeAt[index] ?? -1, label: `write ${write.path}` }))
  const calls = host.calls.map((call, index) => ({ at: host.callAt[index] ?? -1, label: call.argv.join(' ') }))

  return [...writes, ...calls].sort((a, b) => a.at - b.at).map(event => event.label)
}

/**
 * runEpic of `key` and `title` (PROJ-1 and Add retry by default) over `world`, with these run rules first and then
 * BASE_RULES; any other argv exits 0 with no output. `extra` gives the answers (none by default, so a question is
 * dismissed), the host's environment and the `--terminal` value (`auto` by default).
 */
export async function epic(
  world: MemWorld,
  runs: readonly HostRunRule[],
  key = 'PROJ-1',
  title = 'Add retry',
  extra: EpicExtra = {},
): Promise<EpicRun> {
  const host = epicHost(runs, extra.env)
  const io = memIo(world, extra.answers ?? {})
  const reply = await runEpic(io.io, host.io, { key, title, terminal: extra.terminal ?? 'auto' })

  return { reply, writes: host.writes, calls: host.calls, events: eventsOf(host), asked: io.asked, specs: io.specs }
}

/** The epic record of PROJ-1 Add retry as a new worktree on a branch of `main` writes it. */
export const RECORD: EpicRecord = {
  schema: 1,
  key: 'PROJ-1',
  slug: 'proj-1-add-retry',
  title: 'Add retry',
  branch: BRANCH,
  base: 'main',
  createdAt: 1_000_000,
  links: [],
  copies: [],
}

/** The worktree `/cadre epic PROJ-1` makes with no title words (D-146), and its git dir (D-164). */
export const BARE_WORKTREE = '/repo/.claude/worktrees/proj-1'

/** Whether any of the lines would read to autopilot as its done marker. */
export function hasDoneLine(lines: string[]): boolean {
  return DONE_MARKER_LINE.test(lines.join('\n'))
}

/** A user-level GSD at ~/.claude/gsd-core whose identity is proven, as detection reports it. */
export const PROVEN_USER_GSD: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** The detect facts of a user whose GSD at ~/.claude/gsd-core is proven, with its raw dir. */
export const PROVEN_FACTS: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [PROVEN_USER_GSD] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

/** The six template roles, as init builds them with nothing assigned. */
export const TEMPLATE_ROLES: readonly RoleSpec[] = ROLE_TEMPLATE.map(row => roleFromTemplate(row))

/**
 * The compiled scope of a role on the merged MCP route, with the whole team for the decision chain; `over` changes the
 * context fields it names.
 */
export function scopeOf(
  role: RoleSpec,
  framework: FrameworkId,
  team: readonly RoleSpec[],
  over: Partial<ScopeContext> = {},
): CompiledScope {
  const ctx: ScopeContext = {
    framework,
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: team,
    ...over,
  }

  return compileScope(role, ctx)
}

/** The text of one desired file; undefined when the path is not desired. */
export function contentOf(files: readonly DesiredFile[], path: string): string | undefined {
  return files.find(file => file.path === path)?.content
}

/** A sentence of the global CLAUDE.md that no file in the repo may hold (T-02-69). */
export const GLOBAL_ONLY_SENTENCE = 'GLOBAL-ONLY-SENTENCE stays out of the repo'

/** The NUL character `git ls-files -z` ends each name with, built at run time. */
export const NUL = String.fromCharCode(0)

/** A role as init builds it: nothing assigned, every other field a default. `over` changes the fields it names. */
export function role(id: string, basedOn: TemplateRoleId | null, over: Partial<RoleSpec> = {}): RoleSpec {
  return {
    id,
    title: id.toUpperCase(),
    purpose: 'p',
    basedOn,
    model: DEFAULT_MODEL,
    effort: DEFAULT_EFFORT,
    permissionMode: DEFAULT_PERMISSION_MODE,
    autopilot: { duration: DEFAULT_DURATION, threshold: AUTOPILOT_THRESHOLD, askUser: false },
    hasBash: true,
    mcp: [],
    skills: [],
    instructions: [],
    carry: EMPTY_CARRY,
    ...over,
  }
}

/** The PM role as init builds it, based on the pm template role. */
export const PM = role('pm', 'pm')

/** The Team Lead role as init builds it, based on the tl template role. */
export const TL = role('tl', 'tl', { title: 'Team Lead' })

/**
 * The plan buildPlan gives for these files when the disk holds nothing, with the ignore block of `policy` and, for a
 * team with a Security role, the security reports line, as init plans the block (decision #39). The `.gitignore` op
 * shows the block lines (PLAN-03), so a block planned without that line would differ.
 */
export async function emptyDiskPlan(
  desired: readonly DesiredFile[],
  policy: GitPolicy,
  hunks: readonly HunkOp[] = [],
  hasSecurityRole = false,
): Promise<Plan> {
  return buildPlan({
    desired,
    disk: new Map(),
    manifest: null,
    manifestState: 'absent',
    carried: [],
    gitignore: { disk: { state: 'absent' }, lines: gitignoreLines(policy, null, hasSecurityRole) },
    hunks,
    cadreVersion: '0.2.0',
  })
}

/** The manifest text a run that generated these files records: their hashes and modes in path order. */
export async function manifestOf(files: readonly DesiredFile[], cadreVersion = '0.2.0'): Promise<string> {
  const entries: ManifestEntry[] = []
  for (const file of files) entries.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })

  return stableJson({ schema: 1, cadreVersion, files: entries.sort((a, b) => compareText(a.path, b.path)) })
}

/** A scan of a TypeScript repo with tests and no frontend: BE is kept with its reason and FE is dropped. */
export const SOURCE_SCAN = repoScan({
  languages: ['TypeScript'],
  hasSource: true,
  findings: [
    { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
  ],
})

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
export function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
}

/** A role with its framework set, as the framework step or an Adjust override sets it. */
export function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** The start of the entry question of the user's own skills (G-02-1b), as an answer key matches it. */
export const OWN_SKILLS_ENTRY_PREFIX = 'How do you want to hand out your own skills'

/** The global CLAUDE.md of the fixture user, which the parts flow reads after a yes (G-02-1f). */
export const GLOBAL_CLAUDE_MD = '/home/u/.claude/CLAUDE.md'

/** The global CLAUDE.md of the parts flow: a Security section and a Git section, as the plan's dry run has it. */
export const PARTS_GLOBAL = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

/** The model's grouping of PARTS_GLOBAL: P1 in T1 'Security rules' and P2 in T2 'Git and commits'. */
export const PARTS_TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
  ],
})

/** The model's recommendation of the plan's dry run: T1 to security and T2 to tl, and no memory. */
export const PARTS_RECOMMEND_REPLY = '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{}}'

/**
 * A git repo whose user has PARTS_GLOBAL as the global CLAUDE.md, with the grouping and the recommendation replies in
 * that order; `over` changes the fields it names.
 */
export function partsWorld(over: Partial<MemWorld> = {}): MemWorld {
  const replies = [PARTS_TOPICS_REPLY, PARTS_RECOMMEND_REPLY]

  return gitWorld({ files: { [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL }, replies, ...over })
}

/** The start of the improver install question, which a parts hand-out with a built part asks (G-02-1f, D-141). */
export const IMPROVER_INSTALL_PREFIX = 'Install claude-md-management'

/**
 * INIT_ANSWERS with the content consent answered Yes, the entry question Accept recommendations, and the improver
 * install question Not now, so a run whose user lacks claude-md-management runs no improver (D-141).
 */
export const PARTS_ANSWERS: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  [CONTENT_QUESTION]: 'Yes, read them',
  [INSTRUCTIONS_ENTRY_QUESTION]: 'Accept recommendations',
  [IMPROVER_INSTALL_PREFIX]: 'Not now',
}

/** A sentence of the global CLAUDE.md that must never be shown, asked or logged (T-02-61). */
export const GLOBAL_SENTENCE = 'LEAKY-GLOBAL-SENTENCE stays with the model'

/** A sentence of the repo CLAUDE.md that must never be shown, asked or logged (T-02-61). */
export const REPO_SENTENCE = 'LEAKY-REPO-SENTENCE stays with the model'

/** One CLAUDE.md of the chain as `$.fs.ancestors` gives it: its folder, its name and its text, which the scan drops. */
export function ancestor(dir: string): Readonly<Record<string, unknown>> {
  return { dir, name: 'CLAUDE.md', content: REPO_SENTENCE, parts: [] }
}

/** The auto-memory folder of the fixture repo for the fixture user (G-02-1f Memories). */
export const MEMORY_DIR = '/home/u/.claude/projects/-repo/memory'

/** A sentence of a memory, and of MEMORY.md off its index lines, that is never shown or sent anywhere (T-02-64). */
export const MEMORY_SENTENCE = 'LEAKY-MEMORY-SENTENCE stays on disk'

/** The MEMORY.md of memoriesWorld: an index line for squad.md only, then a line that is no index line. */
export const MEMORY_INDEX =
  `# Memory index\n- [Squad commits](squad.md) \u2014 Unsigned commits on per-phase branches.\n${MEMORY_SENTENCE}\n`

/**
 * partsWorld with the auto-memories squad.md, which MEMORY.md sums up, and workflow.md, which it does not; the
 * recommendation gives squad.md to the Team Lead and workflow.md to no role. `over` changes the fields it names.
 */
export function memoriesWorld(over: Partial<MemWorld> = {}): MemWorld {
  return partsWorld({
    dirs: {
      '/repo/.git': [],
      ...USER_DIR_LISTED,
      [MEMORY_DIR]: [entry('MEMORY.md'), entry('squad.md'), entry('workflow.md')],
    },
    files: {
      [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
      [`${MEMORY_DIR}/workflow.md`]: `${MEMORY_SENTENCE} (workflow)`,
    },
    replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{"M1":["tl"],"M2":[]}}'],
    ...over,
  })
}

/** The sentence of the root CLAUDE.md's Rules section, which init writes into the built file of the role given it. */
export const BUILT_RULE = 'Run the tests before a commit.'

/** The folders and files of a repo whose scan proposes all six template roles: React and TypeScript with tests. */
export const FULL_DIRS = {
  '/repo': [entry('package.json'), entry('src', 'dir')],
  '/repo/src': [entry('a.ts'), entry('a.test.ts')],
}

/** The package.json of FULL_DIRS: React is a dependency, so FE is kept. */
export const FULL_FILES = { '/repo/package.json': '{"dependencies":{"react":"18.0.0"}}' }

/**
 * The six-role repo of fullWorld whose user has a global Security section and whose root CLAUDE.md, in the chain, has a
 * Rules section; the model groups them into T1 'Security rules' (global) and T2 'Repo rules' (repo) and recommends T1
 * to security and T2 to be (G-02-1f Storage split). `over` changes the fields it names.
 */
export function builtWorld(over: Partial<MemWorld> = {}): MemWorld {
  const topics = [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
  ]

  return gitWorld({
    dirs: { '/repo/.git': [], ...USER_DIR_LISTED, ...FULL_DIRS },
    files: {
      ...FULL_FILES,
      [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
      '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n`,
    },
    ancestors: [ancestor('/repo')],
    replies: [JSON.stringify({ topics }), '{"topics":{"T1":["security"],"T2":["be"]},"memories":{}}'],
    ...over,
  })
}

/** The Rules section of the root CLAUDE.md in the regen cases (G-02-1f Regen). */
export const RULES_SECTION = '# Rules\nRun the tests.\n'

/** The Git section of the root CLAUDE.md, the one part BE was given (G-02-1f Regen). */
export const GIT_SECTION = '## Git\nUse signed commits.\n'

/** A repo part of the root CLAUDE.md with this id, heading and text, hashed as the read hashes it. */
export async function rootPart(id: string, heading: string, text: string): Promise<InstructionPart> {
  return { id, file: 'CLAUDE.md', heading, source: 'repo', text, hash: await sha256Hex(text) }
}

/** What a role's records keep of a part: its file, heading and hash (G-02-1f Regen). */
export function recorded(part: Pick<InstructionPart, 'file' | 'heading' | 'hash'>): PartRecord {
  return { file: part.file, heading: part.heading, hash: part.hash }
}

/** The regen fixture: the root CLAUDE.md now, the world fields to change, and BE's given and not-given parts. */
export type RegenFixture = {
  readonly claudeMd?: string | null
  readonly over?: Partial<MemWorld>
  readonly given?: readonly InstructionPart[]
  readonly notGiven?: readonly InstructionPart[]
}

/**
 * The repo after an init that gave BE the parts `given` of the root CLAUDE.md, the Git section unless told otherwise,
 * and recorded `notGiven`, the Rules section, as not given (AUTO-PICK #19 Q1); PM was given no part. Every file init
 * wrote is on the disk with its manifest, BE's built CLAUDE.md holding its parts, and `claudeMd` is the root CLAUDE.md
 * now (none for null). The repo root lists, so the scans warn about nothing. `over` changes the fields it names; its
 * files and folders are kept beside these.
 */
export async function regenPartsWorld(fixture: RegenFixture = {}): Promise<MemWorld> {
  const over = fixture.over ?? {}
  const given = fixture.given ?? [await rootPart('P2', 'Git', GIT_SECTION)]
  const notGiven = fixture.notGiven ?? [await rootPart('P1', 'Rules', RULES_SECTION)]
  const records = { instructionParts: given.map(recorded), instructionPartsNotGiven: notGiven.map(recorded) }
  const be = templateRole('be', records)
  const roles = [be, templateRole('pm', { instructionParts: [] })]
  const dirs = { '/repo/.git': [], ...USER_DIR_LISTED, '/repo': [], '/repo/.cadre': [], ...over.dirs }
  const base = gitWorld({ ...over, dirs })
  const state = stateOf(roles)
  const scopes = scopesFor(roles, state.framework, await scansOf(base), [], state.launchStart)
  const files = desiredFiles({ roles, scopes, state, only: null, repoParts: new Map([['be', given]]) })
  const claudeMd = fixture.claudeMd === undefined ? `${RULES_SECTION}${GIT_SECTION}` : fixture.claudeMd
  const root = claudeMd === null ? {} : { '/repo/CLAUDE.md': claudeMd }

  return {
    ...base,
    files: { ...base.files, ...onDisk(files), '/repo/.cadre/manifest.json': await manifestOf(files), ...root },
  }
}

/** Both security plugin keys, in the order init asks about and installs them (decision #39). */
export const SECURITY_KEYS = [SECURITY_KEY, GUIDANCE_KEY]

/** A scan of a TypeScript repo with a React frontend and tests, so the template proposes all six roles. */
export const FULL_SCAN = repoScan({
  languages: ['TypeScript'],
  hasSource: true,
  findings: [
    { kind: 'fe', label: 'react', evidence: 'package.json' },
    { kind: 'lang', label: 'JavaScript/TypeScript (package.json)', evidence: 'package.json' },
    { kind: 'test', label: 'JS/TS test files', evidence: 'src/a.test.ts' },
  ],
})

/** The role with this id in what a step gave; a missing role stops the test with a clear message. */
export function roleIn(roles: readonly RoleSpec[] | null, id: string): RoleSpec {
  const found = roles?.find(role => role.id === id)
  if (found === undefined) throw new Error(`no role ${id}`)

  return found
}

/** The auto-memory folder of the fixture repo for the fixture user. */
export const MEMORY = '/home/u/.claude/projects/-repo/memory'

/** A memory with this id, file and summary, from the memory folder of the repo. */
export function memory(id: string, file: string, summary: string): MemoryItem {
  return { id, file, folder: MEMORY, summary, hash: `hash of ${file}` }
}

/** Two memories: squad.md with its index summary, and workflow.md with none. */
export const MEMORIES: readonly MemoryItem[] = [
  memory('M1', 'squad.md', 'Unsigned commits on per-phase branches.'),
  memory('M2', 'workflow.md', 'No summary in MEMORY.md.'),
]

/** The first topic of the plan's dry run: the Security part. */
export const SECURITY_TOPIC: InstructionTopic = {
  id: 'T1',
  title: 'Security rules',
  summary: 'How secrets stay out of the repo.',
  partIds: ['P1'],
}

/** The second topic of the plan's dry run: the Git part. */
export const GIT_TOPIC: InstructionTopic = {
  id: 'T2',
  title: 'Git and commits',
  summary: 'How commits are made.',
  partIds: ['P2'],
}

/** The two topics of the plan's dry run, one per part. */
export const TOPICS: readonly InstructionTopic[] = [SECURITY_TOPIC, GIT_TOPIC]

/** T1 recommended to Security and T2 to the Team Lead, as the plan's dry run has it. */
export const RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
  ['T1', ['security']],
  ['T2', ['tl']],
])

/** The fixture hash: the 8 characters the memory slug shows, then 56 zeros. */
export const HASH = `1a2b3c4d${'0'.repeat(56)}`

/** A scope context for the GSD framework and the merged MCP route; `over` changes the fields it names. */
export function context(over: Partial<ScopeContext> = {}): ScopeContext {
  return {
    framework: 'gsd',
    setup: emptySetupScan(),
    codeDirs: [],
    isAttended: false,
    mcpRoute: 'merged',
    launchStart: { kind: 'git-root' },
    roles: ['pm', 'tl'],
    ...over,
  }
}

/** The user's secret guard hook and the context monitor, as the launch collects them from the user's settings. */
export const USER_HOOKS = [
  {
    event: 'PreToolUse',
    script: 'gsd-secret-read-guard.js',
    command: 'node /home/u/.claude/hooks/gsd-secret-read-guard.js',
    matcher: null,
    timeout: null,
  },
  {
    event: 'PostToolUse',
    script: 'gsd-context-monitor.js',
    command: 'node /home/u/m.js',
    matcher: null,
    timeout: null,
  },
]

/** The skills every role on GSD has in its overlay: the handoff skills and the start skills of GSD. */
export const GSD_SKILLS: readonly string[] = [...INFRA_SKILLS, ...adapterOf('gsd').startSkills]

/** The absolute path prefixes (`/repo/cadre/`) that the exact Read and Edit denies cover. */
export function coveredPrefixes(deny: readonly string[]): string[] {
  return deny.flatMap(entry => {
    const path = /^(?:Read|Edit)\(\/(\/.+)\/\*\*\)$/.exec(entry)?.[1]

    return path === undefined ? [] : [`${path}/`]
  })
}

/** The CLAUDE.md files the engine loads for the fixture repo: its own, the one in `.claude` and an ancestor's. */
export const CHAIN = ['/repo/CLAUDE.md', '/repo/.claude/CLAUDE.md', '/home/u/work/CLAUDE.md']

/** Whether a value is a list of strings. */
export function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

/** The deny list of rendered settings; empty when they hold none. */
export function denyOf(settings: Readonly<Record<string, unknown>>): string[] {
  const permissions = settings.permissions
  if (!isObject(permissions)) return []
  const deny = permissions.deny

  return isStringList(deny) ? deny : []
}

/** The template keys of rendered settings, as the ISO-04 checker reads them; null when one has the wrong shape. */
export function templateOf(settings: Readonly<Record<string, unknown>>, scope: CompiledScope): SettingsTemplate | null {
  const { enabledPlugins, permissions, sandbox } = settings
  if (!isObject(enabledPlugins) || !isObject(permissions) || !isObject(sandbox)) return null
  const deny = permissions.deny
  const enabled = sandbox.enabled
  if (!isStringList(deny) || typeof enabled !== 'boolean') return null
  const entries = Object.entries(enabledPlugins)
  const flags = entries.filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
  if (flags.length !== entries.length) return null

  return {
    enabledPlugins: Object.fromEntries(flags),
    permissions: { defaultMode: scope.settings.permissions.defaultMode, deny },
    sandbox: { enabled },
  }
}

/** The command of the context monitor among the user's hooks, which no plan may render (D-62). */
export const MONITOR_COMMAND = '/home/u/m.js'

/** Whether the plan renders the context monitor hook, which no plan may (D-62). */
export function isMonitorRendered(plan: LaunchPlan): boolean {
  return JSON.stringify(plan.settings.hooks ?? null).includes(MONITOR_COMMAND)
}

/** Whether a path has a `..` segment. */
export function hasDotDot(path: string): boolean {
  return path.split('/').includes('..')
}

/**
 * Every problem one launch plan has, as messages (empty when none): a link outside `<root>/.cadre/<id>/.runtime/`, a
 * link with a `..` segment or a relative target, a link planned twice, a settings key outside RUNTIME_SETTINGS_KEYS, an
 * env name the role does not carry, a deny the runtime lint refuses, an exact deny that covers an own folder of the
 * role, a secret fixture anywhere in the plan, the context monitor hook (D-62), an infra violation in the template keys
 * of the runtime settings (D-77), and a warning (the user of the matrix has everything, so none is expected).
 */
export function launchProblems(
  plan: LaunchPlan,
  role: RoleSpec,
  scope: CompiledScope,
  framework: FrameworkId,
): string[] {
  const runtime = `/repo/.cadre/${role.id}/.runtime/`
  const deny = denyOf(plan.settings)
  const covered = coveredPrefixes(deny).map(prefix => prefix.toLowerCase())
  const own = roleOwnPaths(role.id).map(path => `/repo/${path}`)
  const template = templateOf(plan.settings, scope)
  const env = isObject(plan.settings.env) ? Object.keys(plan.settings.env) : []
  const paths = plan.links.map(link => link.path)

  return [
    ...paths.filter(path => !path.startsWith(runtime)).map(path => `link ${path} is outside ${runtime}`),
    ...plan.links
      .filter(link => hasDotDot(link.path) || hasDotDot(link.target) || !link.target.startsWith('/'))
      .map(link => `link ${link.path} has a .. segment or a relative target`),
    ...paths.filter((path, index) => paths.indexOf(path) !== index).map(path => `link ${path} is planned twice`),
    ...Object.keys(plan.settings)
      .filter(key => !RUNTIME_SETTINGS_KEYS.includes(key))
      .map(key => `settings key ${key} is not allowed`),
    ...env.filter(name => !role.carry.env.includes(name)).map(name => `env ${name} is not carried by the role`),
    ...deny.flatMap(entry => {
      const message = lintRuntimeDenyPattern(entry)

      return message === null ? [] : [`deny ${entry} fails the lint: ${message}`]
    }),
    ...own.flatMap(path =>
      covered.filter(prefix => path.toLowerCase().startsWith(prefix)).map(prefix => `deny covers ${prefix} of ${path}`),
    ),
    ...leaks(JSON.stringify(plan), SECRET_FIXTURES).map(secret => `the plan holds the secret ${secret}`),
    ...(isMonitorRendered(plan) ? ['the context monitor hook is rendered'] : []),
    ...(template === null
      ? ['the runtime settings do not hold the template keys']
      : infraViolations({ ...scope, settings: template }, framework)),
    ...plan.warnings.map(warning => `warning: ${warning}`),
  ]
}

/** The scope with one more deny entry; the compiled value is never changed. */
export function withDeny(scope: CompiledScope, entry: string): CompiledScope {
  const permissions = { ...scope.settings.permissions, deny: [...scope.settings.permissions.deny, entry] }

  return { ...scope, settings: { ...scope.settings, permissions } }
}

/** The repo path of BE's role.json. */
export const ROLE = '.cadre/be/role.json'

/** The gsd-tools command the GSD hunk fixtures run. */
export const GSD_TOOLS = 'node ~/.claude/gsd-core/bin/gsd-tools.cjs'

/** A required, accepted, runnable hunk, as 02-08 builds one for the GSD mode setting. */
export const HUNK: HunkOp = {
  kind: 'hunk',
  file: '.planning/config.json',
  key: 'mode',
  before: 'interactive',
  after: 'yolo',
  isRequired: true,
  isAccepted: true,
  isRunnable: true,
  command: `${GSD_TOOLS} config-set mode yolo`,
}

/** The template row with this id; a test that names a missing row fails here, loudly. */
export function row(id: TemplateRoleId): TemplateRole {
  const found = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no template row ${id}`)

  return found
}

/** The template ids in template order, which every proposal and its change list must keep. */
export const TEMPLATE_ORDER: readonly TemplateRoleId[] = ['pm', 'tl', 'be', 'fe', 'qa', 'security']

/** The rule every slug message ends with. */
export const SLUG_RULE = 'must be a lowercase slug: a letter, then letters, digits or dashes, 24 characters at most'

/** The message for an id that is not a slug, with the id as the message shows it. */
export function slugMessage(label: string): string {
  return `role id "${label}" ${SLUG_RULE}`
}

/** The finding of a kind and label, or undefined. */
export function findingOf(scan: RepoScan, kind: ScanKind, label: string): ScanFinding | undefined {
  return scan.findings.find(finding => finding.kind === kind && finding.label === label)
}

/** The session of the fixtures: the repo /repo of a user whose home is /home/u, with no CLAUDE_CONFIG_DIR. */
export const CTX: SetupContext = { root: '/repo', givenRoot: '/repo', home: '/home/u', configDir: null }

/** A scan and the paths it read through the port, in order. */
export type ScanRun = {
  readonly scan: SetupScan
  readonly reads: readonly string[]
}

/** A scan of `world` as the person at `ctx` gets it, with the paths it read. */
export async function runOf(world: MemWorld, isClaudeJsonAllowed = false, ctx: SetupContext = CTX): Promise<ScanRun> {
  const run = memIo(world, [])
  const scan = await scanSetup(run.io, ctx, isClaudeJsonAllowed)

  return { scan, reads: run.reads }
}

/** A hook script the settings of `source` register, the user settings unless named. */
export function hook(script: string, source: SettingsSource = 'user'): HookScript {
  return { script, event: 'PostToolUse', source }
}

/** The repo root of the fixtures, a realpath. */
export const ROOT = '/repo'

/** The team of the cases: PM, Team Lead and Security, in that order. */
export const ROLES = [templateRole('pm'), templateRole('tl'), templateRole('security')]

/** A reply parsed, or the errors of one that was not. */
export type Parsed = { readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** The errors of an invalid reply; [] for a reply that parsed. */
export function errorsOf(result: Parsed): readonly string[] {
  return result.kind === 'invalid' ? result.errors : []
}

/**
 * An init state at `stage`, before the stage is entered (D-230): its cursor at start, `draft` as given, nothing to
 * show, an end effect standing in for the one the stage sets, no open question, no go-back, no review round, a dry
 * run; `over` replaces any of these.
 */
export function stateAt(stage: InitStage, draft: Partial<Draft> = {}, over: Partial<InitState> = {}): InitState {
  return {
    stage,
    sub: { kind: 'start' },
    draft,
    outputs: [],
    effect: { kind: 'end', reply: '' },
    openQuestion: null,
    returnTo: null,
    returnAfter: null,
    rounds: 0,
    kept: null,
    toolNames: [],
    dryRun: true,
    ...over,
  }
}

/**
 * A whole init draft of a dry run over the testkit repo (D-230): the template team of an empty repo scan on the
 * built-in default, nothing handed out or installed, the default git policy and the git root as the launcher start;
 * `over` replaces any field.
 */
export function wholeDraft(over: Partial<Draft> = {}): Draft {
  return {
    locations: DEFAULT_LOCATIONS,
    gathered: { facts: { facts: EMPTY_FACTS, gsdUserDir: null }, repo: repoScan(), setup: emptySetupScan() },
    readUserMcp: false,
    installed: ['none'],
    choice: { kind: 'none' },
    proposal: proposeRoles(repoScan()),
    hints: new Map(),
    duration: DEFAULT_DURATION,
    roles: proposeRoles(repoScan()).roles,
    changes: [],
    repoDefault: 'none',
    hunks: [],
    pluginInstalls: [],
    instructions: { kind: 'none' },
    policy: 'definitions',
    launchStart: { kind: 'git-root' },
    ...over,
  }
}

/**
 * What a drive through the init machine gave: the state it stopped at, each question and spec asked, every output, and
 * every host operation the stage set, the one it stopped at included.
 */
export type Driven = {
  readonly state: InitState
  readonly asked: string[]
  readonly specs: AskSpec[]
  readonly outputs: Output[]
  readonly calls: IoCall[]
}

/**
 * The state after `answer`, as nextStage gives it, with the outputs init/run shows for the stage that took it: once the
 * run moved on to another stage, only that stage's own outputs, not the ones the next stage set on entering (D-230).
 */
function answered(state: InitState, answer: Answer): { readonly next: InitState; readonly shown: readonly Output[] } {
  const asking: InitState = { ...state, outputs: [] }
  const next = nextStage(asking, answer)
  const isMovedOn = next.stage !== state.stage && next.effect.kind !== 'end'

  return { next, shown: isMovedOn ? STAGES[state.stage].answer(asking, answer).outputs : next.outputs }
}

/**
 * Drives the init machine through nextStage from `state`, a stage already entered, as init/run would (D-230), until
 * the run leaves that stage, ends, or has an effect with no scripted answer left: each ask gets the next of `answers`
 * (null, or none left, is a dismissal, as memIo rejects), and any other effect the next of `results`. It records each
 * question and spec asked, the outputs shown while the run is in that stage (answered), and every host operation, in
 * order.
 */
export function driven(
  state: InitState,
  answers: readonly (string | null)[],
  results: readonly Answer[] = [],
): Driven {
  const asked: string[] = []
  const specs: AskSpec[] = []
  const outputs: Output[] = [...state.outputs]
  const calls: IoCall[] = []
  const stops = ['done', 'cancelled', 'end', 'failed']
  let current = state
  let nextAnswer = 0
  let nextResult = 0
  for (;;) {
    const { effect } = current
    const isStopped = current.stage !== state.stage || effect.kind === 'end' || stops.includes(current.sub.kind)
    if (isStopped) return { state: current, asked, specs, outputs, calls }
    if (effect.kind === 'ask') {
      asked.push(effect.question)
      specs.push(effect.spec)
      const text = answers[nextAnswer] ?? null
      nextAnswer += 1
      const step = answered(current, { kind: 'answer', text })
      outputs.push(...step.shown)
      current = step.next
      continue
    }
    if (effect.kind === 'io') calls.push(effect.call)
    const result = results[nextResult]
    if (result === undefined) return { state: current, asked, specs, outputs, calls }
    nextResult += 1
    const step = answered(current, result)
    outputs.push(...step.shown)
    current = step.next
  }
}

/**
 * driven, with each host operation performed by `perform` (the helper init/run runs for it, over a scripted port), so
 * a spec of a pure stage can read what the port was asked (D-230). It stops where driven stops, and also at a model
 * call.
 */
export async function drivenWith(
  state: InitState,
  answers: readonly (string | null)[],
  perform: (call: IoCall) => Promise<IoResult>,
): Promise<Driven> {
  const asked: string[] = []
  const specs: AskSpec[] = []
  const outputs: Output[] = [...state.outputs]
  const calls: IoCall[] = []
  const stops = ['done', 'cancelled', 'end', 'failed']
  let current = state
  let nextAnswer = 0
  for (;;) {
    const { effect } = current
    const isStopped = current.stage !== state.stage || effect.kind === 'end' || stops.includes(current.sub.kind)
    const isOwn = effect.kind === 'ask' || effect.kind === 'io'
    if (isStopped || !isOwn) return { state: current, asked, specs, outputs, calls }
    if (effect.kind === 'ask') {
      asked.push(effect.question)
      specs.push(effect.spec)
      const text = answers[nextAnswer] ?? null
      nextAnswer += 1
      const step = answered(current, { kind: 'answer', text })
      outputs.push(...step.shown)
      current = step.next
      continue
    }
    calls.push(effect.call)
    const step = answered(current, { kind: 'io', result: await perform(effect.call) })
    outputs.push(...step.shown)
    current = step.next
  }
}

/** The cursors a stage ends on (D-230): done, cancelled, ended, failed, or a go-back to another stage. */
const STAGE_ENDS: readonly string[] = Object.freeze(['done', 'cancelled', 'end', 'failed', 'back'])

/**
 * Runs one stage of init over the port `io` as init/run performs it (D-230): `def` enters `state`, then each state's
 * outputs are shown and its effect performed with init/run's own showOutput and perform, as a dry run, until the stage
 * ends (done, cancelled, ended, failed or going back); no other stage is entered. So a spec of a stage sees what the
 * stage asked, showed, logged and called as its async step did, and reads its result from the state's draft or its
 * cancel reason.
 */
export async function stageRun(io: InitIo, def: StageDef, state: InitState): Promise<InitState> {
  let current = def.enter(state)
  for (;;) {
    for (const output of current.outputs) await showOutput(io, output)
    const { effect } = current
    if (STAGE_ENDS.includes(current.sub.kind) || effect.kind === 'end') return { ...current, outputs: [] }
    current = def.answer({ ...current, outputs: [] }, await perform(io, { dryRun: true }, effect))
  }
}

/**
 * stageRun as the stage's async step gave its result (D-230): accepted with what `pick` reads from the draft of a done
 * stage, or cancelled with the stage's reason; a stage that stops anywhere else fails the spec.
 */
export async function stageStep<T>(
  io: InitIo,
  def: StageDef,
  state: InitState,
  pick: (draft: Partial<Draft>) => T | undefined,
): Promise<StepResult<T>> {
  const end = await stageRun(io, def, state)
  if (end.sub.kind === 'cancelled') return { kind: 'cancelled', reason: end.sub.reason }
  const value = end.sub.kind === 'done' ? pick(end.draft) : undefined
  if (value === undefined) throw new Error(`the ${state.stage} stage stopped at ${end.sub.kind}`)

  return { kind: 'accepted', value }
}
