"use client";

/**
 * `global-error.tsx` is Next's last-resort boundary — it catches errors
 * that escape every other boundary, including the root layout itself.
 * Because the root layout has crashed by the time we render here, this
 * file MUST own its own `<html>` and `<body>` tags. We deliberately
 * keep the markup minimal (no Tailwind tokens, no providers) so this
 * page renders even if the asset pipeline failed.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          margin: 0,
          padding: "4rem 1.5rem",
          background: "#0b0b0d",
          color: "#e7e7ea",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            padding: "2rem",
            border: "1px solid #2a2a30",
            borderRadius: 12,
            background: "#121215",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>
            Neurank is having a bad moment
          </h1>
          <p style={{ color: "#a4a4ae", lineHeight: 1.5, fontSize: 14 }}>
            A fatal error escaped every boundary. Our server logs already
            captured it, but you can refresh once we&apos;re back.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: 16,
                fontFamily: "ui-monospace, SFMono-Regular, monospace",
                fontSize: 12,
                color: "#7d7d87",
              }}
            >
              Reference: {error.digest}
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 24,
              padding: "0.6rem 1rem",
              borderRadius: 8,
              border: "1px solid #3a3a42",
              background: "#1d1d22",
              color: "inherit",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
