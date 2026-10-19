# 占星单点详查（`astrology_point`）

占星单点详查 - 在西方占星命盘上详查一颗星体（含交点、莉莉丝、上升、天顶）或一个宫位：星座宫位与逆行、托勒密传统尊贵、主管宫位或宫主星落点、本命相位（标入相／出相）、流运触发或流运过境。只给事实，不下吉凶结论。

## 参数

| 参数 | 类型 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- | --- |
| `birthYear` | integer | 是 | — | 出生年（1-9999） |
| `birthMonth` | integer | 是 | — | 出生月（1-12） |
| `birthDay` | integer | 是 | — | 出生日（1-31） |
| `birthHour` | integer | 是 | — | 出生时（0-23） |
| `birthMinute` | integer | 否 | `0` | 出生分（0-59） |
| `latitude` | number | 否 | — | 出生地纬度（-90 到 90；须与 longitude 同时提供，用于确定当地时区、上升、天顶与宫位） |
| `longitude` | number | 否 | — | 出生地经度（-180 到 180；须与 latitude 同时提供） |
| `birthPlace` | string | 否 | — | 出生地点文本 |
| `timezone` | string | 否 | — | 显式 IANA 时区；省略时按经纬度推导，零坐标为 Etc/GMT |
| `disambiguation` | enum | 否 | `"reject"` | 可选值: `reject` / `earlier` / `later` / `compatible` |
| `zodiac` | enum | 否 | `"tropical"` | 可选值: `tropical` / `sidereal` |
| `ayanamsa` | number | 否 | — | 恒星黄道的自定义固定偏移角度；本命与行运共用 |
| `aspectOrbs` | object | 否 | — | — |
| `aspectOrbs.conjunction` | number | 否 | — | — |
| `aspectOrbs.opposition` | number | 否 | — | — |
| `aspectOrbs.trine` | number | 否 | — | — |
| `aspectOrbs.square` | number | 否 | — | — |
| `aspectOrbs.sextile` | number | 否 | — | — |
| `transitDateTime` | string | 否 | — | 流运时刻（YYYY-MM-DDTHH:mm[:ss] 按出生地时区解释，也可用带时区偏移的 ISO 时间；省略时取当前时刻） |
| `houseSystem` | enum | 否 | `"placidus"` | 宫制；高纬度使用等宫或整宫；可选值: `placidus` / `equal-house` / `whole-sign` / `koch` / `campanus` / `regiomontanus` / `topocentric` |
| `planet` | enum | 否 | — | 要详查的星体或点（太阳 sun、月亮 moon、水星 mercury、金星 venus、火星 mars、木星 jupiter、土星 saturn、天王星 uranus、海王星 neptune、冥王星 pluto、北交点 northnode、南交点 southnode、莉莉丝 lilith、上升点 ascendant、天顶 midheaven）；与 house 二选一，上升与天顶需要经纬度；可选值: `sun` / `moon` / `mercury` / `venus` / `mars` / `jupiter` / `saturn` / `uranus` / `neptune` / `pluto` / `northnode` / `southnode` / `lilith` / `ascendant` / `midheaven` |
| `house` | integer | 否 | — | 要详查的宫位序号 1–12；与 planet 二选一，需要出生地经纬度 |

## 调用示例

```bash
echo '{"birthYear":1990,"birthMonth":1,"birthDay":1,"birthHour":12,"birthMinute":30,"latitude":40.7128,"longitude":-74.006,"transitDateTime":"2026-04-10T09:30:00","planet":"venus"}' | node "$TB/scripts/taibu.mjs" call astrology_point -
```

```bash
echo '{"birthYear":1990,"birthMonth":1,"birthDay":1,"birthHour":12,"birthMinute":30,"latitude":40.7128,"longitude":-74.006,"transitDateTime":"2026-04-10T09:30:00","house":7}' | node "$TB/scripts/taibu.mjs" call astrology_point -
```

## 输出结构（structuredContent 顶层键）

- `查询`：本次详查的对象
- `位置信息`
- `传统尊贵`：托勒密传统尊贵（入庙、擢升、失势、落陷，或无）
- `主管宫位`：该行星按传统守护主管的宫位
- `宫位信息`：宫位范围
- `宫内星体`：落在该宫的本命星体与点
- `宫主星`：宫头星座的传统守护星及其落点
- `本命相位`：该星体参与的本命相位
- `宫主星相位`：宫主星参与的本命相位
- `流运触发`：流运星体对该星体形成的相位
- `流运过境`：流运时刻落在该本命宫内的星体
- `口径`：判定口径说明
- `计算规则`

