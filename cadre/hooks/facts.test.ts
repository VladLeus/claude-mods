import { describe, expect, test } from 'claude-code/testing'

import type { Facts, RawFacts } from '../types'
import {
  clean,
  foldEnabledPlugins,
  normalizeFacts,
  parseEnabledPlugins,
  parseHookScripts,
  parseInstalledPlugins,
  parseRepoEntries,
} from './facts'

/** A value planted in settings env and in a hook command; it must never reach Facts. */
const SENTINEL = 'SENTINEL_SECRET_123'

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
    const value = { enabledPlugins: { 'superpowers@x.': true, 'tool‮@a\nb': false } }
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
