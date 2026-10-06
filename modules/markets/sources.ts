import type { Instrument } from "./domain.ts";

export interface SourceCandidate {
  id: string;
  name: string;
  url: string;
  coverage: string;
  frequency: string;
  access: string;
  status: "pending" | "approved";
  note: string;
  integration: "ready" | "unconnected";
}

export const INSTRUMENTS: Instrument[] = [
  { id: "cn-sse-composite", name: "上证综指", market: "a-shares", currency: "CNY", kind: "index", country: "CN" },
  { id: "cn-csi300", name: "沪深300", market: "a-shares", currency: "CNY", kind: "index", country: "CN" },
  { id: "hk-hsi", name: "恒生指数", market: "hk-stocks", currency: "HKD", kind: "index", country: "HK" },
  { id: "kr-kospi", name: "韩国综合指数 · KOSPI", market: "kr-stocks", currency: "KRW", kind: "index", country: "KR" },
  { id: "jp-nikkei225", name: "日经225", market: "jp-stocks", currency: "JPY", kind: "index", country: "JP" },
  { id: "us-sp500", name: "标普500", market: "us-stocks", currency: "USD", kind: "index", country: "US" },
  { id: "us-nasdaq100", name: "纳斯达克100", market: "us-stocks", currency: "USD", kind: "index", country: "US" },
  { id: "aapl", name: "Apple · AAPL", market: "us-stocks", currency: "USD", kind: "stock", country: "US" },
  { id: "msft", name: "Microsoft · MSFT", market: "us-stocks", currency: "USD", kind: "stock", country: "US" },
  { id: "nvda", name: "NVIDIA · NVDA", market: "us-stocks", currency: "USD", kind: "stock", country: "US" },
  { id: "600519.sh", name: "贵州茅台 · 600519.SH", market: "a-shares", currency: "CNY", kind: "stock", country: "CN" },
  ...[2, 5, 10, 30].map((tenorYears): Instrument => ({ id: `us-treasury-${tenorYears}y`, name: `美国国债 ${tenorYears} 年`, market: "us-treasury", currency: "USD", kind: "bond-yield", tenorYears, country: "US" })),
  { id: "jp-jgb-10y", name: "日本国债 10 年", market: "global-bonds", currency: "JPY", kind: "bond-yield", tenorYears: 10, country: "JP" },
  { id: "eu-aaa-10y", name: "欧元区 AAA 10 年即期曲线（连续复利）", market: "global-bonds", currency: "EUR", kind: "bond-yield", tenorYears: 10 },
];

export const SOURCE_CANDIDATES: SourceCandidate[] = [
  { id: "akshare", name: "AKShare · A股日线", url: "https://akshare.akfamily.xyz/", coverage: "上证综指、沪深300与已配置A股个股", frequency: "已完成交易日日线", access: "免费开源采集工具；已实现日线适配器", status: "approved", integration: "ready", note: "保留每条数据的底层来源与观测日。AKShare开源许可不等于底层行情的公开再分发授权；实际覆盖以已发布快照为准。" },
  { id: "yfinance", name: "yfinance · 全球股票与指数日线", url: "https://github.com/ranaroussi/yfinance", coverage: "恒生指数、韩国综合指数、日经225、标普500、纳斯达克100与已配置美股个股", frequency: "已完成交易日日线", access: "免费研究工具，读取Yahoo Finance日线", status: "approved", integration: "ready", note: "用于个人研究；Yahoo数据使用权以其条款为准。非实时交易报价，实际覆盖与更新时间以已发布快照为准。" },
  { id: "treasury", name: "美国财政部", url: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed", coverage: "美国国债固定期限收益率", frequency: "营业日日频", access: "官方 XML；已实现采集适配器", status: "approved", integration: "ready", note: "固定期限曲线估计值，不是单只债券可成交价格；来源已确认；打开运行配置及采集阀后才联网。" },
  { id: "nyfed", name: "纽约联储", url: "https://markets.newyorkfed.org/static/docs/markets-api.html", coverage: "SOFR、EFFR 参考利率", frequency: "营业日日频", access: "官方 API；已接入最近五次观察", status: "approved", integration: "ready", note: "保留参考利率条款与规定的免责声明；不是实时融资报价；其他市场操作暂未覆盖。" },
  { id: "fed", name: "美联储", url: "https://www.federalreserve.gov/releases/h41/", coverage: "H.4.1 总资产与准备金周三余额", frequency: "周频", access: "官方 H.4.1 表；已接入", status: "approved", integration: "ready", note: "单位百万美元；提取周三余额，不是周平均或每日新增；不经 FRED 转发。" },
  { id: "company-filings", name: "上市公司官方公告", url: "https://www.sec.gov/edgar/search/", coverage: "公司财报与重大事项", frequency: "按披露更新", access: "SEC、交易所及发行人公告；待接入", status: "approved", integration: "unconnected", note: "按公司逐一核实原始公告链接；不把媒体转述作为正式财务数据。" },
  { id: "japan-mof", name: "日本财务省", url: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm", coverage: "日本国债 10 年固定期限收益率", frequency: "下一营业日 09:30 JST 发布", access: "官方 CSV；已实现 10 年期采集", status: "approved", integration: "ready", note: "提取财务省10年列；单位%，半年度复利、15:00 JST观察；采集确认时间为保守可用时间。官网PDL1.0，保留来源归属。" },
  { id: "ecb", name: "欧洲央行", url: "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations=5", coverage: "欧元区 AAA 10 年即期合成曲线（连续复利）", frequency: "TARGET 营业日日频", access: "官方 SDMX CSV；已实现宏观展示适配器", status: "approved", integration: "ready", note: "仅作宏观信息展示；非各国独立曲线，官方说明不拟用于寻找交易机会。" },
  { id: "sec", name: "SEC EDGAR", url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces", coverage: "美股财务与机构披露", frequency: "按披露更新", access: "公开 API；待接入", status: "approved", integration: "unconnected", note: "13F 是季末持仓且披露滞后，不含空头；不提供股票价格。" },
  { id: "pboc", name: "中国人民银行", url: "https://www.pbc.gov.cn/", coverage: "公开市场操作、货币与社融", frequency: "公告 / 月频", access: "官方公告与统计文件；待接入", status: "approved", integration: "unconnected", note: "未确认稳定的统一公开时序 API；先明确所用统计及发布时间。" },
  { id: "sse", name: "上海证券交易所", url: "https://www.sse.com.cn/transparency/services/index.shtml", coverage: "沪市披露、统计与行情", frequency: "披露 / 日频 / 授权行情", access: "交易所行情直连待接入", status: "approved", integration: "unconnected", note: "交易所直连行情遵循对应获取及再分发条款；本站免费日线接入与覆盖见AKShare及已发布快照。" },
  { id: "szse", name: "深圳证券交易所", url: "https://www.szse.cn/market/", coverage: "深市披露、估值与交易统计", frequency: "披露 / 日频 / 月频", access: "交易所行情直连待接入", status: "approved", integration: "unconnected", note: "交易所直连行情遵循对应获取及再分发条款；本站免费日线接入与覆盖见AKShare及已发布快照。" },
];
