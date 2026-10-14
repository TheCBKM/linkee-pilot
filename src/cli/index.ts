#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getDbPath, loadEnv } from "../config/env.js";
import {
  getStatsSummary,
  getAgentState,
  getQuotaRemaining,
  getEsStats,
} from "../db/store.js";
import { isEsConfigured, searchEsPeople } from "../clients/elasticsearch.js";
import { draftNetworkingInviteNote } from "../ai/comment-writer.js";
import { ES_COUNTRIES, ES_SEGMENTS, type EsCountry, type EsSegment } from "../config/es-icp.js";
import {
  readPidFile,
  isAgentRunning,
  removePidFile,
} from "../agent/lifecycle.js";
import { startDaemon } from "../agent/daemon.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const program = new Command();

program
  .name("linkedin-auto")
  .description("LinkedIn Profile Enhancer — background AI agent");

program
  .command("start")
  .description("Start the background agent daemon")
  .option("-f, --foreground", "Run in foreground (default)")
  .option("-d, --daemon", "Run detached in background")
  .action(async (opts: { foreground?: boolean; daemon?: boolean }) => {
    const existingPid = readPidFile();
    if (existingPid) {
      if (isAgentRunning(existingPid)) {
        console.log(`Agent already running (PID ${existingPid})`);
        process.exit(1);
      }
      removePidFile();
    }

    if (opts.daemon) {
      const scriptPath = path.resolve(__dirname, "index.ts");
      const child = spawn("npx", ["tsx", scriptPath, "start", "--foreground"], {
        detached: true,
        stdio: "ignore",
        cwd: path.resolve(__dirname, "../.."),
      });
      child.unref();
      console.log(`Agent started in background (PID ${child.pid})`);
      return;
    }

    await startDaemon();
  });

program
  .command("stop")
  .description("Gracefully stop the background agent")
  .action(() => {
    const pid = readPidFile();
    if (!pid || !isAgentRunning(pid)) {
      console.log("Agent is not running");
      removePidFile();
      return;
    }
    process.kill(pid, "SIGTERM");
    console.log(`Sent SIGTERM to agent (PID ${pid})`);
  });

program
  .command("status")
  .description("Show agent state and quota usage")
  .action(() => {
    const pid = readPidFile();
    const running = pid ? isAgentRunning(pid) : false;
    const stats = getStatsSummary();
    const quotas = getQuotaRemaining();

    console.log("\n=== LinkedIn Agent Status ===\n");
    console.log(`Process: ${running ? `running (PID ${pid})` : "stopped"}`);
    console.log(`Agent status: ${getAgentState("status") ?? "unknown"}`);
    console.log(`Last heartbeat: ${stats.lastHeartbeat ?? "never"}`);
    console.log(`Last action: ${getAgentState("last_action") ?? "none"}`);

    if (stats.halted) {
      console.log(`\n⚠ HALTED: ${stats.haltReason}`);
    }

    console.log("\n--- Quotas (used / cap) ---");
    for (const [type, { used, cap }] of Object.entries(quotas)) {
      console.log(`  ${type}: ${used} / ${cap}`);
    }

    const es = getEsStats();
    if (Object.keys(es.byStatus).length > 0) {
      console.log("\n--- ES invite pipeline ---");
      console.log(
        `  ES agent: ${getAgentState("es_status") ?? "n/a"} (heartbeat ${getAgentState("es_last_heartbeat") ?? "never"}, last ${getAgentState("es_last_action") ?? "none"})`
      );
      for (const [status, n] of Object.entries(es.byStatus)) {
        console.log(`  ${status}: ${n}`);
      }
      for (const [country, c] of Object.entries(es.byCountry)) {
        console.log(
          `  ${country}: queued ${c.queued}, invited ${c.invited} (last 24h ${c.invited24h})`
        );
      }
    }

    console.log("\n--- Actions today ---");
    const actions = stats.actionsToday;
    if (Object.keys(actions).length === 0) {
      console.log("  (none)");
    } else {
      for (const [type, count] of Object.entries(actions)) {
        console.log(`  ${type}: ${count}`);
      }
    }
    console.log();
  });

program
  .command("stats")
  .description("Show follower growth and action history")
  .action(() => {
    const stats = getStatsSummary();

    console.log("\n=== LinkedIn Agent Stats ===\n");

    console.log("Follower history (recent):");
    if (stats.followerHistory.length === 0) {
      console.log("  (no data yet)");
    } else {
      for (const row of stats.followerHistory.slice(0, 10)) {
        console.log(`  ${row.recorded_at}: ${row.count} followers`);
      }
    }

    console.log("\nActions today:");
    for (const [type, count] of Object.entries(stats.actionsToday)) {
      console.log(`  ${type}: ${count}`);
    }

    console.log(`\nDatabase: ${getDbPath()}`);
    console.log();
  });

program
  .command("es-preview")
  .description("Preview Elasticsearch candidates (no LinkedIn calls, nothing saved)")
  .option("-c, --country <country>", `One of: ${ES_COUNTRIES.join(", ")}`, "united states")
  .option("-s, --segment <segment>", `One of: ${ES_SEGMENTS.join(", ")}`, "eng_executives")
  .option("-n, --size <n>", "How many to show", "10")
  .option("--notes", "Also draft the invite note for each person (OpenAI, not saved)")
  .action(async (opts: { country: string; segment: string; size: string; notes?: boolean }) => {
    loadEnv({ requireApiKeys: false });
    if (!isEsConfigured()) {
      console.error("Set ES_URL, ES_USERNAME and ES_PASSWORD in .env");
      process.exit(1);
    }
    if (!(ES_COUNTRIES as readonly string[]).includes(opts.country)) {
      console.error(`Unknown country: ${opts.country}`);
      process.exit(1);
    }
    if (!(ES_SEGMENTS as readonly string[]).includes(opts.segment)) {
      console.error(`Unknown segment: ${opts.segment}`);
      process.exit(1);
    }

    const people = await searchEsPeople({
      country: opts.country as EsCountry,
      segment: opts.segment as EsSegment,
      size: parseInt(opts.size, 10) || 10,
    });
    console.log(`\n${people.length} candidates (${opts.country}, ${opts.segment}):\n`);
    for (const p of people) {
      console.log(`  ${p.fullName ?? "?"} | ${p.jobTitle ?? "?"} @ ${p.company ?? "?"}`);
      console.log(`    ${p.linkedinUrl ?? p.linkedinUsername}`);
      if (opts.notes) {
        const note = await draftNetworkingInviteNote({
          name: p.fullName ?? undefined,
          title: p.jobTitle ?? undefined,
          company: p.company ?? undefined,
          headline: p.headline ?? undefined,
          preview: true,
        });
        console.log(
          note
            ? `    NOTE (${note.length} chars): ${note}`
            : "    NOTE: blocked by safety filter (invite would go without a note)"
        );
      }
      console.log();
    }
    console.log();
  });

program.parse();
