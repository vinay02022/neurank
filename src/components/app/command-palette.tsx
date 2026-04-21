"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { NAVIGATION } from "@/config/navigation";
import { Icon } from "@/components/app/icon";
import { useHotkey } from "@/hooks/use-hotkey";
import { useWorkspace } from "@/components/app/workspace-context";

interface QuickAction {
  id: string;
  label: string;
  href: string;
  shortcut?: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { id: "dashboard", label: "Go to Dashboard", href: "/dashboard", shortcut: "G D" },
  { id: "visibility", label: "Go to Brand Visibility", href: "/geo/visibility", shortcut: "G G" },
  { id: "audit", label: "Go to Site Audit", href: "/seo/audit", shortcut: "G S" },
  { id: "chat", label: "Go to Chatsonic", href: "/chat", shortcut: "G C" },
  { id: "billing", label: "Open Billing", href: "/billing" },
  { id: "onboarding", label: "Start new project", href: "/onboarding" },
];

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPalette({ open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter();
  const { workspace } = useWorkspace();

  const go = (href: string) => {
    onOpenChange(false);
    router.push(href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder={`Search in ${workspace.name}…`} />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Quick actions">
          {QUICK_ACTIONS.map((a) => (
            <CommandItem key={a.id} value={a.label} onSelect={() => go(a.href)}>
              {a.label}
              {a.shortcut ? <CommandShortcut>{a.shortcut}</CommandShortcut> : null}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {NAVIGATION.map((section) => (
          <CommandGroup key={section.id} heading={section.label}>
            {section.items.map((item) => (
              <CommandItem
                key={item.href}
                value={`${section.label} ${item.label}`}
                onSelect={() => go(item.href)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <CommandShortcut>{item.href}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

/**
 * Global keyboard bindings for the authenticated shell.
 * Mounted once in <Shell>. ⌘K / Ctrl-K opens the palette; sequences
 * like "g d" navigate.
 */
export function AppHotkeys({ onOpenPalette }: { onOpenPalette: () => void }) {
  const router = useRouter();

  useHotkey("mod+k", (e) => {
    e.preventDefault();
    onOpenPalette();
  });
  useHotkey("g d", () => router.push("/dashboard"));
  useHotkey("g g", () => router.push("/geo/visibility"));
  useHotkey("g s", () => router.push("/seo/audit"));
  useHotkey("g c", () => router.push("/chat"));

  return null;
}
