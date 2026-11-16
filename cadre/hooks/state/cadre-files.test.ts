import { describe, expect, test } from 'claude-code/testing'

import { planState } from '../init/initplan'
import type { PlanStepInput } from '../init/initplan'
import {
  BACKSLASH,
  BE_FILE,
  DEFAULT_LOCATIONS,
  manifestText,
  repoScan,
  SHA_A,
  stateText,
  templateRole,
} from '../testkit'
import { listsCadreRole, parseCadreState, parseManifest } from './cadre-files'

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

  test('a state that lists the reserved role id cadre is null', () => {
    expect(parseCadreState(stateText({ roles: ['pm', 'cadre'] }))).toBeNull()
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

describe('parseCadreState: the sizing block and the recorded frameworks', () => {
  const SIZING = { threshold: 0.6, mapping: { small: 'superpowers', large: 'gsd' }, rubric: '.cadre/sizing.md' }

  test('a state with no sizing block and no frameworks parses, with neither key', () => {
    const state = parseCadreState(stateText())

    expect(state).not.toBeNull()
    expect(Object.keys(state ?? {}).filter(key => key === 'sizing' || key === 'frameworks')).toEqual([])
  })

  test('a valid sizing block and a list of frameworks come back as they are', () => {
    const state = parseCadreState(stateText({ sizing: SIZING, frameworks: ['gsd', 'superpowers'] }))

    expect([state?.sizing, state?.frameworks]).toEqual([SIZING, ['gsd', 'superpowers']])
    expect(parseCadreState(stateText({ frameworks: ['gsd'] }))?.frameworks).toEqual(['gsd'])
  })

  test('a threshold of 0.1 or 1 is kept, and a field the block does not name is dropped', () => {
    for (const threshold of [0.1, 1]) {
      expect(parseCadreState(stateText({ sizing: { ...SIZING, threshold } }))?.sizing?.threshold).toBe(threshold)
    }
    expect(parseCadreState(stateText({ sizing: { ...SIZING, extra: 1 } }))?.sizing).toEqual(SIZING)
  })

  test('a sizing block with threshold 0 makes the state null', () => {
    expect(parseCadreState(stateText({ sizing: { ...SIZING, threshold: 0 } }))).toBeNull()
  })

  test('a sizing block with threshold 1.5 makes the state null', () => {
    expect(parseCadreState(stateText({ sizing: { ...SIZING, threshold: 1.5 } }))).toBeNull()
  })

  test('a threshold that is no number, or a sizing block that is no object, makes the state null', () => {
    for (const threshold of ['0.5', null, undefined]) {
      expect(parseCadreState(stateText({ sizing: { ...SIZING, threshold } }))).toBeNull()
    }
    for (const sizing of [null, 'small', [], 0.5]) {
      expect(parseCadreState(stateText({ sizing }))).toBeNull()
    }
  })

  test('a mapping value that is no framework id makes the state null', () => {
    expect(parseCadreState(stateText({ sizing: { ...SIZING, mapping: { small: 'aidlc', large: 'gsd' } } }))).toBeNull()
    expect(parseCadreState(stateText({ sizing: { ...SIZING, mapping: { small: 'gsd' } } }))).toBeNull()
    expect(parseCadreState(stateText({ sizing: { ...SIZING, mapping: null } }))).toBeNull()
  })

  test('a rubric path that isSafeRelativePath refuses makes the state null', () => {
    for (const rubric of ['../sizing.md', '/abs/sizing.md', 'a b.md', '', 5]) {
      expect(parseCadreState(stateText({ sizing: { ...SIZING, rubric } }))).toBeNull()
    }
  })

  test('frameworks with an id that is no framework id make the state null', () => {
    expect(parseCadreState(stateText({ frameworks: ['x'] }))).toBeNull()
    expect(parseCadreState(stateText({ frameworks: 'gsd' }))).toBeNull()
  })

  test('frameworks with an id listed twice make the state null', () => {
    expect(parseCadreState(stateText({ frameworks: ['gsd', 'gsd'] }))).toBeNull()
  })
})

describe('the docker scripts cadre.json records', () => {
  /** What planStep plans from, for BE alone, with a repo scan that found these docker scripts. */
  function planInput(dockerScripts?: readonly string[]): PlanStepInput {
    return {
      roles: [templateRole('be')],
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes: new Map(),
      hunks: [],
      repo: repoScan(dockerScripts === undefined ? {} : { dockerScripts }),
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
  }

  test('recorded docker scripts are read back, and an absent field stays absent', () => {
    const recorded = parseCadreState(stateText({ dockerScripts: ['npm run docker:up', 'yarn docker:rspec'] }))
    const absent = parseCadreState(stateText())

    expect(recorded?.dockerScripts).toEqual(['npm run docker:up', 'yarn docker:rspec'])
    expect(absent).not.toBeNull()
    expect(Object.hasOwn(absent ?? {}, 'dockerScripts')).toBe(false)
  })

  test('docker scripts that are not a list of runner commands make the state null', () => {
    const commands = [
      'yarn',
      'make docker:up',
      'yarn docker rspec',
      'yarn docker;up',
      'npm docker:up',
      ' yarn up',
      'yarn up\n',
    ]
    for (const command of commands) {
      expect(parseCadreState(stateText({ dockerScripts: [command] }))).toBeNull()
    }
    for (const dockerScripts of ['yarn docker:rspec', [1], null, {}]) {
      expect(parseCadreState(stateText({ dockerScripts }))).toBeNull()
    }
  })

  test('docker scripts that list one twice make the state null', () => {
    expect(parseCadreState(stateText({ dockerScripts: ['yarn docker:rspec', 'yarn docker:rspec'] }))).toBeNull()
  })

  test('a docker script named with no leading letter or digit, or without docker, makes the state null', () => {
    const commands = ['yarn exec', 'yarn --cwd', 'pnpm dlx', 'npm run up', 'yarn -docker', 'yarn .docker']
    for (const command of [...commands, 'yarn Docker:up']) {
      expect(parseCadreState(stateText({ dockerScripts: [command] }))).toBeNull()
    }
    const kept = ['npm run docker:up', 'yarn rspec-docker']

    expect(parseCadreState(stateText({ dockerScripts: kept }))?.dockerScripts).toEqual(kept)
  })

  test("planState records the scan's docker scripts only when the scan found one", () => {
    expect(planState(planInput(['yarn docker:rspec']), '0.5.17').dockerScripts).toEqual(['yarn docker:rspec'])
    expect(Object.hasOwn(planState(planInput([]), '0.5.17'), 'dockerScripts')).toBe(false)
    expect(Object.hasOwn(planState(planInput(), '0.5.17'), 'dockerScripts')).toBe(false)
  })
})

describe('the structure cadre.json records', () => {
  test('cadre.json keeps the recorded structure, refuses an unknown one, and reads none as absent', () => {
    const input: PlanStepInput = {
      roles: [templateRole('be')],
      repoDefault: 'none',
      policy: 'definitions',
      launchStart: { kind: 'git-root' },
      scopes: new Map(),
      hunks: [],
      repo: repoScan(),
      locations: DEFAULT_LOCATIONS,
      readUserMcp: false,
    }
    const absent = parseCadreState(stateText())

    for (const structure of ['core', 'custom']) {
      expect(parseCadreState(stateText({ structure }))?.structure).toBe(structure)
    }
    for (const structure of ['team', 'Core', '', 1, null, ['core'], {}]) {
      expect(parseCadreState(stateText({ structure }))).toBeNull()
    }
    expect(absent).not.toBeNull()
    expect(Object.hasOwn(absent ?? {}, 'structure')).toBe(false)
    expect(planState({ ...input, structure: 'custom' }, '0.5.18').structure).toBe('custom')
    expect(Object.hasOwn(planState(input, '0.5.18'), 'structure')).toBe(false)
  })
})

describe('listsCadreRole', () => {
  test('it is true only for a cadre.json text whose roles list holds the role id cadre', () => {
    expect(listsCadreRole(stateText({ roles: ['pm', 'cadre'] }))).toBe(true)
    expect(listsCadreRole(stateText({ roles: ['pm', 'be'] }))).toBe(false)
    expect(listsCadreRole('not json')).toBe(false)
    expect(listsCadreRole(stateText({ roles: 'cadre' }))).toBe(false)
  })
})
