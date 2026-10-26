import { describe, expect, test } from 'claude-code/testing'

import { hasRunFailed } from './steps'

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
