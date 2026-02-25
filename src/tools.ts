import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { type Reminder, type ReminderStore } from "./store.ts";
import { parseDueAt } from "./date-parser.ts";

function detectSessionId(): string | undefined {
  const projectsDir = join(homedir(), ".claude", "projects");
  let dir = process.cwd();

  while (dir !== "/") {
    const encoded = dir.replace(/[/.]/g, "-");
    const projectDir = join(projectsDir, encoded);
    try {
      const files = readdirSync(projectDir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({
          name: f,
          mtime: statSync(join(projectDir, f)).mtimeMs,
        }))
        .sort((a, b) => b.mtime - a.mtime);
      if (files.length > 0) {
        return basename(files[0].name, ".jsonl");
      }
    } catch {
      // dir doesn't exist, try parent
    }
    dir = dirname(dir);
  }
  return undefined;
}

export function registerTools(
  server: McpServer,
  store: ReminderStore
): void {
  server.registerTool(
    "poke_create",
    {
      title: "Create Reminder",
      description:
        "Create a poke reminder. due_at accepts ISO8601 or relative ('2h', '30m', 'tomorrow 9am').",
      inputSchema: z.object({
        summary: z.string().describe("What to remind about"),
        detail: z.string().optional().describe("Longer context — recent work, next steps, blockers"),
        sessionId: z.string().optional().describe("Claude session ID for resume"),
        repoPath: z.string().optional().describe("Absolute path to repo"),
        branch: z.string().optional().describe("Git branch name"),
        dueAt: z
          .string()
          .optional()
          .describe("When to remind — ISO8601 or relative ('2h', 'tomorrow 9am')"),
      }),
    },
    async (input) => {
      try {
        let dueAt: string | undefined;
        if (input.dueAt) {
          const parsed = parseDueAt(input.dueAt);
          if (!parsed) {
            return {
              content: [{ type: "text" as const, text: `Cannot parse due_at: "${input.dueAt}"` }],
              isError: true,
            };
          }
          dueAt = parsed.toISOString();
        }

        const sessionId = input.sessionId || detectSessionId();
        const { reminder, created } = store.upsert({ ...input, sessionId, dueAt });
        const verb = created ? "Created" : "Updated";
        return {
          content: [
            {
              type: "text" as const,
              text: `${verb} reminder ${reminder.id.slice(0, 8)}: "${reminder.summary}"${
                reminder.dueAt ? ` (due ${reminder.dueAt})` : ""
              }`,
            },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "poke_list",
    {
      title: "List Reminders",
      description: "List poke reminders. Optionally filter by status.",
      inputSchema: z.object({
        status: z
          .enum(["active", "snoozed", "dismissed", "expired", "in_progress"])
          .optional()
          .describe("Filter by status"),
      }),
    },
    async ({ status }) => {
      try {
        const reminders = store.list(status);
        if (reminders.length === 0) {
          return { content: [{ type: "text" as const, text: status ? `No ${status} reminders.` : "No reminders." }] };
        }
        const text = `${reminders.length} reminder(s):\n${reminders.map(formatReminder).join("\n")}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "poke_snooze",
    {
      title: "Snooze Reminder",
      description:
        "Snooze a reminder. until accepts ISO8601 or relative ('30m', '2h', 'tomorrow 9am').",
      inputSchema: z.object({
        id: z.string().describe("Reminder ID"),
        until: z.string().describe("Snooze until — ISO8601 or relative"),
      }),
    },
    async ({ id, until }) => {
      try {
        const parsed = parseDueAt(until);
        if (!parsed) {
          return {
            content: [{ type: "text" as const, text: `Cannot parse until: "${until}"` }],
            isError: true,
          };
        }
        const reminder = store.snooze(id, parsed.toISOString());
        if (!reminder) {
          return { content: [{ type: "text" as const, text: `Reminder ${id} not found.` }], isError: true };
        }
        return {
          content: [
            { type: "text" as const, text: `Snoozed "${reminder.summary}" until ${reminder.snoozedUntil}` },
          ],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "poke_dismiss",
    {
      title: "Dismiss Reminder",
      description: "Mark a reminder as done.",
      inputSchema: z.object({
        id: z.string().describe("Reminder ID"),
      }),
    },
    async ({ id }) => {
      try {
        const reminder = store.dismiss(id);
        if (!reminder) {
          return { content: [{ type: "text" as const, text: `Reminder ${id} not found.` }], isError: true };
        }
        return {
          content: [{ type: "text" as const, text: `Dismissed "${reminder.summary}".` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "poke_update",
    {
      title: "Update Reminder",
      description: "Update summary or due_at of a reminder.",
      inputSchema: z.object({
        id: z.string().describe("Reminder ID"),
        summary: z.string().optional().describe("New summary"),
        detail: z.string().optional().describe("New detail/context"),
        dueAt: z
          .string()
          .optional()
          .describe("New due_at — ISO8601 or relative"),
      }),
    },
    async ({ id, summary, detail, dueAt }) => {
      try {
        let parsedDueAt: string | undefined;
        if (dueAt) {
          const parsed = parseDueAt(dueAt);
          if (!parsed) {
            return {
              content: [{ type: "text" as const, text: `Cannot parse due_at: "${dueAt}"` }],
              isError: true,
            };
          }
          parsedDueAt = parsed.toISOString();
        }

        const reminder = store.update(id, { summary, detail, dueAt: parsedDueAt });
        if (!reminder) {
          return { content: [{ type: "text" as const, text: `Reminder ${id} not found.` }], isError: true };
        }
        return {
          content: [{ type: "text" as const, text: `Updated "${reminder.summary}".` }],
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "poke_resume",
    {
      title: "Resume Reminder",
      description:
        "Get full context for a reminder and mark it in_progress. Returns resume command if session_id + repo_path are set.",
      inputSchema: z.object({
        id: z.string().describe("Reminder ID"),
        dangerouslySkipPermissions: z
          .boolean()
          .optional()
          .default(true)
          .describe("Add --dangerously-skip-permissions flag"),
      }),
    },
    async ({ id, dangerouslySkipPermissions }) => {
      try {
        const reminder = store.resume(id);
        if (!reminder) {
          return { content: [{ type: "text" as const, text: `Reminder ${id} not found.` }], isError: true };
        }

        const lines = [`Resumed: "${reminder.summary}"`, `Status: ${reminder.status}`];

        if (reminder.sessionId && reminder.repoPath) {
          const skipFlag = dangerouslySkipPermissions
            ? " --dangerously-skip-permissions"
            : "";
          const cmd = `cd ${reminder.repoPath} && claude --resume ${reminder.sessionId}${skipFlag}`;
          lines.push(`\nResume command:\n${cmd}`);
        } else if (reminder.sessionId) {
          lines.push(`Session: ${reminder.sessionId}`);
        }
        if (reminder.repoPath) {
          lines.push(`Repo: ${reminder.repoPath}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }],
          isError: true,
        };
      }
    }
  );
}

function formatReminder(r: Reminder): string {
  const due = r.dueAt ? ` due:${r.dueAt}` : "";
  const repo = r.repoPath ? ` [${r.repoPath.split("/").pop()}]` : "";
  return `- ${r.id.slice(0, 8)} | ${r.status} | "${r.summary}"${repo}${due}`;
}
