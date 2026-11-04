import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan } from '../../../types'
import { REDACTED } from '../../core/redact'
import { SCREEN_LIST_WORDS } from '../../locales/t'
import { fallbackTopics } from '../../suggest/topics'
import { MEMORIES, MEMORY, memory, RECOMMENDED, ROLES, TOPICS } from '../../testkit'
import { paneDrawn } from '../pane'
import { instructionLines, instructionReviewLines, instructionRows } from './instructions'

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

/** The read of GLOBAL_TEXT with the two MEMORIES. */
const MEMORY_SCAN: InstructionScan = { ...SCAN, memories: MEMORIES }

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

describe('instructionLines redaction (WD-S5, #163)', () => {
  test('a secret-like span of a summary is hidden in its row; a title beside a plain summary stays whole', () => {
    const secret = ['token', 'ab12cd34ef56'].join('=')
    const topics = [
      { id: 'T1', title: 'API key', summary: `Rotate ${secret} monthly`, partIds: ['P1'] },
      { id: 'T2', title: 'API key', summary: '90-day rotation of the deploy keys', partIds: ['P2'] },
    ]
    const scan = { ...SCAN, memories: [memory('M1', 'squad.md', `Uses ${secret}`)] }
    const lines = instructionLines(scan, topics, new Map())
    expect(lines.filter(line => line.startsWith('  API key: ') || line.startsWith('  squad.md: '))).toEqual([
      `  API key: Rotate token=${REDACTED} monthly`,
      '  API key: 90-day rotation of the deploy keys',
      `  squad.md: Uses token=${REDACTED}`,
    ])
  })

  test('a secret-like span of a topic title is hidden in its row (PR-S3)', () => {
    const secret = ['token', 'ab12cd34ef56'].join('=')
    const topics = [{ id: 'T1', title: `Deploy ${secret}`, summary: 'Deploy notes', partIds: ['P1'] }]
    const lines = instructionLines(SCAN, topics, new Map())
    expect(lines.filter(line => line.startsWith('  Deploy '))).toEqual([`  Deploy token=${REDACTED}: Deploy notes`])
  })
})

describe('instructionReviewLines', () => {
  test('per role the topics and memories it gets, else none, then what stays with the root session only', () => {
    expect(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, SCREEN_LIST_WORDS)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 1 topic: Git and commits; 0 memories',
      '  security: 1 topic: Security rules; 0 memories',
      'Kept with the root session only: 0 topics, 0 memories',
    ])
  })

  test('rowsAfter puts the rows it gives for a role right after that role row (02-GAPS-B3 N3)', () => {
    expect(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, SCREEN_LIST_WORDS, id => [`x ${id}`])).toEqual([
      'Instructions per role:',
      '  pm: none',
      'x pm',
      '  tl: 1 topic: Git and commits; 0 memories',
      'x tl',
      '  security: 1 topic: Security rules; 0 memories',
      'x security',
      'Kept with the root session only: 0 topics, 0 memories',
    ])
    const none = instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, SCREEN_LIST_WORDS, () => [])
    expect(none).toEqual(instructionReviewLines(ROLES, TOPICS, [], RECOMMENDED, SCREEN_LIST_WORDS))
  })

  test('a role with memories and no topic counts both; a memory no role gets is counted as kept', () => {
    const given = new Map([...RECOMMENDED, ['M1', ['pm', 'security']], ['M2', []]])
    expect(instructionReviewLines(ROLES, TOPICS, MEMORIES, given, SCREEN_LIST_WORDS)).toEqual([
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
    expect(instructionReviewLines(ROLES, topics, MEMORIES, withMemories, SCREEN_LIST_WORDS)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 4 topics: A, B, C, +1 more; 2 memories',
      '  security: none',
      'Kept with the root session only: 1 topic, 0 memories',
    ])
  })
})

describe('instructionRows (D-313, D-323)', () => {
  /** The texts the pane draws for `rows` in one untitled section, its title left out (paneDrawn). */
  function drawnTexts(rows: ReturnType<typeof instructionRows>): string[] {
    return paneDrawn({ title: 'T', summary: null, rows: [{ title: null, rows }], lines: [] }, null)
      .slice(1)
      .map(row => row.spans.map(span => span.text).join(''))
  }

  test('the instructions block as rows: the same words as its lines, a row per line', () => {
    const scan: InstructionScan = { ...SCAN, memories: MEMORIES, warnings: ['w'] }
    for (const recommended of [RECOMMENDED, new Map<string, readonly string[]>()]) {
      const lines = instructionLines(scan, TOPICS, recommended)
      expect(drawnTexts(instructionRows(scan, TOPICS, recommended))).toEqual(lines)
    }
  })

  test('its headings are heading rows, a topic is a field and its sources and roles follow at indent 4', () => {
    const rows = instructionRows(SCAN, TOPICS.slice(0, 1), RECOMMENDED)
    expect(rows.map(row => [row.role, row.indent])).toEqual([
      ['heading', 0],
      ['field', 2],
      ['field', 4],
      ['recommended', 4],
    ])
  })
})
