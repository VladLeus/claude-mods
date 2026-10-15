import { describe, expect, test } from 'claude-code/testing'

import type { Facts, RawFacts } from '../types'
import { clean, normalizeFacts, parseRepoEntries } from './facts'

/** A raw host read with every list empty, the repo at /repo and the home folder at /home/u. */
function raw(over: Partial<RawFacts>): RawFacts {
  return {
    root: '/repo',
    home: '/home/u',
    repoEntries: [],
    docsEntries: [],
    settings: [],
    installedPlugins: null,
    gsd: [],
    warnings: [],
    ...over,
  }
}

/** The Facts of an empty read, with any list overridden. */
function emptyFacts(over: Partial<Facts>): Facts {
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

describe('clean', () => {
  test('removes bidi and line-break characters, joining the text around them', () => {
    expect(clean('a‮b\nc')).toBe('abc')
  })

  test('a value that is not a string becomes the empty string', () => {
    expect(clean(42)).toBe('')
  })

  test('a longer value is cut to the cap, with an ellipsis as the last character', () => {
    expect(clean('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}…`)
  })
})

describe('parseRepoEntries', () => {
  test('keeps the name, kind and isLink of each entry and drops size and mtime', () => {
    expect(parseRepoEntries([{ name: '.planning', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }])).toEqual([
      { name: '.planning', kind: 'dir', isLink: false },
    ])
  })

  test('a symlink to anything keeps isLink true', () => {
    expect(parseRepoEntries([{ name: '.planning', kind: 'other', isLink: true }])).toEqual([
      { name: '.planning', kind: 'other', isLink: true },
    ])
  })

  test('isLink is true only when the host sent exactly true', () => {
    expect(parseRepoEntries([{ name: 'notes.md', kind: 'file', isLink: 'true' }])).toEqual([
      { name: 'notes.md', kind: 'file', isLink: false },
    ])
  })

  test('drops an entry with a non-string name or a kind outside file, dir and other', () => {
    expect(
      parseRepoEntries([
        { name: 'docs', kind: 'file', isLink: false },
        { name: 42, kind: 'dir', isLink: false },
        { name: 'socket', kind: 'socket', isLink: false },
      ]),
    ).toEqual([{ name: 'docs', kind: 'file', isLink: false }])
  })

  test('a value that is not an array gives no entries', () => {
    expect(parseRepoEntries(null)).toEqual([])
    expect(parseRepoEntries('x')).toEqual([])
  })
})

describe('normalizeFacts', () => {
  test('an empty raw read gives Facts with every list empty and no warnings', () => {
    expect(normalizeFacts(raw({}))).toEqual(emptyFacts({}))
  })

  test('repo and docs listings become typed entries, and warnings are cleaned', () => {
    const facts = normalizeFacts(
      raw({
        repoEntries: [{ name: '.planning', kind: 'other', size: 0, mtimeMs: 0, isLink: true }],
        docsEntries: [{ name: 'guide.md', kind: 'file', isLink: false }],
        warnings: ['could not list docs‮'],
      }),
    )
    expect(facts).toEqual(
      emptyFacts({
        repoEntries: [{ name: '.planning', kind: 'other', isLink: true }],
        docsEntries: [{ name: 'guide.md', kind: 'file', isLink: false }],
        warnings: ['could not list docs'],
      }),
    )
  })

  test('the same raw read gives the same Facts twice, and the raw read is not changed', () => {
    const input = raw({ repoEntries: [{ name: 'src', kind: 'dir', size: 4, mtimeMs: 1, isLink: false }] })
    const before = JSON.stringify(input)
    const expected = emptyFacts({ repoEntries: [{ name: 'src', kind: 'dir', isLink: false }] })
    expect(normalizeFacts(input)).toEqual(expected)
    expect(normalizeFacts(input)).toEqual(expected)
    expect(JSON.stringify(input)).toBe(before)
  })
})
