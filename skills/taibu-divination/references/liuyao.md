# 六爻排卦（`liuyao`）

六爻排卦 - 根据问题与起卦信息排出六爻盘面，输出本变互卦、四柱空亡、逐爻纳甲六亲六神、世应动变与合冲反伏事实（用神取用与应期由解读方依断法判定）。

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
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=核心盘面；more=追加卦身、互错综卦与神煞；full=再追加旺衰、动静、空亡、化变及冲合、反伏等细项）；可选值: `default` / `more` / `full` |

## 调用示例

```bash
echo '{"question":"本月事业运势如何？","yongShenTargets":["官鬼"],"method":"auto","date":"2026-02-10T09:30:00"}' | node "$TB/scripts/taibu.mjs" call liuyao -
```

```bash
echo '{"question":"财运怎么样？","yongShenTargets":["妻财"],"method":"select","hexagramName":"天火同人","date":"2026-02-10 14:00:00"}' | node "$TB/scripts/taibu.mjs" call liuyao -
```

## 输出结构（structuredContent 顶层键）

- `卦盘`：卦象基本信息
- `六爻全盘`：六爻全盘信息
- `全局互动`：全局地支互动与冲合趋势
- `元信息`：元数据
- `计算规则`

