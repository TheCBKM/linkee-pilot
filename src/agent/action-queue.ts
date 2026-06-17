import type { ScheduledAction } from "./session-scheduler.js";

export interface QueuedAction {
  id: string;
  action: ScheduledAction;
  priority: number;
  createdAt: Date;
}

const queue: QueuedAction[] = [];

export function enqueue(action: ScheduledAction, priority = 0): void {
  queue.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action,
    priority,
    createdAt: new Date(),
  });
  queue.sort((a, b) => b.priority - a.priority);
}

export function dequeue(): ScheduledAction | null {
  const item = queue.shift();
  return item?.action ?? null;
}

export function queueSize(): number {
  return queue.length;
}

export function clearQueue(): void {
  queue.length = 0;
}

export function peek(): ScheduledAction | null {
  return queue[0]?.action ?? null;
}
