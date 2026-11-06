/**
 * The ~/.claude.json consent stage of init (D-58, D-134, D-136, D-230), a layer 10 module: the consent question,
 * asked before the file is read because it holds account data, with its context line of where init still finds MCP
 * servers without it, its two answers with the declining one first (CLAUDE_JSON_OPTIONS), and consentStage, the pure
 * stage that asks it. Pure: it gives states and never performs an effect, imports core, ui/ask and init/state, and
 * never imports init/machine or init/run.
 */
import type { AskSpec } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { t } from '../../locales/t'
import { ASK_HEADERS, choiceAnswer, paneQuestionOf, quotedLabels, withContext } from '../../ui/ask'
import { asking, stageCancelled, stageDone, stageFailed } from '../state'
import type { Answer, InitState, StageDef } from '../state'

/** The ~/.claude.json consent question (D-58): the file holds account data, so it is read only after a yes. */
export const CLAUDE_JSON_QUESTION = t('init.consent.claudeJsonQuestion')

/** The context line of the ~/.claude.json question (D-136): where init still finds MCP servers without the file. */
export const CLAUDE_JSON_CONTEXT = t('init.consent.claudeJsonContext')

/** Each consent answer with what it allows, the declining one first: only the yes reads ~/.claude.json (D-58). */
const CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: t('init.consent.consentNo'), value: false },
  { label: t('init.consent.consentYes'), value: true },
])

/**
 * The answers to the consent question. The declining answer is first because the engine dialog starts with its first
 * option focused (pre-checked on desktop), so a quick Submit declines (D-58, D-59 as amended by D-134).
 */
export const CLAUDE_JSON_OPTIONS: readonly string[] = Object.freeze(CONSENTS.map(entry => entry.label))

/** Whether a consent answer allows reading ~/.claude.json; null when it names neither answer (D-58). */
function parseConsent(answer: string): boolean | null {
  return labelled(CONSENTS, answer)
}

/** Why init cancels when the ~/.claude.json question is dismissed or not answered (A1, D-45). */
export const CONSENT_DISMISSED_REASON = t('init.consent.consentDismissedReason')

/** The summary of the consent's context (D-310): the one file it reads, and only the MCP server names in it. */
const CONSENT_SUMMARY = t('ui.summary.consent')

/**
 * The ~/.claude.json question as the consent stage asks it (D-58, D-136): CLAUDE_JSON_QUESTION with
 * CLAUDE_JSON_CONTEXT on its second line, the two answers with the claude.json chip, and as its own context (kind
 * `consent`) that one line stating what is read, so a pane surface shows it in the pane (D-287, D-300), with its
 * summary, the one file read for MCP server names only, which a pane surface asks under the question (D-310), and that
 * line as one plain row (D-313); then parseConsent, the answers its refusal lists, and the reason a dismissal cancels
 * with.
 */
const CONSENT_ASK = Object.freeze({
  question: withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT),
  spec: Object.freeze<AskSpec>({
    options: CLAUDE_JSON_OPTIONS,
    header: ASK_HEADERS.claudeJson,
    context: {
      title: t('init.consent.claudeJsonTitle'),
      lines: [CLAUDE_JSON_CONTEXT],
      kind: 'consent',
      summary: CONSENT_SUMMARY,
      pane: paneQuestionOf(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT, CONSENT_SUMMARY),
      rows: [{ title: null, rows: [{ role: 'plain', text: CLAUDE_JSON_CONTEXT, indent: 0 }] }],
    },
  }),
  parse: parseConsent,
  accepts: quotedLabels(CLAUDE_JSON_OPTIONS),
  dismissedReason: CONSENT_DISMISSED_REASON,
})

/**
 * The answer to the ~/.claude.json question (choiceAnswer): `Yes, read names only` puts true in the draft and `No,
 * skip it` false, which ends the stage; any other answer is asked again with why on top. A dismissal cancels with
 * CONSENT_DISMISSED_REASON and MAX_ASKS answers that name neither with NO_USABLE_ANSWER_REASON, so no answer the
 * person did not give decides whether the file is read (A1, D-45).
 */
function consentAnswer(state: InitState, answer: Answer): InitState {
  if (answer.kind !== 'answer' || state.sub.kind !== 'ask') return stageFailed(state)
  const next = choiceAnswer(CONSENT_ASK, state.sub, answer.text)
  if (next.kind === 'value') return stageDone({ ...state, draft: { ...state.draft, readUserMcp: next.value } })
  if (next.kind === 'again') return asking(state, next.question, CONSENT_ASK.spec, next.sub.tries)

  return stageCancelled(state, next.reason)
}

/**
 * The ~/.claude.json consent stage (D-58, D-230): right after the guard, it asks CONSENT_ASK and takes its answer
 * (consentAnswer), so the scans read the file only after a yes.
 */
export const consentStage: StageDef = Object.freeze({
  enter: (state: InitState): InitState => asking(state, CONSENT_ASK.question, CONSENT_ASK.spec, 1),
  answer: consentAnswer,
})
