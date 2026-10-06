// 这个行业的分类体系：类别、标签词表、公司（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  {"key": "a-shares", "label": "A股", "section": "A股", "guide": "境内上市公司的财报、经营、分红、融资和 A 股市场变化。"},
  {"key": "us-stocks", "label": "美股", "section": "美股", "guide": "美国上市公司的财报、经营、估值和美股市场变化。"},
  {"key": "hk-stocks", "label": "港股", "section": "港股", "guide": "香港上市公司的财报、经营、估值、上市制度和港股市场变化；港元货币政策本身归宏观政策。"},
  {"key": "kr-stocks", "label": "韩股", "section": "韩股", "guide": "韩国上市公司的财报、经营、估值、上市制度和韩国股票市场变化；韩国央行利率政策本身归宏观政策。"},
  {"key": "jp-stocks", "label": "日股", "section": "日股", "guide": "日本上市公司的财报、经营、估值、上市制度和日本股票市场变化；日本央行政策本身归宏观政策，日债归全球国债。"},
  {"key": "us-treasury", "label": "美债", "section": "美债", "guide": "美国国债发行、拍卖、收益率曲线和期限溢价；收益率不能当作债券价格。"},
  {"key": "global-bonds", "label": "全球国债", "section": "全球国债", "guide": "美国以外的主权国债及跨国比较，必须标明国家、币种与期限。"},
  {"key": "macro", "label": "宏观政策", "section": "宏观政策", "guide": "央行政策、通胀、就业、财政、资金市场和跨资产流动性。"},
  {"key": "trade-watch", "label": "交易观察", "section": "交易观察", "guide": "市场结构、估值、拥挤度、流动性和情绪的证据分析；没有交易条件的观点归这里。", "commentary": true},
  {"key": "trade-ideas", "label": "交易推荐", "section": "交易推荐", "guide": "有明确标的、条件、失效点和期限的交易研究。禁止把预测写成已发生事实；不是自动下单或收益承诺。", "commentary": true},
] as const satisfies ReadonlyArray<{ key: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（AI 行业是新模型）：日报报头的“N 个新模型”、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = ["a股", "美股", "港股", "韩股", "日股", "国债", "gdp", "cpi", "pce", "pmi", "eps", "etf", "ipo", "pe", "pb", "roe", "sofr", "api", "ceo"];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["earnings_release", "market_move", "trading_framework", "research_report", "policy_event", "opinion_analysis", "risk_explainer"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = ["财报/业绩", "市场行情", "研究报告", "交易方法", "风险管理", "现象/趋势", "观点分析", "估值/比较", "风险事件", "公司动态", "政策/监管", "非金融/其他", "其他"] as const;
export const TOPIC_TAGS = ["A股", "美股", "港股", "韩股", "日股", "美债", "全球国债", "财报", "通胀", "就业", "利率", "流动性", "估值", "机构持仓", "市场情绪", "收益率曲线", "汇率", "交易策略"] as const;
export const ENTITY_TAGS = ["美联储", "美国财政部", "中国人民银行", "欧洲央行", "日本财务省", "SEC", "上交所", "深交所", "港交所", "香港证监会", "韩国金融委员会", "香港金管局", "韩国交易所", "韩国央行", "日本交易所集团", "日本央行", "NVIDIA", "Apple", "Google", "Meta", "Microsoft", "OpenAI", "Anthropic", "DeepSeek", "DeepMind", "xAI", "Hugging Face", "GitHub", "arXiv"] as const;
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {
  财报: "财报/业绩", 业绩: "财报/业绩", 盈利: "财报/业绩", 行情: "市场行情",
  合作: "公司动态", 融资: "公司动态", 收购: "公司动态", 并购: "公司动态", "融资/收购": "公司动态",
  政策: "政策/监管", 监管: "政策/监管", 法规: "政策/监管",
  研究: "研究报告", 论文: "研究报告", paper: "研究报告", papers: "研究报告",
  教程: "风险管理", 实践: "风险管理", 指南: "风险管理", "教程/玩法": "风险管理",
  观点: "观点分析", 趋势: "现象/趋势", 估值: "估值/比较", 风险: "风险事件",
};

// ── 公司与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 公司主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；otherNames 是公司自己的其他称呼（官方账号名、子品牌），
 * 把事实的主体对到发布方时也认它们。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; otherNames?: string[] }> = {
  fed: { name: "美联储", displayTag: "美联储", aliases: ["Federal Reserve", "FOMC", "美联储"] },
  treasury: { name: "美国财政部", displayTag: "美国财政部", aliases: ["U.S. Treasury", "美国财政部"] },
  pboc: { name: "中国人民银行", displayTag: "中国人民银行", aliases: ["PBOC", "中国人民银行", "央行"] },
  ecb: { name: "欧洲央行", displayTag: "欧洲央行", aliases: ["ECB", "European Central Bank", "欧洲央行"] },
  "japan-mof": { name: "日本财务省", displayTag: "日本财务省", aliases: ["Japan Ministry of Finance", "日本财务省"] },
  sec: { name: "SEC", displayTag: "SEC", aliases: ["SEC", "美国证券交易委员会"] },
  sse: { name: "上交所", displayTag: "上交所", aliases: ["上海证券交易所", "上交所"] },
  szse: { name: "深交所", displayTag: "深交所", aliases: ["深圳证券交易所", "深交所"] },
  hkex: { name: "港交所", displayTag: "港交所", aliases: ["HKEX", "Hong Kong Exchanges and Clearing", "香港交易所", "港交所"] },
  sfc: { name: "香港证监会", displayTag: "香港证监会", aliases: ["SFC", "Securities and Futures Commission", "香港证券及期货事务监察委员会", "香港证监会"] },
  fsc: { name: "韩国金融委员会", displayTag: "韩国金融委员会", aliases: ["FSC", "Financial Services Commission", "금융위원회", "韩国金融委员会"] },
  hkma: { name: "香港金管局", displayTag: "香港金管局", aliases: ["HKMA", "Hong Kong Monetary Authority", "香港金融管理局"] },
  krx: { name: "韩国交易所", displayTag: "韩国交易所", aliases: ["KRX", "Korea Exchange", "한국거래소", "韩国交易所"] },
  bok: { name: "韩国央行", displayTag: "韩国央行", aliases: ["Bank of Korea", "한국은행", "韩国银行", "韩国央行"] },
  jpx: { name: "日本交易所集团", displayTag: "日本交易所集团", aliases: ["JPX", "Japan Exchange Group", "Tokyo Stock Exchange", "日本取引所グループ", "东京证券交易所"] },
  boj: { name: "日本央行", displayTag: "日本央行", aliases: ["Bank of Japan", "日本銀行", "日本银行", "日本央行"] },
  apple: { name: "Apple", displayTag: "Apple", aliases: ["Apple", "苹果公司"] },
  "world-labs": { name: "World Labs", displayTag: null, aliases: ["World Labs"] },
  "thinking-machines": { name: "Thinking Machines Lab", displayTag: null, aliases: ["Thinking Machines"] },
  amd: { name: "AMD", displayTag: null, aliases: ["AMD", "Advanced Micro Devices"] },
  openai: { name: "OpenAI", displayTag: "OpenAI", aliases: ["OpenAI", "ChatGPT", "Sora", "Codex", "GPT"], otherNames: ["OpenAI Developers"] },
  anthropic: { name: "Anthropic", displayTag: "Anthropic", aliases: ["Anthropic", "Claude"], otherNames: ["Claude Code"] },
  google: { name: "Google", displayTag: "Google", aliases: ["Google", "DeepMind", "Gemini", "谷歌"], otherNames: ["Google DeepMind", "Google Research", "Google AI", "Google Labs", "Google Cloud"] },
  deepseek: { name: "DeepSeek", displayTag: "DeepSeek", aliases: ["DeepSeek", "深度求索"] },
  qwen: { name: "千问 Qwen", displayTag: null, aliases: ["Qwen", "通义", "阿里"], otherNames: ["通义千问", "千问", "千问APP", "Qwen Team", "通义实验室", "阿里巴巴", "Alibaba", "阿里云", "Alibaba Cloud"] },
  kimi: { name: "Kimi / 月之暗面", displayTag: null, aliases: ["Kimi", "月之暗面", "Moonshot"], otherNames: ["Moonshot AI"] },
  minimax: { name: "MiniMax", displayTag: null, aliases: ["MiniMax", "海螺"], otherNames: ["稀宇科技"] },
  zhipu: { name: "智谱 GLM", displayTag: null, aliases: ["智谱", "GLM", "Z.ai"], otherNames: ["智谱AI", "Zhipu", "Zhipu AI"] },
  xai: { name: "xAI", displayTag: "xAI", aliases: ["xAI", "Grok"], otherNames: ["SpaceXAI"] },
  meta: { name: "Meta", displayTag: "Meta", aliases: ["Meta", "Llama"], otherNames: ["Meta AI", "AI at Meta"] },
  microsoft: { name: "Microsoft", displayTag: "Microsoft", aliases: ["Microsoft", "微软", "Copilot"], otherNames: ["Microsoft Research", "Microsoft AI"] },
  nvidia: { name: "NVIDIA", displayTag: null, aliases: ["NVIDIA", "英伟达"] },
  "hugging-face": { name: "Hugging Face", displayTag: "Hugging Face", aliases: ["Hugging Face"], otherNames: ["HuggingFace"] },
  cursor: { name: "Cursor", displayTag: null, aliases: ["Cursor", "Anysphere"] },
  openrouter: { name: "OpenRouter", displayTag: null, aliases: ["OpenRouter"] },
};

/**
 * 身份词典：摘要和标题里出现的公司，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [
  { id: "fed", name: "美联储", patterns: [/\bfederal reserve\b|\bfomc\b|美联储/i] },
  { id: "treasury", name: "美国财政部", patterns: [/美国财政部|\bu\.?s\.? treasury\b/i] },
  { id: "pboc", name: "中国人民银行", patterns: [/中国人民银行|\bpboc\b/i] },
  { id: "ecb", name: "欧洲央行", patterns: [/欧洲央行|\becb\b|european central bank/i] },
  { id: "hkex", name: "港交所", patterns: [/港交所|香港交易所|\bhkex\b|hong kong exchanges and clearing/i] },
  { id: "sfc", name: "香港证监会", patterns: [/香港证监会|香港证券及期货事务监察委员会|\bsfc\b|securities and futures commission/i] },
  { id: "fsc", name: "韩国金融委员会", patterns: [/韩国金融委员会|금융위원회|\bfsc\b|financial services commission/i] },
  { id: "hkma", name: "香港金管局", patterns: [/香港金管局|香港金融管理局|\bhkma\b|hong kong monetary authority/i] },
  { id: "krx", name: "韩国交易所", patterns: [/韩国交易所|한국거래소|\bkrx\b|korea exchange/i] },
  { id: "bok", name: "韩国央行", patterns: [/韩国央行|韩国银行|한국은행|bank of korea/i] },
  { id: "jpx", name: "日本交易所集团", patterns: [/日本交易所集团|日本取引所グループ|东京证券交易所|\bjpx\b|japan exchange group|tokyo stock exchange/i] },
  { id: "boj", name: "日本央行", patterns: [/日本央行|日本银行|日本銀行|bank of japan/i] },
  { id: "openai", name: "OpenAI", patterns: [/openai|chatgpt|\bgpt-?[o\d]|\bsora\b|\bcodex\b/i] },
  { id: "anthropic", name: "Anthropic", patterns: [/anthropic|\bclaude\b/i, /\b(?:opus|sonnet|haiku)\s*\d+(?:[.\-]\d+)*\b/i, /\bfable\s*\d+(?:[.\-]\d+)*\b|\bmythos\b/i] },
  { id: "google", name: "Google / Gemini", patterns: [/google|deepmind|\bgemini\b|notebooklm|\bveo\s?\d|\bAlphaFold\b|\bAMIE\b/i] },
  { id: "deepseek", name: "DeepSeek", patterns: [/deepseek|深度求索/i] },
  { id: "xai", name: "xAI / Grok", patterns: [/\bxai\b|\bgrok\b/i] },
  { id: "meta", name: "Meta / Llama", patterns: [/\bMeta\b/, /\bmeta\s?ai\b|\bllama\b/i] },
  { id: "microsoft", name: "Microsoft / Copilot", patterns: [/microsoft|copilot|微软/i] },
  { id: "nvidia", name: "NVIDIA", patterns: [/nvidia|英伟达|\bnemotron\b|\bnemo\b|\bblackwell\b|\brubin(?:\s+ultra)?\b|\bcuda\b/i] },
  { id: "qwen", name: "千问 Qwen", patterns: [/\bqwen|通义|千问/i] },
  { id: "hugging-face", name: "Hugging Face", patterns: [/hugging\s?face/i] },
  { id: "cursor", name: "Cursor", patterns: [/\bCursor\b/] },
  { id: "kimi", name: "Kimi / 月之暗面", patterns: [/\bkimi\b|月之暗面|\bmoonshot\s?ai\b/i] },
  { id: "openrouter", name: "OpenRouter", patterns: [/openrouter/i] },
  { id: "minimax", name: "MiniMax", patterns: [/minimax/i] },
  { id: "zhipu", name: "智谱 GLM", patterns: [/智谱|\bglm-?[4-9]/i] },
  { id: "hunyuan", name: "腾讯混元", patterns: [/混元|hunyuan/i] },
  { id: "doubao", name: "字节豆包", patterns: [/豆包|doubao|字节跳动|bytedance/i] },
  { id: "mistral", name: "Mistral", patterns: [/mistral/i] },
  { id: "perplexity", name: "Perplexity", patterns: [/\bPerplexity\b/] },
  { id: "runway", name: "Runway", patterns: [/\brunway\b/i] },
  { id: "suno", name: "Suno", patterns: [/\bsuno\b/i] },
  { id: "midjourney", name: "Midjourney", patterns: [/midjourney/i] },
  { id: "stability-ai", name: "Stability AI", patterns: [/stability\s?ai/i] },
  { id: "elevenlabs", name: "ElevenLabs", patterns: [/eleven\s?labs/i] },
  { id: "vllm", name: "vLLM", patterns: [/\bvllm\b/i] },
  { id: "ollama", name: "Ollama", patterns: [/\bollama\b/i] },
  { id: "windsurf", name: "Windsurf", patterns: [/windsurf/i] },
  { id: "devin", name: "Devin", patterns: [/\bdevin\b/i] },
  { id: "manus", name: "Manus", patterns: [/\bmanus\b/i] },
  { id: "apple", name: "Apple", patterns: [/\bapple\b|苹果公司/i, /\bapple\s?(intelligence|silicon|ai)\b|苹果(智能|\s?AI)/i] },
  { id: "amazon", name: "Amazon / AWS", patterns: [/amazon|\baws\b|亚马逊/i] },
  { id: "baidu", name: "百度文心", patterns: [/百度|baidu|文心|\bernie\s?bot\b/i] },
];

/** 这些域名上的文章，发布方就是对应的公司（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [
  { entityId: "hkex", domains: ["hkex.com.hk"] },
  { entityId: "sfc", domains: ["sfc.hk"] },
  { entityId: "fsc", domains: ["fsc.go.kr"] },
  { entityId: "hkma", domains: ["hkma.gov.hk"] },
  { entityId: "krx", domains: ["krx.co.kr"] },
  { entityId: "bok", domains: ["bok.or.kr"] },
  { entityId: "jpx", domains: ["jpx.co.jp"] },
  { entityId: "boj", domains: ["boj.or.jp"] },
  { entityId: "openai", domains: ["openai.com"] },
  { entityId: "anthropic", domains: ["anthropic.com", "claude.com"] },
  { entityId: "google", domains: ["deepmind.google", "ai.google", "blog.google"] },
  { entityId: "deepseek", domains: ["deepseek.com"] },
  { entityId: "xai", domains: ["x.ai"] },
  { entityId: "meta", domains: ["ai.meta.com"] },
  { entityId: "microsoft", domains: ["microsoft.com"] },
  { entityId: "nvidia", domains: ["nvidia.com"] },
  { entityId: "qwen", domains: ["qwen.ai"] },
  { entityId: "cursor", domains: ["cursor.com"] },
  { entityId: "openrouter", domains: ["openrouter.ai"] },
];

/** 原文里的这些写法也算提到了对应公司。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [
  { entityId: "meta", pattern: /@AIatMeta\b/i },
  { entityId: "zhipu", pattern: /\bZhipu(?:\s+AI\b|['’]s\b)/i },
];
