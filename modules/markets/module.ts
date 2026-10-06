import { defineModule } from "@aihot/contracts/modules";

export const MARKET_MODULE = defineModule({
  name: "markets",
  pages: [
    { path: "markets", file: "web/overview.tsx", id: "markets-overview" },
    { path: "markets/portfolio", file: "web/portfolio.tsx", id: "markets-portfolio" },
    { path: "markets/trades", file: "web/trades.tsx", id: "markets-trades" },
  ],
  adminPages: [{ path: "admin/markets", file: "web/admin.tsx", id: "markets-admin" }],
  apiPaths: [/^\/api\/v1\/markets(?:\/|$)/, /^\/api\/admin\/markets(?:\/|$)/],
});
