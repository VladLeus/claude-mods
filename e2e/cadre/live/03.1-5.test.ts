import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { rowTest } from '../../lib/row.ts'
import { killServer, socketName, startServer } from '../../lib/tmux.ts'
import { EPIC_KEY, epicBranchesOf, openEpic, roleIdsOf, roleLineIds, worktreesOf } from '../lib/epic.ts'
import { liveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const EXPECTED_HEADER = 'Epic roles'
const EXPECTED_PM_ONLY = 'PM only'
const TYPED_ROLE = 'be'
const PM = 'pm'
const OPENED_ROLES: readonly string[] = [TYPED_ROLE, PM].sort()
const WHITESPACE_RE = /\s+/g

function allRolesLabel(count: number): string {
  return `All ${count} roles (Recommended)`
}

function squashed(text: string): string {
  return text.replace(WHITESPACE_RE, ' ')
}

// The roles an epic rendered into its worktree each have an epic kickoff in their .runtime folder.
function renderedRoles(worktree: string, ids: readonly string[]): readonly string[] {
  return ids.filter(id => existsSync(join(worktree, '.cadre', id, '.runtime', 'kickoff.txt'))).sort()
}

rowTest(rowEntry('03.1#5'), async ctx => {
  const typing = await liveRepo(ctx, 'gsd', { path: 'typing/repo' })
  const escaping = await liveRepo(ctx, 'gsd', { path: 'escaping/repo' })
  const ids = await roleIdsOf(typing)
  const server = await startServer(socketName(), typing.env)
  ctx.after(() => killServer(server))

  const picked = await openEpic(server, typing, EPIC_KEY, { pick: { other: TYPED_ROLE } })
  ctx.screen('the Epic roles question', picked.dialog)
  ctx.screen(`the root session after ${TYPED_ROLE} was typed under Other`, picked.screen)
  const question = squashed(picked.dialog)
  await ctx.check(`the question is headed ${EXPECTED_HEADER}`, () => {
    assert.ok(question.includes(EXPECTED_HEADER), `the question does not show: ${EXPECTED_HEADER}`)
  })
  await ctx.check(`the question shows ${allRolesLabel(ids.length)}`, () => {
    assert.ok(question.includes(allRolesLabel(ids.length)), `the question does not show: ${allRolesLabel(ids.length)}`)
  })
  await ctx.check(`the question shows ${EXPECTED_PM_ONLY}`, () => {
    assert.ok(question.includes(EXPECTED_PM_ONLY), `the question does not show: ${EXPECTED_PM_ONLY}`)
  })
  await ctx.check(`typing ${TYPED_ROLE} under Other opens ${PM} and ${TYPED_ROLE}: their reply lines only`, () => {
    const lines = [...roleLineIds(picked.screen, ids)].sort()
    assert.deepEqual(lines, OPENED_ROLES, `the reply holds lines for ${lines.join(', ') || 'no role'}`)
  })
  await ctx.check(`only ${PM} and ${TYPED_ROLE} are rendered into the worktree`, () => {
    const rendered = renderedRoles(picked.worktree, ids)
    assert.deepEqual(rendered, OPENED_ROLES, `kickoff.txt is in the worktree for ${rendered.join(', ') || 'no role'}`)
  })

  const dismissed = await openEpic(server, escaping, EPIC_KEY, { pick: 'dismiss' })
  ctx.screen('the root session after Escape', dismissed.screen)
  await ctx.check('dismissing the question creates no worktree', async () => {
    const worktrees = await worktreesOf(escaping)
    assert.ok(!existsSync(join(escaping.repo, '.claude', 'worktrees')), 'the folder .claude/worktrees exists')
    assert.equal(worktrees.length, 1, `git lists ${worktrees.length} worktrees`)
  })
  await ctx.check('dismissing the question creates no epic branch', async () => {
    assert.deepEqual(await epicBranchesOf(escaping), [], 'an epic branch exists')
  })
})
