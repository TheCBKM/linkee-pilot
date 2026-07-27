import { UnipileClient } from "unipile-node-sdk";
import { getEnv } from "../config/env.js";
import { assertPublishableContent } from "../ai/humanize.js";

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
  const text = assertPublishableContent(params.text);
  const env = getEnv();
  const formData = new FormData();
  formData.append("account_id", env.UNIPILE_ACCOUNT_ID);
  formData.append("text", text);
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
  const message = params.message
    ? assertPublishableContent(params.message)
    : undefined;
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
      ...(message && { message }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }
  return response.json();
}

export interface SentInvitation {
  id: string;
  invited_user_id?: string;
  date?: string;
  parsed_datetime?: string;
}

export interface SentInvitationList {
  items: SentInvitation[];
  cursor?: string | null;
}

export async function listSentInvitations(params?: {
  cursor?: string;
  limit?: number;
}): Promise<SentInvitationList> {
  const env = getEnv();
  const url = new URL(`${env.UNIPILE_BASE_URL}/api/v1/users/invite/sent`);
  url.searchParams.set("account_id", env.UNIPILE_ACCOUNT_ID);
  url.searchParams.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await fetch(url.toString(), {
    headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }

  const data = (await response.json()) as {
    items?: SentInvitation[];
    cursor?: string | null;
  };
  return {
    items: data.items ?? [],
    cursor: data.cursor ?? null,
  };
}

export async function cancelInvitation(invitationId: string) {
  const env = getEnv();
  const url = new URL(
    `${env.UNIPILE_BASE_URL}/api/v1/users/invite/sent/${encodeURIComponent(invitationId)}`
  );
  url.searchParams.set("account_id", env.UNIPILE_ACCOUNT_ID);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }

  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export interface RelationContact {
  provider_id: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  headline?: string;
  public_identifier?: string;
  public_profile_url?: string;
  /** Unix seconds or ISO string depending on API version. */
  created_at?: string | number;
  member_id?: string;
  raw?: Record<string, unknown>;
}

export interface RelationList {
  items: RelationContact[];
  cursor?: string | null;
}

/**
 * List first-degree LinkedIn relations (connections).
 * GET /api/v1/users/relations
 */
export async function listRelations(params?: {
  cursor?: string;
  limit?: number;
}): Promise<RelationList> {
  const env = getEnv();
  const url = new URL(`${env.UNIPILE_BASE_URL}/api/v1/users/relations`);
  url.searchParams.set("account_id", env.UNIPILE_ACCOUNT_ID);
  url.searchParams.set("limit", String(params?.limit ?? 100));
  if (params?.cursor) url.searchParams.set("cursor", params.cursor);

  const response = await fetch(url.toString(), {
    headers: { "X-API-KEY": env.UNIPILE_API_KEY, Accept: "application/json" },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new UnipileError(response.status, body);
  }

  const data = (await response.json()) as {
    items?: Record<string, unknown>[];
    data?: Record<string, unknown>[];
    cursor?: string | null;
    next_cursor?: string | null;
  };

  const rawItems = data.items ?? data.data ?? [];
  const items: RelationContact[] = [];

  for (const item of rawItems) {
    const providerId = String(
      item.provider_id ?? item.id ?? item.member_id ?? ""
    ).trim();
    if (!providerId) continue;

    const first = typeof item.first_name === "string" ? item.first_name : "";
    const last = typeof item.last_name === "string" ? item.last_name : "";
    const combined = `${first} ${last}`.trim();
    const fullName =
      (typeof item.full_name === "string" && item.full_name) ||
      (typeof item.name === "string" && item.name) ||
      combined ||
      undefined;

    items.push({
      provider_id: providerId,
      first_name: first || undefined,
      last_name: last || undefined,
      full_name: fullName,
      headline:
        typeof item.headline === "string"
          ? item.headline
          : typeof item.description === "string"
            ? item.description
            : undefined,
      public_identifier:
        typeof item.public_identifier === "string"
          ? item.public_identifier
          : undefined,
      public_profile_url:
        typeof item.public_profile_url === "string"
          ? item.public_profile_url
          : typeof item.profile_url === "string"
            ? item.profile_url
            : undefined,
      created_at:
        typeof item.created_at === "number" || typeof item.created_at === "string"
          ? item.created_at
          : undefined,
      member_id:
        typeof item.member_id === "string" ? item.member_id : undefined,
      raw: item,
    });
  }

  return {
    items,
    cursor: data.cursor ?? data.next_cursor ?? null,
  };
}

export async function createPost(params: { text: string; repost?: string }) {
  const text = assertPublishableContent(params.text);
  const env = getEnv();
  const formData = new FormData();
  formData.append("account_id", env.UNIPILE_ACCOUNT_ID);
  formData.append("text", text);
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

/** Unipile v1 LinkedIn comment (list comments). */
export interface PostComment {
  id: string;
  text?: string;
  /** Often a URN string like `urn:li:person:…` in v1. */
  author?: string | PostCommentAuthor;
  author_details?: PostCommentAuthorDetails;
}

export interface PostCommentAuthor {
  id?: string;
  provider_id?: string;
  display_name?: string;
  name?: string;
  description?: string;
  headline?: string;
  public_identifier?: string;
  profile_url?: string;
  type?: string;
}

export interface PostCommentAuthorDetails {
  id?: string;
  name?: string;
  headline?: string;
  profile_url?: string;
  profile_picture_url?: string;
  network_distance?: string;
  is_company?: boolean;
  public_identifier?: string;
}

export interface PostCommentList {
  items?: PostComment[];
  cursor?: string | null;
}

export interface ParsedCommentAuthor {
  providerId: string | null;
  publicId: string | null;
  name: string | null;
  headline: string | null;
  isCompany: boolean;
}

/** Extract author identity from Unipile v1/v2-ish comment shapes. */
export function parseCommentAuthor(comment: PostComment): ParsedCommentAuthor {
  const details = comment.author_details;
  const nested =
    comment.author && typeof comment.author === "object"
      ? comment.author
      : null;
  const authorUrn =
    typeof comment.author === "string" ? comment.author : null;

  const rawId =
    details?.id ??
    nested?.id ??
    nested?.provider_id ??
    authorUrn ??
    null;

  let providerId: string | null = null;
  if (rawId) {
    const s = String(rawId).trim();
    const personMatch = s.match(/urn:li:person:(.+)$/i);
    const cleaned = (personMatch?.[1] ?? s.replace(/^person:/, "")).trim();
    providerId = cleaned || null;
  }

  const publicId =
    details?.public_identifier ??
    nested?.public_identifier ??
    extractPublicIdFromProfileUrl(
      details?.profile_url ?? nested?.profile_url
    ) ??
    null;

  const name =
    details?.name ?? nested?.display_name ?? nested?.name ?? null;

  const headline =
    details?.headline ?? nested?.headline ?? nested?.description ?? null;

  const isCompany =
    details?.is_company === true ||
    nested?.type === "organization" ||
    nested?.type === "company";

  return { providerId, publicId, name, headline, isCompany };
}

function extractPublicIdFromProfileUrl(
  url?: string | null
): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

export async function getPostComments(
  postId: string,
  limit = 10
): Promise<PostCommentList> {
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
  return response.json() as Promise<PostCommentList>;
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
