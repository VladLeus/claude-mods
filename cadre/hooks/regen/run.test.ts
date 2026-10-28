import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  DesiredFile,
  FileOp,
  FrameworkId,
  HostIo,
  HostRun,
  InstructionPart,
  LaunchStart,
  ManifestEntry,
  MemoryItem,
  RoleSpec,
} from '../../types'
import { improverArgv, improverGuardFlags, improverLine } from '../apply/improver'
import {
  instructionsRecordPath,
  instructionsRecordText,
  privateClaudeMdPath,
  privateClaudeMdText,
} from '../apply/private'
import { APPLIED_NONE_NOTE, MANIFEST_SKIPPED_NOTE, NEXT_STEP_NOTE } from '../apply/run'
import { sha256Hex } from '../core/hash'
import { isObject, stableJson } from '../core/json'
import { compareText } from '../core/text'
import { cadreJsonText, roleClaudeMdText, roleJsonText } from '../generate/docs'
import { desiredFiles } from '../generate/files'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import { HOME_ROOT_REPLY } from '../guards/refusals'
import { commandRefusal, NOT_INTERACTIVE_REPLY } from '../guards/repo'
import {
  improverNotOfferedWarning,
  memoryDroppedLine,
  notHandedOutWarning,
  partDroppedLine,
  REGEN_DISMISSED_REASON,
  REGEN_ITEM_OPTIONS,
  regenCancelledReply,
  regenHeader,
  regenMemoryContextLine,
  regenMemoryQuestion,
  regenPartContextLine,
  regenPartQuestion,
  runInit,
} from '../init'
import { CONTENT_QUESTION, INSTRUCTIONS_ENTRY_QUESTION } from '../instructions'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { parseRoleJson } from '../roles/rolejson'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { unreadableWarning } from '../scan/instructions/memories'
import { overSizeWarning, partsOfText } from '../scan/instructions/read'
import { REGEN_RECOMMEND_SYSTEM } from '../suggest/regen'
import { REGEN_BAD_STATE, REGEN_NO_STATE, regenBadRole, regenNeedsFramework, regenNoRole, scopesFor } from '../team'
import {
  ABSOLUTE_PATH_MARKERS,
  DEFAULT_LOCATIONS,
  entry,
  firstLines,
  gitWorld,
  hostWorld,
  INIT_ANSWERS,
  leaks,
  memHost,
  memIo,
  onDisk,
  plannedFiles,
  scansOf,
  SECRET_FIXTURES,
  secretWorld,
  stateOf,
  templateRole,
  USER_DIR_LISTED,
  withWrites,
} from '../testkit'
import type { HostCall, HostRunRule, HostWrite, MemHost, MemRun, MemWorld } from '../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../ui/ask'
import type { PartRecord } from './part-changes'
import { runRegen } from './run'
import type { RegenOptions } from './run'
import {
  dryRunPrivateWarning,
  REGEN_BAD_MANIFEST,
  REGEN_NO_MANIFEST,
  regenTotalWarning,
  unusableRecordWarning,
} from './side-read'

/** Settings with one PreToolUse hook that runs the GSD secret read guard. */
const GUARD_SETTINGS = {
  hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node /x/hooks/gsd-secret-read-guard.js' }] }] },
}

/** A role with its framework set, as the framework step or an Adjust override sets it. */
function withFramework(role: RoleSpec, framework: FrameworkId): RoleSpec {
  return { ...role, framework }
}

/** The global CLAUDE.md of the fixture user, which the parts flow reads after a yes (G-02-1f). */
const GLOBAL_CLAUDE_MD = '/home/u/.claude/CLAUDE.md'

/** The global CLAUDE.md of the parts flow: a Security section and a Git section, as the plan's dry run has it. */
const PARTS_GLOBAL = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

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

/** A sentence of the global CLAUDE.md that must never be shown, asked or logged (T-02-61). */
const GLOBAL_SENTENCE = 'LEAKY-GLOBAL-SENTENCE stays with the model'

/** A sentence of the repo CLAUDE.md that must never be shown, asked or logged (T-02-61). */
const REPO_SENTENCE = 'LEAKY-REPO-SENTENCE stays with the model'

/** One CLAUDE.md of the chain as `$.fs.ancestors` gives it: its folder, its name and its text, which the scan drops. */
function ancestor(dir: string): Readonly<Record<string, unknown>> {
  return { dir, name: 'CLAUDE.md', content: REPO_SENTENCE, parts: [] }
}

/** The auto-memory folder of the fixture repo for the fixture user (G-02-1f Memories). */
const MEMORY_DIR = '/home/u/.claude/projects/-repo/memory'

/** A sentence of a memory, and of MEMORY.md off its index lines, that is never shown or sent anywhere (T-02-64). */
const MEMORY_SENTENCE = 'LEAKY-MEMORY-SENTENCE stays on disk'

/** The MEMORY.md of memoriesWorld: an index line for squad.md only, then a line that is no index line. */
const MEMORY_INDEX =
  `# Memory index\n- [Squad commits](squad.md) \u2014 Unsigned commits on per-phase branches.\n${MEMORY_SENTENCE}\n`

/** The sentence of the root CLAUDE.md's Rules section, which init writes into the built file of the role given it. */
const BUILT_RULE = 'Run the tests before a commit.'

/**
 * The six-role repo of fullWorld whose user has a global Security section and whose root CLAUDE.md, in the chain, has a
 * Rules section; the model groups them into T1 'Security rules' (global) and T2 'Repo rules' (repo) and recommends T1
 * to security and T2 to be (G-02-1f Storage split). `over` changes the fields it names.
 */
function builtWorld(over: Partial<MemWorld> = {}): MemWorld {
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

/** The NUL character `git ls-files -z` ends each name with, built at run time. */
const NUL = String.fromCharCode(0)

/** A git ls-files run that exits 0 and names these files, each ended by NUL. */
function trackedRun(files: readonly string[]): HostRun {
  return { exitCode: 0, stdout: files.map(file => `${file}${NUL}`).join(''), stderr: '' }
}

/** The git run of builtWorld: whether git tracks the root CLAUDE.md, the one source of BE's repo parts (M3). */
const BUILT_GIT_ARGV: readonly string[] = ['git', '--literal-pathspecs', 'ls-files', '-z', '--', 'CLAUDE.md']

/** The host rule of a plain init over builtWorld or the secret world: git tracks the root CLAUDE.md (M3). */
const BUILT_TRACKED: readonly HostRunRule[] = [{ argv: BUILT_GIT_ARGV, result: trackedRun(['CLAUDE.md']) }]

/**
 * The git ls-files runs a host was asked for (M3); the common-dir run of the private files (G-02-1f) is not one of
 * them.
 */
function gitCalls(host: MemHost): HostCall[] {
  return host.calls.filter(call => call.argv[0] === 'git' && call.argv.includes('ls-files'))
}

/** The git run that gives the common dir of the fixture repo, /repo/.git: apply names the role memory folders by it. */
const COMMON_DIR_RULE: HostRunRule = {
  argv: GIT_COMMON_DIR_ARGV,
  result: { exitCode: 0, stdout: '/repo/.git\n', stderr: '' },
}

/** The folder that holds the role memory folders of the fixture repo: `~/.claude/cadre/repo-<hash8>` (D-91). */
async function slugFolder(): Promise<string> {
  return `/home/u/.claude/cadre/repo-${(await sha256Hex('/repo/.git')).slice(0, 8)}`
}

/** The role memory folder of a role of the fixture repo for the fixture user (D-20, D-91, D-140 q2-a). */
async function memoryFolder(id: string): Promise<string> {
  return `${await slugFolder()}/${id}`
}

/** A section of PARTS_GLOBAL as the read gives it: a global part of ~/.claude/CLAUDE.md with the hash of its text. */
async function partsGlobalPart(id: string, heading: string, text: string): Promise<InstructionPart> {
  return { id, file: '~/.claude/CLAUDE.md', heading, source: 'global', text, hash: await sha256Hex(text) }
}

/** The memory squad.md of memoriesWorld, as the hand-out offers it. */
async function squadMemory(): Promise<MemoryItem> {
  const hash = await sha256Hex(`${MEMORY_SENTENCE} (squad)`)

  return { id: 'M1', file: 'squad.md', folder: MEMORY_DIR, summary: 'Unsigned commits on per-phase branches.', hash }
}

/** The writes of a host that land in the user's folder, outside the repo. */
function homeWrites(host: MemHost): HostWrite[] {
  return host.writes.filter(write => write.path.startsWith('/home/u/'))
}

/** The absolute path of BE's built CLAUDE.md in the fixture repo. */
const BE_CLAUDE_MD = '/repo/.cadre/be/CLAUDE.md'

/** The improver run of BE's built CLAUDE.md: guarded from its .runtime folder and from Bash (02-GAPS-B3 M1). */
const BE_IMPROVER_ARGV: readonly string[] = improverArgv(BE_CLAUDE_MD, improverGuardFlags('/repo', 'be') ?? [])

/** BE's built CLAUDE.md, repo-relative, as a file plan names it. */
const BE_CLAUDE_MD_PATH = '.cadre/be/CLAUDE.md'

/** The start of the per-file improver question (G-02-1f, D-141). */
const IMPROVER_PREFIX = "Accept the improver's changes"

/** The fixture user's installed_plugins.json with claude-md-management installed at user scope (D-141). */
function claudeMdInstalled(): string {
  return JSON.stringify({ plugins: { [CLAUDE_MD_PLUGIN]: [{ scope: 'user', version: '1.0.0' }] } })
}

/** The improver runs a host was asked for, `claude -p`, in order. */
function improverCalls(host: MemHost): HostCall[] {
  return host.calls.filter(call => call.argv[0] === 'claude' && call.argv[1] === '-p')
}

/** The text of the manifest a host wrote; '' when it wrote none. */
function writtenManifestText(host: MemHost): string {
  return host.writes.find(write => write.path === '/repo/.cadre/manifest.json')?.text ?? ''
}

/** The folders and files of a repo whose scan proposes all six template roles: React and TypeScript with tests. */
const FULL_DIRS = {
  '/repo': [entry('package.json'), entry('src', 'dir')],
  '/repo/src': [entry('a.ts'), entry('a.test.ts')],
}

/** The package.json of FULL_DIRS: React is a dependency, so FE is kept. */
const FULL_FILES = { '/repo/package.json': '{"dependencies":{"react":"18.0.0"}}' }

/** The manifest text a run that generated these files records: their hashes and modes in path order. */
async function manifestOf(files: readonly DesiredFile[], cadreVersion = '0.2.0'): Promise<string> {
  const entries: ManifestEntry[] = []
  for (const file of files) entries.push({ path: file.path, sha256: await sha256Hex(file.content), mode: file.mode })

  return stableJson({ schema: 1, cadreVersion, files: entries.sort((a, b) => compareText(a.path, b.path)) })
}

/** The kind of the op of each path in the file plan of a reply. */
function opKinds(reply: string): Map<string, string> {
  const kinds = new Map<string, string>()
  for (const line of reply.split('\n')) {
    const [, kind, path] = /^ {2}(create|change|leave|conflict) +(\S+)/.exec(line) ?? []
    if (kind !== undefined && path !== undefined) kinds.set(path, kind)
  }

  return kinds
}

/** The Rules section of the root CLAUDE.md in the regen cases (G-02-1f Regen). */
const RULES_SECTION = '# Rules\nRun the tests.\n'

/** The Git section of the root CLAUDE.md, the one part BE was given (G-02-1f Regen). */
const GIT_SECTION = '## Git\nUse signed commits.\n'

/** The Git section after an edit. */
const GIT_EDITED = '## Git\nUse signed commits, always.\n'

/** The start of a regen question about a part or a memory for BE (G-02-1f Regen, D-142). */
const REGEN_PART_PREFIX = 'Should be get'

/** A repo part of the root CLAUDE.md with this id, heading and text, hashed as the read hashes it. */
async function rootPart(id: string, heading: string, text: string): Promise<InstructionPart> {
  return { id, file: 'CLAUDE.md', heading, source: 'repo', text, hash: await sha256Hex(text) }
}

/** What a role's records keep of a part: its file, heading and hash (G-02-1f Regen). */
function recorded(part: Pick<InstructionPart, 'file' | 'heading' | 'hash'>): PartRecord {
  return { file: part.file, heading: part.heading, hash: part.hash }
}

/** The regen fixture: the root CLAUDE.md now, the world fields to change, and BE's given and not-given parts. */
type RegenFixture = {
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
async function regenPartsWorld(fixture: RegenFixture = {}): Promise<MemWorld> {
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

/** The installed_plugins.json of the fixture user, whose home is /home/u (DEFAULT_LOCATIONS). */
const INSTALLED_PLUGINS_PATH = '/home/u/.claude/plugins/installed_plugins.json'

describe('runRegen', () => {
  /** BE and PM on the repo default, in the order cadre.json lists them. */
  const team = [templateRole('be'), templateRole('pm')]
  /** The repo state file of the fixtures. */
  const STATE = '/repo/.cadre/cadre.json'
  /** BE's role.json in the fixtures. */
  const BE_ROLE = '/repo/.cadre/be/role.json'
  /** PM's role.json in the fixtures. */
  const PM_ROLE = '/repo/.cadre/pm/role.json'
  /** The manifest of the fixtures. */
  const MANIFEST = '/repo/.cadre/manifest.json'
  /** The heads of the paths regen of BE may plan: its folder, its launcher, the index and the manifest (D-68). */
  const BE_PLAN_HEADS = ['.cadre/be/', '.cadre/bin/be', '.cadre/INDEX.md', '.cadre/manifest.json']

  /**
   * `base` with what init leaves on disk for `roles` and the state `over`: every planned file, their manifest (which
   * also lists `extra`, files that are not planned) and the `.cadre/` folder.
   */
  async function regenWorld(
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

  /**
   * A git repo at /repo whose root lists as empty, so its scans give no warning (A4); gitWorld's root cannot be listed,
   * which the repo scan warns about. `over` changes the fields it names.
   */
  function listedWorld(over: Partial<MemWorld> = {}): MemWorld {
    return gitWorld({ dirs: { '/repo/.git': [], '/repo': [] }, ...over })
  }

  /** `world` with these absolute paths holding these texts, beside the files it has. */
  function withFiles(world: MemWorld, files: Readonly<Record<string, string>>): MemWorld {
    return { ...world, files: { ...world.files, ...files } }
  }

  /** `world` without the file at this absolute path. */
  function without(world: MemWorld, path: string): MemWorld {
    return { ...world, files: Object.fromEntries(Object.entries(world.files).filter(([key]) => key !== path)) }
  }

  /** Whether regen of BE may plan this path (BE_PLAN_HEADS). */
  function isBePlanPath(path: string): boolean {
    return BE_PLAN_HEADS.some(head => path.startsWith(head))
  }

  /** BE's role.json, repo-relative: the input of regen of BE, which plans no op for it (A5). */
  const BE_ROLE_PATH = '.cadre/be/role.json'

  /**
   * Whether regen of BE plans an op for this path: a path it may plan other than BE's own role.json (A5) and its built
   * CLAUDE.md, which regen keeps with no op while BE's role.json holds no part records (AUTO-PICK #15).
   */
  function isBeOpPath(path: string): boolean {
    return isBePlanPath(path) && path !== BE_ROLE_PATH && path !== BE_CLAUDE_MD_PATH
  }

  /** The reply of `/cadre regen be` in `world`, a dry run unless told otherwise; a plain run writes to a fresh host. */
  async function regenBe(world: MemWorld, dryRun = true): Promise<string> {
    const options: RegenOptions = dryRun
      ? { id: 'be', dryRun: true }
      : { id: 'be', dryRun: false, host: memHost(hostWorld({})).io }

    return runRegen(memIo(world, {}).io, options)
  }

  /** The text of the planned file at this repo-relative path; empty when none is planned there. */
  function textOf(files: readonly DesiredFile[], path: string): string {
    return files.find(file => file.path === path)?.content ?? ''
  }

  test('each refusal has its fixed text, and the unknown-id refusal names the listed roles or none (D-68)', () => {
    expect(REGEN_NO_STATE).toBe('cadre regen needs .cadre/cadre.json from /cadre init: run /cadre init first.')
    expect(REGEN_BAD_STATE).toBe('.cadre/cadre.json is not valid: fix it, or run /cadre init again.')
    expect(regenNoRole('qa', ['be', 'pm'])).toBe('no role qa in .cadre/cadre.json (roles: be, pm)')
    expect(regenNoRole('qa', [])).toBe('no role qa in .cadre/cadre.json (roles: none)')
    expect(regenBadRole('be')).toBe('.cadre/be/role.json is missing or not valid: fix it, or run /cadre init again.')
    expect(regenNeedsFramework('be')).toBe(
      'role be has no framework and this repo has no default: set "framework" in .cadre/be/role.json to gsd, ' +
        'superpowers or none, then run /cadre regen be again.',
    )
  })

  test('the guard runs first, in the regen wording, before any read or question', async () => {
    const world = await regenWorld()
    const run = memIo({ ...world, locations: { ...DEFAULT_LOCATIONS, root: '/home/u', givenRoot: '/home/u' } }, {})
    const host = memHost(hostWorld({}))
    expect(await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })).toBe(
      commandRefusal(HOME_ROOT_REPLY, 'regen'),
    )
    expect([host.writes, host.calls]).toEqual([[], []])
    expect(run.reads).toEqual([])
    expect(run.asked).toEqual([])
  })

  test('with no .cadre/cadre.json regen asks for /cadre init first, and asks nothing', async () => {
    for (const world of [gitWorld(), without(await regenWorld(), STATE)]) {
      const run = memIo(world, {})
      expect(await runRegen(run.io, { id: 'be', dryRun: true })).toBe(REGEN_NO_STATE)
      expect(run.asked).toEqual([])
    }
  })

  test('a cadre.json that cannot be read, is too large or is not valid state refuses (T-02-36)', async () => {
    const world = await regenWorld()
    const state = stateOf(team)
    // The object rest leaves the consent answer out, as a cadre.json written before A1 would.
    const { readUserMcp, ...withoutConsent } = state
    const worlds: readonly MemWorld[] = [
      withFiles(world, { [STATE]: '{' }),
      withFiles(world, { [STATE]: stableJson({ ...state, schema: 2 }) }),
      withFiles(world, { [STATE]: stableJson({ ...state, roles: ['be', 'be'] }) }),
      withFiles(world, { [STATE]: stableJson({ ...state, launchStart: { kind: 'dir', path: '../x' } }) }),
      withFiles(world, { [STATE]: 'x'.repeat(MAX_READ_BYTES + 1) }),
      { ...world, unknownPaths: [STATE] },
      { ...world, realPaths: { [STATE]: '/elsewhere/cadre.json' } },
      withFiles(world, { [STATE]: stableJson(withoutConsent) }),
      withFiles(world, { [STATE]: stableJson({ ...state, readUserMcp: 'yes' }) }),
    ]
    for (const [index, bad] of worlds.entries()) {
      const run = memIo(bad, {})
      expect([index, await runRegen(run.io, { id: 'be', dryRun: true })]).toEqual([index, REGEN_BAD_STATE])
      expect(run.asked).toEqual([])
    }
  })

  test('a stored launcher folder that is not a folder inside the repo makes cadre.json not valid (A2)', async () => {
    const start: LaunchStart = { kind: 'dir', path: 'apps/web' }
    const world = await regenWorld(team, { launchStart: start })
    const folder = '/repo/apps/web'
    const linked = { ...world, dirs: { ...world.dirs, [folder]: [] }, realPaths: { [folder]: '/elsewhere/web' } }
    for (const bad of [world, withFiles(world, { [folder]: 'a file' }), linked]) {
      expect(await regenBe(bad)).toBe(REGEN_BAD_STATE)
    }
    const kinds = opKinds(await regenBe({ ...world, dirs: { ...world.dirs, [folder]: [] } }))
    expect(kinds.get('.cadre/bin/be')).toBe('leave')
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('regen of a folder start plans the ROLE.md init planned, which names the added git root (D-122)', async () => {
    const world = await regenWorld(team, { launchStart: { kind: 'dir', path: 'apps/web' } })
    const kinds = opKinds(await regenBe({ ...world, dirs: { ...world.dirs, '/repo/apps/web': [] } }))
    expect(world.files['/repo/.cadre/be/ROLE.md']).toContain(
      '    [none] Additional directory: <git root> (start folder is <git root>/apps/web)\n',
    )
    expect(kinds.get('.cadre/be/ROLE.md')).toBe('leave')
  })

  test('an id cadre.json does not list refuses, naming the roles it lists', async () => {
    const run = memIo(await regenWorld(), {})
    const host = memHost(hostWorld({}))
    const reply = await runRegen(run.io, { id: 'qa', dryRun: false, host: host.io })
    expect(reply).toBe('no role qa in .cadre/cadre.json (roles: be, pm)')
    expect([host.writes, host.calls]).toEqual([[], []])
    expect(run.asked).toEqual([])
  })

  test('a missing or invalid role.json, or one naming another id, refuses for the first such role', async () => {
    const world = await regenWorld()
    const pmText = world.files[PM_ROLE] ?? ''
    expect(parseRoleJson(pmText)?.id).toBe('pm')
    const cases: readonly (readonly [MemWorld, string])[] = [
      [without(world, BE_ROLE), regenBadRole('be')],
      [withFiles(world, { [BE_ROLE]: '{"schema":1,"id":"be"}' }), regenBadRole('be')],
      [withFiles(world, { [BE_ROLE]: pmText }), regenBadRole('be')],
      [{ ...world, unknownPaths: [BE_ROLE] }, regenBadRole('be')],
      [withFiles(world, { [PM_ROLE]: 'not json' }), regenBadRole('pm')],
      [withFiles(world, { [BE_ROLE]: 'not json', [PM_ROLE]: 'not json' }), regenBadRole('be')],
    ]
    for (const [index, [bad, text]] of cases.entries()) expect([index, await regenBe(bad)]).toEqual([index, text])
  })

  test('with no repo default, the first role in cadre.json order with no framework refuses, naming it', async () => {
    const cases: readonly (readonly [readonly RoleSpec[], string])[] = [
      [team, regenNeedsFramework('be')],
      [[withFramework(templateRole('be'), 'gsd'), templateRole('pm')], regenNeedsFramework('pm')],
    ]
    for (const [roles, text] of cases) expect(await regenBe(await regenWorld(roles, { framework: null }))).toBe(text)
    const framed = team.map(role => withFramework(role, 'none'))
    const reply = await regenBe(await regenWorld(framed, { framework: null }))
    const kinds = opKinds(reply)
    expect([kinds.get(BE_ROLE_PATH), kinds.get('.cadre/be/ROLE.md')]).toEqual([undefined, 'leave'])
    expect(reply).not.toContain(BE_ROLE_PATH)
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test("with no .cadre/manifest.json regen refuses, since it cannot keep the other roles' files (A2)", async () => {
    expect(REGEN_NO_MANIFEST).toBe(
      ".cadre/manifest.json is missing, so regen cannot keep the other roles' files: run /cadre init again.",
    )
    const run = memIo(without(await regenWorld(), MANIFEST), {})
    expect(await runRegen(run.io, { id: 'be', dryRun: true })).toBe(REGEN_NO_MANIFEST)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('a manifest that cannot be read, is too large or is not valid refuses with its own text (A2)', async () => {
    expect(REGEN_BAD_MANIFEST).toBe(
      ".cadre/manifest.json is not valid, so regen cannot keep the other roles' files: run /cadre init again.",
    )
    const world = await regenWorld()
    const worlds: readonly MemWorld[] = [
      withFiles(world, { [MANIFEST]: '{' }),
      withFiles(world, { [MANIFEST]: stableJson({ schema: 2, cadreVersion: '0.2.0', files: [] }) }),
      withFiles(world, { [MANIFEST]: 'x'.repeat(MAX_READ_BYTES + 1) }),
      { ...world, unknownPaths: [MANIFEST] },
      { ...world, realPaths: { [MANIFEST]: '/elsewhere/manifest.json' } },
    ]
    for (const [index, bad] of worlds.entries()) {
      const run = memIo(bad, {})
      expect([index, await runRegen(run.io, { id: 'be', dryRun: true })]).toEqual([index, REGEN_BAD_MANIFEST])
      expect([index, run.asked, run.logged]).toEqual([index, [], []])
    }
  })

  test('the manifest refusal comes last: every earlier refusal still wins without a manifest (A2)', async () => {
    const world = without(await regenWorld(), MANIFEST)
    expect(await runRegen(memIo(world, {}).io, { id: 'qa', dryRun: true })).toBe(regenNoRole('qa', ['be', 'pm']))
    expect(await regenBe(withFiles(world, { [BE_ROLE]: 'not json' }))).toBe(regenBadRole('be'))
    const unframed = without(await regenWorld(team, { framework: null }), MANIFEST)
    expect(await regenBe(unframed)).toBe(regenNeedsFramework('be'))
    expect(await regenBe(without(world, STATE))).toBe(REGEN_NO_STATE)
  })

  test('a valid setup asks and logs nothing, reads no ~/.claude.json or .gitignore, and plans only BE', async () => {
    const linear = '{"mcpServers":{"linear":{"command":"x"}}}'
    const run = memIo(withFiles(await regenWorld(), { '/home/u/.claude.json': linear }), {})
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: memHost(hostWorld({})).io })
    const kinds = opKinds(reply)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
    expect(run.reads).not.toContain('/home/u/.claude.json')
    expect(run.reads).not.toContain('/repo/.gitignore')
    const planned = (await plannedFiles(gitWorld(), team)).map(file => file.path)
    const expected = [...planned.filter(isBeOpPath), '.cadre/manifest.json'].sort(compareText)
    expect([...kinds.keys()]).toEqual(expected)
    // BE's four files; the built CLAUDE.md init wrote is kept with no op (02-GAPS-B2 S1, AUTO-PICK #15).
    expect(expected.filter(path => path.startsWith('.cadre/be/'))).toHaveLength(4)
    expect(reply).not.toContain(BE_ROLE_PATH)
    expect(reply).not.toContain(BE_CLAUDE_MD_PATH)
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('a stored consent re-reads ~/.claude.json once, so an unchanged BE keeps its user MCP deny (A1)', async () => {
    const base = gitWorld({ files: { '/home/u/.claude.json': '{"mcpServers":{"linear":{"command":"x"}}}' } })
    const world = await regenWorld(team, { readUserMcp: true }, base)
    expect(world.files['/repo/.cadre/be/settings.json']).toContain('mcp__linear')
    const run = memIo(world, {})
    const kinds = opKinds(await runRegen(run.io, { id: 'be', dryRun: true }))
    expect([kinds.get('.cadre/be/settings.json'), kinds.get('.cadre/be/ROLE.md')]).toEqual(['leave', 'leave'])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(run.reads.filter(path => path === '/home/u/.claude.json')).toHaveLength(1)
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('every manifest entry outside BE, its launcher and the index is carried, with no op (D-68)', async () => {
    const dropped: DesiredFile = { path: '.cadre/qa/role.json', content: 'an old role\n', mode: 'file' }
    const kinds = opKinds(await regenBe(await regenWorld(team, {}, gitWorld(), [dropped])))
    expect([...kinds.keys()].filter(path => !isBePlanPath(path))).toEqual([])
    expect(kinds.get('.cadre/manifest.json')).toBe('leave')
  })

  test('a deleted ROLE.md or kickoff.txt of the role is planned as a create by regen (A7, #39)', async () => {
    expect(opKinds(await regenBe(await regenWorld())).get('.cadre/be/ROLE.md')).toBe('leave')
    for (const name of ['ROLE.md', 'kickoff.txt']) {
      const kinds = opKinds(await regenBe(without(await regenWorld(), `/repo/.cadre/be/${name}`)))
      expect(kinds.get(`.cadre/be/${name}`)).toBe('create')
    }
  })

  test('the reply is the command, the plan and the ending; --dry-run ends with its note', async () => {
    // The root lists, so the scans give no warning and the reply has no warning line (A4).
    const world = await regenWorld(team, {}, listedWorld())
    const plain = (await regenBe(world, false)).split('\n')
    const dry = (await regenBe(world, true)).split('\n')
    expect([plain[0], ...plain.slice(-2)]).toEqual(['cadre regen be', APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect([dry[0], dry.at(-1)]).toEqual(['cadre regen be --dry-run', DRY_RUN_NOTE])
    expect(plain.slice(1, -2)).toEqual(dry.slice(1, -1))
    // BE's role.json holds no part records, so the CLAUDE.md init built is kept with no op and no note (AUTO-PICK #15).
    const leave = (path: string, mode: FileOp['mode']): FileOp => ({ kind: 'leave', path, mode, note: null })
    const files = (await plannedFiles(listedWorld(), team)).filter(file => isBeOpPath(file.path))
    const ops = [...files.map(file => leave(file.path, file.mode)), leave('.cadre/manifest.json', 'file')]
    expect(dry.slice(1, -1)).toEqual(renderPlan({ ops: ops.sort((a, b) => compareText(a.path, b.path)), warnings: [] }))
  })

  test('the reply shows each scan warning between the file plan and the note, as init prints it (A4)', async () => {
    const world = await regenWorld(team, {}, listedWorld())
    const plain = (await regenBe(world)).split('\n')
    const locations = { ...DEFAULT_LOCATIONS, warnings: ['the root was given through a link'] }
    const run = memIo({ ...world, locations }, {})
    const lines = (await runRegen(run.io, { id: 'be', dryRun: true })).split('\n')
    expect(lines).toEqual([...plain.slice(0, -1), 'warning: the root was given through a link', DRY_RUN_NOTE])
    expect(run.asked).toEqual([])
    expect(run.logged).toEqual([])
  })

  test('a guard only in local settings adds no warning: the reply ends with the note (A4, D-103)', async () => {
    const local = listedWorld({ settings: { user: {}, project: {}, local: GUARD_SETTINGS } })
    const world = await regenWorld(team, {}, local)
    const run = memIo(world, {})
    const dry = (await runRegen(run.io, { id: 'be', dryRun: true })).split('\n')
    const plain = (await regenBe(world, false)).split('\n')
    // The root lists, so the scans give no warning (A4), and a guard only in local settings adds none (D-103).
    expect(dry.filter(line => line.startsWith('warning: '))).toEqual([])
    expect(dry.at(-1)).toBe(DRY_RUN_NOTE)
    expect([plain[0], ...plain.slice(-2)]).toEqual(['cadre regen be', APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
    expect(plain.slice(1, -2)).toEqual(dry.slice(1, -1))
    expect(run.logged).toEqual([])
  })

  test('an edited BE role.json is re-rendered: BE, the index and the manifest change, and PM has no op', async () => {
    const edited: RoleSpec = { ...templateRole('be'), model: 'sonnet', effort: 'high' }
    const before = await plannedFiles(gitWorld(), team)
    const after = await plannedFiles(gitWorld(), [edited, templateRole('pm')])
    const world = withFiles(await regenWorld(), { [BE_ROLE]: textOf(after, BE_ROLE_PATH) })
    const kinds = opKinds(await regenBe(world))
    const isKept = (file: DesiredFile): boolean => textOf(before, file.path) === file.content
    const expected = after
      .filter(file => isBeOpPath(file.path))
      .map(file => [file.path, isKept(file) ? 'leave' : 'change'])
    expect([...kinds.entries()].filter(([path]) => path !== '.cadre/manifest.json')).toEqual(expected)
    expect([kinds.get('.cadre/bin/be'), kinds.get('.cadre/INDEX.md')]).toEqual(['change', 'change'])
    expect(kinds.get('.cadre/manifest.json')).toBe('change')
  })

  test('a role.json edited by hand is the input: no op, no conflict, its disk hash in the manifest (A5)', async () => {
    const files = await plannedFiles(gitWorld(), team)
    const world = await regenWorld()
    const stored: unknown = JSON.parse(world.files[BE_ROLE] ?? '')
    if (!isObject(stored)) throw new Error("BE's role.json is not an object")
    const edited = JSON.stringify({ ...stored, note: 'edited by hand' }, null, 4)
    expect(parseRoleJson(edited)?.id).toBe('be')
    const reply = await regenBe(withFiles(world, { [BE_ROLE]: edited }))
    const kinds = opKinds(reply)
    const paths = [...files.map(file => file.path).filter(isBeOpPath), '.cadre/manifest.json'].sort(compareText)
    expect([...kinds.keys()]).toEqual(paths)
    expect([...kinds.entries()].filter(([, kind]) => kind !== 'leave')).toEqual([['.cadre/manifest.json', 'change']])
    expect(reply).not.toContain(BE_ROLE_PATH)
    const recorded = files.map(file => (file.path === BE_ROLE_PATH ? { ...file, content: edited } : file))
    const kept = opKinds(await regenBe(withFiles(world, { [BE_ROLE]: edited, [MANIFEST]: await manifestOf(recorded) })))
    expect(kept.get('.cadre/manifest.json')).toBe('leave')
    expect([...kept.values()].filter(kind => kind !== 'leave')).toEqual([])
  })

  test('a GSD role is attended while .planning/config.json is not at the required values (D-70, D-72)', async () => {
    const config = '/repo/.planning/config.json'
    const cases: readonly (readonly [string | null, string])[] = [
      ['{"mode":"yolo","workflow":{"text_mode":false}}', 'leave'],
      [null, 'change'],
      ['{"mode":"interactive","workflow":{"text_mode":false}}', 'change'],
    ]
    for (const [text, kind] of cases) {
      const base = text === null ? gitWorld() : withFiles(gitWorld(), { [config]: text })
      const kinds = opKinds(await regenBe(await regenWorld(team, { framework: 'gsd' }, base)))
      expect([text, kinds.get('.cadre/be/ROLE.md')]).toEqual([text, kind])
    }
  })

  test('in claude -p regen gives the same reply as in a terminal session and asks nothing (D-99)', async () => {
    const world = await regenWorld()
    const interactive = await regenBe(world)
    for (const isInteractive of [false, null]) {
      const run = memIo({ ...world, interactive: isInteractive }, {})
      const reply = await runRegen(run.io, { id: 'be', dryRun: true })
      expect(reply).toBe(interactive)
      expect(reply.split('\n')[0]).toBe('cadre regen be --dry-run')
      expect(run.asked).toEqual([])
      expect(reply).not.toContain(NOT_INTERACTIVE_REPLY)
    }
  })

  test('no secret or absolute path of the secret world reaches the regen reply, with consent or not (B5)', async () => {
    const claudeJson = '{"mcpServers":{"linear":{"command":"x","env":{"TOKEN":"sk-FAKE-SECRET-0123456789"}}}}'
    const base = secretWorld({ files: { ...secretWorld().files, '/home/u/.claude.json': claudeJson } })
    for (const readUserMcp of [false, true]) {
      const reply = await regenBe(await regenWorld(team, { readUserMcp }, base))
      expect([readUserMcp, reply.split('\n')[0]]).toEqual([readUserMcp, 'cadre regen be --dry-run'])
      expect([readUserMcp, leaks(reply, [...SECRET_FIXTURES, ...ABSOLUTE_PATH_MARKERS])]).toEqual([readUserMcp, []])
    }
  })
})

describe('regen apply', () => {
  /** BE alone on the built-in default, as `.cadre/cadre.json` lists it. */
  const be = templateRole('be')

  /** The repo-relative paths regen of BE never writes: the repo state and BE's own role.json, its input (A5). */
  const NOT_WRITTEN = ['.cadre/cadre.json', '.cadre/be/role.json']

  /**
   * The repo after an init of BE alone on the built-in default: a listed `.cadre/` folder with cadre.json, BE's
   * role.json and a manifest that records no file, as the faked host's regen world has it.
   */
  function beOnlyWorld(): MemWorld {
    return gitWorld({
      dirs: { '/repo/.git': [], '/repo/.cadre': [] },
      files: {
        '/repo/.cadre/cadre.json': cadreJsonText(stateOf([be])),
        '/repo/.cadre/be/role.json': roleJsonText(be),
        '/repo/.cadre/manifest.json': stableJson({ schema: 1, cadreVersion: '0.2.0', files: [] }),
      },
    })
  }

  test('plain regen writes the files of BE and the manifest last, asking nothing (D-68)', async () => {
    const run = memIo(beOnlyWorld(), {})
    const host = memHost(hostWorld({}))
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })
    // Regen passes no repo parts, so it builds no CLAUDE.md (02-GAPS-B2 S1).
    const files = (await plannedFiles(gitWorld(), [be])).filter(file => file.path !== '.cadre/be/CLAUDE.md')
    const written = files.filter(file => !NOT_WRITTEN.includes(file.path))
    const recorded = files.filter(file => file.path !== '.cadre/cadre.json')
    expect(host.writes).toEqual([
      ...written.map(file => ({ path: `/repo/${file.path}`, text: file.content, isWritten: true })),
      { path: '/repo/.cadre/manifest.json', text: await manifestOf(recorded), isWritten: true },
    ])
    expect(host.calls.map(call => call.argv)).toEqual([['/bin/chmod', '755', '/repo/.cadre/bin/be']])
    const applied = `Applied: wrote ${written.length + 1} files (1 executable).`
    expect(reply.split('\n').slice(-2)).toEqual([applied, NEXT_STEP_NOTE])
    expect([run.asked, run.logged]).toEqual([[], []])
  })

  test('plain regen keeps a hand-edited file, writes its .cadre-new copy and says so (D-67, D-68)', async () => {
    const files = await plannedFiles(gitWorld(), [be])
    const world = gitWorld({
      dirs: { '/repo/.git': [], '/repo/.cadre': [] },
      files: {
        ...onDisk(files),
        '/repo/.cadre/be/ROLE.md': 'edited by hand\n',
        '/repo/.cadre/manifest.json': await manifestOf(files),
      },
    })
    const host = memHost(hostWorld({}))
    const reply = await runRegen(memIo(world, {}).io, { id: 'be', dryRun: false, host: host.io })
    const kinds = opKinds(reply)
    expect([kinds.get('.cadre/be/ROLE.md'), kinds.get('.cadre/be/ROLE.md.cadre-new')]).toEqual(['conflict', 'create'])
    const role = files.find(file => file.path === '.cadre/be/ROLE.md')?.content ?? ''
    expect(host.writes).toEqual([{ path: '/repo/.cadre/be/ROLE.md.cadre-new', text: role, isWritten: true }])
    expect(host.calls).toEqual([])
    expect(reply.split('\n').slice(-2)).toEqual(['Applied: wrote 1 file (0 executable).', NEXT_STEP_NOTE])
  })

  test('a regen whose write failed skips the manifest and says to run regen again (A4)', async () => {
    const host = memHost(hostWorld({ writeFails: ['/repo/.cadre/bin/be'] }))
    const reply = await runRegen(memIo(beOnlyWorld(), {}).io, { id: 'be', dryRun: false, host: host.io })
    const lines = reply.split('\n')
    expect(host.writes.map(write => write.path)).not.toContain('/repo/.cadre/manifest.json')
    expect(lines).toContain(
      'warning: .cadre/manifest.json was not written because a file above was not written: run /cadre regen be again.',
    )
    expect(lines).not.toContain(`warning: ${MANIFEST_SKIPPED_NOTE}`)
    expect(lines.at(-1)).toBe(NEXT_STEP_NOTE)
  })
})

/** A section the root CLAUDE.md gained after init. */
const DEPLOY_SECTION = '## Deploy\nShip on Fridays.\n'

/** The host rules of a plain regen of BE: git names the common dir and tracks the root CLAUDE.md. */
const REGEN_RUNS: readonly HostRunRule[] = [COMMON_DIR_RULE, ...BUILT_TRACKED]

/** A plain `/cadre regen be` in `world` with these answers and host rules: its reply, its port and its host. */
async function regenPlainBe(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  runs: readonly HostRunRule[] = REGEN_RUNS,
): Promise<{ readonly reply: string; readonly run: MemRun; readonly host: MemHost }> {
  const run = memIo(world, answers)
  const host = memHost(hostWorld({ runs }))
  const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: host.io })

  return { reply, run, host }
}

/** The lines of a reply that are warnings. */
function warningLines(reply: string): string[] {
  return reply.split('\n').filter(line => line.startsWith('warning: '))
}

/** BE's role with these part records, given and not given (AUTO-PICK #19 Q1). */
function recordedBe(given: readonly InstructionPart[], notGiven: readonly InstructionPart[]): RoleSpec {
  const records = given.map(recorded)
  if (notGiven.length === 0) return templateRole('be', { instructionParts: records })

  return templateRole('be', { instructionParts: records, instructionPartsNotGiven: notGiven.map(recorded) })
}

/** The hand-out record of BE's global parts and memories, in its role memory folder (G-02-1f Regen, D-140 q2-a). */
async function beRecordPath(): Promise<string> {
  return instructionsRecordPath(await memoryFolder('be'))
}

describe('regen by part hashes (G-02-1f)', () => {
  test('the regen texts are fixed', () => {
    expect(REGEN_ITEM_OPTIONS).toEqual(['Yes', 'No'])
    expect(REGEN_DISMISSED_REASON).toBe('A regen question on instruction parts was dismissed or not answered.')
    expect(regenCancelledReply(REGEN_DISMISSED_REASON)).toBe(
      'regen cancelled, nothing written: A regen question on instruction parts was dismissed or not answered.',
    )
    expect(regenPartQuestion('be', { file: 'CLAUDE.md', heading: '' })).toBe(
      'Should be get "(top of file)" from CLAUDE.md?',
    )
    expect([regenPartContextLine('new', false), regenPartContextLine('changed', true)]).toEqual([
      'New since init. Recommended: no.',
      'Changed since init. Recommended: yes.',
    ])
    expect(regenMemoryQuestion('be', { file: 'squad.md' })).toBe('Should be get the memory "squad.md"?')
    expect(regenMemoryContextLine({ summary: 'Unsigned commits' }, 'changed', false)).toBe(
      'Unsigned commits. Changed since init. Recommended: no.',
    )
    expect(regenMemoryContextLine({ summary: '' }, 'changed', true)).toBe(
      'No summary in MEMORY.md. Changed since init. Recommended: yes.',
    )
    expect(regenHeader(1, 1)).toBe('Regen 1/1')
    expect(partDroppedLine('be', { file: 'CLAUDE.md', heading: 'Git' })).toBe(
      'dropped from be: CLAUDE.md > Git (gone from its file)',
    )
    expect(memoryDroppedLine('be', { file: 'squad.md' })).toBe('dropped from be: memory squad.md (gone)')
    expect([notHandedOutWarning('be', 1), notHandedOutWarning('be', 2)]).toEqual([
      '1 new or changed instruction part or memory for be was not handed out: ' +
        'run /cadre regen be in a session to answer it',
      '2 new or changed instruction parts or memories for be were not handed out: ' +
        'run /cadre regen be in a session to answer them',
    ])
    expect(improverNotOfferedWarning('be')).toBe(
      'the improver was not offered for be: claude -p cannot ask Accept or Keep original; ' +
        'run /cadre regen be in a session to review the changes',
    )
    expect(dryRunPrivateWarning('be')).toBe(
      '--dry-run did not compare the global parts and memories of be: finding their folder runs git; ' +
        'a plain regen compares them',
    )
    expect(unusableRecordWarning('be')).toBe(
      'could not use the hand-out record of be (instructions.json): its global parts and memories were not ' +
        'compared; run /cadre init to hand them out again',
    )
  })

  test('with nothing new, changed or removed regen asks nothing, calls no model and rebuilds nothing', async () => {
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld(), {})
    const kinds = opKinds(reply)
    expect([run.asked, run.prompts, host.writes, gitCalls(host)]).toEqual([[], [], [], []])
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual([undefined, undefined])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(warningLines(reply)).toEqual([])
    expect(reply).not.toContain('no longer generated')
    expect(reply.split('\n').slice(-2)).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
  })

  test('in a session a changed part is asked after one recommendation call; Yes rebuilds and records it', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${REGEN_RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain('\nbe | BE | Implements the backend and core code.\n')
    expect(run.prompts[0]).toContain('\nI1 | CLAUDE.md | Git | ## Git Use signed commits, always.')
    expect(run.asked).toEqual([
      withContext('Should be get "Git" from CLAUDE.md?', 'Changed since init. Recommended: yes.'),
    ])
    expect(run.specs).toEqual([{ options: ['Yes', 'No'], header: 'Regen 1/1' }])
    expect(host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', [edited]), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([edited], [rules])), isWritten: true },
    ])
    expect(host.writes.slice(2).map(write => write.path)).toEqual(['/repo/.cadre/manifest.json'])
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['change', 'change'])
    expect(gitCalls(host).map(call => call.argv)).toEqual([BUILT_GIT_ARGV])
  })

  test('a section new in a named file is asked, one not given is not; after No neither is asked again', async () => {
    const claudeMd = `# Rules\nRun the tests first.\n${GIT_SECTION}${DEPLOY_SECTION}`
    const world = await regenPartsWorld({ claudeMd, over: { replies: ['{"items":{"I1":false}}'] } })
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    expect(first.run.asked).toEqual([
      withContext('Should be get "Deploy" from CLAUDE.md?', 'New since init. Recommended: no.'),
    ])
    const kinds = opKinds(first.reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual([undefined, 'change'])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.run.prompts, again.host.writes]).toEqual([[], [], []])
  })

  test('No to a changed part takes it out of the built file and records it not given, never asked again', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":false}}'] } }
    const world = await regenPartsWorld(changed)
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    expect(first.host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', []), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [rules, edited])), isWritten: true },
    ])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.host.writes]).toEqual([[], []])
  })

  test('a removed section is dropped with its reply line right after the plan; the built file is rebuilt', async () => {
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ claudeMd: RULES_SECTION }), {})
    const lines = reply.split('\n')
    const at = lines.findIndex(line => line.startsWith('Summary: '))
    expect(lines[at + 1]).toBe('dropped from be: CLAUDE.md > Git (gone from its file)')
    expect([run.asked, run.prompts]).toEqual([[], []])
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    expect(host.writes.slice(0, 2)).toEqual([
      { path: BE_CLAUDE_MD, text: roleClaudeMdText('be', []), isWritten: true },
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [rules])), isWritten: true },
    ])
  })

  test('in claude -p nothing is asked: new and changed parts are left out with a warning, records kept', async () => {
    for (const interactive of [false, null]) {
      const claudeMd = `${RULES_SECTION}${GIT_EDITED}${DEPLOY_SECTION}`
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ claudeMd, over: { interactive } }), {})
      expect([interactive, run.asked, run.prompts]).toEqual([interactive, [], []])
      expect([interactive, warningLines(reply)]).toEqual([interactive, [`warning: ${notHandedOutWarning('be', 2)}`]])
      expect(host.writes.map(write => write.path)).toEqual([BE_CLAUDE_MD, '/repo/.cadre/manifest.json'])
      expect(host.writes[0]?.text).toBe(roleClaudeMdText('be', []))
      expect(opKinds(reply).get('.cadre/be/role.json')).toBe(undefined)
    }
  })

  test('a --dry-run in a session asks, plans the rebuild, writes and runs nothing, names what it skipped', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const run = memIo(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const reply = await runRegen(run.io, { id: 'be', dryRun: true })
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['change', 'change'])
    expect(firstLines(run.asked)).toEqual(['Should be get "Git" from CLAUDE.md?'])
    expect(warningLines(reply)).toEqual([`warning: ${dryRunPrivateWarning('be')}`])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(run.reads.filter(path => path.startsWith('/home/u/.claude/cadre'))).toEqual([])
  })

  test('after a plain session regen the improver runs on the rebuilt file if claude-md-management is in', async () => {
    const installed = { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }
    const over = { files: installed, replies: ['{"items":{"I1":true}}'] }
    const world = await regenPartsWorld({ claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over })
    const files: Record<string, string> = { ...world.files }
    const edited = await rootPart('P2', 'Git', GIT_EDITED)
    const improved = `${roleClaudeMdText('be', [edited])}Keep commits small.\n`
    const host = memHost(hostWorld({ runs: REGEN_RUNS }))
    const io: HostIo = {
      ...host.io,
      // Each write that lands is on the disk, so the improver finds the rebuilt file as apply wrote it (02-GAPS-B3 M1).
      write: async (path, text) => {
        const isWritten = await host.io.write(path, text)
        if (isWritten) files[path] = text

        return isWritten
      },
      run: async (argv, options) => {
        const result = await host.io.run(argv, options)
        if (argv.join(' ') === BE_IMPROVER_ARGV.join(' ')) files[BE_CLAUDE_MD] = improved

        return result
      },
    }
    const run = memIo({ ...world, files }, { [REGEN_PART_PREFIX]: 'Yes', [IMPROVER_PREFIX]: 'Accept' })
    const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: io })
    expect(improverCalls(host)).toEqual([
      { argv: BE_IMPROVER_ARGV, options: { cwd: '/repo/.cadre/be', timeoutMs: 300_000 } },
    ])
    expect(reply.split('\n').slice(-2)).toEqual([improverLine({ changed: 1, total: 1 }), NEXT_STEP_NOTE])
    expect(writtenManifestText(host)).toContain(await sha256Hex(improved))
  })

  test('in claude -p a rebuilt file the improver could improve gets the improver warning and no run', async () => {
    const rules = await rootPart('P1', 'Rules', RULES_SECTION)
    const git = await rootPart('P2', 'Git', GIT_SECTION)
    const over = { files: { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }, interactive: false }
    const world = await regenPartsWorld({ claudeMd: RULES_SECTION, over, given: [rules, git], notGiven: [] })
    const { reply, host } = await regenPlainBe(world, {})
    expect(improverCalls(host)).toEqual([])
    expect(warningLines(reply)).toEqual([`warning: ${improverNotOfferedWarning('be')}`])
    expect(host.writes[0]).toEqual({ path: BE_CLAUDE_MD, text: roleClaudeMdText('be', [rules]), isWritten: true })
  })

  test('regen reads again only the files the records name (D-142 rg2-a)', async () => {
    const squad = `${MEMORY_DIR}/squad.md`
    const over = {
      dirs: { [MEMORY_DIR]: [entry('MEMORY.md'), entry('squad.md')], '/repo/.claude/rules': [entry('style.md')] },
      files: {
        '/repo/AGENTS.md': '# Agents\n',
        '/repo/.claude/rules/style.md': '# Style\n',
        [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
        [squad]: `${MEMORY_SENTENCE} (squad)`,
        [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
      },
    }
    const run = memIo(await regenPartsWorld({ over }), {})
    await runRegen(run.io, { id: 'be', dryRun: true })
    const rules = '/repo/.claude/rules/style.md'
    const unnamed = ['/repo/AGENTS.md', rules, `${MEMORY_DIR}/MEMORY.md`, squad, GLOBAL_CLAUDE_MD]
    expect(run.reads).toContain('/repo/CLAUDE.md')
    expect(run.reads.filter(path => unnamed.includes(path))).toEqual([])
  })

  test('a plain regen compares the global parts and memories its record names and rebuilds their files', async () => {
    const security = await partsGlobalPart('P1', 'Security', '# Security\nNever commit secrets.\n')
    const git = await partsGlobalPart('P2', 'Git', '## Git\nUse signed commits.\n')
    const securityEdited = await partsGlobalPart('P1', 'Security', '# Security\nNever commit secrets, ever.\n')
    const squad = await squadMemory()
    const files = {
      [await beRecordPath()]: instructionsRecordText([security], [squad], [git]),
      [GLOBAL_CLAUDE_MD]: '# Security\nNever commit secrets, ever.\n## Git\nUse signed commits.\n',
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
    }
    const world = await regenPartsWorld({ over: { files, replies: ['{"items":{"I1":true}}'] } })
    const { reply, run, host } = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'Yes' })
    expect(run.asked).toEqual([
      withContext('Should be get "Security" from ~/.claude/CLAUDE.md?', 'Changed since init. Recommended: yes.'),
    ])
    const folder = await memoryFolder('be')
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [securityEdited])],
      [instructionsRecordPath(folder), instructionsRecordText([securityEdited], [squad], [git])],
    ])
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
  })

  test('a removed memory is dropped with its reply line; a role left with nothing gets both files empty', async () => {
    const squad = await squadMemory()
    const files = { [await beRecordPath()]: instructionsRecordText([], [squad]) }
    const { reply, host } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
    const folder = await memoryFolder('be')
    expect(reply.split('\n')).toContain('dropped from be: memory squad.md (gone)')
    // A role that had a private record and lost everything gets a header-only text file and an empty record (Q11).
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [])],
      [instructionsRecordPath(folder), instructionsRecordText([], [])],
    ])
  })

  test('a record naming a file outside the config folder or the memory folders is not used (Q9)', async () => {
    const hash = 'a'.repeat(64)
    // A config-folder file that is not a plain .md file outside projects/, cadre/ and plugins/ (02-GAPS-B3 M2).
    const hostile = [
      '~/.claude/settings.json',
      '~/.claude/.credentials.json',
      '~/.claude/projects/x/memory/a.md',
      '~/.claude/cadre/r-12345678/pm/instructions/CLAUDE.md',
    ]
    const records = [
      JSON.stringify({ schema: 1, parts: [{ file: '/etc/notes.md', heading: '', hash }], memories: [] }),
      JSON.stringify({ schema: 1, parts: [{ file: '~/.claude/../.ssh/notes.md', heading: '', hash }], memories: [] }),
      JSON.stringify({ schema: 1, parts: [], memories: [{ file: 'x.md', folder: '/tmp', summary: 's', hash }] }),
      JSON.stringify({ schema: 1, parts: [], memories: [{ file: '../x.md', folder: MEMORY_DIR, summary: 's', hash }] }),
      '{"schema":1}',
      ...hostile.map(file => JSON.stringify({ schema: 1, parts: [{ file, heading: '', hash }], memories: [] })),
    ]
    const hostilePaths = hostile.map(file => `/home/u/${file.slice(2)}`)
    for (const [index, record] of records.entries()) {
      const secrets = Object.fromEntries(hostilePaths.map(path => [path, 'secret']))
      const files = { [await beRecordPath()]: record, '/etc/notes.md': 'secret', '/tmp/x.md': 'secret', ...secrets }
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
      expect([index, warningLines(reply)]).toEqual([index, [`warning: ${unusableRecordWarning('be')}`]])
      const outside = run.reads.filter(path => /^\/(etc|tmp)\//.test(path) || hostilePaths.includes(path))
      expect([index, outside]).toEqual([index, []])
      expect([index, homeWrites(host)]).toEqual([index, []])
    }
    const style = '# Style\nKeep it short.\n'
    const [part] = await partsOfText('~/.claude/notes/style.md', 'global', style, 0)
    const used = JSON.stringify({ schema: 1, parts: [part === undefined ? {} : recorded(part)], memories: [] })
    const files = { [await beRecordPath()]: used, '/home/u/.claude/notes/style.md': style }
    const { reply, run } = await regenPlainBe(await regenPartsWorld({ over: { files } }), {})
    expect([warningLines(reply), run.reads.includes('/home/u/.claude/notes/style.md')]).toEqual([[], true])
  })

  test('a side whose reads pass 512 KiB is left as it is, with a warning; each side has its own cap (C8)', async () => {
    const big = async (file: string): Promise<InstructionPart[]> =>
      partsOfText(file, 'repo', `# ${file}\n${'x'.repeat(200 * 1024)}\n`, 0)
    const docs = [...(await big('docs/a.md')), ...(await big('docs/b.md')), ...(await big('docs/c.md'))]
    const onDiskDocs = Object.fromEntries(docs.map(part => [`/repo/${part.file}`, part.text]))
    const over = { files: onDiskDocs }
    const { reply, run, host } = await regenPlainBe(await regenPartsWorld({ over, notGiven: docs }), {})
    expect(warningLines(reply)).toEqual([`warning: ${regenTotalWarning('be')}`])
    expect([run.asked, host.writes, opKinds(reply).get(BE_CLAUDE_MD_PATH)]).toEqual([[], [], undefined])
    expect(reply).not.toContain('dropped from be')
    expect(regenTotalWarning('be')).toBe(
      'regen stopped reading at 512 KiB for be: its instruction parts were not compared',
    )
    const bigText = `# Big\n${'y'.repeat(200 * 1024)}\n`
    const global = await partsOfText('~/.claude/notes/big.md', 'global', bigText, 0)
    const record = instructionsRecordText(global, [])
    const files = { ...onDiskDocs, [await beRecordPath()]: record, '/home/u/.claude/notes/big.md': bigText }
    const both = await regenPlainBe(await regenPartsWorld({ over: { files }, notGiven: docs.slice(0, 2) }), {})
    const isPrivateRead = both.run.reads.includes('/home/u/.claude/notes/big.md')
    expect([warningLines(both.reply), isPrivateRead]).toEqual([[], true])
  })

  test('a dismissed regen question, or three answers it cannot read, cancels with nothing written (Q7)', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const cases: readonly (readonly [Readonly<Record<string, string>>, string])[] = [
      [{}, REGEN_DISMISSED_REASON],
      [{ [REGEN_PART_PREFIX]: 'maybe', "'maybe' isn't one of": 'maybe' }, NO_USABLE_ANSWER_REASON],
    ]
    for (const [answers, reason] of cases) {
      const { reply, run, host } = await regenPlainBe(await regenPartsWorld(changed), answers)
      expect([reply, host.writes]).toEqual([regenCancelledReply(reason), []])
      expect(run.logged).toEqual([reason])
    }
  })

  test('a named file that cannot be read or is over the read cap leaves the role as it is (Q8)', async () => {
    const big = 'x'.repeat(MAX_READ_BYTES + 1)
    const worlds: readonly (readonly [MemWorld, string])[] = [
      [await regenPartsWorld({ over: { unknownPaths: ['/repo/CLAUDE.md'] } }), unreadableWarning('CLAUDE.md')],
      [await regenPartsWorld({ claudeMd: big }), overSizeWarning('CLAUDE.md')],
    ]
    for (const [world, warning] of worlds) {
      const { reply, run, host } = await regenPlainBe(world, {})
      expect(warningLines(reply)).toEqual([`warning: ${warning}`])
      expect([run.asked, host.writes]).toEqual([[], []])
    }
  })

  test('an unusable recommendation is sent back with its errors; after three, no item is recommended', async () => {
    const replies = ['not json', '{"items":{"I9":true}}', '{"items":{"I1":"yes"}}']
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies } }
    const { run } = await regenPlainBe(await regenPartsWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    expect(run.prompts).toHaveLength(3)
    expect(run.prompts.map(prompt => prompt.split('\n').at(-1)).slice(1)).toEqual([
      '- the reply is not JSON',
      '- unknown item "I9"',
    ])
    expect(run.asked).toEqual([
      withContext('Should be get "Git" from CLAUDE.md?', 'Changed since init. Recommended: no.'),
    ])
  })

  test('a changed memory is asked with the summary its record holds, and MEMORY.md is not read (Q10)', async () => {
    const squad = await squadMemory()
    const files = {
      [await beRecordPath()]: instructionsRecordText([], [squad]),
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad, edited)`,
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
    }
    const world = await regenPartsWorld({ over: { files, replies: ['{"items":{"I1":false}}'] } })
    const { run, host } = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    const context = 'Unsigned commits on per-phase branches. Changed since init. Recommended: no.'
    expect(run.asked).toEqual([withContext('Should be get the memory "squad.md"?', context)])
    expect(run.reads).not.toContain(`${MEMORY_DIR}/MEMORY.md`)
    const folder = await memoryFolder('be')
    // No takes the memory out of the record (Q1); the role is left with nothing, so both files say so (Q11).
    expect(homeWrites(host).map(write => [write.path, write.text])).toEqual([
      [privateClaudeMdPath(folder), privateClaudeMdText('be', 'repo', [])],
      [instructionsRecordPath(folder), instructionsRecordText([], [])],
    ])
  })

  test('a role.json written before the records regens as before and keeps the built CLAUDE.md with no op', async () => {
    const world = await regenPartsWorld({ claudeMd: RULES_SECTION })
    const unrecorded = roleJsonText(templateRole('be'))
    const before = { ...world, files: { ...world.files, '/repo/.cadre/be/role.json': unrecorded } }
    const run = memIo(before, {})
    const reply = await runRegen(run.io, { id: 'be', dryRun: true })
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).toBe(undefined)
    expect(reply).not.toContain('no longer generated')
    expect(reply).not.toContain('dropped from be')
    expect(run.reads).not.toContain('/repo/CLAUDE.md')
    expect([run.asked, warningLines(reply)]).toEqual([[], []])
  })

  test('init records the repo parts of each parts-flow role and the other parts of their files only', async () => {
    const topics = [
      { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
      { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
      { title: 'Git', summary: 'How commits are made.', parts: ['P3'] },
    ]
    const world = builtWorld({
      dirs: { '/repo/.git': [], ...FULL_DIRS, [MEMORY_DIR]: [entry('squad.md')] },
      files: {
        ...FULL_FILES,
        [GLOBAL_CLAUDE_MD]: `# Security\n${GLOBAL_SENTENCE}.\n`,
        '/repo/CLAUDE.md': `# Rules\n${BUILT_RULE}\n${GIT_SECTION}`,
        [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad)`,
      },
      replies: [
        JSON.stringify({ topics }),
        '{"topics":{"T1":["security"],"T2":["be"],"T3":["tl"]},"memories":{"M1":["security"]}}',
      ],
    })
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const written = (id: string): string =>
      host.writes.find(write => write.path === `/repo/.cadre/${id}/role.json`)?.text ?? ''
    const rules = await rootPart('P2', 'Rules', `# Rules\n${BUILT_RULE}\n`)
    const git = await rootPart('P3', 'Git', GIT_SECTION)
    expect(written('be')).toBe(roleJsonText(recordedBe([rules], [git])))
    expect(parseRoleJson(written('tl'))?.instructionParts).toEqual([recorded(git)])
    expect(parseRoleJson(written('tl'))?.instructionPartsNotGiven).toEqual([recorded(rules)])
    const security = parseRoleJson(written('security'))
    expect([security?.instructionParts, security?.instructionPartsNotGiven]).toEqual([[], undefined])
    const secrets = [
      '~/.claude',
      GLOBAL_SENTENCE,
      await sha256Hex(`# Security\n${GLOBAL_SENTENCE}.\n`),
      'squad.md',
      await sha256Hex(`${MEMORY_SENTENCE} (squad)`),
    ]
    const roleJsons = host.writes.filter(write => write.path.endsWith('/role.json')).map(write => write.text)
    expect(leaks(roleJsons.join('\n'), secrets)).toEqual([])
  })
})
