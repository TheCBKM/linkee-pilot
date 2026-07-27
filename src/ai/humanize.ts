/**
 * Deterministic post-processing before any LinkedIn send.
 * Strips AI punctuation tells (especially em dashes) that prompt rules alone don't stop.
 */

/** Em dash, en dash, figure dash, horizontal bar, minus, and common lookalikes. */
const DASH_CHARS = "\u2012\u2013\u2014\u2015\u2212\uFE58\uFE63\uFF0D";
const DASH_CLASS = `[${DASH_CHARS}]`;

export function humanizeContent(text: string): string {
  let s = text;

  // HTML / XML entities models sometimes emit
  s = s.replace(/&mdash;|&#8212;|&#x2014;/gi, "—");
  s = s.replace(/&ndash;|&#8211;|&#x2013;/gi, "–");

  // Keep numeric ranges as a plain hyphen before broader dash rewrites
  s = s.replace(new RegExp(`(\\d)\\s*${DASH_CLASS}\\s*(\\d)`, "g"), "$1-$2");

  // Em-like dashes between clauses:
  // capitalized continuation → sentence break; otherwise → comma
  s = s.replace(new RegExp(`(\\w)\\s*${DASH_CLASS}\\s*([A-Z])`, "g"), "$1. $2");
  s = s.replace(new RegExp(`(\\w)\\s*${DASH_CLASS}\\s*(\\w)`, "g"), "$1, $2");
  s = s.replace(new RegExp(`\\s*${DASH_CLASS}\\s*`, "g"), ", ");

  // Double hyphen used as an em dash (not numeric ranges like 10-20)
  s = s.replace(/(\w)\s+--\s+([A-Z])/g, "$1. $2");
  s = s.replace(/(\w)\s+--\s+(\w)/g, "$1, $2");
  s = s.replace(/\s+--\s+/g, ", ");

  // Smart / typographic punctuation → plain ASCII humans type
  s = s.replace(/[“”]/g, '"');
  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/…/g, "...");

  // Nuclear pass: any remaining dash lookalikes become a plain hyphen
  s = s.replace(new RegExp(DASH_CLASS, "g"), "-");

  // Clean artifacts from replacements
  s = s.replace(/,\s*,+/g, ",");
  s = s.replace(/\.\s*,/g, ".");
  s = s.replace(/,\s*\./g, ".");
  s = s.replace(/[ \t]+\n/g, "\n");
  s = s.replace(/ {2,}/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");

  return s.trim();
}

/** True if text still has em/en dashes (should be rare after humanizeContent). */
export function hasEmDash(text: string): boolean {
  return new RegExp(DASH_CLASS).test(text) || /&mdash;|&ndash;|&#821[12];|&#x201[34];/i.test(text);
}

/**
 * Last-line gate before any LinkedIn send.
 * Strips dash lookalikes, then throws if any remain.
 */
export function assertPublishableContent(text: string): string {
  const cleaned = humanizeContent(text);
  if (hasEmDash(cleaned)) {
    throw new Error("contains_em_dash");
  }
  return cleaned;
}
