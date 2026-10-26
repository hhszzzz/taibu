# 八字流年扫描（`bazi_liunian_scan`）

八字流年扫描 - 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示。找「哪些年冲日柱」这类问题时用 pillars、types 筛选，只列命中的年份，同一字上的其他流年关系标为牵连，其余只给「未列出」条数；某一年的完整关系（含大运与原局之间）用 bazi_relations。只给事实，不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `disambiguation` | enum | 否 | `"reject"` | 夏令时跳时/重复时刻的解析策略；可选值: `reject` / `earlier` / `later` / `compatible` |
| `dayBoundary` | enum | 否 | `"midnight"` | 日柱换日：午夜或23点；时干沿用历法库的子时规则；可选值: `midnight` / `zi` |
| `longitude` | number | 否 | — | 出生地经度（-180 到 180；提供时按真太阳时校正出生时间） |
| `gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `birthYear` | integer | 是 | — | 出生年 (1-9999；公元纪年) |
| `birthMonth` | integer | 是 | — | 出生月（1-12） |
| `birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `birthHour` | integer | 否 | — | 出生时（0-23）；不知道出生时辰时省略，此时不排时柱，也不给命宫、时柱神煞与小运 |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59）；省略 birthHour 时不填 |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `birthPlace` | string | 否 | — | 出生地点文本 |
| `fromYear` | integer | 是 | — | 起始流年（公历年份，不早于出生年） |
| `toYear` | integer | 是 | — | 结束流年（含），与起始年合计不超过 30 年 |
| `pillars` | string[] | 否 | — | 只看流年同时涉及这些柱位的关系，如 ["日柱"]；「大运」在起运前指小运 |
| `types` | string[] | 否 | — | 只看这些类型的关系，如 ["六冲"]；只列出有该类关系的年份 |
| `yunSect` | enum | 否 | `1` | 起运换算法1或2（与 bazi_dayun 一致）；可选值: `1` / `2` |
| `detailLevel` | enum | 否 | `"default"` | 文本详略：default=只列所查事实；full=另附判定口径（结构化结果始终带口径与计算规则）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"fromYear":2024,"toYear":2033}' | node "$TB/scripts/taibu.mjs" call bazi_liunian_scan -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","fromYear":2026,"toYear":2035,"pillars":["日柱"]}' | node "$TB/scripts/taibu.mjs" call bazi_liunian_scan -
```

```bash
echo '{"gender":"female","birthYear":1988,"birthMonth":3,"birthDay":12,"fromYear":2024,"toYear":2053,"types":["六冲"]}' | node "$TB/scripts/taibu.mjs" call bazi_liunian_scan -
```

## 输出结构（structuredContent 顶层键）

- `扫描范围`：扫描的年份范围
- `筛选`：本次的筛选条件
- `原局四柱`：原局四柱（出生时辰未知时只有年、月、日三柱）
- `出生时辰`：只在出生时辰未知时出现：原局只有年、月、日三柱
- `逐年`：逐年事实
- `未列出`：筛选后没有列出的事实
- `口径`：判定口径说明
- `计算规则`

