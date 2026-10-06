import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { registerMarketRoutes } from "./api/routes.ts";
import { collectMarket } from "./backend/collect.ts";

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

export const MARKET_SERVER = defineServerModule({
  name: "markets",
  http: registerMarketRoutes,
  queues: [TREASURY_QUEUE, JAPAN_MOF_QUEUE, ECB_QUEUE],
});
