import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { lstat, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { HarnessError } from '../../lib/errors.ts'
import { rowTest } from '../../lib/row.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const ROLE_MD = '.cadre/be/ROLE.md'
const RUNTIME_SETTINGS = '.cadre/be/.runtime/settings.json'
const TARGET_NAME = 'cadre-uat-none'
const EXPECTED_REFUSED_WRITE = 'refused to write .cadre/be/ROLE.md:'
const EXPECTED_LINK_REFUSAL =
  '.cadre/be/.runtime/settings.json is a link /cadre start could not check: remove it and run /cadre start be again'

const entry = rowEntry('03#60')

async function isLink(path: string): Promise<boolean> {
  const stats = await lstat(path).catch(() => null)

  return stats !== null && stats.isSymbolicLink()
}

function regenOutcomeOf(isKept: boolean, isRefused: boolean): string {
  if (isKept && isRefused) return 'a .cadre-new copy and a refused-to-write warning'
  if (isKept) return 'a .cadre-new copy'
  if (isRefused) return 'a refused-to-write warning'

  return 'neither'
}

function startOutcomeOf(isRefused: boolean, isRemoved: boolean): string {
  if (isRefused) return 'refused: the link could not be checked'
  if (isRemoved) return 'removed the link first'

  return 'neither'
}

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  const target = join(ctx.scratch, TARGET_NAME)

  const regenCopy = await liveRepo(ctx, 'gsd', { path: 'regen/repo' })
  const roleMd = join(regenCopy.repo, ROLE_MD)
  await rm(roleMd)
  await symlink(target, roleMd)
  const regen = await cadrePrint(regenCopy, `regen ${ROLE}`)
  noteReply(ctx, 'regen be with ROLE.md a dangling link', regen)
  const isKept = existsSync(`${roleMd}.cadre-new`)
  const isRefused = replyOf(regen).includes(EXPECTED_REFUSED_WRITE)
  ctx.observe('regenOutcome', regenOutcomeOf(isKept, isRefused), `ROLE.md is still a link: ${await isLink(roleMd)}`)
  await ctx.check('regen keeps the link as a conflict or warns that it refused to write it', () => {
    assert.ok(isKept || isRefused, `regen gave neither a .cadre-new copy nor the line: ${EXPECTED_REFUSED_WRITE}`)
  })

  const startCopy = await liveRepo(ctx, 'gsd', { path: 'start/repo' })
  const settings = join(startCopy.repo, RUNTIME_SETTINGS)
  const rendered = await cadrePrint(startCopy, `start ${ROLE}`)
  noteReply(ctx, 'start be, the first render', rendered)
  if (!existsSync(settings)) {
    const why = firstLineOf(replyOf(rendered))
    throw new HarnessError(`03#60: the first start did not render ${RUNTIME_SETTINGS}: ${why}`)
  }

  await rm(settings)
  await symlink(target, settings)
  const start = await cadrePrint(startCopy, `start ${ROLE}`)
  noteReply(ctx, 'start be with .runtime/settings.json a dangling link', start)
  const reply = replyOf(start)
  const isLinkRefused = reply.includes(EXPECTED_LINK_REFUSAL)
  const isLinkRemoved = !(await isLink(settings)) && printedCommand(reply, ROLE) !== null
  ctx.observe('startOutcome', startOutcomeOf(isLinkRefused, isLinkRemoved), firstLineOf(reply))
  await ctx.check('start removes the link first or refuses with the link text', () => {
    const message = `start neither removed the link nor refused with: ${EXPECTED_LINK_REFUSAL}`
    assert.ok(isLinkRefused || isLinkRemoved, message)
  })

  await ctx.check('the target of the links never exists', () => {
    assert.ok(!existsSync(target), `${TARGET_NAME} exists: a write went through a link`)
  })
})
