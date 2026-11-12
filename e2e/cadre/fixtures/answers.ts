export type DialogAnswer = string | { readonly other: string } | 'dismiss'

export type DialogEntry = {
  readonly question: string
  readonly answer: DialogAnswer
  readonly repeat?: true
}

export type LaunchAnswer = 'git-root' | 'here' | 'dir'

export type McpHandOut = {
  readonly server: string
  readonly role: string
}

// Keep the GSD a repo has, add GSD to a repo that has superpowers (every role but PM then runs it), or choose none.
export type FrameworkAnswer = 'keep-gsd' | 'add-gsd' | 'none'

export type InitScriptOptions = {
  readonly policy: string
  readonly launch: LaunchAnswer
  readonly framework?: FrameworkAnswer
  // Accept the two required GSD config hunks (mode, workflow.text_mode) instead of declining them.
  readonly acceptHunks?: true
  // Consent to read ~/.claude.json and give one server to one role; absent, the consent is declined.
  readonly mcp?: McpHandOut
  // Install every plugin offered (the security plugins and the grill plugin) instead of declining the offers.
  readonly installs?: true
}

export const MCP_SERVER = 'e2e-echo'
export const MCP_ROLE = 'be'

const POLICY_QUESTION = 'Git policy for .cadre/?'
const LAUNCH_QUESTION = 'Where should the role launchers start their sessions?'
const LAUNCH_DIR_QUESTION = 'Type the folder the launchers start in'
const LAUNCH_DIR = 'src'
// The question of every plugin skill group and of the own skills handed out as one group: `Which roles get <label>
// skills (<count>)?`. A repeat entry stays available after it answers, since the groups depend on the environment.
const SKILL_GROUP_QUESTION = ' skills ('
const ACCEPT = 'Accept'
const DECLINE = 'Decline'
const INSTALL_YES = 'Yes, install it'
const FRAMEWORK_INSTALL_QUESTION = 'Install GSD for this repo?'
const FRAMEWORK_MODE_QUESTION = 'Which framework do the roles use?'
const FRAMEWORK_ALL_QUESTION = 'Framework for all roles?'
const SECURITY_QUESTION = 'Install from claude-plugins-official after you confirm the plan'
const GRILL_QUESTION = 'Install mattpocock-skills'
const GSD_CHECK_ENTRY: DialogEntry = { question: `Run GSD's own check`, answer: 'No, skip the check' }

// The first lines of the questions that end the init flow and the frameworks flow.
export const INIT_REVIEW_QUESTION = 'Review the plan shown in the cadre init pane'
export const REFRAME_REVIEW_QUESTION = 'Review the framework changes'
// The Keep mine or Take new question init asks after Confirm for each file changed outside cadre.
export const CONFLICT_QUESTION = 'was changed outside cadre. Keep your version, or take the new one'
export const FRAMEWORK_SET_QUESTION = 'Which frameworks does this team use?'

// The dialog wraps the label `Commit definitions (default)` in its narrow option column: the answer is a prefix.
export const POLICY_DEFINITIONS = 'Commit definitions'
export const POLICY_IGNORE_ALL = 'Ignore all of .cadre/'

// Haiku is not among the offered pairs, so the typed pair is the answer; every init script holds these two entries.
export const MODEL_ENTRIES: readonly DialogEntry[] = [
  { question: 'Model and effort: same for all roles, or per role?', answer: 'Same for all roles' },
  { question: 'Model and effort for all roles?', answer: { other: 'haiku + medium' } },
]

// Adding GSD to a repo with superpowers leaves two frameworks in use, so the roles are asked once: all on GSD.
const FRAMEWORK_ENTRIES: Readonly<Record<FrameworkAnswer, readonly DialogEntry[]>> = {
  'keep-gsd': [{ question: FRAMEWORK_SET_QUESTION, answer: 'Keep GSD' }],
  'add-gsd': [
    { question: FRAMEWORK_SET_QUESTION, answer: 'Add GSD too' },
    { question: FRAMEWORK_INSTALL_QUESTION, answer: INSTALL_YES },
    { question: FRAMEWORK_MODE_QUESTION, answer: 'Same for all roles' },
    { question: FRAMEWORK_ALL_QUESTION, answer: 'GSD' },
  ],
  none: [{ question: FRAMEWORK_SET_QUESTION, answer: 'None (built-in)' }],
}

const LAUNCH_ENTRIES: Readonly<Record<LaunchAnswer, readonly DialogEntry[]>> = {
  'git-root': [{ question: LAUNCH_QUESTION, answer: 'Git root of this repo' }],
  here: [{ question: LAUNCH_QUESTION, answer: 'The folder I run it from' }],
  dir: [
    { question: LAUNCH_QUESTION, answer: 'Another folder' },
    { question: LAUNCH_DIR_QUESTION, answer: { other: LAUNCH_DIR } },
  ],
}

const MCP_CONSENT_QUESTION = 'Read ~/.claude.json for MCP server names?'
const MCP_ENTRY_QUESTION = 'Which roles get the MCP servers ('
const MCP_WHOLE_QUESTION = 'Which roles get all the MCP servers ('
// The question that asks one server on its own: `Which roles get the <name> MCP server? (e.g. BE, QA, or none)`.
const MCP_ONE_QUESTION = ' MCP server? (e.g.'

// Servers the scan finds without a hand-out, such as the account's claude.ai connectors, are declined one by one by
// the repeat entry, so only the named server goes to the named role.
function mcpEntries(hand: McpHandOut | undefined): readonly DialogEntry[] {
  if (hand === undefined) {
    return [
      { question: MCP_ENTRY_QUESTION, answer: 'Whole group' },
      { question: MCP_WHOLE_QUESTION, answer: 'None' },
    ]
  }

  return [
    { question: MCP_ENTRY_QUESTION, answer: 'Go one by one' },
    { question: `Which roles get the ${hand.server} MCP server?`, answer: { other: hand.role } },
    { question: MCP_ONE_QUESTION, answer: 'No', repeat: true },
  ]
}

// Each GSD hunk question is `<file>: <dotted key>`.
export const HUNK_QUESTION_PREFIX = '.planning/config.json: '
export const MODE_HUNK_QUESTION = `${HUNK_QUESTION_PREFIX}mode`

// The two GSD hunks that autonomy requires take `required`; the optional third is always declined.
function hunkEntries(required: string): readonly DialogEntry[] {
  return [
    { question: MODE_HUNK_QUESTION, answer: required },
    { question: `${HUNK_QUESTION_PREFIX}workflow.text_mode`, answer: required },
    { question: `${HUNK_QUESTION_PREFIX}hooks.context_warnings`, answer: DECLINE },
  ]
}

// The questions in the order the init flow asks them. An entry whose question never comes up is skipped, so the
// questions an environment may or may not raise sit here with the answer that hands out and installs nothing.
// The skill group entry stays behind the own-skills entry, so the own-skills question is answered by its own entry.
export function initScript(opts: InitScriptOptions): readonly DialogEntry[] {
  const isInstalling = opts.installs === true

  return [
    { question: MCP_CONSENT_QUESTION, answer: opts.mcp === undefined ? 'No, skip it' : 'Yes, read names only' },
    { question: `Scan this repo's session history`, answer: 'No, skip it' },
    { question: 'Use these roles?', answer: 'Use these roles' },
    GSD_CHECK_ENTRY,
    ...FRAMEWORK_ENTRIES[opts.framework ?? 'keep-gsd'],
    { question: SECURITY_QUESTION, answer: isInstalling ? 'Install' : 'Not now' },
    { question: 'Autopilot duration for roles?', answer: '4h' },
    ...MODEL_ENTRIES,
    ...mcpEntries(opts.mcp),
    { question: 'How do you want to hand out your own skills (', answer: 'Whole group' },
    { question: SKILL_GROUP_QUESTION, answer: 'None', repeat: true },
    { question: GRILL_QUESTION, answer: isInstalling ? INSTALL_YES : 'No' },
    { question: 'Read your CLAUDE.md files, rules and memories', answer: 'No, skip it' },
    { question: 'Which roles get your global', answer: 'None' },
    { question: 'Which roles get the auto-memories', answer: 'None' },
    { question: 'Which roles get the project CLAUDE.md', answer: 'None' },
    { question: 'Which env variables do roles carry?', answer: 'None' },
    ...hunkEntries(opts.acceptHunks === true ? ACCEPT : DECLINE),
    { question: POLICY_QUESTION, answer: opts.policy },
    ...LAUNCH_ENTRIES[opts.launch],
    { question: INIT_REVIEW_QUESTION, answer: 'Confirm' },
  ]
}

export const GSD_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'git-root' })
export const GSD_HERE_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'here' })
export const GSD_DIR_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'dir' })
export const GSD_IGNOREALL_SCRIPT = initScript({ policy: POLICY_IGNORE_ALL, launch: 'git-root' })
export const gsdAcceptHunk = initScript({ policy: POLICY_DEFINITIONS, launch: 'git-root', acceptHunks: true })
// cadre 0.5.0 asks the questions of a GSD repo in the same order: its locale and init stages differ from today's only
// in the framework question of a repo with no framework found.
export const V050_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'git-root' })
export const MCP_SCRIPT = initScript({
  policy: POLICY_DEFINITIONS,
  launch: 'git-root',
  mcp: { server: MCP_SERVER, role: MCP_ROLE },
})
// A repo with no framework found is not asked for one; the entry only keeps None if a flow ever asks.
export const NONE_TEAM_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'git-root', framework: 'none' })
// A superpowers repo that adds GSD, whose install the row has fail or do nothing.
export const SP_GSD_SCRIPT = initScript({ policy: POLICY_DEFINITIONS, launch: 'git-root', framework: 'add-gsd' })
// The same with every install offer answered Yes, for a --dry-run, which installs none of them.
export const SP_GSD_INSTALLS_SCRIPT = initScript({
  policy: POLICY_DEFINITIONS,
  launch: 'git-root',
  framework: 'add-gsd',
  installs: true,
})
// /cadre frameworks on a team with no framework found: add GSD, then the review of the changes.
export const FRAMEWORKS_ADD_GSD_SCRIPT: readonly DialogEntry[] = [
  GSD_CHECK_ENTRY,
  { question: FRAMEWORK_SET_QUESTION, answer: 'Add GSD' },
  { question: FRAMEWORK_INSTALL_QUESTION, answer: INSTALL_YES },
  ...hunkEntries(DECLINE),
  { question: REFRAME_REVIEW_QUESTION, answer: 'Confirm' },
]
// A superpowers repo that adds GSD and accepts only the first GSD hunk.
export const SP_GSD_FIRST_HUNK_SCRIPT: readonly DialogEntry[] = SP_GSD_SCRIPT.map(entry =>
  entry.question === MODE_HUNK_QUESTION ? { ...entry, answer: ACCEPT } : entry
)
// A re-init of a gsd team that keeps the person's version of any file changed outside cadre.
export const GSD_REINIT_KEEP_MINE_SCRIPT: readonly DialogEntry[] = [
  ...GSD_SCRIPT,
  { question: CONFLICT_QUESTION, answer: 'Keep mine', repeat: true },
]

function frameworksKeepGsd(install: string): readonly DialogEntry[] {
  return [
    GSD_CHECK_ENTRY,
    { question: FRAMEWORK_SET_QUESTION, answer: 'Keep GSD' },
    { question: FRAMEWORK_INSTALL_QUESTION, answer: install },
    ...hunkEntries(DECLINE),
    { question: REFRAME_REVIEW_QUESTION, answer: 'Confirm' },
  ]
}

// /cadre frameworks on a team where GSD is found: keep it, decline every hunk, Confirm; an install offer is declined.
export const FRAMEWORKS_KEEP_GSD_SCRIPT = frameworksKeepGsd('No')
// The same for a --dry-run, where an install offer is answered Yes, as a --dry-run must still install nothing.
export const FRAMEWORKS_KEEP_GSD_DRY_SCRIPT = frameworksKeepGsd(INSTALL_YES)
