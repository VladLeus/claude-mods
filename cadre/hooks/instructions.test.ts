import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan, InstructionTopic, MemoryItem } from '../types'
import { sha256Hex } from './core/hash'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  contentContextLine,
  entryContextLine,
  HANDOUT_DISMISSED_REASON,
  INSTRUCTIONS_ENTRY_OPTIONS,
  INSTRUCTIONS_ENTRY_QUESTION,
  instructionsEntry,
  memoryItemContextLine,
  memoryItemHeader,
  memoryItemQuestion,
  memoryItems,
  parseContentConsent,
  partChanges,
  topicContextLine,
  topicHeader,
  topicItems,
  topicQuestion,
} from './instructions'
import type { MemoryRecord, PartRecord } from './instructions'
import { NO_MEMORY_SUMMARY } from './scan/instructions/memories'
import { emptySetupScan } from './testkit'
import { contextText } from './ui/ask'

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

describe('instruction questions (G-02-1f)', () => {
  test('the content consent asks before anything is read, No, skip it first (D-134)', () => {
    expect(CONTENT_QUESTION).toBe(
      'Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each role? ' +
        'Nothing from your global files or memories is committed, and originals are never edited.',
    )
    expect(CONTENT_OPTIONS).toEqual(['No, skip it', 'Yes, read them'])
    expect(Object.isFrozen(CONTENT_OPTIONS)).toBe(true)
    expect(CONTENT_DISMISSED_REASON).toBe('The instruction files question was dismissed or not answered.')
  })

  test('option 0 of the content consent never consents and option 1 does; any other answer is no answer', () => {
    expect(parseContentConsent(CONTENT_OPTIONS[0] ?? 'missing')).toBe(false)
    expect(parseContentConsent(CONTENT_OPTIONS[1] ?? 'missing')).toBe(true)
    expect(parseContentConsent('  yes, READ them ')).toBe(true)
    expect(parseContentConsent('yes')).toBeNull()
  })

  test('the content consent context line counts the global file, the chain, the rules, AGENTS.md, the memories', () => {
    const found = emptySetupScan({ hasGlobalClaudeMd: true, claudeMd: ['<repo>/CLAUDE.md'], memoryFiles: ['a.md'] })
    expect(contentContextLine(found, { rules: ['security.md'], hasAgentsMd: true })).toBe(
      'Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 1 rule file, AGENTS.md yes, 1 memory. ' +
        'No keeps the whole-file questions.',
    )
    const more = emptySetupScan({ claudeMd: ['~/CLAUDE.md', '<repo>/CLAUDE.md'], memoryFiles: ['a.md', 'b.md'] })
    expect(contentContextLine(more, { rules: ['a.md', 'b.md'], hasAgentsMd: false })).toBe(
      'Found: global CLAUDE.md no, 2 CLAUDE.md files in the repo chain, 2 rule files, AGENTS.md no, 2 memories. ' +
        'No keeps the whole-file questions.',
    )
    expect(contentContextLine(emptySetupScan(), { rules: [], hasAgentsMd: false })).toBe(
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 0 memories. ' +
        'No keeps the whole-file questions.',
    )
  })

  test('the consent context line counts the memories without MEMORY.md, as the hand-out offers them (S9)', () => {
    const found = emptySetupScan({ memoryFiles: ['MEMORY.md', 'a.md', 'b.md'] })
    expect(contentContextLine(found, { rules: [], hasAgentsMd: false })).toBe(
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 2 memories. ' +
        'No keeps the whole-file questions.',
    )
  })

  test('the consent context line counts no MEMORY.md in any letter case as a memory (N2)', () => {
    const found = emptySetupScan({ memoryFiles: ['MEMORY.md', 'Memory.md', 'a.md'] })
    expect(contentContextLine(found, { rules: [], hasAgentsMd: false })).toBe(
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md no, 1 memory. ' +
        'No keeps the whole-file questions.',
    )
  })

  test('a rules folder that could not be listed counts 0 rule files in the context line', () => {
    expect(contentContextLine(emptySetupScan(), { rules: null, hasAgentsMd: true })).toBe(
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 rule files, AGENTS.md yes, 0 memories. ' +
        'No keeps the whole-file questions.',
    )
  })

  test('the entry question offers Accept recommendations, Go part by part and Whole files', () => {
    expect(INSTRUCTIONS_ENTRY_QUESTION).toBe('How do you want to hand out the instruction parts and memories?')
    expect(INSTRUCTIONS_ENTRY_OPTIONS).toEqual(['Accept recommendations', 'Go part by part', 'Whole files'])
    expect(Object.isFrozen(INSTRUCTIONS_ENTRY_OPTIONS)).toBe(true)
    expect(entryContextLine(SCAN, TOPICS)).toBe(
      '2 topics from 1 file and 0 memories; the pane shows each with the roles it is recommended for.',
    )
    expect(entryContextLine({ ...MEMORY_SCAN, files: ['a', 'b'] }, TOPICS.slice(0, 1))).toBe(
      '1 topic from 2 files and 2 memories; the pane shows each with the roles it is recommended for.',
    )
    expect(entryContextLine({ ...SCAN, memories: MEMORIES.slice(0, 1) }, TOPICS)).toBe(
      '2 topics from 1 file and 1 memory; the pane shows each with the roles it is recommended for.',
    )
    expect(instructionsEntry(SCAN, TOPICS)).toEqual({
      question: INSTRUCTIONS_ENTRY_QUESTION,
      context: entryContextLine(SCAN, TOPICS),
      header: 'Instructions',
      accept: 'Accept recommendations',
      oneByOne: 'Go part by part',
      whole: 'Whole files',
    })
    expect(HANDOUT_DISMISSED_REASON).toBe(
      'A question on which roles get instruction parts was dismissed or not answered.',
    )
  })

  test('a topic question names the topic; its context line has the summary, recommended roles, then sources', () => {
    expect(topicQuestion(SECURITY_TOPIC)).toBe('Which roles get "Security rules"?')
    expect(topicContextLine(SECURITY_TOPIC, PARTS, ['security'])).toBe(
      'How secrets stay out of the repo. Recommended: security. From: ~/.claude/CLAUDE.md > Security.',
    )
    expect(topicContextLine(GIT_TOPIC, PARTS, [])).toBe(
      'How commits are made. Recommended: none. From: ~/.claude/CLAUDE.md > Git.',
    )
  })

  test('a topic context line names three sources, then how many more', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((heading, at) => part(`P${at + 1}`, heading, `# ${heading}\n`))
    const topic = { id: 'T1', title: 'All', summary: 'Everything.', partIds: many.map(found => found.id) }
    expect(topicContextLine(topic, many, ['tl', 'security'])).toBe(
      'Everything. Recommended: tl, security. ' +
        'From: ~/.claude/CLAUDE.md > A, ~/.claude/CLAUDE.md > B, ~/.claude/CLAUDE.md > C, +2 more.',
    )
  })

  test('a summary gets a final period; a long line keeps its whole Recommended sentence (S5, N1)', () => {
    const long = ['a', 'b', 'c'].map(letter => part(`P${letter}`, letter.repeat(80), 'x\n', `${letter.repeat(116)}.md`))
    const topic = { id: 'T1', title: 'Long', summary: 's'.repeat(160), partIds: long.map(found => found.id) }
    const line = topicContextLine(topic, long, ['be', 'qa'])
    expect(Array.from(line).length).toBeGreaterThan(400)
    expect(contextText(line)).toContain(`${'s'.repeat(160)}. Recommended: be, qa. From: `)
    const deploy = { ...SECURITY_TOPIC, summary: 'Deploy notes' }
    expect(topicContextLine(deploy, PARTS, [])).toBe(
      'Deploy notes. Recommended: none. From: ~/.claude/CLAUDE.md > Security.',
    )
  })

  test('the topic chip is Topic i/n, and just Topic when that is over 12 characters', () => {
    expect(topicHeader(1, 2)).toBe('Topic 1/2')
    expect(topicHeader(10, 99)).toBe('Topic 10/99')
    expect(topicHeader(10, 100)).toBe('Topic 10/100')
    expect(topicHeader(100, 200)).toBe('Topic')
  })

  test('the topic items carry each topic question, context line, chip and recommended roles', () => {
    const items = topicItems(SCAN, TOPICS, RECOMMENDED)
    expect(items.map(item => [item.id, item.question, item.header, item.recommended])).toEqual([
      ['T1', 'Which roles get "Security rules"?', 'Topic 1/2', ['security']],
      ['T2', 'Which roles get "Git and commits"?', 'Topic 2/2', ['tl']],
    ])
    expect(items[0]?.context).toBe(topicContextLine(SECURITY_TOPIC, PARTS, ['security']))
    expect(topicItems(SCAN, TOPICS, new Map()).map(item => item.recommended)).toEqual([[], []])
  })

  test('a memory question names its file; its context line has its summary and the recommended roles', () => {
    const squad = memory('M1', 'squad.md', 'Unsigned commits on per-phase branches.')
    const workflow = memory('M2', 'workflow.md', 'No summary in MEMORY.md.')
    expect(memoryItemQuestion(squad)).toBe('Which roles get the memory "squad.md"?')
    expect(memoryItemContextLine(squad, ['tl', 'security'])).toBe(
      'Unsigned commits on per-phase branches. Recommended: tl, security.',
    )
    expect(memoryItemContextLine(workflow, [])).toBe('No summary in MEMORY.md. Recommended: none.')
    expect(NO_MEMORY_SUMMARY).toBe('No summary in MEMORY.md.')
    const deploy = memory('M3', 'deploy.md', 'Deploy the app')
    expect(memoryItemContextLine(deploy, [])).toBe('Deploy the app. Recommended: none.')
  })

  test('the memory chip is Memory i/n, and just Memory when that is over 12 characters', () => {
    expect(memoryItemHeader(1, 2)).toBe('Memory 1/2')
    expect(memoryItemHeader(10, 99)).toBe('Memory 10/99')
    expect(memoryItemHeader(10, 100)).toBe('Memory')
  })

  test('the memory items carry each memory question, context line, chip and recommended roles', () => {
    const items = memoryItems(MEMORIES, new Map([['M1', ['tl']]]))
    expect(items.map(item => [item.id, item.question, item.header, item.recommended])).toEqual([
      ['M1', 'Which roles get the memory "squad.md"?', 'Memory 1/2', ['tl']],
      ['M2', 'Which roles get the memory "workflow.md"?', 'Memory 2/2', []],
    ])
    expect(items.map(item => item.context)).toEqual([
      'Unsigned commits on per-phase branches. Recommended: tl.',
      'No summary in MEMORY.md. Recommended: none.',
    ])
  })
})

/** The Git section of the root CLAUDE.md as init read it (G-02-1f Regen). */
const GIT_SECTION = '## Git\nUse signed commits.\n'

/** A repo part of the root CLAUDE.md, or of `file`, with the SHA-256 of its text, as the read gives it. */
async function repoPart(id: string, heading: string, text: string, file = 'CLAUDE.md'): Promise<InstructionPart> {
  return { id, file, heading, source: 'repo', text, hash: await sha256Hex(text) }
}

/** A memory of the repo with the SHA-256 of this text, as the read gives it. */
async function hashedMemory(id: string, file: string, text: string): Promise<MemoryItem> {
  return { id, file, folder: MEMORY, summary: NO_MEMORY_SUMMARY, hash: await sha256Hex(text) }
}

/** What a role's records keep of a part: its file, heading and hash (G-02-1f Regen). */
function partRecordOf(found: InstructionPart): PartRecord {
  return { file: found.file, heading: found.heading, hash: found.hash }
}

/** What a role's records keep of a memory: its file and hash (G-02-1f Regen). */
function memoryRecordOf(found: MemoryItem): MemoryRecord {
  return { file: found.file, hash: found.hash }
}

/** No part and no memory. */
const NO_ITEMS = { parts: [], memories: [] }

describe('partChanges (G-02-1f)', () => {
  test('a record of CLAUDE.md > Git with the file unchanged gives kept', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const stored = { parts: [partRecordOf(git), partRecordOf(tests)], memories: [] }

    expect(partChanges(stored, { parts: [git, tests], memories: [] })).toEqual({
      kept: { parts: [git, tests], memories: [] },
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: NO_ITEMS,
    })
  })

  test('the Git section edited gives changed, with the part as it is now', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const edited = await repoPart('P1', 'Git', '## Git\nUse signed commits, always.\n')
    const stored = { parts: [partRecordOf(git)], memories: [] }

    expect(partChanges(stored, { parts: [edited], memories: [] })).toEqual({
      kept: NO_ITEMS,
      changed: { parts: [edited], memories: [] },
      added: NO_ITEMS,
      removed: NO_ITEMS,
    })
  })

  test('the Git section deleted gives removed, with the record as it was stored', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const stored = { parts: [partRecordOf(git), partRecordOf(tests)], memories: [] }

    expect(partChanges(stored, { parts: [tests], memories: [] })).toEqual({
      kept: { parts: [tests], memories: [] },
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: { parts: [partRecordOf(git)], memories: [] },
    })
    expect(partChanges(stored, NO_ITEMS).removed.parts).toEqual([partRecordOf(git), partRecordOf(tests)])
  })

  test('a part a named file gained is added; a part of a file no record names is not', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const rule = await repoPart('P3', '', 'Keep functions small.\n', '.claude/rules/style.md')
    const stored = { parts: [partRecordOf(git)], memories: [] }
    const changes = partChanges(stored, { parts: [git, tests, rule], memories: [] })

    expect(changes.kept.parts).toEqual([git])
    expect(changes.added.parts).toEqual([tests])
    expect([changes.changed, changes.removed]).toEqual([NO_ITEMS, NO_ITEMS])
  })

  test('a section moved to a file no record names is removed, not kept: file and heading must match too', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const moved = await repoPart('P1', 'Git', GIT_SECTION, 'AGENTS.md')
    const changes = partChanges({ parts: [partRecordOf(git)], memories: [] }, { parts: [moved], memories: [] })

    expect(moved.hash).toBe(git.hash)
    expect(changes).toEqual({
      kept: NO_ITEMS,
      changed: NO_ITEMS,
      added: NO_ITEMS,
      removed: { parts: [partRecordOf(git)], memories: [] },
    })
  })

  test('two sections with one heading are matched by hash first, then in order, each record once', async () => {
    const first = await repoPart('P1', 'Notes', '## Notes\nOne.\n')
    const second = await repoPart('P2', 'Notes', '## Notes\nTwo.\n')
    const firstEdited = await repoPart('P2', 'Notes', '## Notes\nOne, edited.\n')
    const third = await repoPart('P3', 'Notes', '## Notes\nThree.\n')
    const stored = { parts: [partRecordOf(first), partRecordOf(second)], memories: [] }
    const swapped = partChanges(stored, { parts: [second, firstEdited], memories: [] })
    const grown = partChanges(stored, { parts: [first, second, third], memories: [] })

    expect([swapped.kept.parts, swapped.changed.parts, swapped.removed.parts]).toEqual([[second], [firstEdited], []])
    expect([grown.kept.parts, grown.added.parts, grown.removed.parts]).toEqual([[first, second], [third], []])
  })

  test('memories by file and hash: kept, changed and removed; a memory no record names is never added', async () => {
    const squad = await hashedMemory('M1', 'squad.md', 'Unsigned commits on per-phase branches.')
    const flow = await hashedMemory('M2', 'workflow.md', 'Plan, then run.')
    const flowEdited = await hashedMemory('M2', 'workflow.md', 'Plan, run, then verify.')
    const unnamed = await hashedMemory('M3', 'extra.md', 'Not handed out.')
    const gone = { file: 'gone.md', hash: 'c'.repeat(64) }
    const stored = { parts: [], memories: [memoryRecordOf(squad), memoryRecordOf(flow), gone] }

    expect(partChanges(stored, { parts: [], memories: [squad, flowEdited, unnamed] })).toEqual({
      kept: { parts: [], memories: [squad] },
      changed: { parts: [], memories: [flowEdited] },
      added: NO_ITEMS,
      removed: { parts: [], memories: [gone] },
    })
  })

  test('parts and memories are compared in one call, and neither input is changed', async () => {
    const git = await repoPart('P1', 'Git', GIT_SECTION)
    const tests = await repoPart('P2', 'Tests', '## Tests\nRun them before a commit.\n')
    const squad = await hashedMemory('M1', 'squad.md', 'Unsigned commits on per-phase branches.')
    const stored = { parts: [partRecordOf(git)], memories: [memoryRecordOf(squad)] }
    const current = { parts: [tests, git], memories: [squad] }
    const before = JSON.stringify([stored, current])
    const changes = partChanges(stored, current)

    expect(changes.kept).toEqual({ parts: [git], memories: [squad] })
    expect(changes.added).toEqual({ parts: [tests], memories: [] })
    expect(JSON.stringify([stored, current])).toBe(before)
  })
})
