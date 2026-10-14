# 奇门遁甲排盘（`qimen`）

奇门遁甲排盘 - 根据指定时间排出奇门盘，输出九宫、九星、八门、八神、格局等信息。

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
| `detailLevel` | enum | 否 | `"default"` | 输出详略（default=核心盘面与全局格局；full=追加历法信息、宫位方位旺衰与逐宫格局、空亡、驿马、十干旺衰）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"year":2026,"month":3,"day":15,"hour":16,"minute":51,"timezone":"Asia/Shanghai","question":"事业发展如何？"}' | node "$TB/scripts/taibu.mjs" call qimen -
```

## 输出结构（structuredContent 顶层键）

- `基本信息`：起局基本信息
- `九宫盘`：九宫盘详细信息
- `空亡信息`：日空与时空信息
- `驿马`：驿马信息
- `十干月令旺衰`：十天干在当月月令的旺衰（甲→旺、乙→相等，键为天干，值为旺衰）
- `全局格局`：全局格局："全盘: "开头为整盘格局（星伏吟、门反吟、五不遇时、时干入墓等），只列一次；其余为"某宫: 格局"
- `计算规则`

