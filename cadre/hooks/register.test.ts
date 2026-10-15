import { describe, expect, test } from 'claude-code/testing'

import { HOME_ROOT_REPLY } from './facts'

/** The `on` registrar a test callback receives, which answers the host ops a plugin calls. */
type HostOn = Parameters<Parameters<typeof test>[1]>[1]

/** One listing entry, as the `fs.list` op answers it. */
type FakeEntry = {
  readonly name: string
  readonly kind: 'file' | 'dir' | 'other'
  readonly size: number
  readonly mtimeMs: number
  readonly isLink: boolean
}

/** The host state a test describes: what the session sees, what can be read, and what each op answers. */
type World = {
  readonly root: string
  readonly env: Readonly<Record<string, string>>
  /** Folder path to its listing; a folder that is not listed here cannot be listed. */
  readonly listings: Readonly<Record<string, readonly FakeEntry[]>>
  /** File path to its text; a file that is not listed here cannot be read. */
  readonly files: Readonly<Record<string, string>>
  /** Folders that exist without a listing behind them. */
  readonly dirs: readonly string[]
  readonly settings: Readonly<Partial<Record<'user' | 'project' | 'local', Readonly<Record<string, unknown>>>>>
  /** Paths whose list and read ops refuse, although the path exists. */
  readonly denyPaths: readonly string[]
  readonly denySettings: readonly string[]
  /** What `process.run` answers; null makes the call refuse. */
  readonly runtime: { readonly exitCode: number; readonly stdout: string } | null
}

/** What the fake host saw: every fs, process and settings op in order, and the argv of each process call. */
type HostLog = { readonly ops: string[]; readonly runs: string[][] }

/** Host ops that would change something; `/cadre detect` must never reach one. */
const WRITE_OPS: readonly string[] = ['fs.write', 'store.set', 'store.delete', 'env.set', 'state.set']

/** A listing entry: a file unless told otherwise, and not a link unless told so. */
function entry(name: string, kind: FakeEntry['kind'] = 'file', isLink = false): FakeEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink }
}

/** An empty log, one per test. */
function newLog(): HostLog {
  return { ops: [], runs: [] }
}

/**
 * A repo with `.planning/` and `docs/superpowers/`, a user-level GSD 1.16.0 with a proven identity, and superpowers
 * 6.4.1 enabled for the user. Pass `over` to change one part of it.
 */
function ambiguousWorld(over: Partial<World> = {}): World {
  return {
    root: '/repo',
    env: { HOME: '/home/u' },
    listings: {
      '/repo': [entry('.planning', 'dir'), entry('docs', 'dir')],
      '/repo/docs': [entry('superpowers', 'dir')],
    },
    files: {
      '/home/u/.claude/gsd-core/VERSION': '1.16.0\n',
      '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      '/home/u/.claude/plugins/installed_plugins.json':
        '{"plugins":{"superpowers@claude-plugins-official":[{"version":"6.4.1"}]}}',
    },
    dirs: ['/home/u/.claude/gsd-core'],
    settings: { user: { enabledPlugins: { 'superpowers@claude-plugins-official': true } }, project: {}, local: {} },
    denyPaths: [],
    denySettings: [],
    runtime: null,
    ...over,
  }
}

/** Whether the fake host has the path: a listed folder, a bare folder, or a file. */
function hasPath(world: World, path: string): boolean {
  return Object.hasOwn(world.listings, path) || world.dirs.includes(path) || Object.hasOwn(world.files, path)
}

/**
 * Answers the host ops `/cadre detect` may use from `world` and logs each fs, process and settings op into `log`.
 * Every write op is answered with a refusal, so a write would show up in the log and fail its call.
 */
function fakeHost(on: HostOn, world: World, log: HostLog): void {
  on('session.root', async () => ({ value: world.root }))
  on('env.get', async (_$, e) => ({ value: world.env[e.name] }))
  on('fs.exists', async (_$, e) => {
    log.ops.push(`fs.exists ${e.path}`)

    return { value: hasPath(world, e.path) }
  })
  on('fs.list', async (_$, e) => {
    log.ops.push(`fs.list ${e.path}`)
    if (world.denyPaths.includes(e.path) || !Object.hasOwn(world.listings, e.path)) return { deny: 'missing' }

    return { value: world.listings[e.path] }
  })
  on('fs.read', async (_$, e) => {
    log.ops.push(`fs.read ${e.path}`)
    if (world.denyPaths.includes(e.path) || !Object.hasOwn(world.files, e.path)) return { deny: 'missing' }

    return { value: world.files[e.path] }
  })
  on('settings.read', async (_$, e) => {
    log.ops.push(`settings.read ${e.source}`)
    if (e.source === undefined || world.denySettings.includes(e.source)) return { deny: 'unreadable' }

    return { value: world.settings[e.source] ?? {} }
  })
  on('process.run', async (_$, e) => {
    log.ops.push('process.run')
    log.runs.push([...e.argv])
    if (world.runtime === null) return { deny: 'no runtime in this world' }

    return { value: { ...world.runtime, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  for (const op of WRITE_OPS) {
    on(op, async () => {
      log.ops.push(`write ${op}`)

      return { deny: 'detect writes nothing' }
    })
  }
}

describe('register with a faked host', () => {
  test('bare /cadre answers with help that lists both detect commands', async $ => {
    const out = await $.command.run({ command: 'cadre', args: '' })
    expect(out.text).toContain('/cadre detect --adapters')
  })

  test('an unknown subcommand is echoed on the first line of the reply', async $ => {
    const out = await $.command.run({ command: 'cadre', args: 'start be' })
    expect(out.text.startsWith('Unknown subcommand: start be')).toBe(true)
  })

  test('detect in an ambiguous repo prints the report and the ambiguous adapter line', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
    expect(out.text).toContain('docs/superpowers/')
  })

  test('detect --adapters adds the contract view after the report', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).toContain('Adapter contract')
    expect(out.text).toContain('built-in (none)')
  })

  test('a session at the home folder is refused before any read or process call', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops).toEqual([])
  })

  test('a session in a folder that contains the home folder is refused the same way', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops).toEqual([])
  })

  test('a normal repo root beside the home folder is detected', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).not.toBe(HOME_ROOT_REPLY)
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })
})
