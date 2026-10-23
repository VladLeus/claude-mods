/**
 * The shapes of the golden fixtures of `/cadre init` (D-219): what a run asked, logged, showed in the side pane,
 * prompted and replied, what an applied run wrote and ran, and the bytes of the generated files. Each fixture is a TS
 * literal captured from the code by a scratch run and compared with toEqual, so any byte change in init output fails
 * the suite; a fixture changes only in an approved behaviour-change commit whose golden diff the user saw. Test support
 * only: the golden modules import it, no production module does.
 */

/** One ask as a run made it: the question text and the dialog spec it was asked with. */
export type GoldenAsk = {
  /** The question split on '\n', so each line stays short. */
  readonly question: readonly string[]
  /** The spec's header chip; null when the spec has none. */
  readonly header: string | null
  readonly options: readonly string[]
  /** True only when the spec asks for a multi-select. */
  readonly multiSelect: boolean
}

/** One side-pane block as a run showed it: its key, the title drawn above it and its rows. */
export type GoldenBlock = {
  readonly key: string
  readonly title: string
  readonly lines: readonly string[]
}

/** One init run: what it asked, logged, showed in the side pane, prompted and replied, each in order. */
export type GoldenRun = {
  readonly asks: readonly GoldenAsk[]
  readonly logged: readonly string[]
  readonly shown: readonly GoldenBlock[]
  /** The sha256 of each model prompt (each MemRun.prompts entry), in order. */
  readonly promptHashes: readonly string[]
  /** The reply split on '\n'. */
  readonly reply: readonly string[]
}

/** One write an applied run asked the host for: its path, the sha256 of its text, and whether the host wrote it. */
export type GoldenWrite = {
  readonly path: string
  readonly sha256: string
  readonly isWritten: boolean
}

/** One applied init run: the run itself, and every write, host run and the manifest it gave. */
export type GoldenApply = {
  readonly run: GoldenRun
  readonly writes: readonly GoldenWrite[]
  /** Each host run in call order: its argv joined by one space, then ` @ ` and its cwd, or `-` when it has none. */
  readonly calls: readonly string[]
  /** The text of the manifest write split on '\n'; empty when the run wrote no manifest. */
  readonly manifest: readonly string[]
}
