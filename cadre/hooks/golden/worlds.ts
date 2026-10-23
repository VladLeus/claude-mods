/**
 * The worlds of the golden suite (D-219), each with the answers its init run is given, and the desiredFiles inputs:
 * test support, not a test itself. The fixture constants and builders below are copied byte-identically from
 * init.test.ts and generate.test.ts (only `export` added where a golden module needs one), so a golden runs the world
 * its source spec runs. Only the golden modules import it.
 */
import type {
  CadreState,
  CompiledScope,
  Facts,
  FrameworkId,
  GsdFact,
  HostRun,
  InitFacts,
  InitIo,
  ManifestEntry,
  RoleSpec,
  ScopeContext,
} from '../../types'
import { cadreJsonText, roleJsonText } from '../generate'
import type { GenerateInput } from '../generate'
import { sha256Hex } from '../hash'
import { CONTENT_QUESTION, INSTRUCTIONS_ENTRY_QUESTION } from '../instructions'
import { stableJson } from '../plan'
import { ROLE_TEMPLATE, roleFromTemplate } from '../roles'
import { compileScope } from '../scope'
import {
  EMPTY_FACTS,
  emptySetupScan,
  entry,
  gitWorld,
  INIT_ANSWERS,
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
