# Database Schema

Authoritative Prisma schema for Neurank. Phase 00 will copy this into `prisma/schema.prisma`.

## Principles
- Every tenant-owned model has `workspaceId` (indexed).
- Use CUIDs for IDs.
- Timestamps `createdAt` / `updatedAt` on every model.
- Soft-delete only where we truly need history (`deletedAt` nullable).

## Full schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}

// ============================================================
// IDENTITY & BILLING
// ============================================================

model User {
  id          String   @id @default(cuid())
  clerkUserId String   @unique
  email       String   @unique
  name        String?
  avatarUrl   String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  memberships Membership[]
  chatThreads ChatThread[]
}

model Workspace {
  id            String   @id @default(cuid())
  clerkOrgId    String?  @unique
  name          String
  slug          String   @unique
  plan          Plan     @default(FREE)
  creditBalance Int      @default(50)      // monthly credits left
  stripeCustomerId     String?  @unique
  stripeSubscriptionId String?  @unique
  trialEndsAt   DateTime?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  members        Membership[]
  projects       Project[]
  brandVoices    BrandVoice[]
  articles       Article[]
  chatThreads    ChatThread[]
  apiKeys        ApiKey[]
  llmEvents      LLMEvent[]
  auditLogs      AuditLog[]
}

enum Plan {
  FREE
  INDIVIDUAL
  STARTER
  BASIC
  GROWTH
  ENTERPRISE
}

model Membership {
  id          String    @id @default(cuid())
  userId      String
  workspaceId String
  role        Role      @default(MEMBER)
  createdAt   DateTime  @default(now())

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([userId, workspaceId])
  @@index([workspaceId])
}

enum Role {
  OWNER
  ADMIN
  MEMBER
}

model ApiKey {
  id          String    @id @default(cuid())
  workspaceId String
  name        String
  prefix      String                             // ws_live_ or ws_test_
  hashedKey   String    @unique
  lastUsedAt  DateTime?
  revokedAt   DateTime?
  createdAt   DateTime  @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId])
}

// ============================================================
// PROJECTS & COMPETITORS (GEO)
// ============================================================

model Project {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  domain      String   // "acme.com"
  brandName   String
  brandAliases String[]                          // ["Acme", "Acme Inc.", "acme.com"]
  description String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace      Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  competitors    Competitor[]
  trackedPrompts TrackedPrompt[]
  portfolios     Portfolio[]
  auditRuns      AuditRun[]
  trafficEvents  AITrafficEvent[]
  actionItems    ActionItem[]

  @@unique([workspaceId, domain])
  @@index([workspaceId])
}

model Competitor {
  id          String   @id @default(cuid())
  projectId   String
  name        String
  domain      String
  aliases     String[]
  createdAt   DateTime @default(now())

  project  Project    @relation(fields: [projectId], references: [id], onDelete: Cascade)
  mentions Mention[]

  @@unique([projectId, domain])
  @@index([projectId])
}

model Portfolio {
  id        String   @id @default(cuid())
  projectId String
  name      String
  urlGlobs  String[]                             // ["/blog/*", "/products/*"]
  createdAt DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId])
}

// ============================================================
// GEO — TRACKED PROMPTS & RUNS
// ============================================================

model TrackedPrompt {
  id          String    @id @default(cuid())
  projectId   String
  text        String
  topic       String?
  intent      PromptIntent @default(INFORMATIONAL)
  active      Boolean   @default(true)
  addedBy     String?                           // userId
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  project Project         @relation(fields: [projectId], references: [id], onDelete: Cascade)
  runs    VisibilityRun[]

  @@index([projectId, active])
}

enum PromptIntent {
  INFORMATIONAL
  COMPARISON
  TRANSACTIONAL
  NAVIGATIONAL
}

model VisibilityRun {
  id              String    @id @default(cuid())
  trackedPromptId String
  platform        AIPlatform
  runDate         DateTime                         // the calendar day this belongs to
  rawAnswer       String    @db.Text
  modelUsed       String                           // e.g. "gpt-4o-mini"
  tokensUsed      Int       @default(0)
  costUsd         Decimal?  @db.Decimal(10, 6)
  sentiment       Sentiment?
  brandMentioned  Boolean   @default(false)
  brandPosition   Int?                             // 1st, 2nd,… order of appearance
  createdAt       DateTime  @default(now())

  prompt    TrackedPrompt @relation(fields: [trackedPromptId], references: [id], onDelete: Cascade)
  mentions  Mention[]
  citations Citation[]

  @@unique([trackedPromptId, platform, runDate])
  @@index([platform, runDate])
}

enum AIPlatform {
  CHATGPT
  GEMINI
  CLAUDE
  PERPLEXITY
  GOOGLE_AIO
  GOOGLE_AI_MODE
  COPILOT
  GROK
  META_AI
  DEEPSEEK
}

enum Sentiment {
  POSITIVE
  NEUTRAL
  NEGATIVE
}

model Mention {
  id              String    @id @default(cuid())
  visibilityRunId String
  competitorId    String?                        // null = our brand
  name            String                         // snapshot of brand/competitor name
  position        Int                            // 1-based order in the answer
  sentiment       Sentiment?
  context         String    @db.Text             // surrounding 200 chars
  createdAt       DateTime  @default(now())

  visibilityRun VisibilityRun @relation(fields: [visibilityRunId], references: [id], onDelete: Cascade)
  competitor    Competitor?   @relation(fields: [competitorId], references: [id], onDelete: SetNull)

  @@index([visibilityRunId])
  @@index([competitorId])
}

model Citation {
  id              String   @id @default(cuid())
  visibilityRunId String
  url             String
  domain          String
  title           String?
  position        Int
  createdAt       DateTime @default(now())

  visibilityRun VisibilityRun @relation(fields: [visibilityRunId], references: [id], onDelete: Cascade)

  @@index([visibilityRunId])
  @@index([domain])
}

// ============================================================
// AI TRAFFIC ANALYTICS
// ============================================================

model AITrafficEvent {
  id        String   @id @default(cuid())
  projectId String
  bot       AIBot
  url       String
  userAgent String   @db.Text
  ip        String?
  occurredAt DateTime

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, bot, occurredAt])
}

enum AIBot {
  GPT_BOT
  CLAUDE_BOT
  PERPLEXITY_BOT
  GOOGLE_EXTENDED
  BING_BOT
  ANTHROPIC_AI
  COHERE_AI
  BYTESPIDER
  META_EXTERNAL
  APPLE_BOT
  OTHER
}

// ============================================================
// SEO — SITE AUDIT
// ============================================================

model AuditRun {
  id          String        @id @default(cuid())
  projectId   String
  status      AuditStatus   @default(QUEUED)
  startedAt   DateTime?
  finishedAt  DateTime?
  pagesCrawled Int          @default(0)
  score       Int?                               // 0-100
  createdAt   DateTime      @default(now())

  project Project      @relation(fields: [projectId], references: [id], onDelete: Cascade)
  issues  AuditIssue[]

  @@index([projectId, createdAt])
}

enum AuditStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
}

model AuditIssue {
  id        String        @id @default(cuid())
  auditRunId String
  category  AuditCategory
  severity  Severity
  url       String
  message   String
  autoFixable Boolean     @default(false)
  fixedAt   DateTime?
  createdAt DateTime      @default(now())

  auditRun AuditRun @relation(fields: [auditRunId], references: [id], onDelete: Cascade)

  @@index([auditRunId, severity])
}

enum AuditCategory {
  TECHNICAL
  CONTENT
  LINKS
  SCHEMA
  PERFORMANCE
  GEO_READINESS
}

enum Severity {
  CRITICAL
  HIGH
  MEDIUM
  LOW
  INFO
}

// ============================================================
// CONTENT STUDIO
// ============================================================

model BrandVoice {
  id          String   @id @default(cuid())
  workspaceId String
  name        String
  description String?
  toneTags    String[]
  sampleText  String   @db.Text
  profileJson Json                               // extracted voice profile
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  articles  Article[]

  @@index([workspaceId])
}

model Article {
  id           String        @id @default(cuid())
  workspaceId  String
  projectId    String?
  brandVoiceId String?
  title        String
  slug         String?
  mode         ArticleMode
  status       ArticleStatus @default(DRAFT)
  language     String        @default("en")
  country      String?
  articleType  String?                            // "listicle", "how-to", etc.
  keywords     String[]
  targetWords  Int?
  outline      Json?
  contentMd    String?       @db.Text
  contentHtml  String?       @db.Text
  coverImageUrl String?
  faqJson      Json?
  creditsSpent Int           @default(0)
  publishedUrl String?
  createdAt    DateTime      @default(now())
  updatedAt    DateTime      @updatedAt

  workspace  Workspace   @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  brandVoice BrandVoice? @relation(fields: [brandVoiceId], references: [id], onDelete: SetNull)

  @@index([workspaceId, status])
}

enum ArticleMode {
  INSTANT
  STEP_4
  STEP_10
}

enum ArticleStatus {
  DRAFT
  GENERATING
  GENERATED
  PUBLISHED
  FAILED
}

// ============================================================
// CHATSONIC
// ============================================================

model ChatThread {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String
  title       String   @default("Untitled chat")
  model       String   @default("gpt-4o-mini")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace Workspace     @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user      User          @relation(fields: [userId], references: [id], onDelete: Cascade)
  messages  ChatMessage[]

  @@index([workspaceId, userId])
}

model ChatMessage {
  id         String   @id @default(cuid())
  threadId   String
  role       ChatRole
  content    String   @db.Text
  toolCalls  Json?
  attachments Json?
  createdAt  DateTime @default(now())

  thread ChatThread @relation(fields: [threadId], references: [id], onDelete: Cascade)

  @@index([threadId, createdAt])
}

enum ChatRole {
  USER
  ASSISTANT
  SYSTEM
  TOOL
}

// ============================================================
// ACTION CENTER
// ============================================================

model ActionItem {
  id          String        @id @default(cuid())
  projectId   String
  kind        ActionKind
  severity    Severity      @default(MEDIUM)
  title       String
  description String        @db.Text
  payload     Json                                // anything specific (url, prompt, etc.)
  status      ActionStatus  @default(OPEN)
  resolvedAt  DateTime?
  createdAt   DateTime      @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@index([projectId, status])
}

enum ActionKind {
  CONTENT_GAP
  CITATION_OPPORTUNITY
  TECHNICAL_FIX
  CONTENT_REFRESH
  SOCIAL_ENGAGEMENT
  SENTIMENT_NEGATIVE
}

enum ActionStatus {
  OPEN
  IN_PROGRESS
  RESOLVED
  DISMISSED
}

// ============================================================
// OBSERVABILITY
// ============================================================

model LLMEvent {
  id          String    @id @default(cuid())
  workspaceId String
  task        String
  provider    String
  model       String
  inputTokens Int
  outputTokens Int
  costUsd     Decimal   @db.Decimal(10, 6)
  latencyMs   Int
  success     Boolean   @default(true)
  error       String?
  createdAt   DateTime  @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}

model AuditLog {
  id          String   @id @default(cuid())
  workspaceId String
  actorUserId String?
  action      String                             // "project.created", "prompt.added"
  entity      String
  entityId    String?
  metadata    Json?
  createdAt   DateTime @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, createdAt])
}
```

## Seed data (prisma/seed.ts)

At minimum seed:
- One demo workspace ("Acme Demo") on GROWTH plan
- One project for acme.com with brand aliases + 3 competitors
- 10 tracked prompts across informational + comparison intents
- 3 days of sample VisibilityRun + Mention + Citation rows for a nice chart
- 2 brand voices ("Professional", "Conversational")
- 1 completed audit run with 25 mixed-severity issues
