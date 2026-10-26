import { describe, expect, test } from 'claude-code/testing'

import { displayPath, isFileInsideRoot, isSafeConfigDir, relativeTo, resolvedPath, trimSlash } from './paths'

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
