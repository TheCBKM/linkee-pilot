export const ICP_INCLUDE_PATTERNS = [
  /\bengineering manager\b/i,
  /\bvp\s+engineering\b/i,
  /\bvice president.*engineering\b/i,
  /\bdirector.*engineering\b/i,
  /\bhead of engineering\b/i,
  /\bcto\b/i,
  /\bchief technology officer\b/i,
  /\bscrum master\b/i,
  /\bagile coach\b/i,
  /\bproduct manager\b/i,
  /\btech lead\b/i,
  /\bplatform lead\b/i,
  /\bstaff engineer\b/i,
  /\bprincipal engineer\b/i,
  /\bengineering director\b/i,
  /\bvp of engineering\b/i,
  /\bhead of platform\b/i,
  /\bdistributed team\b/i,
  /\bremote engineering\b/i,
] as const;

export const ICP_EXCLUDE_PATTERNS = [
  /\brecruiter\b/i,
  /\btalent acquisition\b/i,
  /\bcareer coach\b/i,
  /\blinkedin coach\b/i,
  /\bgrowth hacker\b/i,
  /\bfollow for\b/i,
  /\bdm me\b/i,
  /\bhelping you\b/i,
  /\bpersonal brand\b/i,
  /#opentowork\b/i,
  /\bjob seeker\b/i,
  /\bhire me\b/i,
  /\binfluencer\b/i,
  /\bcontent creator\b/i,
  /\blead generation\b/i,
] as const;

/**
 * Preferred markets for outreach and engagement.
 * LinkedIn classic search uses numeric geo IDs (type=LOCATION).
 */
export const ICP_PREFERRED_LOCATION_IDS = [
  "103644278", // United States
  "101165590", // United Kingdom
  "101174742", // Canada
  "101452733", // Australia
  "101282230", // Germany
  "105015875", // France
  "102890719", // Netherlands
  "104738515", // Ireland
  "105646813", // Spain
  "103350119", // Italy
  "105117094", // Sweden
  "106693272", // Switzerland
  "105072130", // Poland
  "100565514", // Belgium
  "104514075", // Denmark
  "103819153", // Norway
  "100456013", // Finland
  "100364837", // Portugal
  "103883259", // Austria
  "101728296", // Russia
] as const;

/** How many location IDs to send per people-search request (LinkedIn UI caps). */
export const ICP_LOCATION_BATCH_SIZE = 4;

export const ICP_PREFERRED_LOCATION_PATTERNS = [
  /\bunited states\b/i,
  /\busa\b/i,
  /\bu\.s\.a\.?\b/i,
  /\bunited kingdom\b/i,
  /\bengland\b/i,
  /\bscotland\b/i,
  /\bwales\b/i,
  /\blondon\b/i,
  /\bgreater london\b/i,
  /\bcanada\b/i,
  /\baustralia\b/i,
  /\bnew south wales\b/i,
  /\bvictoria, australia\b/i,
  /\bgermany\b/i,
  /\bfrance\b/i,
  /\bnetherlands\b/i,
  /\bireland\b/i,
  /\bspain\b/i,
  /\bitaly\b/i,
  /\bsweden\b/i,
  /\bswitzerland\b/i,
  /\bpoland\b/i,
  /\bbelgium\b/i,
  /\bdenmark\b/i,
  /\bnorway\b/i,
  /\bfinland\b/i,
  /\bportugal\b/i,
  /\baustria\b/i,
  /\brussia\b/i,
  /\brussian federation\b/i,
  /\beurope\b/i,
  /\beu\b/i,
  /\bcalifornia\b/i,
  /\bnew york\b/i,
  /\btexas\b/i,
  /\bwashington\b/i,
  /\bmassachusetts\b/i,
  /\bseattle\b/i,
  /\bsan francisco\b/i,
  /\bboston\b/i,
  /\baustin\b/i,
  /\bdenver\b/i,
  /\bchicago\b/i,
  /\bbay area\b/i,
  /\bberlin\b/i,
  /\bparis\b/i,
  /\bamsterdam\b/i,
  /\bdublin\b/i,
  /\bstockholm\b/i,
  /\bzurich\b/i,
  /\bmunich\b/i,
  /\bmoscow\b/i,
  /\bsydney\b/i,
  /\bmelbourne\b/i,
  /\btoronto\b/i,
  /\bvancouver\b/i,
  /, ca\b/i,
  /, ny\b/i,
  /, tx\b/i,
  /, wa\b/i,
] as const;

/** Reject these locations hard — primary complaint: too many India profiles. */
export const ICP_EXCLUDED_LOCATION_PATTERNS = [
  /\bindia\b/i,
  /\bbengaluru\b/i,
  /\bbangalore\b/i,
  /\bhyderabad\b/i,
  /\bmumbai\b/i,
  /\bdelhi\b/i,
  /\bnoida\b/i,
  /\bgurgaon\b/i,
  /\bgurugram\b/i,
  /\bpune\b/i,
  /\bchennai\b/i,
  /\bkolkata\b/i,
  /\bahmedabad\b/i,
  /\bjaipur\b/i,
  /\bkochi\b/i,
  /\bthiruvananthapuram\b/i,
  /\bkarnataka\b/i,
  /\btelangana\b/i,
  /\bmaharashtra\b/i,
  /\btamil nadu\b/i,
  /\bghaziabad\b/i,
  /\bfaridabad\b/i,
  /\bchandigarh\b/i,
  /\bindore\b/i,
  /\bcoimbatore\b/i,
  /\bpakistan\b/i,
  /\bbangladesh\b/i,
  /\bsri lanka\b/i,
  /\bnepal\b/i,
] as const;

export const ICP_PEOPLE_SEARCH_KEYWORDS = [
  "engineering manager software",
  "VP engineering SaaS",
  "director engineering remote",
  "scrum master agile",
  "CTO startup",
] as const;

export function pickLocationBatch(): string[] {
  const ids = [...ICP_PREFERRED_LOCATION_IDS];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids.slice(0, ICP_LOCATION_BATCH_SIZE);
}

export function pickPreferredRegionId(): string {
  const ids = ICP_PREFERRED_LOCATION_IDS;
  return ids[Math.floor(Math.random() * ids.length)];
}
