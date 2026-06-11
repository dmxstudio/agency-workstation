"use client";

import {
  createContext,
  useContext,
  useId,
  useState,
  type ComponentPropsWithRef,
  type ReactNode,
} from "react";
import { cn } from "./cn";

interface TabsContextValue {
  value: string;
  setValue: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext(component: string): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error(`<${component}> debe usarse dentro de <Tabs>`);
  }
  return context;
}

export interface TabsProps {
  /** Valor controlado. Si se omite, el componente gestiona su propio estado. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
  children: ReactNode;
}

export function Tabs({
  value: controlledValue,
  defaultValue,
  onValueChange,
  className,
  children,
}: TabsProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? "");
  const baseId = useId();
  const value = controlledValue ?? internalValue;

  const setValue = (next: string) => {
    if (controlledValue === undefined) setInternalValue(next);
    onValueChange?.(next);
  };

  return (
    <TabsContext.Provider value={{ value, setValue, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  );
}

export function TabsList({ className, ...props }: ComponentPropsWithRef<"div">) {
  return (
    <div
      role="tablist"
      className={cn("flex items-end gap-1 border-b border-border", className)}
      {...props}
    />
  );
}

export interface TabsTriggerProps extends ComponentPropsWithRef<"button"> {
  value: string;
}

export function TabsTrigger({ value, className, ...props }: TabsTriggerProps) {
  const { value: activeValue, setValue, baseId } = useTabsContext("TabsTrigger");
  const isActive = activeValue === value;
  return (
    <button
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={isActive}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={isActive ? 0 : -1}
      onClick={() => setValue(value)}
      className={cn(
        "-mb-px inline-flex h-8 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-action",
        isActive
          ? "border-foreground font-medium text-foreground"
          : "border-transparent text-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export interface TabsContentProps extends ComponentPropsWithRef<"div"> {
  value: string;
}

export function TabsContent({ value, className, ...props }: TabsContentProps) {
  const { value: activeValue, baseId } = useTabsContext("TabsContent");
  if (activeValue !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn("pt-4", className)}
      {...props}
    />
  );
}
