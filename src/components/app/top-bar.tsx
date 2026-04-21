"use client";

import * as React from "react";
import Link from "next/link";
import { useClerk } from "@clerk/nextjs";
import { Bell, Keyboard, LogOut, Menu, Search, Settings, Sparkles, UserCog } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BrandMark } from "@/components/app/brand-mark";
import { CreditPill } from "@/components/app/credit-pill";
import { ProjectSwitcher } from "@/components/app/project-switcher";
import { WorkspaceSwitcherMenuItem } from "@/components/app/workspace-switcher";
import { Sidebar } from "@/components/app/sidebar";
import { ThemeMenuItems } from "@/components/app/theme-toggle";
import { useWorkspace } from "@/components/app/workspace-context";
import { PLANS } from "@/config/plans";

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { workspace, plan, user } = useWorkspace();
  const showUpgrade = plan === "FREE" || plan === "INDIVIDUAL" || plan === "STARTER";
  const [profileOpen, setProfileOpen] = React.useState(false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur lg:px-4">
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="sm" className="size-8 p-0 lg:hidden" aria-label="Open navigation">
            <Menu className="size-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[16rem] p-0 sm:max-w-[16rem]">
          <Sidebar variant="drawer" onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>

      <div className="lg:hidden">
        <BrandMark compact />
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <ProjectSwitcher />
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className="ml-1 hidden h-8 min-w-[18rem] items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 text-left text-sm text-muted-foreground transition-colors hover:border-border/80 hover:bg-muted/70 md:flex"
        aria-label="Open command palette"
      >
        <Search className="size-3.5" />
        <span>Search or jump to…</span>
        <span className="ml-auto flex items-center gap-1">
          <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">⌘</kbd>
          <kbd className="rounded border border-border bg-background px-1 font-mono text-[10px]">K</kbd>
        </span>
      </button>

      <div className="lg:hidden">
        <Button variant="ghost" size="sm" className="size-8 p-0" onClick={onOpenPalette} aria-label="Search">
          <Search className="size-4" />
        </Button>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        {showUpgrade ? (
          <Button asChild size="sm" variant="ai" className="hidden h-8 gap-1.5 sm:inline-flex">
            <Link href="/billing">
              <Sparkles className="size-3.5" />
              Upgrade
            </Link>
          </Button>
        ) : null}

        <CreditPill />

        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="size-8 p-0" aria-label="Notifications">
              <Bell className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b border-border px-3 py-2 text-sm font-medium">Notifications</div>
            <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-xs text-muted-foreground">
              <Bell className="size-5 text-muted-foreground/70" />
              <span>You&apos;re all caught up.</span>
              <span className="text-[11px]">Alerts will appear here once your first GEO run lands.</span>
            </div>
          </PopoverContent>
        </Popover>

        <DropdownMenu open={profileOpen} onOpenChange={setProfileOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 gap-2 px-1.5" aria-label="Account menu">
              <Avatar className="size-7">
                <AvatarFallback>{initials(user.name ?? user.email)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel>
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{user.name ?? "Account"}</span>
                <span className="truncate text-xs text-muted-foreground">{user.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <WorkspaceSwitcherMenuItem onClose={() => setProfileOpen(false)} />
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              <span className="text-xs font-medium text-muted-foreground">
                Plan · {PLANS[plan].name}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link href="/billing">
                <UserCog className="size-4" />
                Billing & plan
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/settings/team">
                <Settings className="size-4" />
                Workspace settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={(e) => { e.preventDefault(); triggerShortcutsDialog(); }}>
              <Keyboard className="size-4" />
              Keyboard shortcuts
            </DropdownMenuItem>
            <ThemeMenuItems />
            <DropdownMenuSeparator />
            <SignOutMenuItem />
          </DropdownMenuContent>
        </DropdownMenu>

        <span className="sr-only">Workspace: {workspace.name}</span>
      </div>
    </header>
  );
}

function SignOutMenuItem() {
  const { signOut } = useClerk();
  return (
    <DropdownMenuItem
      onSelect={(e) => {
        e.preventDefault();
        void signOut({ redirectUrl: "/" });
      }}
    >
      <LogOut className="size-4" />
      Sign out
    </DropdownMenuItem>
  );
}

function initials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "??";
  const parts = trimmed.split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  const chars = `${first.charAt(0)}${last.charAt(0)}`.trim();
  return (chars || trimmed.charAt(0)).toUpperCase();
}

/**
 * Dispatch a synthetic "?" keydown so the <ShortcutsHelp> dialog
 * (which already listens for the global "?" hotkey) opens. Avoids
 * introducing another context just for this one trigger.
 */
function triggerShortcutsDialog() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "?" }));
}
