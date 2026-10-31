/**
 * The EN screen texts (D-207, D-216, D-221), a layer 0 leaf: every reply, question, option, warning and pane or preview
 * line cadre shows, keyed `<area>.<question or block>.<item>` and filled only through locales/t. A counted sentence
 * is a `.one` / `.other` pair (D-223); a slot is a `{name}` of letters. Text written into generated files, model
 * prompts and on-disk or protocol markers live in locales/artifact, locales/prompts and locales/contracts and are never
 * translated. Object.freeze keeps each text's literal type, so the slots of a template are typed (locales/t Slots); a
 * text too long for one line breaks inside an empty `${''}`, so it keeps its literal type and its typed slots.
 */

/** Every EN screen text by its key (D-207, D-216). */
export const EN = Object.freeze({
  'init.notInteractive':
    `cadre init needs an interactive session to ask its questions. ${
    ''}Run /cadre init in a terminal session, not with claude -p.`,

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
    `Adjust the roles: type one change under Other, for example add docs "Docs writer", drop fe, rename ${
    ''}be api "API", or framework qa gsd.`,
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
    `Install claude-md-management from claude-plugins-official after you confirm the plan? Its ${
    ''}claude-md-improver tidies each role's built CLAUDE.md, and you accept or keep each change.`,
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
    `Read your CLAUDE.md files, rules and memories, and let the model group them into parts for each ${
    ''}role? Nothing from your global files or memories is committed, and originals are never edited.`,
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
    `Name the item to change in a note (press n): roles, git policy, launcher start, duration, model, ${
    ''}assignments, memory, env or hunks.`,
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

  'init.status.scan': 'cadre: scanning the repo…',
  'init.status.history': 'cadre: reading session history…',
  'init.status.describeRoles': 'cadre: reading your structure…',
  'init.status.skills': 'cadre: recommending skills…',
  'init.status.topics': 'cadre: grouping instructions…',
  'init.status.parts': 'cadre: recommending instruction parts…',
  'init.status.regen': 'cadre: checking changed parts…',

  'init.assignRules.ownSkillsLabel': 'your own',

  'ui.ask.noUsableAnswer': 'No usable answer after {maxAsks} tries.',
  'ui.ask.countedChip': '{word} {position}/{count}',
  'ui.ask.refusalEmpty': "An empty answer isn't one of: {accepts}.",
  'ui.ask.refusalTyped': "'{typed}' isn't one of: {accepts}.",
  'ui.paneTitle.scan': 'Scan',
  'ui.paneTitle.history': 'Session history',
  'ui.paneTitle.roles': 'Roles',
  'ui.paneTitle.recommendations': 'Recommendations',
  'ui.paneTitle.review': 'Review',
  'ui.paneTitle.env': 'Env variables',
  'ui.paneTitle.notes': 'Notes',
  'ui.paneTitle.instructions': 'Instruction parts',
  'ui.paneTitle.skills': 'Your own skills',
  'ui.paneTitle.improver': 'Improver changes',

  'ui.chip.claudeJson': 'claude.json',
  'ui.chip.history': 'History',
  'ui.chip.roles': 'Roles',
  'ui.chip.adjust': 'Adjust',
  'ui.chip.describe': 'Describe',
  'ui.chip.framework': 'Framework',
  'ui.chip.security': 'Security',
  'ui.chip.duration': 'Duration',
  'ui.chip.model': 'Model',
  'ui.chip.mcp': 'MCP',
  'ui.chip.skills': 'Skills',
  'ui.chip.memory': 'Memory',
  'ui.chip.instructions': 'Instructions',
  'ui.chip.env': 'Env',
  'ui.chip.launch': 'Launch',
  'ui.chip.launchDir': 'Launch dir',
  'ui.chip.gitPolicy': 'Git policy',
  'ui.chip.review': 'Review',
  'ui.chip.conflict': 'Conflict',
  'ui.chip.improver': 'Improver',

  'ui.preview.moreAbove': '+{value} more above',
  'ui.preview.describeOwnLabel': 'Describe your own',
  'ui.preview.describeOwnDescription': 'Press n, type your answer, then Enter',
  'ui.preview.ownAnswerHint': 'Or press n, type your own answer, then Enter.',
  'ui.preview.otherWording': 'under Other',
  'ui.preview.noteWording': 'as a note (press n)',

  'ui.scan.safetyCap': 'the scan stopped at the {toLocaleString}-entry safety cap',
  'ui.scan.stoppedEarly': 'the scan stopped early; stack, tests and E2E may be incomplete',
  'ui.scan.mayBeIncomplete': 'may be incomplete: {facts}',
  'ui.scan.allFound': 'stack, tests and E2E were all found',
  'ui.scan.partialFolders': '  partial: {listed}; {partialFacts}',
  'ui.scan.partialCap': '  partial: {safetyCapText}; {partialFacts}',
  'ui.scan.cadreSummary': '{dir} (manifest {manifestState})',
  'ui.scan.pluginSummary': '{count} ({map})',
  'ui.scan.stack': 'stack: {languages}',
  'ui.scan.sides': 'frontend: {findingLabels}; backend: {findingLabelsB}',
  'ui.scan.repoHeading': 'Repo scan (read-only):',
  'ui.scan.stackSides': '  {stack}; {sides}',
  'ui.scan.tests': '  tests: {findingLabels}; E2E: {findingLabelsB}',
  'ui.scan.existingCadre': '  existing .cadre/: {cadreSummary}',
  'ui.scan.setupHeading': 'User setup (names only):',
  'ui.scan.plugins': '  plugins: {pluginSummary}',
  'ui.scan.setupCounts': '  skills: {count}; agents: {countB}; MCP servers: {mcp}',
  'ui.scan.setupFiles': '  global ~/.claude/CLAUDE.md: {globalMd}; memories: {count}; CLAUDE.md files: {map}',
  'ui.scan.contextSides': 'frontend {findingLabels}; backend {findingLabelsB}',
  'ui.scan.contextChecks': 'tests {findingLabels}; E2E {findingLabelsB}',
  'ui.scan.context': 'Scan: stack {languages}; {sides}; {checks}.',
  'ui.scan.warning': 'warning: {warning}',
  'ui.scan.folderCap.one': '{count} deeper folder listed only in part (the first {max} entries each)',
  'ui.scan.folderCap.other': '{count} deeper folders listed only in part (the first {max} entries each)',
  'ui.scan.yes': 'yes',
  'ui.scan.no': 'no',
  'ui.scan.none': 'none',

  'ui.recommendations.recommendationsHeading': 'Recommendations (print-only; init asks before it installs any):',
  'ui.recommendations.noRecommendations': 'Recommendations: none',
  'ui.recommendations.allRoles': 'all roles',
  'ui.recommendations.recommendationLines': '- {tool} for {who}: {why}',
  'ui.recommendations.recommendationLines2': '    run: {install}',

  'ui.instructions.sourceText': '{file} > {value}',
  'ui.instructions.readHeading':
    'Read for this run; a plain init writes the repo parts you hand out to .cadre/<role>/CLAUDE.md after Confirm:',
  'ui.instructions.noRecommendationRow':
    'The model gave no usable recommendation: no role gets a part unless you pick one.',
  'ui.instructions.fileTopicsRow': 'The model could not group the parts: each file is one topic.',
  'ui.instructions.topicRows': '  {title}: {summary}',
  'ui.instructions.topicRows2': '    from: {source}',
  'ui.instructions.topicRows3': '    recommended: {ids}',
  'ui.instructions.memoriesHeading': 'Memories (each linked, never copied, when a role gets it):',
  'ui.instructions.memoryRows': '  {file}: {summary}',
  'ui.instructions.memoryRows2': '    recommended: {ids}',
  'ui.instructions.instructionLines': 'warning: {warning}',
  'ui.instructions.roleItemsLine': '  {id}: none',
  'ui.instructions.roleItemsLine2': '  {id}: {topicCount}; {memoryCount}',
  'ui.instructions.roleItemsLine3': '  {id}: {topicCount}: {titles}; {memoryCount}',
  'ui.instructions.instructionReviewLines': 'Instructions per role:',
  'ui.instructions.instructionReviewLines2': 'Kept with the root session only: {keptTopics}, {keptMemories}',

  'ui.assign.mcpServerContext': 'Tools: none listed',
  'ui.assign.mcpServerContext2': 'Tools: {count} ({tools})',
  'ui.assign.mcpServerContextTitle': 'MCP: {name}',
  'ui.assign.mcpServerContext3': 'Source: {mcpSource}',
  'ui.assign.mcpServerContext4': 'Recommended: {roleIds}',
  'ui.assign.skillLineText': ' Used {uses}.',
  'ui.assign.skillLineText2': '{name}: {purpose}{used} Recommended: {roleIds}.',
  'ui.assign.skillGroupContextTitle': 'Skills: {label}',
  'ui.assign.skillContext': 'Skill {position} of {count}',
  'ui.assign.ownSkillsContext': 'Your own skills',

  'ui.context.roleLines': '{title} ({id})',
  'ui.context.roleLines2': 'Proposed roles:',
  'ui.context.changeLine': ' ({evidence})',
  'ui.context.changeLine2': '  {change} {roleId}: {reason}{evidence}',
  'ui.context.proposalLines': '  none',
  'ui.context.proposalLines2': 'Changes from the scan:',
  'ui.context.envPaneHeading': 'Env variable names in your settings (values are never read):',
  'ui.context.securityPluginNotes':
    `claude-security gives the Security role a review skill (/claude-security), needs Python 3.9 or ${
    ''}newer and writes CLAUDE-SECURITY-<time>/ report folders into the repo.`,
  'ui.context.securityPluginNotes2': 'security-guidance adds hooks that warn about risky edits.',
  'ui.context.scanContext': 'Scan',
  'ui.context.rolesContext': 'Roles',
  'ui.context.detectionLine': ' ({evidence})',
  'ui.context.detectionLine2': '{name}: {statusLabel}{version}{evidence}',
  'ui.context.detectionContext': 'Frameworks',
  'ui.context.securityContext': '{key}: {note}',
  'ui.context.securityContext2': 'Security plugins',
  'ui.context.foundRows': '  none',
  'ui.context.instructionsContext': 'Files found by name (nothing is read before a yes):',
  'ui.context.instructionsContext2': 'Memories:',
  'ui.context.instructionsContext3': 'Instruction files',
  'ui.context.instructionPartsContextTitle': 'Instruction parts',
  'ui.context.topicContext': '{title}: {summary}',
  'ui.context.topicContext2': '  from: {source}',
  'ui.context.topicContext3': '  recommended: {roleIds}',
  'ui.context.topicContext4': 'Topic {position} of {count}',
  'ui.context.memoryContext': '{file}: {summary}',
  'ui.context.memoryContext2': '  recommended: {roleIds}',
  'ui.context.memoryContext3': 'Memory {position} of {count}',
  'ui.context.memoryGroupTitlesGlobalClaudeMd': 'Global CLAUDE.md',
  'ui.context.memoryGroupTitlesAutoMemory': 'Auto-memories',
  'ui.context.memoryGroupTitlesProjectClaudeMd': 'Project CLAUDE.md',
  'ui.context.globalGroupLine': '{globalClaudeMdText} and the files it imports',
  'ui.context.envContext': 'Env variables',
  'ui.context.improverInstallContext': '  {id}: {builtClaudeMdPath}',
  'ui.context.improverInstallContext2': 'Built CLAUDE.md files it would tidy:',
  'ui.context.improverInstallContext3': 'Improver install',
  'ui.context.launchContext': 'Git root: the top of this repo, the same for every launcher.',
  'ui.context.launchContext2': 'Run folder: wherever you run a launcher from.',
  'ui.context.launchContext3': 'Launchers: {map}',
  'ui.context.launchContext4': 'Launch',
  'ui.context.launchDirContext': 'No folder with code was found in this repo.',
  'ui.context.launchDirContext2': 'Folders with code in this repo:',
  'ui.context.launchDirContext3': 'Launch folder',
  'ui.context.reviewContext': 'Review',

  'ui.cards.statusLabelInUse': 'in use',
  'ui.cards.statusLabelNotFound': 'not found',

  'ui.terminal.copiedLine': 'Copied to the clipboard.',
  'ui.terminal.notCopiedLine': 'Could not copy it to the clipboard (pbcopy is macOS only): copy the line above.',
  'ui.terminal.terminalMacOnly': '--terminal works on macOS only: run the command above in a terminal yourself.',
  'ui.terminal.terminalInvalid': '--terminal takes terminal, iterm or tmux: run the command above yourself.',
  'ui.terminal.terminalUnknownText':
    `--terminal could not tell this terminal (TERM_PROGRAM={shown}): use --terminal=terminal, ${
    ''}--terminal=iterm or --terminal=tmux, or run the command above yourself.`,
  'ui.terminal.itermName': 'iTerm tab or window',
  'ui.terminal.tmuxName': 'tmux window',
  'ui.terminal.terminalName': 'Terminal window',

  'apply.conflict.keepMine': 'Keep mine',
  'apply.conflict.takeNew': 'Take new',
  'apply.conflict.question':
    '{shown} was changed outside cadre. Keep your version, or take the new one (yours is then overwritten)?',
  'apply.conflict.unreadLine': 'Your version could not be read, so no diff is shown.',
  'apply.conflict.contextTitle': 'Conflict: {path}',
  'apply.conflict.takeNewCounts.one': 'Take new: {count} line added, {removed} removed',
  'apply.conflict.takeNewCounts.other': 'Take new: {count} lines added, {removed} removed',

  'apply.improver.unguardedRunReason': 'its folder has a path a permission rule cannot hold',
  'apply.improver.accept': 'Accept',
  'apply.improver.keepOriginal': 'Keep original',
  'apply.improver.diffCounts.one': '{count} line added, {removed} removed',
  'apply.improver.diffCounts.other': '{count} lines added, {removed} removed',
  'apply.improver.improverQuestion': "Accept the improver's changes to {path}?",
  'apply.improver.improverContextLine': '{diffCounts}; the pane shows the diff.',
  'apply.improver.improverBlockLines': '{path}: {diffCounts}',
  'apply.improver.improverContext': 'Improver: {path}',
  'apply.improver.improverNoChangeNote': 'the improver made no change to {path}',
  'apply.improver.improverFailedNote': 'the improver did not run for {path} ({reason}): the file stays as built',
  'apply.improver.improverUnreadableNote': 'the improver left {path} unreadable: it is written back as built',
  'apply.improver.improverDismissedWarning': 'the improver question for {path} was dismissed: the file stays as built',
  'apply.improver.changedBeforeRunWarning': '{path} changed before its improver run: it is written back as built',
  'apply.improver.otherFilesLines': 'Other files changed by the improver in {folder}:',
  'apply.improver.improverFailure': 'it exited with {exitCode}',
  'apply.improver.improverFailure2': 'it timed out',
  'apply.improver.improverFailure3': 'it could not start',
  'apply.improver.improverLine': 'Improver: {changed} of {total} built files changed and accepted.',

  'apply.run.appliedNoneNote': 'Applied: nothing to write; every file is up to date.',
  'apply.run.nextStepNote': 'Next: run /cadre start <id> to launch a role.',
  'apply.run.manifestSkippedStart': '.cadre/manifest.json was not written because a file above was not written: run ',
  'apply.run.manifestSkippedNote': '{manifestSkippedStart}/cadre init again.',
  'apply.run.regenManifestSkippedNote': '{manifestSkippedStart}/cadre regen {id} again.',
  'apply.run.privateFoldersUnknownWarning':
    `the private files of {map} were not written: their role memory folders are unknown (no home folder, ${
    ''}or git rev-parse failed or gave no absolute path; git 2.31 or newer is needed)`,
  'apply.run.writePrivate': 'could not write {locations}',
  'apply.run.appliedLines': 'could not write {path}',
  'apply.run.appliedLines2': 'could not make {pathText} executable: run chmod 755 {pathText}',
  'apply.run.appliedLines3': 'warning: {warning}',

  'apply.installs.installFailureText': 'claude plugin install {shown}',
  'apply.installs.installFailureText2':
    ' (if the claude-plugins-official marketplace is missing, first run: {marketplaceAddArgv})',
  'apply.installs.installFailureText3': 'could not install {shown}: run it yourself: {install}{value}',
  'apply.installs.pythonProblem':
    'claude-security was not installed: it needs Python 3.9 or newer on PATH ({why}): install it, then run: ',
  'apply.installs.pythonProblem2': 'python3 was not found',
  'apply.installs.pythonProblem3': 'python3 --version says nothing',
  'apply.installs.pythonProblem4': 'python3 --version says {line}',
  'apply.installs.noHomeInstallText':
    'could not install {shown}: no home folder is known to run it from: run it yourself: claude plugin install {shown}',

  'apply.hunks.hunkFailureLine': 'the {file} change {key}',
  'apply.hunks.hunkFailureLine2': '{change} failed: run it yourself: {display}',
  'apply.improver.otherListed': '{named}, +{rest} more',
  'apply.improver.otherChanges.one':
    'the improver also changed {count} other file in {folder}: {listed}; review them (listed above)',
  'apply.improver.otherChanges.other':
    'the improver also changed {count} other files in {folder}: {listed}; review them (listed above)',
  'apply.improver.unchecked.one': '{count} file in {folder} was not checked',
  'apply.improver.unchecked.other': '{count} files in {folder} were not checked',
  'apply.run.applied.one': 'Applied: wrote {count} file ({executable} executable).',
  'apply.run.applied.other': 'Applied: wrote {count} files ({executable} executable).',
  'apply.installs.namesJoin': ' and ',
  'apply.installs.installed.one': 'Installed {names}: run /reload-plugins to load it in this session.',
  'apply.installs.installed.other': 'Installed {names}: run /reload-plugins to load them in this session.',

  'apply.safety.linkReason': 'it or a folder above it is a link, or not inside the repo',
  'apply.safety.folderReason': 'it is a folder',
  'apply.safety.statFailedReason': 'it or a folder above it could not be checked (a stat failed)',
  'apply.safety.writeProblem': 'refused to write {path}: ',
  'apply.safety.listedLinkReason': 'it or a folder above it is listed as a link',
  'apply.safety.listFailedReason': 'it or a folder above it could not be checked (a folder listing failed)',
  'apply.safety.listedLinkProblem': 'refused to write {path}: ',
  'apply.safety.chmodProblem': '{path} was not made executable: its write was refused or failed',
  'apply.safety.outsideReason': 'outside the repo and the role memory folders',
  'apply.safety.privateWriteProblem': 'refused to write {path}: ',

  'regen.review.yes': 'Yes',
  'regen.review.no': 'No',
  'regen.review.regenDismissedReason': 'A regen question on instruction parts was dismissed or not answered.',
  'regen.review.chip': 'Regen',
  'regen.review.regenPartQuestion': 'Should {id} get "{heading}" from {file}?',
  'regen.review.changeNew': 'New since init.',
  'regen.review.changeChanged': 'Changed since init.',
  'regen.review.regenPartContextLine': '{regenChangeTexts} Recommended: {value}.',
  'regen.review.regenMemoryQuestion': 'Should {id} get the memory "{file}"?',
  'regen.review.partDroppedLine': 'dropped from {id}: {file} > {heading} (gone from its file)',
  'regen.review.memoryDroppedLine': 'dropped from {id}: memory {file} (gone)',
  'regen.review.partSource': '{file} > {heading}',
  'regen.review.memorySource': 'memory {file}: {value}',
  'regen.review.recommended': 'Recommended: {value}',
  'regen.review.pagedChip': 'Regen {position} of {count}',
  'regen.review.notHandedOut.one':
    `1 new or changed instruction part or memory for {id} was not handed out: ${
    ''}run /cadre regen {id} in a session to answer it`,
  'regen.review.notHandedOut.other':
    `{count} new or changed instruction parts or memories for {id} were not handed out: ${
    ''}run /cadre regen {id} in a session to answer them`,

  'regen.plan.improverNotOfferedWarning':
    `the improver was not offered for {id}: claude -p cannot ask Accept or Keep original; run /cadre ${
    ''}regen {id} in a session to review the changes`,
  'regen.plan.dryRunHead': 'cadre regen {id} --dry-run',
  'regen.plan.head': 'cadre regen {id}',

  'regen.run.cancelled': 'regen cancelled, nothing written',
  'regen.run.cancelledReply': '{regenCancelled}: {reason}',

  'regen.sideRead.regenNoManifest':
    ".cadre/manifest.json is missing, so regen cannot keep the other roles' files: run /cadre init again.",
  'regen.sideRead.regenBadManifest':
    ".cadre/manifest.json is not valid, so regen cannot keep the other roles' files: run /cadre init again.",
  'regen.sideRead.dryRunPrivateWarning':
    `--dry-run did not compare the global parts and memories of {id}: finding their folder runs git; a ${
    ''}plain regen compares them`,
  'regen.sideRead.unusableRecordWarning':
    `could not use the hand-out record of {id} (instructions.json): its global parts and memories were ${
    ''}not compared; run /cadre init to hand them out again`,
  'regen.sideRead.regenTotalWarning':
    'regen stopped reading at {value} KiB for {id}: its instruction parts were not compared',

  'status.report.donePresent': 'DONE.md: present',
  'status.report.doneAbsent': 'DONE.md: not written yet',
  'status.report.sessionNone': 'session: none found for {sessionName}',
  'status.report.foundByName': 'its name {sessionName}',
  'status.report.foundByBeat': 'its fleet beat',
  'status.report.session': 'session: {sessionId} (found by {how})',
  'status.report.head': 'cadre status {id}',
  'status.report.state': 'state: {state}',
  'status.report.autopilot': 'autopilot: {value}',

  'status.autopilotFiles.noLogLine': 'no log line',
  'status.report.stateDone': 'done',
  'status.report.stateRunning': 'running',
  'status.report.stateNotStarted': 'not started',
  'status.report.stateStopped': 'stopped',
  'status.report.stateUnknown': 'unknown',
  'status.report.latestHandoff': 'latest handoff: {handoff}',
  'status.report.noHandoff': 'none yet',

  'command.usage.usageRows': '/cadre detect',
  'command.usage.usageRows2': 'show which dev framework this repo uses, with evidence (read-only)',
  'command.usage.usageRows3': '/cadre detect --adapters',
  'command.usage.usageRows4': 'also show the contract cadre would drive each framework with',
  'command.usage.usageRows5': '/cadre init',
  'command.usage.usageRows6': 'guided setup: scan, propose roles, review the file plan, then write it',
  'command.usage.usageRows7': '/cadre init --dry-run',
  'command.usage.usageRows8': 'the same guided flow; prints the plan and writes nothing',
  'command.usage.usageRows9': '/cadre regen <id>',
  'command.usage.usageRows10': 're-render one role from its role.json and write its files',
  'command.usage.usageRows11': '/cadre regen <id> --dry-run',
  'command.usage.usageRows12': "print that role's plan and write nothing",
  'command.usage.usageRows13': '/cadre start <id>',
  'command.usage.usageRows14': "render a role's runtime files, then print and copy its launcher command",
  'command.usage.usageRowsCommand': '/cadre start <id> --terminal',
  'command.usage.usageRowsText': 'also open it in a new Terminal window, iTerm tab or tmux window (macOS)',
  'command.usage.usageRowsCommand2': '/cadre status <id>',
  'command.usage.usageRowsText2':
    "show from disk whether a role's autopilot run is done, running, stopped, not started or unknown",
  'command.usage.usageRows15': '/cadre epic <KEY> [title]',
  'command.usage.usageRows16': "create or reuse the epic's worktree and open its roles there",
  'command.usage.usageRows17': '/cadre epic done <KEY>',
  'command.usage.usageRows18': "remove a finished epic's worktree (clean, merged, no role running)",
  'command.usage.usageLines': 'cadre commands:',
  'command.usage.helpText': 'Unknown subcommand: {unknown}',

  'launch.deny.dotdotMessage': 'a .. segment is not allowed in an absolute pattern',
  'launch.deny.unsafeRootWarning':
    'the repo path holds characters a permission rule cannot hold: code-dir denies stay any-depth',
  'launch.deny.lintedDeny': '{entry} was not emitted: {message}',
  'launch.deny.runtimeDeny': 'Code dir {dir} has an unusual name and is not denied',
  'launch.deny.undeniedMemoryWarning': 'memory {file} has a path a permission rule cannot hold: it stays editable',
  'launch.deny.undeniedPrivateWarning':
    'the private instructions folder has a path a permission rule cannot hold: it stays editable',
  'launch.deny.undeniedMemoryFolderWarning':
    'the memory folder of this repo has a path a permission rule cannot hold: its memories stay editable',
  'launch.deny.undeniedRecordWarning':
    'the hand-out record instructions.json has a path a permission rule cannot hold: it stays editable',

  'launch.links.unsafeMemoryNameWarning': 'memory file {name} has an unsafe name: not linked',
  'launch.links.globalLinks': 'global file {name} has an unsafe name: not linked',

  'launch.overlay.overlayGroup': '{kind} {name} has an unsafe name: not linked',
  'launch.overlay.overlayGroup2': '{kind} {name} was not found in your user {kind}s: not linked',

  'start.renderPlan.roleFolderRefusal': '.cadre/{role} is not a folder inside this repo: run /cadre regen {role}',
  'start.renderPlan.runtimeRefusal': '.cadre/{role}/.runtime/ or a folder in it is a link or not a folder',
  'start.renderPlan.runtimeRefusal2': '{what}: remove it and run /cadre start {role} again',
  'start.renderPlan.unstatedLinkRefusal': '.cadre/{role}/.runtime/{name} is a link /cadre start could not check',
  'start.renderPlan.unstatedLinkRefusal2': '{what}: remove it and run /cadre start {role} again',
  'start.renderPlan.privateLinkRefusal':
    '.cadre/{role}/.runtime/{privateInstructionsLink} is a real file or folder, not a link',
  'start.renderPlan.privateLinkRefusal2': '{what}: remove it and run /cadre start {role} again',
  'start.renderPlan.notReplacedWarning': '{repoRelative} is a real file or folder, not a link: not replaced',

  'start.gatherUser.startNoHome': 'cadre start needs HOME to render the role files, so it stopped.',
  'start.gatherUser.startNoGitDir':
    `cadre start could not read the git common dir (git rev-parse failed or gave no absolute path; git ${
    ''}2.31 or newer is needed), so it stopped.`,
  'start.gatherUser.privateFolderRefusal': 'cadre start stopped: {path}',
  'start.gatherUser.privateFolderRefusal2': 'cadre does not write through it',
  'start.gatherUser.privateFolderRefusal3': '{stopped} is a link; {end}',
  'start.gatherUser.privateFolderRefusal4': '{stopped} is not a folder; {end}',
  'start.gatherUser.privateFolderRefusal5': '{stopped} could not be checked for links; {end}',

  'start.memoryLinks.memoryChangedWarning':
    'memory {file} changed since init: linked as it is now; run /cadre regen {role} to hand it out again',
  'start.memoryLinks.memoryGoneWarning': 'memory {file} is gone: not linked',
  'start.memoryLinks.openMemoryBlockWarning':
    'the MEMORY.md block of {id} has no end marker: fix it by hand; linked memories are not indexed',
  'start.memoryLinks.unreadableRecordWarning':
    `could not read the hand-out record of {id} ({instructionsRecordFile}): no memory is linked; run ${
    ''}/cadre init to hand the memories out again`,
  'start.memoryLinks.unreadableMemoryIndexWarning':
    'could not read the {memoryIndexFile} of {id}: linked memories are not indexed',
  'start.memoryLinks.memoryIndexLinkWarning':
    'the {memoryIndexFile} of {id} is a link: linked memories are not indexed',

  'start.mcpConfig.mcpNotReadWarning':
    '~/.claude.json was not read (no consent at init), so the user-scope MCP servers of this role are not rendered',
  'start.mcpConfig.mcpNotInFileWarning':
    `MCP server {name} is not in ~/.claude.json: the role gets it only from the repo .mcp.json or a ${
    ''}claude.ai connector`,

  'start.claudeVersion.startNoClaude':
    'cadre start could not run claude --version, so it stopped: install Claude Code {minClaudeVersionText} or newer.',
  'start.claudeVersion.claudeTooOldReply':
    'cadre start needs claude {minClaudeVersionText} or newer on PATH; claude --version gave: {shown}',

  'start.launcherCheck.startNoManifest':
    '.cadre/manifest.json is missing or not valid, so cadre cannot check the launcher: run /cadre init again.',
  'start.launcherCheck.launcherMissingReply':
    '.cadre/bin/{role} is missing or not in .cadre/manifest.json: run /cadre regen {role}.',
  'start.launcherCheck.launcherChangedReply':
    `{launcher} was changed outside cadre: restore it, or run /cadre init and answer Take new for it, or ${
    ''}run /cadre regen {role}, move {launcher}.cadre-new over it, chmod 755 it and run /cadre regen ${
    ''}{role} again.`,
  'start.launcherCheck.renderFailedReply':
    `cadre start could not render .cadre/{role}/.runtime/ ({path} failed), so the launcher will refuse ${
    ''}to start: fix it and run /cadre start {role} again.`,
  'start.launcherCheck.launcherOutdatedWarning':
    `.cadre/bin/{role} is not the launcher this cadre writes today (written by an older cadre or for ${
    ''}another setup): run /cadre regen {role} to update it`,

  'start.run.terminalLine': 'Opened it in a new {name}.',
  'start.run.terminalLine2': 'Could not open a new {name}: run the command above yourself.',
  'start.run.startReplyText': 'cadre start {id}',
  'start.run.startReplyText2': 'warning: {warning}',
  'start.run.startReplyText3': 'Run this in a terminal to start role {id}:',
  'start.run.rendered.one': 'Rendered .cadre/{id}/.runtime/ ({count} link).',
  'start.run.rendered.other': 'Rendered .cadre/{id}/.runtime/ ({count} links).',
  'ui.diff.more.one': '... {count} more changed line',
  'ui.diff.more.other': '... {count} more changed lines',

  'epic.create.epicAddFailedReply':
    'git could not add the epic worktree on the kept branch {name}, so cadre epic stopped.',
  'epic.create.epicAddFailedReply2':
    `git could not add the epic worktree, so cadre epic stopped. The branch {name} may now exist: cadre ${
    ''}keeps it, and the next /cadre epic run adds the worktree on it.`,
  'epic.create.epicPathExistsReply':
    `the epic worktree path already exists and git lists no worktree of this key there, so cadre epic ${
    ''}stopped before adding it: {path}`,
  'epic.create.epicNoRecordWarning': 'cadre could not write {epicRecordFile} for the epic {key}: the write failed.',
  'epic.create.outcomeLine': 'Created the worktree {path} on the new branch {branch}.',
  'epic.create.outcomeLine2': 'Reused the worktree {path} on the branch {branch}.',
  'epic.create.outcomeLine3': 'Added the worktree {path} back on the kept branch {branch}.',
  'epic.create.epicCreatedText': 'cadre epic {key}',
  'epic.create.epicCreatedText2': 'Title: {title}',
  'epic.create.epicCreatedText3': 'Linked {linked}, copied {copied}.',
  'epic.create.epicCreatedText4': 'warning: {warning}',
  'epic.create.openedRole': 'opened in a new {name}',
  'epic.create.openedLines': '  {id}: {line}',
  'epic.create.openedLines2': '  {id}: {line}',
  'epic.create.renderedLines': 'warning: {id}: {warning}',

  'epic.done.epicDoneNoList': 'cadre epic done could not list the worktrees from git, so it removed nothing.',
  'epic.done.epicNotFoundReply': 'git lists no worktree of the epic {key}, so cadre epic done removed nothing.',
  'epic.done.epicRemovedText': 'its branch {branch} is kept, as cadre never deletes a branch.',
  'epic.done.epicRemovedText2': 'cadre epic done {key}: removed the worktree {path}; {kept}',
  'epic.done.epicRemoveFailedReply':
    `git could not remove the epic worktree, so cadre epic done stopped. The links it records were ${
    ''}removed first: run /cadre epic {key} to link them again.`,
  'epic.done.cleanProblems': 'git shows changes in the worktree: commit or stash them there',
  'epic.done.cleanProblems2':
    'git could not tell whether the worktree is clean: run git status there, then commit or stash what it shows',
  'epic.done.mergedProblems':
    `the epic record {epicRecordFile}, which names the branch the worktree was made from, is missing or ${
    ''}not valid, so cadre cannot tell whether {name} is merged: merge it, then use --force`,
  'epic.done.mergedProblems2': 'the branch {name} is not merged into {into}: merge it into {into}',
  'epic.done.mergedProblems3':
    'git could not tell whether {name} is merged into {into}: check that {into} exists, then merge into it',
  'epic.done.roleProblems':
    `role states unknown: cadre could not read the team in .cadre/, so it cannot tell whether a role ${
    ''}still runs in the worktree: fix the team, or stop every role and use --force`,
  'epic.done.epicDoneRefusal':
    `cadre epic done kept the worktree of the epic {name} and removed nothing: fix what is below, or run ${
    ''}/cadre epic done {name} --force to remove it anyway after one question.`,
  'epic.done.epicDoneRefusal2': '- {problem}',
  'epic.done.epicDoneHeader': 'Epic done',
  'epic.done.removeOption': 'Yes, remove it',
  'epic.done.keepOption': 'No, keep it',
  'epic.done.epicDoneQuestion': 'cadre removes its links first and keeps its branch.',
  'epic.done.epicDoneQuestion2': 'Remove the worktree of the epic {name}? {steps}',
  'epic.done.epicDoneQuestion3': 'Remove the worktree of the epic {name} anyway? {steps} Without --force it stays, as:',
  'epic.done.epicDoneQuestion4': '- {problem}',
  'epic.done.epicDoneNoDialog':
    'cadre epic done --force asks before it removes anything, and this session has no dialog, so it removed nothing.',
  'epic.done.epicKeptReply': 'cadre epic done kept the worktree of the epic {key}: nothing was removed.',
  'epic.done.epicLockedReply': 'locked with no reason',
  'epic.done.epicLockedReply2': 'locked ({reason})',
  'epic.done.epicLockedReply3':
    `the epic worktree is {lock}, and the lock names no process, so cadre epic done cannot tell whether ${
    ''}it is stale and removed nothing: run git worktree unlock on it once nothing uses it.`,
  'epic.done.epicLockLiveReply':
    'the epic worktree is locked by process {pid}, which still runs, so cadre epic done removed nothing.',
  'epic.done.epicLockUnknownReply':
    `the epic worktree is locked by process {pid}, and cadre could not tell whether it still runs, so ${
    ''}cadre epic done removed nothing.`,
  'epic.done.epicUnlockFailedReply':
    'git could not unlock the epic worktree, whose lock names the ended process {pid}, so nothing was removed.',

  'epic.key.epicBadKeyReply':
    `{raw} is not an epic key: a key is 1-32 letters, digits, - or _, starting with a letter or a digit ${
    ''}(one leading # is dropped, so #123 works).`,
  'epic.key.epicBadNameReply':
    `{name} cannot name an epic worktree (lowercase letters and digits with single - between them), so ${
    ''}cadre epic stopped.`,

  'epic.launcher.epicWorktreeLauncherLine':
    `not opened: the epic branch holds a launcher .cadre/bin/{role} older than the epic kickoff. Commit ${
    ''}the regenerated .cadre/bin/{role} and .cadre/manifest.json to the branch and run /cadre epic with ${
    ''}the same key again.`,
  'epic.launcher.epicWorktreeLauncherChangedLine':
    "not opened: the worktree's .cadre/bin/{role} is not the launcher cadre checked in the main checkout.",

  'epic.mirrorRun.globalExcludesWarning':
    `cadre epic could not read your global git excludes file {path}, so the worktree's excludes file ${
    ''}leaves its patterns out: a file only it ignores may show as untracked in the worktree.`,
  'epic.mirrorRun.epicListFailedReply':
    `git could not list the untracked and ignored files of the main checkout, so cadre epic linked and ${
    ''}copied nothing into the worktree. The worktree stays: run /cadre epic {key} again.`,
  'epic.mirrorRun.epicExcludesFailedReply':
    `cadre epic could not set up the excludes file that hides its links from git, so it made no links. ${
    ''}The worktree stays: run /cadre epic {key} again.`,
  'epic.mirrorRun.epicStepFailedReply':
    `cadre epic could not make {path} in the worktree (a folder, link or copy), so it stopped there. The ${
    ''}worktree stays: fix it and run /cadre epic with the same key again.`,

  'epic.mirror.mirrorLinkedParentWarning':
    `cadre epic left {path} out of the worktree: a folder above it there is a link, and cadre never ${
    ''}links or copies through a link.`,
  'epic.mirror.mirrorUnhideableWarning':
    `cadre epic left {path} out of the worktree: its name holds a line break or another control ${
    ''}character, so no excludes line could hide it from git.`,

  'epic.pick.epicUnknownCheckout':
    'cadre epic could not tell from git whether this is the main checkout, so it stopped before creating anything.',
  'epic.pick.epicNotMainReply': 'run /cadre epic in the root session of the main checkout, not in a linked worktree.',
  'epic.pick.epicNotMainReply2': 'run /cadre epic in the root session of the main checkout: {main}',
  'epic.pick.epicNoPm':
    'cadre epic needs a PM role to fetch the epic: add one (id pm, or based on pm) with /cadre init.',
  'epic.pick.epicManyPmReply':
    `cadre epic needs one PM role to fetch the epic, but {ids} are all based on pm and none has the id ${
    ''}pm: give the PM the id pm.`,
  'epic.pick.epicOldLauncherReply': '/cadre regen {id}',
  'epic.pick.epicOldLauncherReply2':
    `cadre epic stopped before creating anything: the launcher of {ids} predates the epic kickoff and ${
    ''}would start without it. Run {regens}. A new epic worktree is made from HEAD, so if this repo ${
    ''}commits .cadre/, commit the regenerated .cadre/ files (the .cadre/bin/ launchers and ${
    ''}.cadre/manifest.json) too. Then run /cadre epic again.`,
  'epic.pick.epicRolesHeader': 'Epic roles',
  'epic.pick.pmOnlyOption': 'PM only',
  'epic.pick.allRolesOption': 'All {count} roles (Recommended)',
  'epic.pick.epicRolesQuestion':
    `Which roles should cadre epic open in the worktree? All {count}, PM only, or type role ids under ${
    ''}Other; the PM always opens, as it fetches the epic.`,
  'epic.pick.epicCancelled': 'cadre epic was cancelled: no roles were picked to open, so it created nothing.',
  'epic.pick.epicPickedRolesAccepts': '{quotedLabels}, or role ids from: {ids}',

  'epic.lookup.epicNoWorktreeList':
    'cadre epic could not list the worktrees and epic branches from git, so it stopped before creating anything.',
  'epic.lookup.epicManyWorktreesReply':
    'cadre epic reuses one worktree per key, but this key has more than one, so it stopped: ',
  'epic.lookup.epicManyBranchesReply':
    `cadre epic adds a worktree back on one kept branch per key, but this key has more than one and no ${
    ''}worktree, so it stopped: {branches}`,
  'epic.done.roleRunning.one': 'the role {ids} still runs in the worktree: stop it first',
  'epic.done.roleRunning.other': 'the roles {ids} still run in the worktree: stop them first',

  'detect.report.title': 'cadre detect  (read-only, nothing was written)',
  'detect.report.choiceLine': 'Adapter: {id} ({reason})',
  'detect.report.choiceLine2': 'Adapter: ambiguous: {ids}; init will ask',
  'detect.report.choiceLine3': 'Adapter: installed-only: {ids}; init will ask',
  'detect.report.choiceLine4': 'Adapter: none usable: {ids} detected but unsupported; init will ask',
  'detect.report.choiceLine5': 'Adapter: none (built-in); nothing detected, init will recommend GSD or superpowers',
  'detect.report.unsupportedNoteLines': 'Warning: also detected but unsupported: {names}',
  'detect.report.gsdHookLines': '{name} ({note})',
  'detect.report.gsdHookLines2': '{factsHeading}: {items}',
  'detect.report.warningLines': 'Warning: {warning}',
  'detect.report.gateRow': 'standing rule',
  'detect.report.gateRows': '{header}how the kickoff handles it',
  'detect.report.autonomyLines': '    {key} -> {to} ({requirement}): {why}',
  'detect.report.adapterBlock': '{artifact}: {check}; then a line that starts with AUTOPILOT_DONE',
  'detect.report.adapterBlock2': '{name} ({id})',
  'detect.report.adapterBlock3': '  detect:       {detectRule}',
  'detect.report.adapterBlock4': '  start work:   {startWork}',
  'detect.report.adapterBlock5': '  spec files:   {spec}',
  'detect.report.adapterBlock6': '  plan files:   {plan}',
  'detect.report.adapterBlock7': '  verify:       {verify}',
  'detect.report.adapterBlock8': '  done signal:  {done}',
  'detect.report.adapterBlock9': '  autonomy:',
  'detect.report.adapterBlock10': '  kickoff (example for role BE):',
  'detect.report.adapterBlock11': '  human gates:',
  'detect.report.detectText': 'Adapter contract (the same fields for every adapter):',
  'detect.report.framework': 'Framework',
  'detect.report.status': 'Status',
  'detect.report.version': 'Version',
  'detect.report.evidence': 'Evidence',

  'guard.repo.gitRootRefusal': 'run /cadre {command} from the repo root: {top}',
  'guard.repo.notGitRepoReply': 'cadre {command} needs a git repo: run git init first',
  'guard.repo.rootUnknownReply':
    'cadre {command} could not read the session root, so it stopped before reading anything.',

  'guard.refusals.homeRootReply':
    `cadre detect needs a repo root other than your home folder. Open the session in a repo and run ${
    ''}/cadre detect again.`,
  'guard.refusals.fileSystemRootReply':
    `cadre detect needs a repo root other than the file system root (/). Open the session in a repo and ${
    ''}run /cadre detect again.`,

  'team.noStateReply': 'cadre {command} needs .cadre/cadre.json from /cadre init: run /cadre init first.',
  'team.regenBadState': '.cadre/cadre.json is not valid: fix it, or run /cadre init again.',
  'team.regenNoRole': 'no role {id} in .cadre/cadre.json (roles: {roles})',
  'team.regenBadRole': '.cadre/{id}/role.json is missing or not valid: fix it, or run /cadre init again.',
  'team.regenNeedsFramework':
    `role {id} has no framework and this repo has no default: set "framework" in .cadre/{id}/role.json ${
    ''}to gsd, superpowers or none, then run /cadre regen {id} again.`,

  'scan.autopilot.autopilotReply':
    `cadre {command} does not run inside an active autopilot run in this session. Stop it with ${
    ''}/autopilot stop, or run /cadre {command} in another session.`,
  'scan.autopilot.autopilotReply2':
    `cadre {command} can't tell whether autopilot is running in this session (its status file could not ${
    ''}be read), so it stopped.`,

  'scan.facts.collect.locationsOf': 'the repo root',
  'scan.facts.collect.locationsOf2': 'the home folder',

  'scan.facts.normalize.hiddenNameWarnings': 'ignored {kind} "{shown}": its name has hidden characters or is too long',
  'scan.facts.normalize.hiddenNameWarnings2':
    'ignored {rest} more {kind} names that have hidden characters or are too long',
  'scan.facts.normalize.normalizeFacts': 'repo entry',
  'scan.facts.normalize.normalizeFacts2': 'docs/ entry',
  'scan.facts.normalize.normalizeFacts3': 'enabledPlugins key',
  'scan.facts.normalize.normalizeFacts4': 'installed plugin key',

  'scan.instructions.memories.noMemorySummary': 'No summary in MEMORY.md.',
  'scan.instructions.memories.unreadableWarning': 'could not read {file}: no role gets it',
  'scan.instructions.memories.memoryOverSizeWarning': '{file} is over {value} KiB: not offered',

  'scan.instructions.read.moreDocsWarning': '{count} more referenced docs were not read: no role gets them',
  'scan.instructions.read.overSizeWarning': '{file} is over {value} KiB, not split: no role gets it',
  'scan.instructions.read.outsideWarning':
    '{file} is outside the repo and your config folder, not read: no role gets it',
  'scan.instructions.read.repoImportWarning':
    '{file} is imported by a repo file and is outside the repo, not read: no role gets it',
  'scan.instructions.read.unfollowedImportWarning':
    '{file} is linked from a repo file and is a dotfile, under .git/ or not a .md file, not read: no role gets it',
  'scan.instructions.read.configFileWarning':
    `{file} is not a plain .md file of your config folder (no dot name, not under projects/, cadre/ or ${
    ''}plugins/), not read: no role gets it`,
  'scan.instructions.read.totalCapWarning':
    'stopped reading at {value} KiB in total, {files} not read: no role gets {which}',
  'scan.instructions.read.morePartsWarning': '{count} more parts were not offered: they stay with the root session',

  'scan.markers.markerRows': 'JavaScript/TypeScript (package.json)',
  'scan.markers.markerRows2': 'Ruby (Gemfile)',
  'scan.markers.markerRows3': 'Go (go.mod)',
  'scan.markers.markerRows4': 'Python (pyproject.toml)',
  'scan.markers.markerRows5': 'Rust (Cargo.toml)',
  'scan.markers.markerRows6': 'Jest config',
  'scan.markers.markerRows7': 'Vitest config',
  'scan.markers.markerRows8': 'RSpec config',
  'scan.markers.markerRows9': 'pytest config',
  'scan.markers.markerRows10': 'pytest conftest',
  'scan.markers.markerRows11': 'JS/TS test files',
  'scan.markers.markerRows12': 'Go test files',
  'scan.markers.markerRows13': 'RSpec spec files',
  'scan.markers.markerRows14': 'pytest test files',
  'scan.markers.markerRows15': 'Playwright config',
  'scan.markers.markerRows16': 'Cypress config',
  'scan.markers.markerRows17': 'Cypress folder',
  'scan.markers.markerRows18': 'Rails system specs',
  'scan.markers.markerRows19': 'Rails system tests',
  'scan.markers.markerRows20': 'Cucumber features',

  'scan.repo.scanRepo': 'repo entry',

  'scan.setup.agents.agentNames': 'agent name',

  'scan.setup.mcp.unfitMcpWarnings': 'MCP server',
  'scan.setup.mcp.sessionMcpScan': 'MCP server name',
  'scan.setup.mcp.sessionMcpScan2': 'the session tools',
  'scan.setup.mcp.projectMcpScan': 'MCP server name',
  'scan.setup.mcp.userConfigMcpScan': 'MCP server name',

  'scan.setup.memory.memoryFileNames': 'memory file name',

  'scan.setup.settings.hookNameWarnings': 'hook script',
  'scan.setup.settings.hookNameWarnings2': 'the {source} settings',
  'scan.setup.settings.settingsNameWarnings': 'settings key',
  'scan.setup.settings.settingsNameWarnings2': 'enabledPlugins key',
  'scan.setup.settings.installedPluginKeys': 'installed plugin key',

  'scan.setup.setup.noUserDirWarning': 'HOME is unset: user-level setup was not scanned',

  'scan.setup.skills.commandRefs': 'command or plugin name',
  'scan.unknown': '{what} (treated as unknown)',
  'scan.couldNotRead': 'could not read {what}',
  'scan.couldNotParse': 'could not parse {what} as JSON',
  'scan.couldNotList': 'could not list {what}',
  'scan.couldNotReadSettings': 'could not read {source} settings',
  'scan.notRegularFile': 'skipped {what}: not a regular file inside the repo',
  'scan.notValidCadre': 'ignored {what}: not a valid cadre {noun}',
  'scan.repoRootUnlisted': 'could not list the repo root',
  'scan.docsUnlisted': 'could not list docs/',
  'scan.sessionRootUnread': 'could not read the session root',
  'scan.cadreUnlisted': 'could not list .cadre',
  'scan.rulesUnlisted': 'could not list .claude/rules',
  'scan.memoryFolderUnlisted': 'could not list the memory folder',
  'scan.sessionToolsUnlisted': 'could not list session tools',
  'scan.commandsUnlisted': 'could not list commands and skills',
  'scan.chainUnread': 'could not read the CLAUDE.md chain',
  'scan.mcp.desktopLeftOut.one':
    `left out {count} desktop app connector ${
    ''}(role sessions run in the terminal, where connectors are claude_ai_* servers)`,
  'scan.mcp.desktopLeftOut.other':
    `left out {count} desktop app connectors ${
    ''}(role sessions run in the terminal, where connectors are claude_ai_* servers)`,
  'scan.settings.unfitNames.one': 'ignored {count} {noun} name from {source} that a role.json cannot hold',
  'scan.settings.unfitNames.other': 'ignored {count} {noun} names from {source} that a role.json cannot hold',

  'roles.adjust.customPurpose': 'A custom role added by the person running init.',
  'roles.adjust.noRole': 'no role "{id}"',
  'roles.adjust.usedId': 'role id "{id}" is already used',
  'roles.adjust.noTitle': 'role "{id}" has no title',
  'roles.adjust.addRole': 'at most {maxRoles} roles',
  'roles.adjust.dropRole': 'keep at least one role',

  'roles.infra.mcpRoleRows': 'Jira, Linear or Notion',
  'roles.infra.mcpRoleRows2': 'Playwright or DevTools',
  'roles.infra.mcpRoleRows3': 'GitHub',
  'roles.infra.skillRoleRowsLabel': 'frontend and design skills',

  'roles.propose.languageText': 'unknown language',
  'roles.propose.backendChange': 'no backend framework',
  'roles.propose.backendChange2': 'no UI framework',
  'roles.propose.backendChangeReason': 'source code found ({language}), {missing}',

  'roles.recommend.noFrameworkWhy': 'no dev framework is in use; roles run the built-in plan, execute, verify loop',
  'roles.recommend.recommendTool': 'Playwright MCP',
  'roles.recommend.recommendWhy': 'the FE role has no E2E setup to check its work in a browser',
  'roles.recommend.recommendTool2': 'DevTools MCP',
  'roles.recommend.recommendWhy2': 'the FE role cannot inspect the running page',
  'roles.recommend.recommendWhy3':
    "claude-security gives the Security role Anthropic's review skill (needs Python 3.9 or newer)",
  'roles.recommend.recommendWhy4': 'no hooks warn the Security role about risky edits',

  'roles.template.noFrontendReason': 'no frontend framework found (react, vue, next, svelte, angular)',
  'roles.template.noTestsReason': 'no tests or E2E setup found',
  'roles.template.noSourceReason': 'no source code found',

  'roles.validate.slugRule': 'a lowercase slug: a letter, then letters, digits or dashes, 24 characters at most',
  'roles.validate.validateRoleId': 'role id "bin" is reserved: it is the launcher folder .cadre/bin/',
  'roles.validate.validateRoleId2': 'role id "{id}" is reserved: all and none are answer words in init questions',
  'roles.validate.validateRoleId3': 'role id "{id}" must be {slugRule}',
  'roles.validate.idProblems': 'duplicate role id "{id}"',
  'roles.validate.validateRoles': 'no roles: describe at least one role',
  'roles.validate.validateRoles2': 'at most {maxRoles} roles (got {count})',
  'roles.validate.validateRoles3': 'role "{id}" has no title',

  'plan.plan.conflictNote': 'changed outside cadre: kept as is; the new version is planned beside it',
  'plan.plan.unreadableNote':
    'could not read it (treated as changed): kept as is; the new version is planned beside it',
  'plan.plan.newVersionNote': 'the new version, for diffing; init asks Keep mine or Take new for the file',
  'plan.plan.occupiedNote': 'a different file is already there: kept as is',
  'plan.plan.staleNote': 'no longer generated (kept; cadre deletes nothing)',
  'plan.plan.unreadableManifestNote':
    "could not read it (treated as changed): kept as is, so no role's entries are dropped; it is not written",
  'plan.plan.refusalWarning': 'refused to plan {path}: not a .cadre/ path or .gitignore (PLAN-06)',
  'plan.plan.twiceWarning': 'refused to plan {path} twice: only the first is kept',
  'plan.plan.acceptFiles': 'refused to plan {path}: cadre plans it itself',
  'plan.plan.hunkPart': 'refused hunk for {file}: not a known framework config (PLAN-06)',

  'plan.text.fileRows': ' (executable)',
  'plan.text.hunkRows': '{key}: {before} -> {after}',
  'plan.text.hunkRows2': '  {pad}{file}  {change}  ({flags})',
  'plan.text.hunkRows3': '{detailIndent}run: {command}',
  'plan.text.planSummary': '0 hunks',
  'plan.text.planSummary2': '{hunks} hunks ({accepted} accepted)',
  'plan.text.planSummary3': '{create} create, {change} change, {leave} leave, {conflict} conflict',
  'plan.text.planSummary4': 'Summary: {kinds}, {hunkCount}',
  'plan.text.renderPlan': 'warning: {warning}',
  'plan.text.renderPlan2': 'File plan:',
  'plan.text.dryRunNote': 'Dry run: nothing was written.',

  'plan.gitignore.openBlockWarning':
    'the cadre block in .gitignore has no end marker: fix it by hand; the ignore block is not planned',
  'plan.plan.manifestKept': '{what}: it is kept as is and not written',
  'plan.plan.ignoreNotPlanned': '{what}: the ignore block is not planned',
  'framework.gsd.identity.notBuilt': '{prefix}: runtime not built',
  'framework.gsd.identity.couldNotRun':
    '{prefix}: the identity call could not run (node missing or timed out); treated as unknown',
  'framework.gsd.hunks.itsSettings': 'its settings',
  'framework.gsd.hunks.attended.one': 'attended: GSD needs a person until {what} is set as proposed',
  'framework.gsd.hunks.attended.other': 'attended: GSD needs a person until {what} are set as proposed',

  'framework.gsd.identity.unprovenWarning': 'could not prove the GSD install at {dir}',

  'framework.gsd.hunks.notSetText': 'not set (GSD default)',
  'framework.gsd.hunks.unknownConfigText': 'unknown (could not read {gsdConfigFile})',
  'framework.gsd.hunks.sentenceList': '{head} and {last}',

  'framework.gsd.tools.refusedDisplay': 'refused: an argument is not a plain word',

  'framework.contract.unsupportedMarkers':
    `every stage after Initialization ends in a recorded human approval gate, so autonomous roles would ${
    ''}block; no cadre adapter in v1`,
  'framework.contract.unsupportedMarkersReason':
    'persona and workflow method with its own gates and _bmad/ runtime; no cadre adapter in v1',
  'framework.contract.unsupportedMarkersReason2': 'spec-driven command set under .specify/; no cadre adapter in v1',
  'framework.contract.detectUnsupported': 'no {marker}/',
  'framework.contract.detectUnsupported2': '{marker}/ present',
  'framework.contract.detectUnsupported3': 'detected but unsupported: {reason}',
  'framework.contract.pickedByUser': 'picked by the user',
  'framework.contract.onlyInUse': 'only {id} is in use in this repo',
  'framework.contract.decisionTypeProblem': 'standing-rule gate must have decisionType null',
  'framework.contract.decisionTypeProblem2': 'decisionType null needs kind standing-rule',
  'framework.contract.decisionTypeProblem3': 'unknown decisionType',
  'framework.contract.gateFieldProblems': 'gate {id}',
  'framework.contract.gateFieldProblems2': '{label}: {decisionProblem}',
  'framework.contract.gateFieldProblems3': '{label}: empty kickoff',
  'framework.contract.oneGateProblems': 'gate is not an object',
  'framework.contract.oneGateProblems2': 'gate has no id',
  'framework.contract.oneGateProblems3': 'duplicate gate id {id}',
  'framework.contract.gateProblems': 'gates is not an array',
  'framework.contract.gateProblems2': 'gate could not be read',
  'framework.contract.gateProblems3': 'more gate problems not shown',

  'framework.gsd.adapter.gsdHookNotes': 'conflicts with the autopilot handoff',
  'framework.gsd.adapter.gsdHookNotes2': 'useful for Security',
  'framework.gsd.adapter.gsdHookNotesNote':
    'rejects non-Conventional commit messages when enabled (this repo uses (type): Subject)',
  'framework.gsd.adapter.gsdHookNotes3': 'advisory nag when enabled',
  'framework.gsd.adapter.detectGsd': 'no .planning/',
  'framework.gsd.adapter.detectGsd2': 'no gsd-core install proven',
  'framework.gsd.adapter.planningEvidence': '.planning/ (symlink)',
  'framework.gsd.adapter.planningEvidence2': '.planning/ (dir)',
  'framework.gsd.adapter.installEvidence': 'gsd-core (version unknown)',
  'framework.gsd.adapter.installEvidence2': 'gsd-core {version}',
  'framework.gsd.adapter.installEvidence3': '{label} at {dir}',
  'framework.gsd.adapter.gsdAutonomyWhy':
    'interactive mode stops for confirmations; yolo lets an autopilot role run phases unattended',
  'framework.gsd.adapter.gsdAutonomyWhy2':
    'text mode turns menus into plain-text questions autopilot cannot deny, so the role would stall',
  'framework.gsd.adapter.gsdAutonomy':
    'only when gsd-statusline is the statusline: gsd-context-monitor warnings conflict with the autopilot handoff',
  'framework.gsd.adapter.gsdAdapter':
    `in use: .planning/ at the repo root (dir or symlink); installed: gsd-core identity proven at ${
    ''}~/.claude/gsd-core (or $CLAUDE_CONFIG_DIR/gsd-core when it is set and safe) or ${
    ''}<repo>/.claude/gsd-core`,
  'framework.gsd.adapter.gsdAdapter2': '/gsd-autonomous --only N',
  'framework.gsd.adapter.gsdAdapter3': '/gsd-discuss-phase N --auto, /gsd-plan-phase N --auto, /gsd-execute-phase N',
  'framework.gsd.adapter.gsdAdapter4': '/gsd-new-project (no .planning/ yet)',
  'framework.gsd.adapter.gsdAdapter5': '/gsd-validate-phase N',
  'framework.gsd.adapter.gsdAdapter6': '/gsd-code-review N',
  'framework.gsd.adapter.gsdAdapter7': 'the verifier inside /gsd-execute-phase',
  'framework.gsd.adapter.gsdAdapterCheck': 'frontmatter status: passed',
  'framework.gsd.adapter.gsdAdapterFactsHeading': 'GSD hooks registered (activation depends on GSD config)',

  'framework.superpowers.adapter.detectSuperpowers': 'no docs/superpowers/ or .superpowers/',
  'framework.superpowers.adapter.detectSuperpowers2': 'no enabled superpowers@ plugin',
  'framework.superpowers.adapter.installedEvidence': 'enabledPlugins["{key}"]=true ({source})',
  'framework.superpowers.adapter.superpowersAdapter':
    `in use: docs/superpowers/ or .superpowers/ at the repo root; installed: an enabledPlugins key ${
    ''}starting superpowers@ set to true`,
  'framework.superpowers.adapter.superpowersAdapter2': 'superpowers:writing-plans <spec path> (BE/FE with a TL spec)',
  'framework.superpowers.adapter.superpowersAdapter3': 'superpowers:brainstorming (TL/PM)',
  'framework.superpowers.adapter.superpowersAdapter4': "the project's test command",
  'framework.superpowers.adapter.superpowersAdapterArtifact': '.superpowers/sdd/<plan workspace>/progress.md',
  'framework.superpowers.adapter.superpowersAdapterCheck': 'every task has a "Task <N>: complete" line',
  'framework.superpowers.adapter.superpowersAdapter5':
    `No config file: autonomy comes only from the kickoff text. Chat gates end a turn with no tool call, ${
    ''}and autopilot pauses after 2 such turns, so the kickoff pre-answers every gate.`,

  'framework.none.adapter.detectBuiltin': 'built into cadre',
  'framework.none.adapter.builtinAdapterDetectRule': 'always available inside cadre; used when no framework is chosen',
  'framework.none.adapter.builtinAdapter': 'write the plan to .cadre/<role>/.runtime/plan.md (never ExitPlanMode)',
  'framework.none.adapter.builtinAdapter2': 'execute the plan with subagents',
  'framework.none.adapter.builtinAdapter3': "the project's test and lint commands (from the repo scan)",
  'framework.none.adapter.builtinAdapter4': 'a reviewer subagent',
  'framework.none.adapter.builtinAdapterCheck': 'the file exists and says what was done and how it was verified',
  'framework.none.adapter.builtinAdapterAutonomyNote':
    'No framework config: autonomy comes from the kickoff text alone.',

  'scope.lint.denyProblems': 'deny entry {entry} would block an infra tool',
  'scope.lint.denyProblems2': 'deny entry {entry} names the infra plugin {key}',
  'scope.lint.startSkillProblem': 'start skill {name} of {framework} is not in the overlay',
  'scope.lint.startSkillProblem2': 'start skill {name} of {framework} needs the plugin {plugin}, which is not enabled',
  'scope.lint.infraViolations': 'infra plugin {key} is not enabled',
  'scope.lint.infraViolations2': 'handoff skill {name} is not in the overlay',
  'scope.lint.infraViolations3': 'flag {flag} would turn off the handoff skills',

  'generate.gittrack.untrackedPartsWarning': '{file} is not tracked by git: its parts are not written to .cadre/',
  'generate.gittrack.gitTrackingUnknownWarning':
    'could not ask git which instruction files it tracks: no repo part is written to .cadre/',

  'suggest.propose.fallbackNote': 'Using the template proposal; you can still adjust it.',
  'suggest.propose.fallbackMessage': 'Could not use the described structure: {reason}. {fallbackNote}',

  'suggest.topics.fallbackTopics': 'All of {file}',

  'paths.homeUnusableWarning': 'HOME is unset or not an absolute path: the home-folder check was skipped',
  'paths.configDirWarning':
    'CLAUDE_CONFIG_DIR is ignored: it must be an absolute path with no .. segment, outside the repo',
  'paths.noUserFolderWarning':
    'user-level installs were not checked: no CLAUDE_CONFIG_DIR or home folder outside the repo',
  'paths.resolvedPath': 'could not resolve {label} (used as given)',
  'detect.report.gate': 'gate',
  'detect.report.type': 'type',
  'detect.report.human': 'human?',
  'detect.report.gateHeader': '    {columns}',
  'detect.report.autonomyNote': '    {note}',
  'detect.report.noAutonomy': 'no autonomy settings',
  'plan.text.required': 'required',
  'plan.text.optional': 'optional',
  'plan.text.accepted': 'accepted',
  'plan.text.declined': 'declined',
  'plan.text.flags': '{required}, {accepted}',
}) satisfies Record<string, string>

/** The key of an EN text (D-216). */
export type EnKey = keyof typeof EN
