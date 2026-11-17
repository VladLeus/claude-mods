/**
 * The text cadre writes into generated files (D-221), a layer 0 leaf: ROLE.md, the header of a built and of a private
 * role CLAUDE.md, the marker above each part, INDEX.md, the messages and refusals of a launcher, and the scope card's
 * lines and rule texts, which ROLE.md holds and the review and the probe read too. Always English and printable ASCII:
 * the manifest hashes every generated file, so a byte change here would show as a change or a conflict in every
 * installed role on its next init or regen (C4). Templates with `{name}` slots are filled through locales/t `fill`,
 * after the builder cleaned and capped each value (D-222); a template too long for one line breaks inside an empty
 * `${''}`, so it keeps its literal type and its typed slots. It imports only the idle wait sentence from
 * locales/prompts; generate/, scope/ and apply/ import it.
 */
import { IDLE_INBOX_WAIT } from './prompts'

/** Every generated-file text and template by its name (D-221). Object.freeze keeps each literal type. */
export const ARTIFACT = Object.freeze({
  // ROLE.md (generate/docs roleMdText): its lines in file order.
  roleMdTitle: '# {title} (cadre role {id})',
  roleMdModel: 'Model: {model} + {effort}.',
  roleMdFramework: 'Framework: {framework}. {model} Permission mode: {mode}.',
  roleMdAttended:
    'Attended: this role needs a person for some framework steps; the Attended rules under Scope say which.',
  roleMdHowYouWork: '## How you work',
  roleMdPlanningDocs: '## Planning docs',
  roleMdPlanningIntro:
    'Keep your own planning docs and state, so you load only the context of your task. Start your planning so:',
  roleMdPlanningPick: `The framework your task names in its use: field picks the group; without one, take the first ${
    ''}group, your own framework.`,
  roleMdPlanningGroup: '{framework} (use: {id}):',
  roleMdPlanningStep: '- {step}',
  roleMdDecisions: '## Decisions',
  roleMdChainLine: '- {line}',
  roleMdHandoffs: '## Handoffs',
  roleMdHandoffLine: "Write every handoff under thoughts/shared/handoffs/{id}/ (autopilot's handoff path).",
  roleMdInbox: '## Inbox',
  roleMdInboxLine: `Your inbox lives in your user config folder, outside the repo, and only the cadre inbox tools ${
    ''}write it. Read it with inbox_read when you start, after every restart and when a wait ends.`,
  roleMdInboxIdle: IDLE_INBOX_WAIT,
  roleMdNoteLine: 'Send a message to another role with inbox_send (the role ids are in .cadre/INDEX.md).',
  roleMdInboxStates: `Each new entry is unread. Mark it with inbox_mark: read, awaiting (waitsFor: the id of the ${
    ''}entry you wait for), blocked (name what it waits on), rejected (with the reason; it goes back up) or done ${
    ''}(a one-line outcome). Never edit an inbox file by hand: only the cadre inbox tools write them.`,
  roleMdHierarchy: '## Hierarchy',
  roleMdHierarchyCommonQuestions: `A technical question goes to your parent role and TL decides it; a product or ${
    ''}ticket question goes straight to PM. Send each with inbox_send kind question.`,
  roleMdHierarchyCommonAsk: 'In an epic, only PM asks the user; every other role sends its question up.',
  roleMdHierarchyAskUser:
    'Outside an epic you start with --ask-user: ask the person your critical questions yourself with AskUserQuestion.',
  roleMdCoreAskUser: 'Outside an epic you start with --ask-user: ask the person yourself with AskUserQuestion.',
  roleMdCoreEpicAsk: `In an epic you start with --ask-user too: ask the person with AskUserQuestion while they are ${
    ''}here and with queue_question while they are away.`,
  roleMdCoreEpicNoAsk: `In an epic you start without --ask-user: send what only a person can do or decide (start a ${
    ''}service, accept a risk) to TL as a question, and TL asks the person.`,
  roleMdCoreTlAsk: `Ask the person about architecture and high-level decisions, and about what an implementer sends ${
    ''}you that only a person can do or decide.`,
  roleMdCoreSecurityAsk: 'Ask the person when a matter is unclear or a risk must be accepted that TL cannot accept.',
  roleMdHierarchyCommonRejected:
    'An entry you mark rejected goes back up to the role that sent it, with your reason.',
  roleMdHierarchyCommonEpicEnd: `On epic-end, mark your open inbox entries, write your handoff and answer with a line ${
    ''}that starts with AUTOPILOT_DONE; PM does this last.`,
  roleMdPmGrill: `As PM, grill the user on the epic and on every ticket in one attended run until no question is ${
    ''}open. Use mattpocock-skills:grilling for it when that skill is available.`,
  roleMdPmGrillNoSkill: `When it is not available (its plugin was declined or did not install), run the grill ${
    ''}yourself with the same rules.`,
  roleMdPmGrillRounds: `Ask each round with AskUserQuestion: the whole open frontier per round, up to 4 questions per ${
    ''}call with 2-4 options each, the recommended option first; split a larger round over several calls.`,
  roleMdPmGrillDone: 'The grill is done when no question is open and the user confirms.',
  roleMdPmGrillText: `When AskUserQuestion is unavailable or dismissed, or the user said not to use it, write the ${
    ''}question as text and call wait_for with reason user-answer.`,
  roleMdPmGrillMode: `Then propose a planning mode from those your epic brief offers, and do not move on before ${
    ''}the user confirms it.`,
  roleMdPmGrillRecord:
    "Record each ticket's outcome and any size the user pins on it, in the brief and in your handoff.",
  roleMdPmGrillFeed: `Send TL the brief, then feed it one ticket at a time (in a team without TL, your roles); when ${
    ''}every ticket is reported, send epic-end.`,
  roleMdPmGrillCritical: 'After the grill, ask the user only critical questions.',
  roleMdCorePmIntro: `As PM you fetch the work, grill the user, brief TL, feed it the tickets and accept the ${
    ''}reports; you do not plan, build or verify code.`,
  roleMdCorePmFetch: 'Fetch: get the epic and its tickets with your tracker MCP.',
  roleMdCorePmGrillStep: 'Grill: grill the user on the epic and every ticket, as the Hierarchy section says.',
  roleMdCorePmBrief:
    'Brief: send TL the brief with the planning mode the user confirmed (your roles in a team without TL).',
  roleMdCorePmFeed: 'Feed: send TL one ticket at a time with its key, your scope and risk scores and the report form.',
  roleMdCorePmAccept: "Accept: check each report against the ticket's acceptance criteria, then feed the next ticket.",
  roleMdCorePmDeps: `Before the grill, resolve every dependency a ticket names (linked tickets, spikes, docs) in the ${
    ''}tracker and the repo, and put what you find into the grill.`,
  roleMdCorePmFacts: `For code facts, send TL a question (inbox_send kind question) and keep those grill branches ${
    ''}open until TL answers.`,
  roleMdCorePmNotFound: `Report a fact you could not find as "not found by me (searched X)", naming where you ${
    ''}searched; never as "not in the repo".`,
  roleMdCorePmOutcomes: `State what must be true (acceptance criteria, behaviour, scope); leave code structure, tests ${
    ''}and review routing to TL.`,
  roleMdCorePmReportForm:
    'In the report form, ask for verification as a summary, with the details in the docs named in docPaths.',
  roleMdCorePmAsk: `Make no product decision without the user: send a product question to the user (AskUserQuestion ${
    ''}while they are here, queue_question while they are away) whenever its answer changes or narrows an ${
    ''}acceptance criterion, a user-visible flow or a decision the user made, or picks between real alternatives.`,
  roleMdCorePmDecideAlone: `Decide alone only when the answer follows directly from a grill answer, and log which ${
    ''}grill answer it follows from.`,
  roleMdTlLoop: `Your ticket loop as TL: on each ticket PM sends, add complexity and effort to PM's scope and ${
    ''}risk, compute the size and pick the framework or GSD path; record the vector with a one-line reason.`,
  roleMdTlPlan: 'Plan the ticket in your own planning docs.',
  roleMdCoreTlFed: `Work only on the ticket PM fed, and answer PM's code-fact questions during the grill; do no ${
    ''}research on later tickets.`,
  roleMdCoreTlBrief: `Send each implementer a brief, not a plan: the goal, the acceptance criteria, your ${
    ''}architecture decisions with their reasons, the areas at risk, what is out of scope, the report form and what ${
    ''}must be proven. Leave out method signatures, spec bodies and commands.`,
  roleMdCoreTlHold: 'Do not dispatch the part of a task an open product question affects.',
  roleMdCoreTlTrust: `Trust the implementer's report: read the diff for architecture and scope fit, and do not ${
    ''}re-run the checks it lists as run.`,
  roleMdCoreTlFailed: `On a failed or partial report, decide on the implementer's proposed answer; dig deeper only ${
    ''}when that answer does not hold.`,
  roleMdCoreTlQa: `Once the implementer reports, send QA a verify task (inbox_send kind task): QA runs the specs and ${
    ''}checks and reports.`,
  roleMdCoreTlSecurity: `When the implementers and QA have reported a ticket done, send Security the ticket ${
    ''}(inbox_send kind task); Security reviews the whole change and decides itself what is risky.`,
  roleMdCoreTlSecurityNoQa: `When the implementers have reported a ticket done, send Security the ticket ${
    ''}(inbox_send kind task); Security reviews the whole change and decides itself what is risky.`,
  roleMdCoreTlFindings:
    'Security reports every finding to you with its severity; you decide which ones to raise with the person.',
  roleMdCoreTlWait: `Wait for a report with wait_for reason session-answer and a timeout, and for your own ${
    ''}subagents with reason subagent-result and a timeout; with nothing to wait for, use reason idle-inbox and no ${
    ''}timeout.`,
  roleMdCoreTlReport: `Wait for the implementer's report and the QA and Security reports you asked for, then report ${
    ''}to PM in the form PM asked (by default: outcome, changes, verification, the vector with its reason, the ${
    ''}framework used, the doc paths and the open questions) and wait for the next ticket.`,
  roleMdTlTasks: `Send BE and FE their tasks in parallel (inbox_send kind task), split by area; a file both ${
    ''}would touch is yours to serialise.`,
  roleMdTlReport: `Wait for every report, then report to PM in the form PM asked (by default: outcome, changes, ${
    ''}verification, the vector with its reason, the framework used, the doc paths and the open questions) and ${
    ''}wait for the next ticket.`,
  roleMdWorkerTask: 'Plan and execute each task in your own planning docs.',
  roleMdWorkerCommit: `Commit only your own files on the epic branch: git add <paths>, never git add -A. When git ${
    ''}reports an index lock, wait and retry; never rebase or reset the shared branch.`,
  roleMdWorkerReport:
    'Report each task to TL when it is done (to PM in a team without TL), then wait for the next.',
  roleMdWorkerNoTl: `In a team without TL, PM sends you the ticket: add complexity and effort to its scope and risk ${
    ''}yourself, and take the no-TL step of Planning docs when it has one.`,
  roleMdCoreWorkerPlan: `Plan each task yourself from TL's brief (the brief is not a plan), do it, and run the repo's ${
    ''}specs, lint and checks with the commands you know.`,
  roleMdCoreWorkerBlocked: `When a check fails or cannot run (a service is down, the environment blocks it), study it ${
    ''}and send TL a question at once with your analysis and a proposed answer (PM in a team without TL); do not ${
    ''}hold it to the end of the task.`,
  roleMdCoreWorkerReport: `Report each task to TL when it is done (to PM in a team without TL), then wait for the ${
    ''}next; report a task whose checks did not run as partial, never as complete.`,
  roleMdCoreSecurityReview:
    'When TL sends you a ticket, review its whole change and decide yourself what in it is risky.',
  roleMdCoreSecurityReport: `Report every finding to TL with its severity (to PM in a team without TL): a blocking ${
    ''}one at once, the rest when the review is done; then wait for the next ticket.`,
  roleMdSizing: '## Sizing',
  roleMdSizeVector: `A ticket's size is a vector of four scores, each from 0.1 to 1.0: scope, complexity, risk and ${
    ''}effort. PM scores scope and risk; TL adds complexity and effort (in a team without TL, the role PM sends ${
    ''}the ticket to).`,
  roleMdSizeRule:
    'The size is the highest of the four; the ticket is large at or over sizing.threshold in {state}, else small.',
  roleMdSizeRubric: 'Score each dimension against the anchors in {rubric}.',
  roleMdSizePin: 'A size the user pins on a ticket overrides the computed class.',
  roleMdScope: '## Scope',
  // The marker above a part in a built role file (generate/docs partMarker), and the first line of the built and of
  // the private role CLAUDE.md (generate/docs roleClaudeMdText, apply/private privateClaudeMdText).
  partMarker: '<!-- from {file} > {heading} -->',
  roleClaudeMdHeader: `<!-- cadre: instructions for role {id}, built from this repo's CLAUDE.md files, ${
    ''}rules and docs. Edit the originals and run /cadre regen {id}; this file is rebuilt. -->`,
  privateClaudeMdHeader: `<!-- cadre: your global instructions for role {id} in {repo}, ${
    ''}built from your global CLAUDE.md, its imports and the CLAUDE.md files above the repo. ${
    ''}Private to you, never committed; rebuilt by /cadre init and /cadre regen. -->`,
  // INDEX.md (generate/docs indexMdText): the lines above the rows, then a row's cells.
  indexTitle: '# cadre roles',
  indexNote: 'Generated by cadre from the role definitions. Edit .cadre/<id>/role.json and run /cadre regen <id>.',
  indexColumns: '| Role | Purpose | Framework | Model | Scope | Launcher | Handoffs |',
  indexRule: '| --- | --- | --- | --- | --- | --- | --- |',
  indexRow: '| {cells} |',
  indexRoleCell: '{title} ({id})',
  indexModelCell: '{model} + {effort}',
  indexBash: 'sandboxed Bash',
  indexNoBash: 'no Bash',
  indexScope: '{bash}; MCP: {servers}; skills: {skills}',
  // The sizing rubric `.cadre/sizing.md` (generate/docs rubricText): its title, how a size is scored, then the
  // anchors of each dimension.
  rubricTitle: '# cadre sizing rubric',
  rubricHow: `Score each dimension of a ticket from 0.1 to 1.0 against its anchors. The size of a ticket is the ${
    ''}highest of its four scores; it is large at or over sizing.threshold in .cadre/cadre.json.`,
  rubricWho:
    'PM scores scope and risk from the acceptance criteria; the role that plans the ticket adds complexity and effort.',
  rubricEdit: 'Edit the anchors to fit this repo: cadre writes this file only when it is missing.',
  rubricScope: '## scope: how much of the codebase the ticket touches',
  rubricScopeLow: '- 0.2: one module',
  rubricScopeMid: '- 0.5: several modules on one side (BE or FE)',
  rubricScopeHigh: '- 0.9: BE, FE and infra together',
  rubricComplexity: '## complexity: the design unknowns',
  rubricComplexityLow: '- 0.2: a clear change',
  rubricComplexityMid: '- 0.5: a change with open design questions',
  rubricComplexityHigh: '- 0.9: a new data model or a new integration',
  rubricRisk: '## risk: the blast radius',
  rubricRiskLow: '- 0.2: isolated and easy to revert',
  rubricRiskMid: '- 0.5: a path other features share',
  rubricRiskHigh: '- 0.9: auth, payments or migrations',
  rubricEffort: '## effort: the work volume',
  rubricEffortLow: '- 0.2: minutes',
  rubricEffortMid: '- 0.5: hours',
  rubricEffortHigh: '- 0.9: days',
  // The scope card rules (scope/card rulesFor), in card order.
  cardBypass: 'WARNING: bypassPermissions is set in role.json: permission prompts are skipped',
  cardPlugins: 'Plugins: only {plugins} load (--setting-sources project whitelist)',
  cardNoBash: 'No Bash tool (denied)',
  cardSandbox: `Bash runs in the sandbox (hard on macOS, best-effort on Linux) and may write ~/.cache, which tools ${
    ''}run outside the sandbox load from`,
  cardDocker: 'These run outside the sandbox: {commands}. Run each one alone, with no cd, pipe or redirect.',
  cardDeniedDirs: 'Reads and edits under {dirs} are denied; the patterns match at any depth',
  cardOwnDirs: 'Reads and edits under {dirs} are never denied (own folders)',
  cardSkippedDirs: `Reads and edits under {dirs} are not denied in the committed template: ${
    ''}those names match the role's own folders at any depth (exact denies are rendered at launch)`,
  cardUnusualDir: 'code dir {dir} has an unusual name and is not denied',
  cardSecrets: 'Reads of .env, .env.*, ~/.ssh and ~/.aws are denied',
  cardSecretsSandbox: `Reads of .env, .env.*, ~/.ssh and ~/.aws are denied, Bash commands included through the ${
    ''}sandbox; a command run outside the sandbox is not stopped`,
  cardSecretsChecks: `Reads of .env, .env.*, ~/.ssh and ~/.aws are denied, Bash commands included through the ${
    ''}sandbox, except the env files git tracks, which Bash commands may read; a command run outside the sandbox is ${
    ''}not stopped`,
  cardNoMcpToDeny: 'No other scanned MCP servers to deny',
  cardDeniedMcp: 'Scanned MCP servers not given are denied: {servers}',
  cardMcpReachable: 'Denied servers: tools removed and the whole server denied (deniedMcpServers; best-effort)',
  cardUnusualMcp: 'MCP server {name} shares its tool name with a server this role has and is not denied',
  cardRefused: '{pattern} was not emitted: {message}',
  cardPartialMcp:
    'MCP servers the scan could not see, such as unusual names or ~/.claude.json without consent, are not denied',
  cardSkills: 'Skills: only the listed skills are linked',
  cardLoads: `Loads .cadre/{id}/CLAUDE.md and its private instructions ${
    ''}(<config dir>/cadre/<repo>-<hash8>/{id}/instructions/)`,
  cardInfra: 'Autopilot, agent-fleet and the handoff skills are always available',
  cardInbox: 'Edit and Write of every inbox.jsonl and session.json are denied; only the cadre inbox tools write them',
  cardHeldMessages: 'Live messages may be held in this permission mode; the inbox is the record',
  cardPermissionMode: 'Permission mode: {mode}',
  cardAttendedSteps: 'Attended: this role needs a person for framework steps that cannot run unattended',
  cardAttendedGsd: 'Attended: GSD workflows need Bash; this role runs them through a person',
  cardAttendedAsk: 'Attended: started with --ask-user, so framework menus reach the person while asking is on',
  cardProjectMonitor: `WARNING: {script} is registered in project settings and loads in every role; ${
    ''}it conflicts with the autopilot handoff (D-62)`,
  cardStartDir: '<git root>/{path}',
  cardStartHere: 'the folder the launcher is run from',
  cardNoProjectSettings:
    'project settings (<git root>/.claude/settings.json) do not load: the session starts in {folder}',
  cardStartSettingsDir: '{folder}/.claude/settings.json loads: its hooks run and its permission rules apply',
  cardStartSettingsHere:
    '.claude/settings.json of the folder the launcher is run from loads: its hooks run and its permission rules apply',
  cardHereSettingsWritable: `.claude/settings.json and .claude/settings.local.json of the folder the launcher is ${
    ''}run from are not write-protected: a role that can edit there can change what the next launch loads`,
  cardHerePlugins:
    'plugins that .claude/settings.json of the folder the launcher is run from enables are not switched off',
  cardStartSettingsKeys: `WARNING: {folder}/.claude/settings.json sets {keys}, which cadre does not scan; ${
    ''}the folder's own .claude/skills, .claude/agents and .claude/commands also load unscanned`,
  cardStartSettingsWritable: `{folder}/.claude/settings.json, settings.local.json and its framework install folders ${
    ''}are not write-protected: no permission rule can hold the path, so a role that can edit there can change what ${
    ''}the next launch loads`,
  cardAdditionalDir: 'Additional directory: <git root> (start folder is {folder})',
  cardHandoffsFollow: 'Handoffs ({handoffs}) and GSD .planning/ follow the start folder ({folder})',
  cardRouteStrict: 'MCP route: strict (--strict-mcp-config)',
  cardRouteMerged: 'MCP route: merged (no --strict-mcp-config, so /fleet works; MCP denies are best-effort)',
  // The words of a scope card or INDEX.md list (scope/card CARD_LIST_WORDS): an empty list, and the last item of a
  // capped list.
  cardNone: 'none',
  cardUnknown: 'unknown',
  cardMore: '+{count} more',
  // The lines of a scope card (scope/card scopeCardLines), as ROLE.md holds it and init shows it.
  cardTitle: 'Scope card: {title} ({id})',
  cardFramework: '  framework: {framework}; model: {model} + {effort}; permission mode: {mode}',
  cardAlsoRuns: '  also runs: {frameworks}',
  cardSkillsLine: '  skills: {skills}',
  cardMcpLine: '  MCP servers: {servers}',
  cardNotGivenSkills: '  not given skills: {skills}',
  cardCallDenied: '  denied at call time ({plugin}, {count} skills): {skills}',
  cardNotGivenMcp: '  not given MCP: {servers}',
  cardHooksLoaded: '  hooks loaded: {hooks}',
  cardHooksByProject: '  hooks loaded by project settings: {hooks}',
  cardHooksNotLoaded: '  hooks not loaded: {hooks}',
  cardRules: '  rules:',
  cardRule: '    [{enforcement}] {text}',
  cardDecisions: '  decisions:',
  cardDecision: '    {line}',
  cardMemory: '  memory: {pattern} (rendered at launch; <config dir> is CLAUDE_CONFIG_DIR, else ~/.claude)',
  // The messages and refusals of a launcher (generate/launcher), and the two comment lines that start it.
  launcherHead: '# cadre launcher for role {id}: checks claude and .cadre/{id}/.runtime/, then starts the session.',
  launcherHeadNote: `# /cadre start {id} renders .cadre/{id}/.runtime/ in the root session of the repo; ${
    ''}this script never renders it.`,
  launcherOutside: 'cadre: run .cadre/bin/{id} from a folder of its repo',
  launcherRuntime: 'cadre: .cadre/{id}/.runtime/{problem}: run /cadre start {id}',
  launcherProbeInventory: 'cadre: the probe startup inventory does not hold one tools, skills and slash_commands list',
  launcherProbeName: 'cadre: the probe startup inventory holds a name the launcher cannot read',
  launcherNoInventory: 'cadre: the probe run gave no startup inventory',
  launcherNoRule: '{file} gave no rule',
  launcherUsage: 'cadre: usage: .cadre/bin/{id} [--probe]',
  launcherForeign: 'cadre: not the repo of role {id}',
  launcherMissing: 'cadre: .cadre/{id}/ROLE.md or kickoff.txt is missing: run /cadre regen {id}',
  launcherUnrendered: '{message} in the root session of the repo',
  launcherNotRendered: ' is not rendered',
  launcherEmpty: 'settings.json or mcp.json is missing or empty',
  launcherInvalid: ' holds a file that is not valid JSON',
  launcherNeedsClaude: 'cadre: needs claude {version} or newer on PATH (see claude --version)',
  launcherOlder: ' is older than the role files',
  launcherNoJsonCheck: 'cadre: (JSON not re-checked: no jq or node)',
  launcherExpectationsMissing: '{file} is missing',
  // roles/template.ts
  templatePmPurpose: 'Owns product decisions: scope, requirements and acceptance.',
  templateTlTitle: 'Team Lead',
  templateTlPurpose: 'Owns architecture and high-level decisions; briefs the implementers.',
  templateBePurpose: 'Implements the backend and core code.',
  templateFePurpose: 'Implements the frontend.',
  templateQaPurpose: 'Owns tests and end-to-end checks.',
  templateSecurityTitle: 'Security',
  templateSecurityPurpose: 'Owns security decisions and reviews.',
  chainHumanFallback: 'human (queue_question)',
  chainLine: '{decision}: {decisionChain}',
  // framework/gsd/adapter.ts
  gsdGateMenusWhere: 'AskUserQuestion menus inside GSD workflows',
  gsdGateMenus:
    `While asking is on and the person is not away, a GSD menu reaches them as an AskUserQuestion dialog; ${
    ''}while they are away or asking is off, autopilot answers it with "decide yourself": take the recommended ${
    ''}option and log it in decisions.md.`,
  gsdGateTextModeWhere: '.planning/config.json workflow.text_mode',
  gsdGateTextMode: 'Needs workflow.text_mode false (an autonomy setting); with it true the role is attended.',
  gsdGateUat: 'Do not run /gsd-verify-work. Send human UAT as a QA decision to TL, which queues it for the human.',
  gsdGateThreats:
    'Answer "Verify all open threats"; never accept a risk: accepting risk is always queued for the human.',
  gsdGateBlockerWhere: 'STATE.md "Needs Human" blocker',
  gsdGateBlocker:
    `Route the blocker by its content, by default as an Arch decision to TL; TL decides reversible calls ${
    ''}and queues the rest for the human.`,
  gsdGateShipWhere: '/gsd-ship, branch finish, merge or PR',
  gsdGateShip:
    `Never merge, push or release. Hand the finished branch to TL as an Arch decision; merge, push and ${
    ''}release are always queued for the human.`,
  gsdGateScopeWhere: 'scope or acceptance questions in discuss and plan',
  gsdGateScope: 'Send scope or acceptance questions as a Product decision to PM.',
  gsdDoneLine:
    'When the phase VERIFICATION.md has status: passed, answer with a line that starts with AUTOPILOT_DONE.',
  gsdApprovedSpec: 'Approved spec: {cleaned}',
  gsdKickoffIntro: 'You are the {title} role. This repo uses GSD: drive the work with its own commands.',
  gsdKickoffStart:
    `Start: /gsd-autonomous --only N for the phase you own, or step by step /gsd-discuss-phase N --auto, ${
    ''}/gsd-plan-phase N --auto, /gsd-execute-phase N.`,
  gsdKickoffNewProject: `A checkout with no .planning/ starts with /gsd-new-project (no .planning/ yet); your ${
    ''}Planning docs steps say whether you run it.`,
  gsdKickoffSpecs: 'Specs and plans live under .planning/phases/<NN-slug>/.',
  gsdKickoffVerify: 'Verify with /gsd-validate-phase N and /gsd-code-review N.',
  gsdHumanGates: 'Human gates:',
  gsdGateLine: '- {where}: {kickoff}',
  gsdStepNewProject:
    `If this checkout has no .planning/ yet, run /gsd-new-project here first; its menus go to the person while ${
    ''}asking is on and they are not away, else decide them yourself.`,
  gsdStepNewProjectNoLead:
    `If your team has no TL and this checkout has no .planning/ yet, run /gsd-new-project here first (its menus ${
    ''}go to the person while asking is on and they are not away, else decide them yourself); a checkout that has ${
    ''}.planning/ skips this.`,
  gsdStepWorkstream:
    `Create your own workstream with GSD's own tool through its resolver: workstream.create "$GSD_WORKSTREAM" ${
    ''}--no-migrate (a re-run reports that it exists).`,
  gsdStepMilestoneLead:
    `If your workstream has no ROADMAP.md, run /gsd-new-milestone in it with the epic as the milestone ${
    ''}(GSD-epic mode); its menus go to the person while asking is on and they are not away, else decide them ${
    ''}yourself.`,
  gsdStepMilestoneWorker:
    `If your workstream has no ROADMAP.md, run /gsd-new-milestone in it with TL's task as the milestone goal; ${
    ''}its menus go to the person while asking is on and they are not away, else decide them yourself.`,
  gsdStepPath:
    `Then take a small ticket through /gsd-quick, and a large one through /gsd-phase add, /gsd-plan-phase and ${
    ''}/gsd-execute-phase.`,
  // framework/superpowers/adapter.ts
  spGateBrainstormWhere: 'superpowers:brainstorming hard gate',
  spGateBrainstorm:
    `With a TL-approved spec, start at superpowers:writing-plans; the spec is the standing approval. A ${
    ''}new design question goes to TL as an Arch decision.`,
  spGatePlansWhere: 'superpowers:writing-plans execution choice',
  spGatePlans: 'The execution method is already chosen: subagent-driven.',
  spGateFinishWhere: 'superpowers:finishing-a-development-branch menu',
  spGateFinish: 'Choose "keep as-is". TL owns merge and PR; merge and push are always queued for the human.',
  spGateSecurityWhere: 'superpowers:subagent-driven-development security-sensitive stop',
  spGateSecurity:
    'Stop the step and send it to Security as a Security decision; accepting a risk is always queued for the human.',
  spGateOutwardWhere: 'superpowers:subagent-driven-development irreversible or outward stop',
  spGateOutward:
    `Stop the step and send it to TL as an Arch decision; irreversible or outward actions are always ${
    ''}queued for the human.`,
  spGateWorktreeWhere: 'superpowers:using-git-worktrees consent',
  spGateWorktree: 'You are already in your epic worktree: do not create another worktree.',
  spGateMainWhere: 'superpowers:subagent-driven-development main-branch consent',
  spGateMain: 'Work on the current epic branch; never implement on main or master.',
  spGateQuestionsWhere: 'superpowers:brainstorming clarifying questions',
  spGateQuestions: 'Send scope or acceptance questions as a Product decision to PM.',
  spDoneLine:
    `When every task in .superpowers/sdd/<plan workspace>/progress.md has a "Task <N>: complete" line, ${
    ''}answer with a line that starts with AUTOPILOT_DONE.`,
  spSpecStart: 'Start: superpowers:writing-plans with that spec.',
  spNoSpecStart:
    'Start: superpowers:brainstorming (TL/PM), or superpowers:writing-plans <spec path> once TL gives you a spec.',
  spApprovedSpec: 'Approved spec (standing approval from TL): {cleaned}',
  spKickoffIntro: 'You are the {kickoffTitle} role. This repo uses superpowers: follow its skills.',
  spKickoffMethod: 'Execution method: subagent-driven.',
  spKickoffNoQuestion:
    `Never end a turn with a question in chat: autopilot pauses after 2 turns with no tool call. Send ${
    ''}questions to their owner role instead.`,
  spHumanGates: 'Human gates:',
  spGateLine: '- {where}: {kickoff}',
  spStepSpec: 'Write the spec to docs/superpowers/specs/tl-<ticket>.md, then write your own plan from it.',
  spStepPlan:
    `Write your plan with superpowers:writing-plans; your plan location preference is ${
    ''}docs/superpowers/plans/{roleId}-<ticket>.md.`,
  spStepMethod:
    'Execute your plan with superpowers:subagent-driven-development; never ask which execution method to use.',
  // framework/none/adapter.ts
  builtinGateExitWhere: 'ExitPlanMode',
  builtinGateExit: 'Never call ExitPlanMode (it waits for a human); write the plan file instead.',
  builtinGateQuestionWhere: 'any open question',
  builtinGateQuestion:
    `Send each question to its owner role by type (Product to PM, Arch and QA to TL, Security to ${
    ''}Security); do not ask the human directly.`,
  builtinGateQuestionAsk:
    `Send each question to its owner role by type (Product to PM, Arch and QA to TL, Security to ${
    ''}Security); ask the person only as your Hierarchy section says.`,
  builtinSpec: 'Spec: {cleaned}',
  builtinDoneLine:
    `Write .cadre/{folder}/.runtime/DONE.md with what you did and how you verified it, then answer with ${
    ''}a line that starts with AUTOPILOT_DONE.`,
  builtinKickoffIntro:
    'You are the {title} role. This repo has no dev framework: work in plan, execute, verify steps.',
  builtinKickoffIntroLead:
    `You are the {title} role. This repo has no dev framework: work each ticket PM feeds as your Hierarchy ${
    ''}section says.`,
  builtinKickoffIntroReviewer:
    `You are the {title} role. This repo has no dev framework: review each ticket TL sends you as your Hierarchy ${
    ''}section says.`,
  builtinKickoffPlan: 'Write your plan to .cadre/{folder}/.runtime/plan.md, then execute it with subagents.',
  builtinKickoffVerify: "Verify with the project's own test and lint commands and a reviewer subagent.",
  builtinHumanGates: 'Human gates:',
  builtinGateLine: '- {where}: {kickoff}',
  // scope/lint.ts
  lintSingleSlash: 'single leading / matches nothing',
  lintAbsolute: 'absolute // patterns belong only in .runtime (D-84)',
  lintInfra: 'would block an infra tool',
}) satisfies Record<string, string>
