---
name: taibu-divination
description: >-
  太卜（TaiBu）占术排盘工具集：八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、
  太乙、塔罗、西方占星、黄历等 16 个本地计算工具。凡涉及算命、排盘、起卦、占卜、运势、命理、
  择日、宜忌、流年大运、星盘的请求（fortune-telling, divination, birth chart, BaZi, ZiWei,
  tarot, qimen, almanac），即使用户没有点名具体术数体系，也应使用本 skill——盘面必须由工具
  计算，不可凭记忆推算干支、卦象、星曜。
---

# 太卜占术工具

太卜提供 16 个占术与命理排盘工具，涵盖八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、太乙、塔罗、西方占星与黄历。计算引擎已随 skill 打包（`scripts/vendor/taibu-core.bundle.mjs`），本地直接运行，无需安装依赖，只要求环境中有 Node.js 18 或更高版本。

盘面一律由工具计算。干支、卦象、星曜的推算规则繁多，凭记忆手算既容易出错也无法复现；解读时以工具输出为唯一事实来源，不确定的细节回到输出中核对，而不是凭常识补写。

## 用法

`TB` 指本 skill 的根目录（加载 skill 时会告知）：

```bash
node "$TB/scripts/taibu.mjs" list           # 列出全部工具
node "$TB/scripts/taibu.mjs" schema bazi    # 查看参数说明与调用示例
echo '{"gender":"male","birthYear":1990,"birthMonth":5,"birthDay":20,"birthHour":8}' \
  | node "$TB/scripts/taibu.mjs" call bazi -
```

- 参数为 JSON。含中文内容时走 stdin（`call <tool> -`），避免 shell 转义问题。
- 默认输出规范文本，适合直接作为解读依据；加 `--json` 改为输出结构化数据（`structuredContent`）。
- 出错时返回中文提示（缺哪个参数、允许哪些取值），按提示修正后重试。退出码：0 成功，1 参数或业务错误，2 用法错误。

## 选择工具

<!-- TOOLS:BEGIN -->
| 工具名 | 名称 | 用途 | 参数文档 | 解读指引 |
| --- | --- | --- | --- | --- |
| `astrology` | 西方占星命盘 | 根据出生信息计算本命盘与流运盘，输出基础坐标、命盘锚点、本命主星与流运触发 | [references/astrology.md](references/astrology.md) | [interpretation/astrology.md](interpretation/astrology.md) |
| `bazi` | 八字命盘 | 根据出生信息排四柱命盘，输出四柱干支、十神、藏干、地势、空亡与干支关系，可选输出纳音、神煞等扩展信息 | [references/bazi.md](references/bazi.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `bazi_pillars_resolve` | 四柱反推 | 根据四柱搜索分钟级出生时间区间，默认1900-2100，单次最多1200年 | [references/bazi_pillars_resolve.md](references/bazi_pillars_resolve.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `ziwei` | 紫微斗数命盘 | 根据出生信息计算紫微命盘，输出十二宫位、星曜分布、四化、大限等信息 | [references/ziwei.md](references/ziwei.md) | [interpretation/ziwei.md](interpretation/ziwei.md) |
| `ziwei_horoscope` | 紫微斗数运限 | 根据出生信息与目标日期计算大限、小限、流年、流月、流日、流时等运限信息 | [references/ziwei_horoscope.md](references/ziwei_horoscope.md) | [interpretation/ziwei.md](interpretation/ziwei.md) |
| `ziwei_flying_star` | 紫微斗数飞星 | 按查询逐条分析命盘宫位的四化飞入、自化、四化落宫与三方四正 | [references/ziwei_flying_star.md](references/ziwei_flying_star.md) | [interpretation/ziwei.md](interpretation/ziwei.md) |
| `liuyao` | 六爻排卦 | 根据问题与起卦信息排出六爻盘面，输出卦象、爻位、用神体系、关系判断与时机提示 | [references/liuyao.md](references/liuyao.md) | [interpretation/liuyao.md](interpretation/liuyao.md) |
| `meihua` | 梅花易数起卦 | 根据时间、字占、物数、报数等方式起卦，输出起卦信息、卦盘与体用推演 | [references/meihua.md](references/meihua.md) | [interpretation/meihua.md](interpretation/meihua.md) |
| `tarot` | 塔罗抽牌 | 按牌阵抽取塔罗牌，输出各牌位的牌面、正逆位、核心基调、元素与星象 | [references/tarot.md](references/tarot.md) | [interpretation/tarot.md](interpretation/tarot.md) |
| `taiyi` | 太乙排盘 | 支持九星观测，以及采用四库本金镜七十二局立成的现代历法适配年/月/日/时计 | [references/taiyi.md](references/taiyi.md) | [interpretation/taiyi.md](interpretation/taiyi.md) |
| `almanac` | 黄历查询 | 查询指定日期的黄历、宜忌、冲煞、值星、方位与时辰吉凶等信息 | [references/almanac.md](references/almanac.md) | [interpretation/almanac.md](interpretation/almanac.md) |
| `bazi_dayun` | 八字大运 | 根据出生信息计算起运时间与大运列表，可选输出起运前小运及各步大运的流年 | [references/bazi_dayun.md](references/bazi_dayun.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `qimen` | 奇门遁甲排盘 | 根据指定时间排出奇门盘，输出九宫、九星、八门、八神、格局等信息 | [references/qimen.md](references/qimen.md) | [interpretation/qimen.md](interpretation/qimen.md) |
| `daliuren` | 大六壬排盘 | 根据日期时间起课，输出天地盘、四课、三传、神将、课体与时空信息 | [references/daliuren.md](references/daliuren.md) | [interpretation/daliuren.md](interpretation/daliuren.md) |
| `xiaoliuren` | 小六壬占测 | 根据农历月日时辰起课，输出起课信息、推演链与结果信息 | [references/xiaoliuren.md](references/xiaoliuren.md) | [interpretation/xiaoliuren.md](interpretation/xiaoliuren.md) |
| `bazi_relations` | 八字刑冲合害 | 在八字命盘上详查干支关系：原局四柱之间，以及叠加大运（起运前为小运）、流年、流月、流日后的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，附岁运并临、伏吟、天克地冲与太岁关系 | [references/bazi_relations.md](references/bazi_relations.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `bazi_wuxing` | 八字五行流通 | 在八字命盘上详查五行：天干、地支本气与藏干加权统计，月令旺相休囚死，日主通根与透干，干支自坐与相邻天干生克，相生链的连续与中断，以及十神分布 | [references/bazi_wuxing.md](references/bazi_wuxing.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `bazi_liunian_scan` | 八字流年扫描 | 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示 | [references/bazi_liunian_scan.md](references/bazi_liunian_scan.md) | [interpretation/bazi.md](interpretation/bazi.md) |
| `ziwei_palace` | 紫微宫位 | 在紫微命盘上聚焦一宫详查：本宫星曜亮度与生年四化、离心/向心自化，空宫借对宫，三方四正，夹宫，宫干四化飞出与十二宫四化飞入 | [references/ziwei_palace.md](references/ziwei_palace.md) | [interpretation/ziwei.md](interpretation/ziwei.md) |
| `qimen_palace` | 奇门宫位详查 | 在奇门盘上详查一宫：指定宫位，或按年月日时干（取天盘，甲取所遁六仪）、九星、八门、八神定位 | [references/qimen_palace.md](references/qimen_palace.md) | [interpretation/qimen.md](interpretation/qimen.md) |
| `daliuren_lessons` | 大六壬课传详查 | 在已起的六壬课上详查四课与三传：逐课列上下神的贼克生克、所乘天将、神将与遁干六亲 | [references/daliuren_lessons.md](references/daliuren_lessons.md) | [interpretation/daliuren.md](interpretation/daliuren.md) |
| `astrology_point` | 占星单点详查 | 在西方占星命盘上详查一颗星体（含交点、莉莉丝、上升、天顶）或一个宫位：星座宫位与逆行、托勒密传统尊贵、主管宫位或宫主星落点、本命相位（标入相／出相）、流运触发或流运过境 | [references/astrology_point.md](references/astrology_point.md) | [interpretation/astrology.md](interpretation/astrology.md) |
| `liuyao_line` | 六爻逐爻详查 | 在六爻卦盘上按爻位或角色（世、应、动爻、六亲）取爻，列纳甲、六亲、六神、世应、动静、旺衰判据、月破日破暗动与空亡、月建日辰作用、化进化退与回头生克、伏神飞伏，以及动爻对本爻的生克冲合 | [references/liuyao_line.md](references/liuyao_line.md) | [interpretation/liuyao.md](interpretation/liuyao.md) |
| `almanac_select` | 黄历择日筛选 | 在指定区间内逐日取黄历，按事项（宜忌逐条匹配）与冲煞（生肖或地支的六冲）筛选候选日，列出干支、农历、建除、黄黑道、二十八宿、纳音、冲煞与宜忌，并给出排除统计 | [references/almanac_select.md](references/almanac_select.md) | [interpretation/almanac.md](interpretation/almanac.md) |
<!-- TOOLS:END -->

调用前先 `schema <tool>`，或读 `references/<tool>.md`（参数表与可复制的示例）。

## 解读方法

排盘只是第一步。产出解读前，读工具表最后一列对应的 `interpretation/<体系>.md`——每份指引给出该体系的专家角色、流派技法与分析框架，按其组织解读内容。通用要求：

- 断语必须引用盘面证据（干支、星曜、爻位、格局名与工具输出逐字一致），不确定的回到输出核对。
- 正文以该体系术师的口吻写给问事人：先结论、后论证。工具调用与核验过程不写入正文，至多在文末一句带过——把篇幅留给卦理与判断，而不是操作记录。
- 关键事件给出时间范围、吉凶属性与影响程度；建议针对当前盘面，不写放之四海皆准的空话。
- 分析深度跟随用户要求伸缩：速断类（小六壬、单牌塔罗）短平快，命盘全局类（八字、紫微）分层展开，用户要求逐大限、逐流年时按指引调用运限工具补数据。

## 约定

- **历法**：生辰类工具默认公历（`calendarType: "solar"`）；用户给的是农历生日时改传 `"lunar"`，闰月再加 `isLeapMonth: true`。`xiaoliuren` 例外，直接接收农历月、日。
- **时间**：`birthHour` 传 0-23 的钟表小时，早晚子时由引擎处理，不要自行折算时辰。`xiaoliuren` 的 `hour` 可传时辰序号 1-12（子=1），也可传 0-23 小时。用户未提供的出生信息应当询问，而非代为假设。
- **占当下**：`qimen`、`daliuren`、`liuyao` 与 `meihua` 的时间起卦需要当前时间时，先取系统时间（如 `date +"%Y-%m-%dT%H:%M:%S"`）再填入参数。
- **日期核实**：用户说「今天/现在」并同时报出农历日期时，先取系统时间、用 `almanac` 核对公农历对应——农历与公历的映射是查历数据，不能凭记忆换算。口述与核实不符时，指出差异并以核实结果起盘，必要时附口述日期的对照结果。出生生肖、未来日期干支也以 Core 对相应日期的计算为准，不能从公历年份或单日盘面补算。
- **随机性**：`tarot` 可传 `seed` 复现抽牌；`liuyao` 的 `method: "auto"` 每次结果随机，需要复现时改用 `select`（指定卦名）或 `number`（数字起卦）。
- **六爻用神**：`yongShenTargets` 必填，按占问主题选择，可多选：事业官职、官司、疾病忧患取 `官鬼`；财运、男问感情取 `妻财`；文书合同、长辈、房产车辆取 `父母`；子女晚辈、健康平安取 `子孙`；合作竞争、朋友取 `兄弟`。
- **detailLevel**：默认输出已够解读；需要完整盘面时在参数中加 `"detailLevel": "full"`（部分工具另有 `"more"`）。

## 其他接入方式

支持 MCP 的客户端可以不经本 skill，直接使用 npm 包 `taibu-mcp`（stdio）或公网端点 `https://mcp.mingai.fun/mcp`，工具集相同。
