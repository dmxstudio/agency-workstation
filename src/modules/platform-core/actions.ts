"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import {
  getAuthUser,
  getSessionUser,
  setActiveWorkspace,
  signIn,
  signOut,
  signUp,
  type AuthErrorCode,
} from "./auth/adapter";
import { createProject } from "./projects";
import { ForbiddenError } from "./roles";
import {
  createWorkspace,
  getWorkspaceBySlug,
  isValidWorkspaceSlug,
  slugifyWorkspaceName,
  InvalidSlugError,
  SlugTakenError,
} from "./workspaces";

/**
 * Platform-core server actions. Screens never touch the DB directly: they
 * submit forms to these actions (designed for React `useActionState`).
 *
 * Note: a "use server" file may only export async functions, so the initial
 * state lives at the call site (e.g. `{ error: null }`).
 */

/** State shape for `useActionState` forms. UI messages are in Spanish. */
export type FormActionState = {
  error: string | null;
};

// ---------------------------------------------------------------------------
// Helpers (not exported: "use server" files may only export async functions)
// ---------------------------------------------------------------------------

const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: "Email o contraseña incorrectos.",
  email_in_use: "Ya existe una cuenta con ese email.",
  invalid_email: "El email no es válido.",
  weak_password: "La contraseña debe tener al menos 8 caracteres.",
  invalid_name: "El nombre debe tener entre 2 y 120 caracteres.",
};

function fieldString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Datos inválidos.";
}

/** Only allow internal redirect targets (e.g. from `?next=`). */
function safeInternalPath(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  return path;
}

const signUpSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre debe tener al menos 2 caracteres.")
    .max(120, "El nombre es demasiado largo."),
  email: z.email("Introduce un email válido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(256, "La contraseña es demasiado larga."),
});

const signInSchema = z.object({
  email: z.email("Introduce un email válido."),
  password: z.string().min(1, "Introduce tu contraseña."),
});

const workspaceSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre del workspace debe tener al menos 2 caracteres.")
    .max(80, "El nombre del workspace es demasiado largo."),
});

const projectSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "El nombre del proyecto debe tener al menos 2 caracteres.")
    .max(120, "El nombre del proyecto es demasiado largo."),
});

// ---------------------------------------------------------------------------
// Auth actions
// ---------------------------------------------------------------------------

/** Form fields: `name`, `email`, `password`. Redirects to /onboarding. */
export async function signUpAction(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = signUpSchema.safeParse({
    name: fieldString(formData, "name"),
    email: fieldString(formData, "email").trim().toLowerCase(),
    password: fieldString(formData, "password"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const result = await signUp(
    parsed.data.email,
    parsed.data.password,
    parsed.data.name,
  );
  if (!result.ok) return { error: AUTH_ERROR_MESSAGES[result.error] };

  // Fresh accounts have no workspace yet: onboarding creates the first one.
  redirect("/onboarding");
}

/** Form fields: `email`, `password`, optional `next` (internal path). */
export async function signInAction(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const parsed = signInSchema.safeParse({
    email: fieldString(formData, "email").trim().toLowerCase(),
    password: fieldString(formData, "password"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const result = await signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) return { error: AUTH_ERROR_MESSAGES[result.error] };

  const nextPath = safeInternalPath(fieldString(formData, "next"));
  if (nextPath) redirect(nextPath);

  const sessionUser = await getSessionUser();
  if (sessionUser) redirect(`/w/${sessionUser.workspaceSlug}`);
  redirect("/onboarding");
}

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/login");
}

// ---------------------------------------------------------------------------
// Workspace / project actions
// ---------------------------------------------------------------------------

/**
 * Form fields: `name`, optional `slug` (derived from `name` when omitted).
 * The creator becomes workspace admin. Redirects to /w/[slug].
 */
export async function createWorkspaceAction(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const authUser = await getAuthUser();
  if (!authUser) redirect("/login");

  const parsed = workspaceSchema.safeParse({
    name: fieldString(formData, "name"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const rawSlug = fieldString(formData, "slug").trim();
  const slug = rawSlug || slugifyWorkspaceName(parsed.data.name);
  if (!isValidWorkspaceSlug(slug)) {
    return {
      error:
        "El slug solo puede contener minúsculas, números y guiones (sin guion inicial ni final).",
    };
  }

  try {
    await createWorkspace(parsed.data.name, slug, authUser.id);
    await setActiveWorkspace(slug);
  } catch (err) {
    if (err instanceof SlugTakenError) {
      return { error: "Ese slug ya está en uso. Elige otro." };
    }
    if (err instanceof InvalidSlugError) {
      return { error: "El slug no es válido." };
    }
    return { error: "No se pudo crear el workspace. Inténtalo de nuevo." };
  }

  redirect(`/w/${slug}`);
}

/**
 * Form fields: `name`, optional `workspaceSlug` (defaults to the active
 * workspace). Requires an internal role (admin | member): the `client` role
 * cannot create projects (§14). Redirects to /w/[slug]/p/[projectId].
 */
export async function createProjectAction(
  _prevState: FormActionState,
  formData: FormData,
): Promise<FormActionState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const parsed = projectSchema.safeParse({
    name: fieldString(formData, "name"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const workspaceSlug =
    fieldString(formData, "workspaceSlug").trim() || user.workspaceSlug;
  const membership = await getWorkspaceBySlug(workspaceSlug, user.id);
  if (!membership) {
    return { error: "No tienes acceso a ese workspace." };
  }

  let projectId: string;
  try {
    const project = await createProject(
      membership.workspace.id,
      parsed.data.name,
      user.id,
    );
    projectId = project.id;
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return { error: "Tu rol no permite crear proyectos." };
    }
    return { error: "No se pudo crear el proyecto. Inténtalo de nuevo." };
  }

  redirect(`/w/${workspaceSlug}/p/${projectId}`);
}
