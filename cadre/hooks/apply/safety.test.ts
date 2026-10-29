import { describe, expect, test } from 'claude-code/testing'

import type { PortEntry, PortStat, WriteStat } from '../../types'
import { privateModeArgv } from '../host/steps'
import { MANIFEST_PATH } from '../plan/classify'
import {
  BIDI_OVERRIDE,
  entry,
  file,
  LAUNCHER,
  link,
  SECURITY_DIR,
  SECURITY_RECORD,
  SECURITY_TEXT_FILE,
  SLUG_DIR,
  text,
  TL_DIR,
} from '../testkit'
import type { ApplyStep, PrivateFile } from './private'
import {
  applyListPaths,
  applyStatPaths,
  chmodProblem,
  listedLinkProblem,
  privateCheckPaths,
  privateLevels,
  privateLevelsProblem,
  privateWriteProblem,
  roleFolderLevels,
  writeProblem,
} from './safety'
import type { PrivateWriteCheck } from './safety'

/** The role file of the BE role. */
const ROLE_MD = '.cadre/be/ROLE.md'

/** A stat as the host answers it with resolve: a file or a folder at its real path, a link when told so. */
function statAt(kind: PortStat['kind'], realPath: string, isLink = false): PortStat {
  return { kind, size: 0, isLink, realPath }
}

/** The stats of .cadre, .cadre/be and ROLE.md as real folders and a regular file inside /repo; `over` replaces some. */
function roleStats(over: Readonly<Record<string, WriteStat>> = {}): ReadonlyMap<string, WriteStat> {
  const stats: Record<string, WriteStat> = {
    '.cadre': statAt('dir', '/repo/.cadre'),
    '.cadre/be': statAt('dir', '/repo/.cadre/be'),
    [ROLE_MD]: statAt('file', '/repo/.cadre/be/ROLE.md'),
  }

  return new Map(Object.entries({ ...stats, ...over }))
}

/**
 * The listings of the root, .cadre and .cadre/be, each holding the next one down as a real folder and ROLE.md as a
 * regular file; `over` replaces some, null for a folder the host could not list.
 */
function roleListings(
  over: Readonly<Record<string, readonly PortEntry[] | null>> = {},
): ReadonlyMap<string, readonly PortEntry[] | null> {
  const listings: Record<string, readonly PortEntry[] | null> = {
    '': [entry('.cadre', 'dir')],
    '.cadre': [entry('be', 'dir')],
    '.cadre/be': [entry('ROLE.md')],
  }

  return new Map(Object.entries({ ...listings, ...over }))
}

/** The refusal of a write to ROLE.md when a folder lists it, or a folder above it, as a link (#72 A2). */
const ROLE_LISTED_LINK = 'refused to write .cadre/be/ROLE.md: it or a folder above it is listed as a link'

/** The refusal of a write to ROLE.md when a folder on its way is there but could not be listed (#72 A2). */
const ROLE_LIST_FAILED =
  'refused to write .cadre/be/ROLE.md: it or a folder above it could not be checked (a folder listing failed)'

/** The refusal of a write to ROLE.md. */
const ROLE_REFUSED = 'refused to write .cadre/be/ROLE.md: it or a folder above it is a link, or not inside the repo'

/** The refusal of a write to ROLE.md whose stat, or a folder above it, could not be checked (#44). */
const ROLE_STAT_FAILED =
  'refused to write .cadre/be/ROLE.md: it or a folder above it could not be checked (a stat failed)'

/** The refusal of a write to ROLE.md when ROLE.md is a real folder (A5). */
const ROLE_IS_FOLDER = 'refused to write .cadre/be/ROLE.md: it is a folder'

describe('write safety', () => {
  test('applyStatPaths lists every path a step names and each folder above it, sorted and once each', () => {
    const steps: ApplyStep[] = [
      { kind: 'write', path: ROLE_MD, text: 'x' },
      { kind: 'write', path: '.gitignore', text: 'x' },
      { kind: 'chmod', path: LAUNCHER },
    ]
    const launcherSteps: ApplyStep[] = [
      { kind: 'write', path: LAUNCHER, text: 'x' },
      { kind: 'chmod', path: LAUNCHER },
      { kind: 'manifest', path: MANIFEST_PATH, text: '{}\n' },
    ]

    expect(applyStatPaths(steps)).toEqual([
      '.cadre',
      '.cadre/be',
      '.cadre/be/ROLE.md',
      '.cadre/bin',
      '.cadre/bin/be',
      '.gitignore',
    ])
    expect(applyStatPaths(launcherSteps)).toEqual(['.cadre', '.cadre/bin', '.cadre/bin/be', MANIFEST_PATH])
    expect(applyStatPaths([])).toEqual([])
  })

  test('writeProblem lets a write through when nothing is there yet, or real folders and a file in the repo', () => {
    const none = new Map<string, WriteStat>([
      ['.cadre', 'absent'],
      ['.cadre/be', 'absent'],
      [ROLE_MD, 'absent'],
    ])
    const ignoreFile = new Map([['.gitignore', statAt('file', '/repo/.gitignore')]])

    expect(writeProblem(ROLE_MD, none, '/repo')).toBeNull()
    expect(writeProblem(ROLE_MD, roleStats(), '/repo')).toBeNull()
    expect(writeProblem(ROLE_MD, roleStats({ [ROLE_MD]: 'absent' }), '/repo')).toBeNull()
    expect(writeProblem('.gitignore', ignoreFile, '/repo')).toBeNull()
  })

  test(
    'writeProblem refuses a link above the file, a folder out of the repo, and a target link, with the link reason',
    () => {
      const refused = [
        roleStats({ '.cadre': statAt('dir', '/repo/.cadre', true) }),
        roleStats({ '.cadre/be': statAt('dir', '/elsewhere/be') }),
        roleStats({ '.cadre/be': statAt('file', '/repo/.cadre/be') }),
        roleStats({ '.cadre': statAt('dir', '/repo') }),
        roleStats({ '.cadre/be': { kind: 'dir', size: 0, isLink: false } }),
        roleStats({ [ROLE_MD]: statAt('file', '/repo/.cadre/be/ROLE.md', true) }),
        roleStats({ [ROLE_MD]: statAt('other', '/repo/.cadre/be/ROLE.md') }),
        roleStats({ [ROLE_MD]: statAt('file', '/elsewhere/ROLE.md') }),
        roleStats({ '.cadre': 'absent', '.cadre/be': statAt('dir', '/repo/.cadre/be', true), [ROLE_MD]: 'absent' }),
      ]

      expect(refused.map(stats => writeProblem(ROLE_MD, stats, '/repo'))).toEqual(refused.map(() => ROLE_REFUSED))
    },
  )

  test(
    'writeProblem refuses a target that is a real folder with the folder reason, unless a folder above is a link (A5)',
    () => {
      const folderStat = statAt('dir', '/repo/.cadre/be/ROLE.md')
      const linkedAbove = roleStats({ '.cadre': statAt('dir', '/repo/.cadre', true), [ROLE_MD]: folderStat })

      expect(writeProblem(ROLE_MD, roleStats({ [ROLE_MD]: folderStat }), '/repo')).toBe(ROLE_IS_FOLDER)
      expect(writeProblem(ROLE_MD, linkedAbove, '/repo')).toBe(ROLE_REFUSED)
    },
  )

  test(
    'writeProblem refuses a failed stat of the target or a folder above, and a path with no stat at all (D3, #44)',
    () => {
      const failed = [
        roleStats({ [ROLE_MD]: 'failed' }),
        roleStats({ '.cadre': 'failed' }),
        roleStats({ '.cadre/be': 'failed', [ROLE_MD]: 'absent' }),
        roleStats({ '.cadre': statAt('dir', '/repo/.cadre', true), [ROLE_MD]: 'failed' }),
        new Map<string, WriteStat>(),
        new Map<string, WriteStat>([
          ['.cadre', statAt('dir', '/repo/.cadre')],
          ['.cadre/be', statAt('dir', '/repo/.cadre/be')],
        ]),
      ]

      expect(failed.map(stats => writeProblem(ROLE_MD, stats, '/repo'))).toEqual(failed.map(() => ROLE_STAT_FAILED))
    },
  )

  test('writeProblem refuses a .gitignore link, and shows a path cleaned', () => {
    const ignoreLink = new Map([['.gitignore', statAt('file', '/repo/.gitignore', true)]])
    const hostile = `.cadre/a${BIDI_OVERRIDE}\nb`
    const hostileLink = new Map([
      ['.cadre', statAt('dir', '/repo/.cadre')],
      [hostile, statAt('file', '/elsewhere/x', true)],
    ])

    expect(writeProblem('.gitignore', ignoreLink, '/repo')).toBe(
      'refused to write .gitignore: it or a folder above it is a link, or not inside the repo',
    )
    expect(writeProblem(hostile, hostileLink, '/repo')).toBe(
      'refused to write .cadre/ab: it or a folder above it is a link, or not inside the repo',
    )
  })

  test('applyListPaths lists the root as the empty path and each folder above a step path, sorted, once each', () => {
    const steps: ApplyStep[] = [
      { kind: 'write', path: ROLE_MD, text: 'x' },
      { kind: 'write', path: '.gitignore', text: 'x' },
      { kind: 'write', path: LAUNCHER, text: 'x' },
      { kind: 'chmod', path: LAUNCHER },
    ]

    expect(applyListPaths(steps)).toEqual(['', '.cadre', '.cadre/be', '.cadre/bin'])
    expect(applyListPaths([])).toEqual([''])
  })

  test('listedLinkProblem refuses a write when a folder lists it, or a folder on its way, as a link (#72 A2)', () => {
    const absent = roleStats({ [ROLE_MD]: 'absent' })
    const refused = [
      roleListings({ '.cadre/be': [entry('kickoff.txt'), link('ROLE.md')] }),
      roleListings({ '.cadre': [link('be')] }),
      roleListings({ '': [entry('src', 'dir'), link('.cadre')] }),
      roleListings({ '': null, '.cadre/be': [link('ROLE.md')] }),
    ]
    const ignore = new Map<string, WriteStat>([['.gitignore', 'absent']])

    expect(refused.map(listings => listedLinkProblem(ROLE_MD, absent, listings))).toEqual(
      refused.map(() => ROLE_LISTED_LINK),
    )
    expect(listedLinkProblem('.gitignore', ignore, roleListings({ '': [link('.gitignore')] }))).toBe(
      'refused to write .gitignore: it or a folder above it is listed as a link',
    )
  })

  test('listedLinkProblem lets a write through when the listings show real entries, or a link of another name', () => {
    const other = roleListings({ '.cadre/be': [link('ROLE.md.bak'), entry('ROLE.md')] })

    expect(listedLinkProblem(ROLE_MD, roleStats(), roleListings())).toBeNull()
    expect(listedLinkProblem(ROLE_MD, roleStats({ [ROLE_MD]: 'absent' }), other)).toBeNull()
  })

  test(
    'listedLinkProblem refuses below a folder that is there but gave no listing; an absent one or the root does not',
    () => {
      const none = new Map<string, WriteStat>([
        ['.cadre', 'absent'],
        ['.cadre/be', 'absent'],
        [ROLE_MD, 'absent'],
      ])
      const hostile = `.cadre/a${BIDI_OVERRIDE}\nb`
      const hostileStats = new Map<string, WriteStat>([
        ['.cadre', statAt('dir', '/repo/.cadre')],
        [hostile, 'absent'],
      ])
      const hostileListings = roleListings({ '.cadre': [link(`a${BIDI_OVERRIDE}\nb`)] })

      expect(listedLinkProblem(ROLE_MD, roleStats(), roleListings({ '.cadre/be': null }))).toBe(ROLE_LIST_FAILED)
      expect(listedLinkProblem(ROLE_MD, roleStats(), new Map())).toBe(ROLE_LIST_FAILED)
      expect(listedLinkProblem(ROLE_MD, none, roleListings({ '.cadre': null, '.cadre/be': null }))).toBeNull()
      expect(listedLinkProblem(ROLE_MD, roleStats(), roleListings({ '': null }))).toBeNull()
      expect(listedLinkProblem(hostile, hostileStats, hostileListings)).toBe(
        'refused to write .cadre/ab: it or a folder above it is listed as a link',
      )
    },
  )

  test('chmodProblem allows a chmod only on a path whose write landed in this same apply', () => {
    const refusal = '.cadre/bin/be was not made executable: its write was refused or failed'

    expect(chmodProblem(LAUNCHER, new Set([LAUNCHER]))).toBeNull()
    expect(chmodProblem(LAUNCHER, new Set())).toBe(refusal)
    expect(chmodProblem(LAUNCHER, new Set(['.cadre/bin/pm']))).toBe(refusal)
    expect(chmodProblem(`.cadre/bin/a${BIDI_OVERRIDE}\nb`, new Set())).toBe(
      '.cadre/bin/ab was not made executable: its write was refused or failed',
    )
  })
})

/** The fixture user's config folder `<userDir>`: never a level of a role memory folder, only listed (02-GAPS-B3 S3). */
const USER_DIR = '/home/u/.claude'

/** The folder of every role memory folder of the fixture user: `<userDir>/cadre`. */
const CADRE_DIR = `${USER_DIR}/cadre`

/** Security's private text file with this text. */
const SECURITY_TEXT: PrivateFile = { path: SECURITY_TEXT_FILE, text: 'text\n' }

/** Security's hand-out record with this text. */
const SECURITY_RECORD_FILE: PrivateFile = { path: SECURITY_RECORD, text: '{}\n' }

/**
 * The check of a write outside the repo for the fixture user and repo, allowing Security's two private files only;
 * `stats` and `listings` default to a disk where the config folder lists nothing and no folder of cadre's is there
 * yet (02-GAPS-B3 S3).
 */
function privateCheck(over: Partial<PrivateWriteCheck> = {}): PrivateWriteCheck {
  return {
    allowed: new Set([SECURITY_TEXT_FILE, SECURITY_RECORD]),
    stats: new Map<string, WriteStat>([
      [CADRE_DIR, 'absent'],
      [SLUG_DIR, 'absent'],
      [SECURITY_DIR, 'absent'],
      [`${SECURITY_DIR}/instructions`, 'absent'],
      [SECURITY_TEXT_FILE, 'absent'],
      [SECURITY_RECORD, 'absent'],
    ]),
    listings: new Map<string, readonly PortEntry[] | null>([
      [USER_DIR, []],
      [CADRE_DIR, null],
      [SLUG_DIR, null],
      [SECURITY_DIR, null],
      [`${SECURITY_DIR}/instructions`, null],
    ]),
    locations: { home: '/home/u', root: '/repo', configDir: null },
    ...over,
  }
}

/**
 * The stats of `<userDir>/cadre`, the repo's folder, Security's role memory folder, its instructions/ subfolder and
 * both files as real folders and files.
 */
function privateStats(over: Readonly<Record<string, WriteStat>> = {}): ReadonlyMap<string, WriteStat> {
  const stats: Record<string, WriteStat> = {
    [CADRE_DIR]: statAt('dir', CADRE_DIR),
    [SLUG_DIR]: statAt('dir', SLUG_DIR),
    [SECURITY_DIR]: statAt('dir', SECURITY_DIR),
    [`${SECURITY_DIR}/instructions`]: statAt('dir', `${SECURITY_DIR}/instructions`),
    [SECURITY_TEXT_FILE]: statAt('file', SECURITY_TEXT_FILE),
    [SECURITY_RECORD]: statAt('file', SECURITY_RECORD),
  }

  return new Map(Object.entries({ ...stats, ...over }))
}

/**
 * The listings of the config folder, `<userDir>/cadre`, the repo folder, Security's role memory folder and its
 * instructions/ subfolder, all real entries.
 */
function privateListings(
  over: Readonly<Record<string, readonly PortEntry[] | null>> = {},
): ReadonlyMap<string, readonly PortEntry[] | null> {
  const listings: Record<string, readonly PortEntry[] | null> = {
    [USER_DIR]: [entry('cadre', 'dir'), entry('settings.json')],
    [CADRE_DIR]: [entry('repo-1a2b3c4d', 'dir')],
    [SLUG_DIR]: [entry('security', 'dir')],
    [SECURITY_DIR]: [entry('instructions', 'dir'), entry('instructions.json'), entry('notes.md')],
    [`${SECURITY_DIR}/instructions`]: [entry('CLAUDE.md')],
  }

  return new Map(Object.entries({ ...listings, ...over }))
}

/** How a refused write to Security's private text file starts: the path shown from the home folder. */
const TEXT_REFUSED = 'refused to write ~/.claude/cadre/repo-1a2b3c4d/security/instructions/CLAUDE.md: '

/** How a refused write to Security's record starts. */
const RECORD_REFUSED = 'refused to write ~/.claude/cadre/repo-1a2b3c4d/security/instructions.json: '

describe('private role files (G-02-1f)', () => {
  test('every level cadre makes is made private, its instructions/ subfolder only with a file in it (N13)', () => {
    expect(privateLevels(SECURITY_DIR, [SECURITY_TEXT, SECURITY_RECORD_FILE])).toEqual([
      '/home/u/.claude/cadre',
      SLUG_DIR,
      SECURITY_DIR,
      `${SECURITY_DIR}/instructions`,
    ])
    expect(privateLevels(SECURITY_DIR, [SECURITY_RECORD_FILE])).toEqual([
      '/home/u/.claude/cadre',
      SLUG_DIR,
      SECURITY_DIR,
    ])
    expect(privateModeArgv(SECURITY_DIR)).toEqual(['/bin/chmod', '700', SECURITY_DIR])
  })

  test('a private write stats each path from <userDir>/cadre down and lists each folder from <userDir> (S3)', () => {
    expect(privateCheckPaths(SECURITY_DIR, [SECURITY_TEXT, SECURITY_RECORD_FILE])).toEqual({
      stats: [CADRE_DIR, SLUG_DIR, SECURITY_DIR, `${SECURITY_DIR}/instructions`, SECURITY_TEXT_FILE, SECURITY_RECORD],
      listings: [USER_DIR, CADRE_DIR, SLUG_DIR, SECURITY_DIR, `${SECURITY_DIR}/instructions`],
    })
    expect(privateCheckPaths(SECURITY_DIR, [SECURITY_RECORD_FILE])).toEqual({
      stats: [CADRE_DIR, SLUG_DIR, SECURITY_DIR, SECURITY_RECORD],
      listings: [USER_DIR, CADRE_DIR, SLUG_DIR, SECURITY_DIR],
    })
  })

  test('the levels of a role memory folder, from the top: <userDir>/cadre down to instructions/ (S3, S7, C5)', () => {
    expect(roleFolderLevels(SECURITY_DIR)).toEqual([CADRE_DIR, SLUG_DIR, SECURITY_DIR, `${SECURITY_DIR}/instructions`])
    expect(roleFolderLevels(SECURITY_DIR)).not.toContain(USER_DIR)
  })

  test('a link at <userDir>/cadre or the repo folder refuses every private write; <userDir> must list (S3)', () => {
    const listedAs = (over: Readonly<Record<string, readonly PortEntry[] | null>>): PrivateWriteCheck =>
      privateCheck({ stats: privateStats(), listings: privateListings(over) })
    const linked = 'it or a folder above it is listed as a link'
    const listing = 'it or a folder above it could not be checked (a folder listing failed)'
    const both = [SECURITY_TEXT_FILE, SECURITY_RECORD]
    const cadreLink = listedAs({ [USER_DIR]: [link('cadre')] })
    const repoLink = listedAs({ [CADRE_DIR]: [link('repo-1a2b3c4d')] })
    const unlisted = privateCheck({ listings: new Map([[USER_DIR, null]]) })

    expect(both.map(path => privateWriteProblem(path, cadreLink))).toEqual([
      `${TEXT_REFUSED}${linked}`,
      `${RECORD_REFUSED}${linked}`,
    ])
    expect(both.map(path => privateWriteProblem(path, repoLink))).toEqual([
      `${TEXT_REFUSED}${linked}`,
      `${RECORD_REFUSED}${linked}`,
    ])
    expect(both.map(path => privateWriteProblem(path, unlisted))).toEqual([
      `${TEXT_REFUSED}${listing}`,
      `${RECORD_REFUSED}${listing}`,
    ])
    expect(both.map(path => privateWriteProblem(path, listedAs({ [USER_DIR]: [link('settings.json')] })))).toEqual([
      null,
      null,
    ])
  })

  test('a write outside the repo that is not a private file of a confirmed role is refused (T-02-72)', () => {
    const outside = 'outside the repo and the role memory folders'

    expect(privateWriteProblem('/home/u/.ssh/authorized_keys', privateCheck())).toBe(
      `refused to write ~/.ssh/authorized_keys: ${outside}`,
    )
    expect(privateWriteProblem(`${TL_DIR}/instructions.json`, privateCheck())).toBe(
      `refused to write ~/.claude/cadre/repo-1a2b3c4d/tl/instructions.json: ${outside}`,
    )
    expect(privateWriteProblem(`${SECURITY_DIR}/notes.md`, privateCheck())).toBe(
      `refused to write ~/.claude/cadre/repo-1a2b3c4d/security/notes.md: ${outside}`,
    )
    expect(privateWriteProblem(`/etc/pass${BIDI_OVERRIDE}\nwd`, privateCheck())).toBe(
      `refused to write /etc/passwd: ${outside}`,
    )
  })

  test('a private file is let through when nothing is there yet, or real folders and files are on its way', () => {
    const real = privateCheck({ stats: privateStats(), listings: privateListings() })

    expect([SECURITY_TEXT_FILE, SECURITY_RECORD].map(path => privateWriteProblem(path, privateCheck()))).toEqual([
      null,
      null,
    ])
    expect([SECURITY_TEXT_FILE, SECURITY_RECORD].map(path => privateWriteProblem(path, real))).toEqual([null, null])
  })

  test('a private file is refused when a folder lists it or its way as a link, only below that link (#72 A2)', () => {
    const listedAs = (over: Readonly<Record<string, readonly PortEntry[] | null>>): PrivateWriteCheck =>
      privateCheck({ stats: privateStats(), listings: privateListings(over) })
    const linked = 'it or a folder above it is listed as a link'
    const folderLink = listedAs({ [SECURITY_DIR]: [link('instructions'), entry('instructions.json')] })
    const roleLink = listedAs({ [SLUG_DIR]: [link('security')] })

    expect(privateWriteProblem(SECURITY_TEXT_FILE, folderLink)).toBe(`${TEXT_REFUSED}${linked}`)
    expect(privateWriteProblem(SECURITY_RECORD, folderLink)).toBeNull()
    const fileLink = listedAs({ [`${SECURITY_DIR}/instructions`]: [link('CLAUDE.md')] })
    expect(privateWriteProblem(SECURITY_TEXT_FILE, fileLink)).toBe(`${TEXT_REFUSED}${linked}`)
    expect(privateWriteProblem(SECURITY_RECORD, listedAs({ [SECURITY_DIR]: [link('instructions.json')] }))).toBe(
      `${RECORD_REFUSED}${linked}`,
    )
    expect([SECURITY_TEXT_FILE, SECURITY_RECORD].map(path => privateWriteProblem(path, roleLink))).toEqual([
      `${TEXT_REFUSED}${linked}`,
      `${RECORD_REFUSED}${linked}`,
    ])
  })

  test('a private file is refused when a stat or a listing on its way failed, or when it is a folder', () => {
    const stat = 'it or a folder above it could not be checked (a stat failed)'
    const listing = 'it or a folder above it could not be checked (a folder listing failed)'
    const failedStat = privateCheck({ stats: privateStats({ [SECURITY_DIR]: 'failed' }), listings: privateListings() })
    const noStat = privateCheck({ stats: new Map(), listings: privateListings() })
    const unlisted = privateCheck({ stats: privateStats(), listings: privateListings({ [SECURITY_DIR]: null }) })
    const folder = privateCheck({
      stats: privateStats({ [SECURITY_TEXT_FILE]: statAt('dir', SECURITY_TEXT_FILE) }),
      listings: privateListings(),
    })

    expect(privateWriteProblem(SECURITY_RECORD, failedStat)).toBe(`${RECORD_REFUSED}${stat}`)
    expect(privateWriteProblem(SECURITY_TEXT_FILE, noStat)).toBe(`${TEXT_REFUSED}${stat}`)
    expect(privateWriteProblem(SECURITY_RECORD, unlisted)).toBe(`${RECORD_REFUSED}${listing}`)
    expect(privateWriteProblem(SECURITY_TEXT_FILE, folder)).toBe(`${TEXT_REFUSED}it is a folder`)
  })

  test('applyStatPaths and applyListPaths name no path of a private step: apply checks those on its own', () => {
    const steps: ApplyStep[] = [
      { kind: 'write', path: ROLE_MD, text: 'x' },
      { kind: 'private', path: SECURITY_DIR, files: [SECURITY_TEXT, SECURITY_RECORD_FILE] },
    ]

    expect(applyStatPaths(steps)).toEqual(['.cadre', '.cadre/be', ROLE_MD])
    expect(applyListPaths(steps)).toEqual(['', '.cadre', '.cadre/be'])
  })
})

/** The levels of Security's role memory folder, from the top (roleFolderLevels). */
const SECURITY_LEVELS: readonly string[] = [CADRE_DIR, SLUG_DIR, SECURITY_DIR, `${SECURITY_DIR}/instructions`]

/** The stats /cadre start takes of SECURITY_LEVELS, each a real folder; `over` replaces some, null for absent. */
function levelStats(over: Readonly<Record<string, PortStat | null>> = {}): ReadonlyMap<string, PortStat | null> {
  const stats = Object.fromEntries(SECURITY_LEVELS.map(level => [level, statAt('dir', level)]))

  return new Map(Object.entries({ ...stats, ...over }))
}

/** The listings /cadre start takes: `<userDir>` and each level but the last, all real entries; `over` replaces some. */
function levelListings(
  over: Readonly<Record<string, readonly PortEntry[] | null>> = {},
): ReadonlyMap<string, readonly PortEntry[] | null> {
  const listings: Record<string, readonly PortEntry[] | null> = {
    [USER_DIR]: [entry('cadre', 'dir')],
    [CADRE_DIR]: [entry('repo-1a2b3c4d', 'dir')],
    [SLUG_DIR]: [entry('security', 'dir')],
    [SECURITY_DIR]: [entry('instructions', 'dir'), entry('instructions.json')],
  }

  return new Map(Object.entries({ ...listings, ...over }))
}

describe('private folder levels (02-GAPS-B3 C5)', () => {
  test('real folders on every level, or levels not there yet, give no problem', () => {
    const none = Object.fromEntries(SECURITY_LEVELS.map(level => [level, null]))
    const below = { [SECURITY_DIR]: null, [`${SECURITY_DIR}/instructions`]: null }

    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(), levelListings())).toBeNull()
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(none), new Map([[USER_DIR, null]]))).toBeNull()
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(below), levelListings({ [SLUG_DIR]: null }))).toBeNull()
  })

  test('a level that is a link by its stat or by its parent listing is the problem, from the top', () => {
    const byStat = levelStats({ [SECURITY_DIR]: statAt('dir', '/elsewhere', true) })
    const byListing = levelListings({ [USER_DIR]: [link('cadre')] })
    const both = levelListings({ [USER_DIR]: [link('cadre')], [SLUG_DIR]: [link('security')] })

    expect(privateLevelsProblem(SECURITY_LEVELS, byStat, levelListings())).toEqual({
      path: SECURITY_DIR,
      reason: 'link',
    })
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(), byListing)).toEqual({ path: CADRE_DIR, reason: 'link' })
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(), both)).toEqual({ path: CADRE_DIR, reason: 'link' })
  })

  test('a level that is not a folder, or whose parent could not be listed, is the problem', () => {
    const instructions = `${SECURITY_DIR}/instructions`
    const file = levelStats({ [instructions]: statAt('file', instructions) })

    expect(privateLevelsProblem(SECURITY_LEVELS, file, levelListings())).toEqual({
      path: instructions,
      reason: 'not-folder',
    })
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(), levelListings({ [SLUG_DIR]: null }))).toEqual({
      path: SECURITY_DIR,
      reason: 'unchecked',
    })
    expect(privateLevelsProblem(SECURITY_LEVELS, levelStats(), new Map())).toEqual({
      path: CADRE_DIR,
      reason: 'unchecked',
    })
  })
})
