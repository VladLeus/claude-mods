/**
 * The steps of a render as the host runs them, a layer 1 module: the kinds of step, the absolute argv of each with no
 * shell (the `/bin/chmod 700` of a private folder level included), the one way to run a step through the host, and
 * the one check of a host run that failed. It imports only the types, so /cadre start, init and epic use it with no
 * cycle, and init no longer imports start for it.
 */
import type { HostIo, HostRun } from '../../types'

/**
 * One step of a render, in the order /cadre start runs it; every path is absolute:
 * - `remove`: remove a link, the stamp of an earlier render, or the DONE.md an earlier run left (`/bin/rm -f`);
 * - `mkdir`: make a folder and the folders above it (`/bin/mkdir -p`);
 * - `chmod`: make a private folder level mode 700 (`/bin/chmod 700`, 02-GAPS-B3 S7);
 * - `link`: make `path` a symbolic link to `target` (`/bin/ln -sfn`);
 * - `write`: write the text to the path; the host writes it, so it has no argv.
 */
export type RenderStep =
  | { readonly kind: 'remove'; readonly path: string }
  | { readonly kind: 'mkdir'; readonly path: string }
  | { readonly kind: 'chmod'; readonly path: string }
  | { readonly kind: 'link'; readonly path: string; readonly target: string }
  | { readonly kind: 'write'; readonly path: string; readonly text: string }

/** The mode of every private folder level (02-GAPS-B2 N13): only the user may list, enter or change it. */
const PRIVATE_FOLDER_MODE = '700'

/** The argv that makes a folder private: `/bin/chmod 700` on its absolute path (02-GAPS-B2 N13). */
export function privateModeArgv(path: string): readonly string[] {
  return ['/bin/chmod', PRIVATE_FOLDER_MODE, path]
}

/**
 * The argv that runs a step, absolute and with no shell (RESEARCH 3.2): `/bin/rm -f --` for a removal, never `-r`;
 * `/bin/mkdir -p --` for a folder; `/bin/chmod 700` for a private folder level (privateModeArgv, 02-GAPS-B3 S7);
 * `/bin/ln -sfn <target> <path>` for a link. A write has none: the host writes it.
 */
export function renderArgv(step: RenderStep): readonly string[] | null {
  if (step.kind === 'remove') return ['/bin/rm', '-f', '--', step.path]
  if (step.kind === 'mkdir') return ['/bin/mkdir', '-p', '--', step.path]
  if (step.kind === 'chmod') return privateModeArgv(step.path)
  if (step.kind === 'link') return ['/bin/ln', '-sfn', step.target, step.path]

  return null
}

/** How long one removal, folder or link step of a render may run before it is given up. */
const RENDER_STEP_TIMEOUT_MS = 10_000

/**
 * Runs one step of a render through the host: a write through host.write; a removal, a folder, a chmod or a link
 * through host.run with its renderArgv, absolute and with no shell, done only when it exits 0. Apply makes the role
 * memory folders of the private files with it too, as a mkdir step (G-02-1f).
 */
export async function isStepDone(host: HostIo, step: RenderStep): Promise<boolean> {
  if (step.kind === 'write') return host.write(step.path, step.text)
  const argv = renderArgv(step)
  if (argv === null) return false
  const run = await host.run(argv, { timeoutMs: RENDER_STEP_TIMEOUT_MS })

  return run !== null && run.exitCode === 0
}

/**
 * Whether a host run failed: the host rejected it (null) or it exited non-zero. A site that reads the run after the
 * check keeps the inline check, which narrows the run for TypeScript; this boolean does not (ASKED #56).
 */
export function hasRunFailed(run: HostRun | null): boolean {
  return run === null || run.exitCode !== 0
}
