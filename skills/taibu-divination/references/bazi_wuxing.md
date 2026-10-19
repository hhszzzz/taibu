# 八字五行流通（`bazi_wuxing`）

八字五行流通 - 在八字命盘上详查五行：天干、地支本气与藏干加权统计，月令旺相休囚死，日主通根与透干，干支自坐与相邻天干生克，相生链的连续与中断，以及十神分布。只给事实，不判断身强身弱或喜用神。

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
| `birthHour` | integer | 是 | — | 出生时（0-23） |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `calendarType` | enum | 否 | `"solar"` | 出生日期的历法（solar=公历，lunar=农历）；可选值: `solar` / `lunar` |
| `isLeapMonth` | boolean | 否 | `false` | 是否农历闰月（仅 calendarType=lunar 时有效） |
| `birthPlace` | string | 否 | — | 出生地点文本 |

## 调用示例

```bash
echo '{"gender":"male","birthYear":1990,"birthMonth":1,"birthDay":15,"birthHour":9}' | node "$TB/scripts/taibu.mjs" call bazi_wuxing -
```

```bash
echo '{"gender":"female","birthYear":1995,"birthMonth":6,"birthDay":20,"birthHour":23,"calendarType":"lunar"}' | node "$TB/scripts/taibu.mjs" call bazi_wuxing -
```

## 输出结构（structuredContent 顶层键）

- `日主`：日主天干及其五行
- `五行统计`：五行加权统计（木火土金水）
- `缺失五行`：合计为 0 的五行
- `月令`：月令旺相休囚死
- `通根`：日主在地支藏干中的同五行之根
- `透干`：地支藏干原字见于天干
- `干支自坐`：各柱天干与地支本气的生克
- `相邻天干`：年月、月日、日时天干的生克
- `相生链`：五行相生链
- `十神分布`：十神在天干与藏干中的分布
- `口径`：判定口径说明
- `计算规则`

