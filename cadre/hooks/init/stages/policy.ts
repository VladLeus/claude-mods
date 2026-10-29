/**
 * The git policy stage of init (D-65, D-90, D-136), a layer 10 module: the git policy question with its context line
 * of what each policy keeps in git, the three policies with their dialog labels and the words a person may type
 * under "Other" (GIT_POLICIES), parseGitPolicy, which reads an answer, and gitPolicyStep, which asks it; and
 * policyLine, the one line that states a policy and what stays out of git under it. Pure: it asks through the InitIo
 * port it is given, imports core and ui/ask, and never imports init.ts, which imports it, or init/run.
 */
import type { GitPolicy, InitIo } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { ASK_HEADERS, askChoice, choiceResult, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'

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
 * The git policy step (D-65): GIT_POLICY_QUESTION with GIT_POLICY_CONTEXT on its second line (D-136). The policy a
 * label or word names (parseGitPolicy) is accepted, and an answer that names none is asked again with why on top. A
 * dismissal is cancelled with GIT_POLICY_DISMISSED_REASON and MAX_ASKS answers that name no policy with
 * NO_USABLE_ANSWER_REASON, never taken as the default (A1, D-45).
 */
export async function gitPolicyStep(io: InitIo): Promise<StepResult<GitPolicy>> {
  const ask = {
    question: withContext(GIT_POLICY_QUESTION, GIT_POLICY_CONTEXT),
    spec: { options: GIT_POLICY_OPTIONS, header: ASK_HEADERS.gitPolicy },
    parse: parseGitPolicy,
    accepts: GIT_POLICY_ACCEPTS,
  }

  return choiceResult(await askChoice(io, ask), GIT_POLICY_DISMISSED_REASON)
}

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
