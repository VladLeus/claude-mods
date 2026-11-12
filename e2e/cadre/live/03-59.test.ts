import assert from 'node:assert/strict'
import { join } from 'node:path'
import { printMode } from '../../lib/claude.ts'
import { fenceBin, liveEnv } from '../../lib/env.ts'
import { HarnessError } from '../../lib/errors.ts'
import { isRecord } from '../../lib/filter.ts'
import { rowTest } from '../../lib/row.ts'
import { probeFailShim } from '../../lib/shims.ts'
import { cadrePrint, firstLineOf, liveRepo, noteReply, printedCommand, replyOf, runProbe } from '../lib/session.ts'
import { rowEntry } from '../rows.ts'

type InitEvent = {
  readonly raw: string
  readonly event: Record<string, unknown>
}

type ListItem = {
  readonly list: string
  readonly item: unknown
}

const ROLE = 'be'
const EXPECTED_NO_LIST_REFUSAL =
  'cadre: the probe startup inventory does not hold one tools, skills and slash_commands list'
const EXPECTED_NAME_REFUSAL = 'cadre: the probe startup inventory holds a name the launcher cannot read'
const FORCED_FAILURE = 'e2e: forced probe failure'
const REFUSAL_PREFIX = 'cadre:'
const INIT_LISTS: readonly string[] = ['tools', 'skills', 'slash_commands']
const PLAIN_PROMPT = 'Reply with OK'
const SHOWN_ITEMS = 10

const row = rowEntry('03#59')

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

// The first system/init event of a stream-json run, with the raw line the launcher reads.
function initEventOf(stdout: string): InitEvent | null {
  for (const raw of stdout.split('\n')) {
    const event = parseJson(raw)
    if (isRecord(event) && event.type === 'system' && event.subtype === 'init') return { raw, event }
  }

  return null
}

function itemsOf(event: Record<string, unknown>): readonly ListItem[] {
  return INIT_LISTS.flatMap(list => {
    const value = event[list]

    return Array.isArray(value) ? value.map((item): ListItem => ({ list, item })) : []
  })
}

function occurrences(text: string, part: string): number {
  return text.split(part).length - 1
}

function itemsText(found: readonly ListItem[]): string {
  if (found.length === 0) return 'none'
  const shown = found.slice(0, SHOWN_ITEMS).map(({ list, item }) => `${list}: ${JSON.stringify(item)}`)
  const more = found.length - SHOWN_ITEMS

  return [...shown, ...(more > 0 ? [`... and ${more} more`] : [])].join('\n')
}

rowTest(row, async ctx => {
  for (const part of row.partial ?? []) ctx.skipPart(part.part, part.reason)
  const copy = await liveRepo(ctx, 'gsd')
  const started = await cadrePrint(copy, `start ${ROLE}`)
  noteReply(ctx, 'start be', started)
  if (printedCommand(replyOf(started), ROLE) === null) {
    throw new HarnessError(`03#59: the start did not render: ${firstLineOf(replyOf(started))}`)
  }

  const probe = await runProbe(copy, ROLE)
  noteReply(ctx, 'the probe', probe)
  const probeText = `${probe.stdout}\n${probe.stderr}`
  await ctx.check('the probe exits 0', () => {
    assert.equal(probe.code, 0, `the probe exited ${probe.code}`)
  })
  await ctx.check('the probe does not refuse for the inventory lists', () => {
    assert.ok(!probeText.includes(EXPECTED_NO_LIST_REFUSAL), `the probe printed: ${EXPECTED_NO_LIST_REFUSAL}`)
  })
  await ctx.check('the probe does not refuse for a name it cannot read', () => {
    assert.ok(!probeText.includes(EXPECTED_NAME_REFUSAL), `the probe printed: ${EXPECTED_NAME_REFUSAL}`)
  })

  const plain = await printMode(copy.repo, ['--output-format', 'stream-json', '--verbose', PLAIN_PROMPT], copy.env)
  ctx.evidence('the plain stream-json run, exit code and stderr', `exit ${plain.code}\n${plain.stderr}`)
  const init = initEventOf(plain.stdout)
  if (init === null) {
    throw new HarnessError(`03#59: the stream-json run printed no system/init event (exit ${plain.code})`)
  }
  for (const list of INIT_LISTS) {
    await ctx.check(`the init line holds "${list}":[ exactly once`, () => {
      const count = occurrences(init.raw, `"${list}":[`)
      assert.equal(count, 1, `the init line holds "${list}":[ ${count} times`)
    })
  }

  const items = itemsOf(init.event)
  const names = items.filter(({ item }) => typeof item === 'string')
  const bracketed = names.filter(({ item }) => String(item).includes(']'))
  const escaped = names.filter(({ item }) => JSON.stringify(item) !== `"${String(item)}"`)
  const unquoted = items.filter(({ item }) => typeof item !== 'string')
  ctx.observe('namesHoldingAClosingBracket', bracketed.length, itemsText(bracketed))
  ctx.observe('namesHoldingAJsonEscapedCharacter', escaped.length, itemsText(escaped))
  ctx.observe('entriesThatAreNotStrings', unquoted.length, itemsText(unquoted))

  const shimDir = join(ctx.scratch, 'shims')
  await probeFailShim(shimDir, fenceBin(), FORCED_FAILURE)
  const failing = await runProbe(copy, ROLE, liveEnv({ shimDir }))
  noteReply(ctx, 'the probe with a failing claude', failing)
  const lines = failing.stderr.split('\n')
  const failureAt = lines.findIndex(line => line.includes(FORCED_FAILURE))
  const refusalAt = lines.findIndex(line => line.startsWith(REFUSAL_PREFIX))
  ctx.evidence('the launcher refusal line', lines[refusalAt] ?? 'none')
  await ctx.check('the failing probe exits non-zero', () => {
    assert.notEqual(failing.code, 0, 'the probe exited 0')
  })
  await ctx.check('the failing probe shows the error of claude', () => {
    assert.ok(failureAt >= 0, `stderr does not hold: ${FORCED_FAILURE}`)
  })
  await ctx.check('the error of claude comes before the launcher refusal', () => {
    assert.ok(refusalAt >= 0, `stderr holds no ${REFUSAL_PREFIX} line`)
    assert.ok(failureAt < refusalAt, 'the launcher refusal comes before the error of claude')
  })
})
