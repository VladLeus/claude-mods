import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart, InstructionScan } from '../../types'
import { BIDI_OVERRIDE, MEMORIES, MEMORY, templateRole, TOPICS } from '../testkit'
import { RECOMMEND_SYSTEM, recommendPrompt } from './instructions'
import { fallbackTopics, parseTopics, TOPICS_SYSTEM, topicsPrompt } from './topics'

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

/** The team of the cases: PM, Team Lead and Security, in that order. */
const ROLES = [templateRole('pm'), templateRole('tl'), templateRole('security')]

/** A reply parsed, or the errors of one that was not. */
type Parsed = { readonly kind: 'ok' } | { readonly kind: 'invalid'; readonly errors: readonly string[] }

/** The errors of an invalid reply; [] for a reply that parsed. */
function errorsOf(result: Parsed): readonly string[] {
  return result.kind === 'invalid' ? result.errors : []
}

/** The grouping reply that gives TOPICS. */
const TOPICS_REPLY = JSON.stringify({
  topics: [
    { title: 'Security rules', summary: 'How secrets stay out of the repo.', parts: ['P1'] },
    { title: 'Git and commits', summary: 'How commits are made.', parts: ['P2'] },
  ],
})

/** A grouping reply of these topics, each `[title, summary, parts]`, as JSON. */
function topicsReply(topics: readonly (readonly [unknown, unknown, unknown])[]): string {
  return JSON.stringify({ topics: topics.map(([title, summary, parts]) => ({ title, summary, parts })) })
}

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
