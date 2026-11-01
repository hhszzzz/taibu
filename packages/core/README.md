# taibu-core

TaiBu 的命理术数算法核心库。

它提供两类能力：

- 各术数的算法、类型，以及规范化 text/json 输出
- MCP 工具定义、输入校验、执行入口与统一响应适配

## 工具列表

| 工具 | 说明 |
|------|------|
| `bazi` | 八字排盘 |
| `bazi_pillars_resolve` | 八字四柱反推出生时间候选 |
| `bazi_dayun` | 大运、小运、流年链路计算 |
| `bazi_relations` | 八字岁运刑冲合害详查（叠加大运、流年、流月、流日后的关系；原局之间的关系见 `bazi` 的干支关系；可按柱位 `pillars`、类型 `types` 筛选） |
| `bazi_wuxing` | 八字五行旺衰详查（月令旺衰与藏干透出、四干通根与无根、干支自坐、相邻天干生克、缺失五行；只列事实不判旺衰；可用 `sections` 只取部分事实组） |
| `bazi_liunian_scan` | 八字流年扫描（逐年干支、所在大运、与原局和大运的刑冲合害、太岁，最多 30 年；可按柱位、类型筛选） |
| `bazi_hepan` | 八字合盘（两人各排四柱，列两盘之间的干支关系、日主互见十神、日柱与年柱之间的关系、年命纳音与五行互补；只给事实不打分） |
| `bazi_hour_candidates` | 推算出生时辰（出生时辰未知时列当天各时辰的候选：四柱、时柱十神与藏干、时柱参与的关系、命宫、日主之根与起运；给 `eventYears` 时逐个候选列出前事之年的岁运关系；只列事实不排序） |
| `ziwei` | 紫微斗数排盘 |
| `ziwei_horoscope` | 紫微运限 |
| `ziwei_flying_star` | 紫微飞星与四化落宫分析 |
| `ziwei_palace` | 紫微宫位详查（三方四正、夹宫、借对宫、四化飞出飞入与运限叠加） |
| `liuyao` | 六爻排卦与分析 |
| `liuyao_line` | 六爻逐爻详查（纳甲六亲六神、日月作用、空破暗动、化变与伏神） |
| `meihua` | 梅花易数起卦与断卦 |
| `tarot` | 塔罗抽牌 |
| `almanac` | 黄历与择日信息 |
| `almanac_select` | 黄历择日筛选（区间内按宜忌与冲煞筛候选日） |
| `astrology` | 西方占星命盘与流运 |
| `astrology_point` | 占星单点详查（位置宫位、传统尊贵、宫主星、相位与流运触发；`focus` 可只看本命或流运） |
| `qimen` | 奇门遁甲排盘 |
| `qimen_palace` | 奇门宫位详查（天地盘与寄干、星门神、状态旺衰、生克与格局） |
| `taiyi` | 太乙九星观测与传统七十二局（现代历法适配） |
| `daliuren` | 大六壬排盘 |
| `daliuren_lessons` | 大六壬课传详查（四课上下贼克、三传递进、神将与类神；`focus` 可只看课、传或类神） |
| `xiaoliuren` | 小六壬占测 |

8 个详查工具（`bazi_relations`、`bazi_wuxing`、`bazi_liunian_scan`、`ziwei_palace`、`liuyao_line`、`astrology_point`、`qimen_palace`、`daliuren_lessons`）的 `detailLevel` 只有 `default` / `full` 两档，只决定文本详略：默认只列所查事实，`full` 另附判定口径；`structuredContent` 始终带口径与计算规则。计算规则只供审计与复现，任何工具的文本都不写入。筛选参数同时作用于文本与结构化结果；八字关系类筛选另列与所列关系共用同一字的「同字牵连」，并给出「未列出」条数。

## 安装

```bash
npm install taibu-core
```

如需使用 GitHub Packages 镜像包，请改用 `@hhszzzz/taibu-core`。npmjs 主包名仍然是 `taibu-core`。

## Quick Start

### 直接使用某个术数

```ts
import { calculateBazi, toBaziText, toBaziJson } from 'taibu-core/bazi';

const chart = calculateBazi({
  gender: 'male',
  birthYear: 1990,
  birthMonth: 1,
  birthDay: 15,
  birthHour: 9,
});

const text = toBaziText(chart);
const json = toBaziJson(chart);
```

### 按 MCP 工具名执行

```ts
import { executeTool, renderToolResult } from 'taibu-core/mcp';

const result = await executeTool('qimen', {
  year: 2026,
  month: 3,
  day: 19,
  hour: 21,
  minute: 30,
  timezone: 'Asia/Shanghai',
});

const rendered = renderToolResult('qimen', result);
```

## 选择入口

- `taibu-core`
  - 根入口，聚合常用术数能力与类型
- `taibu-core/mcp`
- MCP 工具执行与输出适配
- `taibu-core/<domain>`
  - 某个术数的算法、类型、`to*Text()`、`to*Json()`

当前 domain 子路径包括：

- `taibu-core/bazi`
- `taibu-core/bazi-dayun`
- `taibu-core/bazi-pillars-resolve`
- `taibu-core/astrology`
- `taibu-core/almanac`
- `taibu-core/liuyao`
- `taibu-core/meihua`
- `taibu-core/ziwei`
- `taibu-core/ziwei-horoscope`
- `taibu-core/ziwei-flying-star`
- `taibu-core/qimen`
- `taibu-core/taiyi`
- `taibu-core/daliuren`
- `taibu-core/tarot`
- `taibu-core/xiaoliuren`

额外公开的共享子路径：

- `taibu-core/utils`
- `taibu-core/timezone-utils`
- `taibu-core/data/hexagrams`
- `taibu-core/data/shensha`

## 包结构

- `domains/`
  - 各术数 domain 的算法、本领域类型，以及 canonical text/json 输出
- `mcp/`
  - MCP 工具定义、schema、执行与统一 payload 适配
- `shared/`
  - 跨 domain 复用的公共工具
- `data/`
  - 干支、神煞、卦象文本等基础数据

## 输出约定

`taibu-core/mcp` 的 `renderToolResult(...)` 和 `buildToolSuccessPayload(...)` 使用统一输出契约：

- `content`
  - 始终返回 canonical text，适合直接阅读
- `structuredContent`
  - 当工具声明了 `outputSchema` 时返回 canonical JSON，适合程序消费

也就是说：

- 如果你是人类阅读场景，读 `content`
- 如果你是 schema 驱动场景，读 `structuredContent`

MCP 在发送结构化结果前按公开 schema 校验字段类型、必需主节和完整盘面数量。
不符合契约的结果抛出 `CoreOutputError`，错误码为 `OUTPUT_SCHEMA_MISMATCH`。
新增输入校验通常抛出根入口导出的 `CoreInputError`，含 `code` 和 `path`；历史 API 的部分错误仍为普通 `Error`。

## 算法口径与复现

完整支持矩阵、边界、来源和验证范围见 [ALGORITHM_RULES.md](./ALGORITHM_RULES.md)。
直接算法依赖固定为本次验证的版本；仓库锁文件同时固定传递依赖。独立 npm 消费者应保留自己的锁文件，重新升级依赖后重新运行规则回归测试。

- 八字与大运支持 `timezone`、`disambiguation`、`dayBoundary`，大运另支持 `yunSect: 1 | 2`；不知道出生时辰时省略 `birthHour`，只排年、月、日三柱，起运给出范围。
- 推算时辰（`bazi_hour_candidates`）逐分钟枚举出生当天的四柱，返回各候选时辰的区分事实与确认后排盘用的出生时间。
- 四柱反推支持 `startYear`、`endYear` 和同一组历法规则，返回按分钟搜索的半开候选时间区间。
- 紫微三工具共用 `calculationOptions`，可选算法、年界、运限界、年龄界、子时界、闰月策略和十干四化覆盖表。
- 六爻增加 `method: 'coins'`（初爻到上爻六个 `yaoValues: 6..9`）与 `'yarrow'`（蓍草概率模型）。
- 奇门支持转盘/飞盘、拆补/茅山/节气均分，以及显式手工阴阳遁和局数。
- 太乙用 `system: 'traditional'` 选择七十二局，`'nine-star'` 保持原有九星功能。
- 六壬支持手工 `monthGeneral`、强制昼夜或 `dayNight: 'sunrise'`；日出规则需要经纬度。
- 占星支持七种宫制、显式时区、自定义相位容许度，以及带固定 `ayanamsa` 的恒星黄道。
- 塔罗支持全牌/大牌/小牌、自定义牌阵、逆位概率和固定生命数字参考年。
- 小六壬支持公历日期输入、明确的 `hourType` 和闰月计数策略。

结构化结果中的 `计算规则` 与原始结果的选项快照用于复现口径；`计算规则` 只在 `structuredContent` 里，不写进文本。保存历史结果时应同时保存输入、随机种子和原始输出。
日期/时区拒绝无效值；没有实现的分支会报错。历史保存结果缺少新增元数据时仍可渲染。

## 版本批次

| 版本 | 批次说明 |
|------|----------|
| `4.0.0` | 新增 8 个详查工具（`bazi_relations`、`bazi_wuxing`、`bazi_liunian_scan`、`ziwei_palace`、`liuyao_line`、`qimen_palace`、`daliuren_lessons`、`astrology_point`）与 `almanac_select`、`bazi_hepan`、`bazi_hour_candidates`；15 个方法（`taibu-core/mcp` 的方法 API）与 `tool_search`；八字不知时辰时只排三柱。**破坏性**：工具文本只写新事实，计算规则只在结构化结果；`bazi_relations` 只列岁运叠加关系；`bazi_wuxing` 去掉五行统计、相生链、十神分布与透干；`almanac_select.excludeClash` 改为数组；不再导出 `calculateBaziFiveElementsStats` |
| `3.6.0` | 六爻反伏范围、应期提示类型、未成三合提示与逐候选依据等可选输出字段 |

更早的版本见 Git 历史。

## Related Packages

- [`taibu-mcp`](https://www.npmjs.com/package/taibu-mcp)
  - 适合本地 `stdio` MCP Server 场景

## License

`taibu-core` 使用 `MIT` 许可证，详见当前目录下的 `LICENSE` 文件。
