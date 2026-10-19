# 奇门宫位详查（`qimen_palace`）

奇门宫位详查 - 在奇门盘上详查一宫：指定宫位，或按年月日时干（取天盘，甲取所遁六仪）、九星、八门、八神定位；列出天地盘干与寄干、星门神、空亡马星入墓击刑门迫、旺衰、门宫星宫干宫生克、值符值使与本宫格局。只给事实，不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `year` | integer | 是 | — | 公历年（1900-2100） |
| `month` | integer | 是 | — | 月（1-12） |
| `day` | integer | 是 | — | 日（1-31） |
| `hour` | integer | 是 | — | 时（0-23） |
| `minute` | integer | 否 | `0` | 分（0-59） |
| `timezone` | string | 否 | `"Asia/Shanghai"` | IANA 时区名（如 Asia/Shanghai） |
| `question` | string | 否 | — | 占问事项 |
| `panType` | enum | 否 | `"zhuan"` | 盘式（zhuan=时家转盘，fei=洛书飞盘，八门含虚中位）；可选值: `zhuan` / `fei` |
| `juMethod` | enum | 否 | `"chaibu"` | 定局法（chaibu=拆补，maoshan=交节后每五日一元，equal=节气区间等时三分，现代扩展）；可选值: `chaibu` / `maoshan` / `equal` |
| `flyStarMethod` | enum | 否 | — | 飞盘九星：forward=阴阳皆顺，yin-reverse=阳顺阴逆；默认阳顺阴逆；可选值: `forward` / `yin-reverse` |
| `juNumber` | integer | 否 | — | 手工局数，必须与 dunType 同时提供 |
| `dunType` | enum | 否 | — | 手工阴阳遁，必须与 juNumber 同时提供；可选值: `yang` / `yin` |
| `zhiFuJiGong` | enum | 否 | `"ji_wugong"` | 转盘中五寄宫（ji_wugong=固定寄坤二宫；ji_liuyi=阳遁寄艮八、阴遁寄坤二）；可选值: `ji_wugong` / `ji_liuyi` |
| `palace` | integer | 否 | — | 宫位序号 1–9（坎1 坤2 震3 巽4 中5 乾6 兑7 艮8 离9），与 locate 二选一 |
| `locate` | object | 否 | — | 按柱干或星门神定位，与 palace 二选一 |
| `locate.type` | enum | 是 | — | 定位依据；可选值: `年干` / `月干` / `日干` / `时干` / `星` / `门` / `神` |
| `locate.value` | string | 否 | — | 星、门、神的名称（如 天心、开门、值符）；按柱干定位时不填 |

## 调用示例

```bash
echo '{"year":2026,"month":3,"day":15,"hour":16,"minute":51,"timezone":"Asia/Shanghai","question":"事业发展如何？","palace":1}' | node "$TB/scripts/taibu.mjs" call qimen_palace -
```

```bash
echo '{"year":2026,"month":3,"day":15,"hour":16,"minute":51,"timezone":"Asia/Shanghai","question":"事业发展如何？","locate":{"type":"日干"}}' | node "$TB/scripts/taibu.mjs" call qimen_palace -
```

```bash
echo '{"year":2026,"month":3,"day":15,"hour":16,"minute":51,"timezone":"Asia/Shanghai","question":"事业发展如何？","locate":{"type":"门","value":"开门"}}' | node "$TB/scripts/taibu.mjs" call qimen_palace -
```

## 输出结构（structuredContent 顶层键）

- `查询`：本次详查的宫位
- `宫位`
- `天地盘`
- `星门神`
- `中宫寄宫`：转盘中五的寄宫去向
- `状态`：日空、时空、驿马、入墓、门迫、六仪击刑
- `柱干落宫`：年月日时干落于本宫天盘或地盘
- `遁甲`：时旬首所遁六仪在本宫
- `生克`：门宫、星宫、天盘干与宫、地盘干与宫、天地盘干的五行生克
- `值符值使`
- `格局`：全盘格局与本宫格局
- `口径`：判定口径说明
- `计算规则`

