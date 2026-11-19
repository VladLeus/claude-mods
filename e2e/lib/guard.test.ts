import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { HarnessError } from './errors.ts'
import { compareGuard, fenceRefusals, fleetBeats, globalAwayActive, guardSnapshot, keychainDigest } from './guard.ts'
import { needlesOf, projectTranscripts, removeSessionFiles, testSessionIds } from './guard.ts'
import type { GuardContext, GuardResult, KeychainDigest } from './guard.ts'
import { removeTree, scratchRoot } from './scratch.ts'

const RECORDED_ID = '11111111-1111-4111-8111-111111111111'
const UNRECORDED_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'
const SIBLING_ID = '44444444-4444-4444-8444-444444444444'
const E2E_BEAT_ID = '55555555-5555-4555-8555-555555555555'
const LOOSE_ID = '66666666-6666-4666-8666-666666666666'
const USER_CWD = '/Users/unit/work/app'
const DIGEST: KeychainDigest = { count: 3, hash: 'aaaaaaaaaaaa' }
const MTIME_STEP_MS = 5_000
const NOW = Date.parse('2026-11-11T12:00:00.000Z')

const KEYCHAIN_LINES = [
  'keychain: "/Users/unit/Library/Keychains/login.keychain-db"',
  'version: 512',
  'class: "genp"',
  'attributes:',
  '    "acct"<blob>="unit-account"',
  '    "svce"<blob>="Claude Code-credentials"',
  'class: "genp"',
  'attributes:',
  '    "svce"<blob>="Unit Other Service"',
  'class: "genp"',
  'attributes:',
  '    "svce"<blob>="Claude Code-credentials-0a1b2c3d"',
]

type Home = {
  readonly root: string
  readonly claude: string
}

type Case = {
  readonly prepare?: (home: Home) => Promise<void>
  readonly change: (home: Home) => Promise<void>
  readonly ctx?: Partial<GuardContext>
  readonly keychain?: KeychainDigest | null
}

let dir = ''
let homes = 0
let scratchBaseNeedle = ''
let e2eDirNeedle = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-guard-'))
  scratchBaseNeedle = join(dir, 'tmp', 'claude-mods-e2e')
  e2eDirNeedle = join(dir, 'cache', 'e2e-config')
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

function needles() {
  return needlesOf(scratchBaseNeedle, e2eDirNeedle)
}

function baseCtx(): GuardContext {
  return { needles: needles(), refusals: 0, recorded: new Set([RECORDED_ID]), beatCwds: new Map() }
}

async function put(path: string, text: string): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, text)
}

async function fakeHome(): Promise<Home> {
  homes += 1
  const root = join(dir, `home-${homes}`)
  const claude = join(root, '.claude')
  await put(join(root, '.claude.json'), '{"projects":{}}\n')
  await put(join(root, '.gitconfig'), '[user]\n\tname = unit\n')
  await put(join(claude, 'settings.json'), '{"enabledPlugins":{}}\n')
  await put(join(claude, 'history.jsonl'), '{}\n')
  await put(join(claude, 'plugins', 'known_marketplaces.json'), '{"mods":{}}\n')
  await put(join(claude, 'plugins', 'installed_plugins.json'), '{"version":2,"plugins":{}}\n')
  await put(join(claude, 'autopilot', 'status', 'global.json'), '{"v":1,"away":null,"askUser":null}\n')
  await put(join(claude, 'autopilot', `${OTHER_ID}.json`), '{"isOn":false}\n')
  await put(join(claude, 'autopilot', `${OTHER_ID}.log`), 'line\n')
  await put(join(claude, 'fleet', `${OTHER_ID}.json`), JSON.stringify({ id: OTHER_ID, cwd: USER_CWD }))
  await mkdir(join(claude, 'projects', '-Users-unit-work-app'), { recursive: true })
  await mkdir(join(claude, 'todos'))

  return { root, claude }
}

async function compared(item: Case): Promise<GuardResult> {
  const home = await fakeHome()
  if (item.prepare) await item.prepare(home)
  const first = await guardSnapshot(home.root, needles(), DIGEST)
  await item.change(home)
  const second = await guardSnapshot(home.root, needles(), item.keychain === undefined ? DIGEST : item.keychain)

  return compareGuard(first, second, { ...baseCtx(), ...item.ctx })
}

async function bumpMtime(path: string): Promise<void> {
  const stats = await stat(path)
  await utimes(path, stats.atime, new Date(stats.mtimeMs + MTIME_STEP_MS))
}

async function failsWith(item: Case, line: string): Promise<void> {
  assert.deepEqual((await compared(item)).failures, [line])
}

async function warnsWith(item: Case, lines: readonly string[]): Promise<void> {
  const result = await compared(item)

  assert.deepEqual(result.failures, [])
  for (const line of lines) assert.ok(result.warnings.includes(line), `missing warning: ${line}`)
}

test('identical snapshots give no failure and no warning', async () => {
  assert.deepEqual(await compared({ change: async () => {} }), { failures: [], warnings: [] })
})

test('a new projects/ entry named with the encoded scratch base or e2e dir fails', async () => {
  const [base, e2e] = needles().encoded
  const line = 'guard: 1 suite entries in projects/'

  await failsWith({ change: home => mkdir(join(home.claude, 'projects', `${base}-run-rows-x-repo`)) }, line)
  await failsWith({ change: home => mkdir(join(home.claude, 'projects', `${e2e}-sub`)) }, line)
})

test('a guard file newly naming the scratch base or the e2e dir fails', async () => {
  const scratchPath = join(scratchBaseNeedle, 'run', 'rows', 'x', 'repo')
  const e2ePath = join(e2eDirNeedle, 'projects')
  const cases = [
    { name: '.claude.json', text: JSON.stringify({ projects: { [scratchPath]: {} } }) },
    { name: '.claude/settings.json', text: JSON.stringify({ dir: e2ePath }) },
    { name: '.claude/plugins/known_marketplaces.json', text: JSON.stringify({ m: scratchPath }) },
    { name: '.claude/plugins/installed_plugins.json', text: JSON.stringify({ p: e2ePath }) },
  ]

  for (const item of cases) {
    const change = (home: Home): Promise<void> => writeFile(join(home.root, item.name), item.text)
    await failsWith({ change }, `guard: suite trace in ~/${item.name}`)
  }
})

test('a suite marker newly in a real plugin file fails', async () => {
  const known = (home: Home): string => join(home.claude, 'plugins', 'known_marketplaces.json')
  const installed = (home: Home): string => join(home.claude, 'plugins', 'installed_plugins.json')
  const plugins = (key: string): string => JSON.stringify({ version: 2, plugins: { [key]: [{ scope: 'user' }] } })

  await failsWith(
    { change: home => writeFile(known(home), '{"mods":{},"claude-plugins-official":{}}\n') },
    'guard: suite plugin claude-plugins-official added in ~/.claude/plugins/known_marketplaces.json',
  )
  await failsWith(
    { change: home => writeFile(installed(home), plugins('security-guidance@unit-market')) },
    'guard: suite plugin security-guidance@ added in ~/.claude/plugins/installed_plugins.json',
  )
  await failsWith(
    { change: home => writeFile(installed(home), plugins('cadre@local-mods')) },
    'guard: suite plugin cadre@local-mods added in ~/.claude/plugins/installed_plugins.json',
  )
})

test('a claude fence refusal fails', async () => {
  await failsWith(
    { change: async () => {}, ctx: { refusals: 1 } },
    'guard: claude started 1 times without the e2e config dir',
  )
})

test('a leftover file of a recorded session, or of one whose beat lies under a needle, fails', async () => {
  await failsWith(
    { change: home => put(join(home.claude, 'fleet', `${RECORDED_ID}.json`), '{}') },
    `guard: test session file left: ~/.claude/fleet/${RECORDED_ID}.json`,
  )
  await failsWith(
    {
      change: home => put(join(home.claude, 'autopilot', `${UNRECORDED_ID}.log`), 'line\n'),
      ctx: { beatCwds: new Map([[UNRECORDED_ID, join(scratchBaseNeedle, 'run', 'rows', 'x', 'repo')]]) },
    },
    `guard: test session file left: ~/.claude/autopilot/${UNRECORDED_ID}.log`,
  )
})

test('new projects/ entries with no needle and top-level entries appearing or disappearing only warn', async () => {
  await warnsWith(
    { change: home => mkdir(join(home.claude, 'projects', '-Users-unit-work-other')) },
    ['guard: 1 other new entries in projects/'],
  )
  await warnsWith(
    {
      change: async home => {
        await mkdir(join(home.claude, 'cache'))
        await rm(join(home.claude, 'todos'), { recursive: true })
      },
    },
    ['guard: ~/.claude/cache appeared during the run', 'guard: ~/.claude/todos disappeared during the run'],
  )
})

test('mtime changes of the config entries, ~/.claude.json and ~/.gitconfig only warn', async () => {
  const names = ['settings.json', 'plugins', 'projects', 'history.jsonl']

  await warnsWith(
    {
      change: async home => {
        for (const name of names) await bumpMtime(join(home.claude, name))
        await bumpMtime(join(home.root, '.claude.json'))
        await bumpMtime(join(home.root, '.gitconfig'))
      },
    },
    [
      ...names.map(name => `guard: ~/.claude/${name} changed during the run`),
      'guard: ~/.claude.json changed during the run',
      'guard: ~/.gitconfig changed during the run',
    ],
  )
})

test('a ~/.claude.json text change without a needle only warns, also when its mtime is kept', async () => {
  await warnsWith(
    {
      change: async home => {
        const path = join(home.root, '.claude.json')
        const stats = await stat(path)
        await writeFile(path, '{"projects":{"/Users/unit/work/app":{"trusted":true}}}\n')
        await utimes(path, stats.atime, stats.mtime)
      },
    },
    ['guard: ~/.claude.json changed during the run'],
  )
})

test('a marker the plugin file already held before the run only warns when the file changes', async () => {
  const path = (home: Home): string => join(home.claude, 'plugins', 'installed_plugins.json')

  await warnsWith(
    {
      prepare: home => writeFile(path(home), '{"plugins":{"claude-security@unit-market":[]}}\n'),
      change: async home => {
        await writeFile(path(home), '{"plugins":{"claude-security@unit-market":[],"tool@unit-market":[]}}\n')
        await bumpMtime(path(home))
      },
    },
    ['guard: ~/.claude/plugins/installed_plugins.json changed during the run'],
  )
})

test('session files no beat ties to the suite, ping locks and removed files only warn', async () => {
  await warnsWith(
    { change: home => put(join(home.claude, 'autopilot', `${UNRECORDED_ID}.log`), 'line\n') },
    [`guard: ~/.claude/autopilot/${UNRECORDED_ID}.log appeared during the run`],
  )
  await warnsWith(
    {
      change: home => put(join(home.claude, 'fleet', `${UNRECORDED_ID}.json`), JSON.stringify({ cwd: USER_CWD })),
      ctx: { beatCwds: new Map([[UNRECORDED_ID, USER_CWD]]) },
    },
    [`guard: ~/.claude/fleet/${UNRECORDED_ID}.json appeared during the run`],
  )
  await warnsWith(
    { change: home => mkdir(join(home.claude, 'autopilot', 'status', 'ping-1.lock')) },
    ['guard: ~/.claude/autopilot/status/ping-1.lock appeared during the run'],
  )
  await warnsWith(
    { change: home => rm(join(home.claude, 'fleet', `${OTHER_ID}.json`)) },
    [`guard: ~/.claude/fleet/${OTHER_ID}.json disappeared during the run`],
  )
})

test('a changed keychain digest and an unavailable listing only warn', async () => {
  await warnsWith(
    { change: async () => {}, keychain: { count: 4, hash: 'bbbbbbbbbbbb' } },
    ['guard: Claude Code keychain items changed (3 -> 4)'],
  )
  await warnsWith({ change: async () => {}, keychain: null }, ['guard: keychain listing unavailable'])
})

test('keychainDigest counts the Claude Code service names and hashes them in any line order', () => {
  const digest = keychainDigest(KEYCHAIN_LINES.join('\n'))
  const swapped = [...KEYCHAIN_LINES.slice(0, 5), ...KEYCHAIN_LINES.slice(9), ...KEYCHAIN_LINES.slice(5, 9)]

  assert.equal(digest.count, 2)
  assert.match(digest.hash, /^[0-9a-f]{12}$/)
  assert.deepEqual(keychainDigest(swapped.join('\n')), digest)
  assert.equal(keychainDigest('').count, 0)
})

test('globalAwayActive is true only for an away whose until lies after now', () => {
  const away = (value: unknown): string => JSON.stringify({ v: 1, away: value, askUser: null })

  assert.equal(globalAwayActive(away({ until: NOW + 1, setAt: 1 }), NOW), true)
  assert.equal(globalAwayActive(away({ until: NOW, setAt: 1 }), NOW), false)
  assert.equal(globalAwayActive(away({ until: NOW - 1, setAt: 1 }), NOW), false)
  assert.equal(globalAwayActive(away({ back: true }), NOW), false)
  assert.equal(globalAwayActive(away(null), NOW), false)
  assert.equal(globalAwayActive('{"v":1,"away":', NOW), false)
  assert.equal(globalAwayActive('', NOW), false)
})

test('testSessionIds takes the e2e transcripts and the beats under the scratch base or the e2e dir', () => {
  const ids = testSessionIds(
    [
      `-scratch-repo/${RECORDED_ID}.jsonl`,
      `-scratch-repo/${OTHER_ID}/subagents/agent-1.jsonl`,
      '-scratch-repo/notes.jsonl',
      `${LOOSE_ID}.jsonl`,
    ],
    [
      { id: UNRECORDED_ID, cwd: join(scratchBaseNeedle, 'run-1', 'rows', 'r', 'repo') },
      { id: SIBLING_ID, cwd: join(scratchBaseNeedle, 'run-0', 'preflight') },
      { id: E2E_BEAT_ID, cwd: join(e2eDirNeedle, 'sub') },
      { id: OTHER_ID, cwd: USER_CWD },
      { id: 'not-a-session', cwd: join(scratchBaseNeedle, 'run-1') },
      { id: LOOSE_ID, cwd: null },
    ],
    scratchBaseNeedle,
    e2eDirNeedle,
  )

  assert.deepEqual(ids, [RECORDED_ID, UNRECORDED_ID, SIBLING_ID, E2E_BEAT_ID].sort())
})

test('projectTranscripts and fleetBeats list the transcripts and read the beat cwds null-safe', async () => {
  const e2eDir = join(dir, 'readers', 'e2e')
  const home = join(dir, 'readers', 'home')
  await put(join(e2eDir, 'projects', '-scratch-repo', `${RECORDED_ID}.jsonl`), '{}\n')
  await put(join(e2eDir, 'projects', '-scratch-repo', OTHER_ID, 'subagents', 'agent-1.jsonl'), '{}\n')
  await put(join(home, '.claude', 'fleet', `${UNRECORDED_ID}.json`), JSON.stringify({ cwd: USER_CWD }))
  await put(join(home, '.claude', 'fleet', `${OTHER_ID}.json`), '{"cwd": ')

  assert.deepEqual(await projectTranscripts(e2eDir), [`-scratch-repo/${RECORDED_ID}.jsonl`])
  assert.deepEqual(await projectTranscripts(join(dir, 'readers', 'missing')), [])
  const beats = [...await fleetBeats(home)].sort((a, b) => a.id.localeCompare(b.id))
  assert.deepEqual(beats, [{ id: UNRECORDED_ID, cwd: USER_CWD }, { id: OTHER_ID, cwd: null }])
})

test('fenceRefusals counts the refused lines and gives 0 without a log', async () => {
  const root = join(dir, 'fence-root')
  await put(join(root, 'fence', 'refused.log'), 'refused\nrefused\n')

  assert.equal(await fenceRefusals(root), 2)
  assert.equal(await fenceRefusals(join(dir, 'no-fence')), 0)
})

test('removeSessionFiles removes exactly the four files of each id and nothing else', async () => {
  const home = await fakeHome()
  const own = [
    join('autopilot', `${RECORDED_ID}.json`),
    join('autopilot', `${RECORDED_ID}.log`),
    join('autopilot', 'status', `global.json.tmp-${RECORDED_ID}`),
    join('fleet', `${RECORDED_ID}.json`),
  ]
  for (const rel of own) await put(join(home.claude, rel), 'test session\n')
  await mkdir(join(home.claude, 'autopilot', 'status', 'ping-1.lock'))
  const kept = [
    join('autopilot', 'status', 'global.json'),
    join('autopilot', `${OTHER_ID}.json`),
    join('autopilot', `${OTHER_ID}.log`),
    join('fleet', `${OTHER_ID}.json`),
  ]
  const keptBefore = await Promise.all(kept.map(rel => readFile(join(home.claude, rel), 'utf8')))

  assert.deepEqual(await removeSessionFiles(home.root, [RECORDED_ID]), { removed: 4, failures: [] })
  for (const rel of own) assert.equal(existsSync(join(home.claude, rel)), false, rel)
  assert.deepEqual(await Promise.all(kept.map(rel => readFile(join(home.claude, rel), 'utf8'))), keptBefore)
  assert.equal((await stat(join(home.claude, 'autopilot', 'status', 'ping-1.lock'))).isDirectory(), true)
})

test('removeSessionFiles reports a symlink without following it and refuses a non-session id', async () => {
  const home = await fakeHome()
  const target = join(dir, `beat-target-${homes}.json`)
  await writeFile(target, 'target\n')
  await symlink(target, join(home.claude, 'fleet', `${UNRECORDED_ID}.json`))

  const removal = await removeSessionFiles(home.root, [UNRECORDED_ID])
  assert.deepEqual(removal, { removed: 0, failures: [join('fleet', `${UNRECORDED_ID}.json`)] })
  assert.equal(await readFile(target, 'utf8'), 'target\n')
  assert.equal(existsSync(join(home.claude, 'fleet', `${UNRECORDED_ID}.json`)), true)

  await put(join(home.claude, 'fleet', `${RECORDED_ID}.json`), '{}')
  await assert.rejects(removeSessionFiles(home.root, [RECORDED_ID, '../fleet/x']), HarnessError)
  assert.equal(existsSync(join(home.claude, 'fleet', `${RECORDED_ID}.json`)), true)
})
