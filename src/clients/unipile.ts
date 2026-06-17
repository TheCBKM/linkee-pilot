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
  keywords: string;
  category: "posts" | "people";
  limit?: number;
  cursor?: string;
  api?: "classic" | "sales_navigator" | "recruiter";
}

export async function linkedinSearch(params: LinkedInSearchParams) {
  const env = getEnv();
  const url = new URL(`${env.UNIPILE_BASE_URL}/api/v1/linkedin/search`);
  url.searchParams.set("account_id", env.UNIPILE_ACCOUNT_ID);
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  url.searchParams.set("limit", String(params.limit ?? 10));

  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      "X-API-KEY": env.UNIPILE_API_KEY,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      api: params.api ?? "classic",
      category: params.category,
      keywords: params.keywords,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }

  return response.json();
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

export async function createPost(text: string) {
  const env = getEnv();
  const formData = new FormData();
  formData.append("account_id", env.UNIPILE_ACCOUNT_ID);
  formData.append("text", text);

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
