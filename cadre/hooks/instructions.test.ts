import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan, InstructionTopic } from '../types'
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
  parseContentConsent,
  parseRecommendation,
  parseTopics,
  RECOMMEND_SYSTEM,
  recommendPrompt,
  splitSections,
  topicContextLine,
  topicHeader,
  topicItems,
  topicQuestion,
  TOPICS_SYSTEM,
  topicsPrompt,
} from './instructions'
import { BIDI_OVERRIDE, emptySetupScan, templateRole } from './testkit'

/** The global CLAUDE.md of the cases: a Security section and a Git section, as the plan's dry run has it. */
const GLOBAL_TEXT = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

/** A part of the global CLAUDE.md with this id, heading and text; `file` changes the file it comes from. */
function part(id: string, heading: string, text: string, file = '~/.claude/CLAUDE.md'): InstructionPart {
  return { id, file, heading, source: 'global', text }
}

/** The two parts of GLOBAL_TEXT, in read order. */
const PARTS: readonly InstructionPart[] = [
  part('P1', 'Security', '# Security\nNever commit secrets.\n'),
  part('P2', 'Git', '## Git\nUse signed commits.\n'),
]

/** The read of GLOBAL_TEXT: its two parts, the one file they came from and no warning. */
const SCAN: InstructionScan = { parts: PARTS, files: ['~/.claude/CLAUDE.md'], warnings: [] }

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
  test('a valid reply gives each topic the roles named for it', () => {
    const reply = '{"topics":{"T1":["security"],"T2":["tl"]}}'
    const result = parseRecommendation(reply, ['T1', 'T2'], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([
      ['T1', ['security']],
      ['T2', ['tl']],
    ])
  })

  test('a topic left out is recommended to no role; the role ids come once each, in role order', () => {
    const result = parseRecommendation('{"topics":{"T1":["security","pm","security"]}}', ['T1', 'T2'], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([
      ['T1', ['pm', 'security']],
      ['T2', []],
    ])
  })

  test('a reply in one code fence is read the same', () => {
    const result = parseRecommendation('```\n{"topics":{"T1":[]}}\n```', ['T1'], ROLE_IDS)
    expect(result.kind === 'ok' ? [...result.recommended.entries()] : result.errors).toEqual([['T1', []]])
  })

  test('a reply that is not JSON, or has no topics object, gives that error', () => {
    expect(errorsOf(parseRecommendation('no', ['T1'], ROLE_IDS))).toEqual(['the reply is not JSON'])
    expect(errorsOf(parseRecommendation('{"topics":[]}', ['T1'], ROLE_IDS))).toEqual([
      'the reply has no "topics" object',
    ])
  })

  test('an unknown topic, an unknown role and a value that is not a list each give their error', () => {
    const reply = '{"topics":{"T9":["pm"],"T1":["cto",3],"T2":"tl"}}'
    expect(errorsOf(parseRecommendation(reply, ['T1', 'T2'], ROLE_IDS))).toEqual([
      'unknown topic "T9"',
      'topic T1 names an unknown role "cto"',
      'topic T1 names an unknown role "<non-string id>"',
      'topic T2 is not a list of role ids',
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

  test('the recommendation prompts hold each role as id | title | purpose and each topic with its summary', () => {
    expect(RECOMMEND_SYSTEM).toContain('{"topics":{"T1":["be"]}}')
    expect(RECOMMEND_SYSTEM).toContain('[] for a topic no role needs')
    const prompt = recommendPrompt(ROLES, TOPICS, [])
    for (const role of ROLES) expect(prompt).toContain(`${role.id} | ${role.title} | ${role.purpose}`)
    expect(prompt).toContain('T1 | Security rules | How secrets stay out of the repo.')
    expect(prompt).toContain('T2 | Git and commits | How commits are made.')
    expect(recommendPrompt(ROLES, TOPICS, ['unknown topic "T9"']).split('\n').at(-1)).toBe('- unknown topic "T9"')
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
    const scan: InstructionScan = { parts: [part('P1', '', 'Intro.\n')], files: ['~/.claude/CLAUDE.md'], warnings: [] }
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
})

describe('instructionReviewLines', () => {
  test('per role the topics it gets, else none, then the topics kept with the root session only', () => {
    expect(instructionReviewLines(ROLES, TOPICS, RECOMMENDED)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 1 topic: Git and commits',
      '  security: 1 topic: Security rules',
      'Kept with the root session only: 0 topics',
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
    expect(instructionReviewLines(ROLES, topics, given)).toEqual([
      'Instructions per role:',
      '  pm: none',
      '  tl: 4 topics: A, B, C, +1 more',
      '  security: none',
      'Kept with the root session only: 1 topic',
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

  test('the content consent context line counts the global file, the repo chain and the memories', () => {
    const found = emptySetupScan({ hasGlobalClaudeMd: true, claudeMd: ['<repo>/CLAUDE.md'], memoryFiles: ['a.md'] })
    expect(contentContextLine(found)).toBe(
      'Found: global CLAUDE.md yes, 1 CLAUDE.md file in the repo chain, 1 memory. No keeps the whole-file questions.',
    )
    const more = emptySetupScan({ claudeMd: ['~/CLAUDE.md', '<repo>/CLAUDE.md'], memoryFiles: ['a.md', 'b.md'] })
    expect(contentContextLine(more)).toBe(
      'Found: global CLAUDE.md no, 2 CLAUDE.md files in the repo chain, 2 memories. No keeps the whole-file questions.',
    )
    expect(contentContextLine(emptySetupScan())).toBe(
      'Found: global CLAUDE.md no, 0 CLAUDE.md files in the repo chain, 0 memories. No keeps the whole-file questions.',
    )
  })

  test('the entry question offers Accept recommendations, Go part by part and Whole files', () => {
    expect(INSTRUCTIONS_ENTRY_QUESTION).toBe('How do you want to hand out the instruction parts?')
    expect(INSTRUCTIONS_ENTRY_OPTIONS).toEqual(['Accept recommendations', 'Go part by part', 'Whole files'])
    expect(Object.isFrozen(INSTRUCTIONS_ENTRY_OPTIONS)).toBe(true)
    expect(entryContextLine(SCAN, TOPICS)).toBe(
      '2 topics from 1 file; the pane shows each with the roles it is recommended for.',
    )
    expect(entryContextLine({ ...SCAN, files: ['a', 'b'] }, TOPICS.slice(0, 1))).toBe(
      '1 topic from 2 files; the pane shows each with the roles it is recommended for.',
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
})
