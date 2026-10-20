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
- 可调用范围由工具的 `callers` 决定。`AGENT_MODEL_ONLY_TOOLS`（提问、计划、查看与定位盘面、联网与知识库检索、附件、方法、长期记忆、协作、选择最终成果）与 `parallel_analysis` 声明 `callers: ['model']`，脚本调用时 VM 报「does not exist」。其余工具（排盘、计算、详查、个人资料、外部 MCP）可被脚本调用。
- 排盘、计算与详查声明 `structuredOutputSchema`，脚本拿到 `{ artifactId?, text, data }`：`text` 为 Core 规范文本，`data` 为规范 JSON，`artifactId` 为暂存成果，仍须经 `select_final_artifacts` 选定。其他工具给脚本有界文本。
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

排查中发现两点（不属于本阶段）：

- 运行时在模型未选定最终成果时以 `onYield` 续跑，没有次数上限；模型若始终不调用 `select_final_artifacts`，任务会持续请求模型。脚本化测试据此先选定成果再作答。
- Agent 以公历 `date` 调用 `xiaoliuren` 必然失败：Pi 按 schema 补入 `isLeapMonth: false`、`leapMonthStrategy: 'repeat'` 默认值，Core 将其视为手工农历输入而拒绝。
