import { describe, expect, test } from 'claude-code/testing'

import { BACKSLASH, BE_FILE, manifestText, SHA_A, stateText } from '../testkit'
import { parseCadreState, parseManifest } from './cadre-files'

const SHA_B = '0123456789abcdef'.repeat(4)
const BE_LAUNCHER = { path: '.cadre/bin/be', sha256: SHA_B, mode: 'exec' }

describe('parseManifest', () => {
  test('a valid manifest comes back with its files in order', () => {
    expect(parseManifest(manifestText([BE_FILE, BE_LAUNCHER]))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      files: [
        { path: '.cadre/be/role.json', sha256: SHA_A, mode: 'file' },
        { path: '.cadre/bin/be', sha256: SHA_B, mode: 'exec' },
      ],
    })
  })

  test('a manifest with no files, and a version of unknown, are valid', () => {
    expect(parseManifest(manifestText([]))).toEqual({ schema: 1, cadreVersion: '0.2.0', files: [] })
    expect(parseManifest(manifestText([], { cadreVersion: 'unknown' }))).toEqual({
      schema: 1,
      cadreVersion: 'unknown',
      files: [],
    })
  })

  test('fields the contract does not name are dropped', () => {
    const parsed = parseManifest(manifestText([{ ...BE_FILE, extra: 1 }], { note: 'x' }))

    expect(parsed).toEqual({ schema: 1, cadreVersion: '0.2.0', files: [BE_FILE] })
  })

  test('text that is not a JSON object is null', () => {
    for (const text of ['', '{', 'null', '[]', '"x"', '1', 'not json']) {
      expect(parseManifest(text)).toBeNull()
    }
  })

  test('a schema other than the number 1, or no schema, is null', () => {
    expect(parseManifest(manifestText([], { schema: 2 }))).toBeNull()
    expect(parseManifest(manifestText([], { schema: '1' }))).toBeNull()
    expect(parseManifest(JSON.stringify({ cadreVersion: '0.2.0', files: [] }))).toBeNull()
  })

  test('a cadre version that is not x.y.z or unknown is null', () => {
    for (const version of ['0.2', 'v0.2.0', '0.2.0.1', '', ' 0.2.0', 'latest', 1, null]) {
      expect(parseManifest(manifestText([], { cadreVersion: version }))).toBeNull()
    }
    expect(parseManifest(JSON.stringify({ schema: 1, files: [] }))).toBeNull()
  })

  test('files that are missing or not a list are null', () => {
    expect(parseManifest(JSON.stringify({ schema: 1, cadreVersion: '0.2.0' }))).toBeNull()
    expect(parseManifest(manifestText([], { files: 'x' }))).toBeNull()
    expect(parseManifest(manifestText([], { files: { a: 1 } }))).toBeNull()
  })

  test('an entry that is not an object is null', () => {
    for (const item of ['x', null, 5, [], [BE_FILE]]) {
      expect(parseManifest(manifestText([item]))).toBeNull()
    }
  })

  test('an entry with an unsafe path is null', () => {
    for (const path of ['', '/x', '../x', 'a/../b', './a', 'a//b', 'a/', 'a b', `a${BACKSLASH}b`, 5, null]) {
      expect(parseManifest(manifestText([{ ...BE_FILE, path }]))).toBeNull()
    }
  })

  test('an entry whose sha256 is not 64 lowercase hex characters is null', () => {
    const bad = ['g'.repeat(64), 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '', ` ${'a'.repeat(63)}`, 1, null]
    for (const sha256 of bad) {
      expect(parseManifest(manifestText([{ ...BE_FILE, sha256 }]))).toBeNull()
    }
  })

  test('an entry whose mode is not file or exec is null', () => {
    for (const mode of ['x', 'File', 'executable', '', 0, null]) {
      expect(parseManifest(manifestText([{ ...BE_FILE, mode }]))).toBeNull()
    }
    expect(parseManifest(manifestText([{ path: BE_FILE.path, sha256: SHA_A }]))).toBeNull()
  })

  test('two entries with the same path are null, even with different hashes', () => {
    expect(parseManifest(manifestText([BE_FILE, BE_FILE]))).toBeNull()
    expect(parseManifest(manifestText([BE_FILE, { ...BE_FILE, sha256: SHA_B, mode: 'exec' }]))).toBeNull()
  })
})

describe('parseCadreState', () => {
  test('a valid state comes back as it is', () => {
    expect(parseCadreState(stateText({ roles: ['be', 'security'] }))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be', 'security'],
      launchStart: { kind: 'git-root' },
      readUserMcp: false,
    })
  })

  test('the consent answer for ~/.claude.json is read back, true or false (A1)', () => {
    for (const readUserMcp of [true, false]) {
      expect(parseCadreState(stateText({ readUserMcp }))?.readUserMcp).toBe(readUserMcp)
    }
  })

  test('a missing consent answer, or one that is not a boolean, makes the state null (A1)', () => {
    const withoutConsent = {
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be'],
      launchStart: { kind: 'git-root' },
    }
    expect(parseCadreState(JSON.stringify(withoutConsent))).toBeNull()
    for (const readUserMcp of [null, 'true', 1, 0]) {
      expect(parseCadreState(stateText({ readUserMcp }))).toBeNull()
    }
  })

  test('the launch start is read back: the git root, the folder it is run from, or a folder in the repo (A2)', () => {
    const starts = [{ kind: 'git-root' }, { kind: 'here' }, { kind: 'dir', path: 'apps/web' }]
    expect(starts.map(launchStart => parseCadreState(stateText({ launchStart }))?.launchStart)).toEqual(starts)
  })

  test('a missing launch start or one of an unknown kind makes the state null (A2)', () => {
    const withoutStart = { schema: 1, cadreVersion: '0.2.0', framework: 'gsd', gitPolicy: 'definitions', roles: [] }
    expect(parseCadreState(JSON.stringify(withoutStart))).toBeNull()
    for (const launchStart of [null, 'git-root', {}, { kind: 'root' }, { kind: 'GIT-ROOT' }, [], 1]) {
      expect(parseCadreState(stateText({ launchStart }))).toBeNull()
    }
  })

  test('a dir launch start whose path isSafeRelativePath refuses, or is no string, makes the state null (A2)', () => {
    for (const path of ['../x', '/abs', 'a b', '${HOME}', '', 'a/../b', 'apps/', 5, null]) {
      expect(parseCadreState(stateText({ launchStart: { kind: 'dir', path } }))).toBeNull()
    }
    expect(parseCadreState(stateText({ launchStart: { kind: 'dir' } }))).toBeNull()
  })

  test('a field inside the launch start that the contract does not name is dropped (A2)', () => {
    const git = parseCadreState(stateText({ launchStart: { kind: 'git-root', path: 'x', extra: 1 } }))
    const dir = parseCadreState(stateText({ launchStart: { kind: 'dir', path: 'apps/web', extra: 1 } }))
    expect(git?.launchStart).toEqual({ kind: 'git-root' })
    expect(dir?.launchStart).toEqual({ kind: 'dir', path: 'apps/web' })
  })

  test('every framework, a null framework, every git policy and no roles are valid', () => {
    for (const framework of ['gsd', 'superpowers', 'none', null]) {
      expect(parseCadreState(stateText({ framework }))?.framework).toBe(framework)
    }
    for (const gitPolicy of ['all', 'definitions', 'ignore']) {
      expect(parseCadreState(stateText({ gitPolicy }))?.gitPolicy).toBe(gitPolicy)
    }
    expect(parseCadreState(stateText({ roles: [] }))?.roles).toEqual([])
    expect(parseCadreState(stateText({ cadreVersion: 'unknown' }))?.cadreVersion).toBe('unknown')
  })

  test('fields the contract does not name are dropped', () => {
    expect(parseCadreState(stateText({ extra: 1 }))).toEqual({
      schema: 1,
      cadreVersion: '0.2.0',
      framework: 'gsd',
      gitPolicy: 'definitions',
      roles: ['be'],
      launchStart: { kind: 'git-root' },
      readUserMcp: false,
    })
  })

  test('text that is not a JSON object is null', () => {
    for (const text of ['', '{', 'null', '[]', '"x"', 'not json']) {
      expect(parseCadreState(text)).toBeNull()
    }
  })

  test('a reserved role id (bin, all, none) makes the state null, as a role can never take one', () => {
    for (const reserved of ['bin', 'all', 'none']) {
      expect(parseCadreState(stateText({ roles: ['be', reserved] }))).toBeNull()
    }
  })

  test('a schema other than the number 1, or a bad cadre version, is null', () => {
    expect(parseCadreState(stateText({ schema: 2 }))).toBeNull()
    expect(parseCadreState(stateText({ schema: '1' }))).toBeNull()
    expect(parseCadreState(stateText({ cadreVersion: '0.2' }))).toBeNull()
    expect(parseCadreState(stateText({ cadreVersion: 2 }))).toBeNull()
  })

  test('a framework outside gsd, superpowers, none and null is null, and so is a missing one', () => {
    for (const framework of ['bmad', 'GSD', '', 1, [], {}]) {
      expect(parseCadreState(stateText({ framework }))).toBeNull()
    }
    const withoutFramework = { schema: 1, cadreVersion: '0.2.0', gitPolicy: 'definitions', roles: ['be'] }
    expect(parseCadreState(JSON.stringify(withoutFramework))).toBeNull()
  })

  test('a git policy outside all, definitions and ignore is null', () => {
    for (const gitPolicy of ['commit', 'ALL', '', null, 1]) {
      expect(parseCadreState(stateText({ gitPolicy }))).toBeNull()
    }
  })

  test('roles that are not a list of role ids are null', () => {
    expect(parseCadreState(stateText({ roles: 'be' }))).toBeNull()
    expect(parseCadreState(stateText({ roles: { be: true } }))).toBeNull()
    expect(parseCadreState(stateText({ roles: null }))).toBeNull()
  })

  test('a role id that fails the role id pattern is null', () => {
    const bad = ['Be', '1a', '-a', 'a_b', '', 'a'.repeat(25), '../x', 'a/b', 'a b', 5, null]
    for (const id of bad) {
      expect(parseCadreState(stateText({ roles: ['be', id] }))).toBeNull()
    }
    expect(parseCadreState(stateText({ roles: ['a'.repeat(24)] }))?.roles).toEqual(['a'.repeat(24)])
  })

  test('a role id listed twice is null', () => {
    expect(parseCadreState(stateText({ roles: ['be', 'fe', 'be'] }))).toBeNull()
  })
})
