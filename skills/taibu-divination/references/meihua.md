# 梅花易数起卦（`meihua`）

梅花易数起卦 - 根据时间、字占、物数、报数等方式起卦，输出起卦信息、卦盘与体用推演。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `question` | string | 是 | — | 占问事项 |
| `date` | string | 是 | — | 起卦时间（YYYY-MM-DDTHH:MM[:SS]，按当地时间填写，不带时区偏移） |
| `method` | enum | 否 | — | 起卦方式（省略时为 time；time=年月日时起卦，count_with_time=物数或声数加时辰，text_split=字占，measure=丈尺或尺寸，classifier_pair=上下卦类象，select=指定卦，number_pair=两数报数，number_triplet=三数报数）；可选值: `time` / `count_with_time` / `text_split` / `measure` / `classifier_pair` / `select` / `number_pair` / `number_triplet` |
| `count` | number | 否 | — | 物数或声数（count_with_time 时必填） |
| `countCategory` | enum | 否 | — | 计数来源（item=物数，sound=声数；count_with_time 时必填）；可选值: `item` / `sound` |
| `text` | string | 否 | — | 字占文本 |
| `textSplitMode` | enum | 否 | — | 字占拆分方式（auto=自动，count=按字数，sentence_pair=两句分取上下卦，stroke=按左右笔画）；可选值: `auto` / `count` / `sentence_pair` / `stroke` |
| `multiSentenceStrategy` | enum | 否 | — | 多句文本的取句方式（first=首句，last=末句）；可选值: `first` / `last` |
| `sentences` | string[] | 否 | — | 两句文本，依次对应上卦与下卦（sentence_pair 时使用） |
| `leftStrokeCount` | number | 否 | — | 左（上）半部笔画数（stroke 时必填） |
| `rightStrokeCount` | number | 否 | — | 右（下）半部笔画数（stroke 时必填） |
| `measureKind` | enum | 否 | — | 丈量单位（丈尺=丈数取上卦、尺数取下卦；尺寸=尺数取上卦、寸数取下卦）；可选值: `丈尺` / `尺寸` |
| `majorValue` | number | 否 | — | 大单位的数（丈尺取丈数，尺寸取尺数） |
| `minorValue` | number | 否 | — | 小单位的数（丈尺取尺数，尺寸取寸数） |
| `upperCue` | string | 否 | — | 上卦类象词（如方位、颜色、人物、动物） |
| `upperCueCategory` | enum | 否 | — | 上卦类象类别（direction=方位，color=颜色，weather=天象，person=人物，body=身体，animal=动物，object=器物，shape=形状，trigram=卦名；类象词对应多卦时用于限定）；可选值: `direction` / `color` / `weather` / `person` / `body` / `animal` / `object` / `shape` / `trigram` |
| `lowerCue` | string | 否 | — | 下卦类象词（取法同 upperCue） |
| `lowerCueCategory` | enum | 否 | — | 下卦类象类别（取值同 upperCueCategory）；可选值: `direction` / `color` / `weather` / `person` / `body` / `animal` / `object` / `shape` / `trigram` |
| `hexagramName` | string | 否 | — | 指定本卦的卦名或卦码（select 时与上下卦二选一） |
| `upperTrigram` | string | 否 | — | 指定上卦（八卦名，如“乾”） |
| `lowerTrigram` | string | 否 | — | 指定下卦（八卦名，如“坤”） |
| `movingLine` | number | 否 | — | 指定动爻（1-6，自初爻起数；select 时必填） |
| `numbers` | number[] | 否 | — | 报数（number_pair 取 2 个，number_triplet 取 3 个） |
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=核心推演；full=追加象辞、错综卦、月令细项与判断参考）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"question":"这次合作能否谈成？","method":"time","date":"2026-04-04T10:30:00"}' | node "$TB/scripts/taibu.mjs" call meihua -
```

```bash
echo '{"question":"丢失物品能否找回？","method":"count_with_time","count":7,"countCategory":"item","date":"2026-04-04T10:30:00"}' | node "$TB/scripts/taibu.mjs" call meihua -
```

```bash
echo '{"question":"这件事进展如何？","method":"measure","measureKind":"丈尺","majorValue":2,"minorValue":3,"date":"2026-04-04T10:30:00"}' | node "$TB/scripts/taibu.mjs" call meihua -
```

```bash
echo '{"question":"此事后续如何？","method":"number_pair","numbers":[3,8],"date":"2026-04-04T10:30:00"}' | node "$TB/scripts/taibu.mjs" call meihua -
```

## 输出结构（structuredContent 顶层键）

- `起卦信息`：起卦基本信息与方法
- `卦盘`：卦象结构与体用
- `干支时间`：起卦时刻的四柱干支
- `体用分析`：体用关系与月令旺衰
- `阶段推演`：本卦、互卦、变卦的阶段推演
- `判断参考`：按体用生克规则判断的吉凶参考
- `计算规则`

