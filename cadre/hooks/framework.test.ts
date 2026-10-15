import { describe, expect, test } from 'claude-code/testing'

import type { Detection, DetectStatus, Facts, FrameworkId, RepoEntry } from '../types'
import {
  chooseFramework,
  DECISION_TYPES,
  detectUnsupported,
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

  test('a pick that is not a supported framework is ignored', () => {
    const detections = [detection({ id: 'aidlc', name: 'AI-DLC', status: 'unsupported' })]

    expect(chooseFramework(detections, 'aidlc' as never)).toEqual({ kind: 'unsupported', ids: ['aidlc'] })
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
