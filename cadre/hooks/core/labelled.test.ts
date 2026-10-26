import { describe, expect, test } from 'claude-code/testing'

import { labelled } from './labelled'
import type { Labelled } from './labelled'

/** Two consent answers, the declining one first, as the consent questions list them. */
const CONSENTS: readonly Labelled<boolean>[] = [
  { label: 'No, skip it', value: false },
  { label: 'Yes, read them', value: true },
]

describe('labelled (D-225)', () => {
  test('an answer that names a label exactly, in any case and trimmed, gives the value of that label', () => {
    expect(labelled(CONSENTS, 'Yes, read them')).toBe(true)
    expect(labelled(CONSENTS, '  no, SKIP it\n')).toBe(false)
  })

  test('an answer that names no label exactly is null, so the question is asked again', () => {
    expect(labelled(CONSENTS, 'yes')).toBeNull()
    expect(labelled(CONSENTS, 'Yes, read them all')).toBeNull()
    expect(labelled(CONSENTS, '')).toBeNull()
    expect(labelled([], 'Yes, read them')).toBeNull()
  })

  test('when two labels match the answer, the first one in the table wins', () => {
    const entries: readonly Labelled<string>[] = [
      { label: 'Keep', value: 'first' },
      { label: 'KEEP', value: 'second' },
    ]

    expect(labelled(entries, 'keep')).toBe('first')
  })
})
