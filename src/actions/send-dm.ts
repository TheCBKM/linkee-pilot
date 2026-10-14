import { draftDmFollowup, draftFirstTouchDm } from "../ai/dm-writer.js";
import {
  getChatMessages,
  sendChatMessage,
  startChat,
} from "../clients/unipile.js";
import { getEnv } from "../config/env.js";
import { ICP_INCLUDE_PATTERNS } from "../config/icp.js";
import { LIMITS } from "../config/limits.js";
import {
  countPendingDmApprovals,
  enqueueDm,
  findPersonByProviderId,
  getConnectionForDm,
  getNextApprovedDm,
  getSentDmsAwaitingFollowup,
  markDmFailed,
  markDmSent,
  markPersonMessaged,
  markPersonReplied,
  rejectDm,
  setDmChatId,
  type ConnectionRow,
} from "../db/store.js";
import { notifyDiscord } from "../notifications/discord.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { canAct } from "../rate-limiter/quota.js";

export interface DraftDmResult {
  drafted: boolean;
  reason?: string;
  dmId?: number;
  name?: string | null;
}

export interface SendDmResult {
  sent: boolean;
  reason?: string;
  dmId?: number;
  chatId?: string | null;
}

/** Only message people whose headline suggests they can hire or buy. */
function looksHireable(headline: string | null): boolean {
  if (!headline) return false;
  return ICP_INCLUDE_PATTERNS.some((p) => p.test(headline));
}

/**
 * Draft a first-touch DM for an accepted connection and park it in the queue
 * for human approval. Never sends.
 */
export async function draftDmForApproval(): Promise<DraftDmResult> {
  if (!getEnv().ENABLE_DM) {
    return { drafted: false, reason: "dm_disabled" };
  }

  if (countPendingDmApprovals() >= LIMITS.dm.maxPendingApprovals) {
    return { drafted: false, reason: "approval_queue_full" };
  }

  const connection = pickConnection();
  if (!connection) {
    return { drafted: false, reason: "no_eligible_connection" };
  }

  const person = findPersonByProviderId(connection.provider_id);
  const context = [person?.author_headline, person?.content_preview]
    .filter(Boolean)
    .join("\n");

  const draft = await draftFirstTouchDm({
    name: connection.full_name,
    headline: connection.headline,
    context: context || null,
  });

  if (!draft) {
    return { drafted: false, reason: "draft_blocked" };
  }

  const dmId = enqueueDm({
    providerId: connection.provider_id,
    fullName: connection.full_name,
    headline: connection.headline,
    draftText: draft,
    kind: "first_touch",
  });

  await notifyDiscord({
    title: `DM · Awaiting approval (#${dmId})`,
    description: [
      `**To:** ${connection.full_name ?? connection.provider_id}`,
      connection.headline ? `_${connection.headline}_` : null,
      "",
      draft,
      "",
      `Approve: \`npm run cli -- dm approve ${dmId}\` or use the dashboard.`,
    ]
      .filter((line) => line !== null)
      .join("\n"),
    severity: "warn",
  });

  return { drafted: true, dmId, name: connection.full_name };
}

const MAX_CANDIDATE_SCANS = 10;

/**
 * getConnectionForDm returns the oldest accept with no queue row, so an
 * unsuitable connection would block the queue forever. Park each rejected
 * candidate as a 'rejected' queue row and move to the next one.
 */
function pickConnection(): ConnectionRow | null {
  for (let i = 0; i < MAX_CANDIDATE_SCANS; i++) {
    const candidate = getConnectionForDm({
      minHoursSinceAccept: LIMITS.dm.minHoursSinceAccept,
      maxDaysSinceAccept: LIMITS.dm.maxDaysSinceAccept,
    });
    if (!candidate) return null;
    if (looksHireable(candidate.headline)) return candidate;
    parkUnsuitableConnection(candidate);
  }
  return null;
}

/** The queue doubles as the ledger: a rejected row means "already considered". */
function parkUnsuitableConnection(connection: ConnectionRow): void {
  const dmId = enqueueDm({
    providerId: connection.provider_id,
    fullName: connection.full_name,
    headline: connection.headline,
    draftText: "(skipped: headline does not match hiring ICP)",
    kind: "first_touch",
  });
  rejectDm(dmId);
}

/** Send the oldest approved DM. Returns why it did nothing when idle. */
export async function sendApprovedDm(): Promise<SendDmResult> {
  if (!getEnv().ENABLE_DM) {
    return { sent: false, reason: "dm_disabled" };
  }

  const dm = getNextApprovedDm();
  if (!dm) {
    return { sent: false, reason: "nothing_approved" };
  }

  const actionType = dm.kind === "followup" ? "dm_followup" : "send_dm";
  if (!canAct(actionType).allowed) {
    return { sent: false, reason: "quota_exhausted" };
  }

  // Follow-ups go into the existing thread; first touches open a new one.
  const existingChatId = dm.kind === "followup" ? dm.chat_id : null;

  const result = await executeWithRateLimit({
    actionType,
    targetId: dm.provider_id,
    content: dm.draft_text,
    execute: async () => {
      if (existingChatId) {
        await sendChatMessage({
          chatId: existingChatId,
          text: dm.draft_text,
        });
        return { chatId: existingChatId };
      }
      const started = await startChat({
        providerId: dm.provider_id,
        text: dm.draft_text,
      });
      return { chatId: started.chatId };
    },
  });

  if (!result.success) {
    if (result.skipped) {
      markDmFailed(dm.id, "send skipped by rate limiter or API error");
    }
    return { sent: false, reason: "send_failed", dmId: dm.id };
  }

  const chatId = result.result?.chatId ?? existingChatId;
  markDmSent(dm.id, chatId);
  if (dm.kind === "first_touch") {
    markPersonMessaged(dm.provider_id);
  }

  await notifyDiscord({
    title: `DM · Sent (#${dm.id})`,
    description: `${dm.kind === "followup" ? "Follow-up" : "First touch"} to ${
      dm.full_name ?? dm.provider_id
    }.`,
    severity: "info",
  });

  return { sent: true, dmId: dm.id, chatId };
}

/**
 * Look for replies to sent first-touch DMs and queue a follow-up draft for
 * approval. Reading a thread is not a write, so it consumes no quota.
 */
export async function draftFollowupForApproval(): Promise<DraftDmResult> {
  if (!getEnv().ENABLE_DM) {
    return { drafted: false, reason: "dm_disabled" };
  }
  if (countPendingDmApprovals() >= LIMITS.dm.maxPendingApprovals) {
    return { drafted: false, reason: "approval_queue_full" };
  }

  const candidates = getSentDmsAwaitingFollowup(5);
  if (candidates.length === 0) {
    return { drafted: false, reason: "no_sent_dms" };
  }

  for (const dm of candidates) {
    if (!dm.chat_id) continue;

    let messages;
    try {
      messages = await getChatMessages(dm.chat_id, 20);
    } catch (err) {
      console.warn(`[send-dm] Could not read chat ${dm.chat_id}:`, err);
      continue;
    }

    const lastInbound = [...messages]
      .reverse()
      .find((m) => !m.isOutbound && m.text);
    if (!lastInbound?.text) continue;

    markPersonReplied(dm.provider_id);

    const draft = await draftDmFollowup({
      name: dm.full_name,
      headline: dm.headline,
      previousMessage: dm.draft_text,
      theirReply: lastInbound.text,
    });
    if (!draft) continue;

    const followupId = enqueueDm({
      providerId: dm.provider_id,
      fullName: dm.full_name,
      headline: dm.headline,
      draftText: draft,
      kind: "followup",
    });
    setDmChatId(followupId, dm.chat_id);

    await notifyDiscord({
      title: `DM · Reply received, follow-up awaiting approval (#${followupId})`,
      description: [
        `**From:** ${dm.full_name ?? dm.provider_id}`,
        "",
        `> ${lastInbound.text.slice(0, 500)}`,
        "",
        "**Proposed reply:**",
        draft,
      ].join("\n"),
      severity: "warn",
    });

    return { drafted: true, dmId: followupId, name: dm.full_name };
  }

  return { drafted: false, reason: "no_replies_yet" };
}
