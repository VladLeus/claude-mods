/**
 * The git policy stage of init (D-65, D-90, D-136, D-230), a layer 10 module: the git policy question with its
 * context line of what each policy keeps in git, the three policies with their dialog labels and the words a person
 * may type under "Other" (GIT_POLICIES), parseGitPolicy, which reads an answer, GIT_POLICY_ASK, the question as the
 * stage asks it, and policyStage, the pure stage that asks it; and policyLine, the one line that states a policy and
 * what stays out of git under it. Pure: it gives states and never performs an effect, imports core, ui/ask and
 * init/state, and never imports init/machine or init/run.
 */
import type { GitPolicy } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { ASK_HEADERS, choiceAnswer, withContext } from '../../ui/ask'
import { asking, stageCancelled, stageDone, stageFailed } from '../state'
import type { Answer, InitState, StageDef } from '../state'

/** The git policy question (D-65). */
export const GIT_POLICY_QUESTION = 'Git policy for .cadre/?'

/** The context line of the git policy question (D-136): what each policy keeps in git. */
export const GIT_POLICY_CONTEXT =
  'Commit definitions: .cadre/ is committed except .cadre/*/.runtime/. Commit all: only per-user files are ignored. ' +
  'Ignore all: nothing in .cadre/ is committed.'

/** Each git policy with its dialog label and the word a person may type under "Other" (D-65). */
type GitPolicyEntry = {
  readonly label: string
  readonly word: string
  readonly policy: GitPolicy
}

const GIT_POLICIES: readonly GitPolicyEntry[] =
  Object.freeze([
    { label: 'Commit definitions (default)', word: 'definitions', policy: 'definitions' },
    { label: 'Commit all', word: 'all', policy: 'all' },
    { label: 'Ignore all of .cadre/', word: 'ignore', policy: 'ignore' },
  ])

/**
 * The git policy choices in the order default, all, ignore: the dialog focuses the first option; the order is fixed
 * (D-65).
 */
export const GIT_POLICY_OPTIONS: readonly string[] = Object.freeze(GIT_POLICIES.map(entry => entry.label))

/** Each git policy dialog label with the policy it stands for. */
const GIT_POLICY_LABELS: readonly Labelled<GitPolicy>[] = Object.freeze(
  GIT_POLICIES.map(entry => ({ label: entry.label, value: entry.policy })),
)

/** Each git policy word a person may type under "Other", as a label with the policy it stands for. */
const GIT_POLICY_WORDS: readonly Labelled<GitPolicy>[] = Object.freeze(
  GIT_POLICIES.map(entry => ({ label: entry.word, value: entry.policy })),
)

/**
 * The git policy an answer names, else null. The three dialog labels match trimmed and in any case, and so do the
 * words `definitions`, `all` and `ignore` a person may type under "Other". An empty or unknown answer is never a
 * choice.
 */
export function parseGitPolicy(answer: string): GitPolicy | null {
  return labelled(GIT_POLICY_LABELS, answer) ?? labelled(GIT_POLICY_WORDS, answer)
}

/** Why init cancels when the git policy question is dismissed or not answered (A1, D-45). */
export const GIT_POLICY_DISMISSED_REASON = 'The git policy question was dismissed or not answered.'

/** What the git policy question takes, as its refusal lists it: the policy words (D-65, D-136). */
const GIT_POLICY_ACCEPTS = GIT_POLICIES.map(entry => entry.word).join(', ')

/**
 * The git policy question as the policy stage asks it (D-65, D-136): GIT_POLICY_QUESTION with GIT_POLICY_CONTEXT on
 * its second line, the three policy labels with the Git policy chip, parseGitPolicy, the policy words its refusal
 * lists, and the reason a dismissal cancels with.
 */
export const GIT_POLICY_ASK = Object.freeze({
  question: withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT),
  spec: Object.freeze({ options: GIT_POLICY_OPTIONS, header: ASK_HEADERS.gitPolicy }),
  parse: parseGitPolicy,
  accepts: GIT_POLICY_ACCEPTS,
  dismissedReason: GIT_POLICY_DISMISSED_REASON,
})

/**
 * The answer to the git policy question (choiceAnswer): the policy a label or word names goes into the draft and ends
 * the stage; an answer that names none is asked again with why on top; a dismissal cancels with
 * GIT_POLICY_DISMISSED_REASON and MAX_ASKS answers that name no policy with NO_USABLE_ANSWER_REASON, never taken as
 * the default (A1, D-45).
 */
function policyAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind !== 'answer' || state.sub.kind !== 'ask') return stageFailed(state)
  const next = choiceAnswer(GIT_POLICY_ASK, state.sub, answer.text)
  if (next.kind === 'value') return stageDone({ ...state, draft: { ...state.draft, policy: next.value } })
  if (next.kind === 'again') return asking(state, next.question, GIT_POLICY_ASK.spec, next.sub.tries)

  return stageCancelled(state, next.reason)
}

/**
 * The git policy stage (D-65, D-230): it asks GIT_POLICY_ASK once the role steps are done and takes its answer
 * (policyAnswer), so the open question is the git policy question until a policy is chosen.
 */
export const policyStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => asking(state, GIT_POLICY_ASK.question, GIT_POLICY_ASK.spec, 1),
  answer: policyAnswer,
})

/** The line that states each git policy and what stays out of git under it (D-65, D-90). */
const POLICY_LINES: Readonly<Record<GitPolicy, string>> = Object.freeze({
  definitions: 'Git policy: commit definitions (.cadre/*/.runtime/ ignored)',
  all: 'Git policy: commit all (only per-user rendered files in .cadre/*/.runtime/ ignored)',
  ignore: 'Git policy: ignore all of .cadre/',
})

/** The one line that states a git policy and what stays out of git under it. */
export function policyLine(policy: GitPolicy): string {
  return POLICY_LINES[policy]
}
