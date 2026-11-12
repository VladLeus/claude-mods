export type DialogAnswer = string | { readonly other: string } | 'dismiss'

export type DialogEntry = {
  readonly question: string
  readonly answer: DialogAnswer
  readonly repeat?: true
}

export type LaunchAnswer = 'git-root' | 'here' | 'dir'

export type InitScriptOptions = {
  readonly policy: string
  readonly launch: LaunchAnswer
  // Accept the two required GSD config hunks (mode, workflow.text_mode) instead of declining them.
  readonly acceptHunks?: true
}

const POLICY_QUESTION = 'Git policy for .cadre/?'
const LAUNCH_QUESTION = 'Where should the role launchers start their sessions?'
const LAUNCH_DIR_QUESTION = 'Type the folder the launchers start in'
const LAUNCH_DIR = 'src'
// The question of every plugin skill group and of the own skills handed out as one group: `Which roles get <label>
// skills (<count>)?`. A repeat entry stays available after it answers, since the groups depend on the environment.
const SKILL_GROUP_QUESTION = ' skills ('
const ACCEPT = 'Accept'
const DECLINE = 'Decline'

// The dialog wraps the label `Commit definitions (default)` in its narrow option column: the answer is a prefix.
export const POLICY_DEFINITIONS = 'Commit definitions'
export const POLICY_IGNORE_ALL = 'Ignore all of .cadre/'

// Haiku is not among the offered pairs, so the typed pair is the answer; every init script holds these two entries.
export const MODEL_ENTRIES: readonly DialogEntry[] = [
  { question: 'Model and effort: same for all roles, or per role?', answer: 'Same for all roles' },
  { question: 'Model and effort for all roles?', answer: { other: 'haiku + medium' } },
]

const LAUNCH_ENTRIES: Readonly<Record<LaunchAnswer, readonly DialogEntry[]>> = {
  'git-root': [{ question: LAUNCH_QUESTION, answer: 'Git root of this repo' }],
  here: [{ question: LAUNCH_QUESTION, answer: 'The folder I run it from' }],
  dir: [
    { question: LAUNCH_QUESTION, answer: 'Another folder' },
    { question: LAUNCH_DIR_QUESTION, answer: { other: LAUNCH_DIR } },
  ],
}

// The questions in the order the init flow asks them. An entry whose question never comes up is skipped, so the
// questions an environment may or may not raise sit here with the answer that hands out and installs nothing.
// The skill group entry stays behind the own-skills entry, so the own-skills question is answered by its own entry.
export function initScript(opts: InitScriptOptions): readonly DialogEntry[] {
  const required = opts.acceptHunks === true ? ACCEPT : DECLINE

  return [
    { question: 'Read ~/.claude.json for MCP server names?', answer: 'No, skip it' },
    { question: `Scan this repo's session history`, answer: 'No, skip it' },
    { question: 'Use these roles?', answer: 'Use these roles' },
    { question: `Run GSD's own check`, answer: 'No, skip the check' },
    { question: 'Which frameworks does this team use?', answer: 'Keep GSD' },
    { question: 'Install from claude-plugins-official after you confirm the plan', answer: 'Not now' },
    { question: 'Autopilot duration for roles?', answer: '4h' },
    ...MODEL_ENTRIES,
    { question: 'Which roles get the MCP servers (', answer: 'Whole group' },
    { question: 'Which roles get all the MCP servers (', answer: 'None' },
    { question: 'How do you want to hand out your own skills (', answer: 'Whole group' },
    { question: SKILL_GROUP_QUESTION, answer: 'None', repeat: true },
    { question: 'Install mattpocock-skills', answer: 'No' },
    { question: 'Read your CLAUDE.md files, rules and memories', answer: 'No, skip it' },
    { question: 'Which roles get your global', answer: 'None' },
    { question: 'Which roles get the auto-memories', answer: 'None' },
    { question: 'Which roles get the project CLAUDE.md', answer: 'None' },
    { question: 'Which env variables do roles carry?', answer: 'None' },
    { question: '.planning/config.json: mode', answer: required },
    { question: '.planning/config.json: workflow.text_mode', answer: required },
    { question: '.planning/config.json: hooks.context_warnings', answer: DECLINE },
    { question: POLICY_QUESTION, answer: opts.policy },
    ...LAUNCH_ENTRIES[opts.launch],
    { question: 'Review the plan shown in the cadre init pane', answer: 'Confirm' },
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
