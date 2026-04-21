import "server-only";

import type { AIBot } from "@prisma/client";

import { classifyBot } from "@/lib/geo/bot-classifier";

/**
 * Streaming access-log parser.
 *
 * Supports three common log formats:
 *   - **nginx/apache combined** (`%h %l %u %t "%r" %>s %b "%{Referer}i" "%{User-Agent}i"`)
 *   - **Cloudflare CSV** exported from the Cloudflare Logs dashboard
 *     (fields: `ClientRequestURI,ClientRequestUserAgent,ClientIP,EdgeStartTimestamp`)
 *   - **Generic CSV** with header row including any of:
 *     `url`, `user_agent`/`useragent`/`ua`, `ip`, `timestamp`/`time`/`datetime`
 *
 * Design constraints:
 *   - Streaming: we never hold the whole file in memory. Caller passes
 *     lines (via `parseLine` for byte-stream wiring) or the full body
 *     (via `parseLogBody`) and receives an async generator of events.
 *   - Pure: no DB access here. The server action that ingests logs is
 *     responsible for persisting records; this module only parses.
 *   - Safe: we never throw on a single bad line — we skip + count.
 */

export interface ParsedLogEvent {
  url: string;
  userAgent: string;
  ip: string | null;
  occurredAt: Date;
  bot: AIBot;
}

export interface ParseSummary {
  total: number;
  parsed: number;
  skipped: number;
  aiBot: number;
  firstError: string | null;
}

// ---------------------------------------------------------------------------
// Format detection + dispatch
// ---------------------------------------------------------------------------

export type LogFormat = "combined" | "csv" | "auto";

/**
 * Cheap heuristic: if the first non-empty line starts with a quote and
 * contains `,`, assume CSV. If it matches the combined-log shape (IP,
 * bracketed timestamp, quoted request), assume combined. Otherwise fall
 * back to CSV — CSV is the more forgiving path.
 */
export function detectFormat(sample: string): LogFormat {
  const line = sample.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  if (/^\d+\.\d+\.\d+\.\d+\s.*\[[^\]]+\]\s+"/i.test(line)) return "combined";
  return "csv";
}

// ---------------------------------------------------------------------------
// Combined log format (nginx / apache)
// ---------------------------------------------------------------------------

/**
 * Combined-log regex. Fields:
 *   1 ip, 2 timestamp, 3 method, 4 path, 5 http, 6 status, 7 bytes,
 *   8 referer, 9 user-agent.
 */
const COMBINED_RE =
  /^(\S+)\s+\S+\s+\S+\s+\[([^\]]+)\]\s+"(\S+)\s+(\S+)\s+(\S+)"\s+(\d+)\s+(\d+|-)\s+"([^"]*)"\s+"([^"]*)"/;

function parseCombinedLine(line: string): ParsedLogEvent | null {
  const m = COMBINED_RE.exec(line);
  if (!m) return null;
  const [, ip, ts, , path, , , , , ua] = m;
  const occurredAt = parseApacheTimestamp(ts ?? "");
  if (!occurredAt) return null;
  if (!path) return null;
  return {
    ip: ip ?? null,
    url: path,
    userAgent: ua ?? "",
    occurredAt,
    bot: classifyBot(ua ?? "", ip),
  };
}

/**
 * Apache/nginx timestamps look like `10/Oct/2025:13:55:36 +0000`. We
 * convert to ISO before handing to Date — native Date parsing refuses
 * that shape. Returns null on any parse error.
 */
function parseApacheTimestamp(ts: string): Date | null {
  const m = /^(\d{2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\s+([+-]\d{4})$/.exec(ts);
  if (!m) return null;
  const [, dd, mon, yyyy, hh, mm, ss, tz] = m;
  const months: Record<string, string> = {
    Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
    Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
  };
  const month = months[mon ?? ""];
  if (!month) return null;
  const tzFmt = `${tz?.slice(0, 3)}:${tz?.slice(3)}`;
  const iso = `${yyyy}-${month}-${dd}T${hh}:${mm}:${ss}${tzFmt}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// CSV format
// ---------------------------------------------------------------------------

/** Minimal CSV split. Handles quoted fields with embedded commas + doubled quotes. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

type CsvColumnKey = "url" | "userAgent" | "ip" | "occurredAt";

function detectCsvColumns(header: string[]): Record<CsvColumnKey, number> | null {
  const lower = header.map((h) => h.toLowerCase().replace(/[_\s-]/g, ""));
  const find = (...candidates: string[]): number => {
    for (const c of candidates) {
      const idx = lower.indexOf(c);
      if (idx >= 0) return idx;
    }
    return -1;
  };
  const cols = {
    url: find("url", "clientrequesturi", "request", "path"),
    userAgent: find("useragent", "ua", "clientrequestuseragent"),
    ip: find("ip", "clientip", "remoteaddr", "remoteip"),
    occurredAt: find(
      "timestamp",
      "time",
      "datetime",
      "edgestarttimestamp",
      "occurredat",
      "date",
    ),
  };
  if (cols.url < 0 || cols.userAgent < 0) return null;
  return cols;
}

function parseCsvRow(
  row: string[],
  cols: Record<CsvColumnKey, number>,
): ParsedLogEvent | null {
  const url = row[cols.url]?.trim();
  const ua = row[cols.userAgent]?.trim() ?? "";
  if (!url) return null;
  const rawTs = cols.occurredAt >= 0 ? row[cols.occurredAt] ?? "" : "";
  const ip = cols.ip >= 0 ? row[cols.ip] ?? null : null;
  const occurredAt = parseCsvTimestamp(rawTs);
  if (!occurredAt) return null;
  return {
    url,
    userAgent: ua,
    ip: ip && ip.length > 0 ? ip : null,
    occurredAt,
    bot: classifyBot(ua, ip),
  };
}

function parseCsvTimestamp(raw: string): Date | null {
  if (!raw) return new Date();
  const trimmed = raw.trim();
  if (!trimmed) return new Date();
  // Cloudflare uses unix-nanos or ISO-8601; try both.
  if (/^\d{13,}$/.test(trimmed)) {
    const ms = trimmed.length >= 16 ? Math.floor(Number(trimmed) / 1_000_000) : Number(trimmed);
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a full log body. Intended for one-shot `<Sheet>` uploads where
 * the entire file fits in memory (Vercel serverless limit is 4.5 MB body
 * which is ~30k log lines). The callback is invoked for each event so
 * callers can batch-insert.
 *
 * Returns a {@link ParseSummary}. Callers should persist in batches of
 * ~500 inside their own `onEvent` closure.
 */
export function parseLogBody(
  body: string,
  onEvent: (evt: ParsedLogEvent) => void | Promise<void>,
  format: LogFormat = "auto",
): Promise<ParseSummary> {
  const detected = format === "auto" ? detectFormat(body) : format;
  if (detected === "combined") return parseCombinedBody(body, onEvent);
  return parseCsvBody(body, onEvent);
}

async function parseCombinedBody(
  body: string,
  onEvent: (evt: ParsedLogEvent) => void | Promise<void>,
): Promise<ParseSummary> {
  const summary: ParseSummary = {
    total: 0,
    parsed: 0,
    skipped: 0,
    aiBot: 0,
    firstError: null,
  };
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    summary.total += 1;
    try {
      const evt = parseCombinedLine(line);
      if (!evt) {
        summary.skipped += 1;
        continue;
      }
      summary.parsed += 1;
      if (evt.bot !== "OTHER") summary.aiBot += 1;
      await onEvent(evt);
    } catch (err) {
      summary.skipped += 1;
      summary.firstError ??= (err as Error).message;
    }
  }
  return summary;
}

async function parseCsvBody(
  body: string,
  onEvent: (evt: ParsedLogEvent) => void | Promise<void>,
): Promise<ParseSummary> {
  const summary: ParseSummary = {
    total: 0,
    parsed: 0,
    skipped: 0,
    aiBot: 0,
    firstError: null,
  };
  const lines = body.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return summary;
  const header = splitCsvLine(lines[0] ?? "");
  const cols = detectCsvColumns(header);
  if (!cols) {
    summary.firstError = "Unrecognised CSV header — need at least `url` and `user_agent`";
    summary.skipped = lines.length - 1;
    summary.total = lines.length - 1;
    return summary;
  }
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (!line.trim()) continue;
    summary.total += 1;
    try {
      const row = splitCsvLine(line);
      const evt = parseCsvRow(row, cols);
      if (!evt) {
        summary.skipped += 1;
        continue;
      }
      summary.parsed += 1;
      if (evt.bot !== "OTHER") summary.aiBot += 1;
      await onEvent(evt);
    } catch (err) {
      summary.skipped += 1;
      summary.firstError ??= (err as Error).message;
    }
  }
  return summary;
}

/** Exposed for unit tests. */
export const __test__ = {
  parseCombinedLine,
  parseApacheTimestamp,
  splitCsvLine,
  detectCsvColumns,
  parseCsvRow,
};
