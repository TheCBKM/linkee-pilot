import { LIMITS } from "../config/limits.js";

function gaussianRandom(mean: number, stdDev: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const num = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return num * stdDev + mean;
}

export function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function weightedPick<T>(items: T[], weights: number[]): T | null {
  if (items.length === 0) return null;
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0) return items[0];

  let roll = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function humanDelayMs(): number {
  const { minDelayMs, maxDelayMs, meanDelayMs } = LIMITS.timing;
  const stdDev = (maxDelayMs - minDelayMs) / 6;
  const delay = gaussianRandom(meanDelayMs, stdDev);
  return Math.max(minDelayMs, Math.min(maxDelayMs, Math.round(delay)));
}

export function burstPauseMs(): number {
  const { burstPauseMinMs, burstPauseMaxMs } = LIMITS.timing;
  return randomBetween(burstPauseMinMs, burstPauseMaxMs);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function humanDelay(): Promise<void> {
  const ms = humanDelayMs();
  await sleep(ms);
}

export function pickReactionType(): string {
  const roll = Math.random();
  if (roll < LIMITS.reactionMix.like) return "like";
  if (roll < LIMITS.reactionMix.like + LIMITS.reactionMix.insightful)
    return "insightful";
  return "celebrate";
}
