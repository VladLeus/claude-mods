import { describe, expect, test } from 'claude-code/testing'

import type { Facts, GsdReadTarget, RawFacts, RawGsdCandidate } from '../types'
import {
  clean,
  detectRefusal,
  displayPath,
  factReadPlan,
  FILE_SYSTEM_ROOT_REPLY,
  foldEnabledPlugins,
  hiddenNameWarnings,
  HOME_ROOT_REPLY,
  homeRootRefusal,
  isFileInsideRoot,
  isRuntimeCallAllowed,
  isChangedByClean,
  isGsdIdentitySource,
  isSafeConfigDir,
  normalizeFacts,
  parseEnabledPlugins,
  parseGsdManifest,
  parseHookScripts,
  parseInstalledPlugins,
  parseRepoEntries,
  parseRuntimeIdentity,
  parseVersionText,
  resolvedPath,
  runtimeBuiltPath,
  runtimeIdentityArgv,
  runtimeSkipProblem,
} from './facts'
import type { ProbedGsdCandidate } from './facts'

/** A value planted in settings env and in a hook command; it must never reach Facts. */
const SENTINEL = 'SENTINEL_SECRET_123'

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

  return items.filter(isAnyHostItem)
}

/** Lets every parsed item through, so wrongly typed fields reach normalizeFacts. */
function isAnyHostItem(item: unknown): item is RawGsdCandidate {
  return item !== undefined
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

describe('clean', () => {
  test('removes bidi and line-break characters, joining the text around them', () => {
    expect(clean('a\u202Eb\nc')).toBe('abc')
  })

  test('a value that is not a string becomes the empty string', () => {
    expect(clean(42)).toBe('')
  })

  test('a longer value is cut to the cap, with an ellipsis as the last character', () => {
    expect(clean('x'.repeat(200), 10)).toBe(`${'x'.repeat(9)}\u2026`)
  })

  test('a value exactly at the cap is returned unchanged', () => {
    expect(clean('x'.repeat(10), 10)).toBe('x'.repeat(10))
  })

  test('a cap below 1 gives the empty string', () => {
    expect(clean('abc', 0)).toBe('')
  })

  test('lone surrogates and private-use characters are stripped', () => {
    expect(clean('a\uD800b\uE000c')).toBe('abc')
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
    const facts = normalizeFacts(
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
    const facts = normalizeFacts(raw({ repoEntries: [{ name: 'n'.repeat(256), kind: 'dir', isLink: false }] }))
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
    const facts = normalizeFacts(
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
    expect(normalizeFacts(raw({}))).toEqual(emptyFacts({}))
  })

  test('repo and docs listings become typed entries, and warnings are cleaned', () => {
    const facts = normalizeFacts(
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
    expect(normalizeFacts(input)).toEqual(emptyFacts({ repoEntries: [{ name: 'src', kind: 'dir', isLink: false }] }))
    expect(JSON.stringify(input)).toBe(before)
  })
})

describe('parseEnabledPlugins', () => {
  test('keeps boolean flags only, each with the settings source it came from', () => {
    const value = {
      enabledPlugins: { 'superpowers@claude-plugins-official': true, 'x@y': 'yes' },
      env: { K: SENTINEL },
    }
    expect(parseEnabledPlugins(value, 'user')).toEqual([
      { key: 'superpowers@claude-plugins-official', source: 'user', value: true },
    ])
  })

  test('keeps a malformed key as written, and drops a key with bidi or line-break characters (WR-03)', () => {
    const value = { enabledPlugins: { 'superpowers@x.': true, 'tool\u202E@a\nb': false } }
    expect(parseEnabledPlugins(value, 'project')).toEqual([
      { key: 'superpowers@x.', source: 'project', value: true },
    ])
  })

  test('a key longer than 120 code points is dropped, and a key of exactly 120 is kept (WR-03 decision)', () => {
    const value = { enabledPlugins: { [`${'k'.repeat(121)}`]: true, [`${'j'.repeat(120)}`]: true } }
    const keys = parseEnabledPlugins(value, 'user').map(flag => flag.key)
    expect(keys).toEqual(['j'.repeat(120)])
  })

  test('gives no flags for null, for an array, or for an object without enabledPlugins', () => {
    expect(parseEnabledPlugins(null, 'user')).toEqual([])
    expect(parseEnabledPlugins([{ enabledPlugins: { 'a@b': true } }], 'user')).toEqual([])
    expect(parseEnabledPlugins({ other: { 'a@b': true } }, 'user')).toEqual([])
  })
})

describe('foldEnabledPlugins', () => {
  test('a later source replaces the value and the source of an earlier flag, keeping the first position', () => {
    expect(
      foldEnabledPlugins([
        { key: 'a@b', source: 'user', value: true },
        { key: 'c@d', source: 'user', value: true },
        { key: 'a@b', source: 'project', value: false },
      ]),
    ).toEqual([
      { key: 'a@b', source: 'project', value: false },
      { key: 'c@d', source: 'user', value: true },
    ])
  })
})

describe('parseHookScripts', () => {
  test('keeps only the basename of a gsd- script, with the event and the source', () => {
    const value = {
      hooks: {
        PostToolUse: [
          { hooks: [{ type: 'command', command: '"$(x)" "/Users/someone/.claude/hooks/gsd-context-monitor.js"' }] },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([
      { script: 'gsd-context-monitor.js', event: 'PostToolUse', source: 'user' },
    ])
  })

  test('keeps the .sh and .cjs script forms as well as .js', () => {
    const value = {
      hooks: {
        Stop: [{ hooks: [{ command: 'bash "/x/gsd-check.sh"' }, { command: 'node /x/gsd-tools.cjs' }] }],
      },
    }
    expect(parseHookScripts(value, 'local')).toEqual([
      { script: 'gsd-check.sh', event: 'Stop', source: 'local' },
      { script: 'gsd-tools.cjs', event: 'Stop', source: 'local' },
    ])
  })

  test('a command with no gsd- script gives nothing, and neither does a name that only contains gsd-', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [
              { command: 'node /Users/someone/hooks/other.js' },
              { command: 'node /x/mygsd-helper.js' },
              { command: 'node /x/gsd-helper.js.bak' },
            ],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([])
  })

  test('a basename with an 80-character stem is reported and one with an 81-character stem is not', () => {
    const value = {
      hooks: {
        Stop: [
          {
            hooks: [{ command: `node /x/gsd-${'a'.repeat(80)}.js` }, { command: `node /x/gsd-${'b'.repeat(81)}.js` }],
          },
        ],
      },
    }
    expect(parseHookScripts(value, 'user').map(hook => hook.script)).toEqual([`gsd-${'a'.repeat(80)}.js`])
  })

  test('an event name longer than 60 code points is cut to 60 with an ellipsis', () => {
    const value = { hooks: { [`${'e'.repeat(61)}`]: [{ hooks: [{ command: 'node /x/gsd-x.js' }] }] } }
    expect(parseHookScripts(value, 'user')[0]?.event).toBe(`${'e'.repeat(59)}\u2026`)
  })

  test('a script named twice for the same event and source appears once', () => {
    const value = {
      hooks: {
        PostToolUse: [
          { hooks: [{ command: 'node /a/gsd-x.js' }, { command: 'node /b/gsd-x.js' }] },
          { hooks: [{ command: 'node /a/gsd-x.js' }] },
        ],
      },
    }
    expect(parseHookScripts(value, 'user')).toEqual([{ script: 'gsd-x.js', event: 'PostToolUse', source: 'user' }])
  })
})

describe('parseInstalledPlugins', () => {
  test('a key longer than 120 code points is dropped (WR-03 decision)', () => {
    const installed = parseInstalledPlugins(
      { plugins: { [`${'k'.repeat(121)}`]: [{ scope: 'user', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  test('gives the key and the version only, and the install path is never returned', () => {
    const installed = parseInstalledPlugins(
      {
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.4.1', installPath: '/Users/x' }],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
    expect(JSON.stringify(installed)).not.toContain('installPath')
  })

  test('the first entry with a usable version wins, and an entry without one is skipped', () => {
    const installed = parseInstalledPlugins(
      {
        version: 2,
        plugins: {
          'superpowers@claude-plugins-official': [
            { scope: 'user', version: 'latest' },
            { scope: 'project', projectPath: '/repo', version: '6.4.1' },
          ],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
  })

  test('a user entry wins over an earlier project entry for the same repo (WR-04)', () => {
    const installed = parseInstalledPlugins(
      {
        plugins: {
          'superpowers@x': [
            { scope: 'project', projectPath: '/repo', version: '1.0.0' },
            { scope: 'user', version: '2.0.0' },
          ],
        },
      },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@x', version: '2.0.0' }])
  })

  test("another project's entry is ignored, so its version never shows for this repo (WR-04)", () => {
    const installed = parseInstalledPlugins(
      { plugins: { 'superpowers@x': [{ scope: 'project', projectPath: '/other', version: '9.9.9' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  // Guard: passes before the fix by design; it proves the WR-04 scoping keeps this repo's local entry.
  test('a local entry whose projectPath is the repo root counts, trailing slashes ignored (WR-04)', () => {
    const installed = parseInstalledPlugins(
      { plugins: { 'superpowers@x': [{ scope: 'local', projectPath: '/repo/', version: '3.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([{ key: 'superpowers@x', version: '3.0.0' }])
  })

  test('a project entry whose projectPath is the root as given counts when the resolved root differs', () => {
    const value = { plugins: { 'superpowers@x': [{ scope: 'project', projectPath: '/tmp/repo', version: '4.0.0' }] } }
    expect(parseInstalledPlugins(value, '/private/tmp/repo', '/tmp/repo')).toEqual([
      { key: 'superpowers@x', version: '4.0.0' },
    ])
    expect(parseInstalledPlugins(value, '/private/tmp/repo')).toEqual([])
  })

  test('a root that trims to nothing never matches an entry, as given or as resolved', () => {
    const value = { plugins: { 'a@b': [{ scope: 'project', projectPath: '/', version: '1.0.0' }] } }
    expect(parseInstalledPlugins(value, '/', '//')).toEqual([])
  })

  test('an entry with no scope or an unknown scope is ignored (WR-04)', () => {
    const installed = parseInstalledPlugins(
      { plugins: { 'a@b': [{ version: '1.0.0' }], 'c@d': [{ scope: 'managed', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
  })

  test('a key with hidden characters is dropped (WR-03)', () => {
    const installed = parseInstalledPlugins(
      { plugins: { 'superpowers@x\u200B': [{ scope: 'user', version: '1.0.0' }] } },
      '/repo',
    )
    expect(installed).toEqual([])
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
    expect(normalizeFacts(raw({ settings, installedPlugins }))).toEqual(
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
    const serialized = JSON.stringify(normalizeFacts(raw({ settings, installedPlugins })))
    expect(serialized).toContain('gsd-context-monitor.js')
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('/Users/someone')
    expect(serialized).not.toContain('installPath')
  })

  test("the installed version is picked for this repo's root, never another project's (WR-04)", () => {
    const facts = normalizeFacts(
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

describe('isSafeConfigDir', () => {
  test('an absolute path with no .. segment is safe', () => {
    expect(isSafeConfigDir('/opt/claude')).toBe(true)
  })

  test('a relative path, a path with a .. segment, an empty value and a missing value are not', () => {
    expect(isSafeConfigDir('relative')).toBe(false)
    expect(isSafeConfigDir('/a/../b')).toBe(false)
    expect(isSafeConfigDir('')).toBe(false)
    expect(isSafeConfigDir(null)).toBe(false)
  })

  test('an empty or . segment is not safe', () => {
    expect(isSafeConfigDir('/./repo/x')).toBe(false)
    expect(isSafeConfigDir('//repo/x')).toBe(false)
    expect(isSafeConfigDir('/opt/claude/')).toBe(false)
    expect(isSafeConfigDir('/')).toBe(false)
  })
})

describe('factReadPlan', () => {
  test('without CLAUDE_CONFIG_DIR the user install is under home, and the repo has its own copy', () => {
    expect(factReadPlan({ root: '/repo', home: '/home/u', configDir: null })).toEqual({
      installedPluginsPath: '/home/u/.claude/plugins/installed_plugins.json',
      gsd: [USER_TARGET, PROJECT_TARGET],
      warnings: [],
    })
  })

  test('CLAUDE_CONFIG_DIR replaces the home .claude folder for the plugins file and the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/opt/claude' })
    expect(plan.installedPluginsPath).toBe('/opt/claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.gsd[0]?.manifestPath).toBe('/opt/claude/gsd-file-manifest.json')
    expect(plan.gsd[1]).toEqual(PROJECT_TARGET)
    expect(plan.warnings).toEqual([])
  })

  test('an unsafe CLAUDE_CONFIG_DIR is ignored, with a warning that repeats nothing, and home is used', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: 'rel/../x' })
    expect(plan.installedPluginsPath).toBe('/home/u/.claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
    expect(plan.warnings.join(' ')).not.toContain('rel/../x')
  })

  test('a CLAUDE_CONFIG_DIR inside the repo is ignored, so the repo cannot host the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo/.claude-config' })
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
  })

  test('with no home folder, a safe CLAUDE_CONFIG_DIR alone gives the user install', () => {
    const plan = factReadPlan({ root: '/repo', home: null, configDir: '/opt/claude' })
    expect(plan.installedPluginsPath).toBe('/opt/claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.gsd[0]?.manifestPath).toBe('/opt/claude/gsd-file-manifest.json')
  })

  test('with neither home nor CLAUDE_CONFIG_DIR only the repo copy is read, and a warning says so', () => {
    const plan = factReadPlan({ root: '/repo', home: null, configDir: null })
    expect(plan.installedPluginsPath).toBeNull()
    expect(plan.gsd).toEqual([PROJECT_TARGET])
    expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
  })

  test('a CLAUDE_CONFIG_DIR that only shares a text prefix with the root is accepted', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo-cfg' })
    expect(plan.gsd[0]?.dir).toBe('/repo-cfg/gsd-core')
    expect(plan.warnings).toEqual([])
  })

  test('a root with a trailing slash behaves like the root without it', () => {
    expect(factReadPlan({ root: '/repo/', home: '/home/u', configDir: '/repo-cfg' })).toEqual(
      factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo-cfg' }),
    )
    expect(factReadPlan({ root: '/repo/', home: '/home/u', configDir: '/repo/cfg' }).gsd[0]).toEqual(USER_TARGET)
  })

  test('a home folder and a CLAUDE_CONFIG_DIR with a trailing slash behave like the ones without it', () => {
    expect(factReadPlan({ root: '/repo', home: '/home/u/', configDir: null }).gsd[0]).toEqual(USER_TARGET)
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/opt/claude/' })
    expect(plan.gsd[0]?.dir).toBe('/opt/claude/gsd-core')
    expect(plan.warnings).toEqual([])
  })

  test('a CLAUDE_CONFIG_DIR equal to the root is ignored, with the warning', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: '/repo' })
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
  })

  test('a CLAUDE_CONFIG_DIR with an empty or . segment is ignored, with the warning', () => {
    for (const configDir of ['/./repo/x', '//repo/x']) {
      const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir })
      expect(plan.gsd[0]).toEqual(USER_TARGET)
      expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
    }
  })

  test('a home folder with a .. segment, a relative home and a root home give no user folder', () => {
    for (const home of ['/a/../repo', 'foo', '/']) {
      const plan = factReadPlan({ root: '/repo', home, configDir: null })
      expect(plan.installedPluginsPath).toBeNull()
      expect(plan.gsd.map(target => target.location)).toEqual(['project'])
      expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
    }
  })

  test('a home folder that lies inside the repo is not read as the user install', () => {
    const plan = factReadPlan({ root: '/home/u', home: '/home/u', configDir: null })
    expect(plan.gsd.map(target => target.location)).toEqual(['project'])
    expect(plan.warnings.join(' ')).toContain('user-level installs were not checked')
  })
})

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

describe('displayPath', () => {
  test('a path under home reads as ~, and a path under the repo root reads as <repo>', () => {
    expect(displayPath('/home/u/.claude/gsd-core', '/home/u', '/repo')).toBe('~/.claude/gsd-core')
    expect(displayPath('/repo/.claude/gsd-core', '/home/u', '/repo')).toBe('<repo>/.claude/gsd-core')
  })

  test('a sibling that only shares a text prefix with the root is not under the root', () => {
    expect(displayPath('/repository/x', '/home/u', '/repo')).toBe('/repository/x')
  })

  test('the repo root is checked before home, so a repo inside home reads as <repo>', () => {
    expect(displayPath('/home/u/work/repo/.claude', '/home/u', '/home/u/work/repo')).toBe('<repo>/.claude')
  })

  test('a path under a CLAUDE_CONFIG_DIR outside home reads as $CLAUDE_CONFIG_DIR (IN-03)', () => {
    expect(displayPath('/opt/claude/gsd-core', '/home/u', '/repo', '/opt/claude/')).toBe('$CLAUDE_CONFIG_DIR/gsd-core')
  })

  test('home is checked before the config dir, and an unsafe config dir is never used', () => {
    expect(displayPath('/home/u/.alt/gsd-core', '/home/u', '/repo', '/home/u/.alt')).toBe('~/.alt/gsd-core')
    expect(displayPath('/opt/../x/gsd-core', '/home/u', '/repo', '/opt/../x')).toBe('/opt/../x/gsd-core')
  })
})

describe('normalizeFacts with GSD candidates', () => {
  test('a user install that its identity module proves is listed by display path, with its VERSION', () => {
    const facts = normalizeFacts(
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
    const facts = normalizeFacts(raw({ gsd: [candidate({ location: 'project', dir: '/repo/.claude/gsd-core' })] }))
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
    const facts = normalizeFacts(raw({ gsd: [candidate({ isPresent: false })] }))
    expect(facts.gsd).toEqual([
      { location: 'user', dir: '~/.claude/gsd-core', version: null, identity: 'absent', runtimeIdentityTried: false },
    ])
    expect(facts.warnings).toEqual([])
  })

  test('the VERSION text is the version when there is one, ahead of the manifest', () => {
    const facts = normalizeFacts(
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
    const facts = normalizeFacts(
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
    const facts = normalizeFacts(
      raw({
        gsd: [
          candidate({ runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.14.0"}', runtimeTried: true }),
        ],
      }),
    )
    expect(facts.gsd.map(install => install.version)).toEqual(['1.14.0'])
  })

  test('a host warning that names the home folder or the repo root shows the display form instead', () => {
    const facts = normalizeFacts(
      raw({ warnings: ['could not read /home/u/.claude/settings.json', 'could not list /repo/docs'] }),
    )
    expect(facts.warnings).toEqual(['could not read ~/.claude/settings.json', 'could not list <repo>/docs'])
  })

  test('a host warning longer than 240 code points is cut to 240, the ellipsis counted', () => {
    const facts = normalizeFacts(raw({ warnings: ['w'.repeat(300)] }))
    expect(Array.from(facts.warnings[0] ?? '')).toHaveLength(240)
    expect(facts.warnings[0]?.endsWith('\u2026')).toBe(true)
  })

  test('the home folder inside a longer path is not masked as the repo root, and the repo path keeps its form', () => {
    const facts = normalizeFacts(raw({ warnings: ['bad /home/u/repo/file', 'bad /repo-other/x'] }))
    expect(facts.warnings).toEqual(['bad ~/repo/file', 'bad /repo-other/x'])
  })

  test('a path before a full stop is masked, while a longer name after the dot is not', () => {
    const facts = normalizeFacts(
      raw({ warnings: ['could not list /repo.', 'at /repo. Next', 'at /home/u.', '/repo.bak /repo..x'] }),
    )
    expect(facts.warnings).toEqual(['could not list <repo>.', 'at <repo>. Next', 'at ~.', '/repo.bak /repo..x'])
  })

  test('a root given with a trailing slash still masks paths under it', () => {
    const facts = normalizeFacts(raw({ root: '/repo/', warnings: ['bad /repo/a'] }))
    expect(facts.warnings).toEqual(['bad <repo>/a'])
  })

  test('a display path is cleaned, so a bidi character in a candidate dir does not reach Facts', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ dir: '/home/u/.claude/gsd\u202E-core' })] }))
    expect(facts.gsd[0]?.dir).toBe('~/.claude/gsd-core')
    expect(facts.warnings.join(' ')).not.toContain('\u202E')
    expect(facts.warnings).toEqual(['could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)'])
  })

  test('a candidate with a non-string dir is skipped without throwing', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ dir: 42 as never }), candidate({ isPresent: false })] }))
    expect(facts.gsd.map(install => install.identity)).toEqual(['absent'])
  })

  test('a candidate with an unknown location is skipped', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ location: 'elsewhere' as never })] }))
    expect(facts.gsd).toEqual([])
  })

  test('a user install whose runtime is not built says so in its warning (WR-01)', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ runtimeProblem: 'not-built' })] }))
    expect(facts.gsd[0]?.identity).toBe('unknown')
    expect(facts.warnings).toEqual([
      'could not prove the GSD install at ~/.claude/gsd-core: runtime not built (treated as unknown)',
    ])
  })

  test('a user install whose identity call could not run says so in one generic warning (IN-05)', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ runtimeProblem: 'could-not-run', runtimeTried: true })] }))
    expect(facts.warnings).toEqual([
      'could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run ' +
        '(node missing or timed out); treated as unknown',
    ])
  })

  test('a candidate isPresent that is not exactly true counts as absent (WR-05)', () => {
    const gsd = hostileCandidates('[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":"no"}]')
    const facts = normalizeFacts(raw({ gsd }))
    expect(facts.gsd[0]?.identity).toBe('absent')
    expect(facts.warnings).toEqual([])
  })

  test('an identityText that is not a string never proves an install (WR-05)', () => {
    const json =
      '[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":true,' +
      '"identityText":["const packageName = \\"@opengsd/gsd-core\\";"]}]'
    const facts = normalizeFacts(raw({ gsd: hostileCandidates(json) }))
    expect(facts.gsd[0]?.identity).toBe('unknown')
  })

  test('runtimeTried, versionText, runtimeStdout and runtimeProblem of the wrong type are dropped (WR-05)', () => {
    const json =
      '[{"location":"user","dir":"/home/u/.claude/gsd-core","isPresent":true,"runtimeTried":"yes",' +
      '"versionText":1.16,"runtimeStdout":{"packageName":"@opengsd/gsd-core"},"runtimeProblem":"bogus"}]'
    const facts = normalizeFacts(raw({ gsd: hostileCandidates(json) }))
    expect(facts.gsd).toEqual([
      { location: 'user', dir: '~/.claude/gsd-core', version: null, identity: 'unknown', runtimeIdentityTried: false },
    ])
    expect(facts.warnings).toEqual(['could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)'])
  })

  test('a candidate under a CLAUDE_CONFIG_DIR outside home shows as $CLAUDE_CONFIG_DIR, never the path (IN-03)', () => {
    const facts = normalizeFacts(
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
    const facts = normalizeFacts(raw({ gsd: [candidate({})], warnings: ['read failed at /repo/.claude/x'] }))
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

describe('resolvedPath', () => {
  test('uses the place a path lands when the host answered it', () => {
    expect(resolvedPath('/link/repo', '/repo', 'the repo root')).toEqual({ path: '/repo', warning: null })
  })

  test('uses the path as given, with a warning, when the host gave no realPath', () => {
    expect(resolvedPath('/link/repo', undefined, 'the repo root')).toEqual({
      path: '/link/repo',
      warning: 'could not resolve the repo root (used as given)',
    })
  })

  test('treats an empty realPath as no answer', () => {
    const resolved = resolvedPath('/home/u', '', 'the home folder')
    expect(resolved.path).toBe('/home/u')
    expect(resolved.warning).toBe('could not resolve the home folder (used as given)')
  })

  test('the warning names the role of the path and never the path itself', () => {
    const resolved = resolvedPath('/Users/someone/repo', undefined, 'the repo root')
    expect(String(resolved.warning)).toContain('could not resolve the repo root')
    expect(String(resolved.warning)).not.toContain('/Users/someone')
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

describe('isFileInsideRoot (WR-02)', () => {
  test('a regular file whose real path is inside the root counts', () => {
    expect(isFileInsideRoot({ kind: 'file', realPath: '/repo/.claude/gsd-core/VERSION' }, '/repo')).toBe(true)
  })

  test('a file whose real path is outside the root does not, nor one beside it that shares a prefix', () => {
    expect(isFileInsideRoot({ kind: 'file', realPath: '/home/u/.ssh/id_ed25519' }, '/repo')).toBe(false)
    expect(isFileInsideRoot({ kind: 'file', realPath: '/repo-other/VERSION' }, '/repo')).toBe(false)
  })

  test('a device, a FIFO or a folder (any kind but file) does not count', () => {
    expect(isFileInsideRoot({ kind: 'other', realPath: '/repo/.claude/gsd-core/VERSION' }, '/repo')).toBe(false)
    expect(isFileInsideRoot({ kind: 'dir', realPath: '/repo/.claude/gsd-core/VERSION' }, '/repo')).toBe(false)
  })

  // Guard: passes before the fix by design; it proves a stat that shows no file inside the root is refused.
  test('a stat with no realPath, one on the root itself, or no stat at all does not count', () => {
    expect(isFileInsideRoot({ kind: 'file' }, '/repo')).toBe(false)
    expect(isFileInsideRoot({ kind: 'file', realPath: '/repo' }, '/repo')).toBe(false)
    expect(isFileInsideRoot(undefined, '/repo')).toBe(false)
  })
})
