import { describe, expect, test } from 'claude-code/testing'

import type { HostRun } from '../../types'
import { excludesText, globalExcludesPath, includedEntries, untrackedEntries } from './excludes'

describe('mirroring the main checkout into the epic worktree (D-147, D-148)', () => {
  test('untrackedEntries reads both NUL-ended listings: each entry once, sorted, without its trailing /', () => {
    expect(untrackedEntries('node_modules/\0', '.cadre/\0node_modules/\0')).toEqual(['.cadre', 'node_modules'])
    expect(untrackedEntries('', '')).toEqual([])
  })

  test('excludesText keeps the global excludes, then one /<path> line per link, sorted, and the runtime line', () => {
    const tail = '# cadre links (cadre epic)\n/node_modules\n/.cadre/*/.runtime/\n'

    expect(excludesText('*.log\n', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('*.log', ['node_modules'])).toBe(`*.log\n${tail}`)
    expect(excludesText('', ['node_modules'])).toBe(tail)
    expect(excludesText('', ['thoughts', 'node_modules'])).toContain('\n/node_modules\n/thoughts\n')
  })

  test('excludesText escapes the special characters and trailing spaces of each link line (03.1-W2 S2)', () => {
    expect(excludesText('', ['app/[id]', 'a*b?', 'back\\slash', 'notes  '])).toBe(
      '# cadre links (cadre epic)\n/a\\*b\\?\n/app/\\[id]\n/back\\\\slash\n/notes\\ \\ \n/.cadre/*/.runtime/\n',
    )
  })
})

/** The user's global excludes file, as `git config --global --path core.excludesFile` names it in the specs. */
const GLOBAL_EXCLUDES = '/home/u/.gitignore_global'

describe("the user's global excludes and the reuse mirror (D-147, D-163, D-164)", () => {
  test('the global excludes file is core.excludesFile, else under XDG_CONFIG_HOME, else ~/.config/git/ignore', () => {
    const run = (exitCode: number, stdout: string): HostRun => ({ exitCode, stdout, stderr: '' })
    const unset = run(1, '')

    expect(globalExcludesPath(run(0, `${GLOBAL_EXCLUDES}\n`), unset, '/home/u')).toBe(GLOBAL_EXCLUDES)
    expect(globalExcludesPath(unset, run(0, '/x\n'), '/home/u')).toBe('/x/git/ignore')
    expect(globalExcludesPath(unset, unset, '/home/u')).toBe('/home/u/.config/git/ignore')
    expect(globalExcludesPath(unset, unset, null)).toBeNull()
    expect(globalExcludesPath(run(0, 'relative/ignore\n'), null, '/home/u')).toBe('/home/u/.config/git/ignore')
  })
})

describe('copying what .worktreeinclude names into the epic worktree', () => {
  test('includedEntries keeps a named entry git ignores too, or one below a folder git ignores', () => {
    expect(includedEntries('thoughts/\0', 'thoughts/\0node_modules/\0')).toEqual(['thoughts'])
    expect(includedEntries('thoughts/shared/\0', 'thoughts/\0')).toEqual(['thoughts/shared'])
  })

  test('includedEntries gives the ignored entries below a named folder broader than them', () => {
    expect(includedEntries('docs/\0', 'dist/\0docs/a.md\0docs/b.md\0')).toEqual(['docs/a.md', 'docs/b.md'])
  })

  test('includedEntries drops what git does not ignore and empty names, and gives each name once, sorted', () => {
    expect(includedEntries('notes/\0thoughts2/\0', 'thoughts/\0')).toEqual([])
    expect(includedEntries('b/\0\0a/\0a/\0', 'a/\0b/\0')).toEqual(['a', 'b'])
  })
})
