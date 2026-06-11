import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { GeneratorDomainError } from "./errors";

const execFileAsync = promisify(execFile);

/**
 * Git layer (§16): the platform writes to each generated project through git
 * commits with descriptive messages — traceability for free. Commits are
 * authored by a fixed platform identity, never by the user's global config.
 */

export const GIT_AUTHOR_NAME = "Agency Workstation";
export const GIT_AUTHOR_EMAIL = "generator@local";

const IDENTITY_ARGS = [
  "-c",
  `user.name=${GIT_AUTHOR_NAME}`,
  "-c",
  `user.email=${GIT_AUTHOR_EMAIL}`,
];

export async function runGit(repoDir: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", [...IDENTITY_ARGS, ...args], {
      cwd: repoDir,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new GeneratorDomainError(
      "GIT_FAILED",
      `Fallo de git en el repo del proyecto (git ${args.join(" ")}).`,
      detail,
    );
  }
}

export async function gitInit(repoDir: string): Promise<void> {
  await runGit(repoDir, ["init", "--quiet", "--initial-branch=main"]);
}

/** Stages ONLY the given paths (additions, modifications and deletions). */
export async function gitStagePaths(repoDir: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  await runGit(repoDir, ["add", "-A", "--", ...paths]);
}

export async function gitStageAll(repoDir: string): Promise<void> {
  await runGit(repoDir, ["add", "-A"]);
}

/** Commits staged changes; returns the commit hash (or null if nothing staged). */
export async function gitCommit(repoDir: string, message: string): Promise<string | null> {
  const staged = await runGit(repoDir, ["diff", "--cached", "--name-only"]);
  if (staged === "") return null;
  await runGit(repoDir, ["commit", "--quiet", "-m", message]);
  return runGit(repoDir, ["rev-parse", "HEAD"]);
}

export async function gitLog(repoDir: string, limit = 20): Promise<string[]> {
  const out = await runGit(repoDir, ["log", `--max-count=${limit}`, "--pretty=format:%H %s"]);
  return out === "" ? [] : out.split("\n");
}

/**
 * Tags HEAD with `tag` (§7.8: releases carry a `release-N` tag in the
 * generated repo). `--force` keeps a retried release creation idempotent if a
 * previous attempt died between tagging and recording. Returns the tagged
 * commit hash.
 */
export async function gitTag(repoDir: string, tag: string): Promise<string> {
  await runGit(repoDir, ["tag", "--force", tag, "HEAD"]);
  return runGit(repoDir, ["rev-parse", "HEAD"]);
}

/** Lists tags in the repo (sorted by name). */
export async function gitListTags(repoDir: string): Promise<string[]> {
  const out = await runGit(repoDir, ["tag", "--list", "--sort=refname"]);
  return out === "" ? [] : out.split("\n");
}
