# 推算出生时辰（`bazi_hour_candidates`）

推算出生时辰 - 出生时辰未知时，列出出生当天各时辰的候选：四柱、时柱十神与藏干、时柱与原局的干支关系、命宫、日主在时支的根、月令透时干、缺失五行与起运；给了前事年份时，再逐个候选列出这些年的流年、大运与时柱的关系。只列事实，不判断哪个时辰更可能：向用户核对六亲与前事、由用户确认后，用该候选的 birthHour、birthMinute 正式排盘。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `birthYear` | integer | 是 | — | 出生年 (1-9999；公元纪年) |
| `birthMonth` | integer | 是 | — | 出生月（1-12） |
| `birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `birthPlace` | string | 否 | — | 出生地点文本 |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `dayBoundary` | enum | 否 | `"midnight"` | 日柱换日：午夜或23点；时干沿用历法库的子时规则；可选值: `midnight` / `zi` |
| `longitude` | number | 否 | — | 出生地经度（-180 到 180；提供时按真太阳时校正出生时间） |
| `fromHour` | integer | 否 | — | 只列与钟表时段 [fromHour, toHour) 相交的候选；用户记得大致时段时用（如上午传 5 与 12），默认全天 |
| `toHour` | integer | 否 | — | 时段结束的钟点（不含），须晚于 fromHour，默认 24 |
| `eventYears` | integer[] | 否 | — | 用户确认过的前事年份（公历，如结婚、生子、升学、搬迁、亲人离世之年），最多 8 个：逐个候选列出这些年流年、大运与时柱的关系 |
| `detailLevel` | enum | 否 | `"default"` | 文本详略：default=各候选的区分事实；full=另附时柱神煞与判定口径（结构化结果始终带神煞与口径）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":1,"birthDay":9}' | node "$TB/scripts/taibu.mjs" call bazi_hour_candidates -
```

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":5,"birthDay":20,"fromHour":5,"toHour":12,"eventYears":[2015,2018]}' | node "$TB/scripts/taibu.mjs" call bazi_hour_candidates -
```

## 输出结构（structuredContent 顶层键）

- `出生日期`：出生日期
- `共有柱`：所列候选共有的柱（通常为年、月、日三柱）
- `日主`：日柱共有时的日主天干及五行
- `当天交节`：出生当天交节：节气、交节时刻与交节后的起始钟表时间
- `钟表时段`：给了 fromHour、toHour 时的钟表时段
- `候选数量`：所列候选时辰的个数
- `候选`：候选时辰
- `前事年份`：给出的前事年份
- `口径`：判定口径说明
- `计算规则`

