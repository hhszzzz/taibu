# 黄历择日筛选（`almanac_select`）

黄历择日筛选 - 在指定区间内逐日取黄历，按事项（宜忌逐条匹配）与冲煞（一个或多个生肖、地支的六冲）筛选候选日，列出干支、农历、建除、黄黑道、二十八宿、纳音、冲煞与宜忌，并给出排除统计。只陈列条文，不评定吉凶等级。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `startDate` | string | 是 | — | 区间起始日（公历 YYYY-MM-DD） |
| `endDate` | string | 是 | — | 区间结束日（公历 YYYY-MM-DD）；与起始日跨度不超过 92 天 |
| `activity` | string | 否 | — | 择日事项，按黄历传统词条匹配（结婚/领证填 嫁娶，订婚填 订盟 或 纳采，搬家填 入宅 或 移徙，开业填 开市，签约填 立券 或 交易，装修填 修造，动工填 动土，远行填 出行）；省略时列出区间内全部日子 |
| `excludeClash` | string[] | 否 | — | 需要避冲的生肖（如 牛）或地支（如 丑），可多个（如嫁娶时新人双方的生肖）；按六冲排除当日地支冲其中任何一个的日子 |
| `timezone` | string | 否 | `"Asia/Shanghai"` | IANA 时区名（如 Asia/Shanghai） |

## 调用示例

```bash
echo '{"startDate":"2026-02-14","endDate":"2026-02-20","activity":"嫁娶"}' | node "$TB/scripts/taibu.mjs" call almanac_select -
```

```bash
echo '{"startDate":"2026-02-14","endDate":"2026-02-20","activity":"嫁娶","excludeClash":["牛","鸡"]}' | node "$TB/scripts/taibu.mjs" call almanac_select -
```

## 输出结构（structuredContent 顶层键）

- `查询`：本次筛选条件
- `候选日`：区间内命中条件的日子
- `排除统计`：排除统计
- `口径`：判定口径说明
- `计算规则`

