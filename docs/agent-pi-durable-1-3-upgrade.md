# Agent Pi Durable 1.3.0 升级

五个 `@earendil-works` 依赖（chord、pi-ai、pi-codemode、pi-durable、pi-mcp）精确固定为 1.3.0。本轮按用户要求做不兼容升级：只接受 `pi-durable/1.3.0` 检查点，在途 1.1.0 任务按原结算规则终止；随后分阶段接入 1.2／1.3 新增能力。本文按阶段记录适配、边界与验证。

## 上游版本与破坏性变更

| 依赖 | 结果 |
| --- | --- |
| pi-durable | 1.1.0 → 1.3.0（2026-10-15 发布；1.2.0 为 2026-10-12） |
| pi-ai、pi-mcp、chord | 1.1.0 → 1.3.0 |
| pi-codemode | 新增 1.3.0（代码模式沙箱，阶段二接入） |

1.2.0 破坏性变更与本地适配：

- `ToolExecutionResult.content` 改名 `output`。TypeScript 只能拦下部分返回值（其余因弱类型检查静默通过，会丢失给模型的文本），因此逐一迁移全部工具、`afterTool`、子分析、外部 MCP 与早报工具的返回值。
- `ToolTaskInput`／`ToolTaskResult` 改为标签联合：模型发起的调用为 `kind: "model"`（含 `assistant`），嵌套调用为 `kind: "nested"`。投影用 `modelCallEntry()` 只从模型调用取 assistant 条目；嵌套调用没有 assistant 条目。`pi.tool` 任务版本为 2。
- Storage 任一方法抛错即令 Session 失败并关闭，之后的调用与等待以 `SessionFailed` 拒绝，不再重试。现有适配器在 PostgreSQL 追加失败时已标记存储不可用并中断本次执行，由新的租约持有者重读日志接管；`onReport` 会再收到一次令 Session 失败的错误，日志据此区分 `SESSION_FAILED` 与普通扩展错误。
- 监听器抛错改由 `onReport` 上报；投影监听器自行捕获并中断，不受影响。
- 仅展示用的写入提交立即落库、`bash`／`powershell` 非零退出码：Taibu 不使用这两类能力。

## 引擎代际迁移

`AGENT_ENGINE` 改为 `pi-durable/1.3.0`。迁移 `supabase/migrations/20261020_100000_agent_pi_durable_1_3.sql`：

- `agent_worker_heartbeat` 只接受 1.3.0；`agent_claim_run` 只认领 V2／1.3.0 检查点，且 worker 必须以 1.3.0 心跳。
- `agent_create_run` 的准入守卫由 1.1.0 原样替换为 1.3.0；找不到经审查的旧守卫时迁移中止，不猜测函数体。
- 活动中的旧任务（排队、运行、等待补充、停止中）递增 fence 后经现有 `agent_finish_run` 结算：无正文／成果的已扣费任务退款一次，有正文的保留扣费；待处理指令标记取消。已完成历史与成果保留。重复执行不重复结算或退款。
- 安全对象沿用 `SECURITY DEFINER` 与固定 `search_path`，执行权限只授予 `authenticated`／`service_role`。不新增表或列，无需回填或新索引。

自托管基线随迁移重新生成，迁移 SHA256 为 `654f1445606b17dc14ae84ac34d188698242ad74aa1b82ff6736c89b44031fe9`；升级目标指纹 `a965a7c1177ad5d6aae386fd69ddfc6ea20883d39942b848676a6e1d8d65824e`，既有已审查指纹路径（含 `cf8f3676…` 会话分享基线）按顺序追加本迁移，未知 schema 仍拒绝。

## 压缩失败

1.3.0 在阻塞压缩失败时以 `Compaction failed: …` 结束本次生成并记录 `pi.live.compactionFailure`。任务据此显示「上下文过长且压缩失败，可开启新对话或重新发起任务」，不再只给通用失败提示。

核对时发现：Taibu 摘要失败后抛出的错误按 Pi hook 语义只被上报，Pi 随即用内置摘要器经同一受控模型重试（1.1.0 起即如此）；原先压缩卡片会一直显示失败。现在摘要 hook 失败时直接交给内置摘要器，投影按压缩任务的实际结果结算记录：摘要落入上下文即改为完成并展示该摘要；再次失败、无可压缩范围或摘要过期则保持失败。

## 阶段一验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 1998 项通过（新增阻塞压缩失败提示、内置摘要接手两项回归；旧 1.1.0 检查点加入拒绝用例） |
| `pnpm test:db` | 66 项隔离 PostgreSQL 契约通过；引擎退役用例改为重放 1.3.0 迁移两次，验证结算一次、退款一次 |
| `pnpm lint`、严格类型 | 通过 |
| `pnpm build:agent` | worker 打包通过 |
| selfhost 守卫 | 21 项指纹与升级路径断言通过 |

## 阶段二：代码模式

输入框模型菜单新增「代码模式」开关，默认关闭，随对话的下个任务配置保存（`next_task_config.codeMode`），在任务创建时写入 `agent_runs.input.codeMode` 并参与请求哈希；运行中的任务不受切换影响。缺省读作关闭，与推理档位、协作成员的缺省规则一致；非布尔值使整份配置无效。不新增表或列。

开启后运行时安装 `createAgentCodemodeExtension()`（`src/lib/agent/codemode.server.ts`）：

- 工具来自 Pi `createCodemodeTool({ sandbox, models: false })`：脚本只能调用本任务工具，不能直接调用模型。Pi 为编程场景放宽的输出上限（4 MiB）恢复为 Harness 默认上限。
- 沙箱为 `@earendil-works/pi-codemode` 的 QuickJS：每次执行一个 worker 线程，内存 64 MiB，单 worker 同时最多 4 个脚本，超出时该次调用失败并提示稍后重试；单次运行不超过 120 秒。
- 可调用范围由工具的 `callers` 决定。`AGENT_MODEL_ONLY_TOOLS`（提问、计划、查看与定位盘面、联网与知识库检索、附件、方法、长期记忆、协作）与 `parallel_analysis` 声明 `callers: ['model']`，脚本调用时 VM 报「does not exist」。其余工具（排盘、计算、详查、个人资料、外部 MCP）可被脚本调用。
- 排盘、计算与详查声明 `structuredOutputSchema`，脚本拿到 `{ artifactId?, text, data }`：`text` 为 Core 规范文本，`data` 为规范 JSON，`artifactId` 可写作 `artifact:<artifactId>` 交给查看与详查。其他工具给脚本有界文本。
- 嵌套调用照常经过 `beforeTool` 的策略与权限校验；另按 Pi 嵌套调用 ID（`<脚本调用>/c<n>`，n 为脚本内第 n 次 VM 调用）在第 31 次起阻断。按调用 ID 判断保证重放得出同样结论。
- 提示词段 `taibu_codemode` 只在本次请求实际提供 `codemode` 时出现，列出脚本可调用的工具（排除延迟加载的工具）；协作成员不提供代码模式。

投影与界面：

- 实际执行的嵌套调用在 `afterTool` 中写成脚本卡片下的工具部分（`id: nested:<任务号>`、`parentId: native-tool:<条目>:<调用>`、`scriptCall: <脚本内第几次调用>`），与调用结果同一提交落库；结果的 `details` 只留在公开部分，原生日志与脚本只保留结构化结果。被阻断、参数无效或不存在的调用没有执行，只出现在脚本的调用清单里。部分按 `scriptCall` 排序：脚本可并发发起调用，任务创建次序不等于脚本里的次序。
- 运行中的调用由 `pi.live.nestedTools` 显示占位，活动行显示「运行脚本 · 工具名」；结算后占位由正式部分替换。脚本卡片显示脚本、去掉 Pi 页眉的输出与调用清单。
- 聊天过程把脚本作为一个步骤，其调用作为子步骤；摘要统计包括子调用（例如「已查看 2 张命盘，已运行 1 个脚本」）。工作区新增「脚本」视图，按脚本列出的次序逐条列出调用：执行过的调用打开它自己的页面，未执行的在行内说明原因。脚本排出的盘与直接排盘一样打开盘面，模型跟随照常生效。
- 嵌套结果不进入模型转录，模型只读脚本输出。

打包：`scripts/build-agent-worker.mjs` 额外产出 `.agent/codemode-worker.mjs`，复制 `quickjs.wasm` 及其许可证（`.agent/licenses/quickjs-wasi.LICENSE`）。worker 启动时用打包资源配置沙箱；`--check` 会实际运行一次 `return 1 + 1`，镜像构建时即可发现沙箱资源缺失。

### 阶段二验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 2003 项通过；新增 `agent-codemode.test.ts`（嵌套排盘落为子部分与成果、运行中占位与活动行、禁用工具与 30 次上限、默认关闭）及目录、展示、工作区、配置回归 |
| `pnpm test:browser` | 通过；新增脚本步骤（一次步骤、子调用、代码与输出）与脚本页（三条调用、未执行原因、打开排盘）检查 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |
| `node scripts/build-agent-worker.mjs`、`node .agent/worker.mjs --check` | 通过，沙箱自检通过 |

排查中发现两点，已处理（见下文「阶段五」与「阶段六」）：

- 运行时在模型未选定最终成果时以 `onYield` 续跑，没有次数上限；模型若始终不调用 `select_final_artifacts`，任务会持续请求模型。
- Agent 以公历 `date` 调用 `xiaoliuren` 必然失败：Pi 按 schema 补入 `isLeapMonth: false`、`leapMonthStrategy: 'repeat'` 默认值，Core 将其视为手工农历输入而拒绝。

## 阶段三：按需加载的工具

每次请求直接提供全部工具会让模型在几十个 schema 之间选择，低频工具（详查、大运、流年扫描、飞星、择日）与外部 MCP 工具尤其如此。1.3.0 的 `deferred` 让工具先不提供，由 `tool_search` 检索后从下一次模型调用起加载；加载写入对话的 `modelTools.add`，同一分支上保持可用，压缩上下文后仍可用。

- 13 个低频工具（8 个详查与 5 个计算）与全部 `mcp__` 工具在注册时标记 `deferred`（`AGENT_DEFERRED_TOOLS` / `isAgentDeferredTool`）。排盘、方法、资料、检索等常用工具照常直接提供。
- 延迟只影响模型是否被提供该工具：`callable` 仍包含它们，因此代码模式脚本可以直接调用，无需先加载（有回归用例）。协作成员没有 `tool_search`，其体系的延迟工具经 `modelTools` 显式数组直接提供（阶段八修正：此前只设了 `tools`，成员拿不到本体系的详查与运限计算）。
- Pi 自带的 `tool_search` 用 BM25 对英文 token 排序，中文查询分词为空，Taibu 因此实现自己的 `tool_search`（`tool-search.server.ts`）：按工具名、中文标题、人工关键词与描述打分；名称、标题、关键词为强匹配，描述只加分、不能单独命中（避免「存在」「东西」这类词把无关工具带出来）；同分保持注册顺序。工具以中文关键词检索，例如「大运」「流年扫描」「飞星四化」「择日」「动爻」「三方四正」，也可直接用工具名。
- 命中后返回工具名、标题与描述首行，并以 `control.addTools` 加载；没有命中时说明未找到并提示换词。提示词段 `taibu_tool_search` 只在存在延迟工具时出现，说明可检索的范围、常见关键词与「同一对话内加载后保持可用」，并在开启代码模式时说明脚本可直接调用。
- 公开部分记录 `details.loaded`，聊天步骤显示「「大运」 · 加载 2 个工具」；工作区沿用通用工具页。

### 阶段三验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 2008 项通过；新增 `agent-tool-search.test.ts`（13 个延迟工具、中文排序与无匹配、加载后下一请求提供、未加载的工具仍不提供）与代码模式直接调用延迟工具、目录与展示回归 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |

## 阶段四：计划模式

输入框模型菜单新增「计划模式」，默认关闭，随对话的下个任务配置保存（`next_task_config.planMode`），任务创建时写入 `agent_runs.input.planMode` 并参与请求哈希；运行中的任务不受切换影响。不新增表或列。

开启后运行时注册 `submit_plan`（`callers: ['model']`，脚本不可调用），并加一段计划模式提示：

- 研究照常进行（排盘、详查、检索、读取资料），但写长期记忆与派发协作成员被 `beforeTool` 阻断，直到用户批准。阻断发生在工具策略层，模型会收到明确的阻断原因。
- 模型把计划写成 Markdown 调用 `submit_plan`，工具在原生 ToolTask 中等待用户决定，复用 `ask_user` 的 memo／回复队列与暂停恢复链路：用户批准则写入 `checkpoint.planApproved`，工具返回「用户已批准计划」；选择「要求修改」并填写意见时，意见作为反馈返回，模型修订后再次提交。
- 等待中的问题复用 `ask_user` 的问题面板：问题为「是否按这个计划执行？」，选项为「批准」「要求修改」，也可自行填写修改意见。计划正文留在工具卡片与工作区，面板只问决定。
- 模型在批准前直接作答时，`onYield` 以「请先调用 submit_plan」续跑，最多两次，之后正常结束，避免无上限续跑。
- 聊天过程把计划按 Markdown 展示，并写明「等待你批准」「你已批准」「你要求修改」。

### 阶段四验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 2017 项通过；新增 `agent-plan-mode.test.ts`（批准前阻断、批准后执行、要求修改后再次等待、批准前作答的两次上限）与配置、展示回归 |
| `pnpm test:browser` | 通过；新增已批准计划按 Markdown 展示的检查 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |

## 阶段五：两处修复

**最终成果的选定不再无限续跑。** 当时的修复：只有一个计算成果时直接选定，有多个时最多追问两次，模型显式的空选择不被覆盖。复核这项修复时确认选定本身没有必要，阶段六随即移除了 `select_final_artifacts`，这些规则随之删除。

**小六壬公历日期可用。** `isLeapMonth` 在输入 schema 里有默认值 `false`，按 schema 补默认值的调用方（MCP 与 Agent 校验）总会带上它，而 Core 把它当作手工农历输入与 `date` 冲突。现在 `date` 只拒绝真正的手工农历字段（`lunarMonth`、`lunarDay`），闰月由日期推出；只有显式 `isLeapMonth: true` 与日期推出的非闰月矛盾时才报错。`packages/core/tests/xiaoliuren-core.test.mjs` 增加对应回归。

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 2017 项通过；新增公历小六壬经 Agent 全链路回归（现位于 `agent-chart-save.test.ts`）及当时的选定规则用例（阶段六删除） |
| `node --test packages/core/tests/xiaoliuren-core.test.mjs` | 14 项通过 |

## 阶段六：命盘改由用户保存

复核阶段五时确认 `select_final_artifacts` 没有存在的必要：它唯一的实际效果是结算时把选中的八字、紫微成果写入 `bazi_charts`／`ziwei_charts`，其余九种占术选中后什么也不保存；成果本身随对话保留，`artifact:<id>` 在同一对话的后续回合照常可用，查看、详查与定位都不依赖选定。八字、紫微结果页由用户点「保存命盘」决定是否存入命盘库，Agent 却由模型替用户决定，还要多一次模型调用、一套续跑提醒和结算写入。现在：

- 移除 `select_final_artifacts`、`artifacts` 工具族、检查点的 `finalArtifacts`／`finalSelectionMade`／`finalNudges`、`onYield` 的选定续跑，以及「已选定 N 份成果」与成果归并展示。计划模式只再阻断长期记忆与协作。
- 排盘结果末尾给模型的引用改为「命盘引用: artifact:<id>。查看、详查或定位这张盘时作为 reference 传入。」，只附在 11 种排盘工具上。协作成员按指令在结论里回报命盘引用，界面不显示（`memberAnswerText`）。
- 盘面工具栏新增保存按钮（`AgentChartSave`）：已完成的八字、紫微排盘提交与结果页相同的资料（`getAgentChartSave`，`POST /api/bazi|ziwei/charts`，日主等字段由服务端计算）；非午夜换日、带计算选项或日期不是有效公历日期（如农历二月三十）的盘不提供保存。命盘库里已有同一出生身份（性别、日期、时刻、历法、闰月、经度、时区、DST 策略；名称与地点只是标签）的盘即显示为已保存并链接到命盘页，不论在哪一页保存；库里删除后又可保存。工作区概览的「已保存」按同一规则判断。
- 迁移 `20261020_120000_agent_user_saved_charts.sql`：`agent_finish_run` 去掉命盘保存与自 `20261007_100000` 起不再使用的 `p_record`，`agent_cache_tool` 不再写 `chart_payload`，删除只由这两个函数写入的 `agent_run_artifacts.chart_payload／chart_id／chart_type`。结算、指令、退款与消息规则不变；已有回答里的成果与链接、已保存的命盘不受影响。无 RLS、索引变化，无需回填。
- 自托管：迁移 SHA256 `55ad3521aad922853bd3535a4f87c6e37430498b383ac4b045c366effea43842`，升级目标指纹 `3835fe3cba2c2df7f8315b8ad7a69b4c50c1c04c14592b81d1abccef92c20a4f`；既有已审查路径（含 1.3.0 目标 `a965a7c1…`）按顺序追加本迁移。
- 离线演示模型与本地验收不再调用选定工具：演示按「命盘引用」取盘；验收在盘面上保存首张八字（账号里已有同一张盘时只核对链接），并核对重新生成、worker 接管都不保存任何命盘，结束时删除本次保存的命盘（`--keep` 保留）。

### 阶段六验证

| 验证 | 结果 |
| --- | --- |
| `pnpm test` | 2016 项通过；`agent-final-selection.test.ts` 改为 `agent-chart-save.test.ts`（结算不再有选定、命盘引用到达模型、保存资料与结果页一致、按出生身份判断已保存） |
| `pnpm test:db` | 66 项通过；结算与缓存函数的新签名、旧签名删除、三列删除、引擎退役重放 |
| `pnpm test:browser` | 通过；新增盘面保存一次、提交结果页资料并变成命盘页入口的检查 |
| selfhost schema／stack | 34 项通过 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |
| `node scripts/build-agent-worker.mjs`、`node .agent/worker.mjs --check` | 通过 |

## 阶段七：手动压缩

自动压缩之外，用户可在空闲的 Agent 对话里发送 `/compact`（命令菜单「压缩上下文」填入），可接一句想保留的重点。设计取舍：压缩需要调用摘要模型，只能在 worker 里进行；Pi 的 `conversation.compact()` 作用于一次任务的 Durable 会话，而 Taibu 的后续任务从上一个已完成任务的 `checkpoint.messages` 接续。因此 `/compact` 本身是一个任务，压缩后的上下文写回它的 `checkpoint.messages`，下一个任务照常接续。不新增表、列或指令模式。

- 准入（`createAgentTask`）：消息匹配 `/compact [重点]`（`parseAgentCompactCommand`）即为压缩任务。要求对话已有历史，不能附带资料、引用或附件正文，重点最多 500 字。任务以 `p_charge: false` 创建（`billing: exempt`），因此不检查积分；仍校验会员对模型的权限，并使用独立限流桶 `/api/agent/compact`（每用户每小时 10 次），不占普通对话的额度。`input.compact` 记录重点；联网、代码模式、计划模式与协作成员一律关闭。
- 执行（`executeAgentRun`）：照常接续历史，但不提交命令本身作为输入，而是 `root.compact(重点)` 并等待压缩任务结束。接管时先按 `scanTasks` 找回上一个 worker 已登记的压缩任务，不会压缩两次。摘要仍由 Taibu 的摘要 hook 生成，重点以「只决定侧重与取舍，不改变上述规则」附在摘要请求后；失败时由 Pi 内置摘要器重试。
- 结果：摘要落入上下文则完成并说明已压缩（压缩记录可展开查看摘要）；没有足够早的内容可摘要（Pi 保留最近约 8k token）则完成并说明无需压缩，不调用模型；失败则任务失败、原上下文保留。用户停止时不压缩。压缩中的活动显示「正在压缩上下文」。
- 界面：输入框命令菜单只在 Agent 模式列出 `/compact`；任务进行中、没有历史、普通对话模式或附带资料时发送会提示原因，不会把命令当作问题发给模型。

### 阶段七验证

| 验证 | 结果 |
| --- | --- |
| `agent-compact.test.ts` | 命令解析；压缩不调用主模型、重点进入摘要请求、下一任务从摘要开始、命令不进入上下文；上下文太短时不调用模型；两次摘要都失败时保留原上下文；停止时不压缩 |
| `agent-api.test.ts` | 免费且无需积分、独立限流桶、关闭工具与协作；无历史、附带资料或引用、重点过长与限流时不创建任务 |
| 本地验收（2026-10-21，`taibu-agent-1006b`） | 通过：崩溃恢复对话上经命令菜单发送 `/compact`，任务免费完成且不调用工具 |

## 阶段八：后台常驻子分析

`parallel_analysis` 派出成员后要等全部完成才返回，期间主 Agent 什么也做不了，成员答完即弃。按 Pi 示例 23（persistent background subagents）新增 `background_agent`（`background.server.ts`）：主 Agent 把某一体系的专项分析交给后台子分析后立即继续自己的部分，子分析答完由系统把结论作为一条新消息送回；同一子分析可以继续接收任务，并在之后的提问中保留。不新增表、列或迁移。

- 工具：`spawn`（名称、体系、任务）、`send`（子分析正在分析时默认在其下一步插入，`followUp` 排到当前任务之后）、`stop`（中止当前工作，保留）、`dismiss`（解散）、`status`。每个对话最多保留 3 个，每个任务最多发送 8 条；仅模型可调用（脚本不可），计划模式下批准前阻断；`replay: 'unsafe'`，被崩溃打断的调用不重放，模型可用 `status` 核对。
- 结构：每个子分析是独立会话，由一个立即完成的后台锚任务（`taibu.background-anchor`）持有，主 Agent 的停止与空闲等待都到不了它，停止整项任务（`abort({ background: true })`）仍会停止它。每条消息由一个后台回报任务（`taibu.background-reporter`）投递并等待答复，再以 follow-up 输入「[后台子分析「名称」回报]……」送回主会话：主会话空闲时开启新一轮，忙时排在当前回答之后。两个阶段各以一次提交结束，请求 ID 去重，重启后子分析只收到一次消息、主 Agent 只收到一次回报；一次答复覆盖多条消息时只回报一次。会话文档 `taibu.background` 记录子分析名单与本任务的回报任务。
- 成员边界与协作成员一致：只提供所选体系的排盘、计算、详查与方法工具（`memberTools`／`memberAgentChange`），不能联网、追问、写记忆或再派子分析；回报是资料而非用户消息，提示词段 `taibu_background`（有子分析时才出现）列出常驻子分析并写明这一点。
- 任务生命周期：主会话空闲但仍有回报未到时任务不结算，活动显示「等待后台子分析回报 · 名称 正在分析」，期间用户追加的 follow-up 照常立即送达。卡片由投递请求与回报任务读出子分析对这条消息的过程与结论（复用协作成员卡片与工作区成员页），子分析工作时每秒刷新；停止的消息显示未完成且不回报。
- 跨任务常驻：任务结束时把每个子分析压缩成「请求＋最终答复」（去掉工具调用与推理，保留最近 6 轮、单条答复 8000 字、总计约 6 万字符）写入 `checkpoint.background`；下一个接续该上下文的任务（与 `checkpoint.messages` 同一条件）在初始化时重建这些子分析，它们记得此前的任务与结论，命盘引用在同一对话内照常可用。上下文由聊天记录重建（编辑、重新生成、上一任务未完成）时不带子分析。
- 计费：子分析的模型调用计入任务用量，整项任务仍只扣一次积分。

同时修正：协作成员拿不到本体系延迟工具（见阶段三）；计划模式提示词段只对持有 `submit_plan` 的主会话出现，成员不再看到；成员或子分析自身的压缩不再记入回答的压缩记录；`parallel_analysis` 描述去掉已删除的「选择最终成果」。

### 阶段八验证

| 验证 | 结果 |
| --- | --- |
| `agent-background.test.ts` | 子分析与主 Agent 并行、任务等待回报并显示等待活动、回报只到一次、卡片显示过程与结论、成员工具边界（含延迟详查）；下一任务重建常驻子分析并接续记忆；停止不回报、解散不保留；3 个上限、未知名称、缺少体系与 8 条上限；中断后恢复只投递一次、只回报一次；展示与工作区 |
| `agent-plan-mode.test.ts` | 批准前阻断 `background_agent` |
| `agent-domain-features.test.ts` | 协作成员获得本体系的延迟工具 |
| `pnpm test` | 2032 项通过 |
| `pnpm test:browser` | 298 项通过；新增仅剩后台子分析时的活动行、步骤打开子分析页（任务与已做调用）、回报后显示结论；修正盘面焦点检查的悬停竞态（点过日干后指针停在盘上，悬停优先点亮，偶发失败），检查前先移开指针 |
| `pnpm lint`、严格类型、`node scripts/build-agent-worker.mjs` | 通过（无新增告警） |
| 本地验收（2026-10-21，`taibu-agent-1006b`） | 通过：派出后先作答、等回报整合、下一轮 `send` 时子分析记得上一轮结论、两轮各扣一次（演示模型按「Agent验收：后台子分析」走该流程） |

## 阶段九：任务树调试面板

管理员排障需要看到一项任务实际跑了什么：哪次模型调用发起了哪些工具、谁在等谁、协作成员和后台子分析在各自会话里做了什么、哪一步因为什么失败。Pi 1.3.0 的 `harness.taskGraph()`／`watchTaskGraph()` 只给出仍在运行的任务，且不含检查点与结果，任务结束或失败后就看不到了；它也只存在于持有租约的 worker 进程里。因此面板不读 worker 的内存，而是从每项任务已持久化的原生提交日志重建完整任务树，worker 不做任何改动、不增加写入。

- 迁移 `20261021_100000_agent_admin_task_log.sql` 新增只读函数 `agent_admin_task_log(p_run_id, p_after)`：`SECURITY DEFINER`、固定 `search_path`，先经 `agent_require_admin()` 校验管理员，按序号每页返回 200 次提交及其时间。每条写入保持原形状，只保留任务树需要的内容：会话原样；任务去掉 memos（提问与回复、摘要等）；提交只有状态与请求 ID（Pi 的提交记录本就不含正文）；助手条目只留工具调用的 ID 与名称；用户与工具结果条目、文档写入不返回。日志表仍对客户端角色关闭，worker 照旧经租约读取。不改表、列、策略或索引（主键 `(run_id, sequence)` 支撑分页），无需回填。
- `admin-tasks.server.ts` 的 `buildAgentTaskTree` 按「每条写入替换整条记录」取每个任务、会话与提交的最新状态：任务挂在持有它的任务下，会话持有的任务挂在会话下，任务创建的会话（协作成员、后台子分析）挂在该任务下。工具任务的工具名取自其助手条目里的调用，脚本内调用取自嵌套调用本身；回报任务带上子分析名称，子分析会话按回报任务的输入命名。读不到持有者的记录（日志超过一次读取上限时）仍显示在所属会话下。一次最多读 1 万次提交，超出时标明只显示开头。
- 接口：`GET /api/admin/agent-runs`（`scope=active` 进行中／`recent` 最近，新的在前，最多 50 条；`q` 为完整的任务、对话或用户 UUID 时不限状态，非 UUID 直接拒绝）与 `GET /api/admin/agent-runs/:id`（概况与任务树）。均先 `requireAdminUser()`，再经 `getSystemAdminClient()` 读取 `agent_runs`（既有 RLS 允许管理员）与任务日志；账号邮箱经既有 `admin_get_auth_user_emails` 读取，失败时只省略邮箱。
- 界面：设置中心 › AI 服务新增子页「Agent 任务」（`AgentTaskPanel`）。列表显示状态、标题、模型、用户与更新时间；任务详情显示 ID、配置、worker 与 fence、租约、计费，以及任务树：每个任务的标题（模型生成及重试次数、工具／脚本调用名、上下文压缩、后台子分析、后台回报）、编号、状态与阶段、`等待 #id`、请求的模型、耗时或已运行时长、后台／已请求中止／重启后放弃等标记和失败原因，会话下列出各输入的请求 ID 与状态（未答复时附原因与 Pi 的说明）。「只看未结束」只保留未结束的任务及其上层，即 Pi 的实时 `taskGraph`。进行中的列表每 5 秒、进行中任务的树每 3 秒刷新；子页隐藏或浏览器标签页不可见时停止轮询，任务结束后停止刷新。
- 自托管：迁移 SHA256 `e8047ae94b905454941103ffb354e96dd793a9955981d188ebf0c25b744f39cc`，升级目标指纹 `2e4f0aa1231713b4e40f2662ad5bc4068b4aa190526533ed15174004cf64b388`；既有已审查路径（含 `3835fe3c…` 命盘保存基线）按顺序追加本迁移，未知基线仍拒绝。

### 阶段九验证

| 验证 | 结果 |
| --- | --- |
| `agent-admin-tasks.test.ts` | 真实任务的日志（经与迁移相同的裁剪）重建出主会话下模型调用持有的 `bazi`／`background_agent`／`parallel_analysis`，协作成员与后台子分析各自会话中的调用、请求 ID 与回报任务，全部结束、各有耗时；读到一半的日志里模型调用等待它发起的工具；手写日志覆盖最新写入生效、脚本调用、失败／异常／中止原因、重启放弃、分支会话、未答复说明与读不到持有者的记录；列表接口的范围、查找与邮箱缺省，非管理员与非完整 ID 在读取前被拒，任务树分页读取、任务不存在 404、读取失败 500 |
| `pnpm test:db` | 67 项通过；新增：管理员读取裁剪后的日志（只留工具调用 ID 与名称、去掉 memos、不含工具结果与文档写入），任务结束后仍可读，200 条分页，负游标与非管理员被拒，日志表对用户仍不可读 |
| `pnpm test:browser` | 307 项通过；新增 9 项：列表读进行中任务，工具调用挂在等待它们的模型调用下，成员与子分析会话挂在持有它们的任务下，失败原因与未答复输入，「只看未结束」，进行中自动刷新、结束后停止，非完整 ID 不发请求，完整 ID 查找 |
| selfhost schema／stack | 34 项通过（引用的 RPC 由 61 增至 63：任务日志与账号邮箱） |
| `pnpm test` | 2037 项通过 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |
| 本地验收（2026-10-21，`taibu-agent-1006b`） | 通过：普通用户读管理员接口得 403；管理员在「Agent 任务」按对话 ID 找到后台子分析任务，任务树列出主会话、`background_agent` 调用、子分析会话与回报，且没有失败 |

## 阶段六至九的本地验收

`pnpm local:update` 以当前代码重建固定栈 `taibu-agent-1006b`（应用 1.3.0、命盘保存与任务日志迁移），随后 `scripts/tests/agent-selfhost-browser.mjs` 全部通过：真实登录与跨命盘工具调用、盘面存入命盘库与一次扣费、重新生成与编辑续跑、等待补充、停止退款、worker 崩溃后租约接管、`/compact`、后台子分析、管理员任务树、全体系命盘联动、多模型协作与普通对话回归，浏览器无外部请求、服务端 5xx 或运行时异常（共 12 个任务）。首轮失败在一条过时断言：阶段六去掉「选择最终成果」后，跨命盘对比只剩两次排盘，脚本仍要求至少三个步骤，已改为恰好两个。

## 阶段十：方法卡

此前解读知识分三处各写一套：Agent 读 11 份 `interpretation/*.md` 解读指引，普通对话的人格各有手写提示词，盲派与周公解梦只存在于对话人格；经 MCP 或 skill 调用太卜的其他 AI 只拿到盘面，不知道该怎样断。本阶段把解读知识收拢为一套方法卡，一处书写，多处使用。

- 来源：`skills/taibu-divination/methods/<id>.md`，共 13 张。每个体系一张与体系同名的默认卡（子平八字、紫微斗数、六爻、梅花易数、奇门遁甲、大六壬、小六壬、太乙神数、塔罗、西方占星、黄历择日），另有流派卡「盲派八字」（`bazi-mangpai`）与不需排盘的「周公解梦」（`dream`）。每张卡由 frontmatter（name、title、system、version、description）与固定四节组成：角色、断法、工具流程、输出要求；description 同时写「是什么」与「何时用」，供目录路由。SKILL.md 的「约定」与新增的「解读通则」为各卡共用。
- 内容按经典与流派资料重写，断法写成可执行的判断次序：子平卡以《子平真诠》月令定格、顺用逆用为纲，再论扶抑、调候、通关、病药，用神、喜神、忌神分开写；盲派卡按段建业一系的宾主、体用、做功方式与效率、五种结构、象法与应期「到位」，不以日主旺衰定喜忌，并注明 Core 盘面不列拱合、暗合与墓库，用到时须说明取法；解梦卡以《周礼》六梦、《潜夫论》十梦辨梦之类，按梦书取象、多说并存，落到做梦者自身处境，参照弗洛伊德、荣格的心理学视角，不渲染恐惧，噩梦反复、失眠或与创伤相关时建议就医或心理咨询。
- 生成：`scripts/build-methods.mjs`（`pnpm build:methods`；`pnpm check:methods` 只检查漂移）严格解析每张卡：字段齐全且不重复、name 与文件名一致、体系已登记、版本为 semver、一级标题与 title 一致、四节按序且非空、排版可逐字还原。它写出 `packages/core/src/mcp/methods.generated.ts` 与 SKILL.md 的方法卡目录。体系登记表（每个体系的 Core 工具，排盘工具在前）也在这里；测试保证 24 个 Core 工具各属一个体系、每个体系都有默认卡。
- Core（`taibu-core/mcp`）：`listAnalysisMethods`、`findAnalysisMethod`（卡 ID 或该体系任一工具名，后者得到默认卡；`__proto__` 之类的继承键不会命中）、`getToolSystem`、`renderMethodGuide`（整张卡）、`renderMethodPersona`（去掉工具流程；`brief` 只留角色与输出要求）、`listMethodPrompts`／`renderMethodPrompt`（阶段十一的 MCP prompts）。
- skill：工具表最后一列改为各工具所属体系的默认方法卡，「方法卡」一节列出全部卡及适用场景；skill bundle 随之重新生成。
- Agent：方法目录按当前提供的工具列出可加载的卡及其工具，主 Agent 另列周公解梦（早报只列需要排盘的卡）。每个体系首次解读前须用 `load_analysis_method` 加载对应卡；同一体系有多张卡时按用户点名的流派选，未点名用默认卡。协作分析与后台子分析的 `system` 改为卡 ID，子平与盲派可以各开一个成员；成员只拿到卡所属体系的工具，周公解梦不需要工具，不能作为成员。工作区把「解读指引」改称「方法卡」。
- 普通对话：有卡的 10 个人格（八字、盲派、紫微、解梦、塔罗、六爻、奇门、大六壬、梅花、小六壬）直接用卡的角色、断法与输出要求，再加原有的安全红线；通用、MBTI 与合盘没有卡，保留原提示词。完整卡比原手写提示词长 2–5 倍（约 215–870 token），对话提示词预算却多为 4000 token（推理模型可低至 2400，下限 1000），人格属于必注入层，过长会挤掉盘面和用户 @ 的资料。因此人格层最多占预算的一半：多人格拼接或小预算下超出时改用各卡的精简版（角色与输出要求，约 75–210 token）。盲派人格仍注入日柱口诀数据；删除未被调用的 `generateMangpaiPrompt`。
- 不兼容：删除 `skills/taibu-divination/interpretation/`、`scripts/skill-guides.mjs`、`scripts/build-analysis-methods.mjs` 与 `src/lib/agent/analysis-methods.generated.ts`。`list_analysis_methods` 与 `/api/agent/methods` 由每个工具一条改为每张卡一条（带 `system` 与 `tools`）；`load_analysis_method` 返回卡 ID（按工具名加载时返回所属体系的卡 ID）、新标题（如「子平八字」）与新版本（重写的卡为 2.0.0，新卡为 1.0.0），指定旧版本 1.0.0 加载会被拒绝。历史消息中已加载的指引按当时存下的结果显示。

### 阶段十验证

| 验证 | 结果 |
| --- | --- |
| 方法卡测试 | `scripts/tests/method-cards.test.mjs`：卡的解析与 CRLF、各类格式错误被拒并指明文件与原因、共用段落提取、产物与 SKILL.md 目录无漂移；`packages/core/tests/method-cards.test.mjs`：工具归属唯一、默认卡齐全、按 ID／工具名查找与继承键拒绝、整卡与人格（不含工具名）及精简版、MCP prompts 的参数与正文 |
| Agent 与对话测试 | 方法卡逐张加载与版本校验、工具名得到默认卡；目录按工具过滤、流派卡与解梦的列出规则、早报不列解梦；协作与后台成员用卡 ID（含盲派）；人格超出预算时改用精简版，最小预算下盘面仍注入 |
| `pnpm test:browser` | 307 项通过（工作区方法卡视图改由 Core 方法卡生成） |
| `pnpm test` | 2046 项通过 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |

## 阶段十一：MCP 的方法卡与精简工具列表

经 MCP 调用太卜的其他 AI 只拿到盘面；站内 Agent 的「按需加载」能否用到 MCP 也需要答复。MCP `2026-07-28` 规范有两条约束：prompts 由用户选用（客户端通常显示为斜杠命令），模型不能自己取；`tools/list` 返回当前提供的全部工具，且不得随连接或其他请求变化，因此不能像 Agent 那样「搜索后把工具加入列表」。按需加载在 MCP 里只能由客户端在本地做（Claude Code 的工具搜索即是），或由服务提供一个固定的精简列表。

- 方法卡：两个 MCP 服务都为 13 张卡各注册一个同名 prompt（可选参数 `question`），并提供模型可调用的工具 `load_analysis_method`（卡 ID 或工具名，返回卡全文、解读通则与工具约定；未知 ID 为 `isError`）。服务说明提示模型解读前先加载方法卡；`prompts/list` 带公共缓存提示。工具定义与正文都来自 Core 的 `getMethodToolDefinition`／`renderMethodCard`。
- 精简列表：stdio 设 `TAIBU_MCP_TOOLS=core`（默认 `all`；其他取值拒绝启动并说明原因），HTTP 用入口 `POST /mcp/core`（入口由服务端写入私有请求头，客户端发来的同名头被覆盖）。精简列表只有 11 个排盘工具、`load_analysis_method`、`tool_search` 与 `tool_call`：`tool_search` 用与 Agent 相同的中文排序查找其余 13 个低频工具，返回完整说明与参数 schema；`tool_call` 只接受这 13 个工具，经与直接调用相同的处理（地点解析、随机种子作用域、规范输出）。给模型看的工具说明由约 6.4 万字符降到 2.7 万字符。两种列表各自固定，符合「不随其他请求变化」。
- 共享：`tool_search` 的排序（关键词、CJK 二元词与名称／标题／关键词／描述打分）从 Agent 移入 Core（`rankDeferredTools`），Agent 改为引用；延迟工具名单在 Core 为 `DEFERRED_TOOL_NAMES`，Agent 的 `AGENT_DEFERRED_TOOLS` 需保持浏览器可用而保留副本，测试保证两者一致。
- 版本：`taibu-mcp-server` 升至 3.2.0（不发布）；`taibu-core`、`taibu-mcp` 仍为未发布的 3.7.0。公网服务需按既有流程重新构建镜像后生效；Caddy 反代整个主机，`/mcp/core` 无需改代理配置。

### 阶段十一验证

| 验证 | 结果 |
| --- | --- |
| Core 测试 | `tool-search.test.mjs`：13 个延迟工具均为 Core 工具且不含排盘工具、模式解析与非法值拒绝、服务说明随模式变化、搜索只返回延迟工具的完整定义（含服务端修饰过的定义）、`tool_call` 只接受延迟工具、搜索结果含参数 schema；`method-cards.test.mjs` 新增方法卡工具（列出全部卡及流派、无需排盘标注，工具名得到默认卡，继承键被拒） |
| stdio 运行时 | 默认列出 24 个工具与 `load_analysis_method`，声明 prompts 能力；13 个 prompts 与 `prompts/get`（问题、未知 prompt 报错）；按工具名加载默认卡、未知 ID 为 `isError`；`core` 模式的列表、中文搜索与无匹配、`tool_call` 调用 `bazi_dayun`、拒绝已列出工具与不合法参数；非法模式拒绝启动 |
| HTTP 运行时 | `/info` 列出两个入口；`/mcp` 的 prompts、`prompts/get` 的 `Mcp-Name` 校验、方法卡工具；伪造私有头不能切换列表；`/mcp/core` 的说明、列表、搜索、`tool_call` 与旧协议客户端得到同一列表 |
| `pnpm test` | 2055 项通过 |
| `pnpm test:browser`、npm 包产物、skill bundle | 307 项通过；产物检查通过；bundle 重新生成后无漂移 |
| `pnpm lint`、严格类型 | 通过（无新增告警） |
