# 黄历查询（`almanac`）

黄历查询 - 查询指定日期的黄历、宜忌、冲煞、值星、方位与时辰吉凶等信息。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 省略日期时按此 IANA 时区取今日 |
| `dayMaster` | enum | 否 | — | 日主天干（用于计算当日日干对日主的十神；优先于出生信息）；可选值: `甲` / `乙` / `丙` / `丁` / `戊` / `己` / `庚` / `辛` / `壬` / `癸` |
| `birthYear` | integer | 否 | — | 出生年（未提供 dayMaster 时，由出生年月日推算日主） |
| `birthMonth` | integer | 否 | — | 出生月（1-12；用于推算日主） |
| `birthDay` | integer | 否 | — | 出生日（1-31；用于推算日主） |
| `birthHour` | integer | 否 | — | 出生时（0-23；用于推算日主，省略时按 12 时计） |
| `date` | string | 否 | — | 查询日期（公历 YYYY-MM-DD；省略时取当前日期） |
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=基础黄历、冲煞与宜忌；full=追加方位、建除值神、二十八宿、纳音与十二时辰吉凶）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9,"date":"2026-02-14"}' | node "$TB/scripts/taibu.mjs" call almanac -
```

```bash
echo '{"dayMaster":"丙","date":"2026-02-14"}' | node "$TB/scripts/taibu.mjs" call almanac -
```

## 输出结构（structuredContent 顶层键）

- `基础与个性化坐标`：日期基础信息与个性化坐标
- `传统黄历基调`：传统黄历基调
- `择日宜忌`：择日宜忌
- `神煞参考`：神煞参考
- `方位信息`：方位信息
- `值日信息`：值日信息
- `时辰吉凶`：十二时辰吉凶
- `计算规则`

