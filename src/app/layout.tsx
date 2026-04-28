import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";

import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  title: {
    default: "Neurank — Track & Boost Your Brand in AI Search",
    template: "%s · Neurank",
  },
  description:
    "The only platform that takes you from tracking to action to results across AI Search (ChatGPT, Gemini, Perplexity) and traditional search (Google, Bing).",
  metadataBase: new URL(APP_URL),
  openGraph: {
    type: "website",
    siteName: "Neurank",
    title: "Neurank — Track & Boost Your Brand in AI Search",
    description:
      "Track your brand across AI Search and traditional search. Generate, optimise, and ship SEO content from one workspace.",
    url: APP_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Neurank — Track & Boost Your Brand in AI Search",
    description:
      "Track your brand across AI Search and traditional search. Generate, optimise, and ship SEO content from one workspace.",
  },
  alternates: { canonical: APP_URL },
  robots: {
    index: true,
    follow: true,
  },
};

/**
 * Schema.org SoftwareApplication graph. We inline this once on the
 * root layout so every page inherits it — search and AI crawlers get
 * a structured product description without each page needing its own
 * JSON-LD block.
 */
const softwareApplicationLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Neurank",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  url: APP_URL,
  description:
    "AI Search visibility, SEO, and AI content platform for marketing teams.",
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    availability: "https://schema.org/InStock",
  },
  publisher: {
    "@type": "Organization",
    name: "Neurank",
    url: APP_URL,
  },
} as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        baseTheme: dark,
        variables: {
          colorPrimary: "oklch(0.7 0.18 275)",
          colorBackground: "oklch(0.13 0 0)",
          colorInputBackground: "oklch(0.17 0 0)",
          colorInputText: "oklch(0.985 0 0)",
          borderRadius: "0.6rem",
          fontFamily: "var(--font-sans)",
        },
        elements: {
          card: "shadow-xl border border-border",
        },
      }}
    >
      <html
        lang="en"
        suppressHydrationWarning
        className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
      >
        <head>
          {/*
            JSON-LD lives in <head> so crawlers don't have to render the
            page to find it. It's safe to inline because the payload is
            a constant — no user data ever passes through here.
          */}
          <script
            type="application/ld+json"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{
              __html: JSON.stringify(softwareApplicationLd),
            }}
          />
        </head>
        <body className="min-h-full bg-background text-foreground flex flex-col font-sans">
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster richColors position="top-right" theme="dark" />
            </TooltipProvider>
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
