import { describe, expect, test } from 'claude-code/testing'

describe('register with a faked host', () => {
  test('bare /cadre answers with help that lists both detect commands', async $ => {
    const out = await $.command.run({ command: 'cadre', args: '' })
    expect(out.text).toContain('/cadre detect --adapters')
  })

  test('an unknown subcommand is echoed on the first line of the reply', async $ => {
    const out = await $.command.run({ command: 'cadre', args: 'start be' })
    expect(out.text.startsWith('Unknown subcommand: start be')).toBe(true)
  })
})
