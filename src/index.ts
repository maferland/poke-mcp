#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { ReminderStore } from "./store.ts";
import { registerTools } from "./tools.ts";

const DB_DIR = join(homedir(), ".claude");
mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = join(DB_DIR, "poke.db");

const store = new ReminderStore(DB_PATH);
const server = new McpServer({
  name: "poke",
  version: "0.1.0",
});

registerTools(server, store);

const transport = new StdioServerTransport();
await server.connect(transport);
