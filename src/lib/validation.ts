import { z } from "zod";
import { slugify } from "./utils";

/**
 * Route segments / workspace slugs we must never hand out.
 * Covers Next reserved paths and our product areas.
 */
export const RESERVED_SLUGS = new Set<string>([
  "admin", "api", "app", "assets", "auth", "billing", "chat", "content",
  "dashboard", "demo", "docs", "favicon.ico", "geo", "help", "images",
  "internal", "legal", "login", "logout", "onboarding", "pricing",
  "public", "robots.txt", "seo", "settings", "sign-in", "sign-up",
  "sitemap.xml", "static", "support", "system", "tools", "webhooks",
  "workspace", "workspaces", "neurank", "www",
]);

export const slugSchema = z
  .string()
  .min(3, "At least 3 characters")
  .max(40, "Too long")
  .transform((s) => slugify(s))
  .refine((s) => /^[a-z0-9-]+$/.test(s), "Lowercase letters, numbers, and dashes only")
  .refine((s) => !s.startsWith("-") && !s.endsWith("-"), "Cannot start or end with a dash")
  .refine((s) => !RESERVED_SLUGS.has(s), "This slug is reserved");

/**
 * A public, routable domain (no localhost / IPs / private ranges).
 * Used by onboarding and project creation.
 */
export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(4, "Too short")
  .max(253, "Too long")
  .transform((v) => v.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""))
  .refine((v) => /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v), "Must be a valid public domain")
  .refine((v) => !["localhost", "example.com", "test.com"].includes(v), "Not a real domain")
  .refine((v) => !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(v), "IP addresses aren't allowed");

export const workspaceNameSchema = z
  .string()
  .trim()
  .min(2, "At least 2 characters")
  .max(60, "Max 60 characters");

export const brandNameSchema = z.string().trim().min(1).max(60);

export const shortTextSchema = z.string().trim().min(1).max(120);
export const promptTextSchema = z.string().trim().min(5).max(300);

export function flattenZodError(err: z.ZodError): string {
  return err.issues.map((i) => i.message).join(", ");
}
