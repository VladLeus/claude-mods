import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec } from '../../types'
import { applyAdjust } from '../roles'
import type { AdjustOp } from '../roles'
import { BIDI_OVERRIDE, ZERO_WIDTH_SPACE } from '../testkit'
import { roleFromTemplate, ROLE_TEMPLATE } from './template'
import {
  isAutopilotDuration,
  isModelName,
  MAX_DESCRIPTION_CHARS,
  MAX_PROPOSAL_ERRORS,
  MAX_PURPOSE_CHARS,
  MAX_ROLES,
  MODEL_ALIASES,
  RESERVED_ROLE_IDS,
  validateRoleId,
  validateRoles,
} from './validate'

/** The rule every slug message ends with. */
const SLUG_RULE = 'must be a lowercase slug: a letter, then letters, digits or dashes, 24 characters at most'

/** The message for an id that is not a slug, with the id as the message shows it. */
function slugMessage(label: string): string {
  return `role id "${label}" ${SLUG_RULE}`
}

/** `count` valid roles r0, r1, ... for the checks that only count them. */
function manyRoles(count: number): { id: string; title: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `r${index}`, title: `R${index}` }))
}

/** The team init starts from: every template role. */
const TEAM: readonly RoleSpec[] = ROLE_TEMPLATE.map(roleFromTemplate)

/** The roles frozen, so an adjustment that changes its input throws. */
function frozen(roles: readonly RoleSpec[]): readonly RoleSpec[] {
  return Object.freeze(roles.map(role => Object.freeze({ ...role })))
}

/** The message of a refused adjustment; a test that expected a refusal fails here. */
function refused(roles: readonly RoleSpec[], op: AdjustOp): string {
  const result = applyAdjust(frozen(roles), op)
  if (result.kind === 'ok') throw new Error('the adjustment was expected to be refused')

  return result.message
}

describe('role ids', () => {
  test('a slug is accepted: a letter, then letters, digits or dashes, up to 24 characters', () => {
    for (const id of ['be', 'a', 'a'.repeat(24), 'api-v2', 'x1', 'docs-writer']) {
      expect(validateRoleId(id)).toBeNull()
    }
  })

  test('an id that is not a slug is refused with the rule, and the id as written', () => {
    expect(validateRoleId('Be')).toBe(
      'role id "Be" must be a lowercase slug: a letter, then letters, digits or dashes, 24 characters at most',
    )

    for (const id of ['Be', '1a', '', 'a'.repeat(25), '../x', 'a b', 'a/b', '-a', 'a_b', 'BE']) {
      expect(validateRoleId(id)).toBe(slugMessage(id))
    }
  })

  test('there is no case folding: Bin is not the reserved id, and is not a slug either', () => {
    expect(validateRoleId('Bin')).toBe(slugMessage('Bin'))
  })

  test('the message shows the id cleaned to 40 code points', () => {
    expect(validateRoleId('A'.repeat(60))).toBe(slugMessage(`${'A'.repeat(39)}…`))
    expect(validateRoleId(`x${BIDI_OVERRIDE}Y`)).toBe(slugMessage('xY'))
    expect(validateRoleId(`be${ZERO_WIDTH_SPACE}`)).toBe(slugMessage('be'))
    expect(validateRoleId('be\n')).toBe(slugMessage('be'))
  })

  test('bin is reserved: it is the launcher folder', () => {
    expect(validateRoleId('bin')).toBe('role id "bin" is reserved: it is the launcher folder .cadre/bin/')
    expect(RESERVED_ROLE_IDS).toEqual(['bin', 'all', 'none'])
    expect(Object.isFrozen(RESERVED_ROLE_IDS)).toBe(true)
  })

  test('all and none are reserved: they are the answer words of the role questions', () => {
    for (const id of ['all', 'none']) {
      expect(validateRoleId(id)).toBe(`role id "${id}" is reserved: all and none are answer words in init questions`)
    }
    expect(validateRoleId('allies')).toBeNull()
  })

  test('add and rename refuse the answer words all and none as ids', () => {
    expect(refused(TEAM, { kind: 'add', id: 'all', title: 'All' })).toBe(
      'role id "all" is reserved: all and none are answer words in init questions',
    )
    expect(refused(TEAM, { kind: 'rename', id: 'be', newId: 'none', title: null })).toBe(
      'role id "none" is reserved: all and none are answer words in init questions',
    )
  })

  test('the caps are 12 roles, 200 purpose characters, 4000 description characters and 20 errors', () => {
    expect(MAX_ROLES).toBe(12)
    expect(MAX_PURPOSE_CHARS).toBe(200)
    expect(MAX_DESCRIPTION_CHARS).toBe(4000)
    expect(MAX_PROPOSAL_ERRORS).toBe(20)
  })

  test('no roles is a problem', () => {
    expect(validateRoles([])).toEqual(['no roles: describe at least one role'])
  })

  test('twelve valid roles have no problem, and thirteen are one too many', () => {
    expect(validateRoles(manyRoles(12))).toEqual([])
    expect(validateRoles(manyRoles(13))).toEqual(['at most 12 roles (got 13)'])
  })

  test('a repeated id is reported once, however many times it repeats', () => {
    expect(validateRoles([{ id: 'be', title: 'BE' }, { id: 'fe', title: 'FE' }, { id: 'be', title: 'Back' }])).toEqual([
      'duplicate role id "be"',
    ])
    expect(
      validateRoles([
        { id: 'be', title: 'A' },
        { id: 'be', title: 'B' },
        { id: 'be', title: 'C' },
      ]),
    ).toEqual(['duplicate role id "be"'])
  })

  test('a title that cleans to nothing has no title', () => {
    for (const title of ['', '   ', BIDI_OVERRIDE, '\n', ZERO_WIDTH_SPACE]) {
      expect(validateRoles([{ id: 'x', title }])).toEqual(['role "x" has no title'])
    }
  })

  test('problems follow the roles in order, and a bad id is not also called a duplicate', () => {
    expect(
      validateRoles([
        { id: 'Bad', title: 'T' },
        { id: 'Bad', title: 'T' },
        { id: 'x', title: '' },
        { id: 'bin', title: 'Bin' },
      ]),
    ).toEqual([
      slugMessage('Bad'),
      slugMessage('Bad'),
      'role "x" has no title',
      'role id "bin" is reserved: it is the launcher folder .cadre/bin/',
    ])
  })
})

describe('isAutopilotDuration', () => {
  test('autopilot durations are accepted: minutes as digits, or hours and minutes', () => {
    const accepted = ['4h', '2h', '8h', '90m', '1h30m', '45', '1H', '30M', '1h0m', '0h1m', '00045', '168h', '10080']

    for (const text of accepted) {
      expect([text, isAutopilotDuration(text)]).toEqual([text, true])
    }
  })

  test('zero, text outside the grammar and more than 168 hours are refused', () => {
    const refusals = [
      '',
      '0',
      '0h',
      '0m',
      '0h0m',
      'h',
      'm',
      '169h',
      '168h1m',
      '10081',
      '4 h',
      ' 4h',
      '4h ',
      '4h\n',
      '4hh',
      '1.5h',
      '-1h',
      '4h30',
      '1m30h',
      '9'.repeat(400),
      'abc',
    ]

    for (const text of refusals) {
      expect([text, isAutopilotDuration(text)]).toEqual([text, false])
    }
  })
})

describe('isModelName (A4)', () => {
  test('MODEL_ALIASES are the four family aliases, in this order, and frozen', () => {
    expect(MODEL_ALIASES).toEqual(['opus', 'sonnet', 'haiku', 'fable'])
    expect(Object.isFrozen(MODEL_ALIASES)).toBe(true)
  })

  test('each family alias is a model name', () => {
    for (const alias of ['opus', 'sonnet', 'haiku', 'fable']) {
      expect([alias, isModelName(alias)]).toEqual([alias, true])
    }
  })

  test('a typo, an effort, a pinned or full model id and any other word are refused', () => {
    const refusals = [
      'claude-opus-4-5',
      'claude-sonnet-4-5-20250929',
      'sonet',
      'high',
      'none',
      'default',
      'opusplan',
      'opus4',
      'Opus',
      'claude-',
      'claude-Opus-4',
      'claude-opus-5-5[1m]',
      `claude-${'a'.repeat(60)}`,
    ]

    for (const text of refusals) {
      expect([text, isModelName(text)]).toEqual([text, false])
    }
  })
})
