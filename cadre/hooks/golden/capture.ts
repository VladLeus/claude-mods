/**
 * Test support for the golden suite (D-219), not a test itself: each capture runs one init flow over the scripted
 * ports of testkit.ts (memIo, memHost), or desiredFiles over one input, and returns its golden value. The golden tests
 * compare that value with their fixture; a scratch run prints it to make the fixture. Only the golden modules import
 * it.
 */
import type { HostIo, InitIo, RawFacts, TerminalChoice } from '../../types'
import { runEpic, runEpicDone } from '../epic'
import { normalizeFacts } from '../facts'
import { desiredFiles } from '../generate'
import type { GenerateInput } from '../generate'
import { sha256Hex } from '../hash'
import { runInit, runRegen } from '../init'
import { MANIFEST_PATH } from '../plan'
import { detectText } from '../render'
import { runStart } from '../start'
import { runStatus } from '../status'
import { memHost, memIo, withEvents } from '../testkit'
import type { HostWorld, MemHost, MemRun, MemWorld } from '../testkit'
import type { GoldenApply, GoldenAsk, GoldenBlock, GoldenCommand, GoldenRun, GoldenWrite } from './types'
import { queuedIo } from './worlds'

/**
 * The golden of a finished run: each question split on '\n' with its spec's header (null when none), options and
 * multi-select, every line logged, every side-pane block, the sha256 of each prompt in order, and the reply split on
 * '\n'.
 */
export async function captureRun(run: MemRun, reply: string): Promise<GoldenRun> {
  const asks = run.asked.map(
    (question, index): GoldenAsk => ({
      question: question.split('\n'),
      header: run.specs[index]?.header ?? null,
      options: run.specs[index]?.options ?? [],
      multiSelect: run.specs[index]?.multiSelect === true,
    }),
  )
  const shown = run.shown.map((block): GoldenBlock => ({ key: block.key, title: block.title, lines: block.lines }))
  const promptHashes = await Promise.all(run.prompts.map(prompt => sha256Hex(prompt)))

  return { asks, logged: run.logged, shown, promptHashes, reply: reply.split('\n') }
}

/** The golden of `/cadre init --dry-run` over `world`, each question answered by its longest prefix in `answers`. */
export async function captureInit(world: MemWorld, answers: Readonly<Record<string, string>>): Promise<GoldenRun> {
  const run = memIo(world, answers)
  const reply = await runInit(run.io, { dryRun: true })

  return captureRun(run, reply)
}

/**
 * The golden of `/cadre init --dry-run` over `world` through queuedIo, as init.test drives the review go-backs: a list
 * under a prefix answers its questions in turn, its last answer repeating; a plain answer answers every time.
 */
export async function captureQueued(
  world: MemWorld,
  answers: Readonly<Record<string, string | readonly (string | null)[]>>,
): Promise<GoldenRun> {
  const run = queuedIo(world, answers)
  const reply = await runInit(run.io, { dryRun: true })

  return captureRun(run, reply)
}

/**
 * The golden of a run that init refused or cancelled, from the run and its reply (captureRun): its asks are empty when
 * the refusal came before the first question.
 */
export async function captureReply(run: MemRun, reply: string): Promise<GoldenRun> {
  return captureRun(run, reply)
}

/**
 * The golden of a plain `/cadre init` over `world` through a fake host over `host` (memHost): the run, every write as
 * its path, the sha256 of its text and whether the host wrote it, every host run as its argv joined by one space, then
 * ` @ ` and its cwd (`-` when it has none), and the text of the manifest write split on '\n' (empty when there is
 * none).
 */
export async function captureApply(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  host: HostWorld,
): Promise<GoldenApply> {
  const run = memIo(world, answers)
  const port = memHost(host)
  const reply = await runInit(run.io, { dryRun: false, host: port.io })
  const writes = await Promise.all(
    port.writes.map(
      async (write): Promise<GoldenWrite> => ({
        path: write.path,
        sha256: await sha256Hex(write.text),
        isWritten: write.isWritten,
      }),
    ),
  )
  const calls = port.calls.map(call => `${call.argv.join(' ')} @ ${call.options.cwd ?? '-'}`)
  const manifest = port.writes.find(write => write.path.endsWith(`/${MANIFEST_PATH}`))

  return { run: await captureRun(run, reply), writes, calls, manifest: manifest?.text.split('\n') ?? [] }
}

/** The sha256 of each file desiredFiles gives for `input`, by its path, in the order desiredFiles sorts the paths. */
export async function captureFiles(input: GenerateInput): Promise<Readonly<Record<string, string>>> {
  const hashes = await Promise.all(
    desiredFiles(input).map(async (file): Promise<[string, string]> => [file.path, await sha256Hex(file.content)]),
  )

  return Object.fromEntries(hashes)
}

/**
 * The golden of a command that ran through the fake host `host` (memHost): the reply split on '\n', every write as its
 * path, the sha256 of its text and whether the host wrote it, and every host run as its argv joined by one space, then
 * ` @ ` and its cwd (`-` when it has none), as captureApply encodes them.
 */
export async function captureCommand(reply: string, host: MemHost): Promise<GoldenCommand> {
  const writes = await Promise.all(
    host.writes.map(
      async (write): Promise<GoldenWrite> => ({
        path: write.path,
        sha256: await sha256Hex(write.text),
        isWritten: write.isWritten,
      }),
    ),
  )
  const calls = host.calls.map(call => `${call.argv.join(' ')} @ ${call.options.cwd ?? '-'}`)

  return { reply: reply.split('\n'), writes, calls }
}

/**
 * The golden of `/cadre start <role>` with no `--terminal` over `world` through a fake host over `host`, as
 * start.test.ts runs runStart: a port with no answers, and the reply, writes and host runs of captureCommand.
 */
export async function captureStart(world: MemWorld, host: HostWorld, role: string): Promise<GoldenCommand> {
  const port = memHost(host)
  const reply = await runStart(memIo(world, {}).io, port.io, { id: role, terminal: 'none' })

  return captureCommand(reply, port)
}

/**
 * The golden of `/cadre regen <id>` over `world`, each question answered by its longest prefix in `answers`: with
 * `dryRun` the run as captureInit gives it (a dry regen holds no host); else, through a fake host over `host`, the run,
 * every write and host run and the manifest text, as captureApply gives them.
 */
export async function captureRegen(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  options:
    | { readonly id: string; readonly dryRun: true }
    | { readonly id: string; readonly dryRun: false; readonly host: HostWorld },
): Promise<GoldenRun | GoldenApply> {
  const run = memIo(world, answers)
  if (options.dryRun) return captureRun(run, await runRegen(run.io, { id: options.id, dryRun: true }))
  const port = memHost(options.host)
  const reply = await runRegen(run.io, { id: options.id, dryRun: false, host: port.io })
  const { writes, calls } = await captureCommand(reply, port)
  const manifest = port.writes.find(write => write.path.endsWith(`/${MANIFEST_PATH}`))

  return { run: await captureRun(run, reply), writes, calls, manifest: manifest?.text.split('\n') ?? [] }
}

/**
 * The golden of `/cadre status <role>` over `world` through a fake host over `host`, as status.test.ts runs runStatus:
 * a port with no answers, and the reply and host runs of captureCommand (status writes nothing).
 */
export async function captureStatus(world: MemWorld, host: HostWorld, role: string): Promise<GoldenCommand> {
  const port = memHost(host)
  const reply = await runStatus(memIo(world, {}).io, port.io, { id: role })

  return captureCommand(reply, port)
}

/**
 * The golden of `/cadre epic <key> [title]` over `world` through a fake host over `host`, as epic.test.ts runs runEpic:
 * a port with no answers, so a question is dismissed, and the reply, writes and host runs of captureCommand.
 */
export async function captureEpic(
  world: MemWorld,
  host: HostWorld,
  options: { readonly key: string; readonly title: string; readonly terminal: Exclude<TerminalChoice, 'none'> },
): Promise<GoldenCommand> {
  const port = memHost(host)
  const reply = await runEpic(memIo(world, {}).io, port.io, options)

  return captureCommand(reply, port)
}

/**
 * The golden of `/cadre epic done <key> [--force]` over `world` through a fake host over `host`, as epic.test.ts runs
 * runEpicDone: a port with no answers in order, and the reply, writes and host runs of captureCommand.
 */
export async function captureEpicDone(
  world: MemWorld,
  host: HostWorld,
  options: { readonly key: string; readonly force: boolean },
): Promise<GoldenCommand> {
  const port = memHost(host)
  const reply = await runEpicDone(memIo(world, []).io, port.io, options)

  return captureCommand(reply, port)
}

/**
 * The golden of `/cadre detect` (`--adapters` when `isAdapters`) over one raw host read, normalized with this config
 * dir and the root as given: the report split on '\n'.
 */
export function captureDetect(raw: RawFacts, configDir: string | null, root: string, isAdapters: boolean): string[] {
  return detectText(normalizeFacts(raw, configDir, root), isAdapters).split('\n')
}

/** Each host run in call order as JSON of its argv and its options (cwd, timeoutMs, env, stdin): nothing is lost. */
export function callsOf(host: MemHost): string[] {
  return host.calls.map(call => JSON.stringify([call.argv, call.options]))
}

/**
 * The host runs of `/cadre epic <key> [title]` over `world` through a fake host over `host`, driven as captureEpic
 * drives it (a port with no answers): each run as callsOf gives it, so its timeout, env and stdin are pinned too.
 */
export async function captureEpicCalls(
  world: MemWorld,
  host: HostWorld,
  options: { readonly key: string; readonly title: string; readonly terminal: Exclude<TerminalChoice, 'none'> },
): Promise<string[]> {
  const port = memHost(host)
  await runEpic(memIo(world, {}).io, port.io, options)

  return callsOf(port)
}

/**
 * The host runs of `/cadre epic done <key> [--force]` over `world` through a fake host over `host`, driven as
 * captureEpicDone drives it (a port with no answers in order): each run as callsOf gives it.
 */
export async function captureEpicDoneCalls(
  world: MemWorld,
  host: HostWorld,
  options: { readonly key: string; readonly force: boolean },
): Promise<string[]> {
  const port = memHost(host)
  await runEpicDone(memIo(world, []).io, port.io, options)

  return callsOf(port)
}

/**
 * The host runs of `/cadre status <role>` over `world` through a fake host over `host`, driven as captureStatus drives
 * it (a port with no answers): each run as callsOf gives it.
 */
export async function captureStatusCalls(world: MemWorld, host: HostWorld, role: string): Promise<string[]> {
  const port = memHost(host)
  await runStatus(memIo(world, {}).io, port.io, { id: role })

  return callsOf(port)
}

/**
 * The host runs of `/cadre start <role>` with no `--terminal` over `world` through a fake host over `host`, driven as
 * captureStart drives it (a port with no answers): each run as callsOf gives it.
 */
export async function captureStartCalls(world: MemWorld, host: HostWorld, role: string): Promise<string[]> {
  const port = memHost(host)
  await runStart(memIo(world, {}).io, port.io, { id: role, terminal: 'none' })

  return callsOf(port)
}

/**
 * The port of `run` that records in one list, in the order they happened, each question, log entry and side-pane block
 * as withEvents does, and each completion as `prompt <sha256 of ${system}\n---\n${prompt}>` (the form of
 * MemRun.prompts, so it matches promptHashes) at the place it was asked: its slot is taken before the reply comes.
 */
function timelineIo(run: MemRun): { readonly io: InitIo; readonly events: string[] } {
  const { io, events } = withEvents(run)

  return {
    io: {
      ...io,
      complete: async (prompt, system) => {
        const slot = events.push('') - 1
        const reply = await io.complete(prompt, system)
        events[slot] = `prompt ${await sha256Hex(`${system}\n---\n${prompt}`)}`

        return reply
      },
    },
    events,
  }
}

/**
 * The HostIo of `host` that also records into `events` each write as `write <path> <sha256 of its text> <true|false>`
 * at the place it was asked (its slot is taken before the host answers), and each run as `run <JSON of its argv and
 * options>` before it runs. `env` is the host's.
 */
function timelineHost(host: MemHost, events: string[]): HostIo {
  return {
    write: async (path, text) => {
      const slot = events.push('') - 1
      const isWritten = await host.io.write(path, text)
      events[slot] = `write ${path} ${await sha256Hex(text)} ${isWritten}`

      return isWritten
    },
    run: async (argv, options) => {
      events.push(`run ${JSON.stringify([argv, options])}`)

      return host.io.run(argv, options)
    },
    env: name => host.io.env(name),
  }
}

/**
 * The event order of `/cadre init --dry-run` over `world`, each question answered by its longest prefix in `answers`
 * as captureInit answers it: every question, log entry, side-pane block and prompt, as timelineIo records them.
 */
export async function captureTimeline(world: MemWorld, answers: Readonly<Record<string, string>>): Promise<string[]> {
  const { io, events } = timelineIo(memIo(world, answers))
  await runInit(io, { dryRun: true })

  return events
}

/**
 * The event order of `/cadre init --dry-run` over `world` through queuedIo, as captureQueued drives the review
 * go-backs: every question, log entry, side-pane block and prompt, as timelineIo records them.
 */
export async function captureTimelineQueued(
  world: MemWorld,
  answers: Readonly<Record<string, string | readonly (string | null)[]>>,
): Promise<string[]> {
  const { io, events } = timelineIo(queuedIo(world, answers))
  await runInit(io, { dryRun: true })

  return events
}

/**
 * The event order of a plain `/cadre init` over `world` through a fake host over `host`, as captureApply drives it:
 * every question, log entry, side-pane block and prompt as timelineIo records them, with every write and host run
 * between them as timelineHost records them.
 */
export async function captureTimelineApply(
  world: MemWorld,
  answers: Readonly<Record<string, string>>,
  host: HostWorld,
): Promise<string[]> {
  const { io, events } = timelineIo(memIo(world, answers))
  await runInit(io, { dryRun: false, host: timelineHost(memHost(host), events) })

  return events
}
