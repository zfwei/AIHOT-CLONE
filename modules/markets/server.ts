import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { registerMarketRoutes } from "./api/routes.ts";
import { collectMarket, type MarketSource } from "./backend/collect.ts";
import { enqueueOn, recordRun } from "@aihot/backend/jobs/queue";
import { persistPolicyResearch } from "./backend/research.ts";

export const POLICY_RESEARCH_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.policy-research", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 300 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => recordRun("markets.policy-research", () => persistPolicyResearch(actor, reason)),
});

export const TREASURY_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.treasury", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 120 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("treasury", actor, reason),
});

export const JAPAN_MOF_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.japan-mof", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 120 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("japan-mof", actor, reason),
});

export const ECB_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.ecb", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 120 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("ecb", actor, reason),
});

export const NYFED_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.nyfed", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 120 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("nyfed", actor, reason),
});

export const FED_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.fed", options: { policy: "singleton", retryLimit: 1, retryDelay: 120, expireInSeconds: 120 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("fed", actor, reason),
});

export const AKSHARE_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.akshare", options: { policy: "singleton", retryLimit: 0, expireInSeconds: 300 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("akshare", actor, reason),
});

export const YFINANCE_QUEUE = defineQueue<{ actor: string; reason: string }>({
  name: "markets.yfinance", options: { policy: "singleton", retryLimit: 0, expireInSeconds: 300 },
  worker: { pollingIntervalSeconds: 5 },
  run: ({ actor, reason }) => collectMarket("yfinance", actor, reason),
});

export const MARKET_QUEUES = { treasury: TREASURY_QUEUE, "japan-mof": JAPAN_MOF_QUEUE, ecb: ECB_QUEUE, nyfed: NYFED_QUEUE, fed: FED_QUEUE, akshare: AKSHARE_QUEUE, yfinance: YFINANCE_QUEUE };

export const MARKET_SERVER = defineServerModule({
  name: "markets",
  http: registerMarketRoutes,
  queues: [...Object.values(MARKET_QUEUES), POLICY_RESEARCH_QUEUE],
  schedules: [...(Object.keys(MARKET_QUEUES) as MarketSource[]).map((source) => ({
    name: `markets.collect.${source}`,
    cron: "0 8,18 * * *",
    missed: "once" as const,
    when: () => process.env.COLLECT_ENABLED === "true",
    run: async () => {
      if (process.env.COLLECT_ENABLED !== "true") return { skipped: "collection_disabled" };
      return enqueueOn(MARKET_QUEUES[source], { actor: "scheduler:markets", reason: "每日市场数据更新" }, { singletonKey: source });
    },
  })), {
    name: "markets.policy-research.daily",
    cron: "15 18 * * *",
    missed: "once" as const,
    when: () => process.env.MODEL_CALLS_ENABLED === "true",
    run: async () => {
      if (process.env.MODEL_CALLS_ENABLED !== "true") return { skipped: "model_calls_disabled" };
      return enqueueOn(POLICY_RESEARCH_QUEUE, { actor: "scheduler:markets", reason: "每日已发布政策情景复核" }, { singletonKey: "policy-research" });
    },
  }],
});
