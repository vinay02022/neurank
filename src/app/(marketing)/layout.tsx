import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Shared chrome for the public marketing surface (`/`, `/pricing`,
 * etc.). Keeping the nav + footer in a layout means we only have to
 * touch one place when adding new marketing routes - the home page
 * previously inlined its own nav, which silently rotted as `/pricing`
 * was added but didn't exist.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-flex size-7 items-center justify-center rounded-md bg-ai-gradient text-white">
            <Sparkles className="size-4" />
          </span>
          <span className="text-lg">Neurank</span>
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/#geo" className="hover:text-foreground">
            GEO
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/sign-in">Sign in</Link>
          </Button>
          <Button asChild variant="ai" size="sm">
            <Link href="/sign-up">Get started free</Link>
          </Button>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Neurank, Inc.
      </footer>
    </div>
  );
}
