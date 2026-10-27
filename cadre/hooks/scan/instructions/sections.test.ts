import { describe, expect, test } from 'claude-code/testing'

import { BIDI_OVERRIDE } from '../../testkit'
import { splitSections } from './sections'

/** The global CLAUDE.md of the cases: a Security section and a Git section, as the plan's dry run has it. */
const GLOBAL_TEXT = '# Security\nNever commit secrets.\n## Git\nUse signed commits.\n'

describe('splitSections', () => {
  test("a line that starts with '# ' or '## ' starts a section, its heading the text after the hashes", () => {
    expect(splitSections(GLOBAL_TEXT)).toEqual([
      { heading: 'Security', text: '# Security\nNever commit secrets.\n' },
      { heading: 'Git', text: '## Git\nUse signed commits.\n' },
    ])
  })

  test("the text before the first heading is one section with heading '' when it is not blank", () => {
    expect(splitSections('Intro line.\n\n# A\nbody\n')).toEqual([
      { heading: '', text: 'Intro line.\n\n' },
      { heading: 'A', text: '# A\nbody\n' },
    ])
    expect(splitSections('\n   \n# A\nbody')).toEqual([{ heading: 'A', text: '# A\nbody' }])
    expect(splitSections('Only text, no heading.\n')).toEqual([{ heading: '', text: 'Only text, no heading.\n' }])
  })

  test('blank text gives no section', () => {
    expect(splitSections('')).toEqual([])
    expect(splitSections('\n \n\t\n')).toEqual([])
  })

  test("'### ' does not split, nor does a line that only starts with a hash", () => {
    expect(splitSections('# A\n### Sub\nx\n#hashtag\n#\ny\n')).toEqual([
      { heading: 'A', text: '# A\n### Sub\nx\n#hashtag\n#\ny\n' },
    ])
  })

  test("a '#' line inside a fenced block never splits, with backticks or tildes", () => {
    const backticks = '# A\n```sh\n# not a heading\n## nor this\n```\n## B\ny\n'
    expect(splitSections(backticks)).toEqual([
      { heading: 'A', text: '# A\n```sh\n# not a heading\n## nor this\n```\n' },
      { heading: 'B', text: '## B\ny\n' },
    ])
    const tildes = '# A\n~~~\n# still code\n~~~\n# B\n'
    expect(splitSections(tildes).map(section => section.heading)).toEqual(['A', 'B'])
  })

  test('a fence closes only on a fence of its own kind, at least as long', () => {
    const nested = '# A\n````md\n```\n# still code\n```\n````\n# B\nz\n'
    expect(splitSections(nested)).toEqual([
      { heading: 'A', text: '# A\n````md\n```\n# still code\n```\n````\n' },
      { heading: 'B', text: '# B\nz\n' },
    ])
    const mixed = '# A\n```\n~~~\n# still code\n```\n# B\n'
    expect(splitSections(mixed).map(section => section.heading)).toEqual(['A', 'B'])
  })

  test('a heading is trimmed, cleaned and cut to 80 code points', () => {
    expect(splitSections('#   Spaced title  \nx').map(section => section.heading)).toEqual(['Spaced title'])
    expect(splitSections(`# Tit${BIDI_OVERRIDE}le\r\nx`).map(section => section.heading)).toEqual(['Title'])
    expect(splitSections(`## ${'h'.repeat(100)}\nx`).map(section => section.heading)).toEqual([`${'h'.repeat(79)}…`])
  })

  test('the sections joined give the text back, line ends included', () => {
    const texts = [GLOBAL_TEXT, 'Intro\n# A\r\nx\r\n## B\ny', '# A\n```\n# x\n```\n## B\n']
    for (const text of texts) expect(splitSections(text).map(section => section.text).join('')).toBe(text)
  })
})
