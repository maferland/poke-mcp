import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseTranscript } from "./transcript-parser.ts";

function userMsg(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { content: [{ type: "text", text }] },
  });
}

describe("parseTranscript", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "poke-transcript-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("extracts last user message as summary", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, [userMsg("first message"), userMsg("second message")].join("\n"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("second message");
  });

  it("truncates summary to 120 chars", async () => {
    const file = join(tmpDir, "test.jsonl");
    const longMsg = "x".repeat(200);
    writeFileSync(file, userMsg(longMsg));

    const result = await parseTranscript(file);
    expect(result.summary).toHaveLength(120);
  });

  it("returns detail from last 5 messages", async () => {
    const file = join(tmpDir, "test.jsonl");
    const lines = Array.from({ length: 7 }, (_, i) => userMsg(`message ${i}`));
    writeFileSync(file, lines.join("\n"));

    const result = await parseTranscript(file);
    expect(result.detail).toContain("message 2");
    expect(result.detail).toContain("message 6");
    expect(result.detail).not.toContain("message 1");
  });

  it("strips system-reminder tags", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(
      file,
      userMsg("before <system-reminder>noise</system-reminder> after")
    );

    const result = await parseTranscript(file);
    expect(result.summary).toBe("before  after");
  });

  it("strips image tags", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, userMsg("check [Image: screenshot.png] this"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("check  this");
  });

  it("skips short messages (<=5 chars)", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, [userMsg("ok"), userMsg("real message here")].join("\n"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("real message here");
  });

  it("returns empty strings for empty file", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, "");

    const result = await parseTranscript(file);
    expect(result.summary).toBe("");
    expect(result.detail).toBe("");
  });

  it("skips non-user messages", async () => {
    const file = join(tmpDir, "test.jsonl");
    const lines = [
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "assistant msg" }] } }),
      userMsg("user msg"),
    ];
    writeFileSync(file, lines.join("\n"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("user msg");
  });

  it("handles malformed JSON lines gracefully", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, ["not json", userMsg("valid message")].join("\n"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("valid message");
  });

  it("returns empty detail when only one message", async () => {
    const file = join(tmpDir, "test.jsonl");
    writeFileSync(file, userMsg("only message"));

    const result = await parseTranscript(file);
    expect(result.summary).toBe("only message");
    expect(result.detail).toBe("");
  });
});
