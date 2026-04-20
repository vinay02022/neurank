# Phase 01 — Auth, Workspace, Multi-tenant foundation

**Goal:** Wire up Clerk auth, sync users and organisations into our Postgres, and enforce workspace isolation on every server-side query.

## 1. Clerk setup

1. Add Clerk middleware: `src/middleware.ts` that protects everything under `(app)` and `/api/v1/*`.
2. Public routes: `/`, `/pricing`, `/sign-in(.*)`, `/sign-up(.*)`, `/api/webhooks/(.*)`, `/api/inngest`.
3. Use `clerkMiddleware` with `createRouteMatcher`.

## 2. Sign-in / sign-up pages

- `src/app/sign-in/[[...sign-in]]/page.tsx` — Clerk `<SignIn />` centered with our logo above.
- `src/app/sign-up/[[...sign-up]]/page.tsx` — same with `<SignUp />`.
- Both use `afterSignInUrl="/dashboard"`, `afterSignUpUrl="/onboarding"`.

## 3. Clerk webhook → DB sync

`src/app/api/webhooks/clerk/route.ts`

Use `svix` (already a Clerk dep) to verify the signature. Handle:

| Event | Action |
|---|---|
| `user.created` | Create `User` row + create a default personal `Workspace` (slug = auto) + `Membership` as OWNER |
| `user.updated` | Update User.name, email, avatarUrl |
| `user.deleted` | Soft-delete (mark email with `_deleted` suffix, keep data) |
| `organization.created` | Create `Workspace` with `clerkOrgId` |
| `organizationMembership.created` | Create `Membership` row |
| `organizationMembership.deleted` | Delete `Membership` row |

Add `CLERK_WEBHOOK_SECRET` to `.env.example`.

## 4. Onboarding flow

`src/app/(app)/onboarding/page.tsx`

A 3-step flow (client component with step state):

1. **Workspace** — name, slug (auto-suggest, editable)
2. **Project** — domain (validated URL), brand name, 3 brand aliases (tag input)
3. **Competitors & prompts** — 3 competitor domains + 5 suggested prompts (generated from brand name via `ai.router.generate({ task: "chat:default" })`, editable chips)

On finish: creates Project + Competitors + TrackedPrompts via server actions; redirects to `/dashboard`.

Skip this onboarding entirely if the user already has at least one Project (redirect to dashboard).

## 5. `lib/auth.ts` — full implementation

```ts
// Signatures — implement for real

export async function getCurrentUser(): Promise<User>;
export async function getCurrentWorkspace(): Promise<Workspace>;
export async function requirePlan(min: Plan): Promise<void>;
export async function requireOwnerOrAdmin(): Promise<void>;
export async function switchWorkspace(workspaceId: string): Promise<void>; // writes cookie
```

Notes:
- Resolve "current workspace" from a cookie `ws_id`. If missing, use the user's first membership.
- All functions use Clerk's `auth()` under the hood.
- Throw typed errors (`UnauthorizedError`, `ForbiddenError`) that route handlers can map to 401/403.

## 6. Server actions — workspace & project

`src/server/actions/workspace.ts`
- `createProjectAction(input)` — validated by zod, enforces `requirePlan("STARTER")` (Free can't create projects).
- `addCompetitorAction(input)`
- `addPromptAction(input)` — also enqueues `inngest.send({ name: "geo/prompt.added", data: {...} })` (handler is a no-op for now).
- `switchWorkspaceAction(id)` — sets the `ws_id` cookie.

Every action:
1. `await getCurrentWorkspace()`
2. zod `parse` the input
3. Prisma write scoped to `workspaceId`
4. Write an `AuditLog` row
5. `revalidatePath(...)` where applicable

## 7. Workspace switcher UI

In the top bar (phase 02 will fully build the shell; for now just a minimal Popover `CommandList` of memberships on the dashboard page).

## 8. Tests (manual)

- Sign up → see onboarding → create workspace + project → land on `/dashboard`
- Second login → skip onboarding → dashboard shows the project
- Sign out → protected routes redirect to `/sign-in`
- Webhook: create a test org via Clerk dashboard, confirm a Workspace row appears

## 9. Deliverables

- [ ] Clerk middleware gating `(app)` routes
- [ ] Webhook handler verified + idempotent
- [ ] `/onboarding` fully functional
- [ ] `getCurrentWorkspace()` used in at least one server action
- [ ] `ws_id` cookie switching works
- [ ] `pnpm typecheck` clean

Commit: `feat(auth): wire clerk + workspace onboarding (phase 01)`
