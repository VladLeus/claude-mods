/**
 * The contract every UI surface module implements (D-353), a layer 8 module of types only: what one surface decides for
 * a /cadre run, the seat strategies a pane module looks up by where the terminal seated its pane (D-354), and the host
 * effects register executes for a module, in order. Each surface has its own module under ui/surfaces/, which
 * implements SurfaceModule; select.ts is the one place that maps the detected surface to its module.
 */
import type { AskContext, InitIo, OpenQuestion } from '../../../types'
import type { ListWords } from '../../core/text'
import type { DialogPlan } from '../preview'

/** The surface a module implements (D-353), for names, logs and specs only: no file compares it. */
export type SurfaceId = 'tui-default' | 'pane-fullscreen' | 'pane-desktop' | 'none'

/**
 * Where the terminal seated the cadre-init pane at its last render (panePlacement, D3, D-353): docked, inline, or null
 * before any render and when the render props carry no placement.
 */
export type PaneSeat = 'dock' | 'inline' | null

/**
 * What a paged port reads at each ask (D-306, N-02, D-353): the columns a page is drawn at now, and where the pane is
 * seated now.
 */
export type PageView = {
  readonly columns: () => number | null
  readonly seat: () => PaneSeat
}

/**
 * How a pane module treats one seat of its pane (D-353, D-354): whether the dialog previews the open question's whole
 * context there, so no question is paged (N-02), the dialog plan it gives the open question's call there, and the
 * columns a page is drawn at there, the dialog's preview columns or the pane body's (D-292).
 */
export type SeatStrategy = {
  readonly previews: boolean
  readonly plan: (raw: unknown, open: OpenQuestion, columns: number | null, changeLabel: string) => DialogPlan | null
  readonly pageColumns: (preview: number | null, body: number | null) => number | null
}

/**
 * The seat strategy a pane module uses at each seat (D-353, D-354), a pane with no placement as `unplaced`: a pane
 * module looks its strategy up here and never branches on the seat.
 */
export type SeatTable = {
  readonly dock: SeatStrategy
  readonly inline: SeatStrategy
  readonly unplaced: SeatStrategy
}

/** The rows a Review page fills on a surface and the most code points it holds (D-233, ASKED #19, N-04, D-353). */
export type ReviewPaging = {
  readonly rows: number
  readonly maxChars: number
}

/**
 * One host call a surface module asks register to make (D-353); register executes a module's effects in order:
 * - `status`: sets the status line to `text`, or clears it when null; a text marks that the run set one (D-232, D-257).
 * - `transcript`: logs `text` as one transcript line (D-228, D-262).
 * - `printed`: records `context` as the context the run printed last above a dialog (WD-S4).
 * - `loader`: writes the pane's loader: a null `label` clears it, else the label and `summary` (D-301, D-327).
 * - `loader-summary`: writes `text` as the summary line of the loader shown now (D-325).
 * - `scroll-start`: scrolls the pane the run opened back to its start for the open question (D-209, D-271).
 * - `open-pane`: opens the cadre-init pane as an init or regen run starts (D-324).
 */
export type SurfaceEffect =
  | { readonly kind: 'status'; readonly text: string | null }
  | { readonly kind: 'transcript'; readonly text: string }
  | { readonly kind: 'printed'; readonly context: AskContext }
  | { readonly kind: 'loader'; readonly label: string | null; readonly summary: string | null }
  | { readonly kind: 'loader-summary'; readonly text: string }
  | { readonly kind: 'scroll-start' }
  | { readonly kind: 'open-pane' }

/**
 * The rules of one UI surface for a /cadre run (D-353): register selects the module once per command
 * (surfaceModuleOf), the init state carries it to the runners and the stages, and every caller uses the module it is
 * handed, so a rule of one surface never changes another.
 */
export type SurfaceModule = {
  readonly id: SurfaceId
  /** The words the run's lists are shown with (D-256). */
  readonly listWords: ListWords
  /** The text a dialog asks for `question` with its own `context` (D-255, D-310). */
  readonly askedText: (question: string, context: AskContext | null) => string
  /** The folds a question is asked with of those `bound` to its stage (D-302). */
  readonly foldsOf: <T>(bound: readonly T[]) => readonly T[]
  /** The port a run asks through, paging a context over the frame cap where the surface pages (D-306, N-02). */
  readonly pagedPort: (io: InitIo, view: PageView) => InitIo
  /** The rows and the code points of a Review page (D-233, N-04). */
  readonly reviewPaging: ReviewPaging
  /** The columns a page is drawn at, from the pane's seat, the preview's columns and the body's (D-292, U-15). */
  readonly pageColumns: (seat: PaneSeat, preview: number | null, body: number | null) => number | null
  /** The dialog of the open question's AskUserQuestion call, or null to pass it untouched (WD-S2, D-239). */
  readonly dialogPlan: (
    raw: unknown,
    open: OpenQuestion,
    seat: PaneSeat,
    columns: number | null,
    changeLabel: string,
  ) => DialogPlan | null
  /** What an init or regen run does on this surface as it starts (D-324). */
  readonly runStartEffects: () => readonly SurfaceEffect[]
  /** What a dialog of the open question does as it opens, given the context printed last (D-209, D-228, D-232). */
  readonly dialogOpenEffects: (
    context: AskContext | null,
    printed: AskContext | null,
    columns: number | null,
  ) => readonly SurfaceEffect[]
  /** What a long step's progress shows: its label and summary, or none when `text` is null (D-232, D-301). */
  readonly progressEffects: (text: string | null, summary: string | null) => readonly SurfaceEffect[]
  /** What a logged line does, given whether a long step runs now (D-325). */
  readonly logEffects: (text: string, isLoading: boolean) => readonly SurfaceEffect[]
}
