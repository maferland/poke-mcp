import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _detectSessionId } from "./session-detector.ts";

describe("detectSessionId", () => {
  let tmpDir: string;
  let projectsDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "poke-detect-"));
    projectsDir = join(tmpDir, "projects");
    mkdirSync(projectsDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it("returns undefined when no project dir exists", () => {
    expect(_detectSessionId("/nonexistent/path", projectsDir)).toBeUndefined();
  });

  it("finds session from matching project dir", () => {
    const cwd = "/test/project";
    const encoded = cwd.replace(/[/.]/g, "-");
    const projDir = join(projectsDir, encoded);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "abc-123.jsonl"), "{}");

    expect(_detectSessionId(cwd, projectsDir)).toBe("abc-123");
  });

  it("returns most recently modified file", () => {
    const cwd = "/test/project";
    const encoded = cwd.replace(/[/.]/g, "-");
    const projDir = join(projectsDir, encoded);
    mkdirSync(projDir, { recursive: true });

    const oldFile = join(projDir, "old-session.jsonl");
    writeFileSync(oldFile, "{}");
    const past = new Date(Date.now() - 60000);
    utimesSync(oldFile, past, past);

    writeFileSync(join(projDir, "new-session.jsonl"), "{}");

    expect(_detectSessionId(cwd, projectsDir)).toBe("new-session");
  });

  it("walks up parent directories", () => {
    const parentDir = "/test";
    const encoded = parentDir.replace(/[/.]/g, "-");
    const projDir = join(projectsDir, encoded);
    mkdirSync(projDir, { recursive: true });
    writeFileSync(join(projDir, "parent-session.jsonl"), "{}");

    expect(_detectSessionId("/test/sub/deep", projectsDir)).toBe("parent-session");
  });
});
