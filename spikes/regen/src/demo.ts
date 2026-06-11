import { readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { generate } from "./generator";
import { regenerate } from "./regenerate";
import { specV1, specV2, specV3 } from "./fixtures";
import { sha256 } from "./ownership";
import { formatConflict } from "./conflicts";

/**
 * Scripted demo of the §18.2 exit criteria, printing PASS/FAIL per step:
 *
 *   generate project with collections from the spec
 *   → user modifies composed pages (simulated edit)
 *   → CMS schema regenerated (spec changed: field ADDED + bound field REMOVED)
 *   → composed pages are NOT overwritten
 *   → the removed field still used by a binding is reported as a conflict
 *   plus: human edit inside a codegen zone → conflict; double regen → idempotent.
 */

const OUT_DIR = join(import.meta.dirname, "..", ".data", "demo-out");
// Fresh output on every run: the demo exercises generate() from scratch.
rmSync(OUT_DIR, { recursive: true, force: true });

let failures = 0;
function check(label: string, ok: boolean, detail?: string): void {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}
function step(title: string): void {
  console.log(`\nPASO: ${title}`);
}

function treeHashes(dir: string, base = dir): Map<string, string> {
  const out = new Map<string, string>();
  for (const name of readdirSync(dir).sort()) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      for (const [k, v] of treeHashes(abs, base)) out.set(k, v);
    } else {
      out.set(abs.slice(base.length + 1), sha256(readFileSync(abs, "utf8")));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
step("1. Generar proyecto con colecciones desde la spec (v1)");
const gen = generate(specV1, OUT_DIR);
check(
  "payload.config.ts + collections/*.ts generados",
  gen.codegenFiles.includes("payload.config.ts") &&
    gen.codegenFiles.includes("collections/posts.ts") &&
    gen.codegenFiles.includes("collections/authors.ts"),
);
check(
  "rutas desde spec.sitemap (home, blog, blog/archivo, sobre-nosotros)",
  ["app/page.tsx", "app/blog/page.tsx", "app/blog/archivo/page.tsx", "app/sobre-nosotros/page.tsx"].every(
    (f) => gen.codegenFiles.includes(f),
  ),
);
check(
  "composiciones page-*.json como owned-by-human",
  gen.humanFiles.includes("compositions/page-home.json") &&
    gen.manifest.files["compositions/page-home.json"]?.owner === "human",
);
check(
  "archivos codegen llevan header marker + hash",
  readFileSync(join(OUT_DIR, "collections/posts.ts"), "utf8").includes("@generated") &&
    readFileSync(join(OUT_DIR, "collections/posts.ts"), "utf8").includes("content-hash: sha256:"),
);

// ---------------------------------------------------------------------------
step("2. El usuario modifica páginas compuestas (edición simulada)");
const homePath = join(OUT_DIR, "compositions/page-home.json");
const homeEdited = JSON.parse(readFileSync(homePath, "utf8"));
homeEdited.sections.push({
  id: "cta",
  component: "cta-banner",
  props: { tone: "dark", label: "Contacta" },
  bindings: {},
});
homeEdited.sections[0].props.headlineSize = "2xl";
writeFileSync(homePath, JSON.stringify(homeEdited, null, 2) + "\n", "utf8");
const homeHashAfterEdit = sha256(readFileSync(homePath, "utf8"));
check("page-home.json editado por el humano (sección añadida + prop cambiada)", true);

// ---------------------------------------------------------------------------
step(
  "3. Regenerar CMS schema con spec v2 (posts.heroImage AÑADIDO, posts.subtitle ELIMINADO y aún bindeado)",
);
const regen1 = regenerate(specV2, OUT_DIR);
check(
  "collections/posts.ts re-generado con el campo añadido",
  regen1.written.includes("collections/posts.ts") &&
    readFileSync(join(OUT_DIR, "collections/posts.ts"), "utf8").includes("heroImage") &&
    !readFileSync(join(OUT_DIR, "collections/posts.ts"), "utf8").includes("subtitle"),
);
check(
  "solo zonas codegen tocadas (ningún archivo humano en written/created)",
  [...regen1.written, ...regen1.created].every((f) => !f.startsWith("compositions/")),
  `written=[${regen1.written.join(", ")}]`,
);

step("4. Las páginas compuestas NO se sobrescriben");
const homeHashAfterRegen = sha256(readFileSync(homePath, "utf8"));
check(
  "page-home.json byte-idéntico tras la regeneración (incluida la edición humana)",
  homeHashAfterRegen === homeHashAfterEdit,
);
check(
  "page-home.json listado como preservado",
  regen1.preservedHuman.includes("compositions/page-home.json"),
);

step("5. Campo eliminado usado por binding → CONFLICTO descriptivo, página intacta");
const bindingConflict = regen1.conflicts.find(
  (c) =>
    c.kind === "binding-missing-field" &&
    c.page === "home" &&
    c.sectionId === "intro" &&
    c.field === "subtitle" &&
    c.collection === "posts",
);
check(
  "conflicto binding-missing-field con página, sección, prop y campo",
  Boolean(bindingConflict),
  bindingConflict ? formatConflict(bindingConflict) : "no reportado",
);
check(
  "la página bindeada no fue modificada para 'arreglar' el binding",
  sha256(readFileSync(homePath, "utf8")) === homeHashAfterEdit,
);

// ---------------------------------------------------------------------------
step("6. Edición humana DENTRO de zona codegen → conflicto, archivo no tocado");
const authorsPath = join(OUT_DIR, "collections/authors.ts");
const authorsHacked = readFileSync(authorsPath, "utf8") + "\n// manual hack: custom hook\n";
writeFileSync(authorsPath, authorsHacked, "utf8");
const regen2 = regenerate(specV3, OUT_DIR); // v3 quiere añadir authors.avatar
const editConflict = regen2.conflicts.find(
  (c) => c.kind === "human-edit-in-codegen-zone" && c.path === "collections/authors.ts",
);
check(
  "conflicto human-edit-in-codegen-zone reportado",
  Boolean(editConflict),
  editConflict ? formatConflict(editConflict) : "no reportado",
);
check(
  "collections/authors.ts NO sobrescrito (la edición manual sigue ahí)",
  readFileSync(authorsPath, "utf8") === authorsHacked &&
    !regen2.written.includes("collections/authors.ts"),
);

// Resolución manual simulada: el humano revierte su hack; la siguiente
// regeneración ya puede aplicar el cambio de spec pendiente (authors.avatar).
writeFileSync(authorsPath, authorsHacked.replace("\n// manual hack: custom hook\n", ""), "utf8");
const regen3 = regenerate(specV3, OUT_DIR);
check(
  "tras resolver el conflicto a mano, la regeneración aplica el cambio pendiente",
  regen3.written.includes("collections/authors.ts") &&
    readFileSync(authorsPath, "utf8").includes("avatar"),
);

// ---------------------------------------------------------------------------
step("7. Doble regeneración sin cambios de spec → idempotencia (cero diffs por hash)");
const before = treeHashes(OUT_DIR);
const regen4 = regenerate(specV3, OUT_DIR);
const after = treeHashes(OUT_DIR);
const diffs = [...before.keys(), ...after.keys()].filter(
  (k) => before.get(k) !== after.get(k),
);
check("cero archivos escritos o creados", regen4.written.length === 0 && regen4.created.length === 0);
check("árbol completo byte-idéntico (hash por archivo)", diffs.length === 0, diffs.join(", ") || "0 diffs");
check(
  "los conflictos pendientes se siguen reportando de forma estable",
  regen4.conflicts.some((c) => c.kind === "binding-missing-field"),
);

// ---------------------------------------------------------------------------
console.log(`\nResultado: ${failures === 0 ? "TODOS LOS PASOS PASS" : `${failures} checks FAIL`}`);
console.log(`Proyecto simulado en: ${OUT_DIR}`);
if (failures > 0) process.exit(1);
