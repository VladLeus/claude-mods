import type {
  AskSpec,
  Facts,
  InitFacts,
  InitIo,
  InitLocations,
  PortEntry,
  PortRead,
  PortStat,
  SettingsSource,
} from '../types'

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

/** A scripted port and what it was asked, in order: every question and spec, line logged, prompt and path read. */
export type MemRun = {
  readonly io: InitIo
  /** Every question asked, the dismissed ones included. */
  readonly asked: string[]
  readonly specs: AskSpec[]
  readonly logged: string[]
  /** Every completion asked, as `${system}\n---\n${prompt}`. */
  readonly prompts: string[]
  readonly reads: string[]
}

/** Whether scripted answers are given in order, rather than by question prefix. */
function isScript(answers: readonly string[] | Readonly<Record<string, string>>): answers is readonly string[] {
  return Array.isArray(answers)
}

/** The value of the longest key the question starts with; undefined when no key matches. */
function answerFor(answers: Readonly<Record<string, string>>, question: string): string | undefined {
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

/** A path's stat: a file with its length as size, a listed folder, else null. Text length stands in for bytes. */
function statOf(world: MemWorld, path: string): PortStat | null {
  if (world.unknownPaths.includes(path)) return null
  const realPath = own(world.realPaths, path) ?? path
  const text = own(world.files, path)
  if (text !== undefined) return { kind: 'file', size: text.length, isLink: false, realPath }
  if (own(world.dirs, path) !== undefined) return { kind: 'dir', size: 0, isLink: false, realPath }

  return null
}

/** A path read: unknown first, then absent, then too-large over `maxBytes`, else the text. Text length is bytes. */
function readOf(world: MemWorld, path: string, maxBytes: number): PortRead {
  if (world.unknownPaths.includes(path)) return { state: 'unknown' }
  const text = own(world.files, path)
  if (text === undefined) return { state: 'absent' }
  if (text.length > maxBytes) return { state: 'too-large', bytes: text.length }

  return { state: 'text', text }
}

/**
 * A port over `world` that records what it is asked. With an array of `answers`, `ask` answers in order and rejects
 * with `dismissed` when they run out. With a record, `ask` answers with the value of the longest key the question
 * starts with and rejects with `dismissed` when no key does, so a flow test survives a new question. Text length
 * stands in for bytes, because the tests use ASCII.
 */
export function memIo(world: MemWorld, answers: readonly string[] | Readonly<Record<string, string>>): MemRun {
  const asked: string[] = []
  const specs: AskSpec[] = []
  const logged: string[] = []
  const prompts: string[] = []
  const reads: string[] = []
  let nextAnswer = 0
  let nextReply = 0

  const io: InitIo = {
    ask: async (question, spec) => {
      asked.push(question)
      specs.push(spec)
      const answer = isScript(answers) ? answers[nextAnswer] : answerFor(answers, question)
      nextAnswer += 1
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
    list: async path => listOf(world, path),
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

  return { io, asked, specs, logged, prompts, reads }
}

/** Fake secrets no output, question, log line or generated file may contain. */
export const SECRET_FIXTURES: readonly string[] = Object.freeze([
  'sk-FAKE-SECRET-0123456789',
  'Bearer FAKE-TOKEN-0123',
  'ghp_FAKEFAKEFAKEFAKEFAKE',
  'SENTINEL_SECRET_VALUE',
])

/** Absolute-path markers no generated file may contain, the fixture home `/home/u` included (PLAN-05). */
export const ABSOLUTE_PATH_MARKERS: readonly string[] = Object.freeze(['/Users/', '/home/', '/private/', '/home/u'])

/** The needles found in the text, in needle order; empty when the text is clean. */
export function leaks(text: string, needles: readonly string[]): string[] {
  return needles.filter(needle => text.includes(needle))
}
