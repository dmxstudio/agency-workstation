"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling ligero del estado del run en DB (decisión de runtime: el run corre
 * async in-process y la UI hace polling): re-renderiza los Server Components
 * de la ruta cada `intervalMs`. Solo se monta mientras hay runs vivos
 * (queued|running); al asentarse, la página deja de renderizarlo.
 */
export function AutoRefresh({ intervalMs = 2500 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(interval);
  }, [router, intervalMs]);

  return null;
}
