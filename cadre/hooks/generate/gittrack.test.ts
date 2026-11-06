import { describe, expect, test } from 'claude-code/testing'

import type { InstructionPart } from '../../types'
import { BIDI_OVERRIDE, GLOBAL_ONLY_SENTENCE, NUL } from '../testkit'
import {
  GIT_TRACKING_UNKNOWN_WARNING,
  gitTrackedArgv,
  repoPartFiles,
  trackedFilesOf,
  trackedRepoParts,
  untrackedPartsWarning,
} from './gittrack'

/** An instruction part as the reader gives it, from the repo unless told otherwise; the hash is a fixed stand-in. */
function part(
  id: string,
  file: string,
  heading: string,
  text: string,
  source: InstructionPart['source'] = 'repo',
): InstructionPart {
  return { id, file, heading, source, text, hash: 'a'.repeat(64) }
}

/** The Rules section of the root CLAUDE.md, with the blank line before the next heading, as the reader keeps it. */
const RULES_PART = part('P2', 'CLAUDE.md', 'Rules', '# Rules\nRun the tests before a commit.\n\n')

/** The Secrets section of a rule file. */
const SECRETS_PART = part('P3', '.claude/rules/security.md', 'Secrets', '## Secrets\nKeep keys out of the repo.\n')

/** A part of the global CLAUDE.md, which never goes into a built role file (T-02-69). */
const GLOBAL_PART = part('P1', '~/.claude/CLAUDE.md', 'Private', `# Private\n${GLOBAL_ONLY_SENTENCE}.\n`, 'global')

/** A part of a rule file git does not track in the M3 cases. */
const LOCAL_PART = part('P4', 'notes/local.md', 'Local', '# Local\nMy own notes.\n')

/** The repo parts of two roles: be has the root CLAUDE.md, a rule file and the local note; qa has the rule file. */
const GIVEN_PARTS: ReadonlyMap<string, readonly InstructionPart[]> = new Map([
  ['be', [RULES_PART, SECRETS_PART, LOCAL_PART]],
  ['qa', [SECRETS_PART]],
  ['pm', []],
])

describe('repo parts git tracks (02-GAPS-B2 M3)', () => {
  test('gitTrackedArgv asks git ls-files for exactly these files, as literal paths, NUL-separated', () => {
    expect(gitTrackedArgv(['CLAUDE.md', 'notes/local.md'])).toEqual([
      'git',
      '--literal-pathspecs',
      'ls-files',
      '-z',
      '--',
      'CLAUDE.md',
      'notes/local.md',
    ])
  })

  test('repoPartFiles gives the file of every repo part once each, sorted; a global part is not asked about', () => {
    const withGlobal = new Map([...GIVEN_PARTS, ['security', [GLOBAL_PART]]])

    expect(repoPartFiles(withGlobal)).toEqual(['.claude/rules/security.md', 'CLAUDE.md', 'notes/local.md'])
    expect(repoPartFiles(new Map())).toEqual([])
  })

  test('trackedRepoParts keeps the parts of tracked files and drops the rest, with every key kept', () => {
    const tracked = trackedRepoParts(GIVEN_PARTS, new Set(['CLAUDE.md', '.claude/rules/security.md']))

    expect([...tracked.keys()]).toEqual(['be', 'qa', 'pm'])
    expect(tracked.get('be')).toEqual([RULES_PART, SECRETS_PART])
    expect(tracked.get('qa')).toEqual([SECRETS_PART])
    expect(tracked.get('pm')).toEqual([])
  })

  test('trackedRepoParts with no answer from git keeps no part at all, every key with an empty list', () => {
    const none = trackedRepoParts(GIVEN_PARTS, null)

    expect([...none.entries()]).toEqual([
      ['be', []],
      ['qa', []],
      ['pm', []],
    ])
  })

  test('trackedFilesOf reads the NUL-separated names git gives, an empty name skipped', () => {
    expect([...trackedFilesOf(`CLAUDE.md${NUL}notes/a b.md${NUL}`)]).toEqual(['CLAUDE.md', 'notes/a b.md'])
    expect([...trackedFilesOf('')]).toEqual([])
  })

  test('the untracked warning names the file, cleaned; the unknown warning says no repo part is written', () => {
    expect(untrackedPartsWarning('notes/local.md')).toBe(
      'notes/local.md is not tracked by git: its parts are not written to .cadre/',
    )
    expect(untrackedPartsWarning(`notes/a\nb${BIDI_OVERRIDE}.md`)).toBe(
      'notes/ab.md is not tracked by git: its parts are not written to .cadre/',
    )
    expect(GIT_TRACKING_UNKNOWN_WARNING).toBe(
      'could not ask git which instruction files it tracks: no repo part is written to .cadre/',
    )
  })
})
