import { describe, expect, test } from 'claude-code/testing'

import type {
  CadreState,
  DesiredFile,
  FileOp,
  GsdFact,
  HostIo,
  HostRun,
  InitFacts,
  InstructionPart,
  LaunchStart,
  MemoryItem,
  RoleSpec,
} from '../../types'
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
import { cadreJsonText, roleJsonText } from '../generate/docs'
import { GIT_COMMON_DIR_ARGV } from '../git/common-dir'
import { homeRootReply } from '../guards/refusals'
import { NOT_INTERACTIVE_REPLY } from '../guards/repo'
import { runInit } from '../init/run'
import { DRY_RUN_NOTE, renderPlan } from '../plan/text'
import { CLAUDE_MD_PLUGIN } from '../roles/infra'
import { parseRoleJson } from '../roles/rolejson'
import { MAX_READ_BYTES } from '../scan/facts/normalize'
import { unreadableWarning } from '../scan/instructions/memories'
import { overSizeWarning, partsOfText } from '../scan/instructions/read'
import { REGEN_RECOMMEND_SYSTEM } from '../suggest/regen'
import {
  REGEN_BAD_STATE,
  REGEN_CADRE_ROLE,
  REGEN_NO_STATE,
  regenBadRole,
  regenNeedsFramework,
  regenNoRole,
} from '../team'
import {
  ABSOLUTE_PATH_MARKERS,
  BUILT_RULE,
  builtWorld,
  DEFAULT_LOCATIONS,
  EMPTY_FACTS,
  entry,
  firstLines,
  FULL_DIRS,
  FULL_FILES,
  GIT_SECTION,
  gitWorld,
  GLOBAL_CLAUDE_MD,
  GLOBAL_SENTENCE,
  hostWorld,
  leaks,
  manifestOf,
  memHost,
  memIo,
  MEMORY_DIR,
  MEMORY_INDEX,
  MEMORY_SENTENCE,
  NUL,
  onDisk,
  PARTS_ANSWERS,
  PARTS_GLOBAL,
  plannedFiles,
  recorded,
  regenPartsWorld,
  rootPart,
  RULES_SECTION,
  SECRET_FIXTURES,
  secretWorld,
  stateOf,
  templateRole,
  withFramework,
  withWrites,
} from '../testkit'
import type { HostCall, HostRunRule, HostWrite, MemHost, MemRun, MemWorld, RegenFixture } from '../testkit'
import { NO_USABLE_ANSWER_REASON, withContext } from '../ui/ask'
import { PANE_DESKTOP } from '../ui/surfaces/pane-desktop'
import { improverNotOfferedWarning } from './plan'
import {
  loadsAsNowWarning,
  memoryDroppedLine,
  notHandedOutWarning,
  partDroppedLine,
  REGEN_DISMISSED_REASON,
  REGEN_ITEM_OPTIONS,
  regenHeader,
  regenMemoryContextLine,
  regenMemoryQuestion,
  regenPartContextLine,
  regenPartQuestion,
} from './review'
import { regenCancelledReply, runRegen } from './run'
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

/** BE's built CLAUDE.md, repo-relative, as a file plan names it. */
const BE_CLAUDE_MD_PATH = '.cadre/be/CLAUDE.md'

/** The fixture user's installed_plugins.json with claude-md-management installed at user scope (D-141). */
function claudeMdInstalled(): string {
  return JSON.stringify({ plugins: { [CLAUDE_MD_PLUGIN]: [{ scope: 'user', version: '1.0.0' }] } })
}

/** The improver runs a host was asked for, `claude -p`, in order. */
function improverCalls(host: MemHost): HostCall[] {
  return host.calls.filter(call => call.argv[0] === 'claude' && call.argv[1] === '-p')
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

/** The Git section after an edit. */
const GIT_EDITED = '## Git\nUse signed commits, always.\n'

/** The start of a regen question about a part or a memory for BE (G-02-1f Regen, D-142). */
const REGEN_PART_PREFIX = 'Should be get'

/** The installed_plugins.json of the fixture user, whose home is /home/u (DEFAULT_LOCATIONS). */
const INSTALLED_PLUGINS_PATH = '/home/u/.claude/plugins/installed_plugins.json'

/** A user-level GSD install found but not proven (WF-S1, D-243). */
const UNPROVEN_USER: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: null,
  identity: 'unknown',
  runtimeIdentityTried: false,
}

/** A repo-local GSD install found but not proven, which is never run (WF-S1, D-28). */
const UNPROVEN_LOCAL: GsdFact = { ...UNPROVEN_USER, location: 'project', dir: '<repo>/.claude/gsd-core' }

/** The warning of UNPROVEN_USER as the user reads it (WF-S1). */
const USER_LINE = 'could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)'

/** The warning of UNPROVEN_LOCAL as the user reads it (WF-S1). */
const LOCAL_LINE = 'could not prove the GSD install at <repo>/.claude/gsd-core (treated as unknown)'

/** Facts holding UNPROVEN_USER and UNPROVEN_LOCAL, each with its warning (WF-S1). */
const UNPROVEN_FACTS: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [UNPROVEN_USER, UNPROVEN_LOCAL], warnings: [USER_LINE, LOCAL_LINE] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

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
      homeRootReply('regen'),
    )
    expect([host.writes, host.calls]).toEqual([[], []])
    expect(run.reads).toEqual([])
    expect(run.asked).toEqual([])
  })

  test('a regen sets the scan loader before its full scan, with the summary init shows (D-285, S-02)', async () => {
    const run = memIo(await regenWorld(), {})
    await runRegen(run.io, { id: 'be', dryRun: true })
    expect(run.progress[0]).toBe('Scanning the repo…')
    expect(run.progressSummaries[0]).toBe('the repo, your settings, plugins, skills and MCP servers')
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

  test('a cadre.json that lists the reserved role id cadre gets its own refusal, naming the rename', async () => {
    const world = await regenWorld()
    const state = stateOf(team)
    const run = memIo(withFiles(world, { [STATE]: stableJson({ ...state, roles: ['pm', 'cadre'] }) }), {})

    expect(REGEN_CADRE_ROLE).toBe(
      '.cadre/cadre.json lists the role id "cadre", which is reserved: cadre signs its own inbox entries with it. ' +
        'Run /cadre init again and give that role another id.',
    )
    expect(await runRegen(run.io, { id: 'be', dryRun: true })).toBe(REGEN_CADRE_ROLE)
    expect(run.asked).toEqual([])
    expect(await regenBe(withFiles(world, { [STATE]: stableJson({ ...state, schema: 2 }) }))).toBe(REGEN_BAD_STATE)
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
      [[withFramework(templateRole('be'), 'gsd'), templateRole('tl')], regenNeedsFramework('tl')],
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

  test(
    'regen --dry-run leaves out the unproven user-level GSD line; a repo-local one stays (WF-S1, D-243)',
    async () => {
      const world = await regenWorld(team, {}, listedWorld({ facts: UNPROVEN_FACTS }))
      const run = memIo(world, {})
      const reply = await runRegen(run.io, { id: 'be', dryRun: true })

      expect([reply.includes(USER_LINE), reply.includes(LOCAL_LINE)]).toEqual([false, true])
    },
  )

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
    // Regen passes no repo parts, so it builds no CLAUDE.md (02-GAPS-B2 S1), and only init plans the sizing rubric.
    const notRegenerated = ['.cadre/be/CLAUDE.md', '.cadre/sizing.md']
    const files = (await plannedFiles(gitWorld(), [be])).filter(file => !notRegenerated.includes(file.path))
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

const LOADS_AS_NOW_BE =
  'warning: 1 repo instruction file given to be changed since init and loads as it is now: ' +
  'run /cadre regen be in a session to review it'

const NOT_HANDED_OUT_BE =
  'warning: 1 new or changed instruction part or memory for be was not handed out: ' +
  'run /cadre regen be in a session to answer it'

const AGENTS_TRACKED: readonly HostRunRule[] = [
  { argv: ['git', '--literal-pathspecs', 'ls-files', '-z', '--', 'AGENTS.md'], result: trackedRun(['AGENTS.md']) },
]

/** The root AGENTS.md with this text as the read gives it: one whole-file repo part. */
async function agentsPart(text: string): Promise<InstructionPart> {
  return { id: 'P1', file: 'AGENTS.md', heading: '', source: 'repo', text, hash: await sha256Hex(text) }
}

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

/**
 * A plain `/cadre regen be` in `world` whose host puts each write that lands on the disk, so an improver run would
 * find each rebuilt file as apply wrote it: its reply, its port and its host.
 */
async function regenOnDisk(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
): Promise<{ readonly reply: string; readonly run: MemRun; readonly host: MemHost }> {
  const files: Record<string, string> = { ...world.files }
  const host = memHost(hostWorld({ runs: REGEN_RUNS }))
  const io: HostIo = {
    ...host.io,
    write: async (path, text) => {
      const isWritten = await host.io.write(path, text)
      if (isWritten) files[path] = text

      return isWritten
    },
  }
  const run = memIo({ ...world, files }, answers)
  const reply = await runRegen(run.io, { id: 'be', dryRun: false, host: io })

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

/** The root CLAUDE.md of the regen cases as init gave it to BE. */
const ROOT_TEXT = `${RULES_SECTION}${GIT_SECTION}`

/** The root CLAUDE.md with this text as the read gives it: one whole-file repo part. */
async function wholeRoot(text: string = ROOT_TEXT): Promise<InstructionPart> {
  return rootPart('P1', '', text)
}

/** regenPartsWorld with BE's records as init writes them: the whole root CLAUDE.md given, nothing not given. */
async function wholeWorld(fixture: RegenFixture = {}): Promise<MemWorld> {
  return regenPartsWorld({ given: [await wholeRoot()], notGiven: [], ...fixture })
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
    expect([loadsAsNowWarning('be', 1), loadsAsNowWarning('be', 2)]).toEqual([
      '1 repo instruction file given to be changed since init and loads as it is now: ' +
        'run /cadre regen be in a session to review it',
      '2 repo instruction files given to be changed since init and load as they are now: ' +
        'run /cadre regen be in a session to review them',
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
    const { reply, run, host } = await regenPlainBe(await wholeWorld(), {})
    const kinds = opKinds(reply)
    expect([run.asked, run.prompts, host.writes, gitCalls(host)]).toEqual([[], [], [], []])
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual([undefined, undefined])
    expect([...kinds.values()].filter(kind => kind !== 'leave')).toEqual([])
    expect(warningLines(reply)).toEqual([])
    expect(reply).not.toContain('no longer generated')
    expect(reply.split('\n').slice(-2)).toEqual([APPLIED_NONE_NOTE, NEXT_STEP_NOTE])
  })

  test('a regen run takes its surface and a page width reader, and asks as before (D-285, D-292)', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const answers = { [REGEN_PART_PREFIX]: 'Yes' }
    const plain = memIo(await wholeWorld(changed), answers)
    const plainReply = await runRegen(plain.io, { id: 'be', dryRun: true })
    const given = memIo(await wholeWorld(changed), answers)
    const reply = await runRegen(given.io, { id: 'be', dryRun: true, surface: PANE_DESKTOP, pageColumns: () => 60 })
    expect([reply, given.asked, given.specs]).toEqual([plainReply, plain.asked, plain.specs])
  })

  test('in a session a changed part is asked after one recommendation call; Yes records it in role.json', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const { reply, run, host } = await regenPlainBe(await wholeWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const edited = await wholeRoot(`${RULES_SECTION}${GIT_EDITED}`)
    const question = 'Should be get "(top of file)" from CLAUDE.md?'
    const item = '\nI1 | CLAUDE.md | (top of file) | # Rules Run the tests. ## Git Use signed commits, always.'
    expect(run.prompts).toHaveLength(1)
    expect(run.prompts[0]?.startsWith(`${REGEN_RECOMMEND_SYSTEM}\n---\n`)).toBe(true)
    expect(run.prompts[0]).toContain('\nbe | BE | Implements the backend and core code.\n')
    expect(run.prompts[0]).toContain(item)
    expect(run.asked).toEqual([withContext(question, 'Changed since init. Recommended: yes.')])
    expect(run.specs).toEqual([
      {
        options: ['Yes', 'No'],
        header: 'Regen 1/1',
        context: {
          title: 'Regen 1 of 1',
          lines: ['CLAUDE.md > (top of file)', 'Changed since init.', 'Recommended: yes'],
          kind: 'regen-part',
          // Its summary, which a pane surface asks under the question, is whether the model recommends it.
          summary: 'Recommended: yes',
          pane: {
            asked: withContext(question, 'Changed since init. Recommended: yes.'),
            text: withContext(question, 'Recommended: yes'),
          },
          rows: [
            {
              title: null,
              rows: [
                { role: 'plain', text: 'CLAUDE.md > (top of file)', indent: 0 },
                { role: 'plain', text: 'Changed since init.', indent: 0 },
                { role: 'field', label: 'Recommended', text: 'yes', indent: 0 },
              ],
            },
          ],
        },
      },
    ])
    expect(host.writes.slice(0, 1)).toEqual([
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([edited], [])), isWritten: true },
    ])
    expect(host.writes.slice(1).map(write => write.path)).toEqual(['/repo/.cadre/manifest.json'])
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['leave', 'change'])
    expect(gitCalls(host).map(call => call.argv)).toEqual([BUILT_GIT_ARGV])
  })

  test('a file changed anywhere is asked once as a changed part', async () => {
    const claudeMd = `${ROOT_TEXT}${DEPLOY_SECTION}`
    const world = await wholeWorld({ claudeMd, over: { replies: ['{"items":{"I1":false}}'] } })
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    expect(first.run.asked).toEqual([
      withContext('Should be get "(top of file)" from CLAUDE.md?', 'Changed since init. Recommended: no.'),
    ])
    const kinds = opKinds(first.reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['leave', 'change'])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.run.prompts, again.host.writes]).toEqual([[], [], []])
  })

  test('No to a changed part records it not given in role.json, never asked again', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":false}}'] } }
    const world = await wholeWorld(changed)
    const first = await regenPlainBe(world, { [REGEN_PART_PREFIX]: 'No' })
    const edited = await wholeRoot(`${RULES_SECTION}${GIT_EDITED}`)
    expect(first.host.writes.slice(0, 1)).toEqual([
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [edited])), isWritten: true },
    ])
    expect(first.host.writes.slice(1).map(write => write.path)).toEqual(['/repo/.cadre/manifest.json'])
    const again = await regenPlainBe(withWrites(world, first.host.writes), {})
    expect([again.run.asked, again.host.writes]).toEqual([[], []])
  })

  test('a recorded file that is gone is dropped with its reply line', async () => {
    const { reply, run, host } = await regenPlainBe(await wholeWorld({ claudeMd: null }), {})
    const lines = reply.split('\n')
    const at = lines.findIndex(line => line.startsWith('Summary: '))
    expect(lines[at + 1]).toBe('dropped from be: CLAUDE.md > (top of file) (gone from its file)')
    expect([run.asked, run.prompts]).toEqual([[], []])
    expect(host.writes.slice(0, 1)).toEqual([
      { path: '/repo/.cadre/be/role.json', text: roleJsonText(recordedBe([], [])), isWritten: true },
    ])
  })

  test(
    'in claude -p nothing is asked: a changed given file stays given and loads as it is now, records kept',
    async () => {
      for (const interactive of [false, null]) {
        const claudeMd = `${RULES_SECTION}${GIT_EDITED}${DEPLOY_SECTION}`
        const { reply, run, host } = await regenPlainBe(await wholeWorld({ claudeMd, over: { interactive } }), {})
        expect([interactive, run.asked, run.prompts]).toEqual([interactive, [], []])
        expect([interactive, warningLines(reply)]).toEqual([interactive, [LOADS_AS_NOW_BE]])
        expect([interactive, host.writes]).toEqual([interactive, []])
        expect(opKinds(reply).get('.cadre/be/role.json')).toBe(undefined)
      }
    },
  )

  test('in claude -p a changed given AGENTS.md stays given: the built file keeps its @ line', async () => {
    const world = await regenPartsWorld({
      given: [await agentsPart('# Agents\n')],
      notGiven: [],
      claudeMd: null,
      over: { interactive: false, files: { '/repo/AGENTS.md': '# Agents\nRun the linter.\n' } },
    })
    expect(world.files['/repo/.cadre/be/CLAUDE.md']).toContain('@../../AGENTS.md')
    const { reply, run, host } = await regenPlainBe(world, {}, [COMMON_DIR_RULE, ...AGENTS_TRACKED])
    expect([run.asked, run.prompts]).toEqual([[], []])
    expect(warningLines(reply)).toEqual([LOADS_AS_NOW_BE])
    expect(host.writes).toEqual([])
    expect(opKinds(reply).get('.cadre/be/role.json')).toBe(undefined)
    expect(opKinds(reply).get(BE_CLAUDE_MD_PATH)).not.toBe('change')
  })

  test(
    'in claude -p a file a given section record names loads whole; one only not-given records name stays left out',
    async () => {
      const held = await regenPlainBe(await regenPartsWorld({ over: { interactive: false } }), {})
      expect(warningLines(held.reply)).toEqual([LOADS_AS_NOW_BE])
      expect(held.host.writes).toEqual([])
      const notGiven = [await rootPart('P1', 'Rules', RULES_SECTION)]
      const world = await regenPartsWorld({ given: [], notGiven, over: { interactive: false } })
      const leftOut = await regenPlainBe(world, {})
      expect(warningLines(leftOut.reply)).toEqual([NOT_HANDED_OUT_BE])
      expect(leftOut.host.writes).toEqual([])
    },
  )

  test('a --dry-run in a session asks, plans the rebuild, writes and runs nothing, names what it skipped', async () => {
    const changed = { claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over: { replies: ['{"items":{"I1":true}}'] } }
    const run = memIo(await wholeWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    const reply = await runRegen(run.io, { id: 'be', dryRun: true })
    const kinds = opKinds(reply)
    expect([kinds.get(BE_CLAUDE_MD_PATH), kinds.get('.cadre/be/role.json')]).toEqual(['leave', 'change'])
    expect(firstLines(run.asked)).toEqual(['Should be get "(top of file)" from CLAUDE.md?'])
    expect(warningLines(reply)).toEqual([`warning: ${dryRunPrivateWarning('be')}`])
    expect(reply.split('\n').at(-1)).toBe(DRY_RUN_NOTE)
    expect(run.reads.filter(path => path.startsWith('/home/u/.claude/cadre'))).toEqual([])
  })

  test('a plain session regen of changed repo parts runs no improver: the built file is never offered', async () => {
    const over = { files: { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }, replies: ['{"items":{"I1":true}}'] }
    const world = await wholeWorld({ claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over })
    const { reply, host } = await regenOnDisk(world, { [REGEN_PART_PREFIX]: 'Yes' })
    expect(improverCalls(host)).toEqual([])
    expect(reply.split('\n').filter(line => line.startsWith('Improver:'))).toEqual([])
    expect(warningLines(reply)).toEqual([])
  })

  test('a plain session regen of changed repo parts sets no improver loader (D-285, S-02)', async () => {
    const over = { files: { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }, replies: ['{"items":{"I1":true}}'] }
    const world = await wholeWorld({ claudeMd: `${RULES_SECTION}${GIT_EDITED}`, over })
    const { run, host } = await regenOnDisk(world, { [REGEN_PART_PREFIX]: 'Yes' })
    expect(improverCalls(host)).toEqual([])
    expect(run.progress).not.toContain('Running the improver…')
  })

  test('in claude -p a regen of changed repo parts gets no improver warning and no run', async () => {
    const over = { files: { [INSTALLED_PLUGINS_PATH]: claudeMdInstalled() }, interactive: false }
    const world = await wholeWorld({ claudeMd: RULES_SECTION, over })
    const { reply, host } = await regenPlainBe(world, {})
    expect(improverCalls(host)).toEqual([])
    expect(warningLines(reply)).toEqual([LOADS_AS_NOW_BE])
    expect(host.writes).toEqual([])
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
    const run = memIo(await wholeWorld({ over }), {})
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
    const world = await wholeWorld({ over: { files, replies: ['{"items":{"I1":true}}'] } })
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
    const { reply, host } = await regenPlainBe(await wholeWorld({ over: { files } }), {})
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
      const { reply, run, host } = await regenPlainBe(await wholeWorld({ over: { files } }), {})
      expect([index, warningLines(reply)]).toEqual([index, [`warning: ${unusableRecordWarning('be')}`]])
      const outside = run.reads.filter(path => /^\/(etc|tmp)\//.test(path) || hostilePaths.includes(path))
      expect([index, outside]).toEqual([index, []])
      expect([index, homeWrites(host)]).toEqual([index, []])
    }
    const style = '# Style\nKeep it short.\n'
    const [part] = await partsOfText('~/.claude/notes/style.md', 'global', style, 0)
    const used = JSON.stringify({ schema: 1, parts: [part === undefined ? {} : recorded(part)], memories: [] })
    const files = { [await beRecordPath()]: used, '/home/u/.claude/notes/style.md': style }
    const { reply, run } = await regenPlainBe(await wholeWorld({ over: { files } }), {})
    expect([warningLines(reply), run.reads.includes('/home/u/.claude/notes/style.md')]).toEqual([[], true])
  })

  test('a side whose reads pass 512 KiB is left as it is, with a warning; each side has its own cap (C8)', async () => {
    const big = async (file: string): Promise<InstructionPart[]> =>
      partsOfText(file, 'repo', `# ${file}\n${'x'.repeat(200 * 1024)}\n`, 0)
    const docs = [...(await big('docs/a.md')), ...(await big('docs/b.md')), ...(await big('docs/c.md'))]
    const onDiskDocs = Object.fromEntries(docs.map(part => [`/repo/${part.file}`, part.text]))
    const over = { files: onDiskDocs }
    const { reply, run, host } = await regenPlainBe(await wholeWorld({ over, notGiven: docs }), {})
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
    const both = await regenPlainBe(await wholeWorld({ over: { files }, notGiven: docs.slice(0, 2) }), {})
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
      const { reply, run, host } = await regenPlainBe(await wholeWorld(changed), answers)
      expect([reply, host.writes]).toEqual([regenCancelledReply(reason), []])
      expect(run.logged).toEqual([])
    }
  })

  test('a named file that cannot be read or is over the read cap leaves the role as it is (Q8)', async () => {
    const big = 'x'.repeat(MAX_READ_BYTES + 1)
    const worlds: readonly (readonly [MemWorld, string])[] = [
      [await wholeWorld({ over: { unknownPaths: ['/repo/CLAUDE.md'] } }), unreadableWarning('CLAUDE.md')],
      [await wholeWorld({ claudeMd: big }), overSizeWarning('CLAUDE.md')],
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
    const { run } = await regenPlainBe(await wholeWorld(changed), { [REGEN_PART_PREFIX]: 'Yes' })
    expect(run.prompts).toHaveLength(3)
    expect(run.prompts.map(prompt => prompt.split('\n').at(-1)).slice(1)).toEqual([
      '- the reply is not JSON',
      '- unknown item "I9"',
    ])
    expect(run.asked).toEqual([
      withContext('Should be get "(top of file)" from CLAUDE.md?', 'Changed since init. Recommended: no.'),
    ])
  })

  test('a changed memory is asked with the summary its record holds, and MEMORY.md is not read (Q10)', async () => {
    const squad = await squadMemory()
    const files = {
      [await beRecordPath()]: instructionsRecordText([], [squad]),
      [`${MEMORY_DIR}/squad.md`]: `${MEMORY_SENTENCE} (squad, edited)`,
      [`${MEMORY_DIR}/MEMORY.md`]: MEMORY_INDEX,
    }
    const world = await wholeWorld({ over: { files, replies: ['{"items":{"I1":false}}'] } })
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
    const world = await wholeWorld({ claudeMd: RULES_SECTION })
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

  test('init records each given repo file once', async () => {
    const topics = [
      { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
      { title: 'Repo rules', summary: 'The rules of this repo.', parts: ['P2'] },
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
        '{"topics":{"T1":["security"],"T2":["be","tl"]},"memories":{"M1":["security"]}}',
      ],
    })
    const host = memHost(hostWorld({ runs: [...BUILT_TRACKED, COMMON_DIR_RULE] }))
    await runInit(memIo(world, PARTS_ANSWERS).io, { dryRun: false, host: host.io })
    const written = (id: string): string =>
      host.writes.find(write => write.path === `/repo/.cadre/${id}/role.json`)?.text ?? ''
    const whole = await rootPart('P2', '', `# Rules\n${BUILT_RULE}\n${GIT_SECTION}`)
    expect(written('be')).toBe(roleJsonText(recordedBe([whole], [])))
    const tl = parseRoleJson(written('tl'))
    expect([tl?.instructionParts, tl?.instructionPartsNotGiven]).toEqual([[recorded(whole)], undefined])
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
