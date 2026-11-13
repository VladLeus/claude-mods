import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  agentSidecar,
  answerRefusal,
  claimRefusal,
  claimsTaken,
  filterLines,
  HISTORY_LINES_DEFAULT,
  HISTORY_LINES_MAX,
  isWsId,
  keysRefusal,
  NOTE_MAX_CHARS,
  NOTES_MAX,
  parseCommand,
  parseGuardSnapshot,
  parseRunState,
  parseWsState,
  sendRefusal,
  tokenHash,
  tokenRefusal,
  windowNameFor,
  wsIdOf,
} from './agent.ts'
import type { RunState, WsState } from './agent.ts'
import type { FilterContext } from './filter.ts'
import type { GuardSnapshot } from './guard.ts'
import type { Sidecar } from './summary.ts'

const RUN = '261113-090000-abcd'
const WS = '03-10-ab12'
const UUID_A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const UUID_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const SCREENS = [{ label: 'claude', text: '❯ ready' }]
const META = { row: '03#10', durationMs: 1234, screens: SCREENS }

function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key))
}

function refused(argv: readonly string[]): void {
  assert.equal(typeof parseCommand(argv), 'string', argv.join(' '))
}

test('parseCommand reads begin, hold and end', () => {
  assert.deepEqual(parseCommand(['begin', '--fixtures', RUN]), { verb: 'begin', fixtures: RUN })
  assert.deepEqual(parseCommand(['hold', RUN]), { verb: 'hold', run: RUN })
  assert.deepEqual(parseCommand(['end', '--token', 'f00d']), { verb: 'end', token: 'f00d' })
  assert.deepEqual(parseCommand(['end']), { verb: 'end', token: null })
})

test('parseCommand refuses a bad run id, a missing value, an unknown verb and an unknown flag', () => {
  refused(['begin', '--fixtures', '261113-0900-abcd'])
  refused(['begin', '--fixtures'])
  refused(['begin'])
  refused(['begin', RUN])
  refused(['hold', 'latest'])
  refused(['end', '--token'])
  refused(['launch'])
  refused([])
  refused(['begin', '--fixtures', RUN, '--fast'])
  refused(['begin', '--fixtures', RUN, '--fixtures', RUN])
})

test('parseCommand reads fixture and refuses --exclusive, a missing row, a bad variant and a bad row id', () => {
  assert.deepEqual(parseCommand(['fixture', 'gsd-dir', '--row', '03.2#15b']), {
    verb: 'fixture',
    variant: 'gsd-dir',
    row: '03.2#15b',
  })
  refused(['fixture', 'gsd', '--row', '03#10', '--exclusive'])
  refused(['fixture', 'gsd'])
  refused(['fixture', 'GSD', '--row', '03#10'])
  refused(['fixture', 'gsd', '--row', '03-10'])
})

test('parseCommand reads start for the root window and for a role with --cwd, --wt and --raw', () => {
  assert.deepEqual(parseCommand(['start', WS, 'root']), {
    verb: 'start',
    ws: WS,
    role: 'root',
    cwd: null,
    wt: null,
    raw: false,
  })
  assert.deepEqual(parseCommand(['start', WS, 'qa', '--raw', '--wt', 'proj-1-add-retry', '--cwd', 'src/app']), {
    verb: 'start',
    ws: WS,
    role: 'qa',
    cwd: 'src/app',
    wt: 'proj-1-add-retry',
    raw: true,
  })
})

test('parseCommand refuses start with a bad workspace, role, folder or worktree', () => {
  assert.notEqual(typeof parseCommand(['start', WS, 'qa']), 'string')
  refused(['start', '03#10', 'qa'])
  refused(['start', WS, 'QA'])
  refused(['start', WS])
  refused(['start', WS, 'qa', 'be'])
  refused(['start', WS, 'qa', '--cwd', '../up'])
  refused(['start', WS, 'qa', '--cwd', 'src/../..'])
  refused(['start', WS, 'qa', '--cwd', '/abs'])
  refused(['start', WS, 'qa', '--cwd', 'src//app'])
  refused(['start', WS, 'qa', '--wt', '../x'])
  refused(['start', WS, 'qa', '--wt', 'a/b'])
  refused(['start', WS, 'root', '--raw'])
})

test('parseCommand reads capture with --history and --lines from 1 to 2000, 200 by default', () => {
  assert.deepEqual(parseCommand(['capture', WS, 'claude']), {
    verb: 'capture',
    ws: WS,
    window: 'claude',
    history: false,
    lines: HISTORY_LINES_DEFAULT,
  })
  assert.deepEqual(parseCommand(['capture', WS, 'cadre-be-2', '--history', '--lines', '2000']), {
    verb: 'capture',
    ws: WS,
    window: 'cadre-be-2',
    history: true,
    lines: HISTORY_LINES_MAX,
  })
  assert.deepEqual(parseCommand(['capture', WS, 'claude', '--lines', '1']), {
    verb: 'capture',
    ws: WS,
    window: 'claude',
    history: false,
    lines: 1,
  })
  for (const lines of ['0', '2001', '12x', '-3', '1.5']) refused(['capture', WS, 'claude', '--lines', lines])
  refused(['capture', WS, 'two words'])
  refused(['capture', WS])
})

test('parseCommand reads finish and help and refuses extra arguments', () => {
  assert.deepEqual(parseCommand(['finish', WS]), { verb: 'finish', ws: WS })
  assert.deepEqual(parseCommand(['help']), { verb: 'help' })
  refused(['finish'])
  refused(['finish', '03#10'])
  refused(['help', 'me'])
})

test('parseCommand reads claim with its roles and --wait from 0 to 540 seconds, and refuses a bad role or wait', () => {
  assert.deepEqual(parseCommand(['claim', WS, 'be', 'tl']), { verb: 'claim', ws: WS, roles: ['be', 'tl'], waitMs: 0 })
  assert.deepEqual(parseCommand(['claim', WS, '--wait', '540', 'qa']), {
    verb: 'claim',
    ws: WS,
    roles: ['qa'],
    waitMs: 540_000,
  })
  assert.deepEqual(parseCommand(['claim', WS, 'pm', '--wait', '0']), {
    verb: 'claim',
    ws: WS,
    roles: ['pm'],
    waitMs: 0,
  })
  for (const wait of ['541', '-1', '1.5', 'soon', '']) refused(['claim', WS, 'be', '--wait', wait])
  refused(['claim', WS])
  refused(['claim', WS, 'BE'])
  refused(['claim', WS, 'root'])
  refused(['claim', WS, 'be', 'be'])
  refused(['claim', '03#10', 'be'])
})

test('parseCommand reads windows, trust, idle and stop and refuses a bad workspace or window', () => {
  assert.deepEqual(parseCommand(['windows', WS]), { verb: 'windows', ws: WS })
  for (const verb of ['trust', 'idle', 'stop']) {
    assert.deepEqual(parseCommand([verb, WS, 'cadre-be-2']), { verb, ws: WS, window: 'cadre-be-2' })
    refused([verb, WS])
    refused([verb, WS, 'cadre be'])
    refused([verb, '03#10', 'claude'])
    refused([verb, WS, 'claude', 'extra'])
  }
  refused(['windows'])
  refused(['windows', WS, 'claude'])
})

test('parseCommand reads send, answer and other text as one argument and refuses an empty or multi-line text', () => {
  const epic = '/cadre epic PROJ-1 Add retry --terminal=tmux'

  assert.deepEqual(parseCommand(['send', WS, 'claude', epic]), { verb: 'send', ws: WS, window: 'claude', text: epic })
  assert.deepEqual(parseCommand(['send', WS, 'cadre-be', '--global']), {
    verb: 'send',
    ws: WS,
    window: 'cadre-be',
    text: '--global',
  })
  assert.deepEqual(parseCommand(['answer', WS, 'claude', 'Yes, install']), {
    verb: 'answer',
    ws: WS,
    window: 'claude',
    label: 'Yes, install',
  })
  assert.deepEqual(parseCommand(['other', WS, 'claude', 'FE']), { verb: 'other', ws: WS, window: 'claude', text: 'FE' })
  for (const verb of ['send', 'answer', 'other']) {
    refused([verb, WS, 'claude'])
    refused([verb, WS, 'claude', '/cadre', 'init'])
    refused([verb, WS, 'claude', ''])
    refused([verb, WS, 'claude', '   '])
    refused([verb, WS, 'claude', 'hi\r/login'])
    refused([verb, WS, 'claude', 'line one\nline two'])
    refused([verb, WS, 'claude', 'up \u001b[A'])
    refused([verb, '03#10', 'claude', 'hi'])
    refused([verb, WS, 'two words', 'hi'])
  }
})

test('parseCommand reads keys with at least one key', () => {
  assert.deepEqual(parseCommand(['keys', WS, 'claude', 'Down', 'Down', 'Enter']), {
    verb: 'keys',
    ws: WS,
    window: 'claude',
    keys: ['Down', 'Down', 'Enter'],
  })
  refused(['keys', WS, 'claude'])
  refused(['keys', '03#10', 'claude', 'Enter'])
})

test('parseCommand reads wait with a regex and --timeout from 1 to 540 seconds, 60 by default', () => {
  assert.deepEqual(parseCommand(['wait', WS, 'cadre-be', 'Saved|DONE']), {
    verb: 'wait',
    ws: WS,
    window: 'cadre-be',
    pattern: /Saved|DONE/m,
    timeoutMs: 60_000,
  })
  assert.deepEqual(parseCommand(['wait', WS, 'claude', '^❯', '--timeout', '540']), {
    verb: 'wait',
    ws: WS,
    window: 'claude',
    pattern: /^❯/m,
    timeoutMs: 540_000,
  })
  assert.deepEqual(parseCommand(['wait', WS, 'claude', 'ready', '--timeout', '1']), {
    verb: 'wait',
    ws: WS,
    window: 'claude',
    pattern: /ready/m,
    timeoutMs: 1000,
  })
  for (const timeout of ['0', '541', '1.5', 'soon']) refused(['wait', WS, 'claude', 'ready', '--timeout', timeout])
  for (const source of ['(unclosed', '[z-a]', '']) refused(['wait', WS, 'claude', source])
  refused(['wait', WS, 'claude'])
})

test('tokenRefusal accepts only the token whose sha256 hex is stored', () => {
  const stored = tokenHash('f00d')
  const cases: readonly (readonly [string | null | undefined, string | null | undefined])[] = [
    [null, stored],
    [undefined, stored],
    ['', stored],
    ['beef', stored],
    ['f00d', null],
    ['f00d', undefined],
    ['f00d', ''],
  ]

  assert.equal(tokenHash('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  assert.equal(tokenRefusal('f00d', stored), null)
  for (const [token, hash] of cases) assert.equal(typeof tokenRefusal(token, hash), 'string', `${token} ${hash}`)
})

test('wsIdOf joins the row id and the hex, and isWsId accepts only that shape', () => {
  assert.equal(wsIdOf('03#10', 'ab12'), '03-10-ab12')
  assert.equal(wsIdOf('03.2#15b', 'ab12'), '03.2-15b-ab12')
  assert.equal(wsIdOf('03-10', 'ab12'), null)
  assert.equal(wsIdOf('03#10', 'AB12'), null)
  assert.equal(wsIdOf('03#10', 'ab1'), null)
  assert.equal(isWsId('03-10-ab12'), true)
  assert.equal(isWsId('03.2-15b-ab12'), true)
  for (const value of ['03#10', '03-10', '03-10-ab12/..', '../03-10-ab12', '03-10-AB12', '']) {
    assert.equal(isWsId(value), false, value)
  }
})

test('windowNameFor numbers a taken role window and names the root window claude', () => {
  assert.equal(windowNameFor('be', []), 'cadre-be')
  assert.equal(windowNameFor('be', ['cadre-be']), 'cadre-be-2')
  assert.equal(windowNameFor('be', ['cadre-be', 'cadre-be-2']), 'cadre-be-3')
  assert.equal(windowNameFor('root', []), 'claude')
  assert.equal(windowNameFor('root', ['claude']), null)
  for (const role of ['Be', '1be', 'b e', '', '-be']) assert.equal(windowNameFor(role, []), null, role)
})

function runState(): RunState {
  return {
    run: RUN,
    root: '/private/tmp/claude-mods-e2e/261113-090000-abcd',
    e2eDir: '/Users/unitperson/.cache/claude-mods-e2e/config',
    claudeBin: '/usr/local/bin/claude',
    claude: '2.1.400 (Claude Code)',
    fixtures: '/private/tmp/claude-mods-e2e/261113-080000-beef',
    filterFile: '/private/tmp/claude-mods-e2e/261113-090000-abcd/auth/filter.json',
    startedAt: 1_763_024_400_000,
    holderPid: 4242,
    tokenHash: tokenHash('f00d'),
  }
}

function wsState(): WsState {
  return {
    id: WS,
    row: '03#10',
    variant: 'gsd',
    exclusive: false,
    socket: 'e2e-abcd-0a1b2c',
    startedAt: 1_763_024_400_000,
    status: 'live',
    windows: [{ name: 'claude', kind: 'root' }, { name: 'cadre-qa', kind: 'role' }],
    claims: ['qa'],
    uuids: [[UUID_A, 1], [UUID_B, 2]],
  }
}

test('parseRunState returns the state for a valid object and null for a missing field or a wrong type', () => {
  const state = runState()

  assert.deepEqual(parseRunState(JSON.parse(JSON.stringify(state))), state)
  assert.equal(parseRunState(without(state, 'holderPid')), null)
  assert.equal(parseRunState(without(state, 'tokenHash')), null)
  assert.equal(parseRunState({ ...state, startedAt: '1763024400000' }), null)
  assert.equal(parseRunState({ ...state, claude: null }), null)
  assert.equal(parseRunState(null), null)
  assert.equal(parseRunState([]), null)
})

test('parseWsState round-trips the uuid list as [uuid, number] pairs and refuses a wrong shape', () => {
  const state = wsState()

  assert.deepEqual(parseWsState(JSON.parse(JSON.stringify(state))), state)
  assert.equal(parseWsState(without(state, 'socket')), null)
  assert.equal(parseWsState(without(state, 'uuids')), null)
  assert.equal(parseWsState({ ...state, status: 'gone' }), null)
  assert.equal(parseWsState({ ...state, exclusive: 'no' }), null)
  assert.equal(parseWsState({ ...state, windows: [{ name: 'claude', kind: 'shell' }] }), null)
  assert.equal(parseWsState({ ...state, claims: [1] }), null)
  assert.equal(parseWsState({ ...state, uuids: [[UUID_A, '1']] }), null)
  assert.equal(parseWsState({ ...state, uuids: [[UUID_A]] }), null)
  assert.equal(parseWsState({ ...state, uuids: [{ uuid: UUID_A, number: 1 }] }), null)
})

function snapshot(keychain: GuardSnapshot['keychain']): GuardSnapshot {
  return {
    top: [{ name: 'projects', kind: 'dir', mtimeMs: 1_763_024_400_123.5 }],
    projects: ['-Users-unitperson-work'],
    files: [{ name: '.claude.json', mtimeMs: null, size: null, needles: [false, true], markers: [] }],
    sessionFiles: ['fleet/a.json'],
    keychain,
  }
}

test('parseGuardSnapshot round-trips a snapshot with a keychain digest, null or none and refuses a wrong shape', () => {
  for (const keychain of [{ count: 2, hash: 'abcdef012345' }, null, undefined]) {
    const snap = snapshot(keychain)
    assert.deepEqual(parseGuardSnapshot(JSON.parse(JSON.stringify(snap))), snap)
  }
  const snap = snapshot(null)
  assert.equal(parseGuardSnapshot({ ...snap, top: [{ name: 'x', kind: 'pipe', mtimeMs: 1 }] }), null)
  assert.equal(parseGuardSnapshot({ ...snap, files: [{ name: '.claude.json' }] }), null)
  assert.equal(parseGuardSnapshot({ ...snap, keychain: { count: '2', hash: 'abcdef012345' } }), null)
  assert.equal(parseGuardSnapshot({ ...snap, sessionFiles: 'fleet/a.json' }), null)
  assert.equal(parseGuardSnapshot(without(snap, 'projects')), null)
  assert.equal(parseGuardSnapshot([]), null)
})

function result(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    row: '03#10',
    half: '',
    title: 'The role session keeps ROLE.md after /clear',
    kind: 'pass',
    verdict: 'pass',
    reason: '',
    checks: [{ name: 'quotes ROLE.md after /clear', ok: true, expected: 'a ROLE.md line', observed: 'line 3' }],
    observations: [{ name: 'engine', value: { version: '2.1.400', latest: true }, evidence: 'claude --version' }],
    evidence: [{ label: 'after /clear', text: 'You are QA.' }],
    notAutomated: [{ name: 'the 2.1.295 half', reason: 'manual later' }],
    ...over,
  }
}

test('agentSidecar turns a valid result into a live agent sidecar', () => {
  const expected: Sidecar = {
    schema: 1,
    id: '03#10',
    half: '',
    title: 'The role session keeps ROLE.md after /clear',
    tier: 'live',
    kind: 'pass',
    verdict: 'pass',
    reason: '',
    checks: [{ name: 'quotes ROLE.md after /clear', ok: true, message: 'expected: a ROLE.md line; observed: line 3' }],
    observations: [{ name: 'engine', value: { version: '2.1.400', latest: true }, evidence: 'claude --version' }],
    evidence: [{ label: 'after /clear', text: 'You are QA.' }],
    screens: SCREENS,
    notAutomated: [{ name: 'the 2.1.295 half', reason: 'manual later' }],
    cassette: 'agent',
    durationMs: 1234,
  }

  assert.deepEqual(agentSidecar(result(), META), expected)
})

test('agentSidecar refuses a bad verdict or kind, a missing reason or checks, another row and a non-JSON value', () => {
  const recorded = result({ kind: 'recorded', verdict: 'recorded', reason: 'the prompt shows', checks: [] })
  const refusedInputs: readonly unknown[] = [
    result({ verdict: 'maybe' }),
    result({ verdict: 'fail', reason: '' }),
    result({ verdict: 'skipped', reason: '   ' }),
    result({ verdict: 'pass', checks: [] }),
    result({ verdict: 'fail', reason: 'no ROLE.md line', checks: [] }),
    result({ kind: 'judged' }),
    result({ row: '03#11' }),
    result({ half: 'c' }),
    result({ observations: [{ name: 'engine', value: Number.NaN, evidence: '' }] }),
    result({ observations: [{ name: 'engine', value: undefined, evidence: '' }] }),
    result({ checks: [{ name: 'x', ok: 'yes', expected: '', observed: '' }] }),
    without(result(), 'notAutomated'),
    'a text',
    null,
  ]

  assert.notEqual(typeof agentSidecar(recorded, META), 'string')
  for (const input of refusedInputs) assert.equal(typeof agentSidecar(input, META), 'string', JSON.stringify(input))
})

test('agentSidecar cuts a note over NOTE_MAX_CHARS to end in … and refuses more than NOTES_MAX notes', () => {
  const exact = 'y'.repeat(NOTE_MAX_CHARS)
  const notes = Array.from({ length: NOTES_MAX + 1 }, (_item, index) => ({ label: `note ${index}`, text: 'x' }))
  const row = agentSidecar(result({ evidence: [{ label: 'long', text: 'x'.repeat(NOTE_MAX_CHARS + 10) }] }), META)
  const kept = agentSidecar(result({ evidence: [{ label: 'exact', text: exact }] }), META)

  assert.notEqual(typeof row, 'string')
  assert.notEqual(typeof kept, 'string')
  if (typeof row === 'string' || typeof kept === 'string') return
  const text = row.evidence[0]?.text ?? ''
  assert.equal(text.length, NOTE_MAX_CHARS)
  assert.equal(text.endsWith('…'), true)
  assert.equal(kept.evidence[0]?.text, exact)
  assert.notEqual(typeof agentSidecar(result({ evidence: notes.slice(0, NOTES_MAX) }), META), 'string')
  assert.equal(typeof agentSidecar(result({ evidence: notes }), META), 'string')
})

function filterCtx(): FilterContext {
  return {
    envSecrets: [],
    credentials: [],
    identities: ['Unit Display Person'],
    scratch: ['/private/tmp/unit-scratch'],
    home: '/Users/unitperson',
    user: 'unitperson',
    hosts: ['unit-host'],
    run: null,
    uuids: new Map(),
  }
}

test('filterLines prints the filtered text when no residue is left', () => {
  const text = `home /Users/unitperson/work\nscratch /private/tmp/unit-scratch/ws\nname Unit Display Person ${UUID_A}`

  assert.equal(filterLines(text, filterCtx()), 'home ~/work\nscratch <scratch>/ws\nname <identity> <uuid-1>')
})

test('filterLines withholds each line the leak check names and prints the other lines filtered', () => {
  const text = 'home /Users/unitperson/work\ntemp /private/var/folders/xy/T/other\nscratch /private/tmp/unit-scratch/ws'
  const expected = 'home ~/work\n[line withheld: it failed the leak check]\nscratch <scratch>/ws'

  assert.equal(filterLines(text, filterCtx()), expected)
})

test('sendRefusal refuses !, /login, --global, /plugin, an unsafe epic and root free text and allows the rest', () => {
  const refusals: readonly (readonly [string, boolean])[] = [
    ['!ls', false],
    ['  !ls', true],
    ['/login', true],
    ['/logout', false],
    ['/away --global', false],
    ['/back --global', true],
    ['/plugin install superpowers@claude-plugins-official', true],
    ['/plugin marketplace add anthropics/claude-plugins-official', false],
    ['/cadre epic PROJ-1 Add retry', true],
    ['/cadre epic PROJ-1 Add retry --terminal=terminal', true],
    ['/cadre epic PROJ-1 Add retry --terminal=tmux --terminal=terminal', true],
    ['/cadre epic PROJ-1 Add retry --terminal tmux', true],
    ['Add a retry to the client', true],
    [' /cadre init', true],
  ]
  const allowed: readonly (readonly [string, boolean])[] = [
    ['/cadre init', true],
    ['/cadre epic PROJ-1 Add retry --terminal=tmux', true],
    ['/cadre epic PROJ-1 Add retry --terminal=none', true],
    ['/cadre epic done PROJ-1', true],
    ['/reload-plugins', true],
    ['Save a memory that the retry limit is 3', false],
  ]

  for (const [text, root] of refusals) assert.notEqual(sendRefusal(text, { exclusive: false, root }), null, text)
  for (const [text, root] of allowed) assert.equal(sendRefusal(text, { exclusive: false, root }), null, text)
  assert.equal(sendRefusal('/plugin marketplace add x', { exclusive: true, root: true }), null)
  assert.notEqual(sendRefusal('/login', { exclusive: true, root: true }), null)
  assert.notEqual(sendRefusal('/plugin install x --global', { exclusive: true, root: true }), null)
})

test('answerRefusal refuses an Install or Yes, install answer outside an exclusive workspace', () => {
  for (const label of ['Install', 'install superpowers', 'INSTALL', 'Yes, install', 'yes, install claude-security']) {
    assert.notEqual(answerRefusal(label, false), null, label)
    assert.equal(answerRefusal(label, true), null, label)
  }
  for (const label of ['Yes', 'Confirm', 'No, skip the install', 'Yes, I trust this folder', 'FE']) {
    assert.equal(answerRefusal(label, false), null, label)
  }
})

test('keysRefusal allows only Enter, Escape, the arrows, Tab, BTab, Space, BSpace, the page keys and C-c', () => {
  const keyLists: readonly (readonly string[])[] = [
    [],
    ['C-d'],
    ['enter'],
    ['Enter', 'q'],
    ['M-x'],
    ['C-z'],
    ['F1'],
    ['C-c', 'C-\\'],
  ]
  const safe = [
    'Enter', 'Escape', 'Up', 'Down', 'Left', 'Right', 'Tab', 'BTab', 'Space', 'BSpace', 'PageUp', 'PageDown', 'C-c',
  ]

  for (const keys of keyLists) assert.notEqual(keysRefusal(keys), null, keys.join(' '))
  assert.equal(keysRefusal(safe), null)
})

test('claimsTaken maps each role a live workspace claims to its id and skips finished workspaces', () => {
  const live: WsState = { ...wsState(), claims: ['qa', 'be'] }
  const other: WsState = { ...wsState(), id: '03.2-8-cd34', row: '03.2#8', claims: ['tl'] }
  const done: WsState = { ...wsState(), id: '03-11-ef56', row: '03#11', status: 'finished', claims: ['fe'] }

  assert.deepEqual(claimsTaken([live, other, done]), new Map([['qa', WS], ['be', WS], ['tl', '03.2-8-cd34']]))
  assert.deepEqual(claimsTaken([]), new Map())
})

test('claimRefusal names the workspace that holds the role and is null for a free role or its own claim', () => {
  const taken = new Map([['qa', WS], ['tl', '03.2-8-cd34']])

  assert.equal(claimRefusal('tl', WS, taken), 'busy: tl held by 03.2-8-cd34')
  assert.equal(claimRefusal('qa', WS, taken), null)
  assert.equal(claimRefusal('be', WS, taken), null)
  assert.equal(claimRefusal('qa', '03.2-8-cd34', taken), `busy: qa held by ${WS}`)
})
