"use client";

import * as React from "react";
import * as Lucide from "lucide-react";
import type { LucideIcon, LucideProps } from "lucide-react";

/**
 * Resolve a lucide-react icon by string name. Safe fallback to Sparkles
 * so a misconfigured nav item never crashes the shell.
 */
export function Icon({
  name,
  ...props
}: { name: string } & LucideProps) {
  const registry = Lucide as unknown as Record<string, LucideIcon>;
  const Component = registry[name] ?? Lucide.Sparkles;
  return <Component {...props} />;
}
