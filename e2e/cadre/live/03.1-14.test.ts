import assert from 'node:assert/strict'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { claudeBin } from '../../lib/claude.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { hashFile } from '../../lib/hash.ts'
import { run } from '../../lib/proc.ts'
import { rowTest } from '../../lib/row.ts'
import type { RowContext } from '../../lib/row.ts'
import type { Json } from '../../lib/summary.ts'
import { EPIC_KEY, gitOk, printEpic, roleIdsOf } from '../lib/epic.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf, statusLine } from '../lib/session.ts'
import type { LiveRepo } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

const ROLE = 'be'
const NO_BASH_ROLE = 'pm'
const CODE_DIR = 'src'
const LAUNCHER = `.cadre/bin/${ROLE}`
const MCP_NAME = 'e2e-echo'
const MCP_ADD_MS = 60_000
const HAND_EDIT = '# edited by hand\n'
const NON_ALPHANUMERIC_RE = /[^A-Za-z0-9]/g
const CODE_DIR_RULE_RE = new RegExp(`^(?:Read|Edit)\\(.*/${CODE_DIR}/\\*\\*\\)$`)
const EXPECTED_CHANGED = `${LAUNCHER} was changed outside cadre`
const EXPECTED_BAD_STATE = '.cadre/cadre.json is not valid: fix it, or run /cadre init again.'

// The rule cadre writes for an absolute path: `//` and the path without its leading slash, then the suffix.
function rule(tool: string, path: string, suffix: string): string {
  return `${tool}(/${path}${suffix})`
}

async function jsonOf(path: string): Promise<unknown> {
  const text = await readFile(path, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function denyOf(worktree: string, id: string): Promise<readonly string[] | null> {
  const settings = await jsonOf(join(worktree, '.cadre', id, '.runtime', 'settings.json'))
  const permissions = isRecord(settings) ? settings.permissions : undefined
  const deny = isRecord(permissions) ? permissions.deny : undefined

  return Array.isArray(deny) ? deny.filter((item): item is string => typeof item === 'string') : null
}

async function mcpNamesOf(worktree: string, id: string): Promise<readonly string[] | null> {
  const mcp = await jsonOf(join(worktree, '.cadre', id, '.runtime', 'mcp.json'))
  const servers = isRecord(mcp) ? mcp.mcpServers : undefined

  return isRecord(servers) ? Object.keys(servers).sort() : null
}

async function hashOrNull(path: string): Promise<string | null> {
  return hashFile(path).catch(() => null)
}

// claude writes the server into its own config for the project of main, as a person's `claude mcp add` does.
async function addMcpServer(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const argv = [claudeBin(), 'mcp', 'add', '--scope', 'local', MCP_NAME, '--', '/bin/echo', 'e2e']
  const added = await run(argv, { cwd: copy.repo, env: copy.env, timeoutMs: MCP_ADD_MS })
  ctx.evidence('claude mcp add in main', `exit ${added.code}\n${added.stdout}\n${added.stderr}`)
}

async function definitionsHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd', { path: 'definitions/repo' })
  const ids = await roleIdsOf(copy)
  const mainRoot = await realpath(copy.repo)
  const userDir = copy.env.CLAUDE_CONFIG_DIR
  if (userDir === undefined) throw new HarnessError('03.1#14: the live env has no CLAUDE_CONFIG_DIR')
  await addMcpServer(ctx, copy)

  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'definitions: epic', epic.result)
  const inWorktree: LiveRepo = { repo: epic.worktree, env: copy.env }
  const kickoff = join(epic.worktree, '.cadre', ROLE, '.runtime', 'kickoff.txt')
  const kickoffBefore = await hashOrNull(kickoff)
  const printed = new Map<string, string | null>()
  for (const id of [NO_BASH_ROLE, ROLE]) {
    const started = await cadrePrint(inWorktree, `start ${id}`)
    noteReply(ctx, `definitions: start ${id} in the worktree`, started)
    printed.set(id, printedCommand(replyOf(started), id))
  }
  const status = await cadrePrint(inWorktree, `status ${ROLE}`)
  noteReply(ctx, `definitions: status ${ROLE} in the worktree`, status)

  for (const id of [NO_BASH_ROLE, ROLE]) {
    await ctx.check(`definitions: start ${id} works in the worktree`, () => {
      assert.ok(typeof printed.get(id) === 'string', `the reply prints no ${id} launcher command`)
    })
  }
  await ctx.check('definitions: start keeps .runtime/kickoff.txt', async () => {
    assert.ok(kickoffBefore !== null, `the epic wrote no .cadre/${ROLE}/.runtime/kickoff.txt`)
    assert.equal(await hashOrNull(kickoff), kickoffBefore, 'start changed or removed kickoff.txt')
  })
  await ctx.check('definitions: status works in the worktree', () => {
    const reply = replyOf(status)
    assert.ok(statusLine(reply, 'state') !== null, `the reply holds no state line: ${firstLineOf(reply)}`)
  })

  await ctx.check(`definitions: the rendered settings of ${NO_BASH_ROLE} deny the code dirs of main`, async () => {
    const deny = await denyOf(epic.worktree, NO_BASH_ROLE)
    assert.ok(deny !== null, `${NO_BASH_ROLE} has no rendered settings.json with a deny list in the worktree`)
    const wanted = [rule('Read', mainRoot, `/${CODE_DIR}/**`), rule('Edit', mainRoot, `/${CODE_DIR}/**`)]
    const missing = wanted.filter(item => !deny.includes(item))
    assert.deepEqual(missing, [], `the deny list lacks: ${missing.join(' | ')}`)
  })
  await ctx.check(`definitions: the rendered settings of ${ROLE} deny no code dir`, async () => {
    const deny = await denyOf(epic.worktree, ROLE)
    assert.ok(deny !== null, `${ROLE} has no rendered settings.json with a deny list in the worktree`)
    const found = deny.filter(item => CODE_DIR_RULE_RE.test(item))
    assert.deepEqual(found, [], `the deny list holds code dir denies: ${found.join(' | ')}`)
  })
  const memory = `${userDir}/projects/${mainRoot.replace(NON_ALPHANUMERIC_RE, '-')}/memory`
  for (const id of ids) {
    await ctx.check(`definitions: ${id} denies Edit and Write of the memory folder of main`, async () => {
      const deny = await denyOf(epic.worktree, id)
      assert.ok(deny !== null, `${id} has no rendered settings.json with a deny list in the worktree`)
      const missing = [rule('Edit', memory, '/**'), rule('Write', memory, '/**')].filter(item => !deny.includes(item))
      assert.deepEqual(missing, [], `the deny list lacks: ${missing.join(' | ')}`)
    })
  }

  const rendered: Record<string, Json> = {}
  for (const id of ids) rendered[id] = [...(await mcpNamesOf(epic.worktree, id) ?? [])]
  ctx.observe('renderedMcpServers', rendered, 'the servers in .cadre/<id>/.runtime/mcp.json of the worktree, by role')
}

// Only the launcher reaches HEAD, so the branch holds a launcher its manifest does not name, as after a regen whose
// commit left out .cadre/manifest.json; main itself keeps the launcher and manifest that match.
async function commitLauncherOnly(ctx: RowContext, copy: LiveRepo): Promise<void> {
  const edited = join(ctx.scratch, 'launcher-edited')
  await writeFile(edited, `${await readFile(join(copy.repo, LAUNCHER), 'utf8')}${HAND_EDIT}`)
  const blob = await gitOk(copy, ['hash-object', '-w', edited])
  await gitOk(copy, ['update-index', '--cacheinfo', `100755,${blob},${LAUNCHER}`])
  await gitOk(copy, ['commit', '-q', '-m', 'commit only the launcher'])
}

async function launcherOnlyHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd', { path: 'launcher-only/repo' })
  await commitLauncherOnly(ctx, copy)
  const inMain = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, `launcher only: start ${ROLE} in main`, inMain)
  ctx.observe('startPassesInMain', printedCommand(replyOf(inMain), ROLE) !== null, 'main keeps a matching launcher')

  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'launcher only: epic', epic.result)
  const started = await cadrePrint({ repo: epic.worktree, env: copy.env }, `start ${ROLE}`)
  noteReply(ctx, `launcher only: start ${ROLE} in the worktree`, started)
  await ctx.check(`launcher only: start ${ROLE} in the worktree refuses with ${EXPECTED_CHANGED}`, () => {
    assert.ok(replyOf(started).includes(EXPECTED_CHANGED), `the reply does not hold: ${EXPECTED_CHANGED}`)
  })
}

async function ignoreAllHalf(ctx: RowContext): Promise<void> {
  const copy = await liveRepo(ctx, 'gsd-ignoreall', { path: 'ignore-all/repo' })
  const epic = await printEpic(copy, EPIC_KEY)
  noteReply(ctx, 'ignore-all: epic', epic.result)
  const inWorktree: LiveRepo = { repo: epic.worktree, env: copy.env }
  const status = await cadrePrint(inWorktree, `status ${ROLE}`)
  noteReply(ctx, `ignore-all: status ${ROLE} in the worktree`, status)
  const started = await cadrePrint(inWorktree, `start ${ROLE}`)
  noteReply(ctx, `ignore-all: start ${ROLE} in the worktree`, started)

  await ctx.check('ignore-all: status reports the role run in the worktree', () => {
    const reply = replyOf(status)
    assert.ok(statusLine(reply, 'state') !== null, `the reply holds no state line: ${firstLineOf(reply)}`)
  })
  await ctx.check(`ignore-all: start refuses with ${EXPECTED_BAD_STATE}`, () => {
    assert.ok(replyOf(started).includes(EXPECTED_BAD_STATE), `the reply does not hold: ${EXPECTED_BAD_STATE}`)
  })
}

const entry = rowEntry('03.1#14')

rowTest(entry, async ctx => {
  for (const part of entry.partial ?? []) ctx.skipPart(part.part, part.reason)
  await definitionsHalf(ctx)
  await launcherOnlyHalf(ctx)
  await ignoreAllHalf(ctx)
})
