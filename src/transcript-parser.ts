import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const SYSTEM_REMINDER_RE = /<system-reminder>[\s\S]*?<\/system-reminder>/g;
const LOCAL_COMMAND_RE = /<local-command[\s\S]*?<\/local-command-stdout>/g;
const IMAGE_BRACKET_RE = /\[Image:.*?\]/g;
const IMAGE_TAG_RE = /\[image\]/gi;

function clean(text: string): string {
  return text
    .replace(SYSTEM_REMINDER_RE, "")
    .replace(LOCAL_COMMAND_RE, "")
    .replace(IMAGE_BRACKET_RE, "")
    .replace(IMAGE_TAG_RE, "")
    .trim();
}

export interface TranscriptResult {
  summary: string;
  detail: string;
}

/**
 * Parse a .jsonl session transcript, extracting user messages.
 * Returns last message as summary (truncated to 120 chars)
 * and last 5 messages as detail context.
 */
export async function parseTranscript(filePath: string): Promise<TranscriptResult> {
  const msgs: string[] = [];

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    if (obj.type !== "user") continue;

    const msg = obj.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== "object") continue;

    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (
        typeof part === "object" &&
        part !== null &&
        (part as Record<string, unknown>).type === "text"
      ) {
        const text = clean(String((part as Record<string, unknown>).text ?? ""));
        if (text.length > 5) {
          msgs.push(text);
        }
      }
    }
  }

  const summary = msgs.length > 0 ? msgs[msgs.length - 1].slice(0, 120) : "";
  const detail =
    msgs.length > 1
      ? msgs
          .slice(-5)
          .map((m) => m.slice(0, 200))
          .join("\n---\n")
          .slice(0, 1000)
      : "";

  return { summary, detail };
}
