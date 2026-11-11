---
name: taibu-divination
description: >-
  太卜（TaiBu）占术排盘工具集与方法：八字（子平、盲派）、紫微斗数、六爻、梅花易数、奇门遁甲、
  大六壬、小六壬、太乙、塔罗、西方占星、黄历择日的本地计算工具，以及周公解梦。凡涉及算命、排盘、
  起卦、占卜、运势、命理、择日、宜忌、流年大运、星盘、解梦的请求（fortune-telling, divination,
  birth chart, BaZi, ZiWei, tarot, qimen, almanac, dream interpretation），即使用户没有点名具体
  术数体系，也应使用本 skill——盘面必须由工具计算，不可凭记忆推算干支、卦象、星曜。
---

# 太卜占术工具

太卜提供八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、太乙、塔罗、西方占星与黄历的排盘与详查工具，并为每个体系与流派附一个方法。计算引擎已随 skill 打包（`scripts/vendor/taibu-core.bundle.mjs`），本地直接运行，无需安装依赖，只要求环境中有 Node.js 18 或更高版本。

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
| 工具名 | 名称 | 用途 | 参数文档 | 方法 |
| --- | --- | --- | --- | --- |
| `astrology` | 西方占星命盘 | 根据出生信息计算本命盘与流运盘，输出基础坐标、命盘锚点、本命主星与流运触发 | [references/astrology.md](references/astrology.md) | [methods/astrology.md](methods/astrology.md) |
| `bazi` | 八字命盘 | 根据出生信息排四柱命盘，输出四柱干支、十神、藏干、地势、空亡与干支关系，可选输出纳音、神煞等扩展信息 | [references/bazi.md](references/bazi.md) | [methods/bazi.md](methods/bazi.md) |
| `bazi_pillars_resolve` | 四柱反推 | 根据四柱搜索分钟级出生时间区间，默认1900-2100，单次最多1200年 | [references/bazi_pillars_resolve.md](references/bazi_pillars_resolve.md) | [methods/bazi.md](methods/bazi.md) |
| `ziwei` | 紫微斗数命盘 | 根据出生信息计算紫微命盘，输出十二宫位、星曜分布、四化、大限等信息 | [references/ziwei.md](references/ziwei.md) | [methods/ziwei.md](methods/ziwei.md) |
| `ziwei_horoscope` | 紫微斗数运限 | 根据出生信息与目标日期计算大限、小限、流年、流月、流日、流时等运限信息 | [references/ziwei_horoscope.md](references/ziwei_horoscope.md) | [methods/ziwei.md](methods/ziwei.md) |
| `ziwei_flying_star` | 紫微斗数飞星 | 按查询逐条分析命盘宫位的四化飞入、自化、四化落宫与三方四正 | [references/ziwei_flying_star.md](references/ziwei_flying_star.md) | [methods/ziwei.md](methods/ziwei.md) |
| `liuyao` | 六爻排卦 | 根据问题与起卦信息排出六爻盘面，输出卦象、爻位、用神体系、关系判断与时机提示 | [references/liuyao.md](references/liuyao.md) | [methods/liuyao.md](methods/liuyao.md) |
| `meihua` | 梅花易数起卦 | 根据时间、字占、物数、报数等方式起卦，输出起卦信息、卦盘与体用推演 | [references/meihua.md](references/meihua.md) | [methods/meihua.md](methods/meihua.md) |
| `tarot` | 塔罗抽牌 | 按牌阵抽取塔罗牌，输出各牌位的牌面、正逆位、核心基调、元素与星象 | [references/tarot.md](references/tarot.md) | [methods/tarot.md](methods/tarot.md) |
| `taiyi` | 太乙排盘 | 支持九星观测，以及采用四库本金镜七十二局立成的现代历法适配年/月/日/时计 | [references/taiyi.md](references/taiyi.md) | [methods/taiyi.md](methods/taiyi.md) |
| `almanac` | 黄历查询 | 查询指定日期的黄历、宜忌、冲煞、值星、方位与时辰吉凶等信息 | [references/almanac.md](references/almanac.md) | [methods/almanac.md](methods/almanac.md) |
| `bazi_dayun` | 八字大运 | 根据出生信息计算起运时间与大运列表，可选输出起运前小运及各步大运的流年 | [references/bazi_dayun.md](references/bazi_dayun.md) | [methods/bazi.md](methods/bazi.md) |
| `qimen` | 奇门遁甲排盘 | 根据指定时间排出奇门盘，输出九宫、九星、八门、八神、格局等信息 | [references/qimen.md](references/qimen.md) | [methods/qimen.md](methods/qimen.md) |
| `daliuren` | 大六壬排盘 | 根据日期时间起课，输出天地盘、四课、三传、神将、课体与时空信息 | [references/daliuren.md](references/daliuren.md) | [methods/daliuren.md](methods/daliuren.md) |
| `xiaoliuren` | 小六壬占测 | 根据农历月日时辰起课，输出起课信息、推演链与结果信息 | [references/xiaoliuren.md](references/xiaoliuren.md) | [methods/xiaoliuren.md](methods/xiaoliuren.md) |
| `bazi_relations` | 八字岁运刑冲合害 | 在八字命盘上叠加大运（起运前为小运）、流年、流月或流日，详查它们与原局四柱、与彼此之间的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，附岁运并临、伏吟、天克地冲与太岁关系 | [references/bazi_relations.md](references/bazi_relations.md) | [methods/bazi.md](methods/bazi.md) |
| `bazi_wuxing` | 八字五行旺衰 | 在八字命盘上详查旺衰与生克的事实：月令旺相休囚死与日主得失，月令各藏干透出与否（取格看月令），四个天干各自的通根（本气、中气、余气，无根亦列出），干支自坐与相邻天干的生克，以及缺失五行 | [references/bazi_wuxing.md](references/bazi_wuxing.md) | [methods/bazi.md](methods/bazi.md) |
| `bazi_liunian_scan` | 八字流年扫描 | 在八字命盘上逐年列出一段年份（最多 30 年）的流年干支、所在大运（起运前为小运）、十神，流年与原局、与大运的刑冲合害，以及太岁与岁运提示 | [references/bazi_liunian_scan.md](references/bazi_liunian_scan.md) | [methods/bazi.md](methods/bazi.md) |
| `ziwei_palace` | 紫微宫位 | 在紫微命盘上聚焦一宫详查：本宫星曜亮度与生年四化、离心/向心自化，空宫借对宫，三方四正，夹宫，宫干四化飞出与十二宫四化飞入 | [references/ziwei_palace.md](references/ziwei_palace.md) | [methods/ziwei.md](methods/ziwei.md) |
| `qimen_palace` | 奇门宫位详查 | 在奇门盘上详查一宫：指定宫位，或按年月日时干（取天盘，甲取所遁六仪）、九星、八门、八神定位 | [references/qimen_palace.md](references/qimen_palace.md) | [methods/qimen.md](methods/qimen.md) |
| `daliuren_lessons` | 大六壬课传详查 | 在已起的六壬课上详查四课与三传：逐课列上下神的贼克生克、所乘天将、神将与遁干六亲 | [references/daliuren_lessons.md](references/daliuren_lessons.md) | [methods/daliuren.md](methods/daliuren.md) |
| `astrology_point` | 占星单点详查 | 在西方占星命盘上详查一颗星体（含交点、莉莉丝、上升、天顶）或一个宫位：星座宫位与逆行、托勒密传统尊贵、主管宫位或宫主星落点、本命相位（标入相／出相）、流运触发或流运过境 | [references/astrology_point.md](references/astrology_point.md) | [methods/astrology.md](methods/astrology.md) |
| `liuyao_line` | 六爻逐爻详查 | 在六爻卦盘上按爻位或角色（世、应、动爻、六亲）取爻，列纳甲、六亲、六神、世应、动静、旺衰判据、月破日破暗动与空亡、月建日辰作用、化进化退与回头生克、伏神飞伏，以及动爻对本爻的生克冲合 | [references/liuyao_line.md](references/liuyao_line.md) | [methods/liuyao.md](methods/liuyao.md) |
| `almanac_select` | 黄历择日筛选 | 在指定区间内逐日取黄历，按事项（宜忌逐条匹配）与冲煞（一个或多个生肖、地支的六冲）筛选候选日，列出干支、农历、建除、黄黑道、二十八宿、纳音、冲煞与宜忌，并给出排除统计 | [references/almanac_select.md](references/almanac_select.md) | [methods/almanac.md](methods/almanac.md) |
| `bazi_hepan` | 八字合盘 | 两人各排四柱，列出两盘之间的天干五合/相冲与地支六合、三合、半合、三会、六冲、刑、害、破，日主互见的十神与五行生克，日柱（日主与夫妻宫）、年柱（生肖与年命纳音）之间的关系，以及一方所缺、另一方原局有的五行 | [references/bazi_hepan.md](references/bazi_hepan.md) | [methods/bazi.md](methods/bazi.md) |
| `bazi_hour_candidates` | 推算出生时辰 | 出生时辰未知时，列出出生当天各时辰的候选：四柱、时柱十神与藏干、时柱与原局的干支关系、命宫、日主在时支的根、月令透时干、缺失五行与起运 | [references/bazi_hour_candidates.md](references/bazi_hour_candidates.md) | [methods/bazi.md](methods/bazi.md) |
<!-- TOOLS:END -->

调用前先 `schema <tool>`，或读 `references/<tool>.md`（参数表与可复制的示例）。

详查工具只问某柱、某类关系或某几组事实时，用筛选参数只取所需：`bazi_relations`、`bazi_liunian_scan` 的 `pillars`、`types`，`bazi_wuxing` 的 `sections`，`daliuren_lessons`、`astrology_point` 的 `focus`。「同字牵连」须与所列关系一并解读；「未列出」表示另有事实没有展开，确需时去掉筛选再查。

## 方法

排盘只是第一步。产出解读前读对应的方法 `methods/<id>.md`：每个方法给出该体系或流派的角色、断法、工具流程与输出要求，按其组织解读内容。工具表最后一列是该体系的默认方法；同一体系有多个方法时（如八字的子平与盲派），按用户点名的流派选方法，未点名时用默认方法。解梦不需要排盘工具，直接读 `methods/dream.md`。

<!-- METHODS:BEGIN -->
| 方法 | 名称 | 适用 | 文件 |
| --- | --- | --- | --- |
| `bazi` | 子平八字 | 子平法论八字：月令定格，旺衰、调候、通关、病药取用，十神六亲与大运流年应期。问命局格局、性格才能、事业财运、婚姻六亲、健康、某几年运势，或两人合不合（合婚、合作、亲子）时使用；用户点名盲派时改用 bazi-mangpai。 | [methods/bazi.md](methods/bazi.md) |
| `bazi-mangpai` | 盲派八字 | 盲派（段建业一系）论八字：宾主、体用定位，看做功方式与效率定层次，以十神、宫位、干支取象断事，岁运引动定应期；不以日主旺衰定喜忌。用户点名盲派、做功、象法，或要直断职业、婚姻、六亲事件时使用。 | [methods/bazi-mangpai.md](methods/bazi-mangpai.md) |
| `birth-hour` | 推理时柱 | 出生时辰未知时先推时辰：列出当天各时辰的候选，以六亲、几件前事的年份与性情逐个排除，剩两三个时用紫微交叉核对，经用户确认后再正式排盘。用户不知道或记不清出生时辰、只记得大致时段时使用，与八字、紫微、占星的体系方法同用。 | [methods/birth-hour.md](methods/birth-hour.md) |
| `past-events` | 验证前事 | 以前事校准论断：论断依赖拿不准的取舍（身强身弱与用神、格局成败、时辰交界、流派口径），或用户说断语不准时，先挑两三件在不同取舍下结论相反的往事请用户核对，按核对结果定下取舍再论将来。与八字、紫微、占星的体系方法同用。 | [methods/past-events.md](methods/past-events.md) |
| `ziwei` | 紫微斗数 | 紫微斗数论命：三合派看星曜组合、庙旺与三方四正，飞星派看生年四化与宫干飞化，大限、流年叠宫断事与时间。问性格格局、十二宫各领域、大限流年运势时使用。 | [methods/ziwei.md](methods/ziwei.md) |
| `liuyao` | 六爻 | 六爻纳甲断卦，宗《增删卜易》《卜筮正宗》：定用神，月建日辰论旺衰，动变论生克，世应论人我，以用神之病与动静取应期。问一件具体事情的成败、得失、吉凶与时间时使用。 | [methods/liuyao.md](methods/liuyao.md) |
| `meihua` | 梅花易数 | 梅花易数断事：以体用生克为纲，参月令旺衰，本卦、互卦、变卦三段推演，依体用诸诀定吉凶，卦象取义并推克应之期。用时间、数字、文字、物象起卦问一件事时使用。 | [methods/meihua.md](methods/meihua.md) |
| `qimen` | 奇门遁甲 | 奇门遁甲断局：以用神落宫为核心，天盘、地盘、九星、八门、八神五层合参，值符值使定全局，格局、旺衰、空亡入墓定吉凶，给出方位与时机。问一件事可行与否、宜从何方何时行动时使用。 | [methods/qimen.md](methods/qimen.md) |
| `daliuren` | 大六壬 | 大六壬起课断事：以四课三传为纲，课体定性，生克定量，十二天将与类神取象，日辰旺衰与本命行年参断，三传定事态始末与应期。问具体事情的过程、结局与时间时使用。 | [methods/daliuren.md](methods/daliuren.md) |
| `xiaoliuren` | 小六壬 | 小六壬掌诀速断：按农历月、日、时三步落宫，以最终落宫定结论，推演链看过程，五行方位时辰作提示。问一件事顺不顺、成不成、快不快，需要简短答复时使用。 | [methods/xiaoliuren.md](methods/xiaoliuren.md) |
| `taiyi` | 太乙神数 | 太乙式论时运格局：以所选年、月、日、时计的时空底盘与九星阵列、主客关系判断大势顺逆与主动权归属。问一段时期的整体气象、宜攻宜守时使用。 | [methods/taiyi.md](methods/taiyi.md) |
| `tarot` | 塔罗 | 韦特塔罗解读：牌阵位置语义、正逆位、大小阿卡纳、元素与数字分布、牌间呼应连成叙事，给出心理洞察与行动建议。问感情、抉择、处境或自我成长，需要启发而非宿命断语时使用。 | [methods/tarot.md](methods/tarot.md) |
| `astrology` | 西方占星 | 现代西方占星：本命盘看太阳、月亮、上升与行星的星座、宫位、相位，盘面重心与命盘锚点；流运盘看外行星对个人行星与四轴的触发。问性格心理、人生课题与某段时间的成长主题时使用。 | [methods/astrology.md](methods/astrology.md) |
| `almanac` | 黄历择日 | 黄历择日：按用事取宜忌，参冲煞、值神黄黑道、十二建除定当日基调，选吉时吉方，多日候选按宜合、不冲、值神吉排序。问某天适不适合做某事、在一段时间里挑日子时使用。 | [methods/almanac.md](methods/almanac.md) |
| `dream` | 周公解梦 | 解梦：收集梦境要素，以《周礼》六梦、《潜夫论》十梦辨梦之类，按传统梦书取象并落到做梦者的处境，参照现代心理学理解梦与情绪、经历的关联。用户讲述梦境、问梦的吉凶或含义时使用。 | [methods/dream.md](methods/dream.md) |
<!-- METHODS:END -->

## 解读通则

- 断语必须引用盘面证据（干支、星曜、爻位、格局名与工具输出逐字一致），不确定的回到输出核对；盘面没有的格局名、神煞、课体、术语与相位不自行生造，未返回的事实不补写，也不由别处的表推算出别处的结论（如用本命相位推流运相位、用原局关系推岁运关系）。
- 资料或起盘条件不足时，明确告知「条件不足，无法准确判断」并说明所缺信息，不代为假设，也不凭记忆补算干支、卦象、星曜或公农历换算。
- 正文以该体系术师的口吻写给问事人：先结论、后论证。工具调用与核验过程不写入正文，至多在文末一句带过——把篇幅留给卦理与判断，而不是操作记录。
- 关键事件给出时间范围、吉凶属性与影响程度；应期先以范围与触发条件表述（某步大运、某个流年、逢冲之月、出空之日等），要落到具体日期时先按该日期调用工具核实，不凭换算记忆写死历日；建议针对当前盘面，不写放之四海皆准的空话。
- 断语按把握度给结论：对事件与结果的断言，把握大的直说，把握小的用条件句（「多主」「偏于」「若无他象干扰」），不写「必然」「一定」「必有」这类绝对断言；吉凶给程度与触发条件，不给不可验证的定数。方法本身的规则（如空宫借星力量打折、合制效率高于冲制）照常作确定表述，这不是绝对化。
- 同一张盘、同一问题的判断前后保持一致：沿用既定的取舍与结论口径；因新依据需要改判时，先说明原先依据的问题再改，不无声改口。
- 分析深度跟随用户要求伸缩：速断类（小六壬、单牌塔罗）短平快，命盘全局类（八字、紫微）分层展开，用户要求逐大限、逐流年时按方法调用运限工具补数据。
- 命理与术数仅供参考，保持客观、有建设性的积极视角，不做「必死」「必离」「大祸临头」等恐吓性判定；涉及健康医疗、法律诉讼、重大财务等现实决策时，提醒结合实际情况并咨询专业意见。

## 约定

- **历法**：生辰类工具默认公历（`calendarType: "solar"`）；用户给的是农历生日时改传 `"lunar"`，闰月再加 `isLeapMonth: true`。`xiaoliuren` 例外，直接接收农历月、日。
- **时间**：`birthHour` 传 0-23 的钟表小时，早晚子时由引擎处理，不要自行折算时辰。`xiaoliuren` 的 `hour` 用 `hourType` 指明口径：`clock` 为 0-23 小时，`shichen` 为时辰序号 1-12（子=1；手工传农历且给钟点时必传 `hourType: "clock"`）。用户未提供的出生信息应当询问，而非代为假设。
- **出生时辰未知**：先推时辰、经用户确认后再分析，不要自行填一个时辰，也不要直接按三柱下结论。加载技法 `birth-hour`（推理时柱），用 `bazi_hour_candidates` 列出当天各时辰的候选与区分事实，向用户核对六亲与几件前事的年份逐个排除，剩两三个时可对它们各排一张 `ziwei` 交叉核对；把最可能的一到三个时辰连同依据交给用户确认，提问时写明跳过会失去哪些分析（如紫微宫位、命宫、小运），确认后以该候选给出的 `birthHour`、`birthMinute` 正式排盘，回答里注明时辰是推定并经用户确认的。用户答不上来、不愿推、跳过或超时未回复时，八字类工具省略 `birthHour`，只按年、月、日三柱分析（不给命宫、时柱神煞与小运，起运给出范围），并说明时柱相关的内容没有覆盖，不要重复询问。紫微、占星离不开时辰，必须先推、确认后再排。六爻、梅花、奇门、六壬、塔罗占的是一件事，不用来推出生时辰。
- **占当下**：`qimen`、`daliuren`、`liuyao` 与 `meihua` 的时间起卦需要当前时间时，先取实际的当前时间（有 `current_time` 工具时调用它，消息含【发送时间】时取该时间，命令行用 `date +"%Y-%m-%dT%H:%M:%S"`）再填入参数，不凭印象估计。
- **日期核实**：用户说「今天/现在」并同时报出农历日期时，先取得实际的当前日期、用 `almanac` 核对公农历对应——农历与公历的映射是查历数据，不能凭记忆换算。口述与核实不符时，指出差异并以核实结果起盘，必要时附口述日期的对照结果。出生生肖、未来日期干支也以 Core 对相应日期的计算为准，不能从公历年份或单日盘面补算。
- **随机性**：`tarot` 独立调用可传 `seed` 复现抽牌（应用内任务由服务端固定种子，不传 `seed`）；`liuyao` 的 `method: "auto"` 每次结果随机，需要复现时改用 `select`（指定卦名）或 `number`（数字起卦）。
- **六爻用神**：`yongShenTargets` 必填，按占问主题选择，可多选：事业官职、官司、疾病忧患取 `官鬼`；财运、男问感情取 `妻财`；文书合同、长辈、房产车辆取 `父母`；子女晚辈、健康平安取 `子孙`；合作竞争、朋友取 `兄弟`。
- **缺所问**：起卦、起课或抽牌时未填所问，不影响排盘；读取这类记录时先陈述盘面，所问未明时先问清，再取用神或取象（已指定用神的按指定目标断），不臆造问题。
- **detailLevel**：默认输出已够解读；需要完整盘面时在参数中加 `"detailLevel": "full"`（部分工具另有 `"more"`；详查工具的 full 只多附判定口径）。

## 其他接入方式

支持 MCP 的客户端可以不经本 skill，直接使用 npm 包 `taibu-mcp`（stdio）或公网端点 `https://mcp.mingai.fun/mcp`，工具集相同。
