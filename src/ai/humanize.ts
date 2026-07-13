/**
 * Deterministic post-processing before any LinkedIn send.
 * Strips AI punctuation tells (especially em dashes) that prompt rules alone don't stop.
 */
export function humanizeContent(text: string): string {
  let s = text;

  // Em dash / horizontal bar between clauses:
  // capitalized continuation → sentence break; otherwise → comma
  s = s.replace(/(\w)\s*[—―]\s*([A-Z])/g, "$1. $2");
  s = s.replace(/(\w)\s*[—―]\s*(\w)/g, "$1, $2");
  s = s.replace(/\s*[—―]\s*/g, ", ");

  // En dash: keep numeric ranges as hyphen; otherwise space-hyphen-space
  s = s.replace(/(\d)\s*–\s*(\d)/g, "$1-$2");
  s = s.replace(/\s*–\s*/g, " - ");

  // Smart / typographic punctuation → plain ASCII humans type
  s = s.replace(/[“”]/g, '"');
  s = s.replace(/[‘’]/g, "'");
  s = s.replace(/…/g, "...");

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
  return /[—–―]/.test(text);
}
