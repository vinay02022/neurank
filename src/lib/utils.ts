import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const numberFormatter = new Intl.NumberFormat("en-US");
const percentFormatter = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "—";
  return numberFormatter.format(n);
}

export function formatPercent(value: number | null | undefined, { fromRatio = false } = {}): string {
  if (value == null) return "—";
  const ratio = fromRatio ? value : value / 100;
  return percentFormatter.format(ratio);
}

export function formatDate(
  d: Date | string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("en-US", opts).format(date);
}

export function formatRelative(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(date);
}

export function truncate(s: string, max = 120): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Return `url` if it is a well-formed `http:` or `https:` URL, otherwise
 * null. This is the single source of truth for "safe to place in an
 * <a href>" across the codebase and must be used whenever we render
 * LLM-sourced URLs (raw answers, citations, etc.), because `javascript:`,
 * `data:`, and `vbscript:` URLs are not filtered by React's JSX escaping.
 */
export function safeHttpUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.toString();
}
