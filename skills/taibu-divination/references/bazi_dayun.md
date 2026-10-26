# 八字大运（`bazi_dayun`）

八字大运 - 根据出生信息计算起运时间与大运列表，可选输出起运前小运及各步大运的流年。full 档输出很长；只问某几年与原局、大运的刑冲合害时，改用 bazi_liunian_scan 或 bazi_relations。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 出生钟表时间的 IANA 时区 |
| `disambiguation` | enum | 否 | `"reject"` | 夏令时跳时/重复时刻的解析策略；可选值: `reject` / `earlier` / `later` / `compatible` |
| `dayBoundary` | enum | 否 | `"midnight"` | 日柱换日：午夜或23点；时干沿用历法库的子时规则；可选值: `midnight` / `zi` |
| `longitude` | number | 否 | — | 经度；提供时校正真太阳时 |
| `yunSect` | enum | 否 | `1` | 起运换算法1或2；可选值: `1` / `2` |
| `gender` | enum | 是 | — | 性别；可选值: `male` / `female` |
| `birthYear` | integer | 是 | — | 出生年 (1-9999) |
| `birthMonth` | integer | 是 | — | 出生月（1-12） |
| `birthDay` | integer | 是 | — | 出生日（公历 1-31，农历 1-30） |
| `birthHour` | integer | 否 | — | 出生时（0-23）；不知道出生时辰时省略，此时起运给出当天最早与最晚出生之间的范围，不排小运 |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59）；省略 birthHour 时不填 |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=起运信息与大运概要；full=追加起运前小运，以及各步大运的纳音、神煞、原局关系与流年列表）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}' | node "$TB/scripts/taibu.mjs" call bazi_dayun -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar"}' | node "$TB/scripts/taibu.mjs" call bazi_dayun -
```

## 输出结构（structuredContent 顶层键）

- `起运信息`：起运年龄与起运详情
- `小运`：小运列表（逐年；出生时辰未知时不排）
- `大运列表`：大运列表（每十年一步）
- `计算规则`

