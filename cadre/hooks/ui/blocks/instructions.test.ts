import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan, InstructionTopic, MemoryItem } from '../../../types'
import { fallbackTopics } from '../../suggest/topics'
import { templateRole } from '../../testkit'
import { instructionLines, instructionReviewLines } from './instructions'

/**
 * A part of the global CLAUDE.md with this id, heading and text, and a stand-in hash; `file` changes the file it comes
 * from.
 */
function part(id: string, heading: string, text: string, file = '~/.claude/CLAUDE.md'): InstructionPart {
  return { id, file, heading, source: 'global', text, hash: `hash of ${id}` }
}

/** The two parts of GLOBAL_TEXT, in read order. */
const PARTS: readonly InstructionPart[] = [
  part('P1', 'Security', '# Security\nNever commit secrets.\n'),
  part('P2', 'Git', '## Git\nUse signed commits.\n'),
]

/** The read of GLOBAL_TEXT: its two parts, the one file they came from, no memory and no warning. */
const SCAN: InstructionScan = { parts: PARTS, files: ['~/.claude/CLAUDE.md'], memories: [], warnings: [] }

/** The auto-memory folder of the fixture repo for the fixture user. */
const MEMORY = '/home/u/.claude/projects/-repo/memory'

/** A memory with this id, file and summary, from the memory folder of the repo. */
function memory(id: string, file: string, summary: string): MemoryItem {
  return { id, file, folder: MEMORY, summary, hash: `hash of ${file}` }
}

/** Two memories: squad.md with its index summary, and workflow.md with none. */
const MEMORIES: readonly MemoryItem[] = [
  memory('M1', 'squad.md', 'Unsigned commits on per-phase branches.'),
  memory('M2', 'workflow.md', 'No summary in MEMORY.md.'),
]

/** The read of GLOBAL_TEXT with the two MEMORIES. */
const MEMORY_SCAN: InstructionScan = { ...SCAN, memories: MEMORIES }

/** The first topic of the plan's dry run: the Security part. */
const SECURITY_TOPIC: InstructionTopic = {
  id: 'T1',
  title: 'Security rules',
  summary: 'How secrets stay out of the repo.',
  partIds: ['P1'],
}

/** The second topic of the plan's dry run: the Git part. */
const GIT_TOPIC: InstructionTopic = {
  id: 'T2',
  title: 'Git and commits',
  summary: 'How commits are made.',
  partIds: ['P2'],
}

/** The two topics of the plan's dry run, one per part. */
const TOPICS: readonly InstructionTopic[] = [SECURITY_TOPIC, GIT_TOPIC]

/** T1 recommended to Security and T2 to the Team Lead, as the plan's dry run has it. */
const RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
  ['T1', ['security']],
  ['T2', ['tl']],
])

/** The team of the cases: PM, Team Lead and Security, in that order. */
const ROLES = [templateRole('pm'), templateRole('tl'), templateRole('security')]

describe('instructionLines', () => {
  test('the heading, then each topic with its summary, its sources and the roles it is recommended for', () => {
    expect(instructionLines(SCAN, TOPICS, RECOMMENDED)).toEqual([
      'Read for this run; a plain init writes the repo parts you hand out to .cadre/<role>/CLAUDE.md after Confirm:',
      '  Security rules: How secrets stay out of the repo.',
      '    from: ~/.claude/CLAUDE.md > Security',
      '    recommended: security',
      '  Git and commits: How commits are made.',
      '    from: ~/.claude/CLAUDE.md > Git',
      '    recommended: tl',
    ])
  })

  test("a topic recommended to no role says none, and a part with no heading is '(top of file)'", () => {
    const scan: InstructionScan = { ...SCAN, parts: [part('P1', '', 'Intro.\n')] }
    const topics = [{ id: 'T1', title: 'Intro', summary: 'The intro.', partIds: ['P1'] }]
    expect(instructionLines(scan, topics, new Map([['T1', []]])).slice(1)).toEqual([
      '  Intro: The intro.',
      '    from: ~/.claude/CLAUDE.md > (top of file)',
      '    recommended: none',
    ])
  })

  test('the read warnings follow the topics, each as warning: <text>', () => {
    const scan = { ...SCAN, warnings: ['could not read CLAUDE.md (treated as unknown)'] }
    expect(instructionLines(scan, TOPICS, RECOMMENDED).at(-1)).toBe(
      'warning: could not read CLAUDE.md (treated as unknown)',
    )
  })

  test('with no usable recommendation and the grouping fallen back, each says so on its own row', () => {
    const topics = fallbackTopics(SCAN)
    expect(instructionLines(SCAN, topics, new Map()).slice(-2)).toEqual([
      'The model gave no usable recommendation: no role gets a part unless you pick one.',
      'The model could not group the parts: each file is one topic.',
    ])
    expect(instructionLines(SCAN, TOPICS, RECOMMENDED).join('\n')).not.toContain('The model')
  })

  test('the text of a part is never in the block, only titles, summaries, files and headings', () => {
    const lines = instructionLines(SCAN, TOPICS, RECOMMENDED).join('\n')
    expect(lines).not.toContain('Never commit secrets')
    expect(lines).not.toContain('Use signed commits')
  })

  test('the memories follow the topics: a heading, then each file with its summary and recommended roles', () => {
    const recommended = new Map([...RECOMMENDED, ['M1', ['tl']], ['M2', []]])
    expect(instructionLines(MEMORY_SCAN, TOPICS, recommended).slice(7)).toEqual([
      'Memories (each linked, never copied, when a role gets it):',
      '  squad.md: Unsigned commits on per-phase branches.',
      '    recommended: tl',
      '  workflow.md: No summary in MEMORY.md.',
      '    recommended: none',
    ])
  })

  test('with only memories and no usable recommendation the block says so, and names no folder or hash', () => {
    const lines = instructionLines({ ...MEMORY_SCAN, parts: [], files: [] }, [], new Map())
    expect(lines.at(-1)).toBe('The model gave no usable recommendation: no role gets a part unless you pick one.')
    expect([lines.join('\n').includes(MEMORY), lines.join('\n').includes('hash of')]).toEqual([false, false])
  })
})

describe('instructionReviewLines', () => {
  test('per role the topics and memories it gets, else none, then what stays with the root session only', () => {
    expect(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 1 topic: Git and commits; 0 memories',
      '  security: 1 topic: Security rules; 0 memories',
      'Kept with the root session only: 0 topics, 0 memories',
    ])
  })

  test('rowsAfter puts the rows it gives for a role right after that role row (02-GAPS-B3 N3)', () => {
    expect(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, id => [`x ${id}`])).toEqual([
      'Instructions per role:',
      '  pm: none',
      'x pm',
      '  tl: 1 topic: Git and commits; 0 memories',
      'x tl',
      '  security: 1 topic: Security rules; 0 memories',
      'x security',
      'Kept with the root session only: 0 topics, 0 memories',
    ])
    const none = instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, () => [])
    expect(none).toEqual(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED))
  })

  test('a role with memories and no topic counts both; a memory no role gets is counted as kept', () => {
    const given = new Map([...RECOMMENDED, ['M1', ['pm', 'security']], ['M2', []]])
    expect(instructionReviewLines(ROLES, TOPICS, MEMORIES, given)).toEqual([
      'Instructions per role:',
      '  pm: 0 topics; 1 memory',
      '  tl: 1 topic: Git and commits; 0 memories',
      '  security: 1 topic: Security rules; 1 memory',
      'Kept with the root session only: 0 topics, 1 memory',
    ])
  })

  test('a role lists three titles, then how many more; a topic no role gets is counted as kept', () => {
    const topics = ['A', 'B', 'C', 'D', 'E'].map((title, at) => ({
      id: `T${at + 1}`,
      title,
      summary: `${title}.`,
      partIds: [`P${at + 1}`],
    }))
    const given = new Map([
      ['T1', ['tl']],
      ['T2', ['tl']],
      ['T3', ['tl']],
      ['T4', ['tl']],
      ['T5', []],
    ])
    const withMemories = new Map([...given, ['M1', ['tl']], ['M2', ['tl']]])
    expect(instructionReviewLines(ROLES, topics, MEMORIES, withMemories)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 4 topics: A, B, C, +1 more; 2 memories',
      '  security: none',
      'Kept with the root session only: 1 topic, 0 memories',
    ])
  })
})
