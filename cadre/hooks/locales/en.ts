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

  'init.roles.rolesQuestion': 'Use these roles?',
  'init.roles.choiceUse': 'Use these roles',
  'init.roles.choiceAdjust': 'Adjust them',
  'init.roles.choiceDescribe': 'Describe my own structure',
  'init.roles.describeQuestion': 'Describe your role structure in your own words: type it under Other.',
  'init.roles.describeContext': 'For example: a PM, one full-stack developer, and a QA who also covers security.',
  'init.roles.describeTemplate': 'Use the template instead',
  'init.roles.describeCancel': 'Cancel init',
  'init.roles.describeAccepts': 'a description of your roles, {quotedLabels}',
  'init.roles.adjustQuestion':
    'Adjust the roles: type one change under Other, for example add docs "Docs writer", drop fe, rename ' +
    'be api "API", or framework qa gsd.',
  'init.roles.adjustDone': 'Done adjusting',
  'init.roles.adjustShow': 'Show the roles',
  'init.roles.adjustContextLine': 'Roles now: {ids}.',
  'init.roles.roleRoundsReason':
    'The roles question was asked {maxRoleRounds} times without "Use these roles": nothing was chosen.',
  'init.roles.adjustRoundsNote':
    'Adjust took {maxAdjustRounds} answers without "Done adjusting": showing the roles as they are now.',
  'init.roles.rolesDismissedReason': 'The roles question was dismissed or not answered.',
  'init.roles.adjustDismissedReason': 'The Adjust question was dismissed.',
  'init.roles.describeCancelledReason': 'The describe question was dismissed or cancelled.',
  'init.roles.unreadChange': 'Could not read that change: {trim}. Use add, drop, rename or framework.',
  'init.roles.notInstalledMessage':
    'Cannot set {id} to {framework}: it is not installed for this repo (installed: {names}). {id} keeps its framework.',
  'init.roles.proposedRole': '{title} ({id})',
  'init.roles.proposed': 'Proposed: {roles}.',
  'init.roles.proposedChanges.one': 'Proposed: {roles}; {count} change from the scan.',
  'init.roles.proposedChanges.other': 'Proposed: {roles}; {count} changes from the scan.',

  'init.frameworks.frameworkLabelsNone': 'none (built-in)',
  'init.frameworks.frameworkQuestionPrefix': 'Which framework do the roles use?',
  'init.frameworks.frameworkAllQuestion': 'Framework for all roles?',
  'init.frameworks.frameworkRoleQuestion': 'Framework for {title} ({id})?',
  'init.frameworks.reasonMany': 'more than one framework is in use',
  'init.frameworks.reasonInstalled': 'none is in use here, but some are installed for you',
  'init.frameworks.reasonUnsupported': 'only frameworks cadre does not support were found',
  'init.frameworks.reasonNone': 'no framework was found',
  'init.frameworks.frameworkDismissedReason': 'A framework question was dismissed or not answered.',
  'init.frameworks.modeAsk': '{frameworkQuestionPrefix} (asked because {frameworkReason})',
  'init.frameworks.frameworkAskAccepts': '{map} - a role runs one framework',

  'init.security.securityInstallPrefix': 'Install from claude-plugins-official after you confirm the plan:',
  'init.security.securityInstallContext':
    'Nothing is installed before you confirm the final review, and a --dry-run installs nothing.',
  'init.security.choiceInstall': 'Install',
  'init.security.choiceNotNow': 'Not now',
  'init.security.securityInstallDismissedReason': 'The security plugins question was dismissed or not answered.',
  'init.security.namesJoin': ' and ',
  'init.security.installQuestion': '{prefix} {names}? {notes}',

  'init.improverInstall.improverInstallQuestion':
    'Install claude-md-management from claude-plugins-official after you confirm the plan? Its ' +
    "claude-md-improver tidies each role's built CLAUDE.md, and you accept or keep each change.",
  'init.improverInstall.improverInstallContext':
    'Without it the built files stay as cadre wrote them; a --dry-run installs nothing.',
  'init.improverInstall.improverInstallDismissedReason':
    'The claude-md-management question was dismissed or not answered.',
}) satisfies Record<string, string>

/** The key of an EN text (D-216). */
export type EnKey = keyof typeof EN
