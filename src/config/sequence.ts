export const SEQUENCE_STAGES = [
  "discovered",
  "liked",
  "commented",
  "viewed",
  "invite_ready",
  "invited",
] as const;

export type SequenceStage = (typeof SEQUENCE_STAGES)[number];

const STAGE_ORDER: Record<SequenceStage, number> = {
  discovered: 0,
  liked: 1,
  commented: 2,
  viewed: 3,
  invite_ready: 4,
  invited: 5,
};

export function stageRank(stage: string | null | undefined): number {
  if (!stage) return -1;
  return STAGE_ORDER[stage as SequenceStage] ?? -1;
}

export function isStageAtLeast(
  current: string | null | undefined,
  min: SequenceStage
): boolean {
  return stageRank(current) >= stageRank(min);
}

export function maxStage(
  a: SequenceStage,
  b: SequenceStage
): SequenceStage {
  return stageRank(a) >= stageRank(b) ? a : b;
}

export type PersonSource = "post" | "search";

export type PersonTouch = "liked" | "commented" | "viewed";

export function checkInviteReady(params: {
  sequenceStage: string | null | undefined;
  source: PersonSource | null | undefined;
  touches?: Partial<Record<PersonTouch, boolean>>;
}): boolean {
  const stage = params.sequenceStage ?? "discovered";
  if (stage === "invite_ready") return true;
  if (stage === "invited") return false;

  const touches = params.touches ?? {};

  if (params.source === "search") {
    return touches.viewed === true || isStageAtLeast(stage, "viewed");
  }

  const commented =
    touches.commented === true || isStageAtLeast(stage, "commented");
  const viewed = touches.viewed === true || isStageAtLeast(stage, "viewed");
  return commented && viewed;
}
