import { describe, expect, test } from 'claude-code/testing'

import type { InstructionGroup, InstructionHandout, InstructionPart, InstructionScan } from '../../../types'
import { sha256Hex } from '../../core/hash'
import { proposeRoles } from '../../roles/propose'
import { NO_MEMORY_SUMMARY } from '../../scan/instructions/memories'
import {
  DEFAULT_LOCATIONS,
  emptySetupScan,
  entry,
  GIT_TOPIC,
  gitWorld,
  GLOBAL_CLAUDE_MD,
  memIo,
  MEMORIES,
  memoriesWorld,
  memory,
  MEMORY_DIR,
  MEMORY_SENTENCE,
  PARTS_ANSWERS,
  PARTS_GLOBAL,
  PARTS_TOPICS_REPLY,
  partsWorld,
  RECOMMENDED,
  repoScan,
  SECURITY_TOPIC,
  TOPICS,
  valueOf,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { contextText } from '../../ui/ask'
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
  instructionsStep,
  memoryItemContextLine,
  memoryItemHeader,
  memoryItemQuestion,
  memoryItems,
  parseContentConsent,
  topicContextLine,
  topicHeader,
  topicItems,
  topicQuestion,
} from './instructions'

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

/** The topics and hand-out of a parts outcome; any other outcome stops the test with its kind. */
function partsOf(handout: InstructionHandout): Extract<InstructionHandout, { readonly kind: 'parts' }> {
  if (handout.kind !== 'parts') throw new Error(`not the parts flow: ${handout.kind}`)

  return handout
}

describe('instruction parts (G-02-1f)', () => {
  test('the parts flow gives every role no instruction group and keeps the hand-out in memory only', async () => {
    const run = memIo(partsWorld(), PARTS_ANSWERS)
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const groups: readonly InstructionGroup[] = ['auto-memory']
    const roles = proposeRoles(repoScan()).roles.map(role => ({ ...role, instructions: groups }))
    const value = valueOf(await instructionsStep(run.io, roles, setup, DEFAULT_LOCATIONS))
    expect(value.roles.map(role => role.instructions)).toEqual([[], [], []])
    const handout = partsOf(value.instructions)
    expect(handout.topics.map(topic => topic.title)).toEqual(['Security rules', 'Git and commits'])
    expect([...handout.given.entries()]).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
    ])
    expect([...handout.recommended.entries()]).toEqual([...handout.given.entries()])
    expect(handout.scan.files).toEqual(['~/.claude/CLAUDE.md'])
    expect(handout.scan.parts.map(part => [part.id, part.file, part.heading, part.source])).toEqual([
      ['P1', '~/.claude/CLAUDE.md', 'Security', 'global'],
      ['P2', '~/.claude/CLAUDE.md', 'Git', 'global'],
    ])
  })
})

/** The rules folder of the fixture repo, which init lists by name before the content consent (G-02-1f Sources). */
const RULES_DIR = '/repo/.claude/rules'

/** A sentence of a rule file that must never be shown, asked or logged (T-02-61). */
const RULE_SENTENCE = 'LEAKY-RULE-SENTENCE stays with the model'

/**
 * A git repo whose only instruction file is the rule file `.claude/rules/security.md` with a Secrets section, as the
 * plan's dry run has it; the model groups it into one topic recommended to Security. `over` changes the fields it
 * names.
 */
function rulesWorld(over: Partial<MemWorld> = {}): MemWorld {
  return gitWorld({
    dirs: { '/repo/.git': [], [RULES_DIR]: [entry('security.md')] },
    files: { [`${RULES_DIR}/security.md`]: `# Secrets\n${RULE_SENTENCE}.\n` },
    replies: [
      '{"topics":[{"title":"Secrets","summary":"How secrets are kept.","parts":["P1"]}]}',
      '{"topics":{"T1":["security"]},"memories":{}}',
    ],
    ...over,
  })
}

describe('rules and AGENTS.md in init (G-02-1f)', () => {
  test('the rule file is a repo part of the hand-out, with its file, heading and source', async () => {
    const roles = proposeRoles(repoScan()).roles
    const run = memIo(rulesWorld(), PARTS_ANSWERS)
    const value = valueOf(await instructionsStep(run.io, roles, emptySetupScan(), DEFAULT_LOCATIONS))
    expect(value.instructions.kind).toBe('parts')
    const handout = partsOf(value.instructions)
    expect(handout.scan.parts.map(part => [part.file, part.heading, part.source])).toEqual([
      ['.claude/rules/security.md', 'Secrets', 'repo'],
    ])
    expect([...handout.given.entries()]).toEqual([['T1', ['security']]])
  })
})

describe('memories one by one (G-02-1f)', () => {
  test('the hand-out keeps each memory by its M id with its folder, summary and hash', async () => {
    const roles = proposeRoles(repoScan()).roles
    const setup = emptySetupScan({ hasGlobalClaudeMd: true, memoryFiles: ['MEMORY.md', 'squad.md', 'workflow.md'] })
    const run = memIo(memoriesWorld(), PARTS_ANSWERS)
    const value = valueOf(await instructionsStep(run.io, roles, setup, DEFAULT_LOCATIONS))
    expect(value.instructions.kind).toBe('parts')
    const handout = partsOf(value.instructions)
    expect(Object.keys(handout.scan)).toContain('memories')
    expect(handout.scan.memories.map(found => [found.id, found.file, found.folder, found.summary])).toEqual([
      ['M1', 'squad.md', MEMORY_DIR, 'Unsigned commits on per-phase branches.'],
      ['M2', 'workflow.md', MEMORY_DIR, 'No summary in MEMORY.md.'],
    ])
    const hashes = [await sha256Hex(`${MEMORY_SENTENCE} (squad)`), await sha256Hex(`${MEMORY_SENTENCE} (workflow)`)]
    expect(handout.scan.memories.map(found => found.hash)).toEqual(hashes)
    expect([...handout.given.entries()]).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
      ['M1', ['tl']],
      ['M2', []],
    ])
  })

  test('the memories of the root as given are read too, after those of the root as resolved', async () => {
    const given = '/home/u/.claude/projects/-link-repo/memory'
    const world = memoriesWorld({
      dirs: { '/repo/.git': [], [MEMORY_DIR]: [entry('squad.md')], [given]: [entry('squad.md'), entry('extra.md')] },
      files: {
        [GLOBAL_CLAUDE_MD]: PARTS_GLOBAL,
        [`${MEMORY_DIR}/squad.md`]: 'squad',
        [`${given}/squad.md`]: 'another squad',
        [`${given}/extra.md`]: 'extra',
      },
      replies: [PARTS_TOPICS_REPLY, '{"topics":{"T1":[],"T2":[]},"memories":{"M1":[],"M2":[]}}'],
    })
    const roles = proposeRoles(repoScan()).roles
    const locations = { ...DEFAULT_LOCATIONS, givenRoot: '/link/repo' }
    const setup = emptySetupScan({ hasGlobalClaudeMd: true })
    const value = valueOf(await instructionsStep(memIo(world, PARTS_ANSWERS).io, roles, setup, locations))
    expect(value.instructions.kind).toBe('parts')
    const { scan } = partsOf(value.instructions)
    expect(Object.keys(scan)).toContain('memories')
    expect(scan.memories.map(found => [found.id, found.file, found.folder])).toEqual([
      ['M1', 'extra.md', given],
      ['M2', 'squad.md', MEMORY_DIR],
    ])
  })
})
