import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { AUTH_MARGIN_MS, e2eConfigDir, expiresSoon, parseAuthStatus, writeFilterFile } from './auth.ts'
import { HarnessError } from './errors.ts'
import { parseFilterValues } from './filter.ts'
import { removeTree, scratchRoot } from './scratch.ts'

const EXPIRES_AT = '2026-11-12T08:30:00.000Z'
const NOW = Date.parse('2026-11-11T12:00:00.000Z')
const EPOCH_S = 1_794_470_400
const IDENTITY_EMAIL = 'owner@unit-org.test'
const DISPLAY_NAME = 'Unit Display Person'
const ORG_NAME = 'Acme Unit Widgets'
const ORG_UUID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const SEVEN_KEYS = {
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  analyticsDisabled: false,
  projectsDirectory: '/Users/unitperson/.cache/claude-mods-e2e/config/projects',
  configDirectory: '/Users/unitperson/.cache/claude-mods-e2e/config',
  loginExpiresAt: EXPIRES_AT,
}

let dir = ''

before(async () => {
  dir = await mkdtemp(join(scratchRoot(), 'unit-auth-'))
})

after(async () => {
  await removeTree(dir, scratchRoot())
})

function statusText(over: Record<string, unknown>): string {
  return JSON.stringify({ ...SEVEN_KEYS, ...over })
}

test('parseAuthStatus reads loggedIn and the ISO expiry and finds no identity value in the seven keys', () => {
  assert.deepEqual(parseAuthStatus(JSON.stringify(SEVEN_KEYS)), {
    loggedIn: true,
    expiresAt: Date.parse(EXPIRES_AT),
    identityValues: [],
  })
})

test('parseAuthStatus gives a null expiry for a null, absent or unparseable loginExpiresAt', () => {
  const absent: Record<string, unknown> = { ...SEVEN_KEYS }
  delete absent.loginExpiresAt

  assert.equal(parseAuthStatus(statusText({ loginExpiresAt: null }))?.expiresAt, null)
  assert.equal(parseAuthStatus(JSON.stringify(absent))?.expiresAt, null)
  assert.equal(parseAuthStatus(statusText({ loginExpiresAt: 'soon' }))?.expiresAt, null)
  assert.equal(parseAuthStatus(statusText({ loginExpiresAt: 42 }))?.expiresAt, null)
})

test('parseAuthStatus reads an all-digit expiry as epoch seconds or milliseconds', () => {
  assert.equal(parseAuthStatus(statusText({ loginExpiresAt: String(EPOCH_S) }))?.expiresAt, EPOCH_S * 1000)
  assert.equal(parseAuthStatus(statusText({ loginExpiresAt: String(EPOCH_S * 1000) }))?.expiresAt, EPOCH_S * 1000)
})

test('parseAuthStatus returns the identity values, dropping values under 3 characters and non-strings', () => {
  const status = parseAuthStatus(statusText({
    email: IDENTITY_EMAIL,
    displayName: DISPLAY_NAME,
    organizationName: ORG_NAME,
    organizationUuid: ORG_UUID,
    accountName: 'Al',
    orgId: 42,
  }))

  assert.deepEqual(status?.identityValues, [IDENTITY_EMAIL, DISPLAY_NAME, ORG_NAME, ORG_UUID])
  assert.equal(status?.loggedIn, true)
})

test('parseAuthStatus returns null on malformed JSON, a non-object and a non-boolean loggedIn', () => {
  assert.equal(parseAuthStatus('{"loggedIn": tru'), null)
  assert.equal(parseAuthStatus(''), null)
  assert.equal(parseAuthStatus('[]'), null)
  assert.equal(parseAuthStatus('null'), null)
  assert.equal(parseAuthStatus(statusText({ loggedIn: 'yes' })), null)
})

test('expiresSoon is true before the margin, false after it and false for no expiry', () => {
  assert.equal(expiresSoon(NOW + AUTH_MARGIN_MS - 1, NOW), true)
  assert.equal(expiresSoon(NOW - 1, NOW), true)
  assert.equal(expiresSoon(NOW + AUTH_MARGIN_MS + 1, NOW), false)
  assert.equal(expiresSoon(null, NOW), false)
})

test('e2eConfigDir resolves E2E_CONFIG_DIR, else the config folder under home, and refuses a missing dir', async () => {
  const target = join(dir, 'config-target')
  const link = join(dir, 'config-link')
  const home = join(dir, 'home')
  const fallback = join(home, '.config', 'claude-mods-e2e', 'config')
  await mkdir(target)
  await symlink(target, link)
  await mkdir(fallback, { recursive: true })

  assert.equal(e2eConfigDir({ E2E_CONFIG_DIR: link }, home), target)
  assert.equal(e2eConfigDir({}, home), fallback)
  assert.throws(() => e2eConfigDir({ E2E_CONFIG_DIR: join(dir, 'missing') }, home), HarnessError)
  assert.throws(() => e2eConfigDir({}, join(dir, 'no-home')), HarnessError)
})

test('writeFilterFile writes the identity values with no credential into a private file', async () => {
  const root = join(dir, 'filter-root')
  const path = await writeFilterFile(root, [ORG_NAME, IDENTITY_EMAIL])

  assert.equal(path, join(root, 'auth', 'filter.json'))
  const values = parseFilterValues(await readFile(path, 'utf8'))
  assert.deepEqual(values, { credentials: [], identities: [ORG_NAME, IDENTITY_EMAIL] })
  assert.equal((await stat(path)).mode & 0o777, 0o600)
  assert.equal((await stat(join(root, 'auth'))).mode & 0o777, 0o700)
})

test('writeFilterFile writes an empty identity list as []', async () => {
  const path = await writeFilterFile(join(dir, 'empty-root'), [])

  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), { credentials: [], identities: [] })
})

test('writeFilterFile refuses a root outside a scratch folder', async () => {
  await assert.rejects(writeFilterFile('/', []), HarnessError)
})
