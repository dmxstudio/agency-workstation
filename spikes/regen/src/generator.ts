import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { specArtifactsSchema, type SpecArtifacts } from "./schemas";
import {
  MANIFEST_FILENAME,
  serializeManifest,
  sha256,
  type OwnershipManifest,
} from "./ownership";
import { renderCodegenFiles, renderHumanScaffolds } from "./render";

export interface GenerateResult {
  outDir: string;
  codegenFiles: string[];
  humanFiles: string[];
  manifest: OwnershipManifest;
}

function writeFileEnsuringDir(outDir: string, relPath: string, content: string): void {
  const abs = join(outDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

/**
 * Initial generation (§7.3 simulated): spec artifacts → fresh project tree
 * with an ownership manifest. Refuses to run on a directory that already has
 * a manifest — regeneration is a different operation with different rules.
 */
export function generate(rawSpec: unknown, outDir: string): GenerateResult {
  // Write-time validation, same rule as the platform (§19: Zod on every write).
  const spec: SpecArtifacts = specArtifactsSchema.parse(rawSpec);

  if (existsSync(join(outDir, MANIFEST_FILENAME))) {
    throw new Error(
      `\`${outDir}\` ya contiene un proyecto generado; usa regenerate() en su lugar.`,
    );
  }
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  const manifest: OwnershipManifest = { spike: "regen", manifestVersion: 1, files: {} };

  const codegen = renderCodegenFiles(spec);
  for (const [relPath, content] of codegen) {
    writeFileEnsuringDir(outDir, relPath, content);
    manifest.files[relPath] = { owner: "codegen", contentHash: sha256(content) };
  }

  const human = renderHumanScaffolds(spec);
  for (const [relPath, content] of human) {
    writeFileEnsuringDir(outDir, relPath, content);
    // Human-owned: scaffolded once; no hash tracked because codegen will
    // never compare or rewrite this file again.
    manifest.files[relPath] = { owner: "human", contentHash: null };
  }

  writeFileSync(join(outDir, MANIFEST_FILENAME), serializeManifest(manifest), "utf8");

  return {
    outDir,
    codegenFiles: [...codegen.keys()].sort(),
    humanFiles: [...human.keys()].sort(),
    manifest,
  };
}
