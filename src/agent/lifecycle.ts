import fs from "node:fs";
import { getPidPath } from "../config/env.js";
import { setAgentState } from "../db/store.js";

let shuttingDown = false;
let currentActionPromise: Promise<void> | null = null;

export function setupLifecycle(onShutdown: () => Promise<void>): void {
  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[agent] Received ${signal}, shutting down gracefully...`);
    setAgentState("status", "stopping");

    if (currentActionPromise) {
      await currentActionPromise.catch(() => {});
    }

    await onShutdown();
    removePidFile();
    setAgentState("status", "stopped");
    process.exit(0);
  };

  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("SIGINT", () => handleSignal("SIGINT"));
}

export function setCurrentAction(promise: Promise<void>): void {
  currentActionPromise = promise;
}

export function isShuttingDown(): boolean {
  return shuttingDown;
}

export function writePidFile(): void {
  fs.writeFileSync(getPidPath(), String(process.pid));
}

export function removePidFile(): void {
  try {
    fs.unlinkSync(getPidPath());
  } catch {
    // ignore
  }
}

export function readPidFile(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(getPidPath(), "utf-8"), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

export function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function writeHeartbeat(lastAction?: string): void {
  setAgentState("last_heartbeat", new Date().toISOString());
  setAgentState("status", "running");
  if (lastAction) {
    setAgentState("last_action", lastAction);
  }
}
