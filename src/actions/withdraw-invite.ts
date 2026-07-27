import {
  listSentInvitations,
  cancelInvitation,
  type SentInvitation,
} from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import { LIMITS } from "../config/limits.js";
import {
  findPersonByProviderId,
  getAgentState,
  markInviteWithdrawn,
  setAgentState,
} from "../db/store.js";

export const WITHDRAW_INVITE_IDLE_DATE_KEY = "withdraw_invite_idle_date";

export type WithdrawResult = {
  withdrawn: boolean;
  reason?: "idle" | "none_stale" | "skipped" | "failed";
  invitationId?: string;
  invitedUserId?: string;
};

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function inviteSentAt(invite: SentInvitation): Date | null {
  const raw = invite.parsed_datetime ?? invite.date;
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isStale(invite: SentInvitation, cutoffMs: number): boolean {
  const sentAt = inviteSentAt(invite);
  if (!sentAt) return false;
  return sentAt.getTime() <= cutoffMs;
}

async function findOldestStaleInvite(): Promise<SentInvitation | null> {
  const cutoffMs =
    Date.now() - LIMITS.staleInviteDays * 24 * 60 * 60 * 1000;
  let cursor: string | undefined;
  let oldest: SentInvitation | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;

  for (;;) {
    const page = await listSentInvitations({ cursor, limit: 100 });
    for (const invite of page.items) {
      if (!invite.id || !isStale(invite, cutoffMs)) continue;
      const sentAt = inviteSentAt(invite);
      if (!sentAt) continue;
      const ms = sentAt.getTime();
      if (ms < oldestMs) {
        oldestMs = ms;
        oldest = invite;
      }
    }
    if (!page.cursor) break;
    cursor = page.cursor;
  }

  return oldest;
}

export async function withdrawStaleInvite(): Promise<WithdrawResult> {
  const today = todayUtc();
  if (getAgentState(WITHDRAW_INVITE_IDLE_DATE_KEY) === today) {
    return { withdrawn: false, reason: "idle" };
  }

  const invite = await findOldestStaleInvite();
  if (!invite) {
    setAgentState(WITHDRAW_INVITE_IDLE_DATE_KEY, today);
    return { withdrawn: false, reason: "none_stale" };
  }

  const result = await executeWithRateLimit({
    actionType: "withdraw_invite",
    targetId: invite.id,
    execute: () => cancelInvitation(invite.id),
  });

  if (result.skipped) {
    return {
      withdrawn: false,
      reason: "skipped",
      invitationId: invite.id,
      invitedUserId: invite.invited_user_id,
    };
  }

  if (!result.success) {
    return {
      withdrawn: false,
      reason: "failed",
      invitationId: invite.id,
      invitedUserId: invite.invited_user_id,
    };
  }

  if (invite.invited_user_id) {
    const person = findPersonByProviderId(invite.invited_user_id);
    if (person) {
      markInviteWithdrawn(person.target_id);
    }
  }

  return {
    withdrawn: true,
    invitationId: invite.id,
    invitedUserId: invite.invited_user_id,
  };
}
