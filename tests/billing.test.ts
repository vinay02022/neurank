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
