import { describe, expect, test } from 'claude-code/testing'

import { errorsOf, ROLES } from '../testkit'
import type { Parsed } from '../testkit'
import { parseRecommendation } from './instructions'

/** The role ids of ROLES, in role order. */
const ROLE_IDS = ROLES.map(role => role.id)

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

  test('a reply that is not JSON, or has no topics or no memories object it must have, gives that error', () => {
    expect(errorsOf(parseRecommendation('no', ['T1'], [], ROLE_IDS))).toEqual(['the reply is not JSON'])
    expect(errorsOf(parseRecommendation('{"topics":[],"memories":{}}', ['T1'], [], ROLE_IDS))).toEqual([
      'the reply has no "topics" object',
    ])
    expect(errorsOf(parseRecommendation('{"topics":{"T1":[]}}', ['T1'], ['M1'], ROLE_IDS))).toEqual([
      'the reply has no "memories" object',
    ])
    expect(errorsOf(parseRecommendation('{}', ['T1'], ['M1'], ROLE_IDS))).toEqual([
      'the reply has no "topics" object',
      'the reply has no "memories" object',
    ])
  })

  test('a map left out whose id list is empty counts as empty (N14)', () => {
    const topicsOnly = parseRecommendation('{"topics":{"T1":["be"]}}', ['T1'], [], ['be'])
    expect(topicsOnly.kind === 'ok' ? [...topicsOnly.recommended.entries()] : topicsOnly.errors).toEqual([
      ['T1', ['be']],
    ])
    const memoriesOnly = parseRecommendation('{"memories":{"M1":[]}}', [], ['M1'], ['be'])
    expect(memoriesOnly.kind === 'ok' ? [...memoriesOnly.recommended.entries()] : memoriesOnly.errors).toEqual([
      ['M1', []],
    ])
    expect(errorsOf(parseRecommendation('{"memories":{}}', ['T1'], [], ['be']))).toEqual([
      'the reply has no "topics" object',
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
