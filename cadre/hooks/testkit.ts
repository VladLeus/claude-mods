import type {
  AskSpec,
  CadreState,
  CompiledScope,
  DesiredFile,
  EpicRecord,
  Facts,
  FileMode,
  FrameworkId,
  HostEnvName,
  HostIo,
  HostRun,
  InitFacts,
  InitIo,
  InitLocations,
  ManifestEntry,
  McpRef,
  PaneKey,
  PortEntry,
  PortRead,
  PortStat,
  RepoScan,
  RoleSpec,
  RunOptions,
  ScopeCard,
  SettingsSource,
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
import { utf8Bytes } from './core/text'
import { runEpic } from './epic/create'
import { desiredFiles } from './generate/files'
import { RUNTIME_KICKOFF_TEST } from './generate/launcher'
import { CHECKOUT_ARGV } from './git/checkout'
import type { PlanInput } from './plan/plan'
import { ROLE_TEMPLATE, roleFromTemplate } from './roles/template'
import { gatherScans } from './scan/gather'
import type { Gathered } from './scan/gather'
import { scopesFor } from './team'

/**
 * Support for the Phase 2 tests, not a test itself: it is deliberately not named `*.test.ts`, so `claude plugin test`
 * does not run it, and `npm run typecheck:cadre` checks it. It gives a pure test a scripted InitIo: answers in order
 * or by question, a rejection when the answers run out, files and folders in memory, tri-state reads, and the
 * secret and absolute-path fixtures the property tests scan for. It also gives the Phase 3 tests a scripted HostIo
 * that records every write and run in call order and answers each from a HostWorld.
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

  return { io, asked, specs, logged, shown, prompts, reads, listed }
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
