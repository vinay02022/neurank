import { ImageResponse } from "next/og";

/**
 * Default OpenGraph image for the marketing root and any route that
 * doesn't override it. Rendered at request time by `next/og` (which
 * uses Satori under the hood) — no asset pipeline, no manual export.
 *
 * Keep the layout intentionally simple: large product name, one-line
 * value prop, and a subtle gradient. Anything fancier (charts, custom
 * fonts) blows up the cold-start cost on Vercel's edge runtime.
 */

export const runtime = "edge";
export const alt = "Neurank — Track & Boost Your Brand in AI Search";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background:
            "linear-gradient(135deg, #0b0b14 0%, #14102a 55%, #1f1640 100%)",
          color: "#f5f5fa",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            fontSize: 32,
            fontWeight: 600,
            letterSpacing: -0.5,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background:
                "linear-gradient(135deg, #8b5cf6 0%, #6366f1 50%, #06b6d4 100%)",
            }}
          />
          Neurank
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 20,
            maxWidth: 980,
          }}
        >
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.05,
            }}
          >
            Track & Boost Your Brand in AI Search.
          </div>
          <div style={{ fontSize: 30, color: "#bfb8da", lineHeight: 1.3 }}>
            ChatGPT, Gemini, Perplexity — and Google. One workspace from
            tracking to action to results.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 24,
            color: "#9690b8",
          }}
        >
          <span>neurank.com</span>
          <span>AI Search Visibility · SEO · Content</span>
        </div>
      </div>
    ),
    size,
  );
}
