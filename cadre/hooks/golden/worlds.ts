/**
 * The worlds of the golden suite (D-219), each with the answers its init run is given, and the desiredFiles inputs:
 * test support, not a test itself. The fixture constants and builders below are copied byte-identically from
 * init.test.ts and generate.test.ts (only `export` added where a golden module needs one), so a golden runs the world
 * its source spec runs. Only the golden modules import it.
 */
import type {
  CadreState,
  CompiledScope,
  DesiredFile,
  EpicRecord,
  Facts,
  FrameworkId,
  GsdFact,
  HostRun,
  InitFacts,
  InitIo,
  InitLocations,
  LaunchStart,
  ManifestEntry,
  PortEntry,
  RawFacts,
  RoleSpec,
  ScopeContext,
} from '../../types'
import { sha256Hex } from '../core/hash'
import { stableJson } from '../core/json'
import { compareText } from '../core/text'
import {
  EPIC_RECORD_FILE,
  epicRecordText,
  GIT_DIR_ARGV,
  LS_IGNORED_ARGV,
  MERGED_ARGV,
  STATUS_ARGV,
  WORKTREE_LIST_ARGV,
} from '../epic'
import type { ProbedGsdCandidate } from '../framework/gsd/identity'
import { RUNTIME_KICKOFF_TEST } from '../generate'
import { cadreJsonText, roleJsonText } from '../generate/docs'
import { desiredFiles } from '../generate/files'
import type { GenerateInput } from '../generate/files'
import { CHECKOUT_ARGV } from '../git/checkout'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import { CONTENT_QUESTION, INSTRUCTIONS_ENTRY_QUESTION } from '../instructions'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles/template'
import { gatherScans } from '../scan/gather'
import type { Gathered } from '../scan/gather'
import { compileScope } from '../scope/compile'
import { titleGrepArgv } from '../status'
import { scopesFor } from '../team'
import {
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  entryAt,
  gitWorld,
  INIT_ANSWERS,
  link,
  memIo,
  memWorld,
  secretUserSettings,
  secretWorld,
  templateRole,
  USER_DIR_LISTED,
} from '../testkit'
import type { HostRunRule, MemRun, MemWorld } from '../testkit'

/** The status file autopilot keeps for session s1 of the fixture user. */
export const STATUS_PATH = '/home/u/.claude/autopilot/s1.json'

/**
 * INIT_ANSWERS with the content consent of the instruction parts declined (G-02-1f), so a dry run in a world with a
 * CLAUDE.md or a memory asks the whole-file questions of D-63, as it did before the consent.
 */
const PARTS_DECLINED: Readonly<Record<string, string>> = { ...INIT_ANSWERS, [CONTENT_QUESTION]: 'No, skip it' }

/** Facts where GSD (.planning/) and superpowers (docs/superpowers/) are both in use, so the choice is ambiguous. */
const AMBIGUOUS_FACTS: Facts = {
  ...EMPTY_FACTS,
  repoEntries: [
    { name: '.planning', kind: 'dir', isLink: false },
    { name: 'docs', kind: 'dir', isLink: false },
  ],
  docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
}

/** The global CLAUDE.md of the fixture user, which the parts flow reads after a yes (G-02-1f). */
const GLOBAL_CLAUDE_MD = '/home/u/.claude/CLAUDE.md'

/** The global CLAUDE.md of the parts flow: a Security section and a Git section, as the plan's dry run has it. */
const PARTS_GLOBAL = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

/** The model's grouping of PARTS_GLOBAL: P1 in T1 'Security rules' and P2 in T2 'Git and commits'. */
const PARTS_TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
  ],
})

/** The model's recommendation of the plan's dry run: T1 to security and T2 to tl, and no memory. */
const PARTS_RECOMMEND_REPLY = '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{}}'

/**
 * A git repo whose user has PARTS_GLOBAL as the global CLAUDE.md, with the grouping and the recommendation replies in
 * that order; `over` changes the fields it names.
 */
function partsWorld(over: Partial<MemWorld> = {}): MemWorld {
  const replies = [PARTS_TOPICS_REPLY, PARTS_RECOMMEND_REPLY]

  return gitWorld({ files: { [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL }, replies, ...over })
}

/** The start of the improver install question, which a parts hand-out with a built part asks (G-02-1f, D-141). */
const IMPROVER_INSTALL_PREFIX = 'Install claude-md-management'

/**
 * INIT_ANSWERS with the content consent answered Yes, the entry question Accept recommendations, and the improver
 * install question Not now, so a run whose user lacks claude-md-management runs no improver (D-141).
 */
const PARTS_ANSWERS: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  [CONTENT_QUESTION]: 'Yes, read them',
  [INSTRUCTIONS_ENTRY_QUESTION]: 'Accept recommendations',
  [IMPROVER_INSTALL_PREFIX]: 'Not now',
}

/** The auto-memory folder of the fixture repo for the fixture user (G-02-1f Memories). */
const MEMORY_DIR = '/home/u/.claude/projects/-repo/memory'

/** A sentence of a memory, and of MEMORY.md off its index lines, that is never shown or sent anywhere (T-02-64). */
const MEMORY_SENTENCE = 'LEAKY-MEMORY-SENTENCE stays on disk'

/** The MEMORY.md of memoriesWorld: an index line for squad.md only, then a line that is no index line. */
const MEMORY_INDEX =
  `# Memory index\n- [Squad commits](squad.md) \u2014 Unsigned commits on per-phase branches.\n${MEMORY_SENTENCE}\n`

/**
 * partsWorld with the auto-memories squad.md, which MEMORY.md sums up, and workflow.md, which it does not; the
 * recommendation gives squad.md to the Team Lead and workflow.md to no role. `over` changes the fields it names.
 */
function memoriesWorld(over: Partial<MemWorld> = {}): MemWorld {
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

/** A user-level GSD at ~/.claude/gsd-core whose identity is proven, as detection reports it. */
const PROVEN_USER_GSD: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** The detect facts of a user whose GSD at ~/.claude/gsd-core is proven, with its raw dir. */
const PROVEN_FACTS: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [PROVEN_USER_GSD] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

/** The folders and files of a repo whose scan proposes all six template roles: React and TypeScript with tests. */
const FULL_DIRS = {
  '/repo': [entry('package.json'), entry('src', 'dir')],
  '/repo/src': [entry('a.ts'), entry('a.test.ts')],
}

/** The package.json of FULL_DIRS: React is a dependency, so FE is kept. */
const FULL_FILES = { '/repo/package.json': '{"dependencies":{"react":"18.0.0"}}' }

/** A git repo at /repo whose scan proposes all six template roles; `over` changes the fields it names. */
function fullWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({ dirs: { '/repo/.git': [], ...FULL_DIRS }, files: { ...FULL_FILES }, ...over })
}

/** The longest of the keys the question starts with; undefined when none does. */
function longestKey(keys: readonly string[], question: string): string | undefined {
  return keys.filter(key => question.startsWith(key)).sort((a, b) => b.length - a.length)[0]
}

/**
 * A port over `world` that answers by question prefix, the longest prefix winning, as INIT_ANSWERS does. A list
 * answers its questions in turn and its last answer repeats; a null in it dismisses that ask, and so does a question no
 * prefix matches.
 */
export function queuedIo(world: MemWorld, answers: Readonly<Record<string, string | readonly (string | null)[]>>): MemRun {
  const run = memIo(world, {})
  const used = new Map<string, number>()
  const nextAnswer = (question: string): string | null => {
    const key = longestKey(Object.keys(answers), question)
    if (key === undefined) return null
    const value = answers[key]
    if (value === undefined) return null
    if (typeof value === 'string') return value
    const turn = used.get(key) ?? 0
    used.set(key, turn + 1)

    return value[Math.min(turn, value.length - 1)] ?? null
  }
  const io: InitIo = {
    ...run.io,
    ask: async (question, spec) => {
      run.asked.push(question)
      run.specs.push(spec)
      const answer = nextAnswer(question)
      if (answer === null) throw new Error('dismissed')

      return answer
    },
  }

  return { ...run, io }
}

/** A world where every per-role step asks: two frameworks in use, the secret world's names, GSD hunks to answer. */
function everyStepWorld(): MemWorld {
  return { ...secretWorld(), facts: { facts: AMBIGUOUS_FACTS, gsdUserDir: null } }
}

/**
 * A git repo at /repo whose user-level GSD is proven (PROVEN_FACTS), so INIT_ANSWERS puts PM, Team Lead and Security on
 * GSD, and whose `.planning/config.json` already holds workflow.text_mode false, so `mode` is the one hunk init asks;
 * INIT_ANSWERS accepts it, and cadre can run it.
 */
export function modeWorld(over: Partial<MemWorld> = {}): MemWorld {
  const config = { '/repo/.planning/config.json': '{"workflow":{"text_mode":false}}' }

  return gitWorld({ facts: PROVEN_FACTS, files: config, ...over })
}

/** The six template roles, as init builds them with nothing assigned. */
export const TEMPLATE_ROLES: readonly RoleSpec[] = ROLE_TEMPLATE.map(row => roleFromTemplate(row))

/**
 * The compiled scope of a role on the merged MCP route, with the whole team for the decision chain; `over` changes the
 * context fields it names.
 */
function scopeOf(
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

/** The repo state of a team on one framework: what init writes as .cadre/cadre.json. */
function stateOf(team: readonly RoleSpec[], framework: FrameworkId): CadreState {
  return {
    schema: 1,
    cadreVersion: '0.2.0',
    framework,
    gitPolicy: 'definitions',
    roles: team.map(role => role.id),
    launchStart: { kind: 'git-root' },
    readUserMcp: false,
  }
}

/** The input init gives desiredFiles for a team that runs one framework; `over` changes the fields it names. */
export function inputOf(team: readonly RoleSpec[], framework: FrameworkId, over: Partial<GenerateInput> = {}): GenerateInput {
  return {
    roles: team,
    scopes: new Map(team.map((role): [string, CompiledScope] => [role.id, scopeOf(role, framework, team)])),
    state: stateOf(team, framework),
    only: null,
    ...over,
  }
}

/**
 * Each golden world by name, with the answers its run is given by question prefix (the longest prefix wins). Each entry
 * names the init.test spec it comes from, or the fixtures it is assembled from.
 */
export const GOLDEN_WORLDS = Object.freeze({
  /**
   * The git repo /repo where the scan detects nothing (gitWorld), with the INIT_ANSWERS defaults, as `runInit` > `after
   * the consent init shows the repo scan and user setup in the pane, before the next question` runs it.
   */
  nothing: { world: gitWorld(), answers: INIT_ANSWERS },
  /**
   * fullWorld (six roles) whose user GSD is proven (PROVEN_FACTS) and in use: the `.planning` folder of AMBIGUOUS_FACTS
   * in the repo entries, so GSD is the one framework in use. Assembled from those fixtures; no init.test spec runs it.
   */
  gsd: {
    world: fullWorld({
      facts: {
        ...PROVEN_FACTS,
        facts: { ...PROVEN_FACTS.facts, repoEntries: [{ name: '.planning', kind: 'dir', isLink: false }] },
      },
    }),
    answers: INIT_ANSWERS,
  },
  /**
   * fullWorld (six roles) with superpowers the one framework in use: the `docs` and `docs/superpowers` folders of
   * AMBIGUOUS_FACTS, without its `.planning`. Assembled from those fixtures; no init.test spec runs it.
   */
  superpowers: {
    world: fullWorld({
      facts: {
        facts: {
          ...EMPTY_FACTS,
          repoEntries: [{ name: 'docs', kind: 'dir', isLink: false }],
          docsEntries: [{ name: 'superpowers', kind: 'dir', isLink: false }],
        },
        gsdUserDir: null,
      },
    }),
    answers: INIT_ANSWERS,
  },
  /**
   * everyStepWorld with PARTS_DECLINED, as `reviewStep` > `each typed item re-asks only its own questions, in the order
   * init first asked them` runs it to its dry-run reply.
   */
  everyStep: { world: everyStepWorld(), answers: PARTS_DECLINED },
  /**
   * memoriesWorld (instruction parts and two memories) with PARTS_ANSWERS, as `memories one by one (G-02-1f)` > `a dry
   * run shows both memories after the topics, each with its MEMORY.md summary or none` runs it: the closest spec world
   * to parts, a memory and own skills, since ownSkillsWorld's skills take the model replies partsWorld's flow needs.
   */
  parts: { world: memoriesWorld(), answers: PARTS_ANSWERS },
})

/**
 * Copied byte-identically from start.test.ts (only `export` added where a golden module needs one): the BE role, the
 * git and claude host rules its runStart specs answer with, repoWorld (`gatherLaunchUser (D-98)`), guardedWorld
 * (`launch user settings (D-103)`), and appliedWorld with the launcher and manifest fixtures it writes, and withoutFile
 * (`runStart refusals (LNCH-04, D-107)`).
 */

/** The BE role of the template. */
const BE = templateRole('be')

/** The argv that asks git for the absolute common dir of the repo (D-98). */
const GIT_ARGV = ['git', 'rev-parse', '--path-format=absolute', '--git-common-dir']

/** A fake host rule that answers the git argv with this run; null is a run the host rejected. */
function gitRule(result: HostRun | null): HostRunRule {
  return { argv: GIT_ARGV, result }
}

/** The git run of the fixture repo: git answers /repo/.git, with its line break. */
export const GIT_OK = gitRule({ exitCode: 0, stdout: '/repo/.git\n', stderr: '' })

/** A git repo at /repo whose .git folder is there; `over` changes the fields it names. */
export function repoWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ dirs: { '/repo/.git': [] }, ...over })
}

/** The command of the secret read guard that the project settings register on Read (D-103). */
const PROJECT_GUARD = 'node /repo/.claude/hooks/gsd-secret-read-guard.js'

/** Project settings that register the secret read guard on Read. */
const PROJECT_GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: PROJECT_GUARD }] }] },
}

/** The secret world with the project settings holding the guard too (D-103). */
export function guardedWorld(): MemWorld {
  return secretWorld({ settings: { user: secretUserSettings(), project: PROJECT_GUARD_SETTINGS, local: {} } })
}

/** The text of BE's launcher in the start worlds; runStart reads only its hash, to compare it with the manifest. */
const LAUNCHER_TEXT = '#!/bin/sh\n# the launcher of role be\nexit 0\n'

/** Where BE's launcher lies in the start worlds. */
export const LAUNCHER_PATH = '/repo/.cadre/bin/be'

/** Where the manifest lies in the start worlds. */
const MANIFEST_FILE = '/repo/.cadre/manifest.json'

/** The argv of the version check of the PATH claude (D-107). */
const CLAUDE_ARGV = ['claude', '--version']

/** A fake host rule that answers `claude --version` with this run; null is a run the host rejected. */
export function claudeRule(result: HostRun | null): HostRunRule {
  return { argv: CLAUDE_ARGV, result }
}

/** `claude --version` of a claude new enough for cadre. */
export const CLAUDE_OK = claudeRule({ exitCode: 0, stdout: '2.1.304 (Claude Code)\n', stderr: '' })

/** The manifest text that records these entries. */
function manifestText(files: readonly ManifestEntry[]): string {
  return stableJson({ schema: 1, cadreVersion: '0.2.0', files })
}

/** The manifest entry of BE's launcher with the sha256 of LAUNCHER_TEXT. */
async function launcherEntry(): Promise<ManifestEntry> {
  return { path: '.cadre/bin/be', sha256: await sha256Hex(LAUNCHER_TEXT), mode: 'exec' }
}

/**
 * A git repo at /repo after a plain init of BE (D-102, LNCH-04): the cadre.json of BE alone on the built-in default,
 * launched at the git root, recording `readUserMcp`, BE's role.json written from `role`, the folder `.cadre/be`, the
 * launcher and a manifest whose `.cadre/bin/be` entry holds the launcher's sha256.
 */
export async function appliedWorld(role: RoleSpec = BE, readUserMcp = false): Promise<MemWorld> {
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: { kind: 'git-root' },
    readUserMcp,
  })

  return memWorld({
    dirs: { '/repo/.git': [], '/repo/.cadre/be': [] },
    files: {
      '/repo/.cadre/cadre.json': state,
      '/repo/.cadre/be/role.json': roleJsonText(role),
      [LAUNCHER_PATH]: LAUNCHER_TEXT,
      [MANIFEST_FILE]: manifestText([await launcherEntry()]),
    },
  })
}

/** `world` with no file at `path`. */
export function withoutFile(world: MemWorld, path: string): MemWorld {
  return { ...world, files: Object.fromEntries(Object.entries(world.files).filter(([key]) => key !== path)) }
}

/**
 * Copied from init.test.ts for the regen goldens (only `export` added where a golden module needs one): scansOf,
 * stateOf (renamed initStateOf: worlds.ts already has the stateOf of generate.test.ts), plannedFiles, onDisk and
 * manifestOf, and, de-indented from their describes, `team` and regenWorld (`runRegen`) and `be` and beOnlyWorld
 * (`regen apply`).
 */
/** The scans of a run in `world`, gathered as init gathers them; ~/.claude.json is read only when it is allowed. */
async function scansOf(world: MemWorld, isClaudeJsonAllowed = false): Promise<Gathered> {
  return gatherScans(memIo(world, {}).io, DEFAULT_LOCATIONS, isClaudeJsonAllowed)
}

/**
 * The repo state the init fixtures plan: the built-in default, committed definitions, the git root, cadre 0.2.0 and
 * no consent to read ~/.claude.json.
 */
function initStateOf(roles: readonly RoleSpec[], over: Partial<CadreState> = {}): CadreState {
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
async function plannedFiles(
  world: MemWorld,
  roles: readonly RoleSpec[],
  over: Partial<CadreState> = {},
): Promise<DesiredFile[]> {
  const state = initStateOf(roles, over)
  const gathered = await scansOf(world, state.readUserMcp)
  const scopes = scopesFor(roles, state.framework, gathered, [], state.launchStart)

  return desiredFiles({ roles, scopes, state, only: null, repoParts: new Map() })
}

/** The text of each file at its absolute path under /repo. */
function onDisk(files: readonly DesiredFile[]): Record<string, string> {
  return Object.fromEntries(files.map(file => [`/repo/${file.path}`, file.content]))
}

/** The manifest text a run that generated these files records: their hashes and modes in path order. */
async function manifestOf(files: readonly DesiredFile[], cadreVersion = '0.2.0'): Promise<string> {
  const entries: ManifestEntry[] = []
  for (const file of files) entries.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })

  return stableJson({ schema: 1, cadreVersion, files: entries.sort((a, b) => compareText(a.path, b.path)) })
}

/** BE and PM on the repo default, in the order cadre.json lists them. */
const team = [templateRole('be'), templateRole('pm')]

/**
 * `base` with what init leaves on disk for `roles` and the state `over`: every planned file, their manifest (which
 * also lists `extra`, files that are not planned) and the `.cadre/` folder.
 */
export async function regenWorld(
  roles: readonly RoleSpec[] = team,
  over: Partial<CadreState> = {},
  base: MemWorld = gitWorld(),
  extra: readonly DesiredFile[] = [],
): Promise<MemWorld> {
  const files = await plannedFiles(base, roles, over)
  const manifest = await manifestOf([...files, ...extra])

  return {
    ...base,
    dirs: { ...base.dirs, '/repo/.cadre': [] },
    files: { ...base.files, ...onDisk(files), '/repo/.cadre/manifest.json': manifest },
  }
}

/** BE alone on the built-in default, as `.cadre/cadre.json` lists it. */
const be = templateRole('be')

/**
 * The repo after an init of BE alone on the built-in default: a listed `.cadre/` folder with cadre.json, BE's
 * role.json and a manifest that records no file, as the faked host's regen world has it.
 */
export function beOnlyWorld(): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], '/repo/.cadre': [] },
    files: {
      '/repo/.cadre/cadre.json': cadreJsonText(initStateOf([be])),
      '/repo/.cadre/be/role.json': roleJsonText(be),
      '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: [] }),
    },
  })
}

/**
 * Copied byte-identically from status.test.ts for the status goldens (only `export` added where a golden module needs
 * one): the transcripts and autopilot folders, the done log, the title grep rules, statusWorld with its StatusInput,
 * the fixture clock, the time log, S9_TITLED, s9World and onStatus (`status states (D-111)`).
 */
/** The git root's transcripts folder under the fixture user folder (D-131). */
const TRANSCRIPTS = '/home/u/.claude/projects/-repo'

/** The autopilot folder of the fixture home, with each session's status file and log. */
const AUTOPILOT = '/home/u/.claude/autopilot'

/** An autopilot log whose run ended done: the final handoff request, then the finished line (D-111). */
export const DONE_LOG =
  '2026-10-20T01:00:00.000Z  final handoff requested (done)\n' +
  '2026-10-20T01:01:00.000Z  finished (done): handed back to the person\n'

/** The grep output of a transcript whose session is named `title`: its custom-title row. */
function titleRow(title: string): string {
  return `${JSON.stringify({ type: 'custom-title', customTitle: title, sessionId: 'x' })}\n`
}

/** A fake host rule that answers the title grep of the transcript at `path` with `result`. */
function grepRule(path: string, result: HostRun | null): HostRunRule {
  return { argv: titleGrepArgv(path), result }
}

/** A title grep of the transcript at `path` that exits 0 with the custom-title row of `title`. */
function titled(path: string, title: string): HostRunRule {
  return grepRule(path, { exitCode: 0, stdout: titleRow(title), stderr: '' })
}

/**
 * What a status world adds to the applied repo: its launch start, the repo default framework, BE's role, its
 * locations, and more folders and files.
 */
type StatusInput = {
  readonly start?: LaunchStart
  readonly framework?: FrameworkId | null
  readonly role?: RoleSpec
  readonly locations?: InitLocations
  readonly dirs?: Readonly<Record<string, readonly PortEntry[]>>
  readonly files?: Readonly<Record<string, string>>
}

/**
 * A git repo at /repo after an init of BE alone (D-111): cadre.json with `start` (git root by default) and `framework`
 * (the built-in default unless told), BE's role.json from `role` (the template BE by default), plus the folders and
 * files `input` adds. A dir start's folder is there as a folder.
 */
function statusWorld(input: StatusInput = {}): MemWorld {
  const start = input.start ?? { kind: 'git-root' }
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: input.framework === undefined ? 'none' : input.framework,
    gitPolicy: 'definitions',
    roles: ['be'],
    launchStart: start,
    readUserMcp: false,
  })
  const startDir = start.kind === 'dir' ? { [`/repo/${start.path}`]: [] } : {}

  return memWorld({
    locations: input.locations ?? DEFAULT_LOCATIONS,
    dirs: { '/repo/.git': [], ...startDir, ...input.dirs },
    files: {
      '/repo/.cadre/cadre.json': state,
      '/repo/.cadre/be/role.json': roleJsonText(input.role ?? templateRole('be')),
      ...input.files,
    },
  })
}

/** The fixture clock, memWorld's `now`, in epoch milliseconds. */
const NOW = 1_000_000

/** An autopilot log of a done run that was revived, then ended for its time limit. */
export const TIME_LOG =
  '2026-10-20T01:00:00.000Z  finished (done): handed back to the person\n' +
  '2026-10-20T01:05:00.000Z  revived after finishing (done) by extend: to 03:05\n' +
  '2026-10-20T02:00:00.000Z  finished (time): handed back to the person\n'

/** The rule that gives the transcript of s9 at the git root the title `cadre-be`. */
export const S9_TITLED = titled(`${TRANSCRIPTS}/s9.jsonl`, 'cadre-be')

/**
 * A status world where the title search finds the session s9 at the git root (with S9_TITLED), with this status file
 * and log of s9 (null: not there), and what `input` adds.
 */
export function s9World(status: string | null, log: string | null, input: StatusInput = {}): MemWorld {
  const statusFile = status === null ? {} : { [`${AUTOPILOT}/s9.json`]: status }
  const logFile = log === null ? {} : { [`${AUTOPILOT}/s9.log`]: log }

  return statusWorld({
    ...input,
    dirs: { [TRANSCRIPTS]: [entryAt('s9.jsonl', 'file', 5)], ...input.dirs },
    files: { ...statusFile, ...logFile, ...input.files },
  })
}

/** A status file of a run that is on, with its beat `ago` milliseconds before the fixture clock. */
export function onStatus(ago: number): string {
  return JSON.stringify({ isOn: true, phase: 'running', beat: NOW - ago })
}

/**
 * Copied from epic.test.ts for the epic goldens (only `export` added where a golden module needs one): the worktree,
 * branch and git dir of PROJ-1 Add retry, the host rule builder, the main checkout rule and the base rules (whose
 * CLAUDE_OK is the start CLAUDE_OK above, the same value, not copied again), the team, gitWorld (renamed epicGitWorld:
 * testkit has a gitWorld), launcherOf, launcherEntry (renamed epicLauncherEntry: the start launcherEntry above takes no
 * id), teamWorld, the record, the bare worktree, the kept worktree with keptWorld (`the user's global excludes and the
 * reuse mirror`), renderWorld with its rules (`rendering each role into the epic worktree`), the macOS rule (`opening
 * each picked role inside the epic worktree`) and doneWorld with its rules (`removing a finished epic worktree`).
 */
/** The worktree `/cadre epic PROJ-1 Add retry` makes in the fixture repo /repo (D-146). */
export const WORKTREE = '/repo/.claude/worktrees/proj-1-add-retry'

/** The branch of that worktree (D-146). */
export const BRANCH = 'epic/proj-1-add-retry'

/** The git dir of that worktree, where its epic record and its excludes file lie (D-147, D-164). */
const GIT_DIR = '/repo/.git/worktrees/proj-1-add-retry'

/** A fake host rule that answers `argv` with this exit code and output; a null exit code is a run the host rejected. */
export function rule(argv: readonly string[], exitCode: number | null, stdout = ''): HostRunRule {
  return { argv, result: exitCode === null ? null : { exitCode, stdout, stderr: '' } }
}

/** The probe of /repo answered as the main checkout: its git dir is the common dir (D-165). */
const MAIN_CHECKOUT = rule(CHECKOUT_ARGV('/repo'), 0, '/repo/.git\n/repo/.git\n')

/** The rules every epic run falls back to, after its own: the main checkout at /repo and a claude new enough. */
export const BASE_RULES: readonly HostRunRule[] = [MAIN_CHECKOUT, CLAUDE_OK]

/** PM and BE, in the order cadre.json lists them in the epic worlds. */
const TEAM: readonly RoleSpec[] = [templateRole('pm'), templateRole('be')]

/**
 * A git repo at /repo; `over` changes the fields it names. It has no dialog, as in `claude -p`, so /cadre epic opens
 * every role without asking (D-166); the role picker specs set `interactive` to ask.
 */
function epicGitWorld(over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ interactive: false, dirs: { '/repo/.git': [] }, ...over })
}

/**
 * The text of a role's launcher in the epic worlds: launcherRead compares only its sha256 with the manifest, and
 * /cadre epic also wants the line that picks the epic kickoff (D-158).
 */
function launcherOf(id: string): string {
  const pick = `${RUNTIME_KICKOFF_TEST}"$root"/.cadre/${id}/kickoff.txt; fi`

  return `#!/bin/sh\n# the launcher of role ${id}\n${pick}\nexit 0\n`
}

/** The manifest entry of a role's launcher, holding the sha256 of launcherOf. */
async function epicLauncherEntry(id: string): Promise<ManifestEntry> {
  return { path: `.cadre/bin/${id}`, sha256: await sha256Hex(launcherOf(id)), mode: 'exec' }
}

/**
 * A git repo at /repo after a plain init of `roles` (PM and BE by default): cadre.json lists them on the built-in
 * default, launched at the git root, recording `readUserMcp` (no consent to read ~/.claude.json by default), each
 * role.json is written from its role, and each launcher lies in `.cadre/bin/` with its sha256 in the manifest.
 */
async function teamWorld(roles: readonly RoleSpec[] = TEAM, readUserMcp = false): Promise<MemWorld> {
  const ids = roles.map(role => role.id)
  const state = cadreJsonText({
    schema: 1,
    cadreVersion: '0.2.0',
    framework: 'none',
    gitPolicy: 'definitions',
    roles: ids,
    launchStart: { kind: 'git-root' },
    readUserMcp,
  })
  const entries = await Promise.all(ids.map(epicLauncherEntry))
  const files: Record<string, string> = {
    '/repo/.cadre/cadre.json': state,
    '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: entries }),
  }
  for (const role of roles) {
    files[`/repo/.cadre/${role.id}/role.json`] = roleJsonText(role)
    files[`/repo/.cadre/bin/${role.id}`] = launcherOf(role.id)
  }

  return epicGitWorld({ files })
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
const BARE_WORKTREE = '/repo/.claude/worktrees/proj-1'

/** The git dir of BARE_WORKTREE, as git names it. */
const BARE_GIT_DIR = '/repo/.git/worktrees/proj-1'

/** The worktree of PROJ-1 that git lists on the branch epic/proj-1-x, so /cadre epic PROJ-1 reuses it (D-163). */
const KEPT_WORKTREE = '/repo/.claude/worktrees/proj-1-x'

/** The git dir of KEPT_WORKTREE, where its epic record and its excludes file lie. */
const KEPT_GIT_DIR = '/repo/.git/worktrees/proj-1-x'

/**
 * git listing the main checkout and KEPT_WORKTREE, naming KEPT_WORKTREE's git dir, and ignoring `.env`, `dist/` and
 * `node_modules/` in the main checkout.
 */
export const KEPT_RULES: readonly HostRunRule[] = [
  rule(
    WORKTREE_LIST_ARGV('/repo'),
    0,
    'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
      `worktree ${KEPT_WORKTREE}\nHEAD b\nbranch refs/heads/epic/proj-1-x\n`,
  ),
  rule(GIT_DIR_ARGV(KEPT_WORKTREE), 0, `${KEPT_GIT_DIR}\n`),
  rule(LS_IGNORED_ARGV('/repo'), 0, '.env\0dist/\0node_modules/\0'),
]

/** A team world whose KEPT_WORKTREE lists node_modules (a link) and .env (a copy) and has `record` as its record. */
export async function keptWorld(record: string): Promise<MemWorld> {
  const world = await teamWorld()

  return {
    ...world,
    files: { ...world.files, [`${KEPT_GIT_DIR}/${EPIC_RECORD_FILE}`]: record },
    dirs: { ...world.dirs, [KEPT_WORKTREE]: [link('node_modules'), entry('.env')] },
  }
}

/** git naming the repo's common dir, the same from the main checkout and from a worktree (WT-02, Pattern 1). */
const COMMON_DIR = rule(GIT_COMMON_DIR_ARGV, 0, '/repo/.git\n')

/** A new PROJ-1 worktree whose git dir git names, with the common dir named too, so each role renders there. */
export const RENDER_RULES: readonly HostRunRule[] = [rule(GIT_DIR_ARGV(BARE_WORKTREE), 0, `${BARE_GIT_DIR}\n`), COMMON_DIR]

/**
 * The team world of `roles` (PM and BE by default) and `readUserMcp` with each role folder a real folder in the main
 * checkout and in BARE_WORKTREE, as the mirror makes them there (D-156), so a render in either finds its role folder.
 */
export async function renderWorld(roles: readonly RoleSpec[] = TEAM, readUserMcp = false): Promise<MemWorld> {
  const world = await teamWorld(roles, readUserMcp)
  const folders = roles.flatMap(role => [`/repo/.cadre/${role.id}`, `${BARE_WORKTREE}/.cadre/${role.id}`])

  return { ...world, dirs: { ...world.dirs, ...Object.fromEntries(folders.map(folder => [folder, []])) } }
}

/** The host naming macOS, the one host where /cadre epic opens terminals (D-132). */
export const DARWIN = rule(['/usr/bin/uname', '-s'], 0, 'Darwin\n')

/** The epic record of WORKTREE with the links /cadre epic made there, as /cadre epic done reads it (D-164, D-170). */
const DONE_RECORD = epicRecordText({ ...RECORD, links: ['node_modules', '.cadre/bin/pm'] })

/** git listing the main checkout, then WORKTREE on BRANCH with `lines` (a `locked` line) at the end of its block. */
function listRule(lines = ''): HostRunRule {
  const main = 'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n'
  const block = `worktree ${WORKTREE}\nHEAD b\nbranch refs/heads/${BRANCH}\n${lines}`

  return rule(WORKTREE_LIST_ARGV('/repo'), 0, `${main}${block}`)
}

/** The runs of an epic ready to remove: git lists WORKTREE, names its git dir, finds it clean and BRANCH in main. */
export const DONE_RULES: readonly HostRunRule[] = [
  listRule(),
  rule(GIT_DIR_ARGV(WORKTREE), 0, `${GIT_DIR}\n`),
  rule(STATUS_ARGV(WORKTREE), 0),
  rule(MERGED_ARGV('/repo', BRANCH, 'main'), 0),
]

/**
 * A team world whose WORKTREE has DONE_RECORD as its epic record, based on main; the worktree lists node_modules and
 * .cadre/bin/pm as links below real folders.
 */
export async function doneWorld(): Promise<MemWorld> {
  const world = await teamWorld()
  const dirs = {
    ...world.dirs,
    [WORKTREE]: [entry('.cadre', 'dir'), link('node_modules')],
    [`${WORKTREE}/.cadre`]: [entry('bin', 'dir')],
    [`${WORKTREE}/.cadre/bin`]: [link('pm')],
  }

  return { ...world, files: { ...world.files, [`${GIT_DIR}/${EPIC_RECORD_FILE}`]: DONE_RECORD }, dirs }
}

/**
 * Copied from facts.test.ts for the detect goldens (only `export` added where a golden module needs one): the planted
 * secret, candidate and raw, and, de-indented from `normalizeFacts with settings and plugins`, its settings and
 * installedPlugins. The detect golden assembles one read with GSD and superpowers present from them.
 */
/** A value planted in settings env and in a hook command; it must never reach Facts. */
const SENTINEL = 'SENTINEL_SECRET_123'

/** A GSD candidate as register.tsx reads it: present, nothing else read, no runtime problem, unless overridden. */
export function candidate(over: Partial<ProbedGsdCandidate>): ProbedGsdCandidate {
  return {
    location: 'user',
    dir: '/home/u/.claude/gsd-core',
    isPresent: true,
    versionText: null,
    identityText: null,
    manifest: null,
    runtimeStdout: null,
    runtimeTried: false,
    runtimeProblem: null,
    ...over,
  }
}

/** A raw host read with every list empty, the repo at /repo and the home folder at /home/u. */
export function raw(over: Partial<RawFacts>): RawFacts {
  return {
    root: '/repo',
    home: '/home/u',
    repoEntries: [],
    docsEntries: [],
    settings: [],
    installedPlugins: null,
    gsd: [],
    warnings: [],
    ...over,
  }
}

export const settings: RawFacts['settings'] = [
  { source: 'local', value: { enabledPlugins: { 'tool@y': true } } },
  {
    source: 'user',
    value: {
      enabledPlugins: { 'superpowers@claude-plugins-official': true, 'gsd@x': true },
      env: { TOKEN: SENTINEL },
      hooks: {
        PostToolUse: [
          {
            hooks: [
              {
                type: 'command',
                command: `"/Users/someone/.claude/hooks/gsd-context-monitor.js" --token ${SENTINEL}`,
              },
            ],
          },
        ],
      },
    },
  },
  {
    source: 'project',
    value: {
      enabledPlugins: { 'gsd@x': false },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /repo/.claude/hooks/gsd-statusline.cjs' }] }] },
    },
  },
]
export const installedPlugins = {
  version: 2,
  plugins: {
    'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.4.1', installPath: '/Users/x' }],
    'gsd@x': [{ scope: 'user', version: '1.0.0' }],
  },
}

/**
 * Copied byte-identically from init.test.ts for the own-skills golden (only `export` added where a golden module
 * needs one): the own-skills entry prefix, OWN_ACCEPTED and ownSkillsWorld (`skill recommendation in init (G-02-1b)` >
 * `a dry run asks the model once and shows the roles it recommends on each skill row`).
 */
/** The start of the entry question of the user's own skills (G-02-1b), as an answer key matches it. */
const OWN_SKILLS_ENTRY_PREFIX = 'How do you want to hand out your own skills'

/** INIT_ANSWERS with the user's own skills handed out by the model's recommendations (G-02-1b). */
export const OWN_ACCEPTED: Readonly<Record<string, string>> = {
  ...INIT_ANSWERS,
  [OWN_SKILLS_ENTRY_PREFIX]: 'Accept recommendations',
}

/**
 * A git repo with two of the user's own skills, deploy-notes described and my-skill not, and these replies of the
 * model; `over` changes the fields it names.
 */
export function ownSkillsWorld(replies: readonly (string | null)[], over: Partial<MemWorld> = {}): MemWorld {
  const commands = [
    { name: 'deploy-notes', source: 'user', description: 'Write the release notes for a deploy.' },
    { name: 'my-skill', source: 'project' },
  ]

  return gitWorld({ commands, replies, ...over })
}
