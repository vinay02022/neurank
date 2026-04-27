import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  derivePlanFromPriceId,
  listTopUps,
  topUpById,
  topUpFromPriceId,
} from "@/lib/billing/prices";
import {
  isActiveStatus,
  normaliseStatus,
  planForCustomer,
} from "@/lib/billing/subscription-status";
import { creditWarningLevel } from "@/lib/billing/credit-warning";
import {
  PLAN_ORDER,
  checkFeature,
  checkPlatforms,
  checkQuota,
  featureMatrix,
  planLimitFromFeature,
  planLimitFromQuota,
  planRank,
  smallestPlanWith,
} from "@/lib/billing/gates";

/**
 * Billing helpers are pure — env-driven price lookups, plan derivation,
 * and status normalisation. Hitting Stripe in tests is out of scope;
 * the route handler is integration-tested manually with `stripe trigger`
 * during dev. These suites guard the seams that webhook payloads flow
 * through.
 */

describe("derivePlanFromPriceId", () => {
  it("returns null when no env mapping matches", () => {
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
    delete process.env.STRIPE_PRICE_STARTER_YEARLY;
    assert.equal(derivePlanFromPriceId("price_unknown"), null);
    assert.equal(derivePlanFromPriceId(null), null);
    assert.equal(derivePlanFromPriceId(undefined), null);
  });

  it("matches the configured monthly price to its plan", () => {
    process.env.STRIPE_PRICE_STARTER_MONTHLY = "price_starter_m";
    process.env.STRIPE_PRICE_GROWTH_YEARLY = "price_growth_y";
    try {
      assert.deepEqual(derivePlanFromPriceId("price_starter_m"), {
        plan: "STARTER",
        interval: "monthly",
      });
      assert.deepEqual(derivePlanFromPriceId("price_growth_y"), {
        plan: "GROWTH",
        interval: "yearly",
      });
    } finally {
      delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
      delete process.env.STRIPE_PRICE_GROWTH_YEARLY;
    }
  });
});

describe("top-up catalogue", () => {
  it("listTopUps returns the three SKUs in increasing order", () => {
    const t = listTopUps();
    assert.equal(t.length, 3);
    assert.deepEqual(
      t.map((x) => x.id),
      ["topup_1k", "topup_5k", "topup_25k"],
    );
    assert.equal(t[0]?.credits, 1_000);
    assert.equal(t[1]?.credits, 5_000);
    assert.equal(t[2]?.credits, 25_000);
  });

  it("topUpById resolves valid ids and returns null for bogus ones", () => {
    assert.ok(topUpById("topup_5k"));
    assert.equal(topUpById("topup_999k"), null);
  });

  it("topUpFromPriceId reverse-resolves an env-configured price", () => {
    process.env.STRIPE_PRICE_TOPUP_5K = "price_topup_5k";
    try {
      const t = topUpFromPriceId("price_topup_5k");
      assert.ok(t);
      assert.equal(t!.id, "topup_5k");
      assert.equal(t!.credits, 5_000);
      assert.equal(topUpFromPriceId("price_unknown"), null);
    } finally {
      delete process.env.STRIPE_PRICE_TOPUP_5K;
    }
  });
});

describe("subscription helpers", () => {
  it("normaliseStatus accepts known statuses and rejects everything else", () => {
    assert.equal(normaliseStatus("active"), "active");
    assert.equal(normaliseStatus("trialing"), "trialing");
    assert.equal(normaliseStatus("past_due"), "past_due");
    assert.equal(normaliseStatus("canceled"), "canceled");
    assert.equal(normaliseStatus("paused"), "paused");
    assert.equal(normaliseStatus("nonsense"), null);
    assert.equal(normaliseStatus(null), null);
    assert.equal(normaliseStatus(undefined), null);
  });

  it("isActiveStatus is true only for billable statuses", () => {
    assert.equal(isActiveStatus("active"), true);
    assert.equal(isActiveStatus("trialing"), true);
    // past_due is "active" for entitlement purposes — Stripe will dun
    // and either recover the payment or downgrade us via subscription
    // .deleted, so the user should keep their seat in the meantime.
    assert.equal(isActiveStatus("past_due"), true);
    assert.equal(isActiveStatus("canceled"), false);
    assert.equal(isActiveStatus("incomplete"), false);
    assert.equal(isActiveStatus("paused"), false);
    assert.equal(isActiveStatus(null), false);
  });

  it("planForCustomer drops to FREE when sub is inactive", () => {
    assert.equal(
      planForCustomer({ active: true, derived: "GROWTH" }),
      "GROWTH",
    );
    assert.equal(
      planForCustomer({ active: false, derived: "GROWTH" }),
      "FREE",
    );
    assert.equal(
      planForCustomer({ active: true, derived: null }),
      "FREE",
    );
  });
});

describe("creditWarningLevel", () => {
  it("returns exhausted at zero balance regardless of plan", () => {
    assert.equal(
      creditWarningLevel({ plan: "GROWTH", creditBalance: 0 }),
      "exhausted",
    );
    assert.equal(
      creditWarningLevel({ plan: "FREE", creditBalance: -5 }),
      "exhausted",
    );
  });

  it("flags critical at <=10% remaining", () => {
    // STARTER monthly grant is 3000.
    assert.equal(
      creditWarningLevel({ plan: "STARTER", creditBalance: 200 }),
      "critical",
    );
    assert.equal(
      creditWarningLevel({ plan: "STARTER", creditBalance: 300 }),
      "critical",
    );
  });

  it("flags low between 10% and 20%", () => {
    assert.equal(
      creditWarningLevel({ plan: "STARTER", creditBalance: 600 }),
      "low",
    );
  });

  it("returns ok above 20%", () => {
    assert.equal(
      creditWarningLevel({ plan: "STARTER", creditBalance: 2_500 }),
      "ok",
    );
  });

  it("returns ok for enterprise (unlimited grant)", () => {
    assert.equal(
      creditWarningLevel({ plan: "ENTERPRISE", creditBalance: 1 }),
      "ok",
    );
  });
});

// ---------------------------------------------------------------------------
// Plan / quota gates (lib/billing/gates.ts)
// ---------------------------------------------------------------------------

describe("planRank / PLAN_ORDER", () => {
  it("orders FREE → INDIVIDUAL → STARTER → BASIC → GROWTH → ENTERPRISE", () => {
    assert.deepEqual(PLAN_ORDER, [
      "FREE",
      "INDIVIDUAL",
      "STARTER",
      "BASIC",
      "GROWTH",
      "ENTERPRISE",
    ]);
    assert.ok(planRank("FREE") < planRank("STARTER"));
    assert.ok(planRank("STARTER") < planRank("GROWTH"));
    assert.ok(planRank("GROWTH") < planRank("ENTERPRISE"));
  });
});

describe("smallestPlanWith", () => {
  it("returns the cheapest plan that satisfies the predicate", () => {
    // `api: true` first appears on BASIC in the default matrix.
    assert.equal(
      smallestPlanWith((p) => p.api === true),
      "BASIC",
    );
    // `sso: true` is ENTERPRISE-only.
    assert.equal(
      smallestPlanWith((p) => p.sso === true),
      "ENTERPRISE",
    );
  });

  it("falls back to ENTERPRISE when no plan matches", () => {
    assert.equal(
      smallestPlanWith(() => false),
      "ENTERPRISE",
    );
  });
});

describe("checkFeature", () => {
  it("returns ok=true when the plan includes the feature", () => {
    const r = checkFeature("BASIC", "api");
    assert.equal(r.ok, true);
  });

  it("returns PLAN_LIMIT with the cheapest matching plan when the feature is missing", () => {
    const r = checkFeature("FREE", "api");
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "PLAN_LIMIT");
      assert.equal(r.feature, "api");
      assert.equal(r.currentPlan, "FREE");
      assert.equal(r.suggestedPlan, "BASIC");
      assert.match(r.message, /API/);
    }
  });

  it("planLimitFromFeature converts a failing check into the action envelope", () => {
    const check = checkFeature("FREE", "api");
    assert.equal(check.ok, false);
    if (check.ok) return;
    const env = planLimitFromFeature(check);
    assert.equal(env.ok, false);
    assert.equal(env.code, "PLAN_LIMIT");
    assert.equal(env.upgrade, true);
    assert.equal(env.currentPlan, "FREE");
    assert.equal(env.suggestedPlan, "BASIC");
    assert.equal(env.feature, "api");
  });
});

describe("checkQuota", () => {
  it("returns ok with limit + used when under cap", () => {
    // FREE allows 3 articles/month.
    const r = checkQuota("FREE", "articlesPerMonth", 1);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.limit, 3);
      assert.equal(r.used, 1);
    }
  });

  it("returns PLAN_LIMIT when the count meets the cap", () => {
    const r = checkQuota("FREE", "articlesPerMonth", 3);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.reason, "PLAN_LIMIT");
      assert.equal(r.currentPlan, "FREE");
      // Cheapest plan with > 3 articlesPerMonth is INDIVIDUAL (50).
      assert.equal(r.suggestedPlan, "INDIVIDUAL");
      assert.match(r.message, /articles this month/);
    }
  });

  it("treats unlimited (-1) plans as POSITIVE_INFINITY", () => {
    const r = checkQuota("ENTERPRISE", "articlesPerMonth", 999_999);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.limit, Number.POSITIVE_INFINITY);
  });

  it("planLimitFromQuota envelope carries the canonical fields", () => {
    const check = checkQuota("FREE", "users", 1);
    assert.equal(check.ok, false);
    if (check.ok) return;
    const env = planLimitFromQuota(check);
    assert.equal(env.code, "PLAN_LIMIT");
    assert.equal(env.upgrade, true);
    assert.equal(env.quota, "users");
    assert.equal(env.used, 1);
    assert.equal(env.limit, 1);
  });
});

describe("checkPlatforms", () => {
  it("partitions requested platforms into allowed/blocked subsets", () => {
    // FREE has only CHATGPT in the default matrix.
    const r = checkPlatforms("FREE", ["CHATGPT", "CLAUDE", "GEMINI"]);
    assert.deepEqual(r.allowed, ["CHATGPT"]);
    assert.deepEqual(r.blocked, ["CLAUDE", "GEMINI"]);
  });

  it("returns empty blocked list when the plan covers everything", () => {
    const r = checkPlatforms("ENTERPRISE", ["CHATGPT", "CLAUDE", "PERPLEXITY"]);
    assert.deepEqual(r.blocked, []);
    assert.deepEqual(r.allowed, ["CHATGPT", "CLAUDE", "PERPLEXITY"]);
  });
});

describe("featureMatrix", () => {
  it("exposes every plan with all the keys the spec calls for", () => {
    for (const plan of PLAN_ORDER) {
      const row = featureMatrix[plan];
      assert.ok(row, `missing matrix row for ${plan}`);
      // Spot-check the keys §6 of the spec enumerates.
      assert.equal(typeof row.articlesPerMonth, "number");
      assert.equal(typeof row.promptsTracked, "number");
      assert.equal(typeof row.users, "number");
      assert.equal(typeof row.api, "boolean");
      assert.equal(typeof row.chatsonic, "boolean");
      assert.equal(typeof row.sso, "boolean");
      assert.ok(Array.isArray(row.platforms));
    }
  });
});
