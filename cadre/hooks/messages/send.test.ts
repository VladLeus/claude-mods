import { describe, expect, test } from 'claude-code/testing'

import type { RoleContext, TeamView } from '../../types'
import { FRAMEWORK_IDS } from '../core/framework-id'
import { isObject } from '../core/json'
import { INBOX_ENTRY_FIELDS } from '../locales/contracts'
import { PROMPTS } from '../locales/prompts'
import { fill } from '../locales/t'
import {
  BODY_MAX_CHARS,
  CHANGES_MAX_CHARS,
  inboxSendDescriptionText,
  inboxSendSchema,
  LIST_ITEM_MAX_CHARS,
  LIST_MAX_ITEMS,
  MESSAGE_KINDS,
  NOTE_MAX_CHARS,
  parseMarkInput,
  parseSendInput,
  REASON_MAX_CHARS,
  REPORT_FORM_MAX_CHARS,
  REPORT_OUTCOMES,
  SIZE_PINS,
  SPEC_PATH_MAX_CHARS,
  SUBJECT_MAX_CHARS,
  TICKET_KEY_MAX_CHARS,
  TICKETS_MAX_ITEMS,
  VERIFICATION_MAX_CHARS,
} from './send'
import { GSD_PATHS, PLANNING_MODES } from './sizing'

const BE: RoleContext = { id: 'be', root: '/repo' }
const TEAM: TeamView = {
  ids: ['pm', 'tl', 'be'],
  parents: { pm: null, tl: 'pm', be: 'tl' },
  pm: 'pm',
  sizing: { threshold: 0.5, mapping: { small: 'superpowers', large: 'gsd' }, rubric: '.cadre/sizing.md' },
  frameworks: ['gsd', 'superpowers'],
  mayRun: { pm: ['none'], tl: ['gsd', 'superpowers'], be: ['gsd', 'superpowers'] },
}
const NOTE = { to: 'tl', kind: 'note', subject: 'Hi', body: 'Hello' }
const PM: RoleContext = { id: 'pm', root: '/repo' }
const VECTOR = { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 }
const TICKET = {
  to: 'tl',
  kind: 'ticket',
  subject: 'Add login',
  body: 'The acceptance criteria',
  ticketKey: 'PROJ-2',
  scores: { scope: 0.3, risk: 0.9 },
  pin: 'large',
  reportForm: 'Outcome first, then the changes',
}
const TASK_INPUT = {
  to: 'tl',
  kind: 'task',
  subject: 'Add the endpoint',
  body: 'Add it',
  ticketKey: 'PROJ-2',
  vector: VECTOR,
  use: { framework: 'gsd', gsdPath: 'phase' },
}
const REPORT = {
  to: 'tl',
  kind: 'report',
  subject: 'PROJ-2 done',
  body: 'Done',
  outcome: 'done',
  changes: 'Added the endpoint',
  verification: 'The specs pass',
  vector: VECTOR,
  reason: 'A new endpoint over an existing model',
  frameworkUsed: 'gsd',
  docPaths: ['.planning/workstreams/cadre-be', 'docs/superpowers/plans/be-PROJ-2.md'],
  openQuestions: [],
}
const BRIEF = {
  to: 'tl',
  kind: 'note',
  subject: 'Epic PROJ-1',
  body: 'The plan of the epic',
  mode: 'gsd-epic',
  tickets: ['PROJ-2', 'PROJ-3'],
}

/** A character of four UTF-8 bytes and two UTF-16 units: one code point. */
const WIDE = '\u{1F600}'

/** The refusal of a send, null when it is accepted. */
function refusalOf(event: unknown): string | null {
  const input = parseSendInput(event, BE, TEAM)

  return input.kind === 'error' ? input.message : null
}

/** The refusal of a send by the role of `ctx`, null when it is accepted. */
function refusalAs(ctx: RoleContext, event: unknown): string | null {
  const input = parseSendInput(event, ctx, TEAM)

  return input.kind === 'error' ? input.message : null
}

describe('parseSendInput', () => {
  test('each refusal names its field: to, kind, subject, body, replyTo', () => {
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...NOTE, to: undefined }, PROMPTS.inboxToMissing],
      [{ ...NOTE, to: 7 }, PROMPTS.inboxToNotText],
      [{ ...NOTE, to: 'qa' }, fill(PROMPTS.inboxToNotTeam, { ids: 'pm, tl, be' })],
      [{ ...NOTE, to: 'be' }, PROMPTS.inboxToSelf],
      [{ ...NOTE, kind: 'ping' }, fill(PROMPTS.inboxKindUnknown, { kinds: MESSAGE_KINDS.join(', ') })],
      [{ ...NOTE, subject: '' }, PROMPTS.inboxSubjectEmpty],
      [{ ...NOTE, subject: '\u200B\u0007\n' }, PROMPTS.inboxSubjectEmpty],
      [{ ...NOTE, body: '' }, PROMPTS.inboxBodyEmpty],
      [
        { ...NOTE, body: WIDE.repeat(BODY_MAX_CHARS + 1) },
        'body is 3001 characters, over its cap of 3000: shorten it or split it into several entries.',
      ],
      [{ ...NOTE, replyTo: 'not-an-entry' }, PROMPTS.inboxReplyToBad],
      [{ ...NOTE, replyTo: '' }, PROMPTS.inboxReplyToBad],
    ]

    expect(cases.map(([event]) => refusalOf(event))).toEqual(cases.map(([, message]) => message))
  })

  test('the subject loses invisible characters and turns line breaks into one space', () => {
    expect(parseSendInput({ ...NOTE, subject: 'A\u200Bb\nc' }, BE, TEAM)).toMatchObject({ kind: 'ok', subject: 'Ab c' })
    expect(parseSendInput({ ...NOTE, subject: 'a\r\nb' }, BE, TEAM)).toMatchObject({ subject: 'a b' })
  })

  test('a long subject is cut to its cap; a body at its cap in code points is kept whole', () => {
    const input = parseSendInput({ ...NOTE, subject: 'x'.repeat(200), body: WIDE.repeat(BODY_MAX_CHARS) }, BE, TEAM)
    const subject = input.kind === 'ok' ? input.subject : ''
    const body = input.kind === 'ok' ? input.body : ''

    expect(Array.from(subject)).toHaveLength(SUBJECT_MAX_CHARS)
    expect(body).toBe(WIDE.repeat(BODY_MAX_CHARS))
  })

  test('the body keeps line breaks and tabs, turns CR LF and CR into LF and drops other control characters', () => {
    const input = parseSendInput({ ...NOTE, body: 'a\r\nb\rc\td\u200Be\u0007f' }, BE, TEAM)

    expect(input).toMatchObject({ kind: 'ok', body: 'a\nb\nc\tdef' })
  })

  test('only the named keys are read: a sender, a tool name and any other key change nothing', () => {
    const extra = { ...NOTE, from: 'pm', tool: 'mcp__cadre__inbox_send', tool_use_id: 't1', agentId: 'a1', x: 1 }

    expect(parseSendInput(extra, BE, TEAM)).toEqual(parseSendInput(NOTE, BE, TEAM))
    expect(parseSendInput(NOTE, BE, TEAM)).toEqual({
      kind: 'ok',
      to: 'tl',
      kindName: 'note',
      subject: 'Hi',
      body: 'Hello',
      replyTo: null,
      fields: {},
    })
  })

  test('ticket and epic-end are sent only by the PM stand-in; every other kind by any role', () => {
    const TL: RoleContext = { id: 'tl', root: '/repo' }
    const PM: RoleContext = { id: 'pm', root: '/repo' }
    const fieldsOf: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
      ticket: { ticketKey: TICKET.ticketKey, scores: TICKET.scores },
      report: { ...REPORT, to: 'be', kind: 'report' },
    }
    const refusalFrom = (ctx: RoleContext, kind: string, team: TeamView = TEAM): string | null => {
      const input = parseSendInput({ ...NOTE, ...fieldsOf[kind], to: 'be', kind }, ctx, team)

      return input.kind === 'error' ? input.message : null
    }

    expect(['ticket', 'epic-end'].map(kind => refusalFrom(TL, kind))).toEqual([
      fill(PROMPTS.inboxKindPmOnly, { kind: 'ticket', pm: 'pm' }),
      fill(PROMPTS.inboxKindPmOnly, { kind: 'epic-end', pm: 'pm' }),
    ])
    expect(['ticket', 'epic-end'].map(kind => refusalFrom(PM, kind))).toEqual([null, null])
    const anyRole = ['report', 'note', 'question', 'answer']
    expect(anyRole.map(kind => refusalFrom(TL, kind))).toEqual([null, null, null, null])
    expect(refusalFrom(TL, 'ticket', { ...TEAM, pm: null })).toBe(fill(PROMPTS.inboxKindNoPm, { kind: 'ticket' }))
  })

  test('a replyTo that is an entry id is kept', () => {
    expect(parseSendInput({ ...NOTE, replyTo: 'tl-1000-0123abcd' }, BE, TEAM)).toMatchObject({
      replyTo: 'tl-1000-0123abcd',
    })
  })
})

describe('parseSendInput of a task', () => {
  const TASK = {
    to: 'tl',
    kind: 'task',
    subject: 'Add the endpoint',
    body: 'Add it',
    ticketKey: 'PROJ-2',
    vector: { scope: 0.4, complexity: 0.6, risk: 0.3, effort: 0.5 },
    use: { framework: 'gsd', gsdPath: 'phase' },
  }

  test('a task with a gsdPath while use.framework is superpowers is refused', () => {
    expect(refusalOf({ ...TASK, use: { framework: 'superpowers', gsdPath: 'quick' } })).toBe(PROMPTS.inboxUseBad)
    expect(refusalOf({ ...TASK, use: { framework: 'superpowers' } })).toBeNull()
  })

  test('a ticketKey of ../x is refused', () => {
    const refusal = fill(PROMPTS.inboxTicketKeyBad, { max: TICKET_KEY_MAX_CHARS })

    expect(refusalOf({ ...TASK, ticketKey: '../x' })).toBe(refusal)
    expect(refusalOf({ ...TASK, ticketKey: 'a b' })).toBe(refusal)
  })

  test('a specPath over its cap of 200 characters is refused; one at its cap is kept', () => {
    const atCap = `docs/${'a'.repeat(192)}.md`

    expect(refusalOf({ ...TASK, specPath: `docs/${'a'.repeat(193)}.md` })).toBe(
      'specPath is 201 characters, over its cap of 200: shorten it.',
    )
    expect(parseSendInput({ ...TASK, specPath: atCap }, BE, TEAM)).toMatchObject({ fields: { specPath: atCap } })
  })
})

describe('parseSendInput of a ticket', () => {
  test('a ticket with its key, scores, pin and report form is accepted and carries them', () => {
    expect(parseSendInput(TICKET, PM, TEAM)).toMatchObject({
      kind: 'ok',
      kindName: 'ticket',
      fields: {
        ticketKey: 'PROJ-2',
        scores: { scope: 0.3, risk: 0.9 },
        pin: 'large',
        reportForm: 'Outcome first, then the changes',
      },
    })
  })

  test('no ticketKey or scores, a key ../x or a b, a complexity in scores or pin medium is refused', () => {
    const keyBad = fill(PROMPTS.inboxTicketKeyBad, { max: TICKET_KEY_MAX_CHARS })
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...TICKET, ticketKey: undefined }, fill(PROMPTS.inboxFieldMissing, { kind: 'ticket', fields: 'ticketKey' })],
      [{ ...TICKET, ticketKey: '../x' }, keyBad],
      [{ ...TICKET, ticketKey: 'a b' }, keyBad],
      [{ ...TICKET, scores: undefined }, fill(PROMPTS.inboxFieldMissing, { kind: 'ticket', fields: 'scores' })],
      [{ ...TICKET, scores: { scope: 0.3, risk: 0.9, complexity: 0.5 } }, PROMPTS.inboxScoresBad],
      [{ ...TICKET, pin: 'medium' }, fill(PROMPTS.inboxPinBad, { pins: 'small, large' })],
    ]

    expect(cases.map(([event]) => refusalAs(PM, event))).toEqual(cases.map(([, message]) => message))
  })
})

describe('parseSendInput of a report', () => {
  test('a report with every field and no open question is accepted and carries them', () => {
    expect(parseSendInput(REPORT, BE, TEAM)).toMatchObject({
      kind: 'ok',
      fields: {
        outcome: 'done',
        changes: 'Added the endpoint',
        verification: 'The specs pass',
        vector: VECTOR,
        reason: 'A new endpoint over an existing model',
        frameworkUsed: 'gsd',
        docPaths: ['.planning/workstreams/cadre-be', 'docs/superpowers/plans/be-PROJ-2.md'],
        openQuestions: [],
      },
    })
  })

  test('outcome ok, a docPaths entry ../x, 11 open questions or a missing reason is refused', () => {
    const questions = Array.from({ length: LIST_MAX_ITEMS + 1 }, (_, index) => `Question ${index}?`)
    const cases: readonly (readonly [unknown, string])[] = [
      [{ ...REPORT, outcome: 'ok' }, fill(PROMPTS.inboxOutcomeBad, { outcomes: 'done, blocked, partial' })],
      [
        { ...REPORT, docPaths: ['../x'] },
        fill(PROMPTS.inboxDocPathsBad, { max: LIST_MAX_ITEMS, chars: LIST_ITEM_MAX_CHARS }),
      ],
      [{ ...REPORT, openQuestions: questions }, 'openQuestions has 11 items, over its cap of 10.'],
      [{ ...REPORT, reason: undefined }, fill(PROMPTS.inboxFieldMissing, { kind: 'report', fields: 'reason' })],
    ]

    expect(cases.map(([event]) => refusalOf(event))).toEqual(cases.map(([, message]) => message))
  })

  test('a report text is kept whole on one line at its cap; over its cap or blank it is refused, never cut', () => {
    const atCap = parseSendInput({ ...REPORT, changes: `${'c'.repeat(CHANGES_MAX_CHARS - 2)}\nd` }, BE, TEAM)

    expect(atCap).toMatchObject({ fields: { changes: `${'c'.repeat(CHANGES_MAX_CHARS - 2)} d` } })
    expect(refusalOf({ ...REPORT, changes: 'c'.repeat(CHANGES_MAX_CHARS + 1) })).toBe(
      'changes is 1001 characters, over its cap of 1000: shorten it.',
    )
    expect(refusalOf({ ...REPORT, reason: ' \u200B\n' })).toBe(fill(PROMPTS.inboxFieldEmpty, { field: 'reason' }))
  })
})

describe('parseSendInput of an epic brief', () => {
  test('a gsd-epic brief of 11 tickets keeps all 11 in order; a ticket without ticketKey is refused', () => {
    const tickets = Array.from({ length: 11 }, (_, index) => `PROJ-${index + 1}`)

    expect(parseSendInput({ ...BRIEF, tickets }, BE, TEAM)).toMatchObject({
      kind: 'ok',
      fields: { mode: 'gsd-epic', tickets },
    })
    expect(refusalAs(PM, { ...TICKET, ticketKey: undefined })).toBe(
      fill(PROMPTS.inboxFieldMissing, { kind: 'ticket', fields: 'ticketKey' }),
    )
  })

  test('a tickets item ../x and 101 tickets are refused; tickets need mode gsd-epic', () => {
    const many = Array.from({ length: TICKETS_MAX_ITEMS + 1 }, (_, index) => `PROJ-${index + 1}`)
    const ticketsBad = fill(PROMPTS.inboxTicketsBad, { max: TICKETS_MAX_ITEMS })

    expect(refusalOf({ ...BRIEF, tickets: ['PROJ-2', '../x'] })).toBe(ticketsBad)
    expect(refusalOf({ ...BRIEF, tickets: many })).toBe('tickets has 101 items, over its cap of 100.')
    expect(refusalOf({ ...BRIEF, mode: 'ticket' })).toBe(PROMPTS.inboxTicketsNotEpic)
    expect(refusalOf({ ...BRIEF, mode: undefined })).toBe(PROMPTS.inboxTicketsNotEpic)
    expect(refusalOf({ ...BRIEF, mode: 'sprint' })).toBe(fill(PROMPTS.inboxModeBad, { modes: 'gsd-epic, ticket' }))
  })

  test('a ticket-mode brief takes no tickets, a gsd-epic brief needs them, and a note with no mode is plain', () => {
    expect(parseSendInput({ ...BRIEF, mode: 'ticket', tickets: undefined }, BE, TEAM)).toMatchObject({
      kind: 'ok',
      fields: { mode: 'ticket' },
    })
    expect(refusalOf({ ...BRIEF, tickets: undefined })).toBe(PROMPTS.inboxEpicNeedsTickets)
    expect(refusalOf({ ...BRIEF, tickets: [] })).toBe(PROMPTS.inboxEpicNeedsTickets)
    expect(parseSendInput(NOTE, BE, TEAM)).toMatchObject({ kind: 'ok', fields: {} })
  })
})

describe('parseSendInput: the fields each kind takes', () => {
  test('a field on a kind that does not take it is refused, naming both; ticketKey goes on a ticket and a task', () => {
    const notFor = (field: string, kind: string): string => fill(PROMPTS.inboxFieldNotForKind, { field, kind })
    const cases: readonly (readonly [RoleContext, unknown, string])[] = [
      [BE, { ...TASK_INPUT, scores: { scope: 0.3, risk: 0.9 } }, notFor('scores', 'task')],
      [BE, { ...NOTE, vector: VECTOR }, notFor('vector', 'note')],
      [PM, { ...TICKET, mode: 'ticket' }, notFor('mode', 'ticket')],
      [BE, { ...NOTE, ticketKey: 'PROJ-2' }, notFor('ticketKey', 'note')],
      [PM, { ...TICKET, tickets: ['PROJ-2'] }, notFor('tickets', 'ticket')],
      [BE, { ...REPORT, ticketKey: 'PROJ-2' }, notFor('ticketKey', 'report')],
      [BE, { ...NOTE, kind: 'question', outcome: 'done' }, notFor('outcome', 'question')],
    ]

    expect(cases.map(([ctx, event]) => refusalAs(ctx, event))).toEqual(cases.map(([, , message]) => message))
    expect([refusalAs(PM, TICKET), refusalAs(BE, TASK_INPUT)]).toEqual([null, null])
  })

  test('the stamps cadre adds are never read from the input', () => {
    const stamps = { size: 0.1, large: false, planPath: 'x.md', method: 'ask' }
    const input = parseSendInput({ ...TASK_INPUT, ...stamps }, BE, TEAM)

    expect(input).toEqual(parseSendInput(TASK_INPUT, BE, TEAM))
  })

  test('a send missing several kind fields is refused once, naming each in order; one missing names it alone', () => {
    const bareReport = { to: 'tl', kind: 'report', subject: 'PROJ-2 done', body: 'Done' }
    const keyOnlyTask = { to: 'tl', kind: 'task', subject: 'Add the endpoint', body: 'Add it', ticketKey: 'PROJ-2' }
    const reportFields = 'outcome, changes, verification, vector, reason, frameworkUsed, docPaths, openQuestions'

    expect(refusalOf(bareReport)).toBe(`A report needs ${reportFields}.`)
    expect(refusalOf(keyOnlyTask)).toBe('A task needs vector, use.')
    expect(refusalOf({ ...REPORT, verification: undefined })).toBe('A report needs verification.')
  })

  test('the inbox_send description names every kind field of a ticket, a task, a report and a note', () => {
    const fields: Readonly<Record<string, readonly string[]>> = {
      ticket: ['ticketKey', 'scores', 'pin', 'reportForm'],
      task: ['ticketKey', 'vector', 'use', 'specPath'],
      report: ['outcome', 'changes', 'verification', 'vector', 'reason', 'frameworkUsed', 'docPaths', 'openQuestions'],
      note: ['mode', 'tickets'],
    }
    const unnamed = Object.entries(fields).flatMap(([kind, names]) =>
      names.filter(name => !PROMPTS.inboxSendDescription.includes(name)).map(name => `${kind} ${name}`),
    )

    expect(unnamed).toEqual([])
  })
})

describe('parseSendInput: every problem at once', () => {
  test('a send with several problems is refused once, listing every one with its size against its cap', () => {
    const question = (length: number): string => `${'q'.repeat(length - 1)}?`
    const report = {
      ...REPORT,
      changes: 'c'.repeat(1108),
      verification: 'v'.repeat(1008),
      reason: 'r'.repeat(244),
      docPaths: Array.from({ length: 11 }, (_, index) => `docs/report-${index + 1}.md`),
      openQuestions: [question(40), question(223), question(40), question(261), question(40), question(220)],
    }

    expect(refusalOf(report)).toBe(
      [
        'Not sent, 5 problems:',
        '- changes is 1108 characters, over its cap of 1000: shorten it.',
        '- verification is 1008 characters, over its cap of 500: shorten it.',
        '- reason is 244 characters, over its cap of 200: shorten it.',
        '- docPaths has 11 items, over its cap of 10.',
        '- openQuestions: items 2, 4, 6 are 223, 261, 220 characters, over the cap of 200 each.',
      ].join('\n'),
    )
  })

  test('a report with a ticketKey and three fields over their caps names the foreign field, then each size', () => {
    const report = {
      ...REPORT,
      ticketKey: 'KAN-3',
      changes: 'c'.repeat(1306),
      verification: 'v'.repeat(755),
      openQuestions: ['q'.repeat(277)],
    }

    expect(refusalOf(report)).toBe(
      [
        'Not sent, 4 problems:',
        '- ticketKey is not a field of a report: leave it out.',
        '- changes is 1306 characters, over its cap of 1000: shorten it.',
        '- verification is 755 characters, over its cap of 500: shorten it.',
        '- openQuestions: items 1 are 277 characters, over the cap of 200 each.',
      ].join('\n'),
    )
  })

  test('a note to a role outside the team with an empty subject and a long body names all three', () => {
    expect(refusalOf({ ...NOTE, to: 'qa', subject: '', body: 'b'.repeat(3001) })).toBe(
      [
        'Not sent, 3 problems:',
        '- to must name a role of the team: pm, tl, be.',
        '- subject is empty or not text: give a short subject line.',
        '- body is 3001 characters, over its cap of 3000: shorten it or split it into several entries.',
      ].join('\n'),
    )
  })

  test('an unknown kind or a ticket not from the PM lists its envelope problems and checks no kind field', () => {
    const listed = (...problems: readonly string[]): string =>
      [
        fill(PROMPTS.inboxProblemsHead, { count: problems.length }),
        ...problems.map(problem => fill(PROMPTS.inboxProblemLine, { problem })),
      ].join('\n')
    const kinds = MESSAGE_KINDS.join(', ')

    expect(refusalOf({ ...NOTE, kind: 'ping', subject: '', vector: 'x', outcome: 'maybe' })).toBe(
      listed(fill(PROMPTS.inboxKindUnknown, { kinds }), PROMPTS.inboxSubjectEmpty),
    )
    expect(refusalOf({ ...TICKET, subject: '', scores: undefined, pin: 'medium' })).toBe(
      listed(fill(PROMPTS.inboxKindPmOnly, { kind: 'ticket', pm: 'pm' }), PROMPTS.inboxSubjectEmpty),
    )
  })
})

describe('inboxSendSchema', () => {
  const schema = inboxSendSchema()
  const at = (value: unknown, ...keys: readonly string[]): unknown =>
    keys.reduce<unknown>((held, key) => (isObject(held) ? held[key] : undefined), value)
  const property = (...keys: readonly string[]): unknown => at(schema, 'properties', ...keys)

  test('every cap in the schema equals its constant; it composes no variants and requires the envelope', () => {
    const texts: readonly (readonly [string, number])[] = [
      ['subject', SUBJECT_MAX_CHARS],
      ['body', BODY_MAX_CHARS],
      ['ticketKey', TICKET_KEY_MAX_CHARS],
      ['reportForm', REPORT_FORM_MAX_CHARS],
      ['specPath', SPEC_PATH_MAX_CHARS],
      ['changes', CHANGES_MAX_CHARS],
      ['verification', VERIFICATION_MAX_CHARS],
      ['reason', REASON_MAX_CHARS],
    ]
    const lists: readonly (readonly [string, number, number])[] = [
      ['docPaths', LIST_MAX_ITEMS, LIST_ITEM_MAX_CHARS],
      ['openQuestions', LIST_MAX_ITEMS, LIST_ITEM_MAX_CHARS],
      ['tickets', TICKETS_MAX_ITEMS, TICKET_KEY_MAX_CHARS],
    ]

    expect(texts.map(([field]) => property(field, 'maxLength'))).toEqual(texts.map(([, max]) => max))
    expect(lists.map(([field]) => [property(field, 'maxItems'), property(field, 'items', 'maxLength')])).toEqual(
      lists.map(([, items, chars]) => [items, chars]),
    )
    expect(['oneOf', 'anyOf', 'allOf'].filter(word => JSON.stringify(schema).includes(word))).toEqual([])
    expect(at(schema, 'required')).toEqual(['to', 'kind', 'subject', 'body'])
  })

  test('the enums of kind, pin, use, outcome, frameworkUsed and mode name the same values as before', () => {
    expect([
      property('kind', 'enum'),
      property('pin', 'enum'),
      property('use', 'properties', 'framework', 'enum'),
      property('use', 'properties', 'gsdPath', 'enum'),
      property('outcome', 'enum'),
      property('frameworkUsed', 'enum'),
      property('mode', 'enum'),
    ]).toEqual([
      [...MESSAGE_KINDS],
      [...SIZE_PINS],
      [...FRAMEWORK_IDS],
      [...GSD_PATHS],
      [...REPORT_OUTCOMES],
      [...FRAMEWORK_IDS],
      [...PLANNING_MODES],
    ])
  })

  test('each kind field says the kinds it goes on, the kinds that require it and its cap', () => {
    const startsOnly = (field: string): boolean => {
      const description = property(field, 'description')

      return typeof description === 'string' && description.startsWith('Only on ')
    }

    expect(property('ticketKey', 'description')).toBe(
      'Only on ticket, task. Required on ticket, task. At most 64 characters.',
    )
    expect(property('docPaths', 'description')).toBe(
      'Only on report. Required on report. At most 10 items of at most 200 characters each.',
    )
    expect(property('pin', 'description')).toBe('Only on ticket.')
    expect(property('specPath', 'description')).toBe('Only on task. At most 200 characters.')
    expect(INBOX_ENTRY_FIELDS.filter(field => !startsOnly(field))).toEqual([])
  })

  test('the inbox_send description states every cap, filled from the constants', () => {
    const text = inboxSendDescriptionText()

    expect(text.includes('{')).toBe(false)
    expect(['body 3000', 'specPath 200', 'tickets at most 100'].filter(part => !text.includes(part))).toEqual([])
  })
})

describe('parseMarkInput', () => {
  const ID = 'be-1000-0123abcd'

  test('each refusal names its field: state, note, waitsFor', () => {
    const states = fill(PROMPTS.inboxMarkState, { states: 'read, awaiting, blocked, rejected, done' })
    const longNote = 'x'.repeat(NOTE_MAX_CHARS + 1)
    const cases: readonly (readonly [unknown, string])[] = [
      [{ id: ID, state: 'unread' }, states],
      [{ id: ID, state: 'ping' }, states],
      [{ id: ID, state: 'done' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'done' })],
      [{ id: ID, state: 'rejected', note: '' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'rejected' })],
      [{ id: ID, state: 'blocked', note: '\u200B\n' }, fill(PROMPTS.inboxMarkNoteNeeded, { state: 'blocked' })],
      [{ id: ID, state: 'done', note: longNote }, fill(PROMPTS.inboxMarkNoteTooLong, { max: NOTE_MAX_CHARS })],
      [{ id: ID, state: 'awaiting' }, PROMPTS.inboxMarkWaitsFor],
      [{ id: ID, state: 'awaiting', waitsFor: 'not-an-entry' }, PROMPTS.inboxMarkWaitsFor],
    ]
    const refusals = cases.map(([event]) => {
      const input = parseMarkInput(event)

      return input.kind === 'error' ? input.message : null
    })

    expect(refusals).toEqual(cases.map(([, message]) => message))
  })

  test('read takes no note; done keeps its note on one line; awaiting keeps its waitsFor; by is never read', () => {
    expect(parseMarkInput({ id: ID, state: 'read', by: 'pm' })).toEqual({
      kind: 'ok',
      id: ID,
      state: 'read',
      note: null,
      waitsFor: null,
    })
    expect(parseMarkInput({ id: ID, state: 'done', note: 'merged\nand shipped' })).toMatchObject({
      note: 'merged and shipped',
    })
    expect(parseMarkInput({ id: ID, state: 'awaiting', waitsFor: 'pm-2000-89abcdef' })).toMatchObject({
      waitsFor: 'pm-2000-89abcdef',
    })
  })
})
