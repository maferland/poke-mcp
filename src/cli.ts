#!/usr/bin/env bun
import { join } from "node:path";
import { homedir } from "node:os";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { ReminderStore } from "./store.ts";
import { detectSessionContext } from "./session-detector.ts";
import { parseTranscript } from "./transcript-parser.ts";

const DB_DIR = join(homedir(), ".claude");
const DB_PATH = join(DB_DIR, "poke.db");
const CHECKPOINT_DIR = join(homedir(), ".claude", "poke-checkpoints");
const DEFAULT_THROTTLE = 60;

function getStore(): ReminderStore {
  mkdirSync(DB_DIR, { recursive: true });
  return new ReminderStore(DB_PATH);
}

async function checkpointSession(throttleSeconds: number): Promise<void> {
  const ctx = detectSessionContext();
  if (!ctx) return;

  // Throttle: skip if checkpoint file modified recently
  mkdirSync(CHECKPOINT_DIR, { recursive: true });
  const checkpointFile = join(CHECKPOINT_DIR, ctx.sessionId);
  if (existsSync(checkpointFile)) {
    const lastMod = statSync(checkpointFile).mtimeMs;
    if (Date.now() - lastMod < throttleSeconds * 1000) return;
  }

  // Parse transcript for summary/detail
  const encoded = ctx.sessionDir.replace(/[/.]/g, "-");
  const sessionFile = join(homedir(), ".claude", "projects", encoded, `${ctx.sessionId}.jsonl`);

  let summary = `Session in ${ctx.repoName}`;
  let detail = "";

  if (existsSync(sessionFile)) {
    const result = await parseTranscript(sessionFile);
    if (result.summary) summary = result.summary;
    if (result.detail) detail = result.detail;
  }

  const store = getStore();
  try {
    // Auto-dismiss stale reminders for same repo when session changes
    store.dismissOtherSessions(ctx.repoPath, ctx.sessionId);

    store.upsert({
      summary,
      detail: detail || undefined,
      sessionId: ctx.sessionId,
      repoPath: ctx.repoPath,
      sessionDir: ctx.sessionDir,
      repoName: ctx.repoName,
      branch: ctx.branch ?? undefined,
    });
  } finally {
    store.close();
  }

  // Touch checkpoint
  writeFileSync(checkpointFile, "");
}

function expire(): void {
  if (!existsSync(DB_PATH)) return;
  const store = getStore();
  try {
    store.expire();
  } finally {
    store.close();
  }
}

function list(): void {
  if (!existsSync(DB_PATH)) return;
  const store = getStore();
  try {
    const reminders = store.list("active");
    if (reminders.length === 0) return;

    console.log("POKE: Active reminders:");
    for (const r of reminders.slice(0, 10)) {
      console.log(`  - [${r.id}] ${r.summary}`);
      if (r.sessionId) {
        console.log(`    session: ${r.sessionId}`);
      }
    }
    console.log("");
    console.log("Use poke_resume to resume a reminder, or poke_list for all reminders.");
  } finally {
    store.close();
  }
}

// --- Main ---
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "checkpoint-session": {
    let throttle = DEFAULT_THROTTLE;
    const idx = args.indexOf("--throttle");
    if (idx !== -1 && args[idx + 1]) {
      throttle = parseInt(args[idx + 1], 10) || DEFAULT_THROTTLE;
    }
    await checkpointSession(throttle);
    break;
  }
  case "expire":
    expire();
    break;
  case "list":
    list();
    break;
  default:
    console.error(`Usage: poke-cli <checkpoint-session|expire|list>`);
    process.exit(1);
}
