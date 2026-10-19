# 大六壬课传详查（`daliuren_lessons`）

大六壬课传详查 - 在已起的六壬课上详查四课与三传：逐课列上下神的贼克生克、所乘天将、神将与遁干六亲；逐传列地支五行、与日干关系、旺衰、旬空与递生递克；另给日干寄宫、本命行年的上神，以及类神（地支或天将）的天盘落处与入课入传。只给事实，不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `date` | string | 是 | — | 公历日期（YYYY-MM-DD） |
| `hour` | integer | 是 | — | 小时（0-23） |
| `minute` | integer | 否 | `0` | 分钟（0-59） |
| `timezone` | string | 否 | `"Asia/Shanghai"` | IANA 时区名（如 Asia/Shanghai） |
| `question` | string | 否 | — | 占问事项 |
| `birthYear` | integer | 否 | — | 出生年（与 gender 同时提供时推算本命与行年） |
| `gender` | enum | 否 | — | 性别（与 birthYear 同时提供时推算本命与行年）；可选值: `male` / `female` |
| `monthGeneral` | enum | 否 | — | 手工月将；省略时按中气交接的实际时刻；可选值: `子` / `丑` / `寅` / `卯` / `辰` / `巳` / `午` / `未` / `申` / `酉` / `戌` / `亥` |
| `dayNight` | enum | 否 | `"shichen"` | 卯至申为昼，或强制昼夜，或按太阳高度选择贵人盘；可选值: `shichen` / `day` / `night` / `sunrise` |
| `latitude` | number | 否 | — | — |
| `longitude` | number | 否 | — | — |
| `focus` | enum | 否 | `"全部"` | 只列四课、只列三传，或两者都列；可选值: `全部` / `课` / `传` |
| `leiShen` | string | 否 | — | 类神：十二地支之一或十二天将名（如 卯、贵人），列出其天盘落处与入课入传 |

## 调用示例

```bash
echo '{"date":"2026-03-15","hour":16,"minute":53,"timezone":"Asia/Shanghai","question":"今日运势如何"}' | node "$TB/scripts/taibu.mjs" call daliuren_lessons -
```

```bash
echo '{"date":"2026-03-15","hour":16,"timezone":"Asia/Shanghai","birthYear":1990,"gender":"male","focus":"课"}' | node "$TB/scripts/taibu.mjs" call daliuren_lessons -
```

```bash
echo '{"date":"2026-03-15","hour":16,"minute":53,"timezone":"Asia/Shanghai","question":"今日运势如何","focus":"传","leiShen":"贵人"}' | node "$TB/scripts/taibu.mjs" call daliuren_lessons -
```

## 输出结构（structuredContent 顶层键）

- `查询`：本次详查的范围
- `基础`：起课基础
- `四课`：四课的上下神、天将与神将生克
- `三传`：三传的地支、天将、六亲、旺衰与空亡
- `三传递进`：三传之间的五行递进
- `神将交战`：神克将（内战）与将克神（外战）的课传
- `本命行年`：本命与行年的上神
- `类神`：类神的天盘落处与入课入传
- `口径`：判定口径说明
- `计算规则`

