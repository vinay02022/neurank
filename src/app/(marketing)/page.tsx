import Link from "next/link";
import { Radar, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden">
      {/* Nav */}
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
          <Link href="#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="#geo" className="hover:text-foreground">
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

      {/* Hero */}
      <section className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center justify-center px-6 pb-16 pt-20 text-center md:pt-28">
        <div className="pointer-events-none absolute inset-0 -z-10 [mask-image:radial-gradient(60%_50%_at_50%_40%,#000_40%,transparent)]">
          <div className="absolute left-1/2 top-24 h-[420px] w-[680px] -translate-x-1/2 rounded-full bg-ai-gradient opacity-20 blur-3xl" />
        </div>

        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <span className="size-1.5 rounded-full bg-[var(--success)]" />
          Now tracking ChatGPT · Gemini · Claude · Perplexity · Google AI Overviews
        </div>

        <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
          Track &amp; boost your brand&rsquo;s visibility in{" "}
          <span className="bg-ai-gradient bg-clip-text text-transparent">AI Search</span>.
        </h1>

        <p className="mt-5 max-w-2xl text-pretty text-base text-muted-foreground md:text-lg">
          See exactly where you rank across every AI platform. Turn citation gaps into
          specific fixes — new content, refreshed pages, outreach to sites that mention
          competitors but not you.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Button asChild variant="ai" size="lg">
            <Link href="/sign-up">Start free trial</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#features">See how it works</Link>
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          No credit card required · SOC 2 Type II · GDPR
        </p>
      </section>

      {/* Features strip */}
      <section id="features" className="mx-auto w-full max-w-6xl px-6 pb-28">
        <div className="grid gap-6 md:grid-cols-3">
          <FeatureCard
            icon={<Radar className="size-5" />}
            title="Track"
            body="Monitor visibility, share of voice, sentiment and citations across 10+ AI platforms."
          />
          <FeatureCard
            icon={<Target className="size-5" />}
            title="Act"
            body="Every gap becomes a concrete fix — content to create, pages to refresh, sites to pitch."
          />
          <FeatureCard
            icon={<Sparkles className="size-5" />}
            title="Create"
            body="Generate fact-checked articles in your brand voice, with citations and FAQ schema baked in."
          />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border px-6 py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} Neurank, Inc.
      </footer>
    </main>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="group rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/50">
      <div className="mb-4 inline-flex size-9 items-center justify-center rounded-md bg-secondary text-foreground">
        {icon}
      </div>
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
