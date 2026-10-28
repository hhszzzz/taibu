# 小六壬占测（`xiaoliuren`）

小六壬占测 - 根据农历月日时辰起课，输出起课信息、推演链与结果信息。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `lunarMonth` | integer | 否 | — | 手工农历月（1-12），与 date 二选一 |
| `lunarDay` | integer | 否 | — | 手工农历日（1-30） |
| `hour` | integer | 是 | — | 小时或时辰序号，由 hourType 明确指定 |
| `hourType` | enum | 否 | — | clock=0-23钟表小时；shichen=子1至亥12时辰序号；legacy=旧版混合口径。date 输入默认 clock，手工农历默认 legacy（手工农历传 1–12 点钟表小时时必须显式传 hourType="clock"）。；可选值: `clock` / `shichen` / `legacy` |
| `date` | string | 否 | — | 公历日期，与手工农历输入二选一 |
| `isLeapMonth` | boolean | 否 | `false` | 手工农历是否为闰月 |
| `leapMonthStrategy` | enum | 否 | `"repeat"` | 闰月沿用同月计数或递进一月计数；可选值: `repeat` / `advance` |
| `question` | string | 否 | — | 占问事项 |
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=起课结果；full=追加释义与诗诀）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"lunarMonth":3,"lunarDay":15,"hour":8,"question":"今日运势如何"}' | node "$TB/scripts/taibu.mjs" call xiaoliuren -
```

```bash
echo '{"lunarMonth":1,"lunarDay":1,"hour":1}' | node "$TB/scripts/taibu.mjs" call xiaoliuren -
```

## 输出结构（structuredContent 顶层键）

- `起课信息`：起课基本信息
- `推演链`：三步推演链（月上起→日上落→时上落）
- `结果`：最终结果与释义
- `计算规则`

