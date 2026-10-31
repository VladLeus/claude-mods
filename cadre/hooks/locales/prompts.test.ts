import { describe, expect, test } from 'claude-code/testing'

import {
  PROMPTS,
  proposeSystemText,
  RECOMMEND_SYSTEM,
  REGEN_RECOMMEND_SYSTEM,
  SKILLS_SYSTEM,
  topicsSystemText,
} from './prompts'

/** Printable ASCII and the newline only: no byte above 0x7E and no control character but the newline (T-02.1-84). */
function isPromptAscii(text: string): boolean {
  return /^[\x20-\x7E\n]*$/.test(text)
}

describe('locales/prompts (D-221)', () => {
  test('every PROMPTS text, the kickoff sentences among them, is printable ASCII', () => {
    const bad = Object.entries(PROMPTS).filter(([, text]) => !isPromptAscii(text))

    expect(bad).toEqual([])
  })

  test('every system prompt is printable ASCII', () => {
    const systems = [
      proposeSystemText(8),
      topicsSystemText(60, 160),
      SKILLS_SYSTEM,
      RECOMMEND_SYSTEM,
      REGEN_RECOMMEND_SYSTEM,
    ]

    expect(systems.filter(text => !isPromptAscii(text))).toEqual([])
  })

  test('the ASCII check refuses a byte above 0x7E and a control character', () => {
    expect(isPromptAscii('plain\nline')).toBe(true)
    expect(isPromptAscii('café')).toBe(false)
    expect(isPromptAscii('tab\there')).toBe(false)
  })

  test('the system prompt builders put the caps where the prompts named them', () => {
    expect(proposeSystemText(8)).toContain('Give at most 8 roles, and each id once.')
    expect(topicsSystemText(60, 160)).toContain('A title has at most 60 characters and a summary at most 160.')
  })
})
