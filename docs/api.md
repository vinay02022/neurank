# Public API

Neurank exposes a small REST surface for programmatic access. The
primary entry point for end users is the in-app UI; the API is for
power users, agencies running multiple workspaces, and integrations
with external orchestrators (n8n, Zapier, custom tools).

> **Status:** Beta. The shapes below are stable for the documented
> endpoints; anything not documented here is internal and subject to
> change without notice.

## Authentication

API requests are authenticated with a workspace-scoped API key. Keys
are minted in **Settings → API Keys** by an admin and shown exactly
once. Subsequent calls send the key in the `Authorization` header:

```http
Authorization: Bearer nk_live_<rest-of-key>
```

Plan gating: API keys require **BASIC or higher**. FREE/INDIVIDUAL
workspaces will get a `403` with `code: "PLAN_LIMIT"` from the
issuance endpoint.

Rate limit: 60 requests per minute per workspace, sliding window.
Hitting the limit returns `429` with a `Retry-After` header.

## Errors

Every error body follows the canonical action envelope:

```json
{
  "ok": false,
  "error": "Human-readable message",
  "code": "PLAN_LIMIT",
  "upgrade": true,
  "currentPlan": "FREE",
  "suggestedPlan": "BASIC"
}
```

`code` is one of:
`UNAUTHORIZED · FORBIDDEN · VALIDATION · RATE_LIMIT · QUOTA · PLAN_LIMIT · INSUFFICIENT_CREDITS · NOT_FOUND · CONFLICT · SERVER`.

## Endpoints

### `GET /api/health`

Liveness + dependency probe. Public, no auth.

```json
{
  "status": "ok",
  "checkedAt": "2025-01-08T12:34:56.000Z",
  "version": "abc1234",
  "environment": "production",
  "region": "iad1",
  "checks": { "database": { "status": "ok", "latencyMs": 14 } }
}
```

Returns `503` with the same shape (and `status: "degraded"`) when any
dependency probe fails.

### `POST /api/articles`

Create + queue an article generation. Body matches the wizard payload:

```json
{
  "mode": "INSTANT",
  "title": "How to choose a SaaS billing provider",
  "articleType": "comparison",
  "language": "en",
  "country": "US",
  "keywords": ["stripe", "paddle", "lemon squeezy"],
  "targetWords": 1800,
  "sourceUrls": [],
  "ctaText": "Try Neurank",
  "ctaUrl": "https://neurank.com/signup"
}
```

Response on success:

```json
{ "ok": true, "data": { "articleId": "art_..." } }
```

Article generation is asynchronous; poll `GET /api/articles/{id}` for
status (`DRAFT → GENERATING → GENERATED | FAILED`).

### `GET /api/articles/{id}`

Fetch an article. Includes `status`, `contentMd`, `seoBrief`, and
`creditCost`. 404s for IDs that don't belong to the calling
workspace — IDs do not enumerate.

### `POST /api/audits`

Queue a site audit. Body: `{ "url": "https://example.com" }`. Subject
to the workspace's `siteAuditsPerMonth` quota; over-quota returns
`PLAN_LIMIT`.

### `GET /api/usage`

Per-workspace usage snapshot:

```json
{
  "ok": true,
  "data": {
    "plan": "BASIC",
    "creditBalance": 14250,
    "month": {
      "articles": { "used": 12, "limit": 50 },
      "audits":   { "used": 2,  "limit": 10 }
    }
  }
}
```

## Webhooks

Outbound webhooks (notifying *your* system when an article finishes)
ship in a future phase. For now, poll `GET /api/articles/{id}`.

## Versioning

The current API has no version prefix; consider this `v1`. Breaking
changes will move under `/api/v2/*` and the `v1` surface will get at
least 90 days of overlap before sunset.
