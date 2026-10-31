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

  'init.replies.initCancelled': 'init cancelled, nothing written',
  'init.replies.cancelledReply': '{initCancelled}: {reason}',
  'init.replies.ignoreAllNote': "role definitions won't exist in new worktrees",

  'init.answers.noneOption': 'None',
  'init.answers.allOption': 'All roles',
  'init.answers.roleAnswerHint': '(e.g. BE, QA, or none)',
  'init.answers.mcpQuestion': 'Which roles get the {name} MCP server? {roleAnswerHint}',
  'init.answers.uses.one': ' (used {count} time in recent sessions)',
  'init.answers.uses.other': ' (used {count} times in recent sessions)',
  'init.answers.skillGroupQuestion': 'Which roles get {label} skills ({count})?{uses} {roleAnswerHint}',
  'init.answers.noSkillPurpose': 'No description.',
  'init.answers.ownSkillsHeading':
    'Skills with no plugin (a role given a skill can run it in its session; a role not given it cannot):',
  'init.answers.noSkillRecommendationRow':
    'The model gave no usable recommendation: no role gets a skill unless you pick one.',
  'init.answers.ownSkillUsed': 'used {skillUses}; ',
  'init.answers.ownSkillRow': '  {name}: {purpose}',
  'init.answers.ownSkillRecommended': '    {used}recommended: {ids}',
  'init.answers.sameForAll': 'Same for all roles',
  'init.answers.perRole': 'Per role',
  'init.answers.modelEffortRefusal':
    'Cannot use {typed}: type a model and an effort, such as opus + high. Models: {modelAliases}. Efforts: {efforts}.',
  'init.answers.allEnvOption': 'All of them',
  'init.answers.envQuestion':
    'Which env variables do roles carry? Names: {shown} (values are never stored; e.g. API_KEY, or none)',
  'init.answers.instructionLabelsGlobalClaudeMd': 'your global ~/.claude/CLAUDE.md and the files it imports',
  'init.answers.instructionLabelsAutoMemory': 'the auto-memories for this repo',
  'init.answers.instructionLabelsProjectClaudeMd': 'the project CLAUDE.md',
  'init.answers.memoryAnswerHint': '(e.g. PM, TL, or none)',
  'init.answers.shownNames': ' ({cappedNames})',
  'init.answers.memoryQuestion': 'Which roles get {instructionLabels}{shownNames}? {memoryAnswerHint}',

  'init.handout.acceptRecommendations': 'Accept recommendations',
  'init.handout.yesLabel': 'Yes',
  'init.handout.noLabel': 'No',
  'init.handout.itemAccepts': '{quotedLabels}, or role ids from: {map}',

  'init.history.noHistoryNote': 'No session history for this repo.',
  'init.history.unlistedHistoryNote': "Could not list this repo's session history, so it was not scanned.",
  'init.history.historyDismissedReason': 'The session history question was dismissed or not answered.',
  'init.history.historyHeading': 'Session history (names and counts only):',
  'init.history.newest': '; the newest {count} are read',
  'init.history.question.one':
    `Scan this repo's session history ({count} session{newest}) for frequently used commands and skills? ${
    ''}Only names and counts are kept.`,
  'init.history.question.other':
    `Scan this repo's session history ({count} sessions{newest}) for frequently used commands and skills? ${
    ''}Only names and counts are kept.`,
  'init.history.consentNo': 'No, skip it',
  'init.history.consentYes': 'Yes, scan names and counts',
  'init.history.skippedLarge.one':
    'skipped {skipped} of {count} session over {mib} MiB (the heaviest sessions are not counted)',
  'init.history.skippedLarge.other':
    'skipped {skipped} of {count} sessions over {mib} MiB (the heaviest sessions are not counted)',
  'init.history.partial.one':
    `partial: stopped at {mib} MiB in total, {unread} of {count} session not read ${
    ''}(the oldest sessions are not counted)`,
  'init.history.partial.other':
    `partial: stopped at {mib} MiB in total, {unread} of {count} sessions not read ${
    ''}(the oldest sessions are not counted)`,
  'init.history.skippedUnknown.one': 'skipped {skipped} of {count} session that could not be read',
  'init.history.skippedUnknown.other': 'skipped {skipped} of {count} sessions that could not be read',
  'init.history.noneRow': '  none',

  'init.consent.claudeJsonQuestion':
    'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.',
  'init.consent.claudeJsonContext':
    'Without it, init still finds MCP servers in .mcp.json, your plugins and this session.',
  'init.consent.consentNo': 'No, skip it',
  'init.consent.consentYes': 'Yes, read names only',
  'init.consent.consentDismissedReason': 'The ~/.claude.json question was dismissed or not answered.',
}) satisfies Record<string, string>

/** The key of an EN text (D-216). */
export type EnKey = keyof typeof EN
