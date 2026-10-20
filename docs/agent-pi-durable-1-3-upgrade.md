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
