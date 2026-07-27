import { sendInvitation } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import {
  getResolvedProviderId,
  markPersonInvited,
  updateTargetStatus,
} from "../db/store.js";
import { draftInviteNote } from "../ai/comment-writer.js";
import { isOwnProviderId } from "../config/identity.js";
import type { Target } from "../db/store.js";

export async function sendConnectionRequest(target: Target): Promise<boolean> {
  const providerId =
    getResolvedProviderId(target) ??
    target.provider_id ??
    target.target_id.replace(/^person:/, "");

  if (isOwnProviderId(providerId) || isOwnProviderId(target.provider_id)) {
    console.warn(
      `[invite] Skipping self-invite (provider_id=${providerId})`
    );
    updateTargetStatus(target.target_id, "filtered");
    return false;
  }

  const message = await draftInviteNote({
    name: target.author_name ?? undefined,
    headline: target.author_headline ?? undefined,
  });

  const result = await executeWithRateLimit({
    actionType: "send_invite",
    targetId: providerId,
    content: message ?? undefined,
    execute: () =>
      sendInvitation({
        providerId,
        ...(message && { message }),
      }),
  });

  if (result.success) {
    markPersonInvited(target.target_id);
  }
  return result.success;
}
