import { describe, expect, test } from 'claude-code/testing'

import { FILE_SYSTEM_ROOT_REPLY, HOME_ROOT_REPLY } from './facts'
import { INIT_FILE_SYSTEM_ROOT_REPLY, INIT_HOME_ROOT_REPLY, NOT_INTERACTIVE_REPLY } from './init'
import { answerFor, entry, INIT_ANSWERS } from './testkit'

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
  /** Paths whose exists probe refuses, although the path exists. */
  readonly denyExists: readonly string[]
  /** What `process.run` answers; null makes the call refuse with `runtimeDeny`. */
  readonly runtime: { readonly exitCode: number; readonly stdout: string } | null
  /** The reason a refused `process.run` gives; detect must never show it. */
  readonly runtimeDeny: string
  /** Makes `session.root` refuse, as a host that cannot say where the session is. */
  readonly denyRoot: boolean
  /** Files whose read answers no value at all, instead of a text or a refusal. */
  readonly undefinedReads: readonly string[]
  /** What `session.surfaces` answers; empty is a `claude -p` run, where nobody can be asked (D-42). */
  readonly surfaces: readonly string[]
  /** Makes `session.surfaces` refuse, as a host that cannot say whether anyone is there. */
  readonly denySurfaces: boolean
  /**
   * Question prefix to the answer the dialog gives. The longest prefix a question starts with wins, so a test stays
   * valid when a later plan adds questions; a question no prefix matches is dismissed, as Esc does.
   */
  readonly answers: Readonly<Record<string, string>>
  /** What `clock.now` answers, in epoch milliseconds. */
  readonly now: number
  /** What `session.id` answers. */
  readonly sessionId: string
  /** What `fs.ancestors` answers, unvalidated. */
  readonly ancestors: unknown
  /** What `command.list` answers, unvalidated. */
  readonly commands: unknown
  /** What `tool.list` answers, unvalidated. */
  readonly tools: unknown
  /** The model's replies in order; once they run out, `model.complete` answers that the model gave no text. */
  readonly replies: readonly string[]
}

/**
 * What the fake host saw: every fs, process and settings op in order, the argv of each process call, the working
 * folder each process call asked for ('' when it asked for none), each dialog question as `ask <question>`, the
 * option labels each dialog showed, and each text the plugin logged to the transcript.
 */
type HostLog = {
  readonly ops: string[]
  readonly runs: string[][]
  readonly cwds: string[]
  readonly asks: string[]
  readonly askOptions: string[][]
  readonly logs: string[]
}

/**
 * Host ops that would change something or reach beyond the read-only reads (a second process call, the network, an
 * MCP tool, a tool registration); `/cadre detect` and `/cadre init` must never reach one. `process.spawn` is
 * forbidden too, but streams, so fakeHost hooks it with a generator. `process.run` is not here: it is logged, and
 * only the user-level identity call may use it.
 */
const FORBIDDEN_OPS: readonly string[] = [
  'fs.write',
  'store.set',
  'store.delete',
  'env.set',
  'state.set',
  'http.fetch',
  'mcp.call',
  'tool.register',
]

/** An empty log, one per test. */
function newLog(): HostLog {
  return { ops: [], runs: [], cwds: [], asks: [], askOptions: [], logs: [] }
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
        '{"plugins":{"superpowers@claude-plugins-official":[{"scope":"user","version":"6.4.1"}]}}',
    },
    dirs: ['/home/u/.claude/gsd-core'],
    settings: { user: { enabledPlugins: { 'superpowers@claude-plugins-official': true } }, project: {}, local: {} },
    denyPaths: [],
    realPaths: { '/repo': '/repo', '/home/u': '/home/u' },
    denyStat: [],
    statKinds: {},
    denySettings: [],
    denyExists: [],
    runtime: null,
    runtimeDeny: 'no runtime in this world',
    denyRoot: false,
    undefinedReads: [],
    surfaces: ['terminal'],
    denySurfaces: false,
    answers: {},
    now: 1_000_000,
    sessionId: 's1',
    ancestors: [],
    commands: [],
    tools: [],
    replies: [],
    ...over,
  }
}

/** The INIT_ANSWERS without the answer for one question prefix, so that question is dismissed. */
function answersWithout(prefix: string): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(INIT_ANSWERS).filter(([key]) => key !== prefix))
}

/**
 * The ambiguous repo of ambiguousWorld inside a git repo (`/repo/.git` is a folder), with every init question answered
 * by INIT_ANSWERS. Pass `over` to change one part of it.
 */
function initWorld(over: Partial<World> = {}): World {
  const base = ambiguousWorld()

  return { ...base, dirs: [...base.dirs, '/repo/.git'], answers: INIT_ANSWERS, ...over }
}

/** Whether the fake host has the path: a listed folder, a bare folder, or a file. */
function hasPath(world: World, path: string): boolean {
  return Object.hasOwn(world.listings, path) || world.dirs.includes(path) || Object.hasOwn(world.files, path)
}

/**
 * Answers the host ops `/cadre detect` and `/cadre init` may use from `world` and logs each fs, process and settings
 * op into `log`; a dialog is answered from `world.answers` and logged as an ask, and a transcript text is kept in
 * `log.logs`. The model answers `world.replies` in order. Every forbidden op is answered with a refusal, so a call to
 * one would show up in the log and fail its call.
 */
function fakeHost(on: HostOn, world: World, log: HostLog): void {
  on('session.root', async () => (world.denyRoot ? { deny: 'no session root' } : { value: world.root }))
  on('session.surfaces', async () => (world.denySurfaces ? { deny: 'no surfaces' } : { value: world.surfaces }))
  on('session.id', async () => ({ value: world.sessionId }))
  on('session.model', async () => ({ value: 'opus' }))
  on('clock.now', async () => ({ value: world.now }))
  on('ui.log', async (_$, e) => {
    log.logs.push(e.text)

    return { value: undefined }
  })
  on('tool.call', { tool: 'AskUserQuestion' }, async (_$, e) => {
    const asked = e.questions[0]
    const question = asked?.question ?? ''
    log.asks.push(`ask ${question}`)
    log.askOptions.push((asked?.options ?? []).map(option => option.label))
    const answer = answerFor(world.answers, question)
    if (answer === undefined) return { deny: 'dismissed' }

    return { result: { questions: e.questions, answers: { [question]: answer } } }
  })
  on('command.list', async () => ({ value: world.commands }))
  on('tool.list', async () => ({ value: world.tools }))
  let nextReply = 0
  on('model.complete', async () => {
    const text = world.replies[nextReply]
    nextReply += 1
    const usage = { input_tokens: 1, output_tokens: 1 }
    if (text === undefined) return { value: { isAnswered: false, reason: 'no-text', usage } }

    return { value: { isAnswered: true, text, usage } }
  })
  on('fs.ancestors', async () => {
    log.ops.push('fs.ancestors')

    return { value: world.ancestors }
  })
  on('env.get', async (_$, e) => ({ value: world.env[e.name] }))
  on('fs.exists', async (_$, e) => {
    log.ops.push(`fs.exists ${e.path}`)
    if (world.denyExists.includes(e.path)) return { deny: 'exists refused' }

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
    expect(log.ops).not.toContain('fs.exists /repo/.claude/gsd-core/bin/lib/cli-exit.cjs')
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
        '(node missing or timed out); treated as unknown',
    )
    expect(out.text).not.toContain('SENTINEL_HOST_TEXT')
  })

  // Guard: passes before the fix by design; it proves a non-zero exit is not mistaken for a call that could not run.
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

  // Guard: passes before the fix by design; it pins that a refused built-probe fails closed (no process call).
  test('a built-probe the host refuses is reported as not built and the identity call is not made', async ($, on) => {
    const log = newLog()
    const probeRefused = {
      ...ambiguousWorld(),
      denyPaths: ['/home/u/.claude/gsd-core/VERSION', '/home/u/.claude/gsd-core/bin/lib/package-identity.cjs'],
      denyExists: ['/home/u/.claude/gsd-core/bin/lib/cli-exit.cjs'],
      runtime: { exitCode: 0, stdout: '{"packageName":"@opengsd/gsd-core","version":"1.16.0"}' },
    }
    fakeHost(on, probeRefused, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.runs).toEqual([])
    expect(out.text).toContain('could not prove the GSD install at ~/.claude/gsd-core: runtime not built')
  })

  test('a plugin entry that names the root as given counts when the root resolves elsewhere (WR-04)', async ($, on) => {
    const base = ambiguousWorld()
    const linked = {
      ...base,
      root: '/link/repo',
      realPaths: { '/link/repo': '/repo', '/home/u': '/home/u' },
      files: {
        ...base.files,
        '/home/u/.claude/plugins/installed_plugins.json':
          '{"version":2,"plugins":{"superpowers@x":' +
          '[{"scope":"project","projectPath":"/link/repo","version":"4.0.0"}]}}',
      },
      settings: { user: { enabledPlugins: { 'superpowers@x': true } }, project: {}, local: {} },
    }
    fakeHost(on, linked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(rowOf(out.text, 'superpowers')).toContain('4.0.0')
  })

  // Guard: passes before the fix by design; it pins today's behaviour for a root used as given (D-39).
  test('a root whose realpath failed skips its repo-local files with the warning, though they exist', async ($, on) => {
    const log = newLog()
    const versionPath = '/tmp/repo/.claude/gsd-core/VERSION'
    const unresolved = {
      ...ambiguousWorld(),
      root: '/tmp/repo',
      listings: { '/tmp/repo': [entry('.claude', 'dir')] },
      files: { ...ambiguousWorld().files, [versionPath]: '1.2.3\n' },
      dirs: [...ambiguousWorld().dirs, '/tmp/repo/.claude/gsd-core'],
      denyStat: ['/tmp/repo'],
      realPaths: { '/home/u': '/home/u', [versionPath]: `/private${versionPath}` },
    }
    fakeHost(on, unresolved, log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(log.ops).not.toContain(`fs.read ${versionPath}`)
    expect(out.text).toContain('Warning: could not resolve the repo root (used as given)')
    expect(out.text).toContain('Warning: skipped <repo>/.claude/gsd-core/VERSION: not a regular file inside the repo')
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

  test('a .planning entry with a hidden character never makes GSD in use (WR-03)', async ($, on) => {
    const faked = { ...ambiguousWorld(), listings: { '/repo': [entry('.planning\u200B', 'dir')] }, files: {}, dirs: [] }
    fakeHost(on, faked, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(rowOf(out.text, 'GSD')).toContain('not found')
    expect(out.text).toContain('Warning: ignored repo entry ".planning": its name has hidden characters or is too long')
    expect(out.text).not.toContain('\u200B')
  })

  test('a CLAUDE_CONFIG_DIR outside home is shown as $CLAUDE_CONFIG_DIR, never as its path (IN-03)', async ($, on) => {
    const outside = {
      ...ambiguousWorld(),
      env: { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/opt/cfg' },
      realPaths: { '/repo': '/repo', '/home/u': '/home/u', '/opt/cfg': '/opt/cfg' },
      files: {
        '/opt/cfg/gsd-core/VERSION': '1.16.0\n',
        '/opt/cfg/gsd-core/bin/lib/package-identity.cjs': 'const packageName = "@opengsd/gsd-core";\n',
      },
      dirs: ['/opt/cfg/gsd-core'],
    }
    fakeHost(on, outside, newLog())
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toContain('gsd-core 1.16.0 at $CLAUDE_CONFIG_DIR/gsd-core')
    expect(out.text).not.toContain('/opt/cfg')
  })
})

describe('cadre init with a faked host', () => {
  const POLICY_ASK = 'ask Git policy for .cadre/?'

  test('init --dry-run asks the git policy and ends with the dry-run note', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text.split('\n')[0]).toBe('cadre init --dry-run')
    expect(out.text).toContain('Git policy: commit definitions')
    expect(out.text.split('\n')[2]).toBe('Launchers start in: the git root')
    expect(out.text).not.toContain('new worktrees')
    expect(out.text.endsWith('Dry run: nothing was written.')).toBe(true)
    expect(log.asks.filter(ask => ask === POLICY_ASK)).toHaveLength(1)
    const launchAsk = log.asks[log.asks.indexOf(POLICY_ASK) + 1] ?? ''
    expect(launchAsk.startsWith('ask Where should the role launchers start')).toBe(true)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops).not.toContain('process.run')
  })

  test('plain init prints the same reply but ends with the apply-later note', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text.split('\n')[0]).toBe('cadre init')
    expect(out.text).toContain('Git policy: commit definitions')
    expect(out.text.endsWith('Applying this plan arrives in a later cadre version; nothing was written.')).toBe(true)
    expect(out.text).not.toContain('Dry run')
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops).not.toContain('process.run')
  })

  test('init asks in order: consent, roles, framework, duration, model and effort, git policy', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const prefixes = [
      'ask Read ~/.claude.json',
      'ask Use these roles?',
      'ask Which framework do the roles use?',
      'ask Framework for all roles?',
      'ask Autopilot duration for roles?',
      'ask Model and effort: same for all roles, or per role?',
      'ask Model and effort for all roles?',
      POLICY_ASK,
    ]
    const order = log.asks.flatMap(ask => {
      const at = prefixes.findIndex(prefix => ask.startsWith(prefix))

      return at < 0 ? [] : [at]
    })
    expect(order).toEqual(prefixes.map((_, index) => index))
  })

  test('commit all prints its own policy line and no worktree line', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)')
    expect(out.text).not.toContain('new worktrees')
  })

  test('ignoring all of .cadre/ adds the line that role definitions will not exist in new worktrees', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Ignore all of .cadre/' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toContain('Git policy: ignore all of .cadre/')
    expect(out.text.split('\n')).toContain("role definitions won't exist in new worktrees (Phase 3.1)")
    expect(out.text.endsWith('Dry run: nothing was written.')).toBe(true)
  })

  test('a typed word the policy parser knows counts, with the same reply as the label', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': ' Ignore ' } }), newLog())
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toContain('Git policy: ignore all of .cadre/')
    expect(out.text.split('\n')).toContain("role definitions won't exist in new worktrees (Phase 3.1)")
  })

  test('the dialog shows the three policies in the fixed order, default first', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const at = log.asks.indexOf(POLICY_ASK)
    expect(at >= 0).toBe(true)
    expect(log.askOptions[at]).toEqual(['Commit definitions (default)', 'Commit all', 'Ignore all of .cadre/'])
  })

  test('in claude -p (no surfaces) init answers the refusal before any fs, settings or process op', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ surfaces: [] }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(NOT_INTERACTIVE_REPLY)
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a host that cannot say whether anyone is there is treated as non-interactive', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denySurfaces: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(NOT_INTERACTIVE_REPLY)
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session root the host refuses stops init before any read or question', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ denyRoot: true }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe('cadre init could not read the session root, so it stopped before reading anything.')
    expect(log.ops).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session at the home folder is refused with the init wording before any read or question', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
    expect(out.text).toContain('cadre init needs a repo root other than your home folder')
    expect(out.text).toContain('run /cadre init again')
    expect(log.ops).toContain('fs.stat /home/u resolve=true')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session in a folder that contains the home folder is refused the same way', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a symlinked repo root that lands in the home folder is refused by init too', async ($, on) => {
    const log = newLog()
    const linked = initWorld({ root: '/link/repo', realPaths: { '/link/repo': '/home/u', '/home/u': '/home/u' } })
    fakeHost(on, linked, log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(out.text).toBe(INIT_HOME_ROOT_REPLY)
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('a session at the file system root is refused with the init wording, even with no HOME', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/', env: {}, realPaths: { '/': '/' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe(INIT_FILE_SYSTEM_ROOT_REPLY)
    expect(out.text).toContain('cadre init needs a repo root other than the file system root (/)')
    expect(out.text).toContain('run /cadre init again')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
    expect(log.asks).toEqual([])
  })

  test('detect at the home folder still answers the detect wording, byte for byte', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ root: '/home/u' }), log)
    const out = await $.command.run({ command: 'cadre', args: 'detect' })
    expect(out.text).toBe(HOME_ROOT_REPLY)
    expect(out.text).toContain('cadre detect needs a repo root other than your home folder')
    expect(out.text).toContain('run /cadre detect again')
    expect(log.ops.filter(op => !op.startsWith('fs.stat '))).toEqual([])
  })

  test('a dismissed dialog cancels with the fixed text and never the host rejection text', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: answersWithout('Git policy') }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(out.text).toBe('init cancelled, nothing written')
    expect(out.text).not.toContain('dismissed')
    expect(log.asks.filter(ask => ask === POLICY_ASK)).toHaveLength(1)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
  })

  test('an answer that is not a listed choice is asked again, three asks in all, then init cancels', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'whatever' } }), log)
    const out = await $.command.run({ command: 'cadre', args: 'init' })
    expect(log.asks.filter(ask => ask === POLICY_ASK)).toHaveLength(3)
    expect(out.text).toBe('init cancelled, nothing written')
  })

  test('no mutating host op and no process call is made by init or init --dry-run', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    await $.command.run({ command: 'cadre', args: 'init' })
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops).not.toContain('process.run')
    expect(log.runs).toEqual([])
  })

  test('two init runs with the same answers give identical text', async ($, on) => {
    fakeHost(on, initWorld({ answers: { ...INIT_ANSWERS, 'Git policy': 'Commit all' } }), newLog())
    const first = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    const second = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(second.text).toBe(first.text)
  })

  test('init guards before it scans, asks the ~/.claude.json consent first and logs both scans', async ($, on) => {
    const log = newLog()
    fakeHost(on, initWorld(), log)
    const out = await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    expect(log.asks[0]?.startsWith('ask Read ~/.claude.json for MCP server names?')).toBe(true)
    const lines = log.logs.flatMap(text => text.split('\n'))
    expect(lines.some(line => line.startsWith('Repo scan (read-only):'))).toBe(true)
    expect(lines).toContain('User setup (names only):')
    const guardAt = log.ops.indexOf('fs.exists /home/u/.claude/autopilot/s1.json')
    expect(guardAt >= 0 && guardAt < log.ops.indexOf('fs.list /repo')).toBe(true)
    expect(log.ops.filter(op => op.startsWith('forbidden '))).toEqual([])
    expect(log.ops.filter(op => op === 'process.run').length <= 1).toBe(true)
    expect(out.text.endsWith('Dry run: nothing was written.')).toBe(true)
  })

  test('the init port never reads a folder: a folder the scans probe is checked and left unread', async ($, on) => {
    const log = newLog()
    const folders = ['/repo/.cadre', '/home/u/.claude/agents']
    const world = initWorld({ dirs: [...initWorld().dirs, ...folders] })
    fakeHost(on, world, log)
    await $.command.run({ command: 'cadre', args: 'init --dry-run' })
    for (const folder of folders) {
      expect(log.ops).toContain(`fs.exists ${folder}`)
      expect(log.ops.some(op => op.startsWith(`fs.stat ${folder} `))).toBe(true)
    }
    const known = [...Object.keys(world.listings), ...world.dirs]
    const read = log.ops.filter(op => op.startsWith('fs.read ')).map(op => op.slice('fs.read '.length))
    expect(read.filter(path => known.includes(path))).toEqual([])
  })
})
