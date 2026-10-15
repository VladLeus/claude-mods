import { describe, expect, test } from 'claude-code/testing'

import type {
  Detection,
  DetectStatus,
  Facts,
  FrameworkAdapter,
  FrameworkId,
  Gate,
  RepoEntry,
  SettingProposal,
} from '../types'
import {
  chooseFramework,
  DECISION_TYPES,
  detectUnsupported,
  gateProblems,
  isDecisionType,
  MAX_GATE_PROBLEMS,
  missingFields,
  REQUIRED_FIELDS,
  SUPPORTED_IDS,
  UNSUPPORTED_MARKERS,
} from './framework'

/** Facts with every list empty. A test sets only the list it reads. */
function facts(over: Partial<Facts>): Facts {
  return {
    repoEntries: [],
    docsEntries: [],
    enabledPlugins: [],
    hookScripts: [],
    superpowersVersions: [],
    gsd: [],
    warnings: [],
    ...over,
  }
}

/** A repo-root entry as the host lists it. */
function entry(name: string, kind: RepoEntry['kind'], isLink: boolean): RepoEntry {
  return { name, kind, isLink }
}

/** A detection with a fixed default. A test overrides the id and status it is about. */
function detection(over: Partial<Detection>): Detection {
  return { id: 'gsd', name: 'GSD', status: 'not-found', version: null, evidence: [], ...over }
}

/** A supported framework detected with the given status. */
function detected(id: FrameworkId, status: DetectStatus): Detection {
  return detection({ id, name: id, status })
}

/** A valid gate: a chat gate owned by Arch with a kickoff. A test overrides the field it is about. */
function gate(over: Partial<Gate>): Gate {
  return {
    id: 'g',
    where: 'w',
    kind: 'chat',
    decisionType: 'Arch',
    needsHuman: false,
    handling: 'preapprove',
    kickoff: 'k',
    ...over,
  }
}

/** A complete valid adapter. A test overrides or removes the field it is about. */
function adapter(over: Partial<FrameworkAdapter>): FrameworkAdapter {
  return {
    id: 'gsd',
    name: 'X',
    detectRule: 'r',
    detect: () => detection({ id: 'gsd', status: 'not-found' }),
    startWork: ['s'],
    locations: { spec: ['a'], plan: ['b'] },
    verify: ['v'],
    doneSignal: { artifact: 'f', check: 'c' },
    humanGates: [gate({ id: 'g1' })],
    autonomy: [],
    autonomyNote: 'none needed',
    kickoffText: () => 'k',
    ...over,
  }
}

/** One setting change an adapter proposes for autonomy, used to make a non-empty autonomy list. */
const SETTING: SettingProposal = {
  kind: 'command',
  key: 'mode',
  read: ['get'],
  write: ['set'],
  to: 'yolo',
  why: 'autonomy needs it',
  isRequired: true,
}

/** Every required field, in the order missingFields must report them. */
const ALL_FIELDS = [
  'id', 'name', 'detectRule', 'detect', 'startWork', 'locations',
  'verify', 'doneSignal', 'humanGates', 'autonomy', 'kickoffText',
]

describe('DECISION_TYPES and UNSUPPORTED_MARKERS', () => {
  test('the decision types are Product, Arch, Security and QA', () => {
    expect(DECISION_TYPES).toEqual(['Product', 'Arch', 'Security', 'QA'])
  })

  test('the unsupported markers are aidlc, _bmad and .specify, in report order', () => {
    expect(UNSUPPORTED_MARKERS.map(row => [row.marker, row.id, row.name])).toEqual([
      ['aidlc', 'aidlc', 'AI-DLC'],
      ['_bmad', 'bmad', 'BMAD'],
      ['.specify', 'spec-kit', 'spec-kit'],
    ])
  })
})

describe('detectUnsupported', () => {
  test('a repo with no marker reports every marker as not-found with its absence evidence, in order', () => {
    expect(detectUnsupported(facts({}))).toEqual([
      { id: 'aidlc', name: 'AI-DLC', status: 'not-found', version: null, evidence: ['no aidlc/'] },
      { id: 'bmad', name: 'BMAD', status: 'not-found', version: null, evidence: ['no _bmad/'] },
      { id: 'spec-kit', name: 'spec-kit', status: 'not-found', version: null, evidence: ['no .specify/'] },
    ])
  })

  test('an aidlc directory is unsupported with its reason, never not-found', () => {
    const repoEntries = [entry('aidlc', 'dir', false)]

    expect(detectUnsupported(facts({ repoEntries }))[0]).toEqual({
      id: 'aidlc',
      name: 'AI-DLC',
      status: 'unsupported',
      version: null,
      evidence: [
        'aidlc/ present',
        'detected but unsupported: every stage after Initialization ends in a recorded human approval gate, ' +
          'so autonomous roles would block; no cadre adapter in v1',
      ],
    })
  })

  test('a symlink named _bmad counts as present, and a plain file named .specify does not', () => {
    const repoEntries = [entry('_bmad', 'other', true), entry('.specify', 'file', false)]

    expect(detectUnsupported(facts({ repoEntries })).map(row => row.status)).toEqual([
      'not-found',
      'unsupported',
      'not-found',
    ])
  })

  test('a file-kind symlink named aidlc counts as present', () => {
    const repoEntries = [entry('aidlc', 'file', true)]

    expect(detectUnsupported(facts({ repoEntries })).map(row => row.status)).toEqual([
      'unsupported',
      'not-found',
      'not-found',
    ])
  })

  test('entries named aidlc-old and _bmad2 do not match', () => {
    const repoEntries = [entry('aidlc-old', 'dir', false), entry('_bmad2', 'dir', false)]

    expect(detectUnsupported(facts({ repoEntries })).map(row => row.status)).toEqual([
      'not-found',
      'not-found',
      'not-found',
    ])
  })

  test('a marker is matched by its exact name, so AIDLC does not match aidlc', () => {
    const repoEntries = [entry('AIDLC', 'dir', false)]

    expect(detectUnsupported(facts({ repoEntries })).map(row => row.status)).toEqual([
      'not-found',
      'not-found',
      'not-found',
    ])
  })
})

describe('chooseFramework', () => {
  test('two frameworks in use with no pick is ambiguous, listed in the fixed order', () => {
    const detections = [detected('gsd', 'in-use'), detected('superpowers', 'in-use')]

    expect(chooseFramework(detections, null)).toEqual({ kind: 'ambiguous', ids: ['gsd', 'superpowers'] })
  })

  test('the ambiguous ids keep the fixed order when the detections come in reverse', () => {
    const detections = [detected('superpowers', 'in-use'), detected('gsd', 'in-use')]

    expect(chooseFramework(detections, null)).toEqual({ kind: 'ambiguous', ids: ['gsd', 'superpowers'] })
  })

  test('exactly one framework in use is chosen as the only one in use, whatever else is installed', () => {
    const detections = [detected('gsd', 'in-use'), detected('superpowers', 'installed')]

    expect(chooseFramework(detections, null)).toEqual({
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'only-one-in-use',
      reason: 'only gsd is in use in this repo',
    })
  })

  test('a user pick of an in-use framework is chosen by the user, even when two are in use', () => {
    const detections = [detected('gsd', 'in-use'), detected('superpowers', 'in-use')]

    expect(chooseFramework(detections, 'superpowers')).toEqual({
      kind: 'chosen',
      id: 'superpowers',
      pickedBy: 'user',
      reason: 'picked by the user',
    })
  })

  test('nothing in use and two installed is installed-only, and nothing is chosen', () => {
    const detections = [detected('gsd', 'installed'), detected('superpowers', 'installed')]

    expect(chooseFramework(detections, null)).toEqual({ kind: 'installed-only', ids: ['gsd', 'superpowers'] })
  })

  test('nothing in use and gsd installed is chosen when the user picks gsd', () => {
    expect(chooseFramework([detected('gsd', 'installed')], 'gsd')).toEqual({
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'user',
      reason: 'picked by the user',
    })
  })

  test('a pick of an installed framework is ignored while another framework is in use', () => {
    const detections = [detected('gsd', 'in-use'), detected('superpowers', 'installed')]

    expect(chooseFramework(detections, 'superpowers')).toEqual({
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'only-one-in-use',
      reason: 'only gsd is in use in this repo',
    })
  })

  test('a pick that is not a supported framework is ignored while gsd is in use', () => {
    const detections = [detected('gsd', 'in-use')]

    expect(chooseFramework(detections, 'aidlc' as never)).toEqual(chooseFramework(detections, null))
  })

  test('a pick of a supported framework that is neither in use nor installed is ignored', () => {
    expect(chooseFramework([], 'gsd')).toEqual({ kind: 'none' })
  })

  test('duplicate detections of one id, in use and not-found, count as in use', () => {
    const detections = [detected('gsd', 'in-use'), detected('gsd', 'not-found')]

    expect(chooseFramework(detections, null)).toEqual({
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'only-one-in-use',
      reason: 'only gsd is in use in this repo',
    })
  })

  test('a pick of none is honoured even when frameworks are in use', () => {
    const detections = [detected('gsd', 'in-use'), detected('superpowers', 'in-use')]

    expect(chooseFramework(detections, 'none')).toEqual({
      kind: 'chosen',
      id: 'none',
      pickedBy: 'user',
      reason: 'picked by the user',
    })
  })

  test('only an unsupported marker present gives unsupported with its ids', () => {
    const detections = [detection({ id: 'aidlc', name: 'AI-DLC', status: 'unsupported' })]

    expect(chooseFramework(detections, null)).toEqual({ kind: 'unsupported', ids: ['aidlc'] })
  })

  test('a framework in use is still chosen when an unsupported marker is also present', () => {
    const detections = [
      detected('gsd', 'in-use'),
      detection({ id: 'aidlc', name: 'AI-DLC', status: 'unsupported' }),
    ]

    expect(chooseFramework(detections, null)).toEqual({
      kind: 'chosen',
      id: 'gsd',
      pickedBy: 'only-one-in-use',
      reason: 'only gsd is in use in this repo',
    })
  })

  test('no detections at all is none', () => {
    expect(chooseFramework([], null)).toEqual({ kind: 'none' })
  })

  test('SUPPORTED_IDS lists gsd before superpowers and never lists none', () => {
    expect(SUPPORTED_IDS).toEqual(['gsd', 'superpowers'])
  })
})

describe('missingFields', () => {
  test('a complete adapter has no missing fields', () => {
    expect(missingFields(adapter({}))).toEqual([])
  })

  test('an empty object reports every required field, in declared order', () => {
    expect(REQUIRED_FIELDS).toEqual(ALL_FIELDS)
    expect(missingFields({})).toEqual(ALL_FIELDS)
  })

  test('a value that is not an adapter object reports every required field and does not throw', () => {
    expect(missingFields(null)).toEqual(ALL_FIELDS)
    expect(missingFields([])).toEqual(ALL_FIELDS)
  })

  test('removing any one required field reports exactly that field', () => {
    for (const field of REQUIRED_FIELDS) {
      expect(missingFields({ ...adapter({}), [field]: undefined })).toEqual([field])
    }
  })

  test('wrong-typed startWork, humanGates and locations each count as missing', () => {
    const wrong = { ...adapter({}), startWork: 'x', humanGates: {}, locations: [] }

    expect(missingFields(wrong)).toEqual(['startWork', 'locations', 'humanGates'])
  })

  test('an adapter whose id getter throws does not throw and reports id', () => {
    const hostile = { ...adapter({}) }
    Object.defineProperty(hostile, 'id', {
      get() {
        throw new Error('boom')
      },
    })

    expect(missingFields(hostile)).toEqual(['id'])
  })

  test('a blank name counts as missing', () => {
    expect(missingFields(adapter({ name: '   ' }))).toEqual(['name'])
  })

  test('an empty startWork list counts as missing', () => {
    expect(missingFields(adapter({ startWork: [] }))).toEqual(['startWork'])
  })

  test('an id outside gsd, superpowers and none counts as missing', () => {
    expect(missingFields(adapter({ id: 'other' as never }))).toEqual(['id'])
  })

  test('a locations object with an empty spec list counts as missing', () => {
    expect(missingFields(adapter({ locations: { spec: [], plan: ['b'] } }))).toEqual(['locations'])
  })

  test('a doneSignal with an empty check counts as missing', () => {
    expect(missingFields(adapter({ doneSignal: { artifact: 'f', check: '' } }))).toEqual(['doneSignal'])
  })

  test('a detect that is not a function counts as missing', () => {
    expect(missingFields(adapter({ detect: 'x' as never }))).toEqual(['detect'])
  })

  test('an empty autonomy list with no note is missing', () => {
    expect(missingFields(adapter({ autonomy: [], autonomyNote: null }))).toEqual(['autonomy'])
  })

  test('an empty autonomy list with a note stating why it needs no settings is complete', () => {
    expect(missingFields(adapter({ autonomy: [], autonomyNote: 'none' }))).toEqual([])
  })

  test('a whitespace-only autonomy note does not count as a note', () => {
    expect(missingFields(adapter({ autonomy: [], autonomyNote: '   ' }))).toEqual(['autonomy'])
  })

  test('a non-empty autonomy list is complete without a note', () => {
    expect(missingFields(adapter({ autonomy: [SETTING], autonomyNote: null }))).toEqual([])
  })
})

describe('isDecisionType', () => {
  test('accepts a decision type with its exact name', () => {
    expect(isDecisionType('Arch')).toBe(true)
  })

  test('rejects a decision type name in a different case', () => {
    expect(isDecisionType('arch')).toBe(false)
  })

  test('rejects a value that is not a string', () => {
    expect(isDecisionType(42)).toBe(false)
    expect(isDecisionType(null)).toBe(false)
  })
})

describe('gateProblems', () => {
  test('two valid gates of the same decision type with different ids have no problems', () => {
    expect(gateProblems([gate({ id: 'a' }), gate({ id: 'b' })])).toEqual([])
  })

  test('a standing-rule gate with no decision type is valid', () => {
    expect(gateProblems([gate({ id: 'x', kind: 'standing-rule', decisionType: null })])).toEqual([])
  })

  test('a gate id that repeats is reported once, however many times it repeats', () => {
    const repeated = [gate({ id: 'x' }), gate({ id: 'x' }), gate({ id: 'x' })]

    expect(gateProblems(repeated)).toEqual(['duplicate gate id x'])
  })

  test('a chat gate with no decision type needs kind standing-rule', () => {
    expect(gateProblems([gate({ id: 'x', kind: 'chat', decisionType: null })])).toEqual([
      'gate x: decisionType null needs kind standing-rule',
    ])
  })

  test('a standing-rule gate that names a decision type is reported', () => {
    expect(gateProblems([gate({ id: 'x', kind: 'standing-rule', decisionType: 'Arch' })])).toEqual([
      'gate x: standing-rule gate must have decisionType null',
    ])
  })

  test('a decision type outside DECISION_TYPES is reported as unknown', () => {
    expect(gateProblems([gate({ id: 'x', decisionType: 'Ops' as never })])).toEqual(['gate x: unknown decisionType'])
  })

  test('a blank kickoff is reported as an empty kickoff', () => {
    expect(gateProblems([gate({ id: 'x', kickoff: '   ' })])).toEqual(['gate x: empty kickoff'])
  })

  test('a gate that is not an object is reported, and the gates after it are still checked', () => {
    expect(gateProblems([null, gate({ id: 'x', kickoff: '' })])).toEqual([
      'gate is not an object',
      'gate x: empty kickoff',
    ])
  })

  test('an array inside the gates array is reported as not an object', () => {
    expect(gateProblems([[]])).toEqual(['gate is not an object'])
  })

  test('a gate whose field throws when read is reported and the next gate is still checked', () => {
    const hostile = Object.defineProperty({}, 'id', {
      get() {
        throw new Error('boom')
      },
    })
    expect(gateProblems([hostile, [], {}])).toEqual([
      'gate could not be read',
      'gate is not an object',
      'gate has no id',
      'gate <non-string id>: unknown decisionType',
      'gate <non-string id>: empty kickoff',
    ])
  })

  test('a gate with no id is reported, and two id-less gates are not duplicates', () => {
    expect(gateProblems([gate({ id: undefined as never })])).toContain('gate has no id')
    expect(gateProblems([gate({ id: '' }), gate({ id: '  ' })]).some(text => text.includes('duplicate'))).toBe(false)
  })

  test('a gate whose id is a null-prototype object does not throw and gets the fixed token', () => {
    const hostile = gate({ id: Object.create(null) as never, kickoff: '' })

    expect(gateProblems([hostile])).toEqual(['gate has no id', 'gate <non-string id>: empty kickoff'])
  })

  test('a long gate id is capped at 40 characters in the message', () => {
    const problems = gateProblems([gate({ id: 'a'.repeat(60), kickoff: '' })])

    expect(problems).toEqual([`gate ${'a'.repeat(39)}\u2026: empty kickoff`])
  })

  test('a gate id with a bidi override character is cleaned in the message', () => {
    expect(gateProblems([gate({ id: 'a\u202Eb', kickoff: '' })])).toEqual(['gate ab: empty kickoff'])
  })

  test('60 bad gates give MAX_GATE_PROBLEMS problems and one line saying more were not shown', () => {
    const bad = Array.from({ length: 60 }, (_, index) => gate({ id: `g${index}`, kickoff: '' }))
    const problems = gateProblems(bad)

    expect(MAX_GATE_PROBLEMS).toBe(50)
    expect(problems.length).toBe(51)
    expect(problems[50]).toBe('more gate problems not shown')
  })

  test('exactly MAX_GATE_PROBLEMS problems get no extra line', () => {
    const bad = Array.from({ length: 50 }, (_, index) => gate({ id: `g${index}`, kickoff: '' }))

    expect(gateProblems(bad).length).toBe(50)
  })

  test('a gate table that is not an array is reported', () => {
    expect(gateProblems(null)).toEqual(['gates is not an array'])
  })
})
