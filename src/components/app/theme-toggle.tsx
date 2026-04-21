"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Moon, Sun, Monitor, Check } from "lucide-react";

import {
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { id: "light", label: "Light", Icon: Sun },
  { id: "dark", label: "Dark", Icon: Moon },
  { id: "system", label: "System", Icon: Monitor },
] as const;

export function ThemeMenuItems() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const current = mounted ? theme : undefined;

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel>Theme</DropdownMenuLabel>
      {OPTIONS.map(({ id, label, Icon }) => (
        <DropdownMenuItem
          key={id}
          onSelect={(e) => {
            e.preventDefault();
            setTheme(id);
          }}
        >
          <Icon className="size-4" />
          {label}
          {current === id ? <Check className="ml-auto size-3.5 text-primary" /> : null}
        </DropdownMenuItem>
      ))}
    </>
  );
}
