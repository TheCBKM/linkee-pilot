import { getUserProfile } from "../clients/unipile.js";
import { executeWithRateLimit } from "../rate-limiter/index.js";
import {
  advanceSequenceStage,
  cacheProviderId,
  getPersonIdentifier,
  getResolvedProviderId,
  hasRecentAction,
  type Target,
} from "../db/store.js";

export async function viewProfile(target: Target): Promise<boolean> {
  const identifier = getPersonIdentifier(target);
  if (!identifier) return false;

  const resolvedId = getResolvedProviderId(target) ?? identifier;
  if (hasRecentAction("view_profile", resolvedId, 7)) {
    return false;
  }

  const result = await executeWithRateLimit({
    actionType: "view_profile",
    targetId: resolvedId,
    execute: async () => {
      const profile = (await getUserProfile(identifier, {
        notify: true,
      })) as Record<string, unknown>;
      const providerId = (profile.provider_id ?? profile.id) as
        | string
        | undefined;
      if (providerId) {
        cacheProviderId(target.target_id, providerId);
      }
      return profile;
    },
  });

  if (result.success) {
    advanceSequenceStage(target.target_id, "viewed");
  }
  return result.success;
}
