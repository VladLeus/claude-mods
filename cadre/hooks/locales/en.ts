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

  'init.duration.durationQuestion': 'Autopilot duration for roles?',
  'init.duration.durationContextLine': 'Applies to every role: {ids}.',
  'init.duration.durationDismissedReason': 'The autopilot duration question was dismissed or not answered.',
  'init.duration.durationAccepts': 'a duration such as 4h, 90m or 1h30m, at most 168h',

  'init.model.teamContextLine': 'Roles: {ids}.',
  'init.model.modelModeQuestion': 'Model and effort: same for all roles, or per role?',
  'init.model.modelAllQuestion': 'Model and effort for all roles?',
  'init.model.modelEffortContext': 'Models: {modelAliases}; efforts: {efforts}.',
  'init.model.modelRoleQuestion': 'Model and effort for {title} ({id})?',
  'init.model.modelDismissedReason': 'A model and effort question was dismissed or not answered.',

  'init.assign.mcpContextLine': '{teamContext} A role not given the server cannot use it.',

  'init.ownSkills.assignmentDismissedReason':
    'A question on which roles get an MCP server or skills was dismissed or not answered.',
  'init.ownSkills.skillsContextLine':
    'A role given these skills can run them in its session; a role not given them cannot.',
  'init.ownSkills.oneByOne': 'Go one by one',
  'init.ownSkills.wholeGroup': 'Whole group',
  'init.ownSkills.ownSkillsQuestion': 'How do you want to hand out your own skills ({count})?',
  'init.ownSkills.ownSkillQuestion': 'Which roles get the skill {name}?',
  'init.ownSkills.used': ' Used {skillUses}.',
  'init.ownSkills.contextLine': '{purpose}{used} Recommended: {recommended}.',
  'init.ownSkills.chip': 'Skill',
  'init.ownSkills.noPlugin.one':
    '{count} skill with no plugin; the pane shows what each does and the roles it is recommended for.',
  'init.ownSkills.noPlugin.other':
    '{count} skills with no plugin; the pane shows what each does and the roles it is recommended for.',

  'init.memory.roleListAccepts': '{quotedLabels}, or role ids from: {ids}',
  'init.memory.memoryDismissedReason':
    'A question on which roles get instructions or memories was dismissed or not answered.',
  'init.memory.memoryContextLine': '{teamContext} Their content is never shown or committed.',

  'init.instructions.contentQuestion':
    'Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each ' +
    'role? Nothing from your global files or memories is committed, and originals are never edited.',
  'init.instructions.consentNo': 'No, skip it',
  'init.instructions.consentYes': 'Yes, read them',
  'init.instructions.contentDismissedReason': 'The instruction files question was dismissed or not answered.',
  'init.instructions.noText': 'No keeps the whole-file questions.',
  'init.instructions.instructionsEntryQuestion': 'How do you want to hand out the instruction parts and memories?',
  'init.instructions.partByPart': 'Go part by part',
  'init.instructions.wholeFiles': 'Whole files',
  'init.instructions.handoutDismissedReason':
    'A question on which roles get instruction parts was dismissed or not answered.',
  'init.instructions.topicQuestion': 'Which roles get "{title}"?',
  'init.instructions.topicContextLine': '{asSentence} Recommended: {recommended}. From: {sources}.',
  'init.instructions.topicChip': 'Topic',
  'init.instructions.memoryItemQuestion': 'Which roles get the memory "{file}"?',
  'init.instructions.memoryItemContextLine': '{asSentence} Recommended: {recommended}.',
  'init.instructions.memoryChip': 'Memory',
  'init.instructions.claudeMdFiles.one': '{count} CLAUDE.md file',
  'init.instructions.claudeMdFiles.other': '{count} CLAUDE.md files',
  'init.instructions.ruleFiles.one': '{count} rule file',
  'init.instructions.ruleFiles.other': '{count} rule files',
  'init.instructions.memories.one': '{count} memory',
  'init.instructions.memories.other': '{count} memories',
  'init.instructions.found': 'global CLAUDE.md {global}, {chain} in the repo chain, {rules}, AGENTS.md {agents}',
  'init.instructions.contentContext': 'Found: {found}, {memories}. {noText}',
  'init.instructions.files.one': '{count} file',
  'init.instructions.files.other': '{count} files',
  'init.instructions.topics.one': '{count} topic',
  'init.instructions.topics.other': '{count} topics',
  'init.instructions.topicsFrom': '{topicCount} from {files}',
  'init.instructions.entryContext':
    '{topics} and {memoryCount}; the pane shows each with the roles it is recommended for.',

  'init.carry.envAccepts': '{quotedLabels}, or names from the list, typed exactly',
  'init.carry.envContextLine': '{teamContext} Every role carries the same names; values are filled in at launch.',
  'init.carry.envDismissedReason': 'The env variables question was dismissed or not answered.',

  'init.hunks.acceptOption': 'Accept',
  'init.hunks.declineOption': 'Decline',
  'init.hunks.requiredNote': 'Required for unattended GSD roles.',
  'init.hunks.optionalNote': 'Optional.',
  'init.hunks.keyLine': '{file}: {key}',
  'init.hunks.before': '  before: {before}',
  'init.hunks.after': '  after:  {target}',
  'init.hunks.why': 'Why: {why}',
  'init.hunks.chip': 'Hunk {index} of {total}',
  'init.hunks.hunkDismissedReason': 'A hunk question was dismissed or not answered.',

  'init.launch.launchStartQuestion': 'Where should the role launchers start their sessions? (asked once for this repo)',
  'init.launch.launchContextLine': 'The launcher of each role ({ids}) starts its session there.',
  'init.launch.startGitRoot': 'Git root of this repo',
  'init.launch.startHere': 'The folder I run it from',
  'init.launch.startOther': 'Another folder in this repo',
  'init.launch.launchDirQuestion':
    'Type the folder the launchers start in under Other, relative to the repo root (for example apps/web).',
  'init.launch.launchDirContext': 'It must be a folder inside this repo; a link that leads out is refused.',
  'init.launch.dirCancel': 'Cancel init',
  'init.launch.launchStartDismissedReason': 'The launcher start question was dismissed or not answered.',
  'init.launch.launchDirCancelledReason': 'The launcher folder question was dismissed or cancelled.',
  'init.launch.launchDirRoundsReason': 'No usable launcher folder after {maxAsks} tries: nothing was chosen.',
  'init.launch.unsafeLaunchDir':
    'use a folder inside this repo: letters, digits, . _ @ - and /, with no .. and no leading /',
  'init.launch.notALaunchDir': 'it is not a folder in this repo',
  'init.launch.lineGitRoot': 'Launchers start in: the git root',
  'init.launch.lineHere': 'Launchers start in: the folder they are run from',
  'init.launch.lineDir': 'Launchers start in: {path}/ under the git root',
  'init.launch.launchStartAccepts': '{quotedLabels} (or type git root, in here or other)',
  'init.launch.dirRefused': 'Cannot use {answer}: {problem}.',

  'init.review.reviewQuestion':
    'Review the plan shown in the cadre init pane. Confirm it, or go back to change one item.',
  'init.review.reviewTypeHint': 'Use a button, or type duration, model, assignments, memory, env or hunks under Other.',
  'init.review.reviewContextLine': '{planSummary}; {policy}; {launch}',
  'init.review.confirm': 'Confirm',
  'init.review.changeSomething': 'Change something…',
  'init.review.nextPage': 'Next page',
  'init.review.previousPage': 'Previous page',
  'init.review.itemWords': 'roles, git policy, launcher start, or duration, model, assignments, memory, env, hunks',
  'init.review.changeRefusal':
    'Name the item to change in a note (press n): roles, git policy, launcher start, duration, model, ' +
    'assignments, memory, env or hunks.',
  'init.review.reviewDismissedReason': 'The review question was dismissed or not answered.',
  'init.review.reviewRoundsReason':
    'The review question was asked {maxReviewRounds} times without "Confirm": nothing was chosen.',
  'init.review.linkedMemoriesRow':
    '    memories are linked read-only (best effort: Edit and Write are denied; a Bash write is not blocked)',
  'init.review.privateFilesRow':
    `    private files: {memoryPattern}{id}/instructions/CLAUDE.md and instructions.json (outside the ${
    ''}repo, never committed)`,
  'init.review.privateFilesHeading': 'Private files per role (written after Confirm):',
  'init.review.reviewLines': 'Plugins to install after Confirm (a --dry-run installs nothing): {keys}',
  'init.review.rolesHeading': 'Roles:',
  'init.review.roleRow': '  {title} ({id})',
  'init.review.title': 'Review',
  'init.review.pagedTitle': 'Review (page {number} of {count})',
  'init.review.improverRun.one':
    `After Confirm, claude-md-improver runs on up to {count} built file ${
    ''}(claude -p, acceptEdits, up to 5 minutes each); you accept or keep each change.`,
  'init.review.improverRun.other':
    `After Confirm, claude-md-improver runs on up to {count} built files ${
    ''}(claude -p, acceptEdits, up to 5 minutes each); you accept or keep each change.`,

  'init.reply.dryRunHead': 'cadre init --dry-run',
  'init.reply.head': 'cadre init',
  'init.conflict.dismissed': 'A Keep mine or Take new question was dismissed or not answered.',
  'init.conflict.context': 'Keep mine leaves your edited file as it is; Take new writes the new version over it.',
}) satisfies Record<string, string>

/** The key of an EN text (D-216). */
export type EnKey = keyof typeof EN
