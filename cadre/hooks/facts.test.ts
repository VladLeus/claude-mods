import { describe, expect, test } from 'claude-code/testing'

import type { Facts, GsdReadTarget, RawFacts, RawGsdCandidate } from '../types'
import {
  clean,
  displayPath,
  factReadPlan,
  foldEnabledPlugins,
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
  runtimeIdentityArgv,
} from './facts'

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

/** A GSD candidate as the host read it: present, with nothing else read, unless overridden. */
function candidate(over: Partial<RawGsdCandidate>): RawGsdCandidate {
  return {
    location: 'user',
    dir: '/home/u/.claude/gsd-core',
    isPresent: true,
    versionText: null,
    identityText: null,
    manifest: null,
    runtimeStdout: null,
    runtimeTried: false,
    ...over,
  }
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

  test('the same raw read gives the same Facts twice, and the raw read is not changed', () => {
    const input = raw({ repoEntries: [{ name: 'src', kind: 'dir', size: 4, mtimeMs: 1, isLink: false }] })
    const before = JSON.stringify(input)
    const expected = emptyFacts({ repoEntries: [{ name: 'src', kind: 'dir', isLink: false }] })
    expect(normalizeFacts(input)).toEqual(expected)
    expect(normalizeFacts(input)).toEqual(expected)
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

  test('keeps a malformed key as written, and strips bidi and line-break characters from keys', () => {
    const value = { enabledPlugins: { 'superpowers@x.': true, 'tool\u202E@a\nb': false } }
    expect(parseEnabledPlugins(value, 'project')).toEqual([
      { key: 'superpowers@x.', source: 'project', value: true },
      { key: 'tool@ab', source: 'project', value: false },
    ])
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
  test('gives the key and the version only, and the install path is never returned', () => {
    const installed = parseInstalledPlugins({
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [{ scope: 'user', version: '6.4.1', installPath: '/Users/x' }],
      },
    })
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
    expect(JSON.stringify(installed)).not.toContain('installPath')
  })

  test('the first entry with a usable version wins, and an entry without one is skipped', () => {
    const installed = parseInstalledPlugins({
      version: 2,
      plugins: {
        'superpowers@claude-plugins-official': [
          { scope: 'user', version: 'latest' },
          { scope: 'project', version: '6.4.1' },
        ],
      },
    })
    expect(installed).toEqual([{ key: 'superpowers@claude-plugins-official', version: '6.4.1' }])
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

  test('the serialized Facts keep the hook basename and never carry the secret, the home path or the install path', () => {
    const serialized = JSON.stringify(normalizeFacts(raw({ settings, installedPlugins })))
    expect(serialized).toContain('gsd-context-monitor.js')
    expect(serialized).not.toContain(SENTINEL)
    expect(serialized).not.toContain('/Users/someone')
    expect(serialized).not.toContain('installPath')
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

  test('an unsafe CLAUDE_CONFIG_DIR is ignored, with a warning that names it, and home is used', () => {
    const plan = factReadPlan({ root: '/repo', home: '/home/u', configDir: 'rel/../x' })
    expect(plan.installedPluginsPath).toBe('/home/u/.claude/plugins/installed_plugins.json')
    expect(plan.gsd[0]).toEqual(USER_TARGET)
    expect(plan.warnings.join(' ')).toContain('CLAUDE_CONFIG_DIR')
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

  test('a bare mention of gsd-core, or no text at all, does not prove it', () => {
    expect(isGsdIdentitySource('gsd-core')).toBe(false)
    expect(isGsdIdentitySource(null)).toBe(false)
  })
})

describe('parseRuntimeIdentity', () => {
  test('stdout that opens with the GSD identity object gives its version', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core","version":"1.16.0"}')).toEqual({ version: '1.16.0' })
  })

  test('a decoy that names another package and only mentions GSD later is refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"get-shit-done-cc","note":"@opengsd/gsd-core"}')).toBeNull()
  })

  test('a package name that merely starts with the GSD name is refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core-evil","version":"1.0.0"}')).toBeNull()
  })

  test('output that is not complete JSON, and no output at all, are refused', () => {
    expect(parseRuntimeIdentity('{"packageName":"@opengsd/gsd-core"')).toBeNull()
    expect(parseRuntimeIdentity(null)).toBeNull()
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
    expect(runtimeIdentityArgv(USER_TARGET, null, true)).toEqual([
      'node',
      '/home/u/.claude/gsd-core/bin/gsd-tools.cjs',
      'runtime-identity',
      '--raw',
    ])
  })

  test('a repo-local install never gets a runtime call, even when present and unproven (D-28)', () => {
    expect(runtimeIdentityArgv(PROJECT_TARGET, null, true)).toBeNull()
  })

  test('a user install that its identity module already proves gets no runtime call', () => {
    expect(runtimeIdentityArgv(USER_TARGET, 'const packageName = "@opengsd/gsd-core";', true)).toBeNull()
  })

  test('an absent user install gets no runtime call', () => {
    expect(runtimeIdentityArgv(USER_TARGET, null, false)).toBeNull()
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
})

describe('normalizeFacts with GSD candidates', () => {
  test('a user install that its identity module proves is listed by display path, with its VERSION', () => {
    const facts = normalizeFacts(
      raw({
        gsd: [candidate({ identityText: 'const packageName = "@opengsd/gsd-core";', versionText: ' 1.16.0\n' })],
      }),
    )
    expect(facts.gsd).toEqual([
      { location: 'user', dir: '~/.claude/gsd-core', version: '1.16.0', identity: 'proven', runtimeIdentityTried: false },
    ])
    expect(facts.warnings).toEqual([])
  })

  test('a present install that nothing proves is unknown with a warning, never absent', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({ location: 'project', dir: '/repo/.claude/gsd-core' })] }))
    expect(facts.gsd).toEqual([
      { location: 'project', dir: '<repo>/.claude/gsd-core', version: null, identity: 'unknown', runtimeIdentityTried: false },
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

  test('the manifest is the version ahead of the runtime identity, and the runtime identity proves a user install', () => {
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
      { location: 'user', dir: '~/.claude/gsd-core', version: '1.15.0', identity: 'proven', runtimeIdentityTried: true },
    ])
  })

  test('with no VERSION and no manifest, the runtime identity supplies the version', () => {
    const facts = normalizeFacts(
      raw({
        gsd: [candidate({ runtimeStdout: '{"packageName":"@opengsd/gsd-core","version":"1.14.0"}', runtimeTried: true })],
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

  test('the serialized Facts never carry the home folder or the repo root', () => {
    const facts = normalizeFacts(raw({ gsd: [candidate({})], warnings: ['read failed at /repo/.claude/x'] }))
    const serialized = JSON.stringify(facts)
    expect(serialized).toContain('~/.claude/gsd-core')
    expect(serialized).not.toContain('/home/u')
    expect(serialized).not.toContain('/repo/')
  })
})
