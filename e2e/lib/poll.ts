import { HarnessError } from './errors.ts'

export type PollOptions = {
  readonly timeoutMs: number
  readonly intervalMs: number
  readonly now: () => number
  readonly sleep: (ms: number) => Promise<unknown>
  readonly isDead?: () => boolean | Promise<boolean>
  readonly label?: string
}

function shown(value: unknown): string {
  return typeof value === 'string' ? value : String(JSON.stringify(value))
}

export async function pollUntil<T>(
  read: () => Promise<T>,
  match: (value: T) => boolean,
  opts: PollOptions,
): Promise<T> {
  const label = opts.label ?? 'poll'
  const deadline = opts.now() + opts.timeoutMs
  for (;;) {
    const value = await read()
    if (match(value)) return value
    if (opts.isDead && await opts.isDead()) {
      throw new HarnessError(`${label}: stopped, the watched process is dead; last read:\n${shown(value)}`)
    }
    if (opts.now() >= deadline) {
      throw new HarnessError(`${label}: timed out after ${opts.timeoutMs} ms; last read:\n${shown(value)}`)
    }
    await opts.sleep(opts.intervalMs)
  }
}
