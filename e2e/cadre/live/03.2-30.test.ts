import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { rowTest } from '../../lib/row.ts'
import { capture, killServer, socketName, startServer } from '../../lib/tmux.ts'
import { GSD_GRILL_INSTALL_SCRIPT } from '../fixtures/answers.ts'
import { EPIC_KEY, gitOk, printEpic } from '../lib/epic.ts'
import {
  APPLIED_REPLY,
  assertHaikuRoles,
  cadreTui,
  driveDialogs,
  liveRepo,
  noteReply,
  recordedProbe,
} from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_GRILL_SKILLS: readonly string[] = ['mattpocock-skills:grilling', 'mattpocock-skills:grill-me']
const EXPECTED_DENIED = 'tdd'
const INIT_COMMAND = '/cadre init'
const PM = 'pm'
const VIOLATED = 'violated'

rowTest(rowEntry('03.2#30'), async ctx => {
  const copy = await liveRepo(ctx, 'gsd-pre')
  const server = await startServer(socketName(), copy.env)
  ctx.after(() => killServer(server))

  const pane = await cadreTui(server, copy, INIT_COMMAND)
  await driveDialogs(pane, GSD_GRILL_INSTALL_SCRIPT, APPLIED_REPLY)
  const history = await capture(pane, { history: true })
  ctx.evidence('the reply of /cadre init', history.slice(Math.max(0, history.lastIndexOf(`❯ ${INIT_COMMAND}`))))
  await assertHaikuRoles(copy)
  await gitOk(copy, ['add', '-A'])
  await gitOk(copy, ['commit', '-q', '-m', 'team with the grill plugin for PM'])

  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, `epic ${EPIC_KEY}`, epic.result)
  const isOpened = existsSync(epic.worktree)
  await ctx.check(`/cadre epic ${EPIC_KEY} creates the epic worktree`, () => {
    assert.ok(isOpened, 'the epic worktree is not there')
  })
  if (!isOpened) return

  const probe = await recordedProbe(ctx, { ...copy, repo: epic.worktree }, PM)
  noteReply(ctx, 'the probe of pm in the epic worktree', probe)
  const verdicts = probe.stdout.split('\n').map(line => line.trim()).filter(line => line.length > 0)
  for (const skill of EXPECTED_GRILL_SKILLS) {
    await ctx.check(`the probe in the worktree shows ${skill} callable`, () => {
      const isCallable = verdicts.some(line => line.includes(skill) && !line.startsWith(VIOLATED))
      assert.ok(isCallable, `no probe line that is not violated names ${skill}`)
    })
  }
  await ctx.check(`the probe in the worktree shows ${EXPECTED_DENIED} denied`, () => {
    const denied = verdicts.filter(line => line.includes(`:${EXPECTED_DENIED}`) && !line.startsWith(VIOLATED))
    assert.ok(denied.length > 0, `no probe line that is not violated names the ${EXPECTED_DENIED} skill`)
  })
})
