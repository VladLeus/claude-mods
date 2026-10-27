import { describe, expect, test } from 'claude-code/testing'

import {
  cadreStatePath,
  displayPath,
  handoffFolderOf,
  isFileInsideRoot,
  isSafeConfigDir,
  isSafeRelativePath,
  launcherPath,
  markdownFileNames,
  memoryFolderOf,
  pathFromDisplay,
  projectFolderOf,
  relativeTo,
  resolvedPath,
  trimSlash,
} from './paths'
import { BACKSLASH, BIDI_OVERRIDE, entry } from './testkit'

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
