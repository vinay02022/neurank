"use client";

import * as React from "react";

import { Sidebar } from "@/components/app/sidebar";
import { TopBar } from "@/components/app/top-bar";
import { AppHotkeys, CommandPalette } from "@/components/app/command-palette";
import { ShortcutsHelp } from "@/components/app/shortcuts-help";
import { cn } from "@/lib/utils";

/**
 * Authenticated app shell — sidebar + top bar + main region. Every
 * route inside `(app)/(shell)` renders inside this chrome. Shell
 * itself is a client component because the sidebar, palette and
 * hotkeys all rely on browser APIs.
 */
export function Shell({
  children,
  contentClassName,
}: {
  children: React.ReactNode;
  contentClassName?: string;
}) {
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      <div className="hidden lg:block">
        <Sidebar />
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenPalette={() => setPaletteOpen(true)} />
        <main
          className={cn(
            "flex-1 overflow-y-auto",
            contentClassName,
          )}
        >
          <div className="mx-auto w-full max-w-7xl px-4 py-6 lg:px-8 lg:py-8">{children}</div>
        </main>
      </div>

      <AppHotkeys onOpenPalette={() => setPaletteOpen(true)} />
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <ShortcutsHelp />
    </div>
  );
}
