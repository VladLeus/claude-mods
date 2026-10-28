import { describe, expect, test } from 'claude-code/testing'

import type { RoleSpec, TemplateRoleId } from '../../types'
import { DECISION_TYPES } from '../framework/contract'
import { GSD_GATES } from '../framework/gsd/adapter'
import { BUILTIN_GATES } from '../framework/none/adapter'
import { SUPERPOWERS_GATES } from '../framework/superpowers/adapter'
import { applyAdjust } from '../roles'
import {
  AUTOPILOT_THRESHOLD,
  chainLines,
  DECISION_OWNERS,
  decisionChain,
  DEFAULT_DURATION,
  DEFAULT_EFFORT,
  DEFAULT_MODEL,
  DEFAULT_PERMISSION_MODE,
  EMPTY_CARRY,
  HUMAN_FALLBACK,
  roleFromTemplate,
  ROLE_TEMPLATE,
  standIn,
  standsFor,
} from './template'
import type { TemplateRole } from './template'

/** The template row with this id; a test that names a missing row fails here, loudly. */
function row(id: TemplateRoleId): TemplateRole {
  const found = ROLE_TEMPLATE.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no template row ${id}`)

  return found
}

/** The template ids in template order, which every proposal and its change list must keep. */
const TEMPLATE_ORDER: readonly TemplateRoleId[] = ['pm', 'tl', 'be', 'fe', 'qa', 'security']

/** The team init starts from: every template role. */
const TEAM: readonly RoleSpec[] = ROLE_TEMPLATE.map(roleFromTemplate)

describe('ROLE_TEMPLATE', () => {
  test('lists pm, tl, be, fe, qa and security in that order, with their titles', () => {
    expect(ROLE_TEMPLATE.map(template => template.id)).toEqual(TEMPLATE_ORDER)
    expect(ROLE_TEMPLATE.map(template => template.title)).toEqual(['PM', 'Team Lead', 'BE', 'FE', 'QA', 'Security'])
  })

  test('the table and every row are frozen', () => {
    expect(Object.isFrozen(ROLE_TEMPLATE)).toBe(true)
    expect(ROLE_TEMPLATE.every(template => Object.isFrozen(template))).toBe(true)
  })

  test('each purpose is its fixed sentence', () => {
    expect(ROLE_TEMPLATE.map(template => template.purpose)).toEqual([
      'Owns product decisions: scope, requirements and acceptance.',
      'Owns architecture and QA decisions; reviews and merges the work.',
      'Implements the backend and core code.',
      'Implements the frontend.',
      'Owns tests and end-to-end checks.',
      'Owns security decisions and reviews.',
    ])
  })

  test('only PM lacks Bash, and PM, TL and Security ask the person (--ask-user)', () => {
    expect(ROLE_TEMPLATE.filter(template => !template.hasBash).map(template => template.id)).toEqual(['pm'])
    expect(ROLE_TEMPLATE.filter(template => template.askUser).map(template => template.id)).toEqual([
      'pm',
      'tl',
      'security',
    ])
  })

  test('the defaults are opus, medium effort, auto mode, 4h and a threshold of 65', () => {
    expect(DEFAULT_MODEL).toBe('opus')
    expect(DEFAULT_EFFORT).toBe('medium')
    expect(DEFAULT_PERMISSION_MODE).toBe('auto')
    expect(DEFAULT_DURATION).toBe('4h')
    expect(AUTOPILOT_THRESHOLD).toBe(65)
  })

  test('the human fallback is queue_question, and the empty carry is frozen with frozen lists', () => {
    expect(HUMAN_FALLBACK).toBe('human (queue_question)')
    expect(EMPTY_CARRY).toEqual({ autoCompactWindow: false, statusLine: false, env: [], hooks: [] })
    expect(Object.isFrozen(EMPTY_CARRY)).toBe(true)
    expect(Object.isFrozen(EMPTY_CARRY.env)).toBe(true)
    expect(Object.isFrozen(EMPTY_CARRY.hooks)).toBe(true)
  })

  test('roleFromTemplate of the PM row has no Bash, asks the person, and carries nothing', () => {
    expect(roleFromTemplate(row('pm'))).toEqual({
      id: 'pm',
      title: 'PM',
      purpose: 'Owns product decisions: scope, requirements and acceptance.',
      basedOn: 'pm',
      model: 'opus',
      effort: 'medium',
      permissionMode: 'auto',
      autopilot: { duration: '4h', threshold: 65, askUser: true },
      hasBash: false,
      mcp: [],
      skills: [],
      instructions: [],
      carry: { autoCompactWindow: false, statusLine: false, env: [], hooks: [] },
    })
  })

  test('roleFromTemplate gives be, fe and qa Bash and no --ask-user, and tl and security both', () => {
    const traits = (id: TemplateRoleId) => {
      const role = roleFromTemplate(row(id))

      return { hasBash: role.hasBash, askUser: role.autopilot.askUser }
    }

    expect(traits('be')).toEqual({ hasBash: true, askUser: false })
    expect(traits('fe')).toEqual({ hasBash: true, askUser: false })
    expect(traits('qa')).toEqual({ hasBash: true, askUser: false })
    expect(traits('tl')).toEqual({ hasBash: true, askUser: true })
    expect(traits('security')).toEqual({ hasBash: true, askUser: true })
  })

  test('every template role is based on itself and has the same model, effort, mode, duration and threshold', () => {
    const roles = ROLE_TEMPLATE.map(roleFromTemplate)

    expect(roles).toHaveLength(6)
    expect(roles.map(role => role.id)).toEqual(TEMPLATE_ORDER)
    expect(roles.map(role => role.basedOn)).toEqual(TEMPLATE_ORDER)
    expect(roles.every(role => role.model === 'opus' && role.effort === 'medium')).toBe(true)
    expect(roles.every(role => role.permissionMode === 'auto')).toBe(true)
    expect(roles.every(role => role.autopilot.duration === '4h' && role.autopilot.threshold === 65)).toBe(true)
    expect(roles.every(role => role.framework === undefined)).toBe(true)
  })

  test('roleFromTemplate gives a new role each call', () => {
    expect(roleFromTemplate(row('be'))).not.toBe(roleFromTemplate(row('be')))
  })
})

describe('decision owners', () => {
  test('DECISION_OWNERS maps Product to pm, Arch and QA to tl, and Security to security, and is frozen', () => {
    expect(DECISION_OWNERS).toEqual({ Product: 'pm', Arch: 'tl', QA: 'tl', Security: 'security' })
    expect(Object.isFrozen(DECISION_OWNERS)).toBe(true)
  })

  test('every decision type has an owner that is a template role', () => {
    for (const type of DECISION_TYPES) {
      expect(ROLE_TEMPLATE.some(template => template.id === DECISION_OWNERS[type])).toBe(true)
    }
  })

  test('every non-null decisionType in the GSD, superpowers and built-in gate tables has an owner', () => {
    const gates = [...GSD_GATES, ...SUPERPOWERS_GATES, ...BUILTIN_GATES]
    let checked = 0

    for (const gate of gates) {
      if (gate.decisionType === null) continue
      checked += 1

      expect(Object.hasOwn(DECISION_OWNERS, gate.decisionType)).toBe(true)
    }

    expect(checked).toBeGreaterThan(0)
  })

  test('the chain names the owner when it is present', () => {
    expect(decisionChain('Product', ['pm', 'tl'])).toEqual(['pm', 'human (queue_question)'])
    expect(decisionChain('Security', ['security', 'tl'])).toEqual(['security', 'human (queue_question)'])
    expect(decisionChain('Arch', ['tl'])).toEqual(['tl', 'human (queue_question)'])
  })

  test('the chain falls back to tl when the owner is missing', () => {
    expect(decisionChain('Product', ['tl'])).toEqual(['tl', 'human (queue_question)'])
    expect(decisionChain('Security', ['tl', 'be'])).toEqual(['tl', 'human (queue_question)'])
  })

  test('the chain is only the human when neither the owner nor tl is present', () => {
    expect(decisionChain('Security', ['be'])).toEqual(['human (queue_question)'])
    expect(decisionChain('Product', [])).toEqual(['human (queue_question)'])
    expect(decisionChain('QA', ['qa'])).toEqual(['human (queue_question)'])
  })

  test('every chain ends with the human fallback, whatever the roles', () => {
    const subsets: string[][] = [[], ['pm'], ['tl'], ['be', 'fe'], ['pm', 'tl'], ['security'], [...TEMPLATE_ORDER]]

    for (const roles of subsets) {
      for (const decision of DECISION_TYPES) {
        expect(decisionChain(decision, roles).at(-1)).toBe(HUMAN_FALLBACK)
      }
    }
  })

  test('chainLines gives one line per decision type in DECISION_TYPES order', () => {
    expect(chainLines(['tl', 'be'])).toEqual([
      'Product: tl -> human (queue_question)',
      'Arch: tl -> human (queue_question)',
      'Security: tl -> human (queue_question)',
      'QA: tl -> human (queue_question)',
    ])
  })

  test('a role based on the owner, or on tl, takes its decisions when the template id is not on the team', () => {
    expect(decisionChain('Arch', [{ id: 'lead', basedOn: 'tl' }])).toEqual(['lead', HUMAN_FALLBACK])
    expect(decisionChain('Product', [{ id: 'product', basedOn: 'pm' }, { id: 'lead', basedOn: 'tl' }])).toEqual([
      'product',
      HUMAN_FALLBACK,
    ])
    expect(decisionChain('Security', [{ id: 'api', basedOn: 'be' }, { id: 'lead', basedOn: 'tl' }])).toEqual([
      'lead',
      HUMAN_FALLBACK,
    ])
    expect(decisionChain('QA', [{ id: 'api', basedOn: 'be' }, { id: 'docs', basedOn: null }])).toEqual([HUMAN_FALLBACK])
  })

  test('standsFor: a role stands for a template role by its id or by its basedOn', () => {
    expect(standsFor({ id: 'api', basedOn: 'be' }, 'be')).toBe(true)
    expect(standsFor({ id: 'be', basedOn: null }, 'be')).toBe(true)
    expect(standsFor({ id: 'x', basedOn: null }, 'be')).toBe(false)
    expect(standsFor({ id: 'api', basedOn: 'fe' }, 'be')).toBe(false)
  })

  test('a role whose id is the owner wins over another role based on it', () => {
    const roles: readonly Pick<RoleSpec, 'id' | 'basedOn'>[] = [
      { id: 'lead', basedOn: 'tl' },
      { id: 'tl', basedOn: null },
    ]
    expect(decisionChain('Arch', roles)).toEqual(['tl', HUMAN_FALLBACK])
  })

  test('after rename tl lead the chain names lead for Arch and QA, and for the fallback', () => {
    const withoutPm = TEAM.filter(role => role.id !== 'pm')
    const renamed = applyAdjust(withoutPm, { kind: 'rename', id: 'tl', newId: 'lead', title: null })
    if (renamed.kind !== 'ok') throw new Error(renamed.message)
    expect(chainLines(renamed.roles)).toEqual([
      'Product: lead -> human (queue_question)',
      'Arch: lead -> human (queue_question)',
      'Security: security -> human (queue_question)',
      'QA: lead -> human (queue_question)',
    ])
  })

  test('chainLines names each owner of a full team, and only the human for a team without owners', () => {
    expect(chainLines([...TEMPLATE_ORDER])).toEqual([
      'Product: pm -> human (queue_question)',
      'Arch: tl -> human (queue_question)',
      'Security: security -> human (queue_question)',
      'QA: tl -> human (queue_question)',
    ])
    expect(chainLines(['be'])).toEqual([
      'Product: human (queue_question)',
      'Arch: human (queue_question)',
      'Security: human (queue_question)',
      'QA: human (queue_question)',
    ])
  })
})

describe('safety net: standIn (A8)', () => {
  test('standIn: the role with the template id first, else the first role based on it, else null', () => {
    expect(standIn('tl', [{ id: 'lead', basedOn: 'tl' }, 'tl'])).toBe('tl')
    expect(standIn('tl', ['pm', { id: 'lead', basedOn: 'tl' }, { id: 'arch', basedOn: 'tl' }])).toBe('lead')
    expect(standIn('security', ['pm', { id: 'lead', basedOn: 'tl' }])).toBe(null)
  })
})
