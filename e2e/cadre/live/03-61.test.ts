import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { gsdAcceptHunk } from '../fixtures/answers.ts'
import { buildByInit, liveRepo, stageStubGsd } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

// The ROLE.md attended line as the artifact locale writes it; the UAT row quotes no text.
const EXPECTED_ATTENDED_LINE =
  'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.'
const ROLE = 'be'
const CONFIG_FILE = join('.planning', 'config.json')

const row = rowEntry('03#61')

function parseJson(text: string | null): unknown {
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function configValue(config: unknown, key: string): unknown {
  let current = config
  for (const part of key.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }

  return current
}

// Whether each role's ROLE.md holds the attended line, by role id.
async function attendedByRole(repo: string): Promise<ReadonlyMap<string, boolean>> {
  const cadre = join(repo, '.cadre')
  const entries = await readdir(cadre, { withFileTypes: true }).catch(() => null)
  if (entries === null) throw new HarnessError('03#61: the copy has no .cadre/ folder')
  const found = new Map<string, boolean>()
  for (const entry of entries.filter(item => item.isDirectory())) {
    const text = await readFile(join(cadre, entry.name, 'ROLE.md'), 'utf8').catch(() => null)
    if (text !== null) found.set(entry.name, text.includes(EXPECTED_ATTENDED_LINE))
  }

  return found
}

function listing(roles: ReadonlyMap<string, boolean>): string {
  return [...roles].map(([id, isAttended]) => `${id}: ${isAttended ? 'holds the attended line' : 'no attended line'}`)
    .join('\n')
}

rowTest(row, async ctx => {
  if (row.exclusive !== true) {
    throw new HarnessError('03#61 stages a user-level GSD in the e2e dir: its registry entry must be exclusive')
  }

  const control = await attendedByRole((await liveRepo(ctx, 'gsd', { path: 'control' })).repo)
  ctx.evidence('the gsd fixture (every hunk declined), ROLE.md of each role', listing(control))
  if (control.get(ROLE) !== true) {
    throw new HarnessError(`03#61 control: ${ROLE} is not attended on the gsd fixture, the check cannot tell it apart`)
  }

  const init = join(ctx.scratch, 'init')
  const repo = join(init, 'repo')
  await stageStubGsd(ctx)
  await buildByInit({ variant: 'gsd-pre', dir: init, repo }, 'gsd-pre', gsdAcceptHunk)

  const configText = await readFile(join(repo, CONFIG_FILE), 'utf8').catch(() => null)
  const config = parseJson(configText)
  ctx.evidence('.planning/config.json after the init', configText ?? 'unreadable')
  await ctx.check('the config holds the accepted hunk mode = yolo', () => {
    assert.equal(configValue(config, 'mode'), 'yolo', 'mode is not yolo in .planning/config.json')
  })
  await ctx.check('the config holds the accepted hunk workflow.text_mode = false', () => {
    assert.equal(configValue(config, 'workflow.text_mode'), false, 'workflow.text_mode is not false')
  })

  const roles = await attendedByRole(repo)
  ctx.evidence('the init with both required hunks accepted, ROLE.md of each role', listing(roles))
  if (!roles.has(ROLE)) throw new HarnessError(`03#61: the init made no ROLE.md for ${ROLE}`)
  await ctx.check(`the ROLE.md of ${ROLE} holds no attended line`, () => {
    assert.equal(roles.get(ROLE), false, `the ROLE.md of ${ROLE} holds: ${EXPECTED_ATTENDED_LINE}`)
  })
  for (const [id, isAttended] of roles) {
    if (id === ROLE) continue
    ctx.observe(`${id}RoleMdHoldsTheAttendedLine`, isAttended, isAttended ? 'attended line present' : 'absent')
  }
})
