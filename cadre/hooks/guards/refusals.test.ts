import { describe, expect, test } from 'claude-code/testing'

import { detectRefusal, FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY, homeRootRefusal } from './refusals'

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
