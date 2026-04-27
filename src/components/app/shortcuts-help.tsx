"use client";

import * as React from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHotkey } from "@/hooks/use-hotkey";

const SHORTCUTS: { keys: string[]; description: string; group: string }[] = [
  { keys: ["⌘", "K"], description: "Open command palette", group: "Navigation" },
  { keys: ["G", "D"], description: "Go to Dashboard", group: "Navigation" },
  { keys: ["G", "G"], description: "Go to Brand Visibility", group: "Navigation" },
  { keys: ["G", "S"], description: "Go to Site Audit", group: "Navigation" },
  { keys: ["G", "C"], description: "Go to Chatsonic", group: "Navigation" },
  { keys: ["⌘", "Shift", "O"], description: "New chat", group: "Chat" },
  { keys: ["Enter"], description: "Send message", group: "Chat" },
  { keys: ["Shift", "Enter"], description: "New line in composer", group: "Chat" },
  { keys: ["/"], description: "Slash commands menu", group: "Chat" },
  { keys: ["?"], description: "Show this help dialog", group: "Help" },
];

export function ShortcutsHelp() {
  const [open, setOpen] = React.useState(false);
  useHotkey("?", () => setOpen(true));

  const groups = SHORTCUTS.reduce<Record<string, typeof SHORTCUTS>>((acc, s) => {
    (acc[s.group] ??= []).push(s);
    return acc;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Navigate Neurank without leaving the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {Object.entries(groups).map(([group, items]) => (
            <div key={group}>
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {group}
              </div>
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <li key={s.description} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{s.description}</span>
                    <span className="flex items-center gap-1">
                      {s.keys.map((k) => (
                        <kbd
                          key={k}
                          className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground"
                        >
                          {k}
                        </kbd>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
