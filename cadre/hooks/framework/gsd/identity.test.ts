import { describe, expect, test } from 'claude-code/testing'
import type { GsdFact, GsdReadTarget, InitFacts } from '../../../types'
import { EMPTY_FACTS } from '../../testkit'
import {
  isGsdIdentitySource,
  isRuntimeCallAllowed,
  isRuntimeIdentityArgv,
  parseGsdManifest,
  parseRuntimeIdentity,
  parseVersionText,
  provenUserDir,
  runtimeBuiltPath,
  runtimeIdentityArgv,
  runtimeSkipProblem,
} from './identity'

/** The user-level GSD install under /home/u, as the host reads it. */
const USER_TARGET: GsdReadTarget = {
  location: 'user',
  dir: '/home/u/.claude/gsd-core',
  versionPath: '/home/u/.claude/gsd-core/VERSION',
  identityPath: '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs',
  manifestPath: '/home/u/.claude/gsd-file-manifest.json',
}

/** The repo-local GSD copy under /repo, as the host reads it. */
const PROJECT_TARGET: GsdReadTarget = {
  location: 'project',
  dir: '/repo/.claude/gsd-core',
  versionPath: '/repo/.claude/gsd-core/VERSION',
  identityPath: '/repo/.claude/gsd-core/bin/lib/package-identity.cjs',
  manifestPath: '/repo/.claude/gsd-file-manifest.json',
}

describe('isGsdIdentitySource', () => {
  test('the identity line that declares the GSD package name proves the install', () => {
    expect(isGsdIdentitySource('const packageName = "@opengsd/gsd-core";')).toBe(true)
  })

  test('the identity line with leading spaces or a trailing carriage return proves the install', () => {
    expect(isGsdIdentitySource('x\n  const packageName = "@opengsd/gsd-core";\r\ny')).toBe(true)
  })

  test('the identity line inside a comment or a longer line does not prove the install', () => {
    expect(isGsdIdentitySource('// const packageName = "@opengsd/gsd-core";')).toBe(false)
    expect(isGsdIdentitySource('x; const packageName = "@opengsd/gsd-core";')).toBe(false)
    expect(isGsdIdentitySource('const packageName = "@opengsd/gsd-core"; evil()')).toBe(false)
  })

  test('a bare mention of gsd-core, or no text at all, does not prove it', () => {
    expect(isGsdIdentitySource('gsd-core')).toBe(false)
    expect(isGsdIdentitySource(null)).toBe(false)
  })
})

describe('parseRuntimeIdentity', () => {
  test('stdout that opens with the GSD identity object gives its version', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core","version":"1.16.0"}')).toEqual({
      version: '1.16.0',
    })
  })

  test('a decoy that names another package and only mentions GSD later is refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"get-shit-done-cc","note":"@opengsd/gsd-core"}')).toBeNull()
  })

  test('a package name that merely starts with the GSD name is refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core-evil","version":"1.0.0"}')).toBeNull()
  })

  test('a duplicate packageName key whose last value is another package is refused', () => {
    const stdout = '{"packageName":"@opengsd/gsd-core","packageName":"evil","version":"1.0.0"}'
    expect(parseRuntimeIdentity(stdout)).toBeNull()
  })

  test('output that is not complete JSON, and no output at all, are refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core"')).toBeNull()
    expect(parseRuntimeIdentity(null)).toBeNull()
    expect(parseRuntimeIdentity(42)).toBeNull()
  })
})

describe('parseVersionText', () => {
  test('the text is trimmed and a version is kept', () => {
    expect(parseVersionText(' 1.16.0\n')).toBe('1.16.0')
  })

  test('text that is not a version, or a version longer than 40 characters, gives null', () => {
    expect(parseVersionText('latest')).toBeNull()
    expect(parseVersionText(`1.0.0-${'a'.repeat(40)}`)).toBeNull()
  })

  test('a version of exactly 40 characters is kept and one of 41 is not', () => {
    expect(parseVersionText(`1.0.0-${'a'.repeat(34)}`)).toBe(`1.0.0-${'a'.repeat(34)}`)
    expect(parseVersionText(`1.0.0-${'a'.repeat(35)}`)).toBeNull()
  })
})

describe('parseGsdManifest', () => {
  test('a manifest with a numeric manifestVersion and a valid version gives that version', () => {
    expect(parseGsdManifest({ manifestVersion: 2, version: '1.16.0', files: {} })).toEqual({ version: '1.16.0' })
  })

  test('a manifest without a numeric manifestVersion gives null', () => {
    expect(parseGsdManifest({ version: '1.16.0', files: {} })).toBeNull()
  })
})

describe('runtimeIdentityArgv', () => {
  test('a present user install with no proven identity gets the runtime identity call', () => {
    expect(runtimeIdentityArgv(USER_TARGET, null, true, true)).toEqual([
      'node',
      '/home/u/.claude/gsd-core/bin/gsd-tools.cjs',
      'runtime-identity',
      '--raw',
    ])
  })

  test('a repo-local install never gets a runtime call, even when present and unproven (D-28)', () => {
    expect(runtimeIdentityArgv(PROJECT_TARGET, null, true, true)).toBeNull()
  })

  test('a user install that its identity module already proves gets no runtime call', () => {
    expect(runtimeIdentityArgv(USER_TARGET, 'const packageName = "@opengsd/gsd-core";', true, true)).toBeNull()
  })

  test('an absent user install gets no runtime call', () => {
    expect(runtimeIdentityArgv(USER_TARGET, null, false, true)).toBeNull()
  })

  test('a present, unproven user install whose runtime is not built gets no runtime call (WR-01)', () => {
    expect(runtimeIdentityArgv(USER_TARGET, null, true, false)).toBeNull()
  })

  test(
    'isRuntimeIdentityArgv accepts only the argv runtimeIdentityArgv builds, with its GSD folder as cwd (E4)',
    () => {
      const argv = runtimeIdentityArgv(USER_TARGET, null, true, true) ?? []

      expect(isRuntimeIdentityArgv(argv, USER_TARGET.dir)).toBe(true)
      expect(isRuntimeIdentityArgv(argv, '/repo')).toBe(false)
      expect(isRuntimeIdentityArgv([...argv, '--extra'], USER_TARGET.dir)).toBe(false)
      expect(isRuntimeIdentityArgv(['sh', ...argv.slice(1)], USER_TARGET.dir)).toBe(false)
      expect(isRuntimeIdentityArgv([], USER_TARGET.dir)).toBe(false)
    },
  )
})

describe('runtimeBuiltPath', () => {
  test('is the compiled cli-exit.cjs under the install bin/lib folder', () => {
    expect(runtimeBuiltPath(USER_TARGET)).toBe('/home/u/.claude/gsd-core/bin/lib/cli-exit.cjs')
  })
})

describe('isRuntimeCallAllowed', () => {
  test('only a present, unproven user-level install is allowed', () => {
    expect(isRuntimeCallAllowed(USER_TARGET, null, true)).toBe(true)
    expect(isRuntimeCallAllowed(PROJECT_TARGET, null, true)).toBe(false)
    expect(isRuntimeCallAllowed(USER_TARGET, 'const packageName = "@opengsd/gsd-core";', true)).toBe(false)
    expect(isRuntimeCallAllowed(USER_TARGET, null, false)).toBe(false)
  })
})

describe('runtimeSkipProblem', () => {
  test('a present, unproven user install with no built runtime is not-built (WR-01)', () => {
    expect(runtimeSkipProblem(USER_TARGET, null, true, false)).toBe('not-built')
  })

  test('a built runtime, a repo-local install, a proven identity or an absent install is no problem', () => {
    expect(runtimeSkipProblem(USER_TARGET, null, true, true)).toBeNull()
    expect(runtimeSkipProblem(PROJECT_TARGET, null, true, false)).toBeNull()
    expect(runtimeSkipProblem(USER_TARGET, 'const packageName = "@opengsd/gsd-core";', true, false)).toBeNull()
    expect(runtimeSkipProblem(USER_TARGET, null, false, false)).toBeNull()
  })
})

/** A user-level GSD at ~/.claude/gsd-core whose identity is proven, as detection reports it. */
const PROVEN_USER_GSD: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** The detect facts of a user whose GSD at ~/.claude/gsd-core is proven, with its raw dir. */
const PROVEN_FACTS: InitFacts = {
  facts: { ...EMPTY_FACTS, gsd: [PROVEN_USER_GSD] },
  gsdUserDir: '/home/u/.claude/gsd-core',
}

describe('provenUserDir', () => {
  test('the raw user-level GSD dir when the facts prove the user GSD', () => {
    expect(provenUserDir(PROVEN_FACTS)).toBe('/home/u/.claude/gsd-core')
  })

  test('null for an unproven user GSD, a proven repo copy alone, or no raw dir', () => {
    const unproven: readonly GsdFact['identity'][] = ['absent', 'unknown']
    for (const identity of unproven) {
      const facts = { ...EMPTY_FACTS, gsd: [{ ...PROVEN_USER_GSD, identity }] }
      expect(provenUserDir({ ...PROVEN_FACTS, facts })).toBeNull()
    }
    const repoCopy: GsdFact = { ...PROVEN_USER_GSD, location: 'project', dir: '<repo>/.claude/gsd-core' }
    expect(provenUserDir({ ...PROVEN_FACTS, facts: { ...EMPTY_FACTS, gsd: [repoCopy] } })).toBeNull()
    expect(provenUserDir({ ...PROVEN_FACTS, gsdUserDir: null })).toBeNull()
    expect(provenUserDir({ facts: EMPTY_FACTS, gsdUserDir: '/home/u/.claude/gsd-core' })).toBeNull()
  })
})
