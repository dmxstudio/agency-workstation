/**
 * Shown when EDIT_TOKEN is set and the request has no valid edit cookie.
 * Submits to /api/edit-session, which validates the token, stores it in an
 * httpOnly cookie and redirects back to the editor.
 */
export function EditAccessForm({ to }: { to: string }) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 px-6 font-sans">
      <h1 className="text-xl font-bold tracking-tight">Acceso al editor</h1>
      <p className="text-sm text-neutral-600">
        Este editor está protegido. Introduce el token de edición del proyecto
        (variable de entorno <code className="font-mono">EDIT_TOKEN</code>).
      </p>
      <form action="/api/edit-session" method="GET" className="flex flex-col gap-3">
        <input type="hidden" name="to" value={to} />
        <input
          type="password"
          name="token"
          required
          placeholder="Token de edición"
          className="rounded-md border border-neutral-300 px-3 py-2 font-mono text-sm"
        />
        <button
          type="submit"
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-700"
        >
          Entrar
        </button>
      </form>
    </main>
  );
}
