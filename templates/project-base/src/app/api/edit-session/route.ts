import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { EDIT_COOKIE, isValidEditToken, requiredEditToken } from "@/lib/edit-auth";

/**
 * GET /api/edit-session?token=<EDIT_TOKEN>&to=/edit/home
 * Validates the edit token and stores it in an httpOnly cookie, then
 * redirects back to the editor. Basic check for the MVP — see lib/edit-auth.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const rawTo = req.nextUrl.searchParams.get("to") ?? "/edit";
  // Only allow internal editor paths as redirect targets.
  const to = rawTo.startsWith("/edit") ? rawTo : "/edit";

  if (!isValidEditToken(token)) {
    return new Response("Token de edición no válido.", { status: 401 });
  }

  if (requiredEditToken()) {
    const jar = await cookies();
    jar.set(EDIT_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 días
    });
  }
  redirect(to);
}
