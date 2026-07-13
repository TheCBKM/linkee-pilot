import { UnipileClient } from "unipile-node-sdk";
import { getEnv } from "../config/env.js";

let client: UnipileClient | null = null;

export function getUnipileClient(): UnipileClient {
  if (!client) {
    const env = getEnv();
    client = new UnipileClient(env.UNIPILE_BASE_URL, env.UNIPILE_API_KEY);
  }
  return client;
}

export function getAccountId(): string {
  return getEnv().UNIPILE_ACCOUNT_ID;
}

export interface LinkedInSearchParams {
  keywords?: string;
  category: "posts" | "people";
  limit?: number;
  cursor?: string;
  api?: "classic" | "sales_navigator" | "recruiter";
  sort_by?: string;
  date_posted?: string;
  network_distance?: number[];
  profile_language?: string[];
  /** Classic people/company search: LinkedIn location geo IDs. */
  location?: string[];
  /** Classic posts search: single global location geo ID. */
  region?: string;
}

export async function linkedinSearch(params: LinkedInSearchParams) {
  const env = getEnv();
  const url = new URL(`${env.UNIPILE_BASE_URL}/api/v1/linkedin/search`);
  url.searchParams.set("account_id", env.UNIPILE_ACCOUNT_ID);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  url.searchParams.set("limit", String(params.limit ?? 25));

  const body: Record<string, unknown> = {
    api: params.api ?? "classic",
    category: params.category,
  };

  if (params.keywords) body.keywords = params.keywords;
  if (params.sort_by) body.sort_by = params.sort_by;
  if (params.date_posted) body.date_posted = params.date_posted;
  if (params.network_distance) body.network_distance = params.network_distance;
  if (params.profile_language) body.profile_language = params.profile_language;
  if (params.location?.length) body.location = params.location;
  if (params.region) body.region = params.region;

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new UnipileError(response.status, text);
  }

  return response.json();
}

export async function getUserProfile(
  identifier: string,
  options?: { notify?: boolean }
) {
  const env = getEnv();
  const sdk = getUnipileClient();
  return sdk.users.getProfile({
    account_id: env.UNIPILE_ACCOUNT_ID,
    identifier,
    linkedin_sections: "*",
    ...(options?.notify && { notify: true }),
  });
}

export async function getOwnProfile() {
  const env = getEnv();
  const client = getUnipileClient();
  return client.users.getOwnProfile(env.UNIPILE_ACCOUNT_ID);
}

export async function getFollowers(limit = 10) {
  const env = getEnv();
  const response = await fetch(
    `${env.UNIPILE_BASE_URL}/api/v1/users/followers?account_id=${env.UNIPILE_ACCOUNT_ID}&limit=${limit}`,
    {
      headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
    }
  );
  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export async function sendPostReaction(params: {
  postId: string;
  commentId?: string;
  reactionType?: string;
}) {
  const env = getEnv();
  const response = await fetch(`${env.UNIPILE_BASE_URL}/api/v1/posts/reaction`, {
    method: "POST",
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      account_id: env.UNIPILE_ACCOUNT_ID,
      post_id: params.postId,
      ...(params.commentId && { comment_id: params.commentId }),
      ...(params.reactionType && { reaction_type: params.reactionType }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export async function sendPostComment(params: {
  postId: string;
  text: string;
  commentId?: string;
}) {
  const env = getEnv();
  const formData = new FormData();
  formData.append("account_id", env.UNIPILE_ACCOUNT_ID);
  formData.append("text", params.text);
  if (params.commentId) formData.append("comment_id", params.commentId);

  const response = await fetch(
    `${env.UNIPILE_BASE_URL}/api/v1/posts/${params.postId}/comments`,
    {
      method: "POST",
      headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
      body: formData,
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export async function sendInvitation(params: {
  providerId: string;
  message?: string;
}) {
  const env = getEnv();
  const response = await fetch(`${env.UNIPILE_BASE_URL}/api/v1/users/invite`, {
    method: "POST",
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      account_id: env.UNIPILE_ACCOUNT_ID,
      provider_id: params.providerId,
      ...(params.message && { message: params.message }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export async function createPost(params: { text: string; repost?: string }) {
  const env = getEnv();
  const formData = new FormData();
  formData.append("account_id", env.UNIPILE_ACCOUNT_ID);
  formData.append("text", params.text);
  if (params.repost) formData.append("repost", params.repost);

  const response = await fetch(`${env.UNIPILE_BASE_URL}/api/v1/posts`, {
    method: "POST",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export async function getPostComments(postId: string, limit = 10) {
  const env = getEnv();
  const response = await fetch(
    `${env.UNIPILE_BASE_URL}/api/v1/posts/${postId}/comments?account_id=${env.UNIPILE_ACCOUNT_ID}&limit=${limit}`,
    {
      headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export class UnipileError extends Error {
  constructor(
    public status: number,
    public body: string
  ) {
    super(`Unipile API error ${status}: ${body}`);
    this.name = "UnipileError";
  }

  get errorType(): string | null {
    try {
      const parsed = JSON.parse(this.body) as { type?: string };
      return parsed.type ?? null;
    } catch {
      return null;
    }
  }
}

export function parseErrorType(err: unknown): string | null {
  if (err instanceof UnipileError) return err.errorType;
  return null;
}
