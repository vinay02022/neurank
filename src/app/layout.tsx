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

export const metadata: Metadata = {
  title: {
    default: "Neurank — Track & Boost Your Brand in AI Search",
    template: "%s · Neurank",
  },
  description:
    "The only platform that takes you from tracking to action to results across AI Search (ChatGPT, Gemini, Perplexity) and traditional search (Google, Bing).",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"),
};

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
