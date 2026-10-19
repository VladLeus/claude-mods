import type {
  AskSpec,
  Facts,
  FrameworkId,
  InitFacts,
  InitIo,
  InitLocations,
  McpRef,
  PortEntry,
  PortRead,
  PortStat,
  RoleSpec,
  SettingsSource,
  SetupScan,
  SkillRef,
  TemplateRoleId,
} from '../types'
import { utf8Bytes } from './facts'
import { ROLE_TEMPLATE, roleFromTemplate } from './roles'

/**
 * Support for the Phase 2 tests, not a test itself: it is deliberately not named `*.test.ts`, so `claude plugin test`
 * does not run it, and `npm run typecheck:cadre` checks it. It gives a pure test a scripted InitIo: answers in order
 * or by question, a rejection when the answers run out, files and folders in memory, tri-state reads, and the
 * secret and absolute-path fixtures the property tests scan for.
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
 */
export function memIo(world: MemWorld, answers: readonly string[] | Readonly<Record<string, string>>): MemRun {
  const asked: string[] = []
  const specs: AskSpec[] = []
  const logged: string[] = []
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
    read: async (path, maxBytes) => {
      reads.push(path)

      return readOf(world, path, maxBytes)
    },
    ancestors: async () => world.ancestors,
    settings: async source => world.settings[source] ?? null,
    commands: async () => world.commands,
    tools: async () => world.tools,
  }

  return { io, asked, specs, logged, prompts, reads, listed }
}

/** A listing entry as the port gives it: a file unless told otherwise, and not a link unless told so. */
export function entry(name: string, kind: PortEntry['kind'] = 'file', isLink = false): PortEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink }
}

/** A symbolic link as the host lists it: kind other, isLink true. */
export function link(name: string): PortEntry {
  return entry(name, 'other', true)
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
