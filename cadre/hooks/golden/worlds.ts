/**
 * The worlds of the golden suite (D-219), each with the answers its init run is given: test support, not a test
 * itself. The fixture constants and builders below are copied byte-identically from init.test.ts (only `export` added
 * where a golden module needs one), so a golden runs the world its source spec runs. Only the golden modules import it.
 */
import type { Facts, GsdFact, InitFacts, InitIo } from '../../types'
import { CONTENT_QUESTION, INSTRUCTIONS_ENTRY_QUESTION } from '../instructions'
import { EMPTY_FACTS, entry, gitWorld, INIT_ANSWERS, memIo, secretWorld, USER_DIR_LISTED } from '../testkit'
import type { MemRun, MemWorld } from '../testkit'

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
