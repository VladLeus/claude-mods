import { describe, expect, test } from 'claude-code/testing'

import { isDirInsideRoot } from '../paths'
import { entry, link, memIo, memWorld } from '../testkit'
import type { MemWorld } from '../testkit'
import { MAX_RULE_ENTRIES, MAX_RULE_LEVELS, ruleFiles, RULES_FOLDER } from './rules'
import type { RuleWalk } from './rules'

/** The rules folder of the fixture repo. */
const RULES_DIR = '/repo/.claude/rules'

/** The walk the instruction read uses: links are not taken, and a folder must lie inside the repo (02-GAPS-B2 M4). */
const READER_WALK: RuleWalk = { isTakenLink: false, isFolderUsable: stat => isDirInsideRoot(stat, '/repo') }

/** The walk the parts-flow excludes use: links are taken, and any folder with a stat is listed (02-GAPS-B2 M4). */
const EXCLUDES_WALK: RuleWalk = { isTakenLink: true, isFolderUsable: stat => stat !== null }

/** The rule files of a world as one walk gives them. */
async function rulesOfWorld(world: MemWorld, walk: RuleWalk): Promise<readonly string[] | null> {
  return ruleFiles(memIo(world, []).io, '/repo', walk)
}

describe('rule walk (02-GAPS-B2 M4)', () => {
  test('the walk is bounded: .claude/rules, at most 5 folder levels and 500 listed entries', () => {
    expect([RULES_FOLDER, MAX_RULE_LEVELS, MAX_RULE_ENTRIES]).toEqual(['.claude/rules', 5, 500])
  })

  test('the .md files of .claude/rules and its sub-folders, relative to it, in compareText order', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('x', 'dir'), entry('a.md'), entry('frontend', 'dir'), entry('notes.txt')],
        [`${RULES_DIR}/frontend`]: [entry('react.md')],
        [`${RULES_DIR}/x`]: [entry('y', 'dir')],
        [`${RULES_DIR}/x/y`]: [entry('z.md')],
      },
    })

    for (const walk of [READER_WALK, EXCLUDES_WALK]) {
      expect(await rulesOfWorld(world, walk)).toEqual(['a.md', 'frontend/react.md', 'x/y/z.md'])
    }
  })

  test('a file 6 folder levels down is not given, and the 6th level is not listed', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('a', 'dir')],
        [`${RULES_DIR}/a`]: [entry('b', 'dir')],
        [`${RULES_DIR}/a/b`]: [entry('c', 'dir')],
        [`${RULES_DIR}/a/b/c`]: [entry('d', 'dir')],
        [`${RULES_DIR}/a/b/c/d`]: [entry('ok.md'), entry('e', 'dir')],
        [`${RULES_DIR}/a/b/c/d/e`]: [entry('deep.md')],
      },
    })
    const run = memIo(world, [])

    expect(await ruleFiles(run.io, '/repo', READER_WALK)).toEqual(['a/b/c/d/ok.md'])
    expect(run.listed).not.toContain(`${RULES_DIR}/a/b/c/d/e`)
  })

  test('past 500 listed entries the walk stops', async () => {
    const names = Array.from({ length: 499 }, (_, at) => entry(`r${String(at).padStart(3, '0')}.md`))
    const dirs = { [RULES_DIR]: [...names, entry('sub', 'dir')], [`${RULES_DIR}/sub`]: [entry('late.md')] }
    const found = (await rulesOfWorld(memWorld({ dirs }), EXCLUDES_WALK)) ?? []

    expect(found).toHaveLength(499)
    expect(found).not.toContain('sub/late.md')
  })

  test('the reader takes no link and skips a sub-folder that leaves the repo; the excludes take both', async () => {
    const world = memWorld({
      dirs: {
        [RULES_DIR]: [entry('a.md'), link('linked.md'), link('shared'), entry('out', 'dir')],
        [`${RULES_DIR}/shared`]: [entry('team.md')],
        [`${RULES_DIR}/out`]: [entry('secret.md')],
      },
      realPaths: { [`${RULES_DIR}/shared`]: '/repo/shared', [`${RULES_DIR}/out`]: '/elsewhere/out' },
    })

    expect(await rulesOfWorld(world, READER_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(world, EXCLUDES_WALK)).toEqual(['a.md', 'linked.md', 'out/secret.md', 'shared/team.md'])
  })

  test('a sub-folder with no stat or no listing is skipped; no top folder is none, an unknown one null', async () => {
    const world = memWorld({
      dirs: { [RULES_DIR]: [entry('a.md'), entry('broken', 'dir'), link('notes')], [`${RULES_DIR}/broken`]: [] },
      files: { [`${RULES_DIR}/notes`]: 'a file behind a link' },
      unknownPaths: [`${RULES_DIR}/broken`],
    })

    expect(await rulesOfWorld(world, EXCLUDES_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(world, READER_WALK)).toEqual(['a.md'])
    expect(await rulesOfWorld(memWorld({}), READER_WALK)).toEqual([])
    expect(await rulesOfWorld(memWorld({ unknownPaths: [RULES_DIR] }), EXCLUDES_WALK)).toBeNull()
    const outside = memWorld({ dirs: { [RULES_DIR]: [entry('a.md')] }, realPaths: { [RULES_DIR]: '/elsewhere' } })
    expect(await rulesOfWorld(outside, READER_WALK)).toBeNull()
  })
})
