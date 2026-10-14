import fs from "node:fs";
import { getPidPath } from "../config/env.js";
import { setAgentState } from "../db/store.js";
import { notifyDiscord } from "../notifications/discord.js";
import { getEnv } from "../config/env.js";

/** ES-only containers keep their own status/heartbeat keys. */
export function stateKey(name: string): string {
  return getEnv().AGENT_MODE === "es" ? `es_${name}` : name;
}

let shuttingDown = false;
let currentActionPromise: Promise<void> | null = null;

export function setupLifecycle(onShutdown: () => Promise<void>): void {
  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[agent] Received ${signal}, shutting down gracefully...`);
    setAgentState(stateKey("status"), "stopping");

    if (currentActionPromise) {
      await currentActionPromise.catch(() => {});
    }

    await onShutdown();
    removePidFile();
    setAgentState(stateKey("status"), "stopped");
    await notifyDiscord({
      title: "Agent · Stopped",
      description: `Graceful shutdown after ${signal}.`,
      severity: "info",
      fields: [{ name: "Signal", value: signal, inline: true }],
    });
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

function readProcessCmdline(pid: number): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf-8").replace(/\0/g, " ");
  } catch {
    return null;
  }
}

function isAgentCmdline(cmdline: string): boolean {
  return (
    cmdline.includes("dist/cli/index.js") ||
    cmdline.includes("cli/index.ts")
  );
}

/** True if another agent process is running (not a stale Docker PID-1 lock file). */
export function isAgentRunning(pid: number): boolean {
  // Stale lock from a previous container: Docker always runs the main process as PID 1.
  if (pid === process.pid) {
    return false;
  }

  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }

  const cmdline = readProcessCmdline(pid);
  if (cmdline === null) {
    return true;
  }

  return isAgentCmdline(cmdline);
}

/** @deprecated Prefer isAgentRunning for agent singleton checks. */
export function isProcessRunning(pid: number): boolean {
  return isAgentRunning(pid);
}

export function writeHeartbeat(lastAction?: string): void {
  setAgentState(stateKey("last_heartbeat"), new Date().toISOString());
  setAgentState(stateKey("status"), "running");
  if (lastAction) {
    setAgentState(stateKey("last_action"), lastAction);
  }
}
