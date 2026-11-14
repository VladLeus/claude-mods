import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { parseShimLog } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { SP_GSD_SCRIPT } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_FALLBACK =
  '{name} did not install, so {moved} fell back to {fallback}: run {command} from the repo root, ' +
  'then /cadre frameworks again'
const INIT_COMMAND = '/cadre init'
const GSD_COMMAND = 'npx -y @opengsd/gsd-core@latest --claude --local'
// The repo has superpowers and adds GSD, so the roles that fall back from GSD land on superpowers.
const FALLBACK_FRAMEWORK = 'superpowers'
const FALLBACK_LINE_RE = /GSD did not install, so .*? then \/cadre frameworks again/
const INSTALLED_LINE_RE = /Installed [^:]+: run \/reload-plugins to load (?:it|them) in this session\./
const WHITESPACE_RE = /\s+/g

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function expectedFallback(roles: readonly string[]): string {
  const moved = `${roles.length === 1 ? 'role' : 'roles'} ${roles.join(', ')}`

  return EXPECTED_FALLBACK
    .replace('{name}', 'GSD')
    .replace('{moved}', moved)
    .replace('{fallback}', FALLBACK_FRAMEWORK)
    .replace('{command}', GSD_COMMAND)
}

// The roles that now run the fallback framework, in the order cadre.json lists them: those that were on GSD.
async function fallenRoles(copy: LiveRepo): Promise<readonly string[]> {
  const state = parseJson(await readFile(join(copy.repo, '.cadre', 'cadre.json'), 'utf8').catch(() => null))
  const ids = isRecord(state) && Array.isArray(state.roles) ? state.roles : []
  const fallen: string[] = []
  for (const id of ids.filter(item => typeof item === 'string')) {
    const role = parseJson(await readFile(join(copy.repo, '.cadre', id, 'role.json'), 'utf8').catch(() => null))
    if (isRecord(role) && role.framework === FALLBACK_FRAMEWORK) fallen.push(id)
  }

  return fallen
}

rowTest(rowEntry('03.2#27'), async ctx => {
  const shims = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'npx.log')
  await npxShim(shims, 'noop', log)
  const copy = await liveRepo(ctx, 'sp-pre', { shimDir: shims })
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, INIT_COMMAND)
  await driveDialogs(pane, SP_GSD_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
  ctx.evidence('the reply of /cadre init', reply)
  await assertHaikuRoles(copy)

  const calls = parseShimLog(await readFile(log, 'utf8').catch(() => '')).filter(call => call.name === 'npx')
  if (calls.length === 0) {
    throw new HarnessError('03.2#27: no npx call was logged: cadre did not install through the shim')
  }
  const logged = calls.map(call => `npx ${call.argv.join(' ')} (cwd ${call.cwd})`)
  ctx.evidence('the calls the npx shim logged', logged.join('\n'))

  const line = FALLBACK_LINE_RE.exec(squashed(reply))?.[0] ?? null
  await ctx.check('the reply holds the fallback line of the GSD install that detection does not show', () => {
    assert.ok(line !== null, 'the reply has no line "GSD did not install, so ... then /cadre frameworks again"')
  })
  if (line !== null) {
    const fallen = await fallenRoles(copy)
    await ctx.check('the fallback line is the UAT line filled with the names of this run', () => {
      assert.ok(fallen.length > 0, `no role.json names ${FALLBACK_FRAMEWORK}: no role fell back`)
      assert.equal(line, expectedFallback(fallen))
    })
  }

  const installed = INSTALLED_LINE_RE.exec(squashed(reply))?.[0] ?? null
  ctx.observe('installedLine', installed, 'the line that lists the installs that worked, null when the reply has none')
})
