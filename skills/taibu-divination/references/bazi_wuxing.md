# 八字五行旺衰（`bazi_wuxing`）

八字五行旺衰 - 在八字命盘上详查旺衰与生克的事实：月令旺相休囚死与日主得失，月令各藏干透出与否（取格看月令），四个天干各自的通根（本气、中气、余气，无根亦列出），干支自坐与相邻天干的生克，以及缺失五行。日主、月令与缺失五行总在，其余事实组可用 sections 只取所需。旺衰不是五行字数相加，本工具只给这些因子，不判身强身弱、格局或喜用。辰戌丑未月以土论。

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
| `birthHour` | integer | 否 | — | 出生时（0-23）；不知道出生时辰时省略，此时不排时柱，也不给命宫、时柱神煞与小运 |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59）；省略 birthHour 时不填 |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `birthPlace` | string | 否 | — | 出生地点文本 |
| `sections` | string[] | 否 | — | 只取这些事实组，如 ["通根"]；省略时全部给出（日主、月令与缺失五行总在） |
| `detailLevel` | enum | 否 | `"default"` | 文本详略：default=只列所查事实；full=另附判定口径（结构化结果始终带口径与计算规则）；可选值: `default` / `full` |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}' | node "$TB/scripts/taibu.mjs" call bazi_wuxing -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar","sections":["通根"]}' | node "$TB/scripts/taibu.mjs" call bazi_wuxing -
```

```bash
echo '{"gender":"female","birthYear":1988,"birthMonth":3,"birthDay":12}' | node "$TB/scripts/taibu.mjs" call bazi_wuxing -
```

## 输出结构（structuredContent 顶层键）

- `日主`：日主天干及其五行
- `月令`：月令旺相休囚死与藏干透出
- `缺失五行`：天干、地支本气、藏干都没有出现的五行
- `出生时辰`：只在出生时辰未知时出现：事实只取年、月、日三柱，缺失的五行可能由时柱补上
- `筛选`：给出 sections 时所取的事实组
- `通根`：四个天干在地支藏干中的同五行之根，日主在前
- `无根`：没有同五行藏干的天干
- `干支自坐`：各柱天干与地支本气的生克
- `相邻天干`：年月、月日、日时天干的生克
- `口径`：判定口径说明
- `计算规则`

