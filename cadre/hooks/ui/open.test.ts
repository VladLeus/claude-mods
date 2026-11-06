import { describe, expect, test } from 'claude-code/testing'

import { hostWorld, memHost } from '../testkit'
import { terminalHostOf } from './open'

/** The argv that asks the host for its kernel name. */
const UNAME_ARGV = ['/usr/bin/uname', '-s']

describe('terminalHostOf', () => {
  test('a Darwin host is macOS, with TMUX and TERM_PROGRAM as the host reads them', async () => {
    const run = { exitCode: 0, stdout: 'Darwin\n', stderr: '' }
    const env = { TMUX: '/tmp/tmux-1/default,1,0', TERM_PROGRAM: 'iTerm.app' }
    const host = memHost(hostWorld({ runs: [{ argv: UNAME_ARGV, result: run }], env }))

    expect(await terminalHostOf(host.io)).toEqual({
      isMacOs: true,
      tmux: '/tmp/tmux-1/default,1,0',
      termProgram: 'iTerm.app',
    })
    expect(host.calls).toEqual([{ argv: UNAME_ARGV, options: { timeoutMs: 5_000 } }])
  })

  test('a uname that cannot run or exits non-zero is not macOS', async () => {
    for (const result of [null, { exitCode: 1, stdout: 'Darwin\n', stderr: '' }]) {
      const host = memHost(hostWorld({ runs: [{ argv: UNAME_ARGV, result }] }))

      expect(await terminalHostOf(host.io)).toEqual({ isMacOs: false, tmux: null, termProgram: null })
    }
  })
})
