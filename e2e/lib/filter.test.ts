import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { hostname, userInfo } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { LeakError } from './errors.ts'
import { filterContext, filterText, leakCheck, parseFilterValues } from './filter.ts'
import { removeTree, scratchRoot } from './scratch.ts'

const HOME = '/Users/unitperson'
const SCRATCH = '/private/tmp/unit-scratch/run'
const SECRET = 'unit-secret-value-123'
const PLAIN = 'unit-plain-value-456'
const CREDENTIAL = 'unit-credential-abcdefgh'
const DISPLAY_NAME = 'Unit Display Person'
const ORG_NAME = 'Acme Unit Widgets'
const IDENTITY_EMAIL = 'owner@unit-org.test'
const UUID_A = '0f8fad5b-d9cb-469f-a165-70867728950e'
const UUID_B = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

let dir = ''
let filterFile = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-filter-'))
  filterFile = join(dir, 'filter.json')
  const values = { credentials: [CREDENTIAL], identities: [DISPLAY_NAME, ORG_NAME, IDENTITY_EMAIL] }
  await writeFile(filterFile, JSON.stringify(values))
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

function env(): Record<string, string> {
  return {
    HOME,
    E2E_SCRATCH: SCRATCH,
    E2E_RUN: 'unit-run-id',
    UNIT_API_TOKEN: SECRET,
    UNIT_PLAIN: PLAIN,
    E2E_FILTER_FILE: filterFile,
  }
}

function longName(name: string): string | null {
  return name.length >= 3 ? name : null
}

const RAW = [
  `token ${SECRET} and plain ${PLAIN}`,
  'key sk-ant-x',
  `home ${HOME}/work`,
  `scratch ${SCRATCH}/rows and /tmp/unit-scratch/run/rows`,
  'encoded -Users-unitperson-work-repo',
  `ids ${UUID_A} ${UUID_B} ${UUID_A.toUpperCase()}`,
  'mail someone@example.com',
  `cred ${CREDENTIAL}`,
  `name ${DISPLAY_NAME}, org ${ORG_NAME.toUpperCase()}, mail ${IDENTITY_EMAIL}`,
  'results e2e/results/unit-run-id/SUMMARY.md',
].join('\n')

const FILTERED = [
  `token <secret> and plain ${PLAIN}`,
  'key <secret>',
  'home ~/work',
  'scratch <scratch>/rows and <scratch>/rows',
  'encoded -<path>-work-repo',
  'ids <uuid-1> <uuid-2> <uuid-1>',
  'mail <email>',
  'cred <secret>',
  'name <identity>, org <identity>, mail <identity>',
  'results e2e/results/<run>/SUMMARY.md',
].join('\n')

test('filterText replaces env secrets, tokens, paths, uuids, emails and the filter file values', () => {
  assert.equal(filterText(RAW, filterContext(env())), FILTERED)
})

test('filterText replaces identity values passed in memory the same way', () => {
  const extra = { credentials: [CREDENTIAL], identities: [DISPLAY_NAME, ORG_NAME, IDENTITY_EMAIL] }
  const ctx = filterContext({ HOME }, extra)
  const text = `${DISPLAY_NAME.toLowerCase()} | ${ORG_NAME} | ${IDENTITY_EMAIL} | ${CREDENTIAL}`

  assert.equal(filterText(text, ctx), '<identity> | <identity> | <identity> | <secret>')
})

test('filterText maps other home folders to a <user> placeholder', () => {
  const text = '/Users/someone/x /home/other/y'

  assert.equal(filterText(text, filterContext({ HOME })), '/Users/<user>/x /home/<user>/y')
})

test('leakCheck passes on filtered text', () => {
  const ctx = filterContext(env())

  assert.doesNotThrow(() => leakCheck(filterText(RAW, ctx), ctx))
})

test('leakCheck names the line of every residue kind and never the value', () => {
  const ctx = filterContext(env())
  const user = longName(userInfo().username)
  const host = longName(hostname())
  const lines = [
    'clean line',
    `${HOME}/x`,
    '/Users/someone/x',
    '/home/someone/x',
    '/var/folders/ab/cd/T/x',
    '/private/var/tmp/x',
    `id ${UUID_A}`,
    'sk-ant-x',
    `env ${SECRET}`,
    `cred ${CREDENTIAL}`,
    `org ${ORG_NAME.toLowerCase()}`,
    'mail someone@example.com',
    ...(user ? [`user ${user}`] : []),
    ...(host ? [`host ${host}`] : []),
  ]
  const expected = lines.map((_, index) => index + 1).slice(1)
  let caught: unknown = null

  try {
    leakCheck(lines.join('\n'), ctx)
  } catch (error) {
    caught = error
  }

  assert.ok(caught instanceof LeakError)
  assert.deepEqual(caught.lines, expected)
  for (const value of [HOME, SECRET, CREDENTIAL, ORG_NAME.toLowerCase(), UUID_A, user, host]) {
    if (value) assert.equal(caught.message.includes(value), false)
  }
})

test('filterContext ignores an unreadable or malformed filter file and leakCheck still runs', async () => {
  const malformed = join(dir, 'malformed.json')
  await writeFile(malformed, '{"credentials": [1]')
  const missing = filterContext({ HOME, E2E_FILTER_FILE: join(dir, 'missing.json') })
  const broken = filterContext({ HOME, E2E_FILTER_FILE: malformed })

  assert.deepEqual([missing.credentials, missing.identities, broken.credentials, broken.identities], [[], [], [], []])
  assert.throws(() => leakCheck(`${HOME}/x`, missing), LeakError)
})

test('parseFilterValues returns null on malformed input', () => {
  assert.equal(parseFilterValues('{'), null)
  assert.equal(parseFilterValues('{"credentials": ["a"], "identities": [2]}'), null)
  assert.deepEqual(parseFilterValues('{"credentials": ["a"], "identities": ["b"]}'), {
    credentials: ['a'],
    identities: ['b'],
  })
})
