import { describe, expect, test } from 'claude-code/testing'

import type { Detection, Facts, RepoEntry } from '../types'
import { detectSuperpowers } from './superpowers'

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

/** The superpowers key the official marketplace ships, as the settings files spell it. */
const OFFICIAL_KEY = 'superpowers@claude-plugins-official'

/** What detection reports when superpowers is neither in use nor installed. */
const NOT_FOUND: Detection = {
  id: 'superpowers',
  name: 'superpowers',
  status: 'not-found',
  version: null,
  evidence: ['no docs/superpowers/ or .superpowers/', 'no enabled superpowers@ plugin'],
}

describe('detectSuperpowers', () => {
  test('a docs/superpowers/ directory is in use, with the docs evidence', () => {
    const docs: RepoEntry = { name: 'superpowers', kind: 'dir', isLink: false }

    expect(detectSuperpowers(facts({ docsEntries: [docs] }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'in-use',
      version: null,
      evidence: ['docs/superpowers/'],
    })
  })

  test('a .superpowers symlink at the repo root is in use, whatever it points at', () => {
    const link: RepoEntry = { name: '.superpowers', kind: 'other', isLink: true }

    expect(detectSuperpowers(facts({ repoEntries: [link] }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'in-use',
      version: null,
      evidence: ['.superpowers/'],
    })
  })

  test('a plain file named .superpowers is not in use', () => {
    const file: RepoEntry = { name: '.superpowers', kind: 'file', isLink: false }

    expect(detectSuperpowers(facts({ repoEntries: [file] }))).toEqual(NOT_FOUND)
  })

  test('a docs entry that only starts with superpowers is not in use', () => {
    const docs: RepoEntry = { name: 'superpowers-notes', kind: 'dir', isLink: false }

    expect(detectSuperpowers(facts({ docsEntries: [docs] }))).toEqual(NOT_FOUND)
  })

  test('an enabled superpowers@ key is installed, with its version and source-labelled evidence', () => {
    const flags = [{ key: OFFICIAL_KEY, source: 'user' as const, value: true }]
    const versions = [{ key: OFFICIAL_KEY, version: '6.4.1' }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags, superpowersVersions: versions }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'installed',
      version: '6.4.1',
      evidence: ['enabledPlugins["superpowers@claude-plugins-official"]=true (user)'],
    })
  })

  test('a malformed superpowers@ key still counts, because the match is by prefix', () => {
    const flags = [{ key: 'superpowers@x.', source: 'user' as const, value: true }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'installed',
      version: null,
      evidence: ['enabledPlugins["superpowers@x."]=true (user)'],
    })
  })

  test('a key that only ends in superpowers is not a superpowers@ key', () => {
    const flags = [{ key: 'my-superpowers@x', source: 'user' as const, value: true }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags }))).toEqual(NOT_FOUND)
  })

  test('a key for another plugin is ignored', () => {
    const flags = [{ key: 'autopilot@local-mods', source: 'user' as const, value: true }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags }))).toEqual(NOT_FOUND)
  })

  test('a superpowers@ key set to false is not installed, even when a version is recorded', () => {
    const flags = [{ key: OFFICIAL_KEY, source: 'user' as const, value: false }]
    const versions = [{ key: OFFICIAL_KEY, version: '6.4.1' }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags, superpowersVersions: versions }))).toEqual(NOT_FOUND)
  })

  test('in use beats installed: one detection carries both evidence groups and the version', () => {
    const docs: RepoEntry = { name: 'superpowers', kind: 'dir', isLink: false }
    const flags = [{ key: OFFICIAL_KEY, source: 'user' as const, value: true }]
    const versions = [{ key: OFFICIAL_KEY, version: '6.4.1' }]

    expect(
      detectSuperpowers(facts({ docsEntries: [docs], enabledPlugins: flags, superpowersVersions: versions })),
    ).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'in-use',
      version: '6.4.1',
      evidence: ['docs/superpowers/', 'enabledPlugins["superpowers@claude-plugins-official"]=true (user)'],
    })
  })

  test('with nothing in use or installed, both absence reasons are reported in order', () => {
    expect(detectSuperpowers(facts({}))).toEqual(NOT_FOUND)
  })

  test('a project-sourced enablement shows its source in the evidence', () => {
    const flags = [{ key: OFFICIAL_KEY, source: 'project' as const, value: true }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'installed',
      version: null,
      evidence: ['enabledPlugins["superpowers@claude-plugins-official"]=true (project)'],
    })
  })

  test('the version comes only from the entry for the same key', () => {
    const flags = [{ key: OFFICIAL_KEY, source: 'user' as const, value: true }]
    const versions = [{ key: 'superpowers@local-dev', version: '9.9.9' }]

    expect(detectSuperpowers(facts({ enabledPlugins: flags, superpowersVersions: versions }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'installed',
      version: null,
      evidence: ['enabledPlugins["superpowers@claude-plugins-official"]=true (user)'],
    })
  })

  test('with two enabled keys, the version is the first key version and both keys are listed in order', () => {
    const flags = [
      { key: OFFICIAL_KEY, source: 'user' as const, value: true },
      { key: 'superpowers@local-dev', source: 'local' as const, value: true },
    ]
    const versions = [
      { key: OFFICIAL_KEY, version: '6.4.1' },
      { key: 'superpowers@local-dev', version: '7.0.0' },
    ]

    expect(detectSuperpowers(facts({ enabledPlugins: flags, superpowersVersions: versions }))).toEqual({
      id: 'superpowers',
      name: 'superpowers',
      status: 'installed',
      version: '6.4.1',
      evidence: [
        'enabledPlugins["superpowers@claude-plugins-official"]=true (user)',
        'enabledPlugins["superpowers@local-dev"]=true (local)',
      ],
    })
  })
})
