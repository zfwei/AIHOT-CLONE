import { defineWebModule } from "@aihot/web/modules";
import { IconChart, IconBookmark, IconTrendUp } from "@aihot/web/components/icons";

export const MARKET_WEB_MODULE = defineWebModule({
  name: "markets",
  sidebar: {
    section: "市场研究",
    items: [
      { to: "/markets", label: "市场总览", icon: IconChart, end: true },
      { to: "/markets/portfolio", label: "个人持仓", icon: IconBookmark },
      { to: "/markets/trades", label: "交易推荐", icon: IconTrendUp },
    ],
  },
  tabs: [{ key: "markets", to: "/markets", label: "市场", icon: IconChart }],
  tools: [{ to: "/markets/portfolio", label: "个人持仓 · 仅本机", icon: <IconBookmark /> }],
  admin: { groups: [{ group: "市场研究", items: [{ to: "/admin/markets", label: "市场数据" }] }] },
});
