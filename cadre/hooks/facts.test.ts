import { describe, expect, test } from 'claude-code/testing'

import type { Facts, RawFacts, RawGsdCandidate } from '../types'
import { isChangedByClean } from './core/text'
import {
  detectRefusal,
  FILE_SYSTEM_ROOT_REPLY,
  hiddenNameWarnings,
  HOME_ROOT_REPLY,
  homeRootRefusal,
  normalizeFacts,
  parseRepoEntries,
} from './facts'
import type { ProbedGsdCandidate } from './framework/gsd/identity'

/** A value planted in settings env and in a hook command; it must never reach Facts. */
const SENTINEL = 'SENTINEL_SECRET_123'

/** A GSD candidate as register.tsx reads it: present, nothing else read, no runtime problem, unless overridden. */
function candidate(over: Partial<ProbedGsdCandidate>): ProbedGsdCandidate {
  return {
    location: 'user',
    dir: '/home/u/.claude/gsd-core',
    isPresent: true,
    versionText: null,
    identityText: null,
    manifest: null,
    runtimeStdout: null,
    runtimeTried: false,
    runtimeProblem: null,
    ...over,
  }
}

/**
 * Candidates as a host could send them, parsed from JSON: no field is trusted until normalizeFacts checks it (WR-05).
 * Array.isArray narrows the parsed value, so no cast is needed to hand it over.
 */
function hostileCandidates(json: string): RawGsdCandidate[] {
  const parsed: unknown = JSON.parse(json)
  const items: unknown[] = Array.isArray(parsed) ? parsed : []

  return items.filter(isUncheckedHostItem)
}

/**
 * Deliberately unsound: claims every parsed item is a RawGsdCandidate so hostile shapes reach normalizeFacts;
 * usableCandidate is what checks them.
 */
function isUncheckedHostItem(item: unknown): item is RawGsdCandidate {
  return item !== undefined
}

/** normalizeFacts with the config dir unset and the root as given equal to the resolved root, unless told otherwise. */
function normalizeWith(input: RawFacts, configDir: string | null = null, givenRoot: string = input.root): Facts {
  return normalizeFacts(input, configDir, givenRoot)
}

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

  test('a name longer than 255 code points is dropped, because clean would cut it (WR-03 decision)', () => {
    const entries = parseRepoEntries([
      { name: 'n'.repeat(256), kind: 'file', isLink: false },
      { name: 'src', kind: 'dir', isLink: false },
    ])
    expect(entries).toEqual([{ name: 'src', kind: 'dir', isLink: false }])
  })

  test('a name of exactly 255 code points is kept whole', () => {
    expect(parseRepoEntries([{ name: 'n'.repeat(255), kind: 'file', isLink: false }])[0]?.name).toBe('n'.repeat(255))
  })

  test('a value that is not an array gives no entries', () => {
    expect(parseRepoEntries(null)).toEqual([])
    expect(parseRepoEntries('x')).toEqual([])
  })
})

describe('names that clean would change (WR-03)', () => {
  test('a name with a zero-width, bidi or line-break character is changed by clean', () => {
    expect(isChangedByClean('.planning\u200B', 255)).toBe(true)
    expect(isChangedByClean('_bmad\u2060', 255)).toBe(true)
    expect(isChangedByClean('a\nb', 255)).toBe(true)
  })

  test('a name over the cap is changed by clean, and a plain name at the cap is not', () => {
    expect(isChangedByClean('n'.repeat(256), 255)).toBe(true)
    expect(isChangedByClean('n'.repeat(255), 255)).toBe(false)
    expect(isChangedByClean('.planning', 255)).toBe(false)
  })

  test('a listing entry whose name has hidden characters is dropped, so it can never be a marker', () => {
    expect(
      parseRepoEntries([
        { name: '.planning\u200B', kind: 'dir', isLink: false },
        { name: 'src', kind: 'dir', isLink: false },
      ]),
    ).toEqual([{ name: 'src', kind: 'dir', isLink: false }])
  })

  test('normalizeFacts drops faked markers and plugin keys and warns with their cleaned names', () => {
    const facts = normalizeWith(
      raw({
        repoEntries: [
          { name: '.planning\u200B', kind: 'dir', isLink: false },
          { name: '_bmad\u2060', kind: 'dir', isLink: false },
        ],
        docsEntries: [{ name: 'super\u200Dpowers', kind: 'dir', isLink: false }],
        settings: [{ source: 'user', value: { enabledPlugins: { 'super\u200Bpowers@evil': true } } }],
      }),
    )
    expect(facts.repoEntries).toEqual([])
    expect(facts.docsEntries).toEqual([])
    expect(facts.enabledPlugins).toEqual([])
    expect(facts.warnings).toEqual([
      'ignored repo entry ".planning": its name has hidden characters or is too long',
      'ignored repo entry "_bmad": its name has hidden characters or is too long',
      'ignored docs/ entry "superpowers": its name has hidden characters or is too long',
      'ignored enabledPlugins key "superpowers@evil": its name has hidden characters or is too long',
    ])
  })

  test('a repo entry over 255 code points is dropped with the same warning, its name capped at 60', () => {
    const facts = normalizeWith(raw({ repoEntries: [{ name: 'n'.repeat(256), kind: 'dir', isLink: false }] }))
    expect(facts.repoEntries).toEqual([])
    expect(facts.warnings).toEqual([
      `ignored repo entry "${'n'.repeat(59)}\u2026": its name has hidden characters or is too long`,
    ])
  })

  test('at most five changed names are named per kind, and the rest are counted', () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map(name => `${name}\u200B`)
    const warnings = hiddenNameWarnings(names, 'repo entry', 255)
    expect(warnings).toHaveLength(6)
    expect(warnings[5]).toBe('ignored 2 more repo entry names that have hidden characters or are too long')
  })

  test('the same changed name given twice is warned about once', () => {
    const warnings = hiddenNameWarnings(['a\u200B', 'a\u200B', 'b\u200B'], 'repo entry', 255)
    expect(warnings).toHaveLength(2)
  })

  test('the same changed enabledPlugins key in user and project settings warns once', () => {
    const value = { enabledPlugins: { 'super\u200Bpowers@evil': true } }
    const facts = normalizeWith(
      raw({ settings: [{ source: 'user', value }, { source: 'project', value }] }),
    )
    expect(facts.warnings).toEqual([
      'ignored enabledPlugins key "superpowers@evil": its name has hidden characters or is too long',
    ])
  })

  test('a changed name in a warning is cleaned and capped at 60 code points', () => {
    const [warning] = hiddenNameWarnings([`${'x'.repeat(100)}\u200B`], 'repo entry', 255)
    expect(warning).toBe(`ignored repo entry "${'x'.repeat(59)}\u2026": its name has hidden characters or is too long`)
    expect(String(warning)).not.toContain('\u200B')
  })
})

describe('normalizeFacts', () => {
  test('an empty raw read gives Facts with every list empty and no warnings', () => {
    expect(normalizeWith(raw({}))).toEqual(emptyFacts({}))
  })

  test('repo and docs listings become typed entries, and warnings are cleaned', () => {
    const facts = normalizeWith(
      raw({
        repoEntries: [{ name: '.planning', kind: 'other', size: 0, mtimeMs: 0, isLink: true }],
        docsEntries: [{ name: 'guide.md', kind: 'file', isLink: false }],
        warnings: ['could not list docs\u202E'],
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

  test('the raw read is not changed by normalisation', () => {
    const input = raw({ repoEntries: [{ name: 'src', kind: 'dir', size: 4, mtimeMs: 1, isLink: false }] })
    const before = JSON.stringify(input)
    expect(normalizeWith(input)).toEqual(emptyFacts({ repoEntries: [{ name: 'src', kind: 'dir', isLink: false }] }))
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('normalizeFacts with settings and plugins', () => {
  const settings: RawFacts['settings'] = [
    { source: 'local', value: { enabledPlugins: { 'tool@y': true } } },
    {
      source: 'user',
      value: {
        enabledPlugins: { 'superpowers@claude-plugins-official': true, 'gsd@x': true },
        env: { TOKEN: SENTINEL },
        hooks: {
          PostToolUse: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `"/Users/someone/.claude/hooks/gsd-context-monitor.js" --token ${SENTINEL}`,
                },
              ],
            },
          ],
        },
      },
    },
    {
      source: 'project',
      value: {
        enabledPlugins: { 'gsd@x': false },
        hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node /repo/.claude/hooks/gsd-statusline.cjs' }] }] },
      },
    },
  ]
  const installedPlugins = {
    version: 2,
    plugins: {
      'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.4.1', installPath: '/Users/x' }],
      'gsd@x': [{ scope: 'user', version: '1.0.0' }],
    },
  }

  test('folds flags in user, project, local order and keeps only superpowers versions', () => {
    expect(normalizeWith(raw({ settings, installedPlugins }))).toEqual(
      emptyFacts({
        enabledPlugins: [
          { key: 'superpowers@claude-plugins-official', source: 'user', value: true },
          { key: 'gsd@x', source: 'project', value: false },
          { key: 'tool@y', source: 'local', value: true },
        ],
        hookScripts: [
          { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
          { script: 'gsd-statusline.cjs', event: 'Stop', source: 'project' },
        ],
        superpowersVersions: [{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }],
      }),
    )
  })

  test('the serialized Facts keep the hook basename and none of the secret, home path or install path', () => {
    const serialized = JSON.stringify(normalizeWith(raw({ settings, installedPlugins })))
    expect(serialized).toContain('gsd-context-monitor.js')
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('/Users/someone')
    expect(serialized).not.toContain('installPath')
  })

  test("the installed version is picked for this repo's root, never another project's (WR-04)", () => {
    const facts = normalizeWith(
      raw({
        installedPlugins: {
          plugins: {
            'superpowers@x': [
              { scope: 'project', projectPath: '/other', version: '9.9.9' },
              { scope: 'local', projectPath: '/repo', version: '6.4.1' },
            ],
          },
        },
      }),
    )
    expect(facts.superpowersVersions).toEqual([{ key: 'superpowers@x', version: '6.4.1' }])
  })
})

describe('normalizeFacts with GSD candidates', () => {
  test('a user install that its identity module proves is listed by display path, with its VERSION', () => {
    const facts = normalizeWith(
      raw({
        gsd: [candidate({ identityText: 'const packageName = "@opengsd/gsd-core";', versionText: ' 1.16.0\n' })],
      }),
    )
    expect(facts.gsd).toEqual([
      {
        location: 'user',
        dir: '~/.claude/gsd-core',
        version: '1.16.0',
        identity: 'proven',
        runtimeIdentityTried: false,
      },
    ])
    expect(facts.warnings).toEqual([])
  })

  test('a present install that nothing proves is unknown with a warning, never absent', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ location: 'project', dir: '/repo/.claude/gsd-core' })] }))
    expect(facts.gsd).toEqual([
      {
        location: 'project',
        dir: '<repo>/.claude/gsd-core',
        version: null,
        identity: 'unknown',
        runtimeIdentityTried: false,
      },
    ])
    expect(facts.warnings).toEqual(['could not prove the GSD install at <repo>/.claude/gsd-core (treated as unknown)'])
  })

  test('an install that is not present is absent, with no warning', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ isPresent: false })] }))
    expect(facts.gsd).toEqual([
      { location: 'user', dir: '~/.claude/gsd-core', version: null, identity: 'absent', runtimeIdentityTried: false },
    ])
    expect(facts.warnings).toEqual([])
  })

  test('the VERSION text is the version when there is one, ahead of the manifest', () => {
    const facts = normalizeWith(
      raw({
        gsd: [
          candidate({
            location: 'project',
            dir: '/repo/.claude/gsd-core',
            versionText: '1.16.0',
            manifest: { manifestVersion: 2, version: '1.15.0', files: {} },
          }),
        ],
      }),
    )
    expect(facts.gsd.map(install => install.version)).toEqual(['1.16.0'])
  })

  test('the manifest outranks the runtime identity, which still proves a user install', () => {
    const facts = normalizeWith(
      raw({
        gsd: [
          candidate({
            manifest: { manifestVersion: 2, version: '1.15.0', files: {} },
            runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.14.0"}',
            runtimeTried: true,
          }),
        ],
      }),
    )
    expect(facts.gsd).toEqual([
      {
        location: 'user',
        dir: '~/.claude/gsd-core',
        version: '1.15.0',
        identity: 'proven',
        runtimeIdentityTried: true,
      },
    ])
  })

  test('with no VERSION and no manifest, the runtime identity supplies the version', () => {
    const facts = normalizeWith(
      raw({
        gsd: [
          candidate({ runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.14.0"}', runtimeTried: true }),
        ],
      }),
    )
    expect(facts.gsd.map(install => install.version)).toEqual(['1.14.0'])
  })

  test('a host warning that names the home folder or the repo root shows the display form instead', () => {
    const facts = normalizeWith(
      raw({ warnings: ['could not read /home/u/.claude/settings.json', 'could not list /repo/docs'] }),
    )
    expect(facts.warnings).toEqual(['could not read ~/.claude/settings.json', 'could not list <repo>/docs'])
  })

  test('a host warning longer than 240 code points is cut to 240, the ellipsis counted', () => {
    const facts = normalizeWith(raw({ warnings: ['w'.repeat(300)] }))
    expect(Array.from(facts.warnings[0] ?? '')).toHaveLength(240)
    expect(facts.warnings[0]?.endsWith('\u2026')).toBe(true)
  })

  test('the home folder inside a longer path is not masked as the repo root, and the repo path keeps its form', () => {
    const facts = normalizeWith(raw({ warnings: ['bad /home/u/repo/file', 'bad /repo-other/x'] }))
    expect(facts.warnings).toEqual(['bad ~/repo/file', 'bad /repo-other/x'])
  })

  test('a path before a full stop is masked, while a longer name after the dot is not', () => {
    const facts = normalizeWith(
      raw({ warnings: ['could not list /repo.', 'at /repo. Next', 'at /home/u.', '/repo.bak /repo..x'] }),
    )
    expect(facts.warnings).toEqual(['could not list <repo>.', 'at <repo>. Next', 'at ~.', '/repo.bak /repo..x'])
  })

  test('a root given with a trailing slash still masks paths under it', () => {
    const facts = normalizeWith(raw({ root: '/repo/', warnings: ['bad /repo/a'] }))
    expect(facts.warnings).toEqual(['bad <repo>/a'])
  })

  test('a display path is cleaned, so a bidi character in a candidate dir does not reach Facts', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ dir: '/home/u/.claude/gsd\u202E-core' })] }))
    expect(facts.gsd[0]?.dir).toBe('~/.claude/gsd-core')
    expect(facts.warnings.join(' ')).not.toContain('\u202E')
    expect(facts.warnings).toEqual(['could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)'])
  })

  test('a candidate with a non-string dir is skipped without throwing', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ dir: 42 as never }), candidate({ isPresent: false })] }))
    expect(facts.gsd.map(install => install.identity)).toEqual(['absent'])
  })

  test('a candidate with an unknown location is skipped', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ location: 'elsewhere' as never })] }))
    expect(facts.gsd).toEqual([])
  })

  test('a user install whose runtime is not built says so in its warning (WR-01)', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ runtimeProblem: 'not-built' })] }))
    expect(facts.gsd[0]?.identity).toBe('unknown')
    expect(facts.warnings).toEqual([
      'could not prove the GSD install at ~/.claude/gsd-core: runtime not built (treated as unknown)',
    ])
  })

  test('a user install whose identity call could not run says so in one generic warning (IN-05)', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({ runtimeProblem: 'could-not-run', runtimeTried: true })] }))
    expect(facts.warnings).toEqual([
      'could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run ' +
        '(node missing or timed out); treated as unknown',
    ])
  })

  test('a candidate isPresent that is not exactly true counts as absent (WR-05)', () => {
    const gsd = hostileCandidates('[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":"no"}]')
    const facts = normalizeWith(raw({ gsd }))
    expect(facts.gsd[0]?.identity).toBe('absent')
    expect(facts.warnings).toEqual([])
  })

  test('an identityText that is not a string never proves an install (WR-05)', () => {
    const json =
      '[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":true,' +
      '"identityText":["const packageName = \\"@opengsd/gsd-core\\";"]}]'
    const facts = normalizeWith(raw({ gsd: hostileCandidates(json) }))
    expect(facts.gsd[0]?.identity).toBe('unknown')
  })

  test('runtimeTried, versionText, runtimeStdout and runtimeProblem of the wrong type are dropped (WR-05)', () => {
    const json =
      '[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":true,"runtimeTried":"yes",' +
      '"versionText":1.16,"runtimeStdout":{"packageName":"@opengsd/gsd-core"},"runtimeProblem":"bogus"}]'
    const facts = normalizeWith(raw({ gsd: hostileCandidates(json) }))
    expect(facts.gsd).toEqual([
      { location: 'user', dir: '~/.claude/gsd-core', version: null, identity: 'unknown', runtimeIdentityTried: false },
    ])
    expect(facts.warnings).toEqual(['could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)'])
  })

  test('a candidate under a CLAUDE_CONFIG_DIR outside home shows as $CLAUDE_CONFIG_DIR, never the path (IN-03)', () => {
    const facts = normalizeWith(
      raw({
        gsd: [candidate({ dir: '/opt/claude/gsd-core' })],
        warnings: ['could not read /opt/claude/gsd-core/VERSION (treated as unknown)'],
      }),
      '/opt/claude',
    )
    expect(facts.gsd[0]?.dir).toBe('$CLAUDE_CONFIG_DIR/gsd-core')
    expect(facts.warnings).toEqual([
      'could not read $CLAUDE_CONFIG_DIR/gsd-core/VERSION (treated as unknown)',
      'could not prove the GSD install at $CLAUDE_CONFIG_DIR/gsd-core (treated as unknown)',
    ])
    expect(JSON.stringify(facts)).not.toContain('/opt/claude')
  })

  test('the serialized Facts never carry the home folder or the repo root', () => {
    const facts = normalizeWith(raw({ gsd: [candidate({})], warnings: ['read failed at /repo/.claude/x'] }))
    const serialized = JSON.stringify(facts)
    expect(serialized).toContain('~/.claude/gsd-core')
    expect(serialized).not.toContain('/home/u')
    expect(serialized).not.toContain('/repo/')
  })
})

describe('homeRootRefusal', () => {
  test('a root equal to the home folder gets the reply', () => {
    expect(homeRootRefusal('/Users/u', '/Users/u')).toBe(HOME_ROOT_REPLY)
  })

  test('a root that contains the home folder gets the reply', () => {
    expect(homeRootRefusal('/Users', '/Users/u')).toBe(HOME_ROOT_REPLY)
  })

  test('a root inside the home folder, or one that only shares a prefix, gets none', () => {
    expect(homeRootRefusal('/Users/u/repo', '/Users/u')).toBeNull()
    expect(homeRootRefusal('/Users/u2', '/Users/u')).toBeNull()
  })

  test('no home folder, or an empty one, gets none', () => {
    expect(homeRootRefusal('/Users/u', null)).toBeNull()
    expect(homeRootRefusal('/Users/u', '')).toBeNull()
  })

  test('trailing slashes on either path are ignored', () => {
    expect(homeRootRefusal('/Users/u/', '/Users/u')).toBe(HOME_ROOT_REPLY)
    expect(homeRootRefusal('/Users', '/Users/u/')).toBe(HOME_ROOT_REPLY)
    expect(homeRootRefusal('/Users/u/repo/', '/Users/u/')).toBeNull()
  })
})

describe('detectRefusal (WR-06)', () => {
  test('a root of / or one that trims to empty is refused, whatever HOME is', () => {
    expect(detectRefusal(['/'], [null])).toBe(FILE_SYSTEM_ROOT_REPLY)
    expect(detectRefusal(['/repo', '//'], ['/home/u'])).toBe(FILE_SYSTEM_ROOT_REPLY)
    expect(detectRefusal([''], [])).toBe(FILE_SYSTEM_ROOT_REPLY)
  })

  test('a root used as given still meets a home that was resolved', () => {
    expect(detectRefusal(['/home/u/', '/home/u/'], ['/home/u', '/data/u'])).toBe(HOME_ROOT_REPLY)
  })

  test('a resolved root that lands on the resolved home is refused', () => {
    expect(detectRefusal(['/link/repo', '/data/u'], ['/home/u', '/data/u'])).toBe(HOME_ROOT_REPLY)
  })

  // Guard: passes before the fix by design; it proves the WR-06 check does not refuse a repo beside the home folder.
  test('a repo beside the home folder, or no usable home at all, is not refused', () => {
    expect(detectRefusal(['/repo', '/repo'], ['/home/u', '/home/u'])).toBeNull()
    expect(detectRefusal(['/repo', '/repo'], [null, null])).toBeNull()
  })
})
