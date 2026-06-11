import type { ReactNode } from "react";

/** Layout sobrio y centrado para /login y /register. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-sm">
        <p className="mb-6 text-center font-mono text-[11px] tracking-widest text-faint uppercase">
          Agency Workstation
        </p>
        {children}
      </main>
    </div>
  );
}
