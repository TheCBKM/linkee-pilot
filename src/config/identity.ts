import { getEnv } from "./env.js";

/** LinkedIn provider_id of the account this agent runs as. */
export function getOwnProviderId(): string {
  return getEnv().OWN_PROVIDER_ID.trim();
}

/** True when the given id is the agent's own LinkedIn profile. */
export function isOwnProviderId(providerId?: string | null): boolean {
  const own = getOwnProviderId();
  if (!own || !providerId) return false;
  return (
    providerId === own ||
    providerId === `person:${own}` ||
    providerId.replace(/^person:/, "") === own
  );
}
