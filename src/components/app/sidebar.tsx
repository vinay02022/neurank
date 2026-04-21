"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

import { BrandMark } from "@/components/app/brand-mark";
import { Icon } from "@/components/app/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { NAVIGATION, type NavItem } from "@/config/navigation";
import { useWorkspace } from "@/components/app/workspace-context";
import { cn } from "@/lib/utils";

const COLLAPSED_KEY = "neurank:sidebar:collapsed";

function useCollapsedState() {
  const [collapsed, setCollapsed] = React.useState(false);
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    try {
      const stored = localStorage.getItem(COLLAPSED_KEY);
      if (stored) setCollapsed(stored === "1");
    } catch {
      /* no-op */
    }
    setReady(true);
  }, []);

  const toggle = React.useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* no-op */
      }
      return next;
    });
  }, []);

  return { collapsed, ready, toggle };
}

function isItemActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === "/dashboard";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinkRow({
  item,
  collapsed,
  active,
  badgeCount,
}: {
  item: NavItem;
  collapsed: boolean;
  active: boolean;
  badgeCount?: number;
}) {
  const classes = cn(
    "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
    collapsed ? "justify-center px-0" : "",
    active
      ? "bg-accent text-foreground"
      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
  );

  const content = (
    <>
      <Icon name={item.icon} className={cn("size-4 shrink-0", active && "text-primary")} />
      {!collapsed ? (
        <>
          <span className="truncate">{item.label}</span>
          {item.badge === "count" && badgeCount ? (
            <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              {badgeCount}
            </span>
          ) : null}
        </>
      ) : null}
    </>
  );

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href={item.href} className={classes} aria-label={item.label}>
            {content}
          </Link>
        </TooltipTrigger>
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Link href={item.href} className={classes}>
      {content}
    </Link>
  );
}

export function Sidebar({
  variant = "static",
  onNavigate,
}: {
  variant?: "static" | "drawer";
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { openActionsCount } = useWorkspace();
  const { collapsed, toggle } = useCollapsedState();

  const isDrawer = variant === "drawer";
  const effectiveCollapsed = isDrawer ? false : collapsed;

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-border bg-card/40 backdrop-blur transition-[width] duration-200",
        isDrawer ? "w-full" : effectiveCollapsed ? "w-14" : "w-60",
      )}
      aria-label="Primary navigation"
    >
      <div
        className={cn(
          "flex h-14 shrink-0 items-center border-b border-border px-3",
          effectiveCollapsed ? "justify-center" : "justify-between",
        )}
      >
        <BrandMark compact={effectiveCollapsed} />
        {!isDrawer ? (
          <button
            type="button"
            onClick={toggle}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={cn(
              "inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              effectiveCollapsed && "hidden",
            )}
          >
            <ChevronsLeft className="size-4" />
          </button>
        ) : null}
      </div>

      <ScrollArea className="flex-1">
        <nav
          className="flex flex-col gap-4 px-2 py-3"
          onClick={(e) => {
            // Close drawer if a link was clicked.
            if ((e.target as HTMLElement).closest("a")) onNavigate?.();
          }}
        >
          {NAVIGATION.map((section, idx) => (
            <div key={section.id} className="flex flex-col gap-0.5">
              {!effectiveCollapsed ? (
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {section.label}
                </div>
              ) : idx > 0 ? (
                <Separator className="my-1" />
              ) : null}
              {section.items.map((item) => (
                <NavLinkRow
                  key={item.href}
                  item={item}
                  collapsed={effectiveCollapsed}
                  active={isItemActive(item.href, pathname ?? "")}
                  badgeCount={item.badgeKey === "openActions" ? openActionsCount : undefined}
                />
              ))}
            </div>
          ))}
        </nav>
      </ScrollArea>

      {!isDrawer && effectiveCollapsed ? (
        <div className="border-t border-border p-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label="Expand sidebar"
                className="inline-flex size-9 w-full items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronsRight className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">Expand sidebar</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
    </aside>
  );
}
