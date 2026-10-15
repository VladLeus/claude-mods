import { describe, expect, test } from 'claude-code/testing'

import type { Facts, RepoEntry } from '../types'
import { DECISION_TYPES, detectUnsupported, UNSUPPORTED_MARKERS } from './framework'

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
