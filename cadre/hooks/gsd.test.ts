import { describe, expect, test } from 'claude-code/testing'

import type { Detection, Facts, GsdFact, RepoEntry } from '../types'
import { detectGsd, GSD_HOOK_NOTES, gsdHookFacts } from './gsd'

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

/** The `.planning/` folder at the repo root, as the host lists it. */
const PLANNING_DIR: RepoEntry = { name: '.planning', kind: 'dir', isLink: false }

/** A user-level GSD install whose identity the host proved. */
const PROVEN_USER_INSTALL: GsdFact = {
  location: 'user',
  dir: '~/.claude/gsd-core',
  version: '1.16.0',
  identity: 'proven',
  runtimeIdentityTried: false,
}

/** What detection reports when GSD is neither in use nor installed. */
const NOT_FOUND: Detection = {
  id: 'gsd',
  name: 'GSD',
  status: 'not-found',
  version: null,
  evidence: ['no .planning/', 'no gsd-core install proven'],
}

describe('detectGsd', () => {
  test('a .planning/ directory at the repo root is in use, with the dir evidence', () => {
    expect(detectGsd(facts({ repoEntries: [PLANNING_DIR] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (dir)'],
    })
  })

  test('a .planning/ symlink is in use, with the symlink evidence', () => {
    const link: RepoEntry = { name: '.planning', kind: 'other', isLink: true }

    expect(detectGsd(facts({ repoEntries: [link] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: null,
      evidence: ['.planning/ (symlink)'],
    })
  })

  test('a plain file named .planning is not GSD in use', () => {
    const file: RepoEntry = { name: '.planning', kind: 'file', isLink: false }

    expect(detectGsd(facts({ repoEntries: [file] }))).toEqual(NOT_FOUND)
  })

  test('a proven user-level install alone is installed, with its version and dir as evidence', () => {
    expect(detectGsd(facts({ gsd: [PROVEN_USER_INSTALL] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'installed',
      version: '1.16.0',
      evidence: ['gsd-core 1.16.0 at ~/.claude/gsd-core'],
    })
  })

  test('in use beats installed: one detection carries both evidence strings', () => {
    expect(detectGsd(facts({ repoEntries: [PLANNING_DIR], gsd: [PROVEN_USER_INSTALL] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'in-use',
      version: '1.16.0',
      evidence: ['.planning/ (dir)', 'gsd-core 1.16.0 at ~/.claude/gsd-core'],
    })
  })

  test('a proven install with no readable version is installed, with version unknown in its evidence', () => {
    const noVersion: GsdFact = { ...PROVEN_USER_INSTALL, version: null }

    expect(detectGsd(facts({ gsd: [noVersion] }))).toEqual({
      id: 'gsd',
      name: 'GSD',
      status: 'installed',
      version: null,
      evidence: ['gsd-core (version unknown) at ~/.claude/gsd-core'],
    })
  })

  test('an install whose identity is unknown is never counted as installed', () => {
    const unknown: GsdFact = { ...PROVEN_USER_INSTALL, identity: 'unknown' }

    expect(detectGsd(facts({ gsd: [unknown] }))).toEqual(NOT_FOUND)
  })

  test('an install whose identity is absent is never counted as installed', () => {
    const absent: GsdFact = { ...PROVEN_USER_INSTALL, identity: 'absent' }

    expect(detectGsd(facts({ gsd: [absent] }))).toEqual(NOT_FOUND)
  })

  test('no .planning/ and no proven install is not-found, with both absence reasons', () => {
    expect(detectGsd(facts({}))).toEqual(NOT_FOUND)
  })
})

describe('gsdHookFacts', () => {
  test('registered role hooks come out in GSD_HOOK_NOTES order, with their notes', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-secret-read-guard.js', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'project' },
        { script: 'gsd-prompt-guard.js', event: 'UserPromptSubmit', source: 'user' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
      { name: 'gsd-secret-read-guard', note: 'useful for Security' },
    ])
  })

  test('a hook registered under several events or sources is listed once', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
        { script: 'gsd-context-monitor.js', event: 'Stop', source: 'project' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
    ])
  })

  test('the .sh and .cjs extensions match the same way as .js', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'gsd-workflow-guard.cjs', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-validate-commit.sh', event: 'PreToolUse', source: 'local' },
      ],
    })

    expect(gsdHookFacts(hooks).map(hook => hook.name)).toEqual(['gsd-validate-commit', 'gsd-workflow-guard'])
  })

  test('a name that only contains a hook name, or has another extension, is not matched', () => {
    const hooks = facts({
      hookScripts: [
        { script: 'mygsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
        { script: 'gsd-secret-read-guard.js.bak', event: 'PreToolUse', source: 'user' },
        { script: 'gsd-workflow-guard.ts', event: 'PreToolUse', source: 'user' },
      ],
    })

    expect(gsdHookFacts(hooks)).toEqual([])
  })

  test('GSD_HOOK_NOTES lists the four role hooks in order, with their notes', () => {
    expect(GSD_HOOK_NOTES).toEqual([
      { name: 'gsd-context-monitor', note: 'conflicts with the autopilot handoff' },
      { name: 'gsd-secret-read-guard', note: 'useful for Security' },
      {
        name: 'gsd-validate-commit',
        note: 'rejects non-Conventional commit messages when enabled (this repo uses (type): Subject)',
      },
      { name: 'gsd-workflow-guard', note: 'advisory nag when enabled' },
    ])
  })
})
