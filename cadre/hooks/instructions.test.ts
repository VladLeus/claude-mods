import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan, InstructionTopic, MemoryItem } from '../types'
import { sha256Hex } from './hash'
import {
  CONTENT_DISMISSED_REASON,
  CONTENT_OPTIONS,
  CONTENT_QUESTION,
  contentContextLine,
  entryContextLine,
  fallbackTopics,
  HANDOUT_DISMISSED_REASON,
  INSTRUCTIONS_ENTRY_OPTIONS,
  INSTRUCTIONS_ENTRY_QUESTION,
  instructionLines,
  instructionReviewLines,
  instructionsEntry,
  MEMORY_UNLISTED_WARNING,
  memoryIndex,
  memoryItemContextLine,
  memoryItemHeader,
  memoryItemQuestion,
  memoryItems,
  moreDocsWarning,
  morePartsWarning,
  NO_MEMORY_SUMMARY,
  outsideWarning,
  overSizeWarning,
  parseContentConsent,
  parseRecommendation,
  parseTopics,
  readInstructionFiles,
  readMemories,
  RECOMMEND_SYSTEM,
  recommendPrompt,
  referencedDocs,
  repoImportWarning,
  repoInstructionNames,
  RULES_UNLISTED_WARNING,
  splitSections,
  topicContextLine,
  topicHeader,
  topicItems,
  topicQuestion,
  TOPICS_SYSTEM,
  topicsPrompt,
  totalCapWarning,
  unfollowedImportWarning,
  unreadableWarning,
} from './instructions'
import type { InstructionSources } from './instructions'
import { BIDI_OVERRIDE, emptySetupScan, entry, link, memIo, memWorld, templateRole } from './testkit'
import type { MemWorld } from './testkit'

/** The global CLAUDE.md of the cases: a Security section and a Git section, as the plan's dry run has it. */
const GLOBAL_TEXT = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

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

/** The auto-memory folder of the fixture repo as given through a link, /link/repo. */
const GIVEN_MEMORY = '/home/u/.claude/projects/-link-repo/memory'

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

/** The grouping reply that gives TOPICS. */
const TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
  ],
})

/** T1 recommended to Security and T2 to the Team Lead, as the plan's dry run has it. */
const RECOMMENDED: ReadonlyMap<string, readonly string[]> = new Map([
  ['T1', ['security']],
  ['T2', ['tl']],
])

/** The team of the cases: PM, Team Lead and Security, in that order. */
const ROLES = [templateRole('pm'), templateRole('tl'), templateRole('security')]

/** The role ids of ROLES, in role order. */
const ROLE_IDS = ROLES.map(role => role.id)

/** A grouping reply of these topics, each `[title, summary, parts]`, as JSON. */
function topicsReply(topics: readonly (readonly [unknown, unknown, unknown])[]): string {
  return JSON.stringify({ topics: topics.map(([title, summary, parts]) => ({ title, summary, parts })) })
}

/** A reply parsed, or the errors of one that was not. */
type Parsed = { readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** The errors of an invalid reply; [] for a reply that parsed. */
function errorsOf(result: Parsed): readonly string[] {
  return result.kind === 'invalid' ? result.errors : []
}

describe('splitSections', () => {
  test("a line that starts with '# ' or '## ' starts a section, its heading the text after the hashes", () => {
    expect(splitSections(GLOBAL_TEXT)).toEqual([
      { heading: 'Security', text: '# Security\nNever commit secrets.\n' },
      { heading: 'Git', text: '## Git\nUse signed commits.\n' },
    ])
  })

  test("the text before the first heading is one section with heading '' when it is not blank", () => {
    expect(splitSections('Intro line.\n\n# A\nbody\n')).toEqual([
      { heading: '', text: 'Intro line.\n\n' },
      { heading: 'A', text: '# A\nbody\n' },
    ])
    expect(splitSections('\n   \n# A\nbody')).toEqual([{ heading: 'A', text: '# A\nbody' }])
    expect(splitSections('Only text, no heading.\n')).toEqual([{ heading: '', text: 'Only text, no heading.\n' }])
  })

  test('blank text gives no section', () => {
    expect(splitSections('')).toEqual([])
    expect(splitSections('\n \n\t\n')).toEqual([])
  })

  test("'### ' does not split, nor does a line that only starts with a hash", () => {
    expect(splitSections('# A\n### Sub\nx\n#hashtag\n#\ny\n')).toEqual([
      { heading: 'A', text: '# A\n### Sub\nx\n#hashtag\n#\ny\n' },
    ])
  })

  test("a '#' line inside a fenced block never splits, with backticks or tildes", () => {
    const backticks = '# A\n```sh\n# not a heading\n## nor this\n```\n## B\ny\n'
    expect(splitSections(backticks)).toEqual([
      { heading: 'A', text: '# A\n```sh\n# not a heading\n## nor this\n```\n' },
      { heading: 'B', text: '## B\ny\n' },
    ])
    const tildes = '# A\n~~~\n# still code\n~~~\n# B\n'
    expect(splitSections(tildes).map(section => section.heading)).toEqual(['A', 'B'])
  })

  test('a fence closes only on a fence of its own kind, at least as long', () => {
    const nested = '# A\n````md\n```\n# still code\n```\n````\n# B\nz\n'
    expect(splitSections(nested)).toEqual([
      { heading: 'A', text: '# A\n````md\n```\n# still code\n```\n````\n' },
      { heading: 'B', text: '# B\nz\n' },
    ])
    const mixed = '# A\n```\n~~~\n# still code\n```\n# B\n'
    expect(splitSections(mixed).map(section => section.heading)).toEqual(['A', 'B'])
  })

  test('a heading is trimmed, cleaned and cut to 80 code points', () => {
    expect(splitSections('#   Spaced title  \nx').map(section => section.heading)).toEqual(['Spaced title'])
    expect(splitSections(`# Tit${BIDI_OVERRIDE}le\r\nx`).map(section => section.heading)).toEqual(['Title'])
    expect(splitSections(`## ${'h'.repeat(100)}\nx`).map(section => section.heading)).toEqual([`${'h'.repeat(79)}…`])
  })

  test('the sections joined give the text back, line ends included', () => {
    const texts = [GLOBAL_TEXT, 'Intro\n# A\r\nx\r\n## B\ny', '# A\n```\n# x\n```\n## B\n']
    for (const text of texts) expect(splitSections(text).map(section => section.text).join('')).toBe(text)
  })
})

describe('parseTopics', () => {
  test('a valid reply gives the topics in reply order, T1 first, each with its parts', () => {
    expect(parseTopics(TOPICS_REPLY, ['P1', 'P2'])).toEqual({ kind: 'ok', topics: TOPICS })
  })

  test('a reply in one code fence is read the same', () => {
    expect(parseTopics(`\`\`\`json\n${TOPICS_REPLY}\n\`\`\``, ['P1', 'P2'])).toEqual({ kind: 'ok', topics: TOPICS })
  })

  test('a reply that is not JSON, or has no topics list, gives that error', () => {
    expect(errorsOf(parseTopics('Here are the topics.', ['P1']))).toEqual(['the reply is not JSON'])
    expect(errorsOf(parseTopics('{}', ['P1']))).toEqual(['the reply has no "topics" list'])
    expect(errorsOf(parseTopics('{"topics":{}}', ['P1']))).toEqual(['the reply has no "topics" list'])
  })

  test('an unknown part, a part in two topics and a part in none each give their error', () => {
    const reply = topicsReply([
      ['A', 'a', ['P1', 'P9']],
      ['B', 'b', ['P1']],
    ])
    expect(errorsOf(parseTopics(reply, ['P1', 'P2']))).toEqual([
      'topic 1 names an unknown part "P9"',
      'part P1 is in two topics',
      'part P2 is in no topic',
    ])
  })

  test('a blank or long title or summary gives its error; 60 and 160 code points are kept', () => {
    const reply = topicsReply([
      [' ', 's'.repeat(161), ['P1']],
      ['t'.repeat(61), '', ['P2']],
    ])
    expect(errorsOf(parseTopics(reply, ['P1', 'P2']))).toEqual([
      'topic 1 has a blank title',
      'topic 1 has a summary over 160 characters',
      'topic 2 has a title over 60 characters',
      'topic 2 has a blank summary',
    ])
    const longest = topicsReply([['t'.repeat(60), 's'.repeat(160), ['P1']]])
    expect(parseTopics(longest, ['P1'])).toEqual({
      kind: 'ok',
      topics: [{ id: 'T1', title: 't'.repeat(60), summary: 's'.repeat(160), partIds: ['P1'] }],
    })
  })

  test('a title or summary that is not a string is blank, and both are cleaned of hidden characters', () => {
    expect(errorsOf(parseTopics(topicsReply([[3, null, ['P1']]]), ['P1']))).toEqual([
      'topic 1 has a blank title',
      'topic 1 has a blank summary',
    ])
    const bell = String.fromCharCode(7)
    const hostile = topicsReply([[`Sec${BIDI_OVERRIDE}rets\n`, `Keep${bell} them out.`, ['P1']]])
    expect(parseTopics(hostile, ['P1'])).toEqual({
      kind: 'ok',
      topics: [{ id: 'T1', title: 'Secrets', summary: 'Keep them out.', partIds: ['P1'] }],
    })
  })

  test('a topic that is not an object, has no parts list or an empty one gives its error', () => {
    const topics = ['x', { title: 'A', summary: 'a' }, { title: 'B', summary: 'b', parts: [] }]
    const reply = JSON.stringify({ topics })
    expect(errorsOf(parseTopics(reply, ['P1']))).toEqual([
      'topic 1 is not an object',
      'topic 2 has no "parts" list',
      'topic 3 has no parts',
      'part P1 is in no topic',
    ])
  })

  test('a part named twice in one topic counts once; a part id that is not a string is unknown', () => {
    expect(parseTopics(topicsReply([['A', 'a', ['P1', 'P1']]]), ['P1'])).toEqual({
      kind: 'ok',
      topics: [{ id: 'T1', title: 'A', summary: 'a', partIds: ['P1'] }],
    })
    expect(errorsOf(parseTopics(topicsReply([['A', 'a', ['P1', 7]]]), ['P1']))).toEqual([
      'topic 1 names an unknown part "<non-string id>"',
    ])
  })

  test('at most 20 errors are listed, then one line that says there are more', () => {
    const ids = Array.from({ length: 30 }, (_, at) => `P${at + 1}`)
    const errors = errorsOf(parseTopics(topicsReply([['A', 'a', ['P99']]]), ids))
    expect(errors).toHaveLength(21)
    expect(errors.at(-1)).toBe('more errors not shown')
  })
})

describe('parseRecommendation', () => {
  test('a valid reply gives each topic and each memory the roles named for it', () => {
    const reply = '{"topics":{"T1":["security"],"T2":["tl"]},"memories":{"M1":["tl","pm"],"M2":[]}}'
    const result = parseRecommendation(reply, ['T1', 'T2'], ['M1', 'M2'], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
      ['M1', ['pm', 'tl']],
      ['M2', []],
    ])
  })

  test('a topic or memory left out is recommended to no role; the role ids come once each, in role order', () => {
    const reply = '{"topics":{"T1":["security","pm","security"]},"memories":{}}'
    const result = parseRecommendation(reply, ['T1', 'T2'], ['M1'], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([
      ['T1', ['pm', 'security']],
      ['T2', []],
      ['M1', []],
    ])
  })

  test('a reply in one code fence is read the same', () => {
    const result = parseRecommendation('```\n{"topics":{"T1":[]},"memories":{}}\n```', ['T1'], [], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([['T1', []]])
  })

  test('a reply that is not JSON, or has no topics or no memories object, gives that error', () => {
    expect(errorsOf(parseRecommendation('no', ['T1'], [], ROLE_IDS))).toEqual(['the reply is not JSON'])
    expect(errorsOf(parseRecommendation('{"topics":[],"memories":{}}', ['T1'], [], ROLE_IDS))).toEqual([
      'the reply has no "topics" object',
    ])
    expect(errorsOf(parseRecommendation('{"topics":{"T1":[]}}', ['T1'], [], ROLE_IDS))).toEqual([
      'the reply has no "memories" object',
    ])
    expect(errorsOf(parseRecommendation('{}', ['T1'], ['M1'], ROLE_IDS))).toEqual([
      'the reply has no "topics" object',
      'the reply has no "memories" object',
    ])
  })

  test('an unknown topic or memory, an unknown role and a value that is not a list each give their error', () => {
    const reply = '{"topics":{"T9":["pm"],"T1":["cto",3],"T2":"tl"},"memories":{"M9":[],"M1":["cto"],"M2":"pm"}}'
    expect(errorsOf(parseRecommendation(reply, ['T1', 'T2'], ['M1', 'M2'], ROLE_IDS))).toEqual([
      'unknown topic "T9"',
      'topic T1 names an unknown role "cto"',
      'topic T1 names an unknown role "<non-string id>"',
      'topic T2 is not a list of role ids',
      'unknown memory "M9"',
      'memory M1 names an unknown role "cto"',
      'memory M2 is not a list of role ids',
    ])
  })
})

describe('instruction prompts (G-02-1f)', () => {
  test('the grouping system prompt asks for JSON only, every part in exactly one topic and the length caps', () => {
    expect(TOPICS_SYSTEM).toContain('{"topics":[{"title":"...","summary":"...","parts":["P1"]}]}')
    expect(TOPICS_SYSTEM).toContain('exactly one topic')
    expect(TOPICS_SYSTEM).toContain('at most 60 characters')
    expect(TOPICS_SYSTEM).toContain('at most 160')
    expect(TOPICS_SYSTEM).toContain('across files')
  })

  test('the grouping prompt holds one line per part: id, file, heading and the start of its text', () => {
    const lines = topicsPrompt(PARTS, []).split('\n')
    expect(lines.slice(1)).toEqual([
      'P1 | ~/.claude/CLAUDE.md | Security | # Security Never commit secrets.',
      'P2 | ~/.claude/CLAUDE.md | Git | ## Git Use signed commits.',
    ])
  })

  test("a part with no heading is '(top of file)'; the text is cut to 300 code points, newlines as spaces", () => {
    const long = part('P1', '', `a\nb${'c'.repeat(400)}`)
    const line = `P1 | ~/.claude/CLAUDE.md | (top of file) | a b${'c'.repeat(297)}`
    expect(topicsPrompt([long], []).split('\n')[1]).toBe(line)
  })

  test('after a failed reply the prompt ends with its exact errors, one per line', () => {
    const lines = topicsPrompt(PARTS, ['part P2 is in no topic']).split('\n')
    expect(lines.slice(-2)).toEqual([
      'Your previous reply had these errors; fix all of them:',
      '- part P2 is in no topic',
    ])
  })

  test('the recommendation prompts hold each role, each topic with its summary, each memory with its summary', () => {
    expect(RECOMMEND_SYSTEM).toContain('{"topics":{"T1":["be"]},"memories":{"M1":[]}}')
    expect(RECOMMEND_SYSTEM).toContain('[] for a topic or memory no role needs')
    const prompt = recommendPrompt(ROLES, TOPICS, MEMORIES, [])
    for (const role of ROLES) expect(prompt).toContain(`${role.id} | ${role.title} | ${role.purpose}`)
    expect(prompt).toContain('T1 | Security rules | How secrets stay out of the repo.')
    expect(prompt).toContain('T2 | Git and commits | How commits are made.')
    expect(prompt).toContain('M1 | squad.md | Unsigned commits on per-phase branches.')
    expect(prompt).toContain('M2 | workflow.md | No summary in MEMORY.md.')
    const retried = recommendPrompt(ROLES, TOPICS, MEMORIES, ['unknown topic "T9"'])
    expect(retried.split('\n').at(-1)).toBe('- unknown topic "T9"')
  })

  test('no recommendation prompt carries a memory folder or hash, only the file and the summary', () => {
    const prompt = recommendPrompt(ROLES, TOPICS, MEMORIES, [])
    expect([prompt.includes(MEMORY), prompt.includes('hash of')]).toEqual([false, false])
  })

  test('no prompt carries a part past its first 300 code points', () => {
    const secret = 'SENTINEL_SECRET_VALUE'
    const prompt = topicsPrompt([part('P1', 'A', `# A\n${'x'.repeat(400)}${secret}`)], [])
    expect(prompt).not.toContain(secret)
  })
})

describe('fallbackTopics', () => {
  test('one topic per file, in file order: the file as the title and All of <file> as the summary', () => {
    const scan: InstructionScan = {
      parts: [...PARTS, part('P3', '', 'Repo rules.\n', 'CLAUDE.md')],
      files: ['~/.claude/CLAUDE.md', 'CLAUDE.md'],
      memories: [],
      warnings: [],
    }
    expect(fallbackTopics(scan)).toEqual([
      { id: 'T1', title: '~/.claude/CLAUDE.md', summary: 'All of ~/.claude/CLAUDE.md', partIds: ['P1', 'P2'] },
      { id: 'T2', title: 'CLAUDE.md', summary: 'All of CLAUDE.md', partIds: ['P3'] },
    ])
  })
})

describe('instructionLines', () => {
  test('the heading, then each topic with its summary, its sources and the roles it is recommended for', () => {
    expect(instructionLines(SCAN, TOPICS, RECOMMENDED)).toEqual([
      'Read for this run only (nothing is written):',
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

  test('a topic question names the topic; its context line has the summary, sources and recommended roles', () => {
    expect(topicQuestion(SECURITY_TOPIC)).toBe('Which roles get "Security rules"?')
    expect(topicContextLine(SECURITY_TOPIC, PARTS, ['security'])).toBe(
      'How secrets stay out of the repo. From: ~/.claude/CLAUDE.md > Security. Recommended: security.',
    )
    expect(topicContextLine(GIT_TOPIC, PARTS, [])).toBe(
      'How commits are made. From: ~/.claude/CLAUDE.md > Git. Recommended: none.',
    )
  })

  test('a topic context line names three sources, then how many more', () => {
    const many = ['A', 'B', 'C', 'D', 'E'].map((heading, at) => part(`P${at + 1}`, heading, `# ${heading}\n`))
    const topic = { id: 'T1', title: 'All', summary: 'Everything.', partIds: many.map(found => found.id) }
    expect(topicContextLine(topic, many, ['tl', 'security'])).toBe(
      'Everything. From: ~/.claude/CLAUDE.md > A, ~/.claude/CLAUDE.md > B, ~/.claude/CLAUDE.md > C, +2 more. ' +
        'Recommended: tl, security.',
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

/** The config folder of the fixture user, where the global CLAUDE.md lives. */
const CONFIG = '/home/u/.claude'

/**
 * Where the reader reads in the fixtures: the repo /repo, the home /home/u, no CLAUDE_CONFIG_DIR, this chain, no rule
 * file, no AGENTS.md and no memory folder.
 */
function sourcesOf(chain: readonly string[] = []): InstructionSources {
  return { root: '/repo', home: '/home/u', configDir: null, chain, rules: [], hasAgentsMd: false, memoryFolders: [] }
}

/** A world of the fixture user with these files; `over` changes the other fields it names. */
function filesWorld(files: Readonly<Record<string, string>>, over: Partial<MemWorld> = {}): MemWorld {
  return memWorld({ files, ...over })
}

/** The file, heading and source of each part a read gave, in read order. */
function placesOf(scan: InstructionScan): (readonly [string, string, string])[] {
  return scan.parts.map(found => [found.file, found.heading, found.source])
}

/** A text of `kib` KiB of the letter x under one heading. */
function kibText(heading: string, kib: number): string {
  return `# ${heading}\n${'x'.repeat(kib * 1024 - heading.length - 3)}`
}

describe('readInstructionFiles', () => {
  test('the global file, its imports depth first, then the chain outermost first, then the chain imports', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./b.md\n@./a.md\n',
        [`${CONFIG}/a.md`]: '# A\n@./c.md\n',
        [`${CONFIG}/b.md`]: '# B\n',
        [`${CONFIG}/c.md`]: '# C\n',
        '/repo/CLAUDE.md': '# R\nSee @docs/rules.md for the rules.\n',
        '/repo/.claude/CLAUDE.md': '# Local\n',
        '/repo/docs/rules.md': '# Rules\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md']))
    expect(run.reads).toEqual([
      `${CONFIG}/CLAUDE.md`,
      `${CONFIG}/a.md`,
      `${CONFIG}/c.md`,
      `${CONFIG}/b.md`,
      '/repo/CLAUDE.md',
      '/repo/.claude/CLAUDE.md',
      '/repo/docs/rules.md',
    ])
    expect(placesOf(scan)).toEqual([
      ['~/.claude/CLAUDE.md', 'G', 'global'],
      ['~/.claude/a.md', 'A', 'global'],
      ['~/.claude/c.md', 'C', 'global'],
      ['~/.claude/b.md', 'B', 'global'],
      ['CLAUDE.md', 'R', 'repo'],
      ['.claude/CLAUDE.md', 'Local', 'repo'],
      ['docs/rules.md', 'Rules', 'repo'],
    ])
    expect(scan.parts.map(found => found.id)).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'])
    expect(scan.files).toEqual(placesOf(scan).map(([file]) => file))
    expect(scan.warnings).toEqual([])
  })

  test('a path in the config folder is global and a path in the repo is a repo part, whoever imports it', async () => {
    const files = { [`${CONFIG}/CLAUDE.md`]: '# G\n@/repo/docs/x.md\n', '/repo/docs/x.md': '# X\n' }
    const run = memIo(filesWorld(files), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(placesOf(scan)).toEqual([
      ['~/.claude/CLAUDE.md', 'G', 'global'],
      ['docs/x.md', 'X', 'repo'],
    ])
  })

  test('imports are followed at most 3 levels deep', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./l1.md\n',
        [`${CONFIG}/l1.md`]: '# L1\n@./l2.md\n',
        [`${CONFIG}/l2.md`]: '# L2\n@./l3.md\n',
        [`${CONFIG}/l3.md`]: '# L3\n@./l4.md\n',
        [`${CONFIG}/l4.md`]: '# L4\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'L1', 'L2', 'L3'])
    expect(run.reads).not.toContain(`${CONFIG}/l4.md`)
  })

  test('at most 20 imported files are read for the global file, and 20 for the chain', async () => {
    const names = Array.from({ length: 25 }, (_, at) => `i${String(at + 1).padStart(2, '0')}.md`)
    const global = Object.fromEntries(names.map(name => [`${CONFIG}/${name}`, `# ${name}\n`]))
    const repo = Object.fromEntries(names.map(name => [`/repo/${name}`, `# ${name}\n`]))
    const imports = names.map(name => `@${name}`).join('\n')
    const roots = { [`${CONFIG}/CLAUDE.md`]: `# G\n${imports}\n`, '/repo/CLAUDE.md': `# R\n${imports}\n` }
    const run = memIo(filesWorld({ ...global, ...repo, ...roots }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.filter(found => found.source === 'global')).toHaveLength(21)
    expect(scan.parts.filter(found => found.source === 'repo')).toHaveLength(21)
    expect(run.reads).not.toContain(`${CONFIG}/i21.md`)
    expect(run.reads).not.toContain('/repo/i21.md')
  })

  test('each file is read once: a file imported twice, an import cycle, a chain file already read', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./a.md\n@./b.md\n@/repo/CLAUDE.md\n',
        [`${CONFIG}/a.md`]: '# A\n@./b.md\n',
        [`${CONFIG}/b.md`]: '# B\n@./a.md\n',
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'A', 'B', 'R'])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, `${CONFIG}/a.md`, `${CONFIG}/b.md`, '/repo/CLAUDE.md'])
  })

  test('a file over 256 KiB is not split; the read stops at 512 KiB in all and counts the files not read', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: `${kibText('G', 200)}\n@./a-big.md\n@./b-one.md\n@./c-two.md\n@./d-three.md\n`,
        [`${CONFIG}/a-big.md`]: kibText('Big', 300),
        [`${CONFIG}/b-one.md`]: kibText('One', 200),
        [`${CONFIG}/c-two.md`]: kibText('Two', 200),
        [`${CONFIG}/d-three.md`]: kibText('Three', 1),
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'One'])
    expect(scan.warnings).toEqual([
      '~/.claude/a-big.md is over 256 KiB, not split: no role gets it',
      'stopped reading at 512 KiB in total, 3 files not read: no role gets them',
    ])
    expect(run.reads).not.toContain(`${CONFIG}/d-three.md`)
    expect(run.reads).not.toContain('/repo/CLAUDE.md')
  })

  test('one file left unread is counted as 1 file', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: `${kibText('G', 250)}\n@./one.md\n@./two.md\n`,
        [`${CONFIG}/one.md`]: kibText('One', 250),
        [`${CONFIG}/two.md`]: kibText('Two', 20),
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.warnings).toEqual(['stopped reading at 512 KiB in total, 1 file not read: no role gets it'])
  })

  test('a repo file that links out of the repo is refused and never read (readRepoFile)', async () => {
    const world = filesWorld({ '/repo/CLAUDE.md': '# R\n' }, { realPaths: { '/repo/CLAUDE.md': '/home/u/secret.md' } })
    const run = memIo(world, [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts).toEqual([])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`])
    expect(scan.warnings).toEqual(['could not read CLAUDE.md: no role gets it'])
  })

  test('a global import outside the repo and the config folder is not read; a chain ancestor is (S2)', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@~/notes/private.md\n',
        '/home/u/notes/private.md': '# Private\n',
        '/home/u/work/CLAUDE.md': '# Work\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['~/work/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['G', 'Work'])
    expect(scan.warnings).toEqual([
      '~/notes/private.md is outside the repo and your config folder, not read: no role gets it',
    ])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/home/u/work/CLAUDE.md'])
  })

  test('a repo file importing ~/.claude/.credentials.json never reads it: the import stays in the repo', async () => {
    const credentials = `${CONFIG}/.credentials.json`
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@~/.claude/.credentials.json\n@../outside.md\n@docs/in.md\n',
        [credentials]: '{"accessToken":"sk-FAKE-SECRET-0123456789"}',
        '/outside.md': '# Outside\n',
        '/repo/docs/in.md': '# In\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/docs/in.md'])
    expect(run.reads).not.toContain(credentials)
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'In'])
    expect(scan.warnings).toEqual([
      '~/.claude/.credentials.json is imported by a repo file and is outside the repo, not read: no role gets it',
      '/outside.md is imported by a repo file and is outside the repo, not read: no role gets it',
    ])
    expect(JSON.stringify(scan)).not.toContain('sk-FAKE-SECRET')
  })

  test('a file the port cannot read gets the could-not-read warning; a missing one is quiet', async () => {
    const world = filesWorld({ [`${CONFIG}/CLAUDE.md`]: '# G\n@./gone.md\n@./broken.md\n' })
    const run = memIo({ ...world, unknownPaths: [`${CONFIG}/broken.md`] }, [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(scan.warnings).toEqual(['could not read ~/.claude/broken.md: no role gets it'])
    expect(scan.parts.map(found => found.heading)).toEqual(['G'])
  })

  test('parts beyond 120 are not offered and stay with the root session; the prompt lists 120 (S6)', async () => {
    const sections = Array.from({ length: 129 }, (_, at) => `# H${at + 1}\nbody\n`).join('')
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: sections, '/repo/CLAUDE.md': '# R\n' }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts).toHaveLength(120)
    expect(scan.parts.at(-1)?.heading).toBe('H120')
    expect(scan.files).toEqual(['~/.claude/CLAUDE.md'])
    expect(scan.warnings).toEqual([morePartsWarning(10)])
    expect(morePartsWarning(10)).toBe('10 more parts were not offered: they stay with the root session')
    expect(topicsPrompt(scan.parts, []).split('\n').filter(line => /^P\d+ \| /.test(line))).toHaveLength(120)
  })

  test('a chain CLAUDE.md above the repo is read as a private global part, not its outside import (S2)', async () => {
    const run = memIo(
      filesWorld({
        '/home/u/work/CLAUDE.md': '# Team\nShared rules.\n@./notes.md\n',
        '/home/u/work/notes.md': '# Notes\n',
        '/repo/CLAUDE.md': '# R\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['~/work/CLAUDE.md', '<repo>/CLAUDE.md']))
    expect(placesOf(scan)).toEqual([
      ['~/work/CLAUDE.md', 'Team', 'global'],
      ['CLAUDE.md', 'R', 'repo'],
    ])
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/home/u/work/CLAUDE.md', '/repo/CLAUDE.md'])
    expect(scan.warnings).toEqual([outsideWarning('~/work/notes.md')])
  })

  test('every not-read warning says that no role gets the file (S2)', () => {
    expect(unreadableWarning('CLAUDE.md')).toBe('could not read CLAUDE.md: no role gets it')
    expect(overSizeWarning('CLAUDE.md')).toBe('CLAUDE.md is over 256 KiB, not split: no role gets it')
    expect(outsideWarning('/x/a.md')).toBe(
      '/x/a.md is outside the repo and your config folder, not read: no role gets it',
    )
    expect(repoImportWarning('~/a.md')).toBe(
      '~/a.md is imported by a repo file and is outside the repo, not read: no role gets it',
    )
    expect(totalCapWarning(1)).toBe('stopped reading at 512 KiB in total, 1 file not read: no role gets it')
    expect(totalCapWarning(3)).toBe('stopped reading at 512 KiB in total, 3 files not read: no role gets them')
    expect(moreDocsWarning(2)).toBe('2 more referenced docs were not read: no role gets them')
  })

  test('with no config folder nothing global is read, and the chain still is', async () => {
    const run = memIo(filesWorld({ '/repo/CLAUDE.md': '# R\n' }), [])
    const sources = { ...sourcesOf(['<repo>/CLAUDE.md']), home: null }
    const scan = await readInstructionFiles(run.io, sources)
    expect(placesOf(scan)).toEqual([['CLAUDE.md', 'R', 'repo']])
    expect(run.reads).toEqual(['/repo/CLAUDE.md'])
  })

  test('a repo file is followed only to a plain .md file outside .git; no other file is read (M3)', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@./.env\n@./.git/config\n@./.git/x.md\n@./notes/.hidden.md\n@./data.json\n@./ok.md\n',
        '/repo/.env': 'API_KEY=sk-FAKE-SECRET-0123456789\n',
        '/repo/.git/config': '[remote "origin"]\n',
        '/repo/.git/x.md': '# X\n',
        '/repo/notes/.hidden.md': '# Hidden\n',
        '/repo/data.json': '{}\n',
        '/repo/ok.md': '# Ok\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/ok.md'])
    expect(placesOf(scan)).toEqual([
      ['CLAUDE.md', 'R', 'repo'],
      ['ok.md', 'Ok', 'repo'],
    ])
    const unfollowed = ['.env', '.git/config', '.git/x.md', 'data.json', 'notes/.hidden.md']
    expect(scan.warnings).toEqual(unfollowed.map(unfollowedImportWarning))
    expect(unfollowedImportWarning('.env')).toBe(
      '.env is linked from a repo file and is a dotfile, under .git/ or not a .md file, not read: no role gets it',
    )
  })

  test('a doc link of a repo file into .git or to a dotfile is not read (M3)', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[x](.git/a.md) [y](docs/.secret.md) [z](docs/z.md)\n',
        '/repo/.git/a.md': '# A\n',
        '/repo/docs/.secret.md': '# Secret\n',
        '/repo/docs/z.md': '# Z\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(run.reads).toEqual([`${CONFIG}/CLAUDE.md`, '/repo/CLAUDE.md', '/repo/docs/z.md'])
    expect(scan.warnings).toEqual([unfollowedImportWarning('.git/a.md'), unfollowedImportWarning('docs/.secret.md')])
  })

  test("the global file's own imports are not held to the repo-link rule: a dotfile there is read (M3)", async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# G\n@./.notes.md\n@./data.json\n',
        [`${CONFIG}/.notes.md`]: '# Notes\n',
        [`${CONFIG}/data.json`]: '# Data\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect(placesOf(scan)).toEqual([
      ['~/.claude/CLAUDE.md', 'G', 'global'],
      ['~/.claude/.notes.md', 'Notes', 'global'],
      ['~/.claude/data.json', 'Data', 'global'],
    ])
    expect(scan.warnings).toEqual([])
  })

  test('two repo paths that share their first 125 code points stay two files, shown cleaned (N3)', async () => {
    const stem = 'd'.repeat(125)
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': `# R\n@${stem}x.md\n@${stem}y.md\n`,
        [`/repo/${stem}x.md`]: '# X\n',
        [`/repo/${stem}y.md`]: '# Y\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.files).toEqual(['CLAUDE.md', `${stem}x.md`, `${stem}y.md`])
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', `${stem}x.md`, `${stem}y.md`])
    const topics = fallbackTopics(scan)
    expect(topics.map(topic => topic.partIds)).toEqual([['P1'], ['P2'], ['P3']])
    const shownFile = `${'d'.repeat(119)}…`
    expect(instructionLines(scan, topics, new Map()).filter(line => line.startsWith('    from: '))).toEqual([
      '    from: CLAUDE.md > R',
      `    from: ${shownFile} > X`,
      `    from: ${shownFile} > Y`,
    ])
    const contexts = topics.map(topic => topicContextLine(topic, scan.parts, []))
    expect(contexts.filter(line => line.includes(`From: ${'d'.repeat(100)}`))).toHaveLength(2)
    expect(contexts.filter(line => line.includes(`${stem}x.md >`) || line.includes(`${stem}y.md >`))).toEqual([])
    expect(topicsPrompt(scan.parts, [])).toContain(`P2 | ${shownFile} | X | # X`)
  })

  test('a CLAUDE_CONFIG_DIR inside the repo is not the config folder: nothing under it is read (N10)', async () => {
    const run = memIo(filesWorld({ '/repo/.cfg/CLAUDE.md': '# Cfg\n' }), [])
    const scan = await readInstructionFiles(run.io, { ...sourcesOf(), configDir: '/repo/.cfg' })
    expect(scan.parts.filter(found => found.file.startsWith('.cfg/'))).toEqual([])
    expect(run.reads.filter(path => path.startsWith('/repo/.cfg'))).toEqual([])
  })
})

/** The rules folder of the fixture repo. */
const RULES = '/repo/.claude/rules'

/** The sources of sourcesOf with these rule file names, null for a rules folder not listed, and AGENTS.md or not. */
function repoSources(
  chain: readonly string[],
  rules: readonly string[] | null,
  hasAgentsMd: boolean,
): InstructionSources {
  return { ...sourcesOf(chain), rules, hasAgentsMd }
}

describe('rules, AGENTS.md and referenced docs', () => {
  test('referencedDocs gives the relative .md links that land in the repo, once each, in text order', () => {
    const text = [
      'Read [the guide](docs/guide.md), [setup](./docs/setup.md#install) and [notes](../notes.md "Notes").',
      'Again [the guide](docs/guide.md); out of the repo [x](../../outside.md).',
    ].join('\n')
    expect(referencedDocs(text, '/repo/pkg', '/repo')).toEqual([
      '/repo/pkg/docs/guide.md',
      '/repo/pkg/docs/setup.md',
      '/repo/notes.md',
    ])
  })

  test('a line of many unclosed links is read in linear time: no doc, in under 2 s (M1)', () => {
    const started = Date.now()
    expect(referencedDocs('[a](x'.repeat(20_000), '/repo', '/repo')).toEqual([])
    expect(Date.now() - started).toBeLessThanOrEqual(1_999)
  })

  test('a link with a scheme, an absolute path, another extension, only an anchor or a folder is no doc', () => {
    const text = [
      '[web](https://example.com/a.md) [mail](mailto:x@y.md) [abs](/repo/a.md)',
      '[txt](docs/a.txt) [top](#top) [dir](docs/) [query](docs/a.md?raw=1)',
    ].join('\n')
    expect(referencedDocs(text, '/repo', '/repo')).toEqual([])
  })

  test('after the chain: each rule file in name order, then AGENTS.md, then the docs repo files link to', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\nRead [the guide](docs/guide.md).\n',
        [`${RULES}/a.md`]: '# A\n',
        [`${RULES}/b.md`]: '# B\nSee [the style](../../docs/style.md).\n',
        '/repo/AGENTS.md': '# Agents\nSee [the guide](docs/guide.md) and [the design](docs/arch.md).\n',
        '/repo/docs/guide.md': '# Guide\n',
        '/repo/docs/style.md': '# Style\n',
        '/repo/docs/arch.md': '# Arch\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['b.md', 'a.md'], true))
    expect(run.reads).toEqual([
      `${CONFIG}/CLAUDE.md`,
      '/repo/CLAUDE.md',
      `${RULES}/a.md`,
      `${RULES}/b.md`,
      '/repo/AGENTS.md',
      '/repo/docs/guide.md',
      '/repo/docs/style.md',
      '/repo/docs/arch.md',
    ])
    expect(placesOf(scan)).toEqual([
      ['CLAUDE.md', 'R', 'repo'],
      ['.claude/rules/a.md', 'A', 'repo'],
      ['.claude/rules/b.md', 'B', 'repo'],
      ['AGENTS.md', 'Agents', 'repo'],
      ['docs/guide.md', 'Guide', 'repo'],
      ['docs/style.md', 'Style', 'repo'],
      ['docs/arch.md', 'Arch', 'repo'],
    ])
    expect(scan.warnings).toEqual([])
  })

  test('docs come from the repo files read, one level: a doc a doc links to is not read', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[a](docs/a.md)\n',
        '/repo/docs/a.md': '# A\n[b](b.md)\n',
        '/repo/docs/b.md': '# B\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'A'])
    expect(run.reads).not.toContain('/repo/docs/b.md')
  })

  test('at most 20 docs are read, in first-seen order; the rest are counted in one warning', async () => {
    const names = Array.from({ length: 23 }, (_, at) => `d${String(at + 1).padStart(2, '0')}.md`)
    const docs = Object.fromEntries(names.map(name => [`/repo/docs/${name}`, `# ${name}\n`]))
    const links = names.map(name => `[${name}](docs/${name})`).join('\n')
    const run = memIo(filesWorld({ ...docs, '/repo/CLAUDE.md': `# R\n${links}\n` }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md']))
    const read = names.slice(0, 20).map(name => `docs/${name}`)
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', ...read])
    expect(run.reads).not.toContain('/repo/docs/d21.md')
    expect(scan.warnings).toEqual(['3 more referenced docs were not read: no role gets them'])
    expect(moreDocsWarning(3)).toBe('3 more referenced docs were not read: no role gets them')
  })

  test('a doc already read, as a chain import or a rule file, is read once and not counted toward 20', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n@docs/a.md\n[a](docs/a.md) [rule](.claude/rules/x.md) [b](docs/b.md)\n',
        '/repo/docs/a.md': '# A\n',
        [`${RULES}/x.md`]: '# X\n',
        '/repo/docs/b.md': '# B\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['x.md'], false))
    expect(scan.parts.map(found => found.heading)).toEqual(['R', 'A', 'X', 'B'])
    expect(run.reads.filter(path => path.startsWith('/repo/'))).toEqual([
      '/repo/CLAUDE.md',
      '/repo/docs/a.md',
      `${RULES}/x.md`,
      '/repo/docs/b.md',
    ])
  })

  test('a rules folder that could not be listed is a warning, and no rule file is read', async () => {
    const run = memIo(filesWorld({ [`${RULES}/a.md`]: '# A\n' }), [])
    const scan = await readInstructionFiles(run.io, repoSources([], null, false))
    expect(scan.warnings).toEqual([RULES_UNLISTED_WARNING])
    expect(RULES_UNLISTED_WARNING).toBe('could not list .claude/rules (treated as unknown)')
    expect(run.reads).not.toContain(`${RULES}/a.md`)
  })

  test('AGENTS.md is read only when it was found before the consent', async () => {
    const run = memIo(filesWorld({ '/repo/AGENTS.md': '# Agents\n' }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    expect([scan.parts, run.reads.includes('/repo/AGENTS.md')]).toEqual([[], false])
  })

  test('a rule file that links out of the repo is refused and never read (readRepoFile)', async () => {
    const world = filesWorld({ [`${RULES}/a.md`]: '# A\n' }, { realPaths: { [`${RULES}/a.md`]: '/home/u/secret.md' } })
    const run = memIo(world, [])
    const scan = await readInstructionFiles(run.io, repoSources([], ['a.md'], false))
    expect([scan.parts, run.reads.includes(`${RULES}/a.md`)]).toEqual([[], false])
    expect(scan.warnings).toEqual(['could not read .claude/rules/a.md: no role gets it'])
  })

  test('a rule file in a sub-folder of .claude/rules is named, counted and read as a part (M4)', async () => {
    const world = memWorld({
      dirs: { [RULES]: [entry('a.md'), entry('frontend', 'dir')], [`${RULES}/frontend`]: [entry('react.md')] },
      files: { [`${RULES}/a.md`]: '# A\n', [`${RULES}/frontend/react.md`]: '# React\n' },
    })
    const names = await repoInstructionNames(memIo(world, []).io, '/repo')
    expect(names).toEqual({ rules: ['a.md', 'frontend/react.md'], hasAgentsMd: false })
    expect(contentContextLine(emptySetupScan(), names)).toContain(', 2 rule files, ')
    const scan = await readInstructionFiles(memIo(world, []).io, repoSources([], names.rules, false))
    expect(placesOf(scan)).toEqual([
      ['.claude/rules/a.md', 'A', 'repo'],
      ['.claude/rules/frontend/react.md', 'React', 'repo'],
    ])
  })

  test('repoInstructionNames lists the .md files of .claude/rules and stats AGENTS.md, reading nothing', async () => {
    const world = memWorld({
      dirs: { [RULES]: [entry('b.md'), entry('a.md'), entry('notes.txt'), entry('sub', 'dir'), link('l.md')] },
      files: { '/repo/AGENTS.md': '# Agents\n', [`${RULES}/a.md`]: 'SENTINEL', [`${RULES}/b.md`]: 'SENTINEL' },
    })
    const run = memIo(world, [])
    expect(await repoInstructionNames(run.io, '/repo')).toEqual({ rules: ['a.md', 'b.md'], hasAgentsMd: true })
    expect([run.reads, run.listed]).toEqual([[], [RULES]])
  })

  test('no rules folder gives no rule file; one that cannot be listed or links out gives null', async () => {
    const none = memIo(memWorld({}), [])
    expect(await repoInstructionNames(none.io, '/repo')).toEqual({ rules: [], hasAgentsMd: false })
    const unknown = memIo(memWorld({ dirs: { [RULES]: [entry('a.md')] }, unknownPaths: [RULES] }), [])
    expect((await repoInstructionNames(unknown.io, '/repo')).rules).toBeNull()
    const linkedOut = { dirs: { [RULES]: [entry('a.md')] }, realPaths: { [RULES]: '/elsewhere/rules' } }
    const outside = memIo(memWorld(linkedOut), [])
    expect((await repoInstructionNames(outside.io, '/repo')).rules).toBeNull()
    expect(outside.listed).toEqual([])
  })
})

/** The MEMORY.md of the memory cases: an index line for a.md and one for c.md, and a line that is not one. */
const MEMORY_INDEX_TEXT =
  '# Memory\n- [A](a.md) \u2014 the a memory\n- [C](c.md) - the c memory\nSENTINEL_SECRET_VALUE\n'

describe('memoryIndex', () => {
  test('an index line gives its file the summary after an em dash or a hyphen', () => {
    const index = memoryIndex(
      [
        '# Memory index',
        '- [Squad unsigned commits](squad.md) \u2014 squad worktree: unsigned commits on per-phase branches',
        '- [Workflow](workflow.md) - more than 4 sub-agents go through the Workflow tool',
      ].join('\r\n'),
    )
    expect([...index.entries()]).toEqual([
      ['squad.md', 'squad worktree: unsigned commits on per-phase branches'],
      ['workflow.md', 'more than 4 sub-agents go through the Workflow tool'],
    ])
  })

  test('a link line with no summary after it gives its title; any other line is ignored', () => {
    const index = memoryIndex(
      [
        '- [Just a title](title.md)',
        '- [Blank summary](blank.md) \u2014   ',
        'Text with [a link](x.md) \u2014 not an index line',
        '* [Star](star.md) \u2014 another list mark',
        '  - [Nested](nested.md) \u2014 indented',
        '- [](empty.md)',
      ].join('\n'),
    )
    expect([...index.entries()]).toEqual([
      ['title.md', 'Just a title'],
      ['blank.md', 'Blank summary'],
    ])
  })

  test('a summary is cleaned and cut to 160 code points; a file named twice keeps its first line', () => {
    const long = `- [A](a.md) \u2014 Sec${BIDI_OVERRIDE}ret ${'s'.repeat(200)}`
    const index = memoryIndex(`${long}\n- [A again](a.md) - second`)
    expect(index.get('a.md')).toBe(`Secret ${'s'.repeat(152)}\u2026`)
    expect(index.size).toBe(1)
  })
})

describe('readMemories', () => {
  test('MEMORY.md first, then each other .md file once, in name order, with its folder, summary and hash', async () => {
    const run = memIo(
      memWorld({
        dirs: {
          [MEMORY]: [entry('b.md'), entry('MEMORY.md'), entry('a.md')],
          [GIVEN_MEMORY]: [entry('a.md'), entry('c.md')],
        },
        files: {
          [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT,
          [`${MEMORY}/a.md`]: 'text of a',
          [`${MEMORY}/b.md`]: 'text of b',
          [`${GIVEN_MEMORY}/a.md`]: 'another a',
          [`${GIVEN_MEMORY}/c.md`]: 'text of c',
        },
      }),
      [],
    )
    const read = await readMemories(run.io, [MEMORY, GIVEN_MEMORY])
    expect(run.reads).toEqual([`${MEMORY}/MEMORY.md`, `${MEMORY}/a.md`, `${MEMORY}/b.md`, `${GIVEN_MEMORY}/c.md`])
    expect(read.memories).toEqual([
      { id: 'M1', file: 'a.md', folder: MEMORY, summary: 'the a memory', hash: await sha256Hex('text of a') },
      { id: 'M2', file: 'b.md', folder: MEMORY, summary: NO_MEMORY_SUMMARY, hash: await sha256Hex('text of b') },
      { id: 'M3', file: 'c.md', folder: GIVEN_MEMORY, summary: 'the c memory', hash: await sha256Hex('text of c') },
    ])
    expect(read.warnings).toEqual([])
  })

  test('with no MEMORY.md every memory gets No summary in MEMORY.md.', async () => {
    const world = memWorld({ dirs: { [MEMORY]: [entry('a.md')] }, files: { [`${MEMORY}/a.md`]: 'text of a' } })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => [found.id, found.file, found.summary])).toEqual([
      ['M1', 'a.md', 'No summary in MEMORY.md.'],
    ])
  })

  test('the text of a memory and of MEMORY.md is never kept: only file, folder, summary and hash', async () => {
    const world = memWorld({
      dirs: { [MEMORY]: [entry('MEMORY.md'), entry('a.md')] },
      files: { [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT, [`${MEMORY}/a.md`]: 'sk-FAKE-SECRET-0123456789' },
    })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => Object.keys(found))).toEqual([['id', 'file', 'folder', 'summary', 'hash']])
    expect(JSON.stringify(read)).not.toContain('SECRET')
  })

  test('a folder that cannot be listed gives the memory folder warning once; a missing folder is quiet', async () => {
    const unknown = memIo(memWorld({ unknownPaths: [MEMORY, GIVEN_MEMORY] }), [])
    expect(await readMemories(unknown.io, [MEMORY, GIVEN_MEMORY])).toEqual({
      memories: [],
      warnings: [MEMORY_UNLISTED_WARNING],
    })
    expect(MEMORY_UNLISTED_WARNING).toBe('could not list the memory folder (treated as unknown)')
    expect(await readMemories(memIo(memWorld({}), []).io, [MEMORY])).toEqual({ memories: [], warnings: [] })
  })

  test('a link, a folder, another extension and a name with a hidden character are no memory', async () => {
    const hidden = `hid${BIDI_OVERRIDE}den.md`
    const world = memWorld({
      dirs: { [MEMORY]: [entry('notes.txt'), entry('sub', 'dir'), link('l.md'), entry(hidden), entry('ok.md')] },
      files: { [`${MEMORY}/ok.md`]: 'ok', [`${MEMORY}/${hidden}`]: 'hidden', [`${MEMORY}/notes.txt`]: 'txt' },
    })
    const run = memIo(world, [])
    const read = await readMemories(run.io, [MEMORY])
    expect(read.memories.map(found => found.file)).toEqual(['ok.md'])
    expect(run.reads).toEqual([`${MEMORY}/ok.md`])
  })

  test('a memory the port cannot read, or one over 256 KiB, is not offered and gets its warning', async () => {
    const world = memWorld({
      dirs: { [MEMORY]: [entry('bad.md'), entry('big.md'), entry('good.md')] },
      files: { [`${MEMORY}/big.md`]: 'x'.repeat(300 * 1024), [`${MEMORY}/good.md`]: 'good' },
      unknownPaths: [`${MEMORY}/bad.md`],
    })
    const read = await readMemories(memIo(world, []).io, [MEMORY])
    expect(read.memories.map(found => [found.id, found.file])).toEqual([['M1', 'good.md']])
    expect(read.warnings).toEqual([
      'could not read bad.md: no role gets it',
      'big.md is over 256 KiB, not split: no role gets it',
    ])
  })

  test('readInstructionFiles reads the memories last, after the docs, and its scan holds them', async () => {
    const run = memIo(
      filesWorld(
        { '/repo/CLAUDE.md': '# R\n', [`${MEMORY}/MEMORY.md`]: MEMORY_INDEX_TEXT, [`${MEMORY}/a.md`]: 'text of a' },
        { dirs: { [MEMORY]: [entry('MEMORY.md'), entry('a.md')] } },
      ),
      [],
    )
    const sources = { ...sourcesOf(['<repo>/CLAUDE.md']), memoryFolders: [MEMORY] }
    const scan = await readInstructionFiles(run.io, sources)
    expect(run.reads.slice(-3)).toEqual(['/repo/CLAUDE.md', `${MEMORY}/MEMORY.md`, `${MEMORY}/a.md`])
    expect(scan.memories.map(found => [found.id, found.file, found.summary])).toEqual([['M1', 'a.md', 'the a memory']])
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md'])
  })
})

describe('part hashes', () => {
  test('every part carries the SHA-256 of its text, its heading line included', async () => {
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: GLOBAL_TEXT }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    const texts = ['# Security\nNever commit secrets.\n', '## Git\nUse signed commits.\n']
    expect(scan.parts.map(found => found.text)).toEqual(texts)
    const hashes = [await sha256Hex(texts[0] ?? ''), await sha256Hex(texts[1] ?? '')]
    expect(scan.parts.map(found => found.hash)).toEqual(hashes)
  })

  test('the same text in two files gives the same hash, and a changed byte changes it', async () => {
    const run = memIo(
      filesWorld({
        [`${CONFIG}/CLAUDE.md`]: '# Same\nKeep it short.\n',
        '/repo/CLAUDE.md': '# Same\nKeep it short.\n',
        '/repo/.claude/CLAUDE.md': '# Same\nKeep it short!\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, sourcesOf(['<repo>/CLAUDE.md', '<repo>/.claude/CLAUDE.md']))
    const [global, repo, changed] = scan.parts.map(found => found.hash)
    expect([scan.parts.length, global === repo, repo === changed]).toEqual([3, true, false])
    expect(global).toBe(await sha256Hex('# Same\nKeep it short.\n'))
  })

  test('a part of every source has a hash of 64 lowercase hex characters: rules, AGENTS.md and docs', async () => {
    const run = memIo(
      filesWorld({
        '/repo/CLAUDE.md': '# R\n[a doc](docs/a.md)\n',
        [`${RULES}/x.md`]: '# X\n',
        '/repo/AGENTS.md': '# Agents\n',
        '/repo/docs/a.md': '# A\n',
      }),
      [],
    )
    const scan = await readInstructionFiles(run.io, repoSources(['<repo>/CLAUDE.md'], ['x.md'], true))
    expect(scan.parts.map(found => found.file)).toEqual(['CLAUDE.md', '.claude/rules/x.md', 'AGENTS.md', 'docs/a.md'])
    expect(scan.parts.filter(found => /^[0-9a-f]{64}$/.test(String(found.hash)))).toHaveLength(4)
  })

  test('a hash is in the scan only: the pane and the prompts never carry it', async () => {
    const run = memIo(filesWorld({ [`${CONFIG}/CLAUDE.md`]: GLOBAL_TEXT }), [])
    const scan = await readInstructionFiles(run.io, sourcesOf())
    const hashes = scan.parts.map(found => String(found.hash))
    const shown = [...instructionLines(scan, TOPICS, RECOMMENDED), topicsPrompt(scan.parts, [])].join('\n')
    expect([hashes.every(hash => hash.length === 64), hashes.some(hash => shown.includes(hash))]).toEqual([true, false])
  })
})
