import { getOwnProfile, getFollowers } from "../clients/unipile.js";
import { recordFollowerCount } from "../db/store.js";
import { getEnv } from "../config/env.js";

export async function fetchAndRecordProfile(): Promise<{
  headline: string | null;
  followerCount: number | null;
}> {
  if (getEnv().DRY_RUN) {
    return { headline: null, followerCount: null };
  }

  try {
    const profile = (await getOwnProfile()) as Record<string, unknown>;
    const headline = (profile.headline ?? profile.occupation ?? null) as
      | string
      | null;

    let followerCount: number | null = null;
    try {
      const followers = (await getFollowers(1)) as {
        paging?: { total_count?: number };
        items?: unknown[];
      };
      followerCount =
        followers.paging?.total_count ?? followers.items?.length ?? null;
      if (followerCount !== null) {
        recordFollowerCount(followerCount);
      }
    } catch {
      // Follower count optional
    }

    return { headline, followerCount };
  } catch (err) {
    console.error("[fetch-profile] Failed:", err);
    return { headline: null, followerCount: null };
  }
}
