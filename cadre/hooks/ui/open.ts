/**
 * The terminal-host probe, a layer 8 module: whether the host is macOS, and the TMUX and TERM_PROGRAM it runs under,
 * read once through the host before a `--terminal` open (D-109, D-167). It imports the uname timeout of ui/terminal
 * and the types, so /cadre start and /cadre epic probe the host here.
 */
import type { HostIo } from '../../types'
import { UNAME_TIMEOUT_MS } from './terminal'

/**
 * The host a `--terminal` open plans for (D-109, D-132, D-167): macOS when `/usr/bin/uname -s` exits 0 with `Darwin`,
 * and TMUX and TERM_PROGRAM as the host reads them, null when unset. /cadre start and /cadre epic ask it once each.
 */
export async function terminalHostOf(
  host: HostIo,
): Promise<{ readonly isMacOs: boolean; readonly tmux: string | null; readonly termProgram: string | null }> {
  const uname = await host.run(['/usr/bin/uname', '-s'], { timeoutMs: UNAME_TIMEOUT_MS })
  const isMacOs = uname !== null && uname.exitCode === 0 && uname.stdout === 'Darwin\n'
  const tmux = await host.env('TMUX')
  const termProgram = await host.env('TERM_PROGRAM')

  return { isMacOs, tmux, termProgram }
}
