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
- 延迟只影响模型是否被提供该工具：`callable` 仍包含它们，因此代码模式脚本可以直接调用，无需先加载（有回归用例）。协作成员的 `tools` 是显式数组，数组中的延迟工具照常提供。
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
| 本地验收 | 崩溃恢复对话上经命令菜单发送 `/compact`，任务免费完成且不调用工具 |
