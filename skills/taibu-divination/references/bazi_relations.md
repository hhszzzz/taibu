# 八字刑冲合害（`bazi_relations`）

八字刑冲合害 - 在八字命盘上详查干支关系：原局四柱之间，以及叠加大运（起运前为小运）、流年、流月、流日后的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，附岁运并临、伏吟、天克地冲与太岁关系。只给事实，不下吉凶结论。

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
| `year` | integer | 否 | — | 流年（公历年份）；给出后自动叠加所在大运 |
| `month` | integer | 否 | — | 流月：节气月序号 1–12（1=寅月，自立春起；12=丑月，自小寒起），须同时给出 year |
| `day` | string | 否 | — | 流日 YYYY-MM-DD，与 year/month 互斥；自动叠加当日的流年、流月与所在大运 |
| `dayun` | integer | 否 | — | 大运序号 1–10；省略时按流年自动选取 |
| `yunSect` | enum | 否 | `1` | 起运换算法1或2（与 bazi_dayun 一致）；可选值: `1` / `2` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}' | node "$TB/scripts/taibu.mjs" call bazi_relations -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","year":2027}' | node "$TB/scripts/taibu.mjs" call bazi_relations -
```

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"year":2027,"month":5}' | node "$TB/scripts/taibu.mjs" call bazi_relations -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","day":"2027-06-10"}' | node "$TB/scripts/taibu.mjs" call bazi_relations -
```

## 输出结构（structuredContent 顶层键）

- `查询`：本次叠加的层次；仅原局时为空
- `参与柱位`：参与判断的全部柱位
- `原局关系`：原局四柱之间的干支关系
- `叠加关系`：至少涉及一个叠加柱的干支关系
- `岁运提示`：岁运并临、伏吟、天克地冲
- `太岁关系`：流年地支与年支的值、冲、合、刑、害、破
- `口径`：判定口径说明
- `计算规则`

