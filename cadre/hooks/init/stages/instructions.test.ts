import { describe, expect, test } from 'claude-code/testing'

import type {
  InstructionGroup,
  InstructionHandout,
  InstructionPart,
  InstructionScan,
  InstructionTopic,
  MemoryItem,
} from '../../../types'
import { sha256Hex } from '../../core/hash'
import { proposeRoles } from '../../roles/propose'
import { NO_MEMORY_SUMMARY } from '../../scan/instructions/memories'
import {
  DEFAULT_LOCATIONS,
  emptySetupScan,
  entry,
  gitWorld,
  INIT_ANSWERS,
  memIo,
  repoScan,
  USER_DIR_LISTED,
} from '../../testkit'
import type { MemWorld } from '../../testkit'
import { contextText } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'
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

/** The value of an accepted step result; a cancelled one stops the test with its reason. */
function valueOf<T>(result: StepResult<T>): T {
  if (result.kind === 'cancelled') throw new Error(`the step was cancelled: ${result.reason}`)

  return result.value
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
