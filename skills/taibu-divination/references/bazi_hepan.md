# 八字合盘（`bazi_hepan`）

八字合盘 - 两人各排四柱，列出两盘之间的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，日主互见的十神与五行生克，日柱（日主与夫妻宫）、年柱（生肖与年命纳音）之间的关系，以及一方所缺、另一方原局有的五行。问两人合不合、婚配、合作或亲子相处时使用；各自盘内的关系见各自的八字命盘。只给事实，不打分、不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `a` | object | 是 | — | 甲方的出生信息，参数与 bazi 相同 |
| `a.name` | string | 否 | — | 称呼（如「我」「对方」或名字，不含空白、「·」或「｜」），标在柱名前；省略时为「甲方」，两人不能相同 |
| `a.timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `a.disambiguation` | enum | 否 | `"reject"` | 夏令时跳时/重复时刻的解析策略；可选值: `reject` / `earlier` / `later` / `compatible` |
| `a.dayBoundary` | enum | 否 | `"midnight"` | 日柱换日：午夜或23点；时干沿用历法库的子时规则；可选值: `midnight` / `zi` |
| `a.longitude` | number | 否 | — | 出生地经度（-180 到 180；提供时按真太阳时校正出生时间） |
| `a.gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `a.birthYear` | integer | 是 | — | 出生年 (1-9999；公元纪年) |
| `a.birthMonth` | integer | 是 | — | 出生月（1-12） |
| `a.birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `a.birthHour` | integer | 是 | — | 出生时（0-23） |
| `a.birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `a.calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `a.isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `a.birthPlace` | string | 否 | — | 出生地点文本 |
| `b` | object | 是 | — | 乙方的出生信息，参数与 bazi 相同 |
| `b.name` | string | 否 | — | 称呼（如「我」「对方」或名字，不含空白、「·」或「｜」），标在柱名前；省略时为「乙方」，两人不能相同 |
| `b.timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `b.disambiguation` | enum | 否 | `"reject"` | 夏令时跳时/重复时刻的解析策略；可选值: `reject` / `earlier` / `later` / `compatible` |
| `b.dayBoundary` | enum | 否 | `"midnight"` | 日柱换日：午夜或23点；时干沿用历法库的子时规则；可选值: `midnight` / `zi` |
| `b.longitude` | number | 否 | — | 出生地经度（-180 到 180；提供时按真太阳时校正出生时间） |
| `b.gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `b.birthYear` | integer | 是 | — | 出生年 (1-9999；公元纪年) |
| `b.birthMonth` | integer | 是 | — | 出生月（1-12） |
| `b.birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `b.birthHour` | integer | 是 | — | 出生时（0-23） |
| `b.birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `b.calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `b.isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `b.birthPlace` | string | 否 | — | 出生地点文本 |
| `detailLevel` | enum | 否 | `"default"` | 文本详略：default=双方要点与两盘之间的事实；full=另附四柱纳音与判定口径（结构化结果始终带口径）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"a":{"name":"男方","gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9},"b":{"name":"女方","gender":"female","birthYear":1992,"birthMonth":8,"birthDay":3,"birthHour":14}}' | node "$TB/scripts/taibu.mjs" call bazi_hepan -
```

```bash
echo '{"a":{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar"},"b":{"gender":"male","birthYear":1993,"birthMonth":11,"birthDay":2,"birthHour":7,"birthMinute":30}}' | node "$TB/scripts/taibu.mjs" call bazi_hepan -
```

## 输出结构（structuredContent 顶层键）

- `双方`：双方四柱要点
- `日主互见`：日主互见
- `年命纳音`：年命纳音
- `日柱之间`：同时涉及双方日柱的关系（日主与夫妻宫）
- `年柱之间`：同时涉及双方年柱、不涉及双方日柱的关系（生肖）
- `其余关系`：两盘之间的其余干支关系
- `五行互补`：一方缺失、另一方原局有的五行
- `口径`：判定口径说明
- `计算规则`

