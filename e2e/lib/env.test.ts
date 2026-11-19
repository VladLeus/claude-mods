import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, stat, symlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { after, before, test } from 'node:test'
import { fenceBin, gitConfigText, liveEnv, SYSTEM_PATH, writeClaudeFence } from './env.ts'
import type { HostUser } from './env.ts'
import { HarnessError } from './errors.ts'
import { run } from './proc.ts'
import { removeTree, scratchRoot } from './scratch.ts'

const CLAUDE_BIN = '/opt/unit/bin/claude'
const SHIM_DIR = '/opt/unit/shims'
const FENCE_REFUSAL = 'e2e fence: claude without the e2e config dir\n'
const TIMEOUT_MS = 10_000
const NEVER_PASSED = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDECODE',
  'CLAUDE_CODE_SESSION_ID',
  'TMUX',
  'TERM_PROGRAM',
]

let dir = ''
let e2eDir = ''
let shellHome = ''
let host: HostUser = { home: '', user: '' }

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-env-'))
  e2eDir = join(dir, 'e2e-config')
  shellHome = join(dir, 'home')
  host = { home: join(dir, 'host-home'), user: 'unitperson' }
  await mkdir(e2eDir)
  await mkdir(shellHome)
  await mkdir(join(host.home, '.claude', 'nested'), { recursive: true })
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

function callerEnv(over: Record<string, string> = {}): Record<string, string> {
  return {
    E2E_SCRATCH: dir,
    E2E_CLAUDE_BIN: CLAUDE_BIN,
    E2E_CONFIG_DIR: e2eDir,
    TMPDIR: '/unit/tmp',
    HOME: '/caller/home',
    USER: 'caller',
    ANTHROPIC_API_KEY: 'unit-api-key',
    ANTHROPIC_AUTH_TOKEN: 'unit-auth-token',
    CLAUDE_CODE_OAUTH_TOKEN: 'unit-oauth-token',
    CLAUDECODE: '1',
    CLAUDE_CODE_SESSION_ID: 'unit-session',
    TMUX: '/unit/tmux,1,0',
    TERM_PROGRAM: 'unit-term',
    ...over,
  }
}

function refusal(message: RegExp): { name: string, message: RegExp } {
  return { name: 'HarnessError', message }
}

test('liveEnv holds exactly the allowlist with the host home and user and the e2e config dir', () => {
  const env = liveEnv({ shimDir: SHIM_DIR, env: callerEnv(), host })

  assert.deepEqual(env, {
    PATH: [SHIM_DIR, join(dir, 'fence'), dirname(CLAUDE_BIN), dirname(process.execPath), SYSTEM_PATH].join(':'),
    HOME: host.home,
    USER: host.user,
    CLAUDE_CONFIG_DIR: e2eDir,
    LANG: 'en_US.UTF-8',
    TERM: 'xterm-256color',
    TMPDIR: '/unit/tmp',
    ANTHROPIC_MODEL: 'haiku',
    CLAUDE_CODE_EFFORT_LEVEL: 'medium',
    CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: '1',
    CLAUDE_CODE_DISABLE_TERMINAL_TITLE: '1',
    CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: 'false',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: '1',
    CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL: '1',
    GIT_CONFIG_GLOBAL: join(dir, 'gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    npm_config_cache: join(dir, 'npm-cache'),
  })
  for (const name of NEVER_PASSED) assert.equal(name in env, false, name)
})

test('the live PATH holds the fence dir right after the row shim dir and before the claude dir', () => {
  const withShim = liveEnv({ shimDir: SHIM_DIR, env: callerEnv(), host }).PATH?.split(':') ?? []
  const noShim = liveEnv({ env: callerEnv(), host }).PATH?.split(':') ?? []

  assert.deepEqual(withShim.slice(0, 3), [SHIM_DIR, join(dir, 'fence'), dirname(CLAUDE_BIN)])
  assert.deepEqual(noShim.slice(0, 2), [join(dir, 'fence'), dirname(CLAUDE_BIN)])
})

test('liveEnv refuses a relative home folder, an empty user name and an unset claude binary', () => {
  const noBin = callerEnv()
  delete noBin.E2E_CLAUDE_BIN

  assert.throws(() => liveEnv({ env: callerEnv(), host: { home: 'unit/home', user: host.user } }), HarnessError)
  assert.throws(() => liveEnv({ env: callerEnv(), host: { home: host.home, user: '' } }), HarnessError)
  assert.throws(() => liveEnv({ env: noBin, host }), HarnessError)
  assert.equal(liveEnv({ claudeBin: CLAUDE_BIN, env: noBin, host }).PATH?.split(':')[1], dirname(CLAUDE_BIN))
})

test('liveEnv refuses an unset or empty config dir and a dir other than the e2e dir', async () => {
  const other = join(dir, 'other-config')
  await mkdir(other)
  const unset = callerEnv()
  delete unset.E2E_CONFIG_DIR

  assert.throws(() => liveEnv({ env: unset, host }), refusal(/unset or empty/))
  assert.throws(() => liveEnv({ env: callerEnv({ E2E_CONFIG_DIR: '' }), host }), refusal(/unset or empty/))
  assert.throws(() => liveEnv({ configDir: '', env: callerEnv(), host }), refusal(/unset or empty/))
  assert.throws(() => liveEnv({ configDir: other, env: callerEnv(), host }), refusal(/not the e2e config dir/))
  assert.throws(() => liveEnv({ configDir: join(dir, 'missing'), env: callerEnv(), host }), HarnessError)
})

test('liveEnv refuses the real config dir, a folder under it, a link to it and the caller\'s own dir', async () => {
  const real = join(host.home, '.claude')
  const link = join(dir, 'link-to-claude')
  const own = join(dir, 'own-config')
  await symlink(real, link)
  await mkdir(own)

  for (const path of [real, join(real, 'nested'), link]) {
    assert.throws(() => liveEnv({ env: callerEnv({ E2E_CONFIG_DIR: path }), host }), refusal(/real config dir/), path)
  }
  const ownEnv = callerEnv({ E2E_CONFIG_DIR: own, CLAUDE_CONFIG_DIR: own })
  assert.throws(() => liveEnv({ env: ownEnv, host }), refusal(/real config dir/))
})

test('writeClaudeFence writes a mode-700 claude that refuses without the e2e dir and execs with it', async () => {
  const root = join(dir, 'fence-root')
  const log = join(root, 'fence', 'refused.log')
  const fence = await writeClaudeFence(root, '/usr/bin/printf', e2eDir)
  const base = { PATH: '/usr/bin:/bin', HOME: shellHome }

  assert.equal(fence, join(root, 'fence', 'claude'))
  assert.equal((await stat(fence)).mode & 0o777, 0o700)
  assert.equal(await readFile(join(root, 'gitconfig'), 'utf8'), gitConfigText())
  const unset = await run([fence, '<%s>', 'a'], { cwd: dir, env: base, timeoutMs: TIMEOUT_MS })
  assert.deepEqual(unset, { code: 97, stdout: '', stderr: FENCE_REFUSAL })
  const otherEnv = { ...base, CLAUDE_CONFIG_DIR: join(dir, 'other-config') }
  const other = await run([fence, '<%s>', 'a'], { cwd: dir, env: otherEnv, timeoutMs: TIMEOUT_MS })
  assert.deepEqual(other, { code: 97, stdout: '', stderr: FENCE_REFUSAL })
  assert.equal(await readFile(log, 'utf8'), 'refused\nrefused\n')
  const passEnv = { ...base, CLAUDE_CONFIG_DIR: e2eDir }
  const passed = await run([fence, '<%s>', 'a', 'b c'], { cwd: dir, env: passEnv, timeoutMs: TIMEOUT_MS })
  assert.deepEqual(passed, { code: 0, stdout: '<a><b c>', stderr: '' })
  assert.equal(await readFile(log, 'utf8'), 'refused\nrefused\n')
})

test('writeClaudeFence refuses a path holding a single quote or a newline and writes nothing', async () => {
  const root = join(dir, 'quote-root')

  await assert.rejects(writeClaudeFence(root, '/opt/unit\'s/claude', e2eDir), HarnessError)
  await assert.rejects(writeClaudeFence(root, CLAUDE_BIN, `${e2eDir}\nx`), HarnessError)
  await assert.rejects(writeClaudeFence(`${root}'x`, CLAUDE_BIN, e2eDir), HarnessError)
  assert.equal(existsSync(root), false)
})

test('fenceBin returns the fence under E2E_SCRATCH once it is written and throws before', async () => {
  const root = join(dir, 'bin-root')

  assert.throws(() => fenceBin({ E2E_SCRATCH: root }), HarnessError)
  await writeClaudeFence(root, CLAUDE_BIN, e2eDir)
  assert.equal(fenceBin({ E2E_SCRATCH: root }), join(root, 'fence', 'claude'))
})
