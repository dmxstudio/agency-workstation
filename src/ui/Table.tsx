import type { ComponentPropsWithRef } from "react";
import { cn } from "./cn";

/** Tabla densa: altura de fila contenida, texto 13px (§11.4). */
export function Table({ className, ...props }: ComponentPropsWithRef<"table">) {
  return (
    <div className="w-full overflow-x-auto">
      <table
        className={cn("w-full caption-bottom border-collapse text-[13px]", className)}
        {...props}
      />
    </div>
  );
}

export function TableHeader({ className, ...props }: ComponentPropsWithRef<"thead">) {
  return <thead className={cn("[&_tr]:border-b [&_tr]:border-border", className)} {...props} />;
}

export function TableBody({ className, ...props }: ComponentPropsWithRef<"tbody">) {
  return <tbody className={className} {...props} />;
}

export function TableRow({ className, ...props }: ComponentPropsWithRef<"tr">) {
  return (
    <tr
      className={cn(
        "border-b border-border transition-colors last:border-0 hover:bg-surface-raised/60",
        className,
      )}
      {...props}
    />
  );
}

export function TableHead({ className, ...props }: ComponentPropsWithRef<"th">) {
  return (
    <th
      className={cn(
        "h-8 px-3 text-left align-middle text-[11px] font-medium tracking-wider text-muted uppercase",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: ComponentPropsWithRef<"td">) {
  return (
    <td className={cn("px-3 py-1.5 align-middle text-foreground", className)} {...props} />
  );
}
