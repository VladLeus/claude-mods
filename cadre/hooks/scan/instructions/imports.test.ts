import { describe, expect, test } from 'claude-code/testing'

import { claudeMdImports } from './imports'

describe('claudeMdImports', () => {
  const imports = (text: string): string[] => claudeMdImports(text, '/home/u/.claude', '/home/u')

  test('it finds the files a CLAUDE.md imports, resolved against its folder and the home, sorted', () => {
    const text = 'See @~/notes/a.md and @./b.md\n`@./code.md`\n@../c.md\nmail me@x.org\n@d.md'

    expect(imports(text)).toEqual([
      '/home/u/.claude/b.md',
      '/home/u/.claude/d.md',
      '/home/u/c.md',
      '/home/u/notes/a.md',
    ])
  })

  test('an absolute path is kept, and a dot or dot-dot segment is resolved away', () => {
    expect(imports('@/etc/x/../y.md and @/opt/./z.txt')).toEqual(['/etc/y.md', '/opt/z.txt'])
  })

  test('a path given twice, in any spelling, is listed once', () => {
    expect(imports('@./b.md @b.md @./x/../b.md\n@~/../u/.claude/b.md')).toEqual(['/home/u/.claude/b.md'])
  })

  test('a .. segment cannot climb above the root of the file system', () => {
    expect(imports('@../../../../../x.md')).toEqual(['/x.md'])
  })

  test('a bare name needs .md, while a path that starts with ~/, ./, ../ or / needs no extension', () => {
    expect(imports('@README @notes.md @docs/x.md @./dir/file @~/f.txt @/abs/g')).toEqual([
      '/abs/g',
      '/home/u/.claude/dir/file',
      '/home/u/.claude/docs/x.md',
      '/home/u/.claude/notes.md',
      '/home/u/f.txt',
    ])
  })

  test('an import inside an inline code span, a double-backtick span or a fenced block is ignored', () => {
    const text = [
      'Use `@./a.md` to import.',
      '```markdown',
      '@./b.md',
      '```',
      'Also ``x @./c.md y`` here and @./d.md.',
    ].join('\n')

    expect(imports(text)).toEqual(['/home/u/.claude/d.md'])
  })

  test('a backtick that closes nothing is plain text and hides no import', () => {
    expect(imports('it`s here\n@./a.md')).toEqual(['/home/u/.claude/a.md'])
  })

  test('a fence of four backticks is not closed by a fence of three inside it', () => {
    expect(imports('````\n```\n@./a.md\n```\n````\n@./b.md')).toEqual(['/home/u/.claude/b.md'])
  })

  test('an e-mail address, and a word with an @ inside it, are not imports', () => {
    expect(imports('write to me@x.md or a@b.md, c.d@e.md')).toEqual([])
  })

  test('a mark right before the @, such as a parenthesis or a quote, makes it plain text', () => {
    expect(imports('(@./a.md) "@./b.md" see @./c.md')).toEqual(['/home/u/.claude/c.md'])
  })

  test('a sentence mark after the path is not part of it', () => {
    expect(imports('see @./b.md, then @./c.md. And @./d.md)')).toEqual([
      '/home/u/.claude/b.md',
      '/home/u/.claude/c.md',
      '/home/u/.claude/d.md',
    ])
  })

  test('a heading, a flag, a folder and a lone mark are not imports', () => {
    expect(imports('@#section @-flag @./dir/ @/ @. @.. @')).toEqual([])
  })

  test('a token after a tab or at the very start of the text counts', () => {
    expect(imports('@./a.md\n\t@./b.md')).toEqual(['/home/u/.claude/a.md', '/home/u/.claude/b.md'])
  })

  test('text with no import, and empty text, give nothing', () => {
    expect(imports('')).toEqual([])
    expect(imports('# Notes\n\nNothing is imported here.')).toEqual([])
  })

  test('no result holds a . or .. segment, whatever the spelling', () => {
    const found = imports('@./a/./b.md @../../../c.md @~/./d/../e.md @/f/../../g.md @h/./i.md')

    expect(found).toHaveLength(5)
    expect(found.filter(path => /(^|\/)\.{1,2}(\/|$)/.test(path))).toEqual([])
  })

  test('many backtick runs that close nothing are plain text and hide no import', () => {
    const runs = Array.from({ length: 300 }, (_, index) => '`'.repeat(index + 1)).join(' ')

    expect(imports(`${runs}\n@./a.md`)).toEqual(['/home/u/.claude/a.md'])
  })

  test('a long run of marks after an @ is read in linear time: no import, in under 2 s (M1)', () => {
    const started = Date.now()

    expect(claudeMdImports(`@${'.'.repeat(300_000)}x`, '/repo', '/home/u')).toEqual([])
    expect(Date.now() - started).toBeLessThanOrEqual(1_999)
  })

  test('a sentence mark after an import is still not part of it (M1)', () => {
    expect(claudeMdImports('see @./a.md.', '/repo', '/home/u')).toEqual(['/repo/a.md'])
  })

  test('an import token of 4,096 code points is an import, and one a code point longer is not (M1)', () => {
    const name = 'a'.repeat(4_091)

    expect(Array.from(`./${name}.md`)).toHaveLength(4_096)
    expect(claudeMdImports(`@./${name}.md`, '/repo', '/home/u')).toEqual([`/repo/${name}.md`])
    expect(claudeMdImports(`@./${name}a.md`, '/repo', '/home/u')).toEqual([])
  })
})
