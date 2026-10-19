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
| `bazi_relations` | 八字刑冲合害详查（原局与大运、流年、流月、流日叠加） |
| `ziwei` | 紫微斗数排盘 |
| `ziwei_horoscope` | 紫微运限 |
| `ziwei_flying_star` | 紫微飞星与四化落宫分析 |
| `liuyao` | 六爻排卦与分析 |
| `meihua` | 梅花易数起卦与断卦 |
| `tarot` | 塔罗抽牌 |
| `almanac` | 黄历与择日信息 |
| `astrology` | 西方占星命盘与流运 |
| `qimen` | 奇门遁甲排盘 |
| `taiyi` | 太乙九星观测与传统七十二局（现代历法适配） |
| `daliuren` | 大六壬排盘 |
| `xiaoliuren` | 小六壬占测 |

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

- 八字与大运支持 `timezone`、`disambiguation`、`dayBoundary`，大运另支持 `yunSect: 1 | 2`。
- 四柱反推支持 `startYear`、`endYear` 和同一组历法规则，返回按分钟搜索的半开候选时间区间。
- 紫微三工具共用 `calculationOptions`，可选算法、年界、运限界、年龄界、子时界、闰月策略和十干四化覆盖表。
- 六爻增加 `method: 'coins'`（初爻到上爻六个 `yaoValues: 6..9`）与 `'yarrow'`（蓍草概率模型）。
- 奇门支持转盘/飞盘、拆补/茅山/节气均分，以及显式手工阴阳遁和局数。
- 太乙用 `system: 'traditional'` 选择七十二局，`'nine-star'` 保持原有九星功能。
- 六壬支持手工 `monthGeneral`、强制昼夜或 `dayNight: 'sunrise'`；日出规则需要经纬度。
- 占星支持七种宫制、显式时区、自定义相位容许度，以及带固定 `ayanamsa` 的恒星黄道。
- 塔罗支持全牌/大牌/小牌、自定义牌阵、逆位概率和固定生命数字参考年。
- 小六壬支持公历日期输入、明确的 `hourType` 和闰月计数策略。

新增结果中的 `计算规则` 与原始结果的选项快照用于复现口径。保存历史结果时应同时保存输入、随机种子和原始输出。
日期/时区拒绝无效值；没有实现的分支会报错。历史保存结果缺少新增元数据时仍可渲染。

## Related Packages

- [`taibu-mcp`](https://www.npmjs.com/package/taibu-mcp)
  - 适合本地 `stdio` MCP Server 场景

## License

`taibu-core` 使用 `MIT` 许可证，详见当前目录下的 `LICENSE` 文件。
