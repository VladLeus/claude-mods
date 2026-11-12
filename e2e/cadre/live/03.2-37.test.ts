import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { answer, idleTui } from '../../lib/claude.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { parseShimLog } from '../../lib/shims.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { FRAMEWORKS_ADD_GSD_SCRIPT, REFRAME_REVIEW_QUESTION } from '../fixtures/answers.ts'
import { APPLIED_REPLY, assertHaikuRoles, cadreTui, driveDialogs, liveRepo } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { npxShim } from '../lib/shims.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_OFFER = 'Add GSD'
const FRAMEWORKS_COMMAND = '/cadre frameworks'
const GSD_COMMAND = 'npx -y @opengsd/gsd-core@latest --claude --local'
const EXPECTED_RUN = `run ${GSD_COMMAND} from the repo root`
const EXPECTED_AGAIN = 'then /cadre frameworks again'
const FALLBACK_LINE_RE = /GSD did not install, so .*? then \/cadre [a-z]+ again/
const OFFER_RE = new RegExp(`^\\s*(?:❯\\s+)?(?:[0-9]+\\.\\s+)?${EXPECTED_OFFER}(?:\\s|$)`, 'm')
const CONFIRM = 'Confirm'
const WHITESPACE_RE = /\s+/g

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

async function npxCalls(log: string): Promise<number> {
  return parseShimLog(await readFile(log, 'utf8').catch(() => '')).filter(call => call.name === 'npx').length
}

async function teamState(copy: LiveRepo): Promise<Record<string, unknown>> {
  const text = await readFile(join(copy.repo, '.cadre', 'cadre.json'), 'utf8').catch(() => '')
  try {
    const state: unknown = JSON.parse(text)

    return isRecord(state) ? state : {}
  } catch {
    return {}
  }
}

rowTest(rowEntry('03.2#37'), async ctx => {
  const shims = join(ctx.scratch, 'shims')
  const log = join(ctx.scratch, 'npx.log')
  await npxShim(shims, 'fail', log)
  const copy = await liveRepo(ctx, 'none-team', { shimDir: shims })
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, FRAMEWORKS_COMMAND)
  const offer = await idleTui(pane)
  ctx.screen('the first question of /cadre frameworks', offer)
  await ctx.check(`/cadre frameworks offers ${EXPECTED_OFFER}`, () => {
    assert.match(offer, OFFER_RE, `no option ${EXPECTED_OFFER} is on the question`)
  })

  const withoutReview = FRAMEWORKS_ADD_GSD_SCRIPT.filter(entry => entry.question !== REFRAME_REVIEW_QUESTION)
  const review = (await driveDialogs(pane, withoutReview, APPLIED_REPLY, { stopAt: REFRAME_REVIEW_QUESTION })).final
  ctx.screen('the review of the framework changes', review)
  await ctx.check('the install has not run at the review: the npx shim log is empty', async () => {
    assert.equal(await npxCalls(log), 0, 'the npx shim was called before Confirm')
  })

  await answer(pane, CONFIRM)
  await driveDialogs(pane, [], APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  const reply = history.slice(Math.max(0, history.lastIndexOf(`❯ ${FRAMEWORKS_COMMAND}`)))
  ctx.evidence('the reply of /cadre frameworks after Confirm', reply)
  await assertHaikuRoles(copy)
  await ctx.check('Confirm runs the install: the npx shim is called', async () => {
    assert.ok((await npxCalls(log)) > 0, 'the npx shim was not called after Confirm')
  })

  const line = FALLBACK_LINE_RE.exec(squashed(reply))?.[0] ?? null
  ctx.observe('fallbackLine', line, 'the line of the failed GSD install, null when the reply has none')
  await ctx.check('the reply holds the fallback line of the failed GSD install', () => {
    assert.ok(line !== null, 'the reply has no line "GSD did not install, so ... then /cadre ... again"')
  })
  if (line !== null) {
    await ctx.check('the fallback line prints the command to run from the repo root', () => {
      assert.ok(line.includes(EXPECTED_RUN), `the line is: ${line}`)
    })
    await ctx.check('the fallback line names /cadre frameworks', () => {
      assert.ok(line.endsWith(EXPECTED_AGAIN), `the line is: ${line}`)
    })
  }
  await ctx.check('the failed install falls back: .cadre/cadre.json does not keep GSD', async () => {
    const state = await teamState(copy)
    const frameworks = Array.isArray(state.frameworks) ? state.frameworks : []
    assert.ok(state.framework !== 'gsd' && !frameworks.includes('gsd'), 'cadre.json still holds GSD')
  })
})
