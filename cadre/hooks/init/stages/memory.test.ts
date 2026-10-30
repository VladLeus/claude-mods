import { describe, expect, test } from 'claude-code/testing'

import type { AskSpec, InitIo, RoleSpec, SetupScan } from '../../../types'
import { proposeRoles } from '../../roles/propose'
import { emptySetupScan, FULL_SCAN, memIo, memWorld, roleIn, valueOf } from '../../testkit'
import { askOnce, NO_USABLE_ANSWER_REASON, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
import { MEMORY_DISMISSED_REASON, memoryAnswer, memoryContextLine, memoryEnter } from './memory'

/** The buttons of every question on which roles get an item. */
const ROLE_LIST_OPTIONS = ['None', 'All roles']

/**
 * The instruction group questions of `roles` for `setup`, asked over `io` as init/run asks them (askOnce), as a step
 * result: the roles with the groups they were given, or why it cancelled.
 */
async function groupsOver(
  io: InitIo,
  roles: readonly RoleSpec[],
  setup: SetupScan,
): Promise<StepResult<readonly RoleSpec[]>> {
  let next = memoryEnter(roles, setup)
  while (next.kind === 'ask') {
    next = memoryAnswer(roles, setup, next.cursor, await askOnce(io, next.question, next.spec))
  }

  return next.kind === 'done' ? { kind: 'accepted', value: next.roles } : next
}

describe('memoryStep', () => {
  const roles = proposeRoles(FULL_SCAN).roles
  /** A global CLAUDE.md, one auto-memory and the project CLAUDE.md: all three groups are there. */
  const found = emptySetupScan({ hasGlobalClaudeMd: true, memoryFiles: ['a.md'], claudeMd: ['<repo>/CLAUDE.md'] })
  const GLOBAL_QUESTION =
    'Which roles get your global ~/.claude/CLAUDE.md and the files it imports? (e.g. PM, TL, or none)'
  const MEMORY_QUESTION = 'Which roles get the auto-memories for this repo (a.md)? (e.g. PM, TL, or none)'
  const PROJECT_QUESTION = 'Which roles get the project CLAUDE.md (<repo>/CLAUDE.md)? (e.g. PM, TL, or none)'
  /** A memory question as asked: the team's role ids and the never-shown promise under it (D-136). */
  const asAsked = (question: string): string => withContext(question, memoryContextLine(roles))

  test('one question per group that is there: the global CLAUDE.md, the auto-memories, the project', async () => {
    const run = memIo(memWorld({}), ['pm, tl', 'None', 'All roles'])
    const given = valueOf(await groupsOver(run.io, roles, found))
    expect(run.asked).toEqual([GLOBAL_QUESTION, MEMORY_QUESTION, PROJECT_QUESTION].map(asAsked))
    const spec = (title: string, lines: readonly string[]): AskSpec => ({
      options: ROLE_LIST_OPTIONS,
      header: 'Memory',
      context: { title, lines, kind: 'memory-group' },
    })
    expect(run.specs).toEqual([
      spec('Global CLAUDE.md', ['~/.claude/CLAUDE.md and the files it imports']),
      spec('Auto-memories', ['a.md']),
      spec('Project CLAUDE.md', ['<repo>/CLAUDE.md']),
    ])
    expect(given.map(role => [role.id, role.instructions])).toEqual([
      ['pm', ['global-claude-md', 'project-claude-md']],
      ['tl', ['global-claude-md', 'project-claude-md']],
      ['be', ['project-claude-md']],
      ['fe', ['project-claude-md']],
      ['qa', ['project-claude-md']],
      ['security', ['project-claude-md']],
    ])
    expect(run.logged).toEqual([])
  })

  test('each whole-file question carries the files of its own group only (D-236)', async () => {
    const memories = emptySetupScan({ memoryFiles: ['a.md', 'b.md'], claudeMd: ['<repo>/CLAUDE.md'] })
    const run = memIo(memWorld({}), ['None', 'None'])
    valueOf(await groupsOver(run.io, roles, memories))
    expect(run.specs.map(spec => spec.context?.lines)).toEqual([['a.md', 'b.md'], ['<repo>/CLAUDE.md']])
  })

  test('a role keeps the groups it was given in the order global, auto-memory, project', async () => {
    const given = valueOf(await groupsOver(memIo(memWorld({}), ['None', 'be', 'BE']).io, roles, found))
    expect(roleIn(given, 'be').instructions).toEqual(['auto-memory', 'project-claude-md'])
    expect(roleIn(given, 'pm').instructions).toEqual([])
  })

  test('only the groups the scan found are asked, and with none found nothing is asked', async () => {
    const run = memIo(memWorld({}), ['qa'])
    const given = valueOf(await groupsOver(run.io, roles, emptySetupScan({ memoryFiles: ['a.md', 'b.md'] })))
    const question = 'Which roles get the auto-memories for this repo (a.md, b.md)? (e.g. PM, TL, or none)'
    expect(run.asked).toEqual([asAsked(question)])
    expect(roleIn(given, 'qa').instructions).toEqual(['auto-memory'])
    const none = memIo(memWorld({}), [])
    expect(await groupsOver(none.io, roles, emptySetupScan())).toEqual({ kind: 'accepted', value: roles })
    expect(none.asked).toEqual([])
  })

  test('an unknown role is asked again; three such answers or a dismissal cancel with their reason (A1)', async () => {
    const again = memIo(memWorld({}), ['cto', 'pm', 'None', 'None'])
    expect(roleIn(valueOf(await groupsOver(again.io, roles, found)), 'pm').instructions).toEqual(['global-claude-md'])
    const refusal = `'cto' isn't one of: "None", "All roles", or role ids from: pm, tl, be, fe, qa, security.`
    expect(again.asked).toEqual([
      asAsked(GLOBAL_QUESTION),
      `${refusal}\n${asAsked(GLOBAL_QUESTION)}`,
      asAsked(MEMORY_QUESTION),
      asAsked(PROJECT_QUESTION),
    ])
    const cases: readonly (readonly [readonly string[], string])[] = [
      [['cto', 'cto', 'cto'], NO_USABLE_ANSWER_REASON],
      [[], MEMORY_DISMISSED_REASON],
      [['pm', 'pm'], MEMORY_DISMISSED_REASON],
    ]
    for (const [answers, reason] of cases) {
      const run = memIo(memWorld({}), answers)
      expect(await groupsOver(run.io, roles, found)).toEqual({ kind: 'cancelled', reason })
      expect(run.logged).toEqual([])
    }
    expect(MEMORY_DISMISSED_REASON).toBe(
      'A question on which roles get instructions or memories was dismissed or not answered.',
    )
  })

  test('names only: nothing is read or listed, and the roles it is given are never changed', async () => {
    const world = memWorld({ files: { '/home/u/.claude/CLAUDE.md': 'SENTINEL_SECRET_VALUE' } })
    const run = memIo(world, ['pm', 'pm', 'pm'])
    const before = JSON.stringify(roles)
    await groupsOver(run.io, roles, found)
    expect(run.reads).toEqual([])
    expect(run.listed).toEqual([])
    expect(JSON.stringify(roles)).toBe(before)
  })
})

describe('the whole-file question cursor (D-230)', () => {
  const roles = proposeRoles(FULL_SCAN).roles

  test('memoryEnter asks the first group the scan found, and with none found the roles get no group', () => {
    const first = memoryEnter(roles, emptySetupScan({ memoryFiles: ['a.md'], claudeMd: ['<repo>/CLAUDE.md'] }))
    const question = 'Which roles get the auto-memories for this repo (a.md)? (e.g. PM, TL, or none)'
    expect(first.kind === 'ask' ? [first.question, first.spec] : first).toEqual([
      withContext(question, memoryContextLine(roles)),
      { options: ROLE_LIST_OPTIONS, header: 'Memory' },
    ])
    const none = memoryEnter(roles, emptySetupScan())
    expect(none.kind === 'done' ? none.roles.map(role => role.instructions) : none).toEqual(roles.map(() => []))
  })
})
