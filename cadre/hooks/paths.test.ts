import { describe, expect, test } from 'claude-code/testing'

import { displayPath, isSafeConfigDir, relativeTo, trimSlash } from './paths'

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
