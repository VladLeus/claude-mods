/**
 * The EN screen texts (D-207, D-216, D-221), a layer 0 leaf: every reply, question, option, warning and pane or preview
 * line cadre shows, keyed `<area>.<question or block>.<item>` and filled only through locales/t. A counted sentence
 * is a `.one` / `.other` pair (D-223); a slot is a `{name}` of letters. Text written into generated files, model
 * prompts and on-disk or protocol markers live in locales/artifact, locales/prompts and locales/contracts and are never
 * translated. Object.freeze keeps each text's literal type, so the slots of a template are typed (locales/t Slots); a
 * text too long for one line is a `+` chain of single-line literals and takes no slot.
 */

/** Every EN screen text by its key (D-207, D-216). */
export const EN = Object.freeze({
  'init.notInteractive':
    'cadre init needs an interactive session to ask its questions. ' +
    'Run /cadre init in a terminal session, not with claude -p.',

  'init.answers.skillUses.one': '{count} time in the last {sessions} sessions',
  'init.answers.skillUses.other': '{count} times in the last {sessions} sessions',

  'init.policy.question': 'Git policy for .cadre/?',
  'init.policy.option.definitions': 'Commit definitions (default)',
  'init.policy.option.all': 'Commit all',
  'init.policy.option.ignore': 'Ignore all of .cadre/',
  'init.policy.commits.definitions': 'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/.',
  'init.policy.commits.all': 'Commit all: only per-user files are ignored.',
  'init.policy.commits.ignore': 'Ignore all: nothing in .cadre/ is committed.',
  'init.policy.contextTitle': 'Git policy',
  'init.policy.dismissed': 'The git policy question was dismissed or not answered.',
  'init.policy.line.definitions': 'Git policy: commit definitions (.cadre/*/.runtime/ ignored)',
  'init.policy.line.all': 'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
  'init.policy.line.ignore': 'Git policy: ignore all of .cadre/',
}) satisfies Record<string, string>

/** The key of an EN text (D-216). */
export type EnKey = keyof typeof EN
