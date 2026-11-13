import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HarnessError } from '../lib/errors.ts'
import { isRecord } from '../lib/filter.ts'
import { shellQuote } from '../lib/shims.ts'

export type SeedTarget = {
  readonly repo: string
  readonly e2eDir: string
  readonly role?: string
}

// A seed writes fixed text and returns a one-line summary; it throws a HarnessError to refuse.
export type Seed = (ws: SeedTarget) => Promise<string>

const SOURCE_FILES: readonly (readonly [string, string])[] = [
  ['CLAUDE.md', 'marker: project-claude-md\n\n@docs/imported.md\n'],
  ['docs/imported.md', 'marker: in-repo-import\n'],
  ['CLAUDE.local.md', 'marker: claude-local-md\n'],
  ['.claude/rules/marker.md', 'marker: project-rule\n'],
]
const USER_CLAUDE_MD = 'CLAUDE.md'
const USER_CLAUDE_MD_TEXT = 'marker: user-claude-md\n'
const PLANNING_FILE = '.planning/x'
const PLANNING_TEXT = 'marker: planning-x\n'
const SUBFOLDER_SETTINGS = 'src/.claude/settings.json'
const HOOK_LOG = 'src/.e2e-subfolder-hook.log'
const HOOK_LINE = 'SessionStart'
const DENIED_FILE = 'src/denied.txt'
const DENIED_TEXT = 'marker: denied-file\n'
// The file named from the session's folder (src) and from the git root, so the row can record which rule holds.
const DENY_RULES: readonly string[] = ['Read(./denied.txt)', `Read(${DENIED_FILE})`]
const APP_FILE = 'src/app.ts'
const SECURITY_LINE = 'export const retryLimit = 3\n'
const BYPASS_MODE = 'bypassPermissions'

async function writeIn(repo: string, path: string, text: string): Promise<void> {
  const file = join(repo, path)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, text)
}

async function sources(ws: SeedTarget): Promise<string> {
  for (const [path, text] of SOURCE_FILES) await writeIn(ws.repo, path, text)

  return `wrote ${SOURCE_FILES.map(([path]) => path).join(', ')}`
}

async function userClaudeMd(ws: SeedTarget): Promise<string> {
  try {
    await writeFile(join(ws.e2eDir, USER_CLAUDE_MD), USER_CLAUDE_MD_TEXT, { flag: 'wx' })
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error
    throw new HarnessError('the e2e dir has a CLAUDE.md already: the seed writes only a new one')
  }

  return 'wrote CLAUDE.md in the e2e dir'
}

async function planningX(ws: SeedTarget): Promise<string> {
  await writeIn(ws.repo, PLANNING_FILE, PLANNING_TEXT)

  return `wrote ${PLANNING_FILE}`
}

async function subfolderSettings(ws: SeedTarget): Promise<string> {
  const command = `/bin/sh -c ${shellQuote(`echo ${HOOK_LINE} >> ${shellQuote(join(ws.repo, HOOK_LOG))}`)}`
  const settings = {
    hooks: { SessionStart: [{ hooks: [{ type: 'command', command }] }] },
    permissions: { deny: [...DENY_RULES] },
  }
  await writeIn(ws.repo, SUBFOLDER_SETTINGS, `${JSON.stringify(settings, null, 2)}\n`)
  await writeIn(ws.repo, DENIED_FILE, DENIED_TEXT)

  return `wrote ${SUBFOLDER_SETTINGS} and ${DENIED_FILE}`
}

async function securityChange(ws: SeedTarget): Promise<string> {
  await appendFile(join(ws.repo, APP_FILE), SECURITY_LINE)

  return `appended one line to ${APP_FILE}`
}

async function bypass(ws: SeedTarget): Promise<string> {
  if (ws.role === undefined) throw new HarnessError('bypass needs a role: seed <ws> bypass <role>')
  const path = join('.cadre', ws.role, 'role.json')
  const text = await readFile(join(ws.repo, path), 'utf8').catch(() => null)
  if (text === null) throw new HarnessError(`no ${path} in the workspace repo`)
  const spec: unknown = JSON.parse(text)
  if (!isRecord(spec)) throw new HarnessError(`${path} is not a JSON object`)
  await writeFile(join(ws.repo, path), `${JSON.stringify({ ...spec, permissionMode: BYPASS_MODE }, null, 2)}\n`)

  return `set permissionMode to ${BYPASS_MODE} in ${path}: run cadre <ws> regen ${ws.role}`
}

export const SEEDS: ReadonlyMap<string, Seed> = new Map<string, Seed>([
  ['sources', sources],
  ['user-claude-md', userClaudeMd],
  ['planning-x', planningX],
  ['subfolder-settings', subfolderSettings],
  ['security-change', securityChange],
  ['bypass', bypass],
])
