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
  { id: "treasury", name: "美国财政部", url: "https://home.treasury.gov/treasury-daily-interest-rate-xml-feed", coverage: "美国国债固定期限收益率", frequency: "营业日日频", access: "官方 XML；已实现采集适配器", status: "approved", integration: "ready", note: "固定期限曲线估计值，不是单只债券可成交价格；来源已确认；打开运行配置及采集阀后才联网。" },
  { id: "nyfed", name: "纽约联储", url: "https://markets.newyorkfed.org/static/docs/markets-api.html", coverage: "SOFR、EFFR 与市场操作", frequency: "按各序列发布时间", access: "官方 API；待接入", status: "approved", integration: "unconnected", note: "遵循参考利率使用条款；不能作为实时融资报价。" },
  { id: "fed", name: "美联储", url: "https://www.federalreserve.gov/releases/h41/", coverage: "资产负债表、准备金与政策公告", frequency: "周频 / 公告", access: "官方统计发布；待接入", status: "approved", integration: "unconnected", note: "周频观察不能标为每日新增；不经 FRED 转发模型处理。" },
  { id: "company-filings", name: "上市公司官方公告", url: "https://www.sec.gov/edgar/search/", coverage: "公司财报与重大事项", frequency: "按披露更新", access: "SEC、交易所及发行人公告；待接入", status: "approved", integration: "unconnected", note: "按公司逐一核实原始公告链接；不把媒体转述作为正式财务数据。" },
  { id: "japan-mof", name: "日本财务省", url: "https://www.mof.go.jp/english/policy/jgbs/reference/interest_rate/qa.htm", coverage: "日本国债 10 年固定期限收益率", frequency: "下一营业日 09:30 JST 发布", access: "官方 CSV；已实现 10 年期采集", status: "approved", integration: "ready", note: "提取财务省10年列；单位%，半年度复利、15:00 JST观察；采集确认时间为保守可用时间。官网PDL1.0，保留来源归属。" },
  { id: "ecb", name: "欧洲央行", url: "https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations=5", coverage: "欧元区 AAA 10 年即期合成曲线（连续复利）", frequency: "TARGET 营业日日频", access: "官方 SDMX CSV；已实现宏观展示适配器", status: "approved", integration: "ready", note: "仅作宏观信息展示；非各国独立曲线，官方说明不拟用于寻找交易机会。" },
  { id: "sec", name: "SEC EDGAR", url: "https://www.sec.gov/search-filings/edgar-application-programming-interfaces", coverage: "美股财务与机构披露", frequency: "按披露更新", access: "公开 API；待接入", status: "approved", integration: "unconnected", note: "13F 是季末持仓且披露滞后，不含空头；不提供股票价格。" },
  { id: "pboc", name: "中国人民银行", url: "https://www.pbc.gov.cn/", coverage: "公开市场操作、货币与社融", frequency: "公告 / 月频", access: "官方公告与统计文件；待接入", status: "approved", integration: "unconnected", note: "未确认稳定的统一公开时序 API；先明确所用统计及发布时间。" },
  { id: "sse", name: "上海证券交易所", url: "https://www.sse.com.cn/transparency/services/index.shtml", coverage: "沪市披露、统计与行情", frequency: "披露 / 日频 / 授权行情", access: "完整股票价格需授权", status: "approved", integration: "unconnected", note: "公开网页可阅读不代表可批量抓取、公开转发；实时及历史行情另需授权。" },
  { id: "szse", name: "深圳证券交易所", url: "https://www.szse.cn/market/", coverage: "深市披露、估值与交易统计", frequency: "披露 / 日频 / 月频", access: "股票价格需授权；待接入", status: "approved", integration: "unconnected", note: "需确认数据获取及再分发权限；缺少授权行情时保持未覆盖。" },
];
