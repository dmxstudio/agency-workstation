"use client";

import { Moon, Sun } from "lucide-react";

import { cn } from "@/ui";

const STORAGE_KEY = "aw-theme";

/**
 * Toggle claro/oscuro: alterna la clase `light` en <html> y persiste la
 * preferencia en localStorage (la lee el script inline del root layout antes
 * del primer paint). Los iconos se muestran/ocultan por CSS según el tema
 * activo, así el SSR nunca desajusta con el cliente.
 */
export function ThemeToggle({ className }: { className?: string }) {
  function toggleTheme() {
    const root = document.documentElement;
    const isLight = root.classList.toggle("light");
    try {
      localStorage.setItem(STORAGE_KEY, isLight ? "light" : "dark");
    } catch {
      // localStorage puede no estar disponible; el toggle visual ya aplicó.
    }
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title="Cambiar tema"
      aria-label="Cambiar tema"
      className={cn(
        "inline-flex h-7 w-7 items-center justify-center rounded border border-transparent text-muted transition-colors hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-action",
        className,
      )}
    >
      {/* Tema oscuro activo → ofrece sol (pasar a claro) */}
      <Sun size={15} strokeWidth={1.75} aria-hidden className="hidden dark:block" />
      {/* Tema claro activo → ofrece luna (pasar a oscuro) */}
      <Moon size={15} strokeWidth={1.75} aria-hidden className="block dark:hidden" />
    </button>
  );
}
