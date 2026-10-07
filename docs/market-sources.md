# 金融市场数据与公告信源

AIQUANT 的新闻、利率与宏观数据使用已由站点所有者确认的官方信源；股票与指数日线另通过 AKShare、yfinance 获取，当前用于本地个人研究。确认使用一个来源，不代表其所有接口已经接入，也不替代特定行情产品的公开展示或再分发授权。当前新闻入口和结构化市场数据分别说明如下。

## 已配置的官方新闻

`industry/sources.json` 配置以下十个官方新闻入口，供现有采集、筛选及归组流程使用。前六项在 2026-10-06 首次采集共 91 篇；新增亚洲四项同日首次入库 66 篇（香港证监会 7、日本交易所 13、韩国金融委员会 16、韩国央行 30）。下表条目数量是验证当时的结果，不代表持续可用性保证。

| 信源 | 入口 | 验证时条目数 | 内容 |
| --- | --- | ---: | --- |
| 美联储 | [货币政策](https://www.federalreserve.gov/feeds/press_monetary.xml) | 15 | 政策决定及相关公告 |
| 美联储 | [演讲与证词](https://www.federalreserve.gov/feeds/speeches_and_testimony.xml) | 15 | 官员公开讲话与证词 |
| 欧洲央行 | [官方新闻](https://www.ecb.europa.eu/rss/press.html) | 15 | 公告、演讲、访谈等 |
| 美国 SEC | [监管公告](https://www.sec.gov/news/pressreleases.rss) | 25 | 监管、执法及机构新闻 |
| 中国人民银行 | [官方 RSS](https://www.pbc.gov.cn/goutongjiaoliu/113456/2986536/index.html) | 6 | 政策与新闻发布；官网 RSS 链接补全 HTTPS，详情页补全截断标题 |
| 上海证券交易所 | [要闻列表](https://www.sse.com.cn/aboutus/mediacenter/hotandd/) | 15 | 交易所政策与市场动态；按官方列表日期收录 |
| 香港证监会 SFC | [新闻 RSS](https://www.sfc.hk/en/RSS-Feeds/Press-releases) | 7 | 香港证券监管与上市安排；将 RSS 的 JavaScript 页面链接映射为同机构公开正文接口 |
| 日本交易所集团 JPX | [市场新闻 RSS](https://www.jpx.co.jp/english/rss/markets_news.xml) | 19，允许 13 | 仅接收 `/english/news/` 新闻详情，排除共享上市列表和其他导航链接 |
| 韩国金融委员会 FSC | [政策公告列表](https://www.fsc.go.kr/eng/pr010101?srchCtgry=1) | 20 | 证券政策、并购规则与金融政策；保留公告日期，按内容分类 |
| 韩国央行 BOK | [新闻 RSS](https://www.bok.or.kr/eng/bbs/E0000634/news.rss?menuNo=400069) | 100 | 利率、外储及经济统计等宏观补充，不当作韩股新闻填充 |

入口来自[美联储 RSS 目录](https://www.federalreserve.gov/feeds/feeds.htm)、[欧洲央行 RSS 目录](https://www.ecb.europa.eu/home/html/rss.en.html)及 [SEC 新闻页](https://www.sec.gov/newsroom/press-releases)。美联储目录中的 `press_all.xml` 本次读取返回 404，因此没有配置。

来源设为 T1，前四项每 60 分钟采集，其余来源每 120 分钟采集；`site_fulltext` 与 `syndicate_fulltext` 均关闭，只公开摘要与原文链接。两个美联储频道共用 `owner_entity_id: federal-reserve`，不会当成两个独立机构计算热度。来源的 `enabled: true` 不会绕过总开关。示例配置与测试保持关闭；本机运行环境经站长确认开启 `COLLECT_ENABLED=true`。模型配置缺失时保留资料待处理，不消费分析重试次数，也不将未筛选资料冒充精选。

亚洲来源目录与使用说明：[SFC RSS](https://www.sfc.hk/en/RSS-Feeds)及[链接与版权政策](https://www.sfc.hk/en/Quick-links/Others/Hyperlink-policy)、[JPX RSS](https://www.jpx.co.jp/english/rss/index.html)及[使用条款](https://www.jpx.co.jp/english/term-of-use/index.html)、[FSC 版权政策](https://www.fsc.go.kr/ut020104)。目前用于本地个人研究、摘要与原文链接；JPX 商业采集或二次使用需另行许可，FSC 第三方材料不在其自有政府作品的开放范围内。香港选用 SFC；HKEX RSS 混有年份档案，其网站条款另有限制程序化访问和派生数据库，未配置为采集源。KRX 英文公告使用 JavaScript 分片详情页，现有通用正文提取不能可靠读取，暂以 FSC 提供韩国市场官方政策资讯。

部署时 `scripts/seed.ts` 只新增缺失的来源，不覆盖后台已编辑的来源。更换行业的已有数据库需在后台停用或移除原行业来源；替换 JSON 文件不会删除数据库里的旧来源。

这些新闻入口不提供股价、收益率序列、公司完整财报或资金流。SEC 新闻 RSS 也不等于 EDGAR 公司申报接口已经接入。首次导入按原文时间归档，不进入正常日报；周月报依赖同期日报，不能用历史资料伪造往期成刊记录。

## 结构化市场数据

`modules/markets/sources.ts` 列出来源及每项接入状态。官方数值适配器覆盖美国财政部 2、5、10、30 年固定期限收益率、日本财务省 10 年固定期限收益率、ECB AAA 10 年即期合成曲线（仅宏观）、纽约联储 SOFR/EFFR 和美联储 H.4.1 周三总资产及准备金余额。股票与指数范围见下一节。开启采集后由 worker 在北京时间每日 08:00、18:00 更新，也可在后台单次触发。后台支持带来源与时间信息的人工导入。未接入或没有数据的市场保持空缺，不生成占位行情。

| 来源 | 当前状态 | 数据口径 |
| --- | --- | --- |
| [美国财政部](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) | XML 适配器已实现，需打开总采集开关后由后台触发 | 日频固定期限收益率曲线估计值，不是单只国债可成交价格 |
| [纽约联储](https://markets.newyorkfed.org/static/docs/markets-api.html) | JSON 适配器已实现 | SOFR、EFFR 最近五次观测；参考利率不是实时融资报价，展示来源声明和条款链接 |
| [美联储 H.4.1](https://www.federalreserve.gov/releases/h41/) | 官方表格适配器已实现 | 总资产、准备金的周三余额，百万美元；与周平均、周变化列区分，不标成每日新增 |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | 公司申报待接入 | 财务及机构披露，不提供股票价格；13F 是有滞后的季末多头持仓，不能表示当前净仓位 |
| [日本财务省](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm) | CSV 适配器已实现，后台选择日本财务省后触发 | 日本国债 10 年固定期限收益率，半年度复利、单位 %；观察时点 15:00 JST，下一营业日 09:30 JST 发布 |
| [欧洲央行收益率曲线](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html) | SDMX CSV 适配器已实现，仅宏观展示 | 仅 AAA 10 年即期合成曲线，连续复利；不是单个国家或可交易券，不同于全体发行人曲线 |
| [中国人民银行](https://www.pbc.gov.cn/) | 新闻 RSS 已接入，结构化统计待接入 | 公开市场操作、货币与社融等统计仍需逐项核实口径、频率及发布时间 |
| [上交所](https://www.sse.com.cn/transparency/services/index.shtml)、[深交所](https://www.szse.cn/market/) | 上交所要闻已接入，交易所直供行情未接入 | 披露与统计不等于股票行情授权；下述 AKShare 采集不代表已取得交易所直供或再分发许可 |

财政部 XML 只提供观察日期，不能由此推定历史上具体何时可获得数据。适配器因此把抓取时间记录为保守的可用时间，标记 `availabilityBasis: "retrieved"`；回测不把新抓取的历史数据当作当时已知数据。每条记录保留来源链接、观察日期与可用时间。

跨国债券仅列出美国、日本及欧元区 AAA 合成曲线的明确范围，不宣称覆盖全球各国。

## 股票与指数日线：本地个人研究

股票采集通过 worker 启动 Python 子进程，使用 [AKShare 股票文档](https://akshare.akfamily.xyz/data/stock/stock.html)及 [yfinance 官方项目](https://github.com/ranaroussi/yfinance)所述接口；Python 环境配置见[部署说明](deploy.md#股票日线的-python-环境)。范围固定为以下十三个标的：AKShare 3 个、yfinance 10 个，并非全市场覆盖。

| 采集工具 | 市场 | 标的 |
| --- | --- | --- |
| AKShare | A 股，3 个 | 上证综指、沪深 300、贵州茅台（600519） |
| yfinance / Yahoo Finance | 美股，7 个 | 标普 500（`^GSPC`）、纳斯达克 100（`^NDX`）、罗素 2000（`^RUT`）、费城半导体指数（`^SOX`）、AAPL、MSFT、NVDA |
| yfinance / Yahoo Finance | 港股，1 个 | 恒生指数（`^HSI`） |
| yfinance / Yahoo Finance | 韩股，1 个 | KOSPI（`^KS11`） |
| yfinance / Yahoo Finance | 日股，1 个 | 日经 225（`^N225`） |

新增两个指数的代码已核对 Yahoo Finance：[Russell 2000 Index（`^RUT`）](https://finance.yahoo.com/quote/%5ERUT/)、[PHLX Semiconductor（`^SOX`）](https://finance.yahoo.com/quote/%5ESOX/)。指数编制方名称分别为 [FTSE Russell 的 Russell 2000 Index](https://www.lseg.com/en/ftse-russell/indices/russell-2000-index)和 [Nasdaq 的 PHLX Semiconductor Sector Index](https://indexes.nasdaq.com/index/Overview/SOX)；日线仍通过 yfinance / Yahoo Finance 获取。

展示的最新行情及前收盘价采用未复权日线收盘值；用于均线观察的股票历史采用复权价格：AKShare 使用前复权 `qfq`，yfinance 读取 `auto_adjust=False` 返回的 `Adj Close`。指数历史保持未复权并标记 `priceBasis: "unadjusted"`。两种口径用途不同，不能把复权历史值当成当日可成交报价。每次请求最近一年，并保留每个标的最多 260 个交易日；成功取得一个标的的新历史后，整体替换该标的历史窗口，避免公司行动导致新旧复权基准混在同一序列中。至少 61 个有效观测值才进入现有 20/60 均线观察。

只有当地市场已收盘日期的数据可以入库，不把当天盘中变化当成最终日线。每条记录保留来源链接、观察日期和采集时刻；采集时刻是保守可用时点，标记 `availabilityBasis: "retrieved"`，不反推为历史上当时已知数据。每日 08:00、18:00 是北京时间的采集计划，不代表固定延迟或实时行情承诺。

交易日期按标的所在市场时区与交易日历核对。港股使用 `XHKG` 日历并在日历收盘时点后预留 10 分钟竞价上界；日股使用 `JPX`，2024-11-05 起收盘为东京时间 15:30。韩国 `XKRX` 日历的特殊日期需维护：已补 2025-11-13 延至 16:30 收盘，以及 2026-06-03、07-17 休市；2026-11-19 考试日的交易时段尚未核实，遇到该日数据明确失败，不猜收盘时间。韩国超出 2026 年的采集需先核实日历例外。相关官方或券商公告依据保存在 Python 采集器注释中。

这两项接入不需要本项目配置付费供应商 Key，但不承诺免费无限请求、固定服务等级或持续可用。上游限流、网络故障或接口变更可能导致本次更新失败；已有数据的来源和时间仍须核对，缺失数据不补零。

使用范围遵循来源条款：[AKShare 项目概览](https://akshare.akfamily.xyz/introduction.html)说明接口及相关数据用于学术研究；[yfinance 官方 README](https://github.com/ranaroussi/yfinance#important)说明它并非 Yahoo 官方认可的产品，并提醒 Yahoo Finance API 仅供个人使用。开源工具的代码许可不等于所取金融数据的许可。本次接入限本地个人研究，尚未取得正式的商业、公开网站展示或 API/RSS/MCP 再分发授权；对外运营前需另行确认适用许可与供应商方案。

2026-10-06 本机实测（加入罗素 2000 与费城半导体指数前）：当时 11 个股票与指数标的均采集成功，其中 yfinance 覆盖 8 个，包含新增恒生、KOSPI 与日经 225 指数。合并官方债券行情后，市场快照共 17 条行情、2,728 条历史记录（含股票、指数和国债）。原有 A 股最近交易日为 2026-09-30，美股为 2026-10-05；每个标的均有足够历史进入均线观察。A 股统一使用 AKShare 新浪日线入口；东方财富个股入口在本机连接失败，因此未作为当前采集入口。此记录只说明当次结果，不保证上游持续可用。

## 其他来源边界

[FRED 使用条款](https://fred.stlouisfed.org/legal)包含 AI/ML 使用限制，本项目不默认把 FRED 数据接入模型流程。[中国货币网媒体数据服务](https://www.chinamoney.org.cn/chinese/mtsjfu/)涉及书面授权；未取得对应授权前不启用其公开再分发。所有外部采集与付费模型调用仍受项目既有总开关、回执和预算限制约束。

日本 CSV 来自[官方利率索引](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm)的 [Current Data](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv)。页面显示值为官方 CSV 的 10Y 列提取，保留三位小数精度；来源单位仍为百分数。日本财务省[网站使用说明](https://www.mof.go.jp/english/about_mof/notice/index.html)采用 [PDL 1.0](https://www.digital.go.jp/en/resources/open_data/public_data_license_v1.0)，说明数值数据可自由使用。本适配仅做列提取与格式转换，并保留来源署名；抓取确认时间不冒充原始发布时间。

ECB 读取[官方单序列 CSV](https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations=5)，严格验证 AAA、10 年即期、连续复利、币种与百分数单位，保留原始观测值精度。[曲线说明](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html)限定公共信息用途，不拟用于识别交易机会或资产定价建议，因此该标的在服务端禁止创建 TradeIdea，且不运行股票均线规则。它是估计曲线，不是某国10年国债报价。
