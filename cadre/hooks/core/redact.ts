/**
 * Secret-like text hidden from what cadre shows, a layer 0 module (E1): free text the engine or a person supplied, such
 * as a skill's description, is shown with each span that looks like a credential replaced by REDACTED. It imports no
 * other module, so every layer can import it.
 */

/** What a hidden span of secret-like text reads as (E1). */
export const REDACTED = '[hidden]'

/** `text` with secret-like spans hidden before any cap (#163 stub until its GREEN): the text as given. */
export function redactedText(text: string, maxChars: number = Number.POSITIVE_INFINITY): string {
  return text
}

/**
 * A Bearer token: the word Bearer in any case and its spaces (group 1), then 8 or more token characters with a digit.
 */
const BEARER_TOKEN = /\b(bearer\s+)(?=[\w.~+/-]*\d)[\w.~+/-]{7,}[\w~+/-]=*/gi

/**
 * A value named as a secret: a name holding key, token, secret or password in any case, an optional closing quote and
 * `=` or `:` between spaces (group 1, the separator alone group 2), then the value (group 3), quoted, or up to the next
 * space, quote, comma, semicolon or closing bracket, a final period left out.
 */
const NAMED_SECRET =
  /\b([\w.-]{0,40}(?:key|token|secret|password)[\w.-]{0,40}["']? *([=:]) *)("[^"]*"|'[^']*'|[^\s"',;)}]*[^\s"',;)}.])/gi

/** An `sk-` API key, as OpenAI and Anthropic keys start: `sk-` and 16 or more letters, digits, `_` and `-`. */
const SK_KEY = /\bsk-[\w-]{16,}/g

/** A GitHub token: `ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_` and 16 or more letters and digits. */
const GITHUB_TOKEN = /\bgh[pousr]_[A-Za-z0-9]{16,}/g

/** A Slack token: `xoxa-`, `xoxb-`, `xoxp-`, `xoxr-` or `xoxs-` and 10 or more letters, digits and `-`. */
const SLACK_TOKEN = /\bxox[abprs]-[A-Za-z0-9-]{10,}/g

/** An AWS access key id: `AKIA` and 16 capital letters and digits. */
const AWS_KEY_ID = /\bAKIA[0-9A-Z]{16}\b/g

/** A run of 32 or more hex digits, in either case. */
const HEX_RUN = /(?<![0-9a-f])[0-9a-f]{32,}(?![0-9a-f])/gi

/** A run of 40 or more base64 characters with up to two `=` of padding; base64Text decides whether it is hidden. */
const BASE64_RUN = /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g

/** The fewest characters of a value after `:` that is hidden without a digit or quotes. */
const MIN_NAMED_VALUE_CHARS = 12

/**
 * A named value as it is shown (NAMED_SECRET): after `=` always hidden; after `:` hidden when it is quoted, holds a
 * digit or has 12 or more characters, so prose such as `API keys: create, rotate` is kept.
 */
function namedSecretText(match: string, head: string, separator: string, value: string): string {
  const isValueLike = /^["']/.test(value) || /\d/.test(value) || Array.from(value).length >= MIN_NAMED_VALUE_CHARS
  if (separator === ':' && !isValueLike) return match

  return `${head}${REDACTED}`
}

/** A base64 run as it is shown (BASE64_RUN): hidden when it holds a digit, a lower-case and an upper-case letter. */
function base64Text(run: string): string {
  if (!/\d/.test(run) || !/[a-z]/.test(run) || !/[A-Z]/.test(run)) return run

  return REDACTED
}

/**
 * `text` with each span that looks like a credential replaced by REDACTED (E1), the rest kept as is; hiding twice
 * changes nothing. A span looks like a credential when it is:
 * - a Bearer token of 8 or more token characters with a digit, the word Bearer kept;
 * - a value named as a secret, after a name holding key, token, secret or password in any case, the name kept: after
 *   `=` any value; after `:` a value quoted, with a digit or of 12 or more characters;
 * - an `sk-` key, a GitHub token (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`), a Slack token (`xoxa-`, `xoxb-`, `xoxp-`,
 *   `xoxr-`, `xoxs-`) or an AWS access key id (`AKIA`);
 * - a run of 32 or more hex digits, or a base64-like run of 40 or more characters with a digit and letters of both
 *   cases.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(BEARER_TOKEN, `$1${REDACTED}`)
    .replace(NAMED_SECRET, namedSecretText)
    .replace(SK_KEY, REDACTED)
    .replace(GITHUB_TOKEN, REDACTED)
    .replace(SLACK_TOKEN, REDACTED)
    .replace(AWS_KEY_ID, REDACTED)
    .replace(HEX_RUN, REDACTED)
    .replace(BASE64_RUN, base64Text)
}
