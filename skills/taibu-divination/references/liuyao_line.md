# 六爻逐爻详查（`liuyao_line`）

六爻逐爻详查 - 在六爻卦盘上按爻位或角色（世、应、动爻、六亲）取爻，列纳甲、六亲、六神、世应、动静、旺衰判据、月破日破暗动与空亡、月建日辰作用、化进化退与回头生克、伏神飞伏，以及动爻对本爻的生克冲合。不给用神取用与应期。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `question` | string | 是 | — | 占问事项 |
| `yongShenTargets` | string[] | 是 | — | 用神六亲（按占问主题选择，如求财取妻财、问工作取官鬼） |
| `method` | enum | 否 | `"auto"` | 起卦方式（auto=三钱，select=指定卦，time=时间，number=数字，coins=手工六个爻值，yarrow=蓍草概率模型）；可选值: `auto` / `select` / `time` / `number` / `coins` / `yarrow` |
| `numbers` | number[] | 否 | — | 起卦数字（2-3 个正整数：第一数取上卦，第二数取下卦，第三数取动爻，只给两数时以两数之和取动爻；method=number 时必填） |
| `yaoValues` | integer[] | 否 | — | 初爻至上爻的六个爻值：6老阴、7少阳、8少阴、9老阳 |
| `timezone` | string | 否 | `"Asia/Shanghai"` | 不带偏移日期的壁钟时区，以及干支排盘的民用时区 |
| `hexagramName` | string | 否 | — | 本卦卦名或 6 位卦码（卦码自初爻至上爻，1=阳爻，0=阴爻；method=select 时必填） |
| `changedHexagramName` | string | 否 | — | 变卦卦名或卦码（method=select 时可选，用于确定动爻） |
| `date` | string | 是 | — | 起卦时间（YYYY-MM-DDTHH:MM[:SS]、YYYY-MM-DD HH:MM[:SS] 或带时区偏移的 ISO 时间；决定月建与日辰） |
| `line` | integer | 否 | — | 爻位序号 1–6（1=初爻，6=上爻）；与 role 二选一 |
| `role` | enum | 否 | — | 按角色取爻：世、应、动（全部明动之爻）或六亲；六亲不上卦时取其伏神所在的飞神爻；与 line 二选一；可选值: `世` / `应` / `动` / `父母` / `兄弟` / `子孙` / `妻财` / `官鬼` |

## 调用示例

```bash
echo '{"question":"本月事业运势如何？","yongShenTargets":["官鬼"],"method":"auto","date":"2026-02-10T09:30:00","role":"世"}' | node "$TB/scripts/taibu.mjs" call liuyao_line -
```

```bash
echo '{"question":"财运怎么样？","yongShenTargets":["妻财"],"method":"select","hexagramName":"天火同人","date":"2026-02-10 14:00:00","line":3}' | node "$TB/scripts/taibu.mjs" call liuyao_line -
```

## 输出结构（structuredContent 顶层键）

- `查询`：查询条件与卦时
- `爻详情`：所取各爻的事实
- `说明`：取爻说明（静卦无动爻、六亲不上卦等）
- `口径`：判定口径说明
- `计算规则`

