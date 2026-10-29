/**
 * The ~/.claude.json consent stage of init (D-58, D-134, D-136), a layer 10 module: the consent question, asked before
 * the file is read because it holds account data, with its context line of where init still finds MCP servers
 * without it, its two answers with the declining one first (CLAUDE_JSON_OPTIONS), and consentStep, which asks it.
 * Pure: it asks through the InitIo port it is given, imports core and ui/ask, and never imports init.ts, which imports
 * it, or init/run.
 */
import type { InitIo } from '../../../types'
import { labelled } from '../../core/labelled'
import type { Labelled } from '../../core/labelled'
import { ASK_HEADERS, askChoice, choiceResult, quotedLabels, withContext } from '../../ui/ask'
import type { StepResult } from '../../ui/ask'

/** The ~/.claude.json consent question (D-58): the file holds account data, so it is read only after a yes. */
export const CLAUDE_JSON_QUESTION =
  'Read ~/.claude.json for MCP server names? Only server names are kept; account data is never read into the plan.'

/** The context line of the ~/.claude.json question (D-136): where init still finds MCP servers without the file. */
export const CLAUDE_JSON_CONTEXT =
  'Without it, init still finds MCP servers in .mcp.json, your plugins and this session.'

/** Each consent answer with what it allows, the declining one first: only the yes reads ~/.claude.json (D-58). */
const CONSENTS: readonly Labelled<boolean>[] = Object.freeze([
  { label: 'No, skip it', value: false },
  { label: 'Yes, read names only', value: true },
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
export const CONSENT_DISMISSED_REASON = 'The ~/.claude.json question was dismissed or not answered.'

/**
 * The ~/.claude.json consent step (D-58): CLAUDE_JSON_QUESTION with CLAUDE_JSON_CONTEXT on its second line (D-136).
 * `Yes, read names only` is accepted as true and `No, skip it` as false, and any other answer is asked again with why
 * on top. A dismissal is cancelled with CONSENT_DISMISSED_REASON and MAX_ASKS answers that name neither with
 * NO_USABLE_ANSWER_REASON, so no answer the person did not give decides whether the file is read (A1, D-45).
 */
export async function consentStep(io: InitIo): Promise<StepResult<boolean>> {
  const ask = {
    question: withContext(CLAUDE_JSON_QUESTION, CLAUDE_JSON_CONTEXT),
    spec: { options: CLAUDE_JSON_OPTIONS, header: ASK_HEADERS.claudeJson },
    parse: parseConsent,
    accepts: quotedLabels(CLAUDE_JSON_OPTIONS),
  }

  return choiceResult(await askChoice(io, ask), CONSENT_DISMISSED_REASON)
}
