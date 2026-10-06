// What the site's modules add to the web pages (site/modules/index.ts).
import type { WebModule } from "@aihot/web/modules";

import { MARKET_WEB_MODULE } from "@aihot/markets/web";

export const WEB_MODULES: readonly WebModule[] = [MARKET_WEB_MODULE];
