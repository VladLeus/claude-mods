/**
 * What `/cadre` asked for: the help text, or the read-only detection. Every input other than empty,
 * `help`, or `detect [--adapters]` is help with the input echoed back as unknown.
 */
export type CadreCommand =
  | {
      kind: 'help'
      /** The input echoed back when it was not `help` or empty; null otherwise. */
      unknown: string | null
    }
  | {
      kind: 'detect'
      /** Whether `--adapters` was given: also show the contract each framework is driven with. */
      adapters: boolean
    }
