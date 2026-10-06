# 金融市场数据与公告信源

AIQUANT 使用已由站点所有者确认的官方信源。确认使用一个机构的数据，不代表该机构的所有接口已经接入，也不替代特定行情产品的再分发授权。当前新闻入口和结构化市场数据分别说明如下。

## 已配置的新闻 RSS

`industry/sources.json` 配置以下四条官方 RSS，供现有新闻采集、筛选及归组流程使用。2026-10-06 已直接读取端点并通过 XML 校验；条目数量是验证当时的结果，不代表持续可用性保证。

| 信源 | RSS | 验证时条目数 | 内容 |
| --- | --- | ---: | --- |
| 美联储 | [货币政策](https://www.federalreserve.gov/feeds/press_monetary.xml) | 15 | 政策决定及相关公告 |
| 美联储 | [演讲与证词](https://www.federalreserve.gov/feeds/speeches_and_testimony.xml) | 15 | 官员公开讲话与证词 |
| 欧洲央行 | [官方新闻](https://www.ecb.europa.eu/rss/press.html) | 15 | 公告、演讲、访谈等 |
| 美国 SEC | [监管公告](https://www.sec.gov/news/pressreleases.rss) | 25 | 监管、执法及机构新闻 |

入口来自[美联储 RSS 目录](https://www.federalreserve.gov/feeds/feeds.htm)、[欧洲央行 RSS 目录](https://www.ecb.europa.eu/home/html/rss.en.html)及 [SEC 新闻页](https://www.sec.gov/newsroom/press-releases)。美联储目录中的 `press_all.xml` 本次读取返回 404，因此没有配置。

四条来源设为 T1、每 60 分钟采集、来源启用；`site_fulltext` 与 `syndicate_fulltext` 均关闭，只公开摘要与原文链接。开发环境的总采集开关 `COLLECT_ENABLED` 仍须保持关闭。来源的 `enabled: true` 不会绕过总开关。本次配置不运行 seed、不启动采集，也不触发模型调用。

部署时 `scripts/seed.ts` 只新增缺失的来源，不覆盖后台已编辑的来源。更换行业的已有数据库需在后台停用或移除原行业来源；替换 JSON 文件不会删除数据库里的旧来源。

这些 RSS 不提供股价、收益率序列、公司完整财报或资金流。SEC 新闻 RSS 也不等于 EDGAR 公司申报接口已经接入。

## 结构化市场数据

`modules/markets/sources.ts` 列出已确认的官方来源及每项接入状态。当前自动数值适配器覆盖美国财政部 2、5、10、30 年固定期限收益率、日本财务省 10 年固定期限收益率及 ECB AAA 10 年即期合成曲线（仅宏观）；其他数值来源仍为待接入。后台支持带来源与时间信息的人工导入。未接入或没有数据的市场保持空缺，不生成占位行情。

| 来源 | 当前状态 | 数据口径 |
| --- | --- | --- |
| [美国财政部](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed) | XML 适配器已实现，需打开总采集开关后由后台触发 | 日频固定期限收益率曲线估计值，不是单只国债可成交价格 |
| [纽约联储](https://markets.newyorkfed.org/static/docs/markets-api.html) | 待接入 | SOFR、EFFR 及市场操作；参考利率不是实时融资报价 |
| [美联储 H.4.1](https://www.federalreserve.gov/releases/h41/) | 数值序列待接入 | 资产负债表、准备金等；周频不能标成每日新增 |
| [SEC EDGAR](https://www.sec.gov/search-filings/edgar-application-programming-interfaces) | 公司申报待接入 | 财务及机构披露，不提供股票价格；13F 是有滞后的季末多头持仓，不能表示当前净仓位 |
| [日本财务省](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm) | CSV 适配器已实现，后台选择日本财务省后触发 | 日本国债 10 年固定期限收益率，半年度复利、单位 %；观察时点 15:00 JST，下一营业日 09:30 JST 发布 |
| [欧洲央行收益率曲线](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html) | SDMX CSV 适配器已实现，仅宏观展示 | 仅 AAA 10 年即期合成曲线，连续复利；不是单个国家或可交易券，不同于全体发行人曲线 |
| [中国人民银行](https://www.pbc.gov.cn/) | 待接入 | 公开市场操作、货币与社融等公告或统计文件；需逐项核实频率及发布时间 |
| [上交所](https://www.sse.com.cn/transparency/services/index.shtml)、[深交所](https://www.szse.cn/market/) | 待接入 | 披露与统计；完整实时或历史行情需核实获取及再分发权限 |

财政部 XML 只提供观察日期，不能由此推定历史上具体何时可获得数据。适配器因此把抓取时间记录为保守的可用时间，标记 `availabilityBasis: "retrieved"`；回测不把新抓取的历史数据当作当时已知数据。每条记录保留来源链接、观察日期与可用时间。

个股和指数行情尚无已接入的授权供应商。界面中的关注标的是待覆盖范围，不代表已有价格数据。跨国债券也仅列出美国、日本及欧元区 AAA 合成曲线的明确范围，不宣称覆盖全球各国。

## 其他来源边界

[FRED 使用条款](https://fred.stlouisfed.org/legal)包含 AI/ML 使用限制，本项目不默认把 FRED 数据接入模型流程。[中国货币网媒体数据服务](https://www.chinamoney.org.cn/chinese/mtsjfu/)涉及书面授权；未取得对应授权前不启用其公开再分发。所有外部采集与付费模型调用仍受项目既有总开关、回执和预算限制约束。

日本 CSV 来自[官方利率索引](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/index.htm)的 [Current Data](https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/jgbcme.csv)。页面显示值为官方 CSV 的 10Y 列提取，保留三位小数精度；来源单位仍为百分数。日本财务省[网站使用说明](https://www.mof.go.jp/english/about_mof/notice/index.html)采用 [PDL 1.0](https://www.digital.go.jp/en/resources/open_data/public_data_license_v1.0)，说明数值数据可自由使用。本适配仅做列提取与格式转换，并保留来源署名；抓取确认时间不冒充原始发布时间。

ECB 读取[官方单序列 CSV](https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations=5)，严格验证 AAA、10 年即期、连续复利、币种与百分数单位，保留原始观测值精度。[曲线说明](https://www.ecb.europa.eu/stats/financial_markets_and_interest_rates/euro_area_yield_curves/html/index.en.html)限定公共信息用途，不拟用于识别交易机会或资产定价建议，因此该标的在服务端禁止创建 TradeIdea，且不运行股票均线规则。它是估计曲线，不是某国10年国债报价。
