import { describe, expect, test } from 'claude-code/testing'

import { hasRunFailed, renderArgv } from './steps'

describe('renderArgv', () => {
  test('a copy runs /bin/cp -p -- with the source, then the path', () => {
    const source = '/u/.claude/cadre/repo-1/be/instructions/CLAUDE.md'
    const path = '/repo/.cadre/be/.runtime/private-instructions/CLAUDE.md'

    expect(renderArgv({ kind: 'copy', source, path })).toEqual(['/bin/cp', '-p', '--', source, path])
  })
})

describe('hasRunFailed', () => {
  test('a run the host rejected failed', () => {
    expect(hasRunFailed(null)).toBe(true)
  })

  test('a run that exited non-zero failed, and one that exited 0 did not', () => {
    expect(hasRunFailed({ exitCode: 1, stdout: '', stderr: 'fatal' })).toBe(true)
    expect(hasRunFailed({ exitCode: 128, stdout: '', stderr: '' })).toBe(true)
    expect(hasRunFailed({ exitCode: 0, stdout: 'ok', stderr: '' })).toBe(false)
  })
})
