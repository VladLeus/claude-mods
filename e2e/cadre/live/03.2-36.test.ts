import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { scratchEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import {
  FRAMEWORK_SET_QUESTION,
  FRAMEWORKS_KEEP_GSD_SCRIPT,
  HUNK_QUESTION_PREFIX,
  REFRAME_REVIEW_QUESTION,
} from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const FRAMEWORKS_COMMAND = '/cadre frameworks'
const GSD = 'gsd'
const STORED_NONE = 'none'
const PM_ROLE = 'pm'
const STAGE_ARGS: readonly string[] = ['-y', '@opengsd/gsd-core@latest', '--claude', '--local']
const STAGE_MS = 30_000
const PLANNING_DIR = '.planning'

type Team = {
  readonly framework: unknown
  readonly ids: readonly string[]
  readonly roles: ReadonlyMap<string, Readonly<Record<string, unknown>>>
}

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function jsonFile(path: string): Promise<unknown> {
  return parseJson(await readFile(path, 'utf8').catch(() => null))
}

async function teamOf(copy: LiveRepo): Promise<Team> {
  const state = await jsonFile(join(copy.repo, '.cadre', 'cadre.json'))
  if (!isRecord(state)) throw new HarnessError('03.2#36: .cadre/cadre.json is not a JSON object')
  const ids = (Array.isArray(state.roles) ? state.roles : []).filter(id => typeof id === 'string')
  const roles = new Map<string, Readonly<Record<string, unknown>>>()
  for (const id of ids) {
    const role = await jsonFile(join(copy.repo, '.cadre', id, 'role.json'))
    if (!isRecord(role)) throw new HarnessError(`03.2#36: .cadre/${id}/role.json is not a JSON object`)
    roles.set(id, role)
  }

  return { framework: state.framework, ids, roles }
}

function skillsOf(team: Team): string {
  return JSON.stringify(team.ids.map(id => [id, team.roles.get(id)?.skills ?? null]))
}

// A role runs the framework its role.json names, else the repo default cadre.json records.
function frameworkOf(team: Team, id: string): unknown {
  return team.roles.get(id)?.framework ?? team.framework
}

// GSD installed later: the stage-gsd npx shim writes a proven project install, and the repo gains a .planning/ dir.
async function installGsdLater(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const stager = await npxShim(join(ctx.scratch, 'stage'), 'stage-gsd', join(ctx.scratch, 'stage.log'))
  const env = await scratchEnv(join(ctx.scratch, 'stage-env'))
  const result = await run([stager, ...STAGE_ARGS], { cwd: copy.repo, env, timeoutMs: STAGE_MS })
  if (result.code !== 0) throw new HarnessError(`03.2#36: staging GSD exited ${result.code}: ${result.stderr.trim()}`)
  await mkdir(join(copy.repo, PLANNING_DIR), { recursive: true })
  await writeFile(join(copy.repo, PLANNING_DIR, 'config.json'), '{}\n')
}

rowTest(rowEntry('03.2#36'), async ctx => {
  const copy = await liveRepo(ctx, 'none-team')
  const before = await teamOf(copy)
  if (before.framework !== STORED_NONE) {
    throw new HarnessError(`03.2#36: the none-team cadre.json stores ${String(before.framework)}, not None`)
  }
  ctx.evidence('the role ids and skills before /cadre frameworks', skillsOf(before))
  await installGsdLater(ctx, copy)

  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))
  const pane = await cadreTui(server, copy, FRAMEWORKS_COMMAND)
  const dialogs = await driveDialogs(pane, FRAMEWORKS_KEEP_GSD_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${FRAMEWORKS_COMMAND}`)))
  ctx.evidence('the reply of /cadre frameworks', reply)
  await assertHaikuRoles(copy)

  await ctx.check('it asks the set question, then GSD hunks one by one, then the review', () => {
    const asked = dialogs.asked
    const set = asked.indexOf(FRAMEWORK_SET_QUESTION)
    const review = asked.indexOf(REFRAME_REVIEW_QUESTION)
    const hunks = asked.flatMap((question, at) => (question.startsWith(HUNK_QUESTION_PREFIX) ? [at] : []))
    assert.ok(set !== -1, 'the set question was not asked')
    assert.ok(review !== -1, 'the review was not asked')
    assert.ok(hunks.length > 0, 'no GSD hunk was asked')
    assert.ok(hunks.every(at => at > set && at < review), `the order of the questions was: ${asked.join(' | ')}`)
    assert.equal(new Set(hunks.map(at => asked[at])).size, hunks.length, 'a hunk was asked more than once')
  })

  const after = await teamOf(copy)
  await ctx.check('the roles move to GSD: every non-PM role runs GSD', () => {
    const off = after.ids.filter(id => id !== PM_ROLE && frameworkOf(after, id) !== GSD)
    assert.deepEqual(off, [], `these roles do not run GSD: ${off.join(', ')}`)
  })
  await ctx.check('the role ids stay', () => {
    assert.deepEqual(after.ids, before.ids)
  })
  await ctx.check('the role skills stay', () => {
    assert.equal(skillsOf(after), skillsOf(before))
  })
})
