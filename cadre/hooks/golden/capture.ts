/**
 * Test support for the golden suite (D-219), not a test itself: each capture runs one init flow over the scripted
 * ports of testkit.ts (memIo, memHost), or desiredFiles over one input, and returns its golden value. The golden tests
 * compare that value with their fixture; a scratch run prints it to make the fixture. Only the golden modules import
 * it.
 */
import { desiredFiles } from '../generate'
import type { GenerateInput } from '../generate'
import { sha256Hex } from '../hash'
import { runInit } from '../init'
import { MANIFEST_PATH } from '../plan'
import { runStart } from '../start'
import { memHost, memIo } from '../testkit'
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
