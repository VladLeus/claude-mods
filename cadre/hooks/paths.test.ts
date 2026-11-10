import { describe, expect, test } from 'claude-code/testing'

import { sha256Hex } from './core/hash'
import { t } from './locales/t'
import { inboxLogPath, sessionFilePath } from './messages/record'
import {
  cadreStatePath,
  claudeJsonPathOf,
  displayPath,
  handoffFolderOf,
  INBOX_ARCHIVE_GLOB,
  inboxArchiveFile,
  inboxDirOf,
  INBOX_FILE,
  inboxFolderLevels,
  inboxHomeOf,
  INBOX_LOG_FILE,
  inboxRootKey,
  INBOX_TREE,
  inboxTreeOf,
  isFileInsideRoot,
  isSafeConfigDir,
  isSafeRelativePath,
  launcherPath,
  markdownFileNames,
  memoryFolderOf,
  memoryFoldersOf,
  pathFromDisplay,
  projectFolderOf,
  relativeTo,
  resolvedPath,
  RUNTIME_RENDERED,
  runtimeDirOf,
  runtimeFileOf,
  screenPath,
  SESSION_FILE,
  trimSlash,
} from './paths'
import { BACKSLASH, BIDI_OVERRIDE, DEFAULT_LOCATIONS, entry } from './testkit'

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

describe('safety net: trimSlash (A8)', () => {
  test('trimSlash drops every trailing slash, gives an empty string for the root and keeps null', () => {
    const trimmed = [trimSlash('/repo/'), trimSlash('/repo//'), trimSlash('/repo'), trimSlash('/'), trimSlash(null)]
    expect(trimmed).toEqual(['/repo', '/repo', '/repo', '', null])
  })
})

describe('safety net: relativeTo (A8)', () => {
  test('relativeTo: empty for the base, /rest below it, null outside it or for a null, empty or root base', () => {
    expect([relativeTo('/repo', '/repo/'), relativeTo('/repo/a/b.md', '/repo')]).toEqual(['', '/a/b.md'])
    expect(relativeTo('/repository/a', '/repo')).toBe(null)
    expect([relativeTo('/a', null), relativeTo('/a', ''), relativeTo('/a', '/')]).toEqual([null, null, null])
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

describe('projectFolderOf', () => {
  test('projectFolderOf: <userDir>/projects/<the root mangled>, with the user folder as given (no trim)', () => {
    expect(projectFolderOf('/home/u/.claude', '/repo')).toBe('/home/u/.claude/projects/-repo')
    expect(projectFolderOf('/cfg/', '/a b')).toBe('/cfg//projects/-a-b')
  })
})

describe('screenPath (D-226)', () => {
  test('a leading <repo> shows the folder name of the root; another form, or <repo> inside a pattern, stays', () => {
    expect(screenPath('<repo>/CLAUDE.md', '/home/u/code/trainual')).toBe('trainual/CLAUDE.md')
    expect(screenPath('<repo>', '/home/u/code/trainual/')).toBe('trainual')
    expect(screenPath('~/.claude/CLAUDE.md', '/repo')).toBe('~/.claude/CLAUDE.md')
    expect(screenPath('<config dir>/cadre/<repo>-<hash8>/', '/repo')).toBe('<config dir>/cadre/<repo>-<hash8>/')
    expect(screenPath('<repository>/x', '/repo')).toBe('<repository>/x')
  })

  test('with a root of /, <repo>/CLAUDE.md reads /CLAUDE.md and a bare <repo> reads / (ASKED #21)', () => {
    expect([screenPath('<repo>/CLAUDE.md', '/'), screenPath('<repo>', '/')]).toEqual(['/CLAUDE.md', '/'])
  })

  test('the folder name is cleaned as any shown value', () => {
    expect(screenPath('<repo>/CLAUDE.md', `/home/u/re${BIDI_OVERRIDE}po`)).toBe('repo/CLAUDE.md')
  })

  test('#34: a folder name that cleans to nothing keeps the <repo> mask; only a root of / reads / (D-272)', () => {
    expect(screenPath('<repo>/x', '/')).toBe('/x')
    expect(screenPath('<repo>/x', `/home/u/${BIDI_OVERRIDE}`)).toBe('<repo>/x')
    expect(screenPath('<repo>', `/home/u/${BIDI_OVERRIDE}/`)).toBe('<repo>')
  })
})

describe('memoryFoldersOf (D-238)', () => {
  test('a relative or inside-repo CLAUDE_CONFIG_DIR gives the memory folder under <home>/.claude', () => {
    for (const configDir of ['.claude-alt', '/repo/.claude-alt']) {
      expect(memoryFoldersOf({ ...DEFAULT_LOCATIONS, configDir })).toEqual(['/home/u/.claude/projects/-repo/memory'])
    }
  })
})

describe('claudeJsonPathOf (D-238, SR-1)', () => {
  test('an unsafe CLAUDE_CONFIG_DIR gives <home>/.claude.json and the warning; a safe one gives its own file', () => {
    const roots = ['/repo', '/main']
    const unsafe = ['.claude-alt', '/cfg/../x', '/cfg/./x', '/cfg//x', '/repo/.claude-alt', '/main/.claude-alt']
    for (const configDir of unsafe) {
      const warnings: string[] = []
      const path = claudeJsonPathOf({ configDir, home: '/home/u' }, roots, warnings)
      expect([configDir, path, warnings]).toEqual([configDir, '/home/u/.claude.json', [t('paths.configDirWarning')]])
    }
    const warnings: string[] = []
    expect(claudeJsonPathOf({ configDir: '/cfg', home: '/home/u' }, roots, warnings)).toBe('/cfg/.claude.json')
    expect(claudeJsonPathOf({ configDir: '/cfg', home: null }, roots, warnings)).toBe('/cfg/.claude.json')
    expect(warnings).toEqual([])
    expect(claudeJsonPathOf({ configDir: '.claude-alt', home: null }, roots, [])).toBeNull()
  })
})

describe('safety net: memoryFolderOf (A8)', () => {
  test('memoryFolderOf: <userDir>/projects/<the root with each non-alphanumeric made ->/memory', () => {
    expect(memoryFolderOf('/home/u/.claude', '/repo')).toBe('/home/u/.claude/projects/-repo/memory')
    expect(memoryFolderOf('/cfg', '/Users/v/my.repo_x')).toBe('/cfg/projects/-Users-v-my-repo-x/memory')
  })
})

describe('safety net: markdownFileNames (A8)', () => {
  test('markdownFileNames: the regular, unlinked files whose names end in .md, in listing order', () => {
    const entries = [
      entry('b.md'),
      entry('notes.txt'),
      entry('docs.md', 'dir'),
      entry('linked.md', 'file', true),
      entry('a.md'),
      entry('README.MD'),
    ]
    expect(markdownFileNames(entries)).toEqual(['b.md', 'a.md'])
  })
})

describe('isSafeRelativePath', () => {
  test('a path of plain segments joined by single slashes is safe', () => {
    for (const path of ['.cadre/be/role.json', 'a', 'a/b', '.gitignore', 'INDEX.md', 'a-b_c.d@e/f']) {
      expect(isSafeRelativePath(path)).toBe(true)
    }
  })

  test('an empty path, an absolute path, a dot segment and an empty segment are not safe', () => {
    for (const path of ['', '/x', 'a/../b', '..', '.', './a', 'a/.', 'a//b', 'a/', '/']) {
      expect(isSafeRelativePath(path)).toBe(false)
    }
  })

  test('a backslash, a space, a control character, a non-ASCII letter or a shell character is not safe', () => {
    const unsafe = [
      `a${BACKSLASH}b`,
      'a/ b',
      ' a',
      'a b',
      'a\nb',
      `a${String.fromCharCode(0)}b`,
      `a${BIDI_OVERRIDE}b`,
      `caf${String.fromCharCode(0xe9)}/x`,
      '~/x',
      '$HOME/x',
      'a/*',
      'a:b',
    ]
    for (const path of unsafe) {
      expect(isSafeRelativePath(path)).toBe(false)
    }
  })
})

describe('safety net: instructions helpers (A8)', () => {
  test('pathFromDisplay reads back what displayPath shows: a repo path, a home path, a path with a space', () => {
    const sources = { root: '/repo', home: '/home/u', configDir: null }
    const paths = ['/repo/docs/guide.md', '/home/u/.claude/CLAUDE.md', '/home/u/work notes/CLAUDE.md']
    const shown = paths.map(path => displayPath(path, sources.home, sources.root, sources.configDir))
    expect(shown).toEqual(['<repo>/docs/guide.md', '~/.claude/CLAUDE.md', '~/work notes/CLAUDE.md'])
    expect(shown.map(text => pathFromDisplay(text, sources))).toEqual(paths)
  })
})

describe('cadreStatePath', () => {
  test('cadreStatePath is the repo-relative path of the repo state', () => {
    expect(cadreStatePath()).toBe('.cadre/cadre.json')
  })
})

describe('launcherPath', () => {
  test('launcherPath is the repo-relative launcher of a role, below .cadre/bin', () => {
    expect([launcherPath('be'), launcherPath('pm')]).toEqual(['.cadre/bin/be', '.cadre/bin/pm'])
  })
})

describe('handoffFolderOf', () => {
  test('handoffFolderOf is the repo-relative handoff folder of a role, with no trailing slash', () => {
    expect(handoffFolderOf('be')).toBe('thoughts/shared/handoffs/be')
  })
})

describe('the runtime inbox files', () => {
  test('the inbox log and the session record have one name each, and both are rendered beside the old inbox', () => {
    const names = [INBOX_LOG_FILE, SESSION_FILE, INBOX_FILE]

    expect([INBOX_LOG_FILE, SESSION_FILE]).toEqual(['inbox.jsonl', 'session.json'])
    expect(names.filter(name => RUNTIME_RENDERED.includes(name))).toEqual(names)
  })

  test('an inbox archive is named by its time, and the archive glob that matches it is rendered too', () => {
    expect(inboxArchiveFile(1000)).toBe('inbox-1000.jsonl')
    expect(INBOX_ARCHIVE_GLOB).toBe('inbox-*.jsonl')
    expect(RUNTIME_RENDERED).toContain(INBOX_ARCHIVE_GLOB)
  })
})

describe('the runtime path builder', () => {
  test('runtimeDirOf is the runtime folder of a role and runtimeFileOf a file in it', () => {
    expect(runtimeDirOf('/repo', 'be')).toBe('/repo/.cadre/be/.runtime')
    expect(runtimeFileOf('/repo', 'be', 'inbox.jsonl')).toBe('/repo/.cadre/be/.runtime/inbox.jsonl')
  })
})

describe('the private inbox folder', () => {
  test('the inbox tree lies in the cadre folder of the user folder', () => {
    expect(INBOX_TREE).toBe('inboxes')
    expect(inboxTreeOf('/home/u/.claude')).toBe('/home/u/.claude/cadre/inboxes')
  })

  test('a root key is the root folder name, a dash and the first 8 hex of the root hash, cleaned', async () => {
    const hash = await sha256Hex('/w/my repo')

    expect(inboxRootKey('/w/my repo', hash)).toBe(`my-repo-${hash.slice(0, 8)}`)
  })

  test('two roots with the same folder name and different hashes get two keys', async () => {
    const [first, second] = [await sha256Hex('/w/app'), await sha256Hex('/x/app')]

    expect(inboxRootKey('/w/app', first)).not.toBe(inboxRootKey('/x/app', second))
  })

  test('a root key holds only letters, digits, dot, underscore and dash', async () => {
    const roots = ['/w/my repo', `/w/caf${String.fromCharCode(0xe9)} $x`, '/w/a:b*c`d', `/w/x${BACKSLASH}y`]
    for (const root of roots) {
      expect(inboxRootKey(root, await sha256Hex(root))).toMatch(/^[A-Za-z0-9._-]+$/)
    }
  })

  test('the inbox home of a root lies in the inbox tree, and a role inbox folder in that home', async () => {
    const hash = await sha256Hex('/w/app')
    const home = inboxHomeOf('/home/u/.claude', '/w/app', hash)

    expect(home).toBe(`/home/u/.claude/cadre/inboxes/app-${hash.slice(0, 8)}`)
    expect(inboxDirOf(home, 'be')).toBe(`${home}/be`)
  })

  test('the inbox tools build the inbox log and the session record in the inbox folder of a role', async () => {
    const home = inboxHomeOf('/home/u/.claude', '/repo', await sha256Hex('/repo'))

    expect(inboxLogPath(home, 'be')).toBe(`${home}/be/inbox.jsonl`)
    expect(sessionFilePath(home, 'be')).toBe(`${home}/be/session.json`)
  })

  test('the folder levels of a role inbox folder run from the cadre folder down to the role folder', () => {
    expect(inboxFolderLevels('/home/u/.claude/cadre/inboxes/app-12345678/be')).toEqual([
      '/home/u/.claude/cadre',
      '/home/u/.claude/cadre/inboxes',
      '/home/u/.claude/cadre/inboxes/app-12345678',
      '/home/u/.claude/cadre/inboxes/app-12345678/be',
    ])
  })
})
