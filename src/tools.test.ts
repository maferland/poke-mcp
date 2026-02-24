import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "./tools.ts";
import { ReminderStore } from "./store.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function getText(result: Awaited<ReturnType<Client["callTool"]>>): string {
  return (result.content as Array<{ text: string }>)[0].text;
}

describe("MCP Tools", () => {
  let server: McpServer;
  let client: Client;
  let store: ReminderStore;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "poke-test-"));
    store = new ReminderStore(join(tmpDir, "test.db"));
    server = new McpServer({ name: "poke", version: "0.1.0" });
    registerTools(server, store);

    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(() => {
    store.close();
    rmSync(tmpDir, { recursive: true });
  });

  it("poke_create creates a reminder", async () => {
    const result = await client.callTool({
      name: "poke_create",
      arguments: { summary: "finish auth PR" },
    });
    const text = getText(result);
    expect(text).toContain("Created reminder");
    expect(text).toContain("finish auth PR");
  });

  it("poke_create with due_at parses relative time", async () => {
    const result = await client.callTool({
      name: "poke_create",
      arguments: { summary: "test", dueAt: "2h" },
    });
    const text = getText(result);
    expect(text).toContain("Created reminder");
    expect(text).toContain("(due ");
  });

  it("poke_create rejects unparseable due_at", async () => {
    const result = await client.callTool({
      name: "poke_create",
      arguments: { summary: "test", dueAt: "gibberish" },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Cannot parse");
  });

  it("poke_list returns empty message", async () => {
    const result = await client.callTool({
      name: "poke_list",
      arguments: {},
    });
    expect(getText(result)).toBe("No reminders.");
  });

  it("poke_list returns reminders", async () => {
    await client.callTool({
      name: "poke_create",
      arguments: { summary: "one", sessionId: "sess-list-1" },
    });
    await client.callTool({
      name: "poke_create",
      arguments: { summary: "two", sessionId: "sess-list-2" },
    });
    const result = await client.callTool({
      name: "poke_list",
      arguments: {},
    });
    expect(getText(result)).toContain("2 reminder(s)");
  });

  it("poke_list filters by status", async () => {
    await client.callTool({
      name: "poke_create",
      arguments: { summary: "active one" },
    });
    const result = await client.callTool({
      name: "poke_list",
      arguments: { status: "dismissed" },
    });
    expect(getText(result)).toBe("No dismissed reminders.");
  });

  it("poke_dismiss marks as done", async () => {
    const createResult = await client.callTool({
      name: "poke_create",
      arguments: { summary: "test" },
    });
    const id = getText(createResult).match(/reminder (\w+)/)?.[1];
    const reminders = store.list();
    const fullId = reminders[0].id;

    const result = await client.callTool({
      name: "poke_dismiss",
      arguments: { id: fullId },
    });
    expect(getText(result)).toContain('Dismissed "test"');
  });

  it("poke_snooze snoozes a reminder", async () => {
    const r = store.create({ summary: "test" });
    const result = await client.callTool({
      name: "poke_snooze",
      arguments: { id: r.id, until: "2h" },
    });
    expect(getText(result)).toContain("Snoozed");
  });

  it("poke_update updates summary", async () => {
    const r = store.create({ summary: "old" });
    const result = await client.callTool({
      name: "poke_update",
      arguments: { id: r.id, summary: "new" },
    });
    expect(getText(result)).toContain('Updated "new"');
  });

  it("poke_resume returns resume command", async () => {
    const r = store.create({
      summary: "continue auth",
      sessionId: "sess-abc",
      repoPath: "/repo/myapp",
    });
    const result = await client.callTool({
      name: "poke_resume",
      arguments: { id: r.id },
    });
    const text = getText(result);
    expect(text).toContain("cd /repo/myapp && claude --resume sess-abc");
    expect(text).toContain("--dangerously-skip-permissions");
  });

  it("poke_resume without skip permissions flag", async () => {
    const r = store.create({
      summary: "continue",
      sessionId: "sess-xyz",
      repoPath: "/repo/app",
    });
    const result = await client.callTool({
      name: "poke_resume",
      arguments: { id: r.id, dangerouslySkipPermissions: false },
    });
    const text = getText(result);
    expect(text).toContain("cd /repo/app && claude --resume sess-xyz");
    expect(text).not.toContain("--dangerously-skip-permissions");
  });

  it("poke_resume for not-found id", async () => {
    const result = await client.callTool({
      name: "poke_resume",
      arguments: { id: "nonexistent" },
    });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("not found");
  });

  it("poke_create deduplicates by session_id", async () => {
    const r1 = await client.callTool({
      name: "poke_create",
      arguments: { summary: "first", sessionId: "sess-dedup" },
    });
    expect(getText(r1)).toContain("Created");

    const r2 = await client.callTool({
      name: "poke_create",
      arguments: { summary: "updated", sessionId: "sess-dedup" },
    });
    expect(getText(r2)).toContain("Updated");

    const list = await client.callTool({
      name: "poke_list",
      arguments: {},
    });
    expect(getText(list)).toContain("1 reminder(s)");
    expect(getText(list)).toContain("updated");
  });
});
