/**
 * People worth reaching: those who hire engineers or buy contract work.
 * Recruiting and talent titles are first-class targets now, not noise.
 */
export const ICP_INCLUDE_PATTERNS = [
  // Recruiting and talent
  /\brecruiter\b/i,
  /\brecruiting\b/i,
  /\btechnical sourcer\b/i,
  /\bsourcer\b/i,
  /\btalent acquisition\b/i,
  /\btalent partner\b/i,
  /\bhead of talent\b/i,
  /\btalent lead\b/i,
  /\bstaffing\b/i,
  /\bheadhunter\b/i,
  /\bhiring manager\b/i,
  // Engineering leadership who own headcount
  /\bengineering manager\b/i,
  /\bvp\s+engineering\b/i,
  /\bvp of engineering\b/i,
  /\bvice president.*engineering\b/i,
  /\bdirector.*engineering\b/i,
  /\bengineering director\b/i,
  /\bhead of engineering\b/i,
  /\bhead of platform\b/i,
  /\bhead of ai\b/i,
  /\bcto\b/i,
  /\bchief technology officer\b/i,
  /\btech lead\b/i,
  /\bplatform lead\b/i,
  // Founders and buyers of contract work
  /\bfounder\b/i,
  /\bco[- ]?founder\b/i,
  /\bceo\b/i,
  /\bagency owner\b/i,
  /\bfractional cto\b/i,
  /\bdelivery manager\b/i,
  /\bconsultancy\b/i,
  // Remote-work signals in a headline
  /\bhead of remote\b/i,
  /\bremote engineering\b/i,
  /\bdistributed team\b/i,
] as const;

/**
 * Real noise. Personal-brand accounts, coaches, and fellow job seekers:
 * peers competing for the same roles, not people who can hire.
 */
export const ICP_EXCLUDE_PATTERNS = [
  /\bcareer coach\b/i,
  /\blinkedin coach\b/i,
  /\bresume writer\b/i,
  /\bcv writer\b/i,
  /\binterview coach\b/i,
  /\bgrowth hacker\b/i,
  /\bfollow for\b/i,
  /\bdm me\b/i,
  /\bhelping you\b/i,
  /\bpersonal brand\b/i,
  /#opentowork\b/i,
  /\bopen to work\b/i,
  /\bjob seeker\b/i,
  /\bseeking (?:new )?opportunities\b/i,
  /\bhire me\b/i,
  /\binfluencer\b/i,
  /\bcontent creator\b/i,
  /\blead generation\b/i,
  /\bmlm\b/i,
  /\bcrypto (?:trader|signals)\b/i,
] as const;

/**
 * Job-board and aggregator accounts that repost listings in bulk. Their posts
 * match every hiring signal but the author cannot hire, cannot refer, and never
 * reads replies, so commenting is pure noise. Matched against the post author
 * only, never the body, so a genuine hiring post that happens to mention a job
 * board still gets through.
 */
export const JOB_BOARD_AUTHOR_PATTERNS = [
  /\bjobs?\s*(?:&|and)\s*(?:projects|internships|careers)\b/i,
  /\bjobs?\s+(?:board|portal|alerts?|updates?|feed|daily|hub|posting)\b/i,
  /\bhiring\s+(?:alerts?|updates?|feed|bot)\b/i,
  /\bcareers?\s+(?:page|portal|updates?)\b/i,
  /\bwalk[- ]?ins?\b/i,
  /\bplacement\s+(?:cell|updates?)\b/i,
] as const;

/**
 * Weaker signals that also show up in legitimate recruiter prose, as in
 * "I help engineers find remote jobs". Only applied when the text does not
 * read like a person describing themselves.
 */
const JOB_BOARD_LABEL_PATTERNS = [
  /\b(?:it|tech|remote|fresher|software)\s+jobs\b/i,
  /\bvacanc(?:y|ies)\b/i,
  /**
   * Aggregators brand themselves with the word as a suffix ("Healthcare Jobs")
   * or as a channel label before a separator ("Outside IR35 Jobs | In-Demand").
   * Real people put a role in that slot instead.
   */
  /\b(?:jobs|careers|vacancies|openings)\s*(?:$|[|·•—])/i,
] as const;

/** First-person phrasing means a human wrote it about themselves, not a feed. */
const SELF_DESCRIPTION_PATTERNS = [
  /\bi\s+(?:help|work|post|share|recruit|hire|partner|lead|build|connect)\b/i,
  /\b(?:i'm|i am|my|we're|we are|our)\b/i,
  /\bhelping\b/i,
  /\byou\b/i,
] as const;

export function isJobBoardAuthor(text?: string | null): boolean {
  if (!text) return false;
  if (JOB_BOARD_AUTHOR_PATTERNS.some((p) => p.test(text))) return true;

  const readsLikeAPerson = SELF_DESCRIPTION_PATTERNS.some((p) => p.test(text));
  if (readsLikeAPerson) return false;

  return JOB_BOARD_LABEL_PATTERNS.some((p) => p.test(text));
}

/**
 * Post-level hiring intent. A post matching these is a live opportunity
 * even when it has almost no engagement yet.
 */
export const HIRING_SIGNAL_PATTERNS = [
  /\bwe(?:'| a)?re hiring\b/i,
  /\bwe are hiring\b/i,
  /\bnow hiring\b/i,
  /\bi(?:'m| am) hiring\b/i,
  /\bhiring (?:a|an|for|now)\b/i,
  /\bjoin (?:our|the) team\b/i,
  /\bjoin us\b/i,
  /\bopen (?:role|position|req|headcount)\b/i,
  /\bnew (?:role|opening)\b/i,
  /\bwe(?:'| a)?re looking for\b/i,
  /\blooking for (?:a |an )?(?:senior |staff |lead )?(?:developer|engineer|dev|cto|architect)\b/i,
  /\bcontract (?:role|position|work|opportunity)\b/i,
  /\bfreelance\b/i,
  /\bcontractor\b/i,
  /\bapply (?:here|now|via)\b/i,
  /\bjob (?:opening|opportunity|post)\b/i,
  /\breferrals? welcome\b/i,
  /\bdrop (?:your|me) (?:cv|resume)\b/i,
] as const;

/** Remote-work signals. Required for hiring posts since remote is non-negotiable. */
export const REMOTE_SIGNAL_PATTERNS = [
  /\bremote\b/i,
  /\bfully remote\b/i,
  /\bremote[- ]first\b/i,
  /\bremote[- ]friendly\b/i,
  /\bwork from anywhere\b/i,
  /\bwfh\b/i,
  /\bdistributed team\b/i,
  /\banywhere in the world\b/i,
  /\bglobally distributed\b/i,
  /\btimezone (?:agnostic|flexible)\b/i,
] as const;

export function hasHiringSignal(text?: string | null): boolean {
  if (!text) return false;
  return HIRING_SIGNAL_PATTERNS.some((p) => p.test(text));
}

export function hasRemoteSignal(text?: string | null): boolean {
  if (!text) return false;
  return REMOTE_SIGNAL_PATTERNS.some((p) => p.test(text));
}

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
  "102713980", // India
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
  // India. `\b` after "india" keeps this from matching "Indiana, United States".
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
  /\bkochi\b/i,
  /\bkarnataka\b/i,
  /\btelangana\b/i,
  /\bmaharashtra\b/i,
  /\btamil nadu\b/i,
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

/**
 * Reject these locations hard. India used to sit here, but it is now a target
 * market like any other: the remote requirement is enforced separately, so an
 * India-based role only qualifies if it is genuinely remote.
 */
export const ICP_EXCLUDED_LOCATION_PATTERNS = [
  /\bpakistan\b/i,
  /\bbangladesh\b/i,
  /\bsri lanka\b/i,
  /\bnepal\b/i,
] as const;

export const ICP_PEOPLE_SEARCH_KEYWORDS = [
  "technical recruiter AI remote",
  "technical recruiter software engineer remote",
  "talent acquisition software engineer remote",
  "head of talent startup remote",
  "engineering manager hiring remote",
  "founder hiring engineer",
  "CTO hiring remote engineer",
  "startup founder AI product",
  "agency owner software development",
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
