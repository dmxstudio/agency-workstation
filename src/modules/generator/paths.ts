import path from "node:path";

/**
 * Filesystem layout of the generator (§18.3 local resolution):
 *
 * - Each generated project lives in its own LOCAL git repository under
 *   `.data/projects/<projectId>/` (override base dir: `GENERATED_PROJECTS_DIR`).
 * - Generation starts from the project template at `templates/project-base`
 *   (override: `PROJECT_TEMPLATE_DIR` — used by smoke tests with a fixture).
 *
 * Env vars are read at call time (not module load) so test harnesses can set
 * them before invoking the service.
 */

/** Base directory containing one git repo per generated project. */
export function getProjectsBaseDir(): string {
  return process.env.GENERATED_PROJECTS_DIR ?? path.join(process.cwd(), ".data", "projects");
}

/** Git repository directory of a generated project. */
export function getProjectRepoDir(projectId: string): string {
  return path.join(getProjectsBaseDir(), projectId);
}

/**
 * Base URL where the generated site serves locally (the template's `dev`
 * script defaults to port 4000). Override: `GENERATED_SITE_URL`. The platform
 * only links here — whether the project is actually running is up to the user.
 */
export function getGeneratedSiteUrl(): string {
  return process.env.GENERATED_SITE_URL ?? "http://localhost:4000";
}

/** Source template copied on first generation. */
export function getTemplateDir(): string {
  return (
    process.env.PROJECT_TEMPLATE_DIR ?? path.join(process.cwd(), "templates", "project-base")
  );
}

/** Directory names never copied from the template into a generated repo. */
export const TEMPLATE_COPY_EXCLUDES = new Set(["node_modules", ".next", ".data", ".git"]);
