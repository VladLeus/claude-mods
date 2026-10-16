import { describe, expect, test } from 'claude-code/testing'

import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from './facts'

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
  /** Where a path lands when its stat is asked with `resolve`; a listed path with no entry answers no realPath. */
  readonly realPaths: Readonly<Record<string, string>>
  /** Paths whose stat refuses, although the path exists. */
  readonly denyStat: readonly string[]
  /** The kind a path's stat answers when it is not the default: `file` for a file in `files`, else `dir`. */
  readonly statKinds: Readonly<Record<string, FakeEntry['kind']>>
  readonly denySettings: readonly string[]
  /** What `process.run` answers; null makes the call refuse with `runtimeDeny`. */
  readonly runtime: { readonly exitCode: number; readonly stdout: string } | null
  /** The reason a refused `process.run` gives; detect must never show it. */
  readonly runtimeDeny: string
  /** Makes `session.root` refuse, as a host that cannot say where the session is. */
  readonly denyRoot: boolean
  /** Files whose read answers no value at all, instead of a text or a refusal. */
  readonly undefinedReads: readonly string[]
}

/**
 * What the fake host saw: every fs, process and settings op in order, the argv of each process call, and the working
 * folder each process call asked for ('' when it asked for none).
 */
type HostLog = { readonly ops: string[]; readonly runs: string[][]; readonly cwds: string[] }

/**
 * Host ops that would change something or reach beyond the read-only reads (a second process call, the network, an
 * MCP tool); `/cadre detect` must never reach one. `process.spawn` is forbidden too, but streams, so fakeHost hooks it
 * with a generator. `process.run` is not here: it is logged, and only the user-level identity call may use it.
 */
const FORBIDDEN_OPS: readonly string[] = [
  'fs.write',
  'store.set',
  'store.delete',
  'env.set',
  'state.set',
  'http.fetch',
  'mcp.call',
]

/** A listing entry: a file unless told otherwise, and not a link unless told so. */
function entry(name: string, kind: FakeEntry['kind'] = 'file', isLink = false): FakeEntry {
  return { name, kind, size: 0, mtimeMs: 0, isLink }
}

/** An empty log, one per test. */
function newLog(): HostLog {
  return { ops: [], runs: [], cwds: [] }
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
      '/home/u/.claude/gsd-core/bin/lib/cli-exit.cjs': '',
      '/home/u/.claude/plugins/installed_plugins.json':
        '{"plugins":{"superpowers@claude-plugins-official":[{"version":"6.4.1"}]}}',
    },
    dirs: ['/home/u/.claude/gsd-core'],
    settings: { user: { enabledPlugins: { 'superpowers@claude-plugins-official': true } }, project: {}, local: {} },
    denyPaths: [],
    realPaths: { '/repo': '/repo', '/home/u': '/home/u' },
    denyStat: [],
    statKinds: {},
    denySettings: [],
    runtime: null,
    runtimeDeny: 'no runtime in this world',
    denyRoot: false,
    undefinedReads: [],
    ...over,
  }
}

/** Whether the fake host has the path: a listed folder, a bare folder, or a file. */
function hasPath(world: World, path: string): boolean {
  return Object.hasOwn(world.listings, path) || world.dirs.includes(path) || Object.hasOwn(world.files, path)
}

/**
 * Answers the host ops `/cadre detect` may use from `world` and logs each fs, process and settings op into `log`.
 * Every forbidden op is answered with a refusal, so a call to one would show up in the log and fail its call.
 */
function fakeHost(on: HostOn, world: World, log: HostLog): void {
  on('session.root', async () => (world.denyRoot ? { deny: 'no session root' } : { value: world.root }))
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
    if (world.undefinedReads.includes(e.path)) return { value: undefined }

    return { value: world.files[e.path] }
  })
  on('fs.stat', async (_$, e) => {
    log.ops.push(`fs.stat ${e.path} resolve=${String(e.resolve)}`)
    if (world.denyStat.includes(e.path)) return { deny: 'stat refused' }
    if (!Object.hasOwn(world.realPaths, e.path) && !hasPath(world, e.path)) return { deny: 'missing' }
    const isFile = Object.hasOwn(world.files, e.path)
    // A file lands on itself unless realPaths says otherwise; a folder with no realPaths entry answers none.
    const fileRealPath = isFile ? e.path : undefined
    const realPath = Object.hasOwn(world.realPaths, e.path) ? world.realPaths[e.path] : fileRealPath
    const defaultKind: FakeEntry['kind'] = isFile ? 'file' : 'dir'
    const kind = Object.hasOwn(world.statKinds, e.path) ? world.statKinds[e.path] : defaultKind

    return { value: { kind, size: 0, mtimeMs: 0, isLink: false, ...(e.resolve ? { realPath } : {}) } }
  })
  on('settings.read', async (_$, e) => {
    log.ops.push(`settings.read ${e.source}`)
    if (e.source === undefined || world.denySettings.includes(e.source)) return { deny: 'unreadable' }

    return { value: world.settings[e.source] ?? {} }
  })
  on('process.run', async (_$, e) => {
    log.ops.push('process.run')
    log.runs.push([...e.argv])
    log.cwds.push(e.init?.cwd ?? '')
    if (world.runtime === null) return { deny: world.runtimeDeny }

    return { value: { ...world.runtime, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('process.spawn', async function* () {
    log.ops.push('forbidden process.spawn')

    return { deny: 'detect uses no such op' }
  })
  for (const op of FORBIDDEN_OPS) {
    on(op, async () => {
      log.ops.push(`forbidden ${op}`)

      return { deny: 'detect uses no such op' }
    })
  }
}

/** The report row of one framework: the line that starts with its name, padded to the name column; '' if none. */
function rowOf(text: string, name: string): string {
  const row = new RegExp(`^${name} {2,}`)

  return text.split('\n').find(line => row.test(line)) ?? ''
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

  test('a session at the home folder is refused before any listing, read, settings or process call', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops).toContain('fs.stat /home/u resolve=true')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a session in a folder that contains the home folder is refused the same way', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/home' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a normal repo root beside the home folder is detected', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).not.toBe(HOME_ROOT_REPLY)
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a repo-local GSD folder alone is never run: the runtime identity call is not made', async ($, on) => {
    const log = newLog()
    const repoOnly = {
      // No user-level GSD files or folder: the repo-local folder is the only GSD candidate.
      ...ambiguousWorld(),
      files: {
        '/repo/.claude/gsd-core/VERSION': '1.16.0\n',
        '/repo/.claude/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/repo/.claude/gsd-core'],
      denyPaths: ['/repo/.claude/gsd-core/VERSION', '/repo/.claude/gsd-core/bin/lib/package-identity.cjs'],
    }
    fakeHost(on, repoOnly, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.exists /repo/.claude/gsd-core')
    expect(log.ops.some(op => op.includes('/home/u/.claude/gsd-core') && op.startsWith('fs.read'))).toBe(false)
    expect(log.runs).toEqual([])
    expect(log.ops).not.toContain('process.run')
  })

  test('a user-level GSD folder that cannot be proven is run once, under the user folder only', async ($, on) => {
    const log = newLog()
    const userDenied = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
    }
    fakeHost(on, userDenied, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(log.runs[0][1].startsWith('/home/u/.claude/gsd-core/')).toBe(true)
    expect(log.runs[0].some(arg => arg.startsWith('/repo'))).toBe(false)
    expect(out.text).toContain('Warning: could not read ~/.claude/gsd-core/VERSION (treated as unknown)')
    // IN-05 (user decision 2026-10-16): a refused identity call gives the one generic could-not-run reason.
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run',
    )
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
    expect(out.text).not.toContain('/home/u')
  })

  test('a runtime identity answer for another package never makes the GSD row installed', async ($, on) => {
    const log = newLog()
    const decoy = {
      ...ambiguousWorld(),
      listings: { '/repo': [entry('docs', 'dir')], '/repo/docs': [entry('superpowers', 'dir')] },
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"get-shit-done-cc","note":"@opengsd/gsd-core"}' },
    }
    fakeHost(on, decoy, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(rowOf(out.text, 'GSD')).toContain('not found')
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
  })

  test('no mutating host op is called by a detect run or a detect --adapters run', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld(), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('settings values, hook commands and the home path never reach the output', async ($, on) => {
    const secrets = {
      ...ambiguousWorld(),
      settings: {
        user: {
          env: { TOKEN: 'SENTINEL_SECRET_123' },
          enabledPlugins: { 'superpowers@claude-plugins-official': true },
          hooks: {
            PostToolUse: [
              { matcher: '', hooks: [{ type: 'command', command: '"/home/u/secret/hooks/gsd-prompt-guard.js"' }] },
            ],
          },
        },
        project: {},
        local: {},
      },
    }
    fakeHost(on, secrets, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).not.toContain('SENTINEL_SECRET_123')
    expect(out.text).not.toContain('/home/u')
    expect(out.text).not.toContain('/repo/')
  })

  test('a root listing that fails gives a warning and still the five framework rows', async ($, on) => {
    fakeHost(on, { ...ambiguousWorld(), denyPaths: ['/repo'] }, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not list the repo root (treated as unknown)')
    for (const name of ['GSD', 'superpowers', 'AI-DLC', 'BMAD', 'spec-kit']) {
      expect(rowOf(out.text, name)).not.toBe('')
    }
  })

  test('a project settings read that fails gives a warning and the report still renders', async ($, on) => {
    fakeHost(on, { ...ambiguousWorld(), denySettings: ['project'] }, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read project settings (treated as unknown)')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('two detect runs on the same host give identical text', async ($, on) => {
    fakeHost(on, ambiguousWorld(), newLog())
    const first = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    const second = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(second.text).toBe(first.text)
  })

  test('a symlinked docs/ is listed like a docs/ folder, so superpowers behind it is in use', async ($, on) => {
    const linked = {
      ...ambiguousWorld(),
      listings: {
        '/repo': [entry('.planning', 'dir'), entry('docs', 'other', true)],
        '/repo/docs': [entry('superpowers', 'dir')],
      },
    }
    fakeHost(on, linked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('docs/superpowers/')
    expect(rowOf(out.text, 'superpowers')).toContain('in use')
  })

  test('a plain file named docs is never listed as a folder', async ($, on) => {
    const log = newLog()
    const plainDocs = { ...ambiguousWorld(), listings: { '/repo': [entry('.planning', 'dir'), entry('docs', 'file')] } }
    fakeHost(on, plainDocs, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain('fs.list /repo/docs')
  })

  test('a symlinked repo root that lands in the home folder is refused like the home folder', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/home/u', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /link/repo resolve=true')
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a symlinked repo root is read through the place it lands', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.list /repo')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a CLAUDE_CONFIG_DIR that lands inside the repo is ignored with its warning', async ($, on) => {
    const log = newLog()
    const inRepo = ambiguousWorld({
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/cfg-link': '/repo/.cfg' },
    })
    fakeHost(on, inRepo, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /cfg-link resolve=true')
    expect(out.text).toContain('Warning: CLAUDE_CONFIG_DIR is ignored')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
    expect(log.ops.filter(op => !op.startsWith('fs.stat ')).some(op => op.includes('/repo/.cfg'))).toBe(false)
  })

  test('a CLAUDE_CONFIG_DIR that lands outside the repo is read at the place it lands', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const outside = {
      ...base,
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/cfg-link': '/opt/cfg' },
      files: {
        ...base.files,
        '/opt/cfg/gsd-core/VERSION': '1.16.0\n',
        '/opt/cfg/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/opt/cfg/gsd-core'],
    }
    fakeHost(on, outside, log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.read /opt/cfg/gsd-core/VERSION')
    expect(log.ops.filter(op => !op.startsWith('fs.stat ')).some(op => op.includes('/cfg-link'))).toBe(false)
  })

  test('a repo root whose stat is refused is used as given, with a warning', async ($, on) => {
    fakeHost(on, ambiguousWorld({ denyStat: ['/repo'] }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve the repo root (used as given)')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })

  test('a home folder whose stat answers no realPath is used as given, with a warning', async ($, on) => {
    const noRealPath = ambiguousWorld({
      realPaths: { '/repo': '/repo' },
      dirs: ['/home/u/.claude/gsd-core', '/home/u'],
    })
    fakeHost(on, noRealPath, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve the home folder (used as given)')
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
  })

  test('a CLAUDE_CONFIG_DIR whose stat is refused is used as given, with a warning', async ($, on) => {
    const refused = ambiguousWorld({
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg-link' },
      denyStat: ['/cfg-link'],
    })
    fakeHost(on, refused, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not resolve CLAUDE_CONFIG_DIR (used as given)')
  })

  test('resolving the paths adds no write and no process call', async ($, on) => {
    const log = newLog()
    const linked = ambiguousWorld({ root: '/link/repo', realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect --adapters' })
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('a session root the host refuses gives the unknown-root report with no read at all', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ denyRoot: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read the session root (treated as unknown)')
    for (const name of ['GSD', 'superpowers', 'AI-DLC', 'BMAD', 'spec-kit']) {
      expect(rowOf(out.text, name)).not.toBe('')
    }
    expect(log.ops).toEqual([])
    expect(log.runs).toEqual([])
  })

  test('an installed_plugins.json over the read cap gives the could-not-read warning', async ($, on) => {
    const base = ambiguousWorld()
    const big = {
      ...base,
      files: { ...base.files, '/home/u/.claude/plugins/installed_plugins.json': 'x'.repeat(300 * 1024) },
    }
    fakeHost(on, big, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read ~/.claude/plugins/installed_plugins.json (treated as unknown)')
  })

  test('a file that is not JSON gives the could-not-parse warning', async ($, on) => {
    const base = ambiguousWorld()
    const broken = {
      ...base,
      files: { ...base.files, '/home/u/.claude/plugins/installed_plugins.json': '{"plugins": [' },
    }
    fakeHost(on, broken, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain(
      'Warning: could not parse ~/.claude/plugins/installed_plugins.json as JSON (treated as unknown)',
    )
  })

  test('a read that answers no text gives the could-not-read warning', async ($, on) => {
    const unreadable = ambiguousWorld({ undefinedReads: ['/home/u/.claude/plugins/installed_plugins.json'] })
    fakeHost(on, unreadable, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: could not read ~/.claude/plugins/installed_plugins.json (treated as unknown)')
  })

  test('a relative HOME is never stat-ed or read', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ env: { HOME: 'rel/home' } }), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops.filter(op => op.startsWith('fs.stat ')).some(op => op.includes('rel/home'))).toBe(false)
    expect(log.ops.some(op => op.includes('rel/home'))).toBe(false)
    expect(log.runs).toEqual([])
  })

  test('a relative CLAUDE_CONFIG_DIR is never stat-ed or read', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: 'rel/cfg' } }), log)
    await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops.filter(op => op.startsWith('fs.stat ')).some(op => op.includes('rel/cfg'))).toBe(false)
    expect(log.ops.some(op => op.includes('rel/cfg'))).toBe(false)
    expect(log.runs.some(run => JSON.stringify(run).includes('rel/cfg'))).toBe(false)
  })

  test('a runtime identity call that exits non-zero leaves the install unproven, with the warning', async ($, on) => {
    const log = newLog()
    const failed = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 1, stdout: '' },
    }
    fakeHost(on, failed, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs.length).toBe(1)
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
    expect(rowOf(out.text, 'GSD')).not.toContain('installed')
  })

  test('a user-level GSD folder with no built runtime is never run, and the warning says so (WR-01)', async ($, on) => {
    const log = newLog()
    const notBuilt = {
      ...ambiguousWorld(),
      files: {
        '/home/u/.claude/gsd-core/VERSION': '1.16.0\n',
        '/home/u/.claude/plugins/installed_plugins.json': '{"plugins":{}}',
      },
    }
    fakeHost(on, notBuilt, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs).toEqual([])
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: runtime not built (treated as unknown)',
    )
  })

  test('the runtime identity call runs in the user GSD folder, never in the repo (WR-01)', async ($, on) => {
    const log = newLog()
    const userDenied = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
    }
    fakeHost(on, userDenied, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.cwds).toEqual(['/home/u/.claude/gsd-core'])
    expect(out.text).toContain('gsd-core 1.16.0 at ~/.claude/gsd-core')
  })

  test('an identity call the host refuses gives the generic warning and never the host text (IN-05)', async ($, on) => {
    const refused = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtimeDeny: 'SENTINEL_HOST_TEXT',
    }
    fakeHost(on, refused, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain(
      'Warning: could not prove the GSD install at ~/.claude/gsd-core: the identity call could not run ' +
        '(node missing, or it timed out) (treated as unknown)',
    )
    expect(out.text).not.toContain('SENTINEL_HOST_TEXT')
  })

  test('an identity call that exits non-zero is not reported as could-not-run (IN-05)', async ($, on) => {
    const failed = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      runtime: { exitCode: 1, stdout: '' },
    }
    fakeHost(on, failed, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).not.toContain('the identity call could not run')
    expect(out.text).toContain('Warning: could not prove the GSD install at ~/.claude/gsd-core (treated as unknown)')
  })

  test('a repo-local GSD file that links out of the repo is never read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const linkedOut = {
      ...base,
      files: { ...base.files, '/repo/.claude/gsd-core/VERSION': 'SENTINEL_KEY_MATERIAL' },
      dirs: [...base.dirs, '/repo/.claude/gsd-core'],
      realPaths: { ...base.realPaths, '/repo/.claude/gsd-core/VERSION': '/home/u/.ssh/id_ed25519' },
    }
    fakeHost(on, linkedOut, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.stat /repo/.claude/gsd-core/VERSION resolve=true')
    expect(log.ops).not.toContain('fs.read /repo/.claude/gsd-core/VERSION')
    expect(out.text).toContain(
      'Warning: skipped <repo>/.claude/gsd-core/VERSION: not a regular file inside the repo (treated as unknown)',
    )
    expect(out.text).not.toContain('SENTINEL_KEY_MATERIAL')
  })

  test('a repo-local GSD file that is a device or a FIFO is never read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const statKinds: World['statKinds'] = { '/repo/.claude/gsd-file-manifest.json': 'other' }
    const device = { ...base, files: { ...base.files, '/repo/.claude/gsd-file-manifest.json': '{}' }, statKinds }
    fakeHost(on, device, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain('fs.read /repo/.claude/gsd-file-manifest.json')
    expect(out.text).toContain('Warning: skipped <repo>/.claude/gsd-file-manifest.json: not a regular file')
  })

  // Guard: passes before the fix by design; it proves the WR-02 check does not block a regular file inside the repo.
  test('a regular repo-local GSD file inside the repo is still read (WR-02)', async ($, on) => {
    const log = newLog()
    const base = ambiguousWorld()
    const inside = {
      ...base,
      files: { ...base.files, '/repo/.claude/gsd-core/VERSION': '1.16.0\n' },
      dirs: [...base.dirs, '/repo/.claude/gsd-core'],
    }
    fakeHost(on, inside, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).toContain('fs.read /repo/.claude/gsd-core/VERSION')
    expect(out.text).not.toContain('not a regular file inside the repo')
  })

  test('a root as given that equals HOME as resolved is refused (WR-06)', async ($, on) => {
    const log = newLog()
    const mixed = ambiguousWorld({
      root: '/home/u',
      env: { HOME: '/data/u' },
      realPaths: { '/home/u': '/srv/u', '/data/u': '/home/u' },
    })
    fakeHost(on, mixed, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a session at the file system root is refused even with no HOME (WR-06)', async ($, on) => {
    const log = newLog()
    fakeHost(on, ambiguousWorld({ root: '/', env: {}, realPaths: { '/': '/' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(FILE_SYSTEM_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('with HOME unset, detect still runs and warns that the home-folder check was skipped (WR-06)', async ($, on) => {
    const noHome = ambiguousWorld({
      env: { CLAUDE_CONFIG_DIR: '/opt/cfg' },
      realPaths: { '/repo': '/repo', '/opt/cfg': '/opt/cfg' },
    })
    fakeHost(on, noHome, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('Warning: HOME is unset or not an absolute path: the home-folder check was skipped')
    expect(out.text).toContain('Adapter: ambiguous: gsd, superpowers; init will ask')
  })
})
