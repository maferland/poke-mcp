import { readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";

export interface SessionContext {
  sessionId: string;
  sessionDir: string;
  repoPath: string;
  repoName: string;
  branch: string | null;
}

interface SessionMatch {
  sessionId: string;
  sessionDir: string;
}

function findSession(cwd: string, projectsDir: string): SessionMatch | null {
  let dir = cwd;
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
        return {
          sessionId: basename(files[0].name, ".jsonl"),
          sessionDir: dir,
        };
      }
    } catch {
      // dir doesn't exist, try parent
    }
    dir = dirname(dir);
  }
  return null;
}

/** @internal Exposed for testing — pass custom projectsDir */
export function _detectSessionId(cwd: string, projectsDir: string): string | undefined {
  return findSession(cwd, projectsDir)?.sessionId;
}

/**
 * Walk up from cwd to find the most recently modified .jsonl session file
 * under ~/.claude/projects/<encoded-dir>/
 */
export function detectSessionId(cwd = process.cwd()): string | undefined {
  return _detectSessionId(cwd, join(homedir(), ".claude", "projects"));
}

function git(args: string, cwd?: string): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Detect full session context: session ID, directories, repo info, branch.
 * Returns null if no active session found.
 */
export function detectSessionContext(cwd = process.cwd()): SessionContext | null {
  const projectsDir = join(homedir(), ".claude", "projects");
  const match = findSession(cwd, projectsDir);
  if (!match) return null;

  const { sessionId, sessionDir } = match;
  const repoRoot = git("rev-parse --show-toplevel", sessionDir) ?? sessionDir;
  let repoName = basename(repoRoot);

  // For worktrees, resolve main repo name for consistent grouping
  const gitCommon = git("rev-parse --git-common-dir", sessionDir);
  if (gitCommon && gitCommon !== ".git") {
    try {
      const mainRepo = execSync("pwd", {
        cwd: join(sessionDir, gitCommon, ".."),
        encoding: "utf-8",
      }).trim();
      if (mainRepo) repoName = basename(mainRepo);
    } catch {
      // ignore
    }
  }

  const rawBranch = git("rev-parse --abbrev-ref HEAD", sessionDir);
  const branch = rawBranch && rawBranch !== "HEAD" ? rawBranch : null;

  return { sessionId, sessionDir, repoPath: repoRoot, repoName, branch };
}
