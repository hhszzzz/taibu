# 紫微宫位（`ziwei_palace`）

紫微宫位 - 在紫微命盘上聚焦一宫详查：本宫星曜亮度与生年四化、离心/向心自化，空宫借对宫，三方四正，夹宫，宫干四化飞出与十二宫四化飞入；指定大限、流年、流月、流日或流时时，叠加该运限宫所落的本命宫与运限四化落宫。三方四正取本宫、两个三合宫与对宫；空宫只借对宫主星。只问某宫化忌入哪宫、两宫是否相夹这类单点问题时改用 ziwei_flying_star。只给事实，不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `disambiguation` | enum | 否 | `"reject"` | 夏令时跳时/重复时刻的解析策略；可选值: `reject` / `earlier` / `later` / `compatible` |
| `calculationOptions` | object | 否 | — | — |
| `calculationOptions.algorithm` | enum | 否 | `"default"` | 可选值: `default` / `zhongzhou` |
| `calculationOptions.yearDivide` | enum | 否 | `"normal"` | 本命年界：正月初一或立春日；采用 iztro 的日级年界口径；可选值: `normal` / `exact` |
| `calculationOptions.horoscopeDivide` | enum | 否 | `"exact"` | 运限年/月界采用 iztro 规则；exact 使用代表时辰，非分钟级天文交节；可选值: `normal` / `exact` |
| `calculationOptions.ageDivide` | enum | 否 | `"normal"` | 可选值: `normal` / `birthday` |
| `calculationOptions.dayDivide` | enum | 否 | `"forward"` | 可选值: `current` / `forward` |
| `calculationOptions.fixLeap` | boolean | 否 | `true` | 闰月十五日后按下月安星 |
| `calculationOptions.mutagens` | object | 否 | — | 按禄权科忌覆盖对应天干的四化星 |
| `calculationOptions.mutagens.甲` | string[] | 否 | — | — |
| `calculationOptions.mutagens.乙` | string[] | 否 | — | — |
| `calculationOptions.mutagens.丙` | string[] | 否 | — | — |
| `calculationOptions.mutagens.丁` | string[] | 否 | — | — |
| `calculationOptions.mutagens.戊` | string[] | 否 | — | — |
| `calculationOptions.mutagens.己` | string[] | 否 | — | — |
| `calculationOptions.mutagens.庚` | string[] | 否 | — | — |
| `calculationOptions.mutagens.辛` | string[] | 否 | — | — |
| `calculationOptions.mutagens.壬` | string[] | 否 | — | — |
| `calculationOptions.mutagens.癸` | string[] | 否 | — | — |
| `gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `birthYear` | integer | 是 | — | 出生年（1900-2100） |
| `birthMonth` | integer | 是 | — | 出生月（1-12） |
| `birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `birthHour` | integer | 是 | — | 出生时（0-23） |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `longitude` | number | 否 | — | 出生地经度（-180 到 180；提供时按真太阳时校正出生时间） |
| `palace` | enum | 是 | — | 要详查的宫位（仆役同交友）；非本命层次时指该运限的宫名，如流年财帛；可选值: `命宫` / `兄弟` / `夫妻` / `子女` / `财帛` / `疾厄` / `迁移` / `交友` / `官禄` / `田宅` / `福德` / `父母` / `仆役` |
| `scope` | enum | 否 | `"natal"` | 层次：natal=本命，decadal=大限，yearly=流年，monthly=流月，daily=流日，hourly=流时；可选值: `natal` / `decadal` / `yearly` / `monthly` / `daily` / `hourly` |
| `targetDate` | string | 否 | — | 运限目标日期（公历 YYYY-MM-DD）；非本命层次必填 |
| `targetTimeIndex` | integer | 否 | — | 流时所用的时辰序号（0-12：0=早子，1=丑…11=亥，12=晚子）；流时层次必填 |
| `detailLevel` | enum | 否 | `"default"` | 文本详略：default=只列所查事实；full=另附判定口径（结构化结果始终带口径与计算规则）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"palace":"命宫"}' | node "$TB/scripts/taibu.mjs" call ziwei_palace -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","palace":"财帛","scope":"yearly","targetDate":"2026-03-13"}' | node "$TB/scripts/taibu.mjs" call ziwei_palace -
```

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"longitude":116.4,"palace":"仆役"}' | node "$TB/scripts/taibu.mjs" call ziwei_palace -
```

## 输出结构（structuredContent 顶层键）

- `查询`：查询参数
- `宫位概览`：所查宫位（非本命层次时为运限宫所落的本命宫位）
- `本宫星曜`：本宫全部星曜
- `借对宫`：空宫借对宫主星
- `三方四正`：三方四正四宫
- `夹宫`：夹宫
- `宫干四化飞出`：本宫宫干四化的落宫
- `四化飞入`：十二宫宫干四化落入本宫者
- `运限叠加`：运限层次的叠加事实
- `口径`：判定口径说明
- `计算规则`

