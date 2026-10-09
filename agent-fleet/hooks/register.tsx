import { atom, read, update } from 'claude-code'
import type { AgentStatus, EngineInterface, Register } from 'claude-code'

import type { AgentRow, AgentRunState, AutopilotBadge, Beat, Liveness } from '../types'
import {
  BEAT_MS,
  CLEANUP_MINUTES,
  SESSION_COLORS,
  agentRows,
  ago,
  autopilotLine,
  bar,
  basename,
  displayName,
  liveness,
  messageLines,
  pickIdentity,
  shortId,
  shortModel,
  tokensK,
  upsertLink,
  visible,
} from './fleet'

const PANE = 'agent-fleet'
const fleet = atom({ plugin: 'agent-fleet', key: 'fleet' } as const, [] as Beat[])
const selfId = atom({ plugin: 'agent-fleet', key: 'selfId' } as const, '')

const STATE_PILL: Record<Liveness, { glyph: string; word: string; color: string }> = {
  active: { glyph: '●', word: 'working', color: 'success' },
  idle: { glyph: '○', word: 'idle', color: 'subtle' },
  stale: { glyph: '◌', word: 'no signal', color: 'warning' },
  ended: { glyph: '✕', word: 'ended', color: 'inactive' },
}
const AGENT_GLYPH: Record<AgentRunState, { glyph: string; color: string }> = {
  running: { glyph: '▸', color: 'success' },
  waiting: { glyph: '…', color: 'warning' },
  done: { glyph: '✓', color: 'subtle' },
  failed: { glyph: '✗', color: 'error' },
}
const RUN_STATE: Record<AgentStatus, AgentRunState> = {
  pending: 'running',
  running: 'running',
  waiting: 'waiting',
  idle: 'waiting',
  completed: 'done',
  failed: 'failed',
  killed: 'failed',
}

let me: Beat | null = null
let dir = ''
let transcript = ''
let writing: Promise<void> = Promise.resolve()
let isPaneOpen = false

function fileOf(id: string): string {
  return `${dir}/${id.replace(/[^\w.-]/g, '_')}.json`
}

function setAgent(id: string, change: (row: AgentRow) => AgentRow): void {
  if (!me) return
  me.agents = me.agents.map(row => (row.id === id ? change(row) : row))
}

/** Reads the session's /rename name and /color from its transcript. */
async function refreshIdentity($: EngineInterface): Promise<void> {
  if (!me || !transcript) return
  let out = ''
  try {
    const grep = $.process.spawn({
      argv: ['grep', '-o', '-E', '"type":"(custom-title|agent-name|ai-title|agent-color)","[a-zA-Z]+":"[^"]*"', transcript],
    })
    for await (const chunk of grep) if (chunk.stream === 'stdout') out += chunk.text
  } catch {
    return
  }
  const identity = pickIdentity(out)
  me.name = identity.name
  me.color = identity.color
}

async function refreshCounts($: EngineInterface): Promise<void> {
  if (!me) return
  const [usage, agents, now] = await Promise.all([
    $.session.usage().catch(() => null),
    $.agent.list().catch(() => []),
    $.clock.now(),
  ])
  if (usage) {
    me.context = {
      percent: usage.context.percent ?? null,
      tokens: usage.context.tokens ?? null,
      window: usage.context.window,
    }
    me.costUsd = usage.cost?.usd ?? null
  }
  for (const info of agents) {
    const status = RUN_STATE[info.status]
    const isOver = status === 'done' || status === 'failed'
    if (!me.agents.some(row => row.id === info.id)) {
      me.agents.push({
        id: info.id,
        label: info.description || info.name || info.type,
        type: info.type,
        model: null,
        status,
        startedAt: now,
        endedAt: isOver ? now : null,
        isWorkflow: false,
      })
      continue
    }
    setAgent(info.id, row => ({ ...row, status, endedAt: isOver ? (row.endedAt ?? now) : null }))
  }
}

/** Writes this session's beat; writes are chained so two never interleave. */
function beat($: EngineInterface): Promise<void> {
  writing = writing
    .then(async () => {
      if (!me || !dir) return
      await refreshCounts($)
      me.beatAt = await $.clock.now()
      await $.fs.write(fileOf(me.id), JSON.stringify(me))
    })
    .catch(() => undefined)

  return writing
}

/** The autopilot mod's status for a session, when it runs there; null otherwise. */
async function readAutopilot($: EngineInterface, id: string): Promise<AutopilotBadge | null> {
  try {
    const badge = JSON.parse(await $.fs.read(`${dir.replace(/\/fleet$/, '/autopilot')}/${id}.json`)) as AutopilotBadge
    return badge.isOn ? badge : null
  } catch {
    return null
  }
}

async function scan($: EngineInterface): Promise<void> {
  if (!dir) return
  const entries = await $.fs.list(dir).catch(() => [])
  const beats: Beat[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(await $.fs.read(`${dir}/${entry.name}`)) as Beat
      // A beat written by an older version of the mod lacks these.
      if (!Array.isArray(parsed.agents) || !Array.isArray(parsed.links)) continue
      parsed.autopilot = await readAutopilot($, parsed.id)
      beats.push(parsed)
    } catch {
      // A file mid-write or foreign: skip it this round.
    }
  }
  await update($, fleet, () => beats)
}

/**
 * Makes `me` the beat of the session id the engine answers now. /clear (no
 * session.start follows it) and /resume change the id under a running module:
 * the old beat is closed and the new id's is started, or picked back up from
 * its file, so a resumed session keeps its agents and links.
 */
async function adopt($: EngineInterface): Promise<void> {
  const id = await $.session.id()
  if (me && me.id === id) return

  const now = await $.clock.now()
  if (me && !me.isEnded) {
    me.isEnded = true
    me.isActive = false
    me.endedAt = now
    me.endReason = me.endReason ?? 'switched'
    await beat($)
  }

  const home = await $.env.get('HOME')
  dir = `${home ?? '.'}/.claude/fleet`
  // The project root, not the current directory: a shell `cd` moves only the latter,
  // and the transcript lives under the root's folder.
  const [cwd, model, usage] = await Promise.all([
    $.session.root(),
    $.session.model(),
    $.session.usage().catch(() => null),
  ])
  transcript = `${home ?? '.'}/.claude/projects/${cwd.replace(/[^a-zA-Z0-9]/g, '-')}/${id}.jsonl`
  await update($, selfId, () => id)

  // A hot reload or a /resume: pick that session's agents and links back up.
  let previous: Partial<Beat> | null = null
  try {
    previous = JSON.parse(await $.fs.read(fileOf(id))) as Partial<Beat>
  } catch {
    previous = null
  }
  me = {
    id,
    name: null,
    color: null,
    label: `${basename(cwd)}·${shortId(id)}`,
    cwd,
    model,
    startedAt: usage?.startedAt ?? now,
    beatAt: 0,
    isActive: false,
    turnStartedAt: null,
    idleSince: now,
    isEnded: false,
    endedAt: null,
    endReason: null,
    context: { percent: null, tokens: null, window: 0 },
    costUsd: null,
    agents: Array.isArray(previous?.agents) ? previous.agents : [],
    links: Array.isArray(previous?.links) ? previous.links : [],
    inboundUnknown: previous?.inboundUnknown ?? 0,
  }
  await refreshIdentity($)
}

/** Deletes heartbeat files nobody has written for CLEANUP_MINUTES. */
async function cleanup($: EngineInterface): Promise<void> {
  if (!dir) return
  try {
    const find = $.process.spawn({
      argv: ['find', dir, '-maxdepth', '1', '-type', 'f', '-name', '*.json', '-mmin', `+${CLEANUP_MINUTES}`, '-delete'],
    })
    for await (const _ of find) {
      // Nothing to read: find prints nothing with -delete.
    }
  } catch {
    // The next sweep tries again.
  }
}

async function tick($: EngineInterface): Promise<void> {
  await adopt($)
  await beat($)
  await scan($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await adopt($)
    void cleanup($)

    await $.command.register({
      name: 'fleet',
      description: 'Toggle the agent fleet dashboard (or /fleet open, /fleet close)',
    })
    $.clock.every(BEAT_MS, () => void tick($))
    $.clock.every(60 * 60_000, () => void cleanup($))
    void tick($)

    return next(e)
  })

  on('command.run', { command: 'fleet' }, async ($, e) => {
    const wants = e.args.trim()
    if (wants === 'close' || (wants !== 'open' && isPaneOpen)) {
      await $.ui.close({ id: PANE })
      isPaneOpen = false

      return { text: 'Agent fleet pane closed.' }
    }
    await refreshIdentity($)
    await tick($)
    await $.ui.open({ id: PANE, title: 'Agent fleet' })
    isPaneOpen = true

    return { text: 'Agent fleet pane opened. Run /fleet again to close it.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) isPaneOpen = false

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (me) {
      me.isActive = true
      me.turnStartedAt = await $.clock.now()
      await refreshIdentity($)
      void tick($)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!me) return result
    const now = await $.clock.now()

    if (e.agentId) {
      // An agent ending its turn reports back to the main conversation.
      const agentId = e.agentId
      me.links = upsertLink(me.links, agentId, me.id)
      setAgent(agentId, row =>
        row.isWorkflow ? { ...row, status: e.isAborted ? 'failed' : 'done', endedAt: now } : row,
      )
      void tick($)

      return result
    }

    me.isActive = false
    me.turnStartedAt = null
    me.idleSince = now
    await refreshIdentity($)
    void tick($)

    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const result = await next(e)
    if (me && 'agentId' in result && result.agentId) {
      const agentId = result.agentId
      me.agents = me.agents.filter(row => row.id !== agentId)
      me.agents.push({
        id: agentId,
        label: e.description || e.subagentType,
        type: e.subagentType,
        model: 'model' in result ? (result.model ?? null) : null,
        status: 'running',
        startedAt: await $.clock.now(),
        endedAt: null,
        isWorkflow: Boolean(e.workflow),
      })
      void beat($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.send', async ($, e, next) => {
    const result = await next(e)
    if (me && result.isDelivered) {
      me.links = upsertLink(me.links, e.agentId ?? me.id, e.to)
      void tick($)
    }

    return result
  }).catch(($, e, next) => next(e))

  on('session.receive', async ($, e, next) => {
    // A delivery to one of our own agents was already counted by its send.
    if (me && !e.agentId) {
      const origin = e.origin
      if ('teammate' in origin) me.links = upsertLink(me.links, origin.teammate, me.id)
      if (!('teammate' in origin) && origin.kind === 'peer') me.inboundUnknown += 1
      void tick($)
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (me) {
      me.isEnded = true
      me.isActive = false
      me.endedAt = await $.clock.now()
      me.endReason = e.reason
      await beat($)
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const self = await read($, selfId)
    const beats = visible(await read($, fleet), now)

    if (beats.length === 0) {
      return <Text dimColor>Waiting for the first heartbeat (every {BEAT_MS / 1000}s)…</Text>
    }

    const working = beats.filter(b => liveness(b, now) === 'active').length
    const agentsRunning = beats.reduce(
      (sum, b) => sum + b.agents.filter(a => a.status === 'running').length,
      0,
    )

    return (
      <Box flexDirection="column">
        <Text>
          <Text bold>{beats.length}</Text> session{beats.length === 1 ? '' : 's'} ·{' '}
          <Text color="success">{working} working</Text> · {agentsRunning} agent
          {agentsRunning === 1 ? '' : 's'} running
        </Text>
        {beats.map(b => {
          const state = liveness(b, now)
          const pill = STATE_PILL[state]
          const tint = b.color ? (SESSION_COLORS[b.color] ?? b.color) : undefined
          const since =
            state === 'active' && b.turnStartedAt
              ? ago(now - b.turnStartedAt)
              : state === 'idle' && b.idleSince
                ? ago(now - b.idleSince)
                : state === 'stale'
                  ? ago(now - b.beatAt)
                  : ''
          const { shown, hidden } = agentRows(b.agents)
          const running = b.agents.filter(a => a.status === 'running').length
          const finished = b.agents.length - running
          const messages = messageLines(b, beats)

          return (
            <Box
              key={b.id}
              flexDirection="column"
              borderStyle="round"
              borderColor={tint ?? (state === 'active' ? 'success' : 'subtle')}
              paddingX={1}
              marginTop={1}
            >
              <Box justifyContent="space-between">
                <Text bold color={tint} wrap="truncate-end">
                  {displayName(b)}
                  {b.id === self ? <Text dimColor> (this)</Text> : ''}
                </Text>
                <Text color={pill.color}>
                  {pill.glyph} {pill.word}
                  {since ? ` ${since}` : ''}
                </Text>
              </Box>

              {b.autopilot && (
                <Text color="claude" wrap="truncate-end">
                  {autopilotLine(b.autopilot, now)}
                </Text>
              )}

              <Text wrap="truncate-end">
                <Text dimColor>Context  </Text>
                {bar(b.context.percent, 10)}  {tokensK(b.context.tokens)} of {tokensK(b.context.window)}
              </Text>

              <Text wrap="truncate-end">
                <Text dimColor>Agents   </Text>
                {b.agents.length === 0 ? (
                  <Text dimColor>none yet</Text>
                ) : (
                  `${running} working · ${finished} done`
                )}
              </Text>
              {shown.map(agent => {
                const glyph = AGENT_GLYPH[agent.status]
                const took = (agent.endedAt ?? now) - agent.startedAt

                return (
                  <Box key={agent.id} justifyContent="space-between">
                    <Text wrap="truncate-end">
                      {'  '}
                      <Text color={glyph.color}>{glyph.glyph}</Text> {agent.label}
                      <Text dimColor>
                        {'  '}
                        {agent.isWorkflow ? 'workflow · ' : ''}
                        {agent.type}
                        {agent.model ? ` · ${shortModel(agent.model)}` : ''}
                      </Text>
                    </Text>
                    <Text dimColor>{ago(took)}</Text>
                  </Box>
                )
              })}
              {hidden > 0 && <Text dimColor>{'  '}+{hidden} more</Text>}

              {messages.length > 0 && (
                <Text wrap="truncate-end">
                  <Text dimColor>Messages </Text>
                  {messages.join('   ')}
                </Text>
              )}

              <Text dimColor wrap="truncate-end">
                {shortModel(b.model)} · {basename(b.cwd)}
                {b.costUsd !== null ? ` · $${b.costUsd.toFixed(2)} API-equivalent` : ''}
              </Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
