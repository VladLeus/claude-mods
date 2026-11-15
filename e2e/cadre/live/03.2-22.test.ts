import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { squashed } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { parseShimLog } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { HUNK_QUESTION_PREFIX, SP_GSD_FIRST_HUNK_SCRIPT } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const INIT_COMMAND = '/cadre init'
const CONFIG_FILE = join('.planning', 'config.json')
const ACCEPTED_KEY = 'mode'
const DECLINED_KEYS: readonly string[] = ['workflow.text_mode', 'hooks.context_warnings']
const REQUIRED_HUNKS: readonly string[] = [ACCEPTED_KEY, 'workflow.text_mode']
const EXPECTED_NOT_RUN_LINE =
  'warning: the .planning/config.json change mode was not run by cadre: ' +
  'run this yourself: node .claude/gsd-core/bin/gsd-tools.cjs config-set mode yolo'

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

rowTest(rowEntry('03.2#22'), async ctx => {
  const shims = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'npx.log')
  await npxShim(shims, 'stage-gsd', log)
  const copy = await liveRepo(ctx, 'sp-pre', { shimDir: shims })
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, INIT_COMMAND)
  const dialogs = await driveDialogs(pane, SP_GSD_FIRST_HUNK_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`)))
  ctx.evidence('the reply of /cadre init', reply)
  await assertHaikuRoles(copy)

  const calls = parseShimLog(await readFile(log, 'utf8').catch(() => '')).filter(call => call.name === 'npx')
  if (calls.length === 0) {
    throw new HarnessError('03.2#22: no npx call was logged: no consented GSD project install ran')
  }
  ctx.evidence('the calls the npx shim logged', calls.map(call => `npx ${call.argv.join(' ')}`).join('\n'))

  const hunks = dialogs.asked.filter(question => question.startsWith(HUNK_QUESTION_PREFIX))
  ctx.observe('hunkDialogs', hunks, 'the hunk questions in the order they were asked, one dialog each')
  await ctx.check('the hunks are offered one by one: each required hunk is its own dialog', () => {
    assert.equal(new Set(hunks).size, hunks.length, 'a hunk question was asked more than once')
    for (const key of REQUIRED_HUNKS) {
      assert.ok(hunks.includes(`${HUNK_QUESTION_PREFIX}${key}`), `no dialog asked the hunk ${key}`)
    }
  })

  const text = await readFile(join(copy.repo, CONFIG_FILE), 'utf8').catch(() => null)
  ctx.evidence('.planning/config.json after the init', text ?? 'absent or unreadable')
  const config = parseJson(text)
  await ctx.check(`the accepted hunk is not written by cadre: ${ACCEPTED_KEY} is not set`, () => {
    assert.equal(configValue(config, ACCEPTED_KEY), undefined, `.planning/config.json holds ${ACCEPTED_KEY}`)
  })
  await ctx.check(`the reply holds the not-run line for the accepted ${ACCEPTED_KEY} hunk`, () => {
    assert.ok(squashed(reply).includes(EXPECTED_NOT_RUN_LINE), `the reply does not hold: ${EXPECTED_NOT_RUN_LINE}`)
  })
  await ctx.check('the declined hunks are not written', () => {
    const written = DECLINED_KEYS.filter(key => configValue(config, key) !== undefined)
    assert.deepEqual(written, [], `.planning/config.json holds: ${written.join(', ')}`)
  })
})
