# 八字命盘（`bazi`）

八字命盘 - 根据出生信息排四柱命盘，输出四柱干支、十神、藏干、地势、空亡与干支关系，可选输出纳音、神煞等扩展信息。

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
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=核心盘面；full=追加纳音、神煞、胎元、命宫等）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}' | node "$TB/scripts/taibu.mjs" call bazi -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar"}' | node "$TB/scripts/taibu.mjs" call bazi -
```

## 输出结构（structuredContent 顶层键）

- `基本信息`
- `四柱`：年、月、日、时四柱
- `干支关系`：原局天干与地支之间的合、冲、刑、害、破等关系
- `干支关系明细`：可交互的关系坐标；旧结果可省略
- `大运`：大运（随大运专项结果输出）
- `计算规则`

