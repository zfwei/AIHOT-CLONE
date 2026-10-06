# 项目图表汇总

> 本文件由 ai-dev-workflow 自动维护。每次开发任务完成后，新增一组图表记录，
> 包含：架构图、核心业务流程图、时序图、活动图、用例图、思维导图。
> 对应的 PNG 导出文件位于 `docs/diagrams/` 目录下。

本组描述 `modules/markets/` 的实际实现。公开行情与个人持仓分开：市场数据走统一公开读取层，个人数量与成本仅保存在浏览器。来源获确认不代表已接入，缺失数据不生成曲线或结论。均线是未回测观察，系统不执行交易。

## 系统架构图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
flowchart LR
  subgraph Production["数据生产"]
    direction TB
    S["官方数据源"] -->|采集阀开启| W["官方日频适配器（美债 / 日债 / ECB宏观曲线）<br/>ECB仅作宏观信息展示"]
    A["管理员：会话 + CSRF"] -->|核验 JSON| P["市场快照发布 + 审计"]
    W --> P
  end
  subgraph PublicRead["公开读取"]
    direction TB
    DB[("settings：公开快照")] --> R["publication/module-data"]
    R --> API["GET /api/v1/markets"]
  end
  subgraph Browser["读者浏览器"]
    direction TB
    WEB["React Router SSR / 市场页面"] --> READER["公开研究读者"]
    WEB -->|主动保存| LOCAL[("localStorage：个人持仓")]
    LOCAL --> CALC["本地估值 / 风险预算"]
  end
  P --> DB
  API --> WEB
  API -->|公开价格| CALC
```

[PNG](diagrams/architecture-2026-10-06.png) · [Mermaid 源码](diagrams/architecture-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/architecture-2026-10-06.drawio)

## 核心业务流程图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
flowchart TD
  A["管理员请求官方日频采集（美债 / 日债 / ECB宏观曲线）"] --> B{"来源已确认且采集阀开启？"}
  B -->|否| C["409：不联网"]
  B -->|是| D["202：任务已入队，尚未完成"]
  D --> E["Worker 再次检查采集阀"]
  E --> F["读取官方 XML 或 CSV / 限时限量"]
  F --> G["解析真实期限点 / 区分观测日与可用时点"]
  G --> H{"数据与单位校验通过？"}
  H -->|否| I["失败记录：保留旧快照"]
  H -->|是| J["合并历史 / 原子发布 / 审计"]
  J --> K["读者刷新：展示来源与有效期"]
```

[PNG](diagrams/business-flow-2026-10-06.png) · [Mermaid 源码](diagrams/business-flow-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/business-flow-2026-10-06.drawio)

## 时序图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
sequenceDiagram
  actor Admin as 管理员
  participant API as API
  participant Queue as pg-boss / Worker
  participant Source as 官方来源（美债 / 日债 / ECB宏观曲线）
  participant DB as PostgreSQL
  Admin->>API: POST /api/admin/markets/collect + source + CSRF + reason
  API->>API: 会话 / 来源确认 / 采集阀
  API->>DB: 入队和操作审计（事务）
  API-->>Admin: 202 + jobId（不表示已采集）
  Queue->>Queue: 再检查 COLLECT_ENABLED
  Queue->>Source: 官方 XML 或 CSV（限时限量）
  Source-->>Queue: 真实观测值
  Queue->>DB: 校验 / 合并快照 / 发布审计（事务）
  Admin->>API: GET /api/v1/markets
  API->>DB: 经 publication 层读取
  API-->>Admin: 快照 + 来源 + 接入状态
```

[PNG](diagrams/sequence-2026-10-06.png) · [Mermaid 源码](diagrams/sequence-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/sequence-2026-10-06.drawio)

## 活动图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
flowchart TD
  A(["打开个人持仓页"]) --> B["读取公开价格与本地持仓"]
  B --> C["用户填写股票 / 数量 / 平均成本"]
  C --> D{"输入有效且主动保存？"}
  D -->|否| E["提示错误 / 保留已有数据"]
  D -->|是| F["只写浏览器 localStorage"]
  F --> G{"同口径股票价格有效？"}
  G -->|否| H["市值 / 盈亏 / 集中度未知"]
  G -->|是| I["按币种计算 / 不跨币种求和"]
  H --> J["用户填写风险预算参数"]
  I --> J
  J --> K{"资金 / 风险比例 / 入场 / 止损 / 手数完整？"}
  K -->|否| L["提示需要填写"]
  K -->|是| M["本地计算数量与计划风险"]
  M --> N(["用户自行判断；无下单接口"])
```

[PNG](diagrams/activity-2026-10-06.png) · [Mermaid 源码](diagrams/activity-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/activity-2026-10-06.drawio)

## 用例图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
flowchart LR
  Reader["公开读者"] --> Overview(["查看四市场与真实来源"])
  Reader --> Risk(["逐项核对四因子证据"])
  Reader --> Ideas(["查看条件式交易研究"])
  Reader --> Portfolio(["本地持仓与风险预算"])
  Admin["管理员"] --> Import(["核验并发布 JSON 快照"])
  Admin --> Collect(["在采集阀开启时提交任务"])
  Admin --> Audit(["核对运行与发布审计"])
  Source["官方数据源"] --> Collect
  Portfolio -.-> Boundary["隐私边界：不上传持仓"]
  Ideas -.-> NoTrade["能力边界：无自动交易"]
```

[PNG](diagrams/use-cases-2026-10-06.png) · [Mermaid 源码](diagrams/use-cases-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/use-cases-2026-10-06.drawio)

## 思维导图 - 2026-10-06 / AIQUANT 市场研究

```mermaid
%%{init: {"theme":"base","themeVariables":{"primaryColor":"#e6f2ee","primaryTextColor":"#202a30","primaryBorderColor":"#176b75","lineColor":"#607078","secondaryColor":"#f5ead7","tertiaryColor":"#eef1ed","fontFamily":"PingFang SC, Microsoft YaHei, sans-serif","fontSize":"16px","cScale0":"#dcece7","cScaleLabel0":"#202a30","cScale1":"#e4ecf4","cScaleLabel1":"#202a30","cScale2":"#f0e6d6","cScaleLabel2":"#202a30","cScale3":"#ebe4f0","cScaleLabel3":"#202a30","cScale4":"#e4e9d8","cScaleLabel4":"#202a30","cScale5":"#dfecef","cScaleLabel5":"#202a30"}}}%%
mindmap
  root((AIQUANT 市场研究))
    市场
      A股与美股
      美债与全球国债
    数据可信
      来源与真实时点
      缺失不补造
      已确认不等于已接入
    四因子
      估值与拥挤度
      流动性与投机
      四态独立判断
    交易研究
      条件与失效点
      20/60观察值均线
      未回测与无下单
    个人持仓
      仅浏览器保存
      分币种估值
      用户自填风险预算
    运行治理
      采集阀默认关闭
      JSON校验与审计
      统一公开读取层
```

[PNG](diagrams/mindmap-2026-10-06.png) · [Mermaid 源码](diagrams/mindmap-2026-10-06.mmd) · [draw.io 可编辑文件](diagrams/mindmap-2026-10-06.drawio)
