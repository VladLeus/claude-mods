import { describe, expect, test } from 'claude-code/testing'

import { NO_USABLE_ANSWER_REASON } from '../ui/ask'
import { cancelledReply } from './replies'

describe('cancel reply (S1)', () => {
  test('cancelledReply is INIT_CANCELLED, a colon and the reason cleaned as a report cell', () => {
    expect(cancelledReply(NO_USABLE_ANSWER_REASON)).toBe(
      'init cancelled, nothing written: No usable answer after 3 tries.',
    )
    expect(cancelledReply('a\nb')).toBe('init cancelled, nothing written: ab')
  })
})
