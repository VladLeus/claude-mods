import { describe, expect, test } from 'claude-code/testing'

import type { InitIo, PortStat } from '../../types'
import { entry, memIo, memWorld } from '../testkit'
import { MAX_READ_BYTES } from './facts/normalize'
import { listingState, missingState, pluginVersionOf, portProbeOf, portTextOf, readRepoFile } from './port-read'

describe('readRepoFile', () => {
  test('reads a regular file whose real path is inside the root', async () => {
    const run = memIo(memWorld({ files: { '/repo/package.json': '{"a":1}' } }), [])

    const read = await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)

    expect(read).toEqual({ state: 'text', text: '{"a":1}' })
    expect(run.reads).toEqual(['/repo/package.json'])
  })

  test('a nested path is read below the root, and a root with a trailing slash works the same', async () => {
    const run = memIo(memWorld({ files: { '/repo/web/package.json': '{}' } }), [])

    const plain = await readRepoFile(run.io, '/repo', 'web/package.json', MAX_READ_BYTES)
    const slashed = await readRepoFile(run.io, '/repo/', 'web/package.json', MAX_READ_BYTES)

    expect(plain).toEqual({ state: 'text', text: '{}' })
    expect(slashed).toEqual({ state: 'text', text: '{}' })
  })

  test('a real path outside the root is unknown and the file is never read', async () => {
    const run = memIo(
      memWorld({
        files: { '/repo/package.json': '{"secret":true}' },
        realPaths: { '/repo/package.json': '/etc/package.json' },
      }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a real path in a sibling folder whose name starts like the root is outside it', async () => {
    const run = memIo(
      memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo-other/a.json' } }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a link whose real path is inside the root is read', async () => {
    const run = memIo(
      memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo/config/real.json' } }),
      [],
    )

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'text', text: '{}' })
  })

  test('a real path that is the root itself is not a file inside it', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{}' }, realPaths: { '/repo/a.json': '/repo' } }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a folder where a file is expected is unknown and never read', async () => {
    const run = memIo(memWorld({ dirs: { '/repo/package.json': [] } }), [])

    expect(await readRepoFile(run.io, '/repo', 'package.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a stat that gives no real path is unknown and the file is never read', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{}' } }), [])
    const io: InitIo = { ...run.io, stat: async () => ({ kind: 'file', size: 2, isLink: false }) }

    expect(await readRepoFile(io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(run.reads).toEqual([])
  })

  test('a path with no stat falls back to the port read, so a missing file stays absent', async () => {
    const run = memIo(memWorld({}), [])

    expect(await readRepoFile(run.io, '/repo', 'missing.json', MAX_READ_BYTES)).toEqual({ state: 'absent' })
    expect(run.reads).toEqual(['/repo/missing.json'])
  })

  test('a path with no stat is probed with a zero-byte read and its text is never returned', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': '{"secret":true}' } }), [])
    const caps: number[] = []
    const io: InitIo = {
      ...run.io,
      stat: async () => null,
      read: async (path, maxBytes) => {
        caps.push(maxBytes)

        return run.io.read(path, maxBytes)
      },
    }

    expect(await readRepoFile(io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
    expect(await readRepoFile(io, '/repo', 'missing.json', MAX_READ_BYTES)).toEqual({ state: 'absent' })
    expect(caps).toEqual([0, 0])
  })

  test('a path that cannot be stat or read is unknown, never absent', async () => {
    const run = memIo(memWorld({ unknownPaths: ['/repo/a.json'] }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', MAX_READ_BYTES)).toEqual({ state: 'unknown' })
  })

  test('a file over the cap comes back too-large with its UTF-8 size', async () => {
    const run = memIo(memWorld({ files: { '/repo/a.json': 'abcdefghijk' } }), [])

    expect(await readRepoFile(run.io, '/repo', 'a.json', 10)).toEqual({ state: 'too-large', bytes: 11 })
  })
})

describe('listingState', () => {
  test('a folder the port lists is present with its entries', async () => {
    const listing = [entry('a.ts'), entry('src', 'dir')]
    const run = memIo(memWorld({ dirs: { '/repo/x': listing } }), [])

    expect(await listingState(run.io, '/repo/x')).toEqual({ state: 'present', entries: listing })
    expect(run.reads).toEqual([])
  })

  test('a path that is not there is absent, told by a read probe that reads nothing', async () => {
    const run = memIo(memWorld({}), [])

    expect(await listingState(run.io, '/repo/x')).toEqual({ state: 'absent' })
    expect(run.reads).toEqual(['/repo/x'])
  })

  test('a path that cannot be listed but is there, or that fails, is unknown', async () => {
    const run = memIo(memWorld({ files: { '/repo/file': 'text' }, unknownPaths: ['/repo/u'] }), [])

    expect(await listingState(run.io, '/repo/file')).toEqual({ state: 'unknown' })
    expect(await listingState(run.io, '/repo/u')).toEqual({ state: 'unknown' })
  })
})

describe('safety net: scan helpers (A8)', () => {
  test('missingState: absent only for a path not there; a failed, folder or file read is unknown', async () => {
    const files = { '/repo/a': 'text', '/repo/e': '' }
    const world = memWorld({ files, dirs: { '/repo/d': [] }, unknownPaths: ['/repo/b'] })
    const run = memIo(world, [])
    const caps: number[] = []
    const io: InitIo = {
      ...run.io,
      read: async (path, maxBytes) => {
        caps.push(maxBytes)

        return run.io.read(path, maxBytes)
      },
    }
    const states: string[] = []
    for (const path of ['/repo/x', '/repo/b', '/repo/d', '/repo/a', '/repo/e']) {
      states.push(await missingState(io, path))
    }
    expect(states).toEqual(['absent', 'unknown', 'unknown', 'unknown', 'unknown'])
    expect(caps).toEqual([0, 0, 0, 0, 0])
  })
})

describe('init helpers', () => {
  test('pluginVersionOf reads a plain x.y.z version from plugin.json', () => {
    expect(pluginVersionOf('{"name":"cadre","version":"0.1.18"}')).toBe('0.1.18')
    expect(pluginVersionOf('{"version":"10.20.30"}')).toBe('10.20.30')
  })

  test('pluginVersionOf gives null for text that is not JSON, not an object, or has no plain version', () => {
    const bad = [
      '',
      'not json',
      '[]',
      'null',
      '"0.1.18"',
      '{}',
      '{"version":18}',
      '{"version":"1.2"}',
      '{"version":"v1.2.3"}',
      '{"version":"1.2.3-beta"}',
      '{"version":"1.2.3\\n"}',
    ]
    for (const text of bad) {
      expect(pluginVersionOf(text)).toBeNull()
    }
  })

  describe('the init port read decisions', () => {
    const MAX = 10
    const file = (size: number): PortStat => ({ kind: 'file', size, isLink: false, realPath: '/repo/a' })

    test('portProbeOf is absent only when the probe says the path is not there', () => {
      expect(portProbeOf(false, null, MAX)).toEqual({ state: 'absent' })
      expect(portProbeOf(false, file(1), MAX)).toEqual({ state: 'absent' })
    })

    test('portProbeOf is unknown when the probe failed', () => {
      expect(portProbeOf(null, null, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf is unknown for a null stat and for a stat that is not a file', () => {
      expect(portProbeOf(true, null, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'dir', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
      expect(portProbeOf(true, { kind: 'other', size: 1, isLink: false }, MAX)).toEqual({ state: 'unknown' })
    })

    test('portProbeOf reads a link to a regular file', () => {
      expect(portProbeOf(true, { kind: 'file', size: 1, isLink: true, realPath: '/repo/real' }, MAX)).toBeNull()
    })

    test('portProbeOf is too-large by the stat size and null (go on and read) at the limit', () => {
      expect(portProbeOf(true, file(MAX + 1), MAX)).toEqual({ state: 'too-large', bytes: MAX + 1 })
      expect(portProbeOf(true, file(MAX), MAX)).toBeNull()
    })

    test('portTextOf is unknown for a non-string, too-large by the UTF-8 bytes, else the text', () => {
      expect(portTextOf(null, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf(42, MAX)).toEqual({ state: 'unknown' })
      expect(portTextOf('€€€€', MAX)).toEqual({ state: 'too-large', bytes: 12 })
      expect(portTextOf('€€€', MAX)).toEqual({ state: 'text', text: '€€€' })
      expect(portTextOf('abcdefghij', MAX)).toEqual({ state: 'text', text: 'abcdefghij' })
    })
  })
})
