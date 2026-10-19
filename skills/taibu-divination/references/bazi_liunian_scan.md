# 八字流年扫描（`bazi_liunian_scan`）

八字流年扫描 - 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示；可按柱位或关系类型筛选。只给事实，不下吉凶结论。

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
| `birthHour` | integer | 是 | — | 出生时（0-23） |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `birthPlace` | string | 否 | — | 出生地点文本 |
| `fromYear` | integer | 是 | — | 起始流年（公历年份，不早于出生年） |
| `toYear` | integer | 是 | — | 结束流年（含），与起始年合计不超过 30 年 |
| `focus` | enum | 否 | — | 只看涉及该柱位（年柱/月柱/日柱/时柱/大运）或该关系类型（如 六冲、相刑）的年份；可选值: `年柱` / `月柱` / `日柱` / `时柱` / `大运` / `天干五合` / `天干相冲` / `六合` / `三合` / `半合` / `三会` / `六冲` / `相刑` / `相害` / `相破` |
| `yunSect` | enum | 否 | `1` | 起运换算法1或2（与 bazi_dayun 一致）；可选值: `1` / `2` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"fromYear":2024,"toYear":2033}' | node "$TB/scripts/taibu.mjs" call bazi_liunian_scan -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","fromYear":2026,"toYear":2035,"focus":"日柱"}' | node "$TB/scripts/taibu.mjs" call bazi_liunian_scan -
```

## 输出结构（structuredContent 顶层键）

- `扫描范围`：扫描的年份范围与筛选
- `原局四柱`：原局四柱
- `逐年`：逐年事实
- `口径`：判定口径说明
- `计算规则`

