# 基础组件设计规格与线框

> 状态：组件设计稿 v1，基础实现已建立；设置中心、后台管理、通用业务页、聊天与浮层已迁移到共享组件。`src/components/ui` 之外不再有原生 `<button>`、原生 `select`、文本 `input` 或 `textarea`，领域控件只保留测量过的视觉类。组件的实际可用 API 以 `src/components/ui` 当前源码为准；规格与实现尚未一致、需要设计裁决的项集中在 [§21](#21-已知缺口与待决事项)。
>
> 视觉约束：保留太卜当前 claude.ai 对齐风格、中文内容、明暗主题、发丝边界和陶土强调色。基础行为可采用 shadcn 源码组合与 Base UI，但不得带入默认皮肤。

## 0. 迁移现状

已落地并可直接复用（源码在 `src/components/ui`，全部基于 Base UI + taibu 令牌）：

| 层 | 组件 |
| --- | --- |
| 动作 | `Button`（primary/secondary/ghost/danger，xs–lg，`loading`/`loadingText`，`unstyled` 保留领域尺寸）、`IconButton`（ghost/secondary，`tone`，必填 `label`）、`FilterChip`（`pressed` 筛选胶囊） |
| 表单 | `Field`、`Input`、`Textarea`、`Select`、`Switch`、`Checkbox`、`RadioGroup`、`SegmentedControl` |
| 导航与标记 | `Tabs`、`SegmentedControl`（radio/toggle/tabs）、`Badge`、`BetaBadge`、`Skeleton` |
| 浮层 | `Dialog`、`ConfirmDialog`、`Popover`、`Menu`、`Tooltip` |
| 反馈 | `Toast`（沿用 `useToast` 调用方式）、`SoundWaveLoader`、`StatePanel` |

已迁移区域：

- 设置中心与后台：通用、命盘、记忆、协作、个人资料、会员、知识库、分享链接、AI 模型与网关、公告、激活码、Agent 任务/测评/性能/角色/策略/定时限额、MCP 与技能管理。
- 通用业务操作：认证补全（改密）、命理记录与详情、分享链接、社区列表/发帖/评论（颜色改为语义令牌，分类与排序改用 Select）、通知页、定时任务页、合盘入口、历史列表与详情、每日问答、页头与移动导航的通用按钮。

保留既有实现（有意例外，不是遗漏）：

- **claude.ai 对齐的聊天视觉**：`ChatHeader`、`ComposerToolbar` 的标题、分享、发送/停止键与工具行沿用实测几何；它们已使用共享 `Menu`、`IconButton`、`Button` 或受控 `MenuTrigger`，只保留专用尺寸与配色类。
- **盘面与占术专用控件**：盘面格子、星曜、塔罗牌、六爻铜钱、择日/合盘领域选择器、`FortunePeriodNav`、`UpgradePanel` 卡片 CTA。定时任务编辑器的字段已统一到 `Input`/`Textarea`/`Select`。
- **会话与工作区内容行**：会话行、任务队列、工具结果、问询选项按内容密度维护；多数行内图标动作与菜单入口已使用共享 `IconButton`/`MenuTrigger`，容器与排版仍是领域组件。
- **登录/注册弹窗**：`AuthModal`/`LoginForm` 使用独立 `auth-*` 视觉与键盘路径。
- **结果页工具条**：八字/紫微结果页的桌面与移动动作条按已测量规格维护。
- **行内编辑与集成搜索框**：断事笔记的密集属性行、会话行内重命名、消息内联编辑、composer/Agent 输入、带图标的搜索框（会话搜索、记忆搜索、工作区标签、历史与记录筛选）使用 `Input`/`Textarea`，通过 className 保留与所在行/壳共享的焦点环、内衬和尺寸。
- **复合筛选与目录控件**：管理台筛选胶囊、AI 维度 chip、会员层级 chip 使用共享 `FilterChip`（保留 `settings-filter`/`settings-chip` 几何）；AI 目录整行入口、设置页 FAQ 折叠标题、设置导航条目与移动遮罩、`SettingsTabs`（滑动指示器与外部 tabpanel id 契约），以及定时任务的模板卡、频率分段、星期与变量 chip 属于复合控件或结构性元素，保留领域实现并使用语义令牌。
- **表格与卡片行内动作**：测评/任务表的文字链动作、图表卡片的「设为默认 / 删除」、通知与公告行。点击区域由行容器决定，使用 `Button` 的 `ghost` 或 `unstyled` 外观保留命中区与排版。
- **底部导航抽屉**：`MobileNav` 的「全部占术」是底部导航面而非模态内容，保留固定层、滑入动画与 `inert` 控制；内部按钮、搜索和关闭动作使用共享 `Button`/`IconButton`/`Input`。
- **输入与选择**：文本、搜索、日期与时间统一使用 `Input`，多行使用 `Textarea`，复选使用 `Checkbox`，单选使用 `RadioGroup` 或 `FilterChip`；仅隐藏的文件选择器保留原生 `input[type=file]`。


已完成的关键收敛：

- 浮层：原 `FloatingPanel` 已删除；聊天标题菜单、会话行菜单、筛选菜单、`+` 菜单及其子菜单、运行模式、模型/努力程度/协作、分享、用量、全部占术、视图选项全部改用共享 `Menu`/`Popover`，并保留 claude 字母快捷键（`letterShortcuts`）与对话框内 portal。
- 表单：全站不再有原生 `<select>`、文本 `<input>` 或 `<textarea>`；设置/后台/表单统一 `Field + Input/Textarea/Select`，复选/单选使用共享控件。
- 对话框：业务只通过 `Dialog` 打开，`Modal` 仅作为其内部的 top-layer 表面，不再由业务直接导入。结构化模式统一标题、说明、关闭键、页脚与 busy；`bare` 模式保留工作区/编辑器实测外壳，类型上必须传 `labelledBy`。现状是业务里的对话框全部使用 `bare`，结构化模式只有组件测试在用，`ConfirmDialog` 也仍是自有外壳——收敛方向见 §21。
- 按钮：`src/components/ui` 之外不再有原生 `<button>`；通用动作、图标动作、菜单项进入 `Button`/`IconButton`/`MenuItem`，测量过的聊天几何与领域卡片使用 `Button unstyled` 保留专用样式类。
- 定时任务：关闭、取消、保存、运行开关、模板与频率选择均已进入 `IconButton`/`Button`/`Switch`/`SegmentedControl`；星期和变量 chip 保留领域样式但使用共享按钮语义。
- 反馈色：侧栏、签到、历史、分享卡入口等警告/错误条统一改用 `warning`/`danger` 令牌，不再写死暖黄或红色十六进制。
- 通用页 CTA：错误边界、命理记录、MBTI 开始、六爻生成、社区帖子重试与关闭动作改用共享 `Button`/`IconButton`。

未迁移区域的新增通用控件仍应使用共享组件；专用控件只在明确记录原因时使用原生元素。站点其余页面在后续变更中按依赖顺序继续收敛，不要为保留旧外观复制组件。

`pnpm lint` 的架构守卫会拒绝在 `src/components/ui` 之外直接导入 `@base-ui/*`、导入 shadcn 默认主题、重新引入原生 `<button>`/`<select>`、恢复旧 `settings-button*` class、在共享浮层之外直接 `createPortal`，以及通用 TSX 中的 Tailwind palette、字面 hex、rgb/rgba 阴影色（图表、分享卡、品牌图标和浏览器主题色按文件豁免，例外在守卫脚本中逐个列出）。新增基础行为先扩展共享组件。

浮层嵌套：`Select`、`Menu`、`Popover`、`Tooltip` 的弹层会检测最近的 `dialog` 或 `role="dialog"` 容器并挂到其中，避免被原生 top-layer 或 Base UI 对话框遮挡；分离触发器（`createMenuHandle`）也会在打开事件里从触发元素解析容器。在对话框里新增浮层时不需要再手写 portal 容器。claude 字母快捷键传 `MenuContent letterShortcuts`，只在本层面板生效，禁用项不响应。

原生模态框打开后，它之外的整个文档都是 inert 且被遮罩压在下面，提高 z-index 也没用。`Toast` 因此在有模态框打开时挂进最上层对话框（`Modal` 导出的 `useTopModal`）；新增任何全局浮层都要同样处理。Tooltip 的分组延迟依赖应用根部唯一的 `TooltipProvider`（已挂在 `ClientProviders`），组件内部不要再包 Provider，否则每个提示各成一组、相邻提示无法立即显示。

按钮与链接：导航使用 `Link`/`<a>`，复用 `buttonVariants()`/`iconButtonVariants()` 得到按钮外观，不要用 `Button render={<Link/>}` 代替链接（会失去链接语义）。`Button` 的 `loading` 拦截 click——这同时取消了 Enter 触发的隐式表单提交——并暴露 `aria-busy`，但不设原生 disabled，焦点留在按钮上；不要为 loading 再传 `disabled`，那会把焦点丢到 body。`disabled` 只表达「当前不可用」。`IconButton` 的默认 8px 触控扩展会覆盖相邻图标按钮，整行可点等场景传 `expand="none"` 自行定义伪元素。

类名合并统一用 `src/lib/utils.ts` 的 `cn()`（clsx + tailwind-merge）。模板字符串拼接无法去掉冲突的 Tailwind 类，调用方传入的覆盖不可靠。

## 1. 设计意图

太卜的主要界面同时容纳命盘、古文、数据与流式对话，信息本身已经足够复杂。外围控件应当像纸面上的编辑工具：清楚、克制、容易预测，不与内容争夺注意力。

组件族只保留三种视觉层级：

1. **当前动作**：陶土实色，只给主操作、当前选中或关键焦点。
2. **可操作表面**：白/深色表面加发丝边界，用于输入、次按钮和浮层。
3. **安静动作**：无边界 ghost，用于工具栏、行内操作和低频次命令。

不通过渐变、玻璃拟态、夸张圆角和层层卡片制造“设计感”。 memorable 的部分应当是命盘与内容，而不是每个按钮。

### 第一轮范围

| 分组 | 组件 | 优先级 |
| --- | --- | --- |
| 动作 | Button、IconButton | P0 |
| 表单 | Field、Input、Textarea、Select、Switch、Checkbox、RadioGroup | P0 |
| 导航与标记 | Tabs、Badge | P0 |
| 浮层 | Dialog、ConfirmDialog、Popover、Menu、Tooltip | P1 |
| 反馈 | Toast、StatePanel、Loading/Skeleton | P1 |

本轮**不设计**万能 Card、通用 DataTable、全功能 Form 框架、DatePicker、图表原语或命盘原语。它们需要独立业务规格，不能为了凑齐组件库而提前抽象。

## 2. 共用几何与状态

### 2.1 尺寸密度

不同区域保留不同密度，但只能使用以下刻度：

| 用途 | 高度 | 典型位置 |
| --- | --- | --- |
| 微型工具 | 24px | 会话头、消息操作、行内图标 |
| 紧凑工具 | 28px | 聊天标题、工作区工具栏 |
| 常规控件 | 32px | 菜单项、composer、紧凑按钮 |
| 表单控件 | 38px | 设置页输入、Select、主要按钮 |
| 大字段 | 42px | 登录、独立表单的大输入框 |

不为单个页面增加 34、36、40、44px 等相邻尺寸。当前 40px 对话框按钮在实现迁移时收敛到 38px；这项是明确的尺寸统一，不是视觉重写。`SegmentedControl` 的轨道目前是 40/44px（含 4px 内衬，段高 32/36），与本表不一致，见 §21。

### 2.2 形状与文字

- 24–32px 工具：圆角 6–8px；38–42px 表单：圆角 10px；Dialog：14px。
- 常规控件文字 14px/20px；紧凑辅助动作 13px/18px；大字段 15px。
- 图标常规 16px，菜单前导图标 16–18px，独立工具图标 16–20px；同组保持同一视觉大小。
- 主按钮字重 500，次按钮与 ghost 400–500；不使用全大写英文和宽字距标签。
- 内边距随尺寸变化：24/28px 工具以图标为主；32px 按钮水平 12px；38px 按钮水平 14px；输入水平 12px。

### 2.3 焦点

焦点颜色由上下文令牌控制，不为每个页面新增组件变体：

- 默认：`--accent`，2px outline，offset 3px（`globals.css` base 层）。对话框里不再另设焦点规则：原 `.app-modal :where(...)` 的 2px outline 是未分层 CSS，会压过组件自己的焦点样式，已删除。
- 设置中心：使用 `--foreground-secondary`，延续当前中性焦点。现状只改了 outline 颜色；共享字段的焦点色取 `--control-focus`，要中性就在容器上设 `--control-focus: var(--foreground-secondary)`，见 §21。
- 字段（`Input`/`Textarea`/`Select` 触发器）：聚焦时 0.5px 边框与 1px 外圈 outline 同为 `--control-focus`（默认 `--accent`），合计约 1.5px，对比明显强于未聚焦的 10% 发丝线；`aria-invalid` 时边框与聚焦外圈都换成 `--danger`。外圈用 outline 而不是 box-shadow：嵌在行内或壳内、已写 `outline-none` 或领域 `outline: none` 的输入会自动不画外圈。
- 分段与标签（`SegmentedControl`/`Tabs`）：沿用全局 outline，但 offset 为 0，焦点框落在轨道内衬里，不溢出轨道。
- 浮层容器本身获得程序焦点时不画外框，容器内可操作项仍必须有清晰焦点；Menu/Select 的当前项用高亮底色表示，不画 outline。

### 2.4 状态表达

| 状态 | 表达 | 禁止 |
| --- | --- | --- |
| hover | `--fill-ghost-hover` 或语义 hover 色 | 同时位移、缩放、加阴影 |
| pressed | 稍深填色，60–120ms（共享按钮尚未实现，见 §21） | 大幅缩小按钮 |
| 展开 | 菜单/弹层打开期间触发器保持 hover 外观（Base UI 的 `data-popup-open`） | 菜单还开着触发器已恢复常态 |
| 开启（`aria-pressed`） | ghost 按钮为 `--accent-soft` 底 + 陶土字 | 只换图标不换底 |
| selected | `--fill-ghost-selected` + 勾选/状态属性 | 只改变文字颜色 |
| disabled | 按钮、开关、选项 50% 不透明；字段改为禁用底色与弱文字，不靠透明度 | 仅用灰色且无原因 |
| loading | 高度不变、内联 loader、状态文案 | 用 spinner 替换整个按钮导致跳动 |
| invalid | danger 边界 + 字段错误说明 | 只把边框变红 |

原生 disabled 用于不可用状态；异步提交中的 loading 可使用 `aria-disabled` + `aria-busy` 并拦截重复激活，让焦点留在原按钮上。loading 时 loader 加在文字前，`loadingText` 也可能与原文字不等长，所以按钮宽度会变；按钮位于底栏这类会推动相邻控件的位置时，由调用方给它固定 `min-w`。

## 3. Button

### 3.1 形态线框

```text
Primary       Secondary       Ghost          Danger
╭──────────╮  ╭──────────╮                   ╭──────────╮
│ 保存更改 │  │ 取消     │    返回设置       │ 删除命盘 │
╰──────────╯  ╰──────────╯                   ╰──────────╯

Loading（高度不变；宽度会变，底栏里由 min-w 兜住）
╭──────────────╮
│ ))) 保存中…  │
╰──────────────╯
```

### 3.2 变体

| variant | 表面 | 用途 |
| --- | --- | --- |
| primary | `bg-accent / text-on-accent`，hover 用 `--accent-hover` | 一个操作区唯一主行动 |
| secondary | `--surface` + hairline，hover 边框加深并叠 `--fill-ghost-hover` | 取消、返回、普通操作 |
| ghost | 透明，文字次级，hover 填色；`aria-pressed` 为陶土淡底 + 陶土字 | 工具栏与低频操作 |
| danger | `--danger-fill` 实色 + `--on-danger` 文字（明暗同值）；danger 文字的图标动作用 `IconButton tone="danger"` | 删除、重置等破坏性操作 |

不增加 outline、soft、link、gradient 等重复变体。导航使用 Link，样式可复用 Button 外观，但保留链接语义。

尺寸阶梯 xs 24 / sm 28 / md 32 / lg 38px，圆角依次 6 / 7 / 8 / 10px（cds Button 实测阶梯，lg 取表单控件圆角）。loading 的音浪跟随按钮文字色（`SoundWaveLoader tone="current"`），实色按钮上也看得见。`--danger` 在暗色主题是浅粉文字色，不能直接作按钮底，所以实色另设 `--danger-fill`。

### 3.3 逻辑接口

核心属性：`variant`、`size`、`loading`/`loadingText`、`disabled`、`unstyled`、`type`、children、原生 button 属性与 ref。图标-only 不使用 Button，改用 IconButton。

### 3.4 行为与边界

- 默认 `type="button"`；只有明确提交表单时才为 submit。
- loading 文案与最终动作一致：“保存更改”→“保存中…”；Toast 再用“已保存”。
- 长标签允许换行仅用于对话框底部窄屏；工具栏按钮单行省略并保留完整可访问名称。
- 主操作区同时出现 primary + danger 时，应重新判断信息层级，通常只保留一个强调动作。
- 验收：Enter/Space、表单提交、loading 防重复、焦点保留、暗色对比、320px 操作区。

## 4. IconButton

```text
默认          hover/focus            带 Tooltip
  ⋮              ╭───╮                 ┌ 更多操作 ┐
                 │ ⋮ │                    ╭───╮
                 ╰───╯                    │ ⋮ │
                                          ╰───╯
```

- 视觉尺寸 24/28/32px；触屏有效区域通过外扩伪元素达到至少 40px，不改变布局。
- 必须提供 `aria-label`；Tooltip 只重复或补充名称，不能成为名称唯一来源。
- 只有 `ghost` 与 `secondary` 两种表面；danger 通过 tone 表达，不另造红色背景变体。
- 图标居中，不用字体符号代替 SVG；同一行不出现不同线宽/网格的图标。
- 圆角随尺寸为 6 / 7 / 8px；菜单或弹层打开时（Base UI 写入 `data-popup-open`）保持 hover 外观，关闭后恢复。Tooltip 打开同样会写这个属性，所以键盘聚焦带 Tooltip 的按钮时也会出现 hover 底色，属于预期。
- `aria-pressed` 切换按钮在 ghost 下显示陶土淡底 + 陶土图标。领域样式类只覆盖了颜色、没覆盖底色时会出现这层底，不需要时在领域类里写明 `background`。
- 验收：无可见文字时名称完整、键盘焦点不偏移、触屏点击区不互相覆盖。

## 5. Field / Input / Textarea

### 5.1 Field 结构

```text
显示名称
╭────────────────────────────────╮
│ 例如：太卜·深入                │
╰────────────────────────────────╯
用于在模型列表和对话中识别。

出生时间
╭────────────────────────────────╮
│ 请输入完整的出生日期和时间     │
╰────────────────────────────────╯
请补充出生时间，才能确定时柱。
```

Field 顺序固定为 `label → control → description/error`。错误出现时替换 description 的视觉内容，但保留稳定关联，不让用户同时读到互相矛盾的说明与错误。

### 5.2 规格

| 项 | Input | Textarea |
| --- | --- | --- |
| 高度 | 38px；独立大表单 42px | 最小 96px，可垂直调整 |
| 表面 | `--surface` + hairline | 同左 |
| 文字 | 14px；大字段 15px | 14px，line-height 1.6 |
| placeholder | `--foreground-tertiary` | 同左，不代替 label |
| 悬停 | 边框加深到 `--border-hover` | 同左 |
| 焦点 | 边框 + 1px 外圈 outline，颜色 `--control-focus`（见 §2.3） | 同左 |
| 错误 | danger 边界 + `aria-invalid` + 错误文本；聚焦外圈也为 danger | 同左 |
| 禁用 | 保留值、不可编辑、说明原因；`--cds-fill-disabled` 底 + `--cds-text-disabled` 字 | 同左 |

`Input`、`Textarea` 与 `Select` 触发器共用 `Input.tsx` 导出的 `fieldClass`（发丝边框、悬停、焦点外圈、invalid、disabled），字段状态只在这一处维护。

Field 提供 `label`、`description`、`error`、`required`、`controlId`、`className`。子元素可以是单个控件，Field 会注入 `id`、`required`、`aria-describedby`、`aria-invalid`；也可以是接收这几项的函数，用于要转发 ref 或组合多个元素的场景。`Select` 接受同名属性，可以直接放进 Field。Input/Textarea 透传原生属性，不封装一套表单状态库。

### 5.3 规则

- 必填用持久文字或明确星号 + 可访问说明，不仅靠颜色。
- 可清空按钮、密码可见按钮放在控件内部右侧，必须有名称，输入右内边距预留空间。
- 不在用户输入过程中把普通格式提示升级为错误；失焦或提交时校验，提交失败后输入时可清除对应错误。
- 数字、日期、时间、时区遵循业务输入语义，不通过 `type=number` 意外接受科学计数法或丢失前导零。
- chat composer 是独立领域编辑器，不套用 Textarea 的默认高度、边框和校验模式。
- 验收：label 点击聚焦、错误关联、自动填充、长中文、200% 缩放、移动端键盘与清空按钮。

## 6. Select

### 6.1 关闭与展开

```text
解读详细度
╭──────────────────────────╮
│ 标准                   ⌄ │
╰──────────────────────────╯

展开（向下空间不足时向上）
╭──────────────────────────╮
│ 简洁                     │
│ 标准                   ✓ │
│ 完整                     │
╰──────────────────────────╯
```

### 6.2 结构

- Trigger：38px、radius 10、左右 12px，值单行省略；外观与焦点同 `fieldClass`；chevron 16px，展开时旋转 180°，reduced motion 下由全局规则直接切换。
- Popup：与 trigger 间隔 4px；宽度不小于 trigger 和 176px 中的较大者，随最长选项变宽，上限 `min(24rem, 100vw - 1rem)`；贴近视口时按 Base UI 默认 5px 碰撞边距翻转或平移。
- 列表：最大高度 `min(18rem, 可用高度)`，内部滚动；选项单行 32px（带说明时上下 6px 随内容增高）、radius 8、文字 14px；高亮用 `--fill-ghost-hover`，与菜单项一致。
- Option：标签 + 可选说明 + 末尾 check；disabled 项不可选但可被发现并读出原因。
- 空值：显示 placeholder，不伪造一个实际值为空的 option。

### 6.3 逻辑接口

`value`（可为 `null`，显示 placeholder）、`onChange`（只在用户选中时调用，不会传 `null`）、`options`、`placeholder`（默认「请选择」）、`disabled`、`required`、`name`/`form`（参与原生表单提交）、`id`、`ariaLabel`、`aria-describedby`、`aria-invalid`、`title`、`hideIcon`、`className`/`popupClassName`。没有 `labelledBy`：可见标签用 Field 或 `id` + `<label htmlFor>`，无可见标签时传 `ariaLabel`。Option 使用 `value`、`label`、`description`、`disabled`；复杂自定义内容走 Combobox/领域选择器，不把任意 JSX 塞进基础 Option 后丢失 typeahead 文本。

### 6.4 行为

- 点击/Enter/Space/ArrowDown 打开；打开后定位到当前选中项，无选中则第一项。
- ArrowUp/Down 移动 active，Home/End 到首尾，字符键 typeahead，Enter 选择，Escape 关闭并还焦。
- Tab 关闭并按自然顺序离开；hover 只更新 active，不直接提交值。
- 页面滚动时重新定位或关闭，行为需全站一致；不允许 popup 停留在旧位置。
- Select 不处理远程搜索、多选和复杂树；这些是未来 Combobox/TreeSelect 规格。
- 验收：禁用项跳过、长选项、向上翻转、暗色、嵌套 Dialog、移动视口、键盘完整流程。

## 7. Switch / Checkbox / RadioGroup

### 7.1 Switch

```text
任务助手记忆                              ╭──────╮
允许 Agent 在后续对话中使用你保存的偏好。 │   ●  │  on
                                         ╰──────╯
```

- 轨道 36×20px、圆形 thumb 16px；off 用 `--cds-switch-track`（明 20% / 暗 10%），悬停加深到 `--cds-switch-track-hover`；on 用 accent、悬停 `--accent-hover`；thumb 明暗都是白色（`--cds-switch-knob`）。不在轨道内加“开/关”文字。
- 用于立即生效的二元设置；保存后才生效的表单项使用 Checkbox。
- 可访问名称为“任务助手记忆”，状态由 `aria-checked` 表达，说明文字不重复进名称。
- Space 切换；button 的 Enter 行为保持可预测。点击整行文字可聚焦/切换时，必须使用真实 label 关联，不能设置整行任意区域都触发。

### 7.2 Checkbox

```text
╭──╮
│ ✓ │  我已确认该命盘可分享到公开社区
╰──╯
```

- 16px 视觉框，外部点击区至少 24px；支持 checked、unchecked、indeterminate。
- indeterminate 只表示父子选择的部分状态，不当作第三种业务值。
- 不用 Switch 替换协议确认，也不用 Checkbox 控制即时页面主题。

### 7.3 RadioGroup

- 单选组只有一个 Tab 入口，方向键移动并选择，Home/End 可选到首尾。
- 普通选项用 16px 圆形标记；字体档位、主题预览卡等使用 `SettingsChoiceCards` 一类组合模式，内部仍保持 radiogroup 语义。
- 卡片 radio 的整块区域可点击，但内部不能嵌套第二个按钮；更多信息放在卡片描述或外部链接。

## 8. Tabs

```text
╭──────────────────────────────────────╮
│ ╭────────╮                           │
│ │  常规  │    个性化      命盘       │
│ ╰────────╯                           │
╰──────────────────────────────────────╯
```

- 容器使用 `--fill-field`；选中块用 `bg-segmented-control-thumb`（明：白；暗：10% 白，比轨道亮，不会像凹进去）+ `--shadow-thumb`（发丝内描边 + 1px 投影）；未选中项透明。`SegmentedControl` 用同一组轨道与滑块令牌，禁用段 50% 不透明，方向键跳过。
- 高度 32px，项 padding 0 12px，radius 6–8px；选中indicator 使用已有 tab motion，不新增下划线样式。
- 只用于同一上下文的面板切换；页面主导航使用导航链接，不伪装 Tabs。
- `tab`、`tabpanel` 有正确 id/aria 关联；非选中 tab 不进入 Tab 顺序。
- 内容即时可见时方向键自动激活；会发起昂贵请求时使用手动激活，Enter/Space 才切换。
- 标签过多时优先重新分组；确需横向滚动要提供可见溢出提示，不能悄悄隐藏最后一项。

## 9. Badge

```text
技能  beta                 轻量 quiet 标记

● 已启用    ● 待审核    ● 已停用      状态 soft 标记
```

Badge 分两种，不再扩张：

| variant | 外观 | 用途 |
| --- | --- | --- |
| quiet | 无背景，9–11px 弱文字；当前 beta 样式 | beta、辅助版本标记 |
| soft | 低饱和语义底 + 状态文字/图标 | 已启用、失败、待处理等真实状态 |

- quiet 不进入可访问名称；入口名称仍读“技能”，beta 可通过描述补充。
- soft 必须有文字，不只有彩点；success/warning/danger 不只靠颜色区分。
- Badge 不可点击。可点击过滤条件使用 FilterChip/Button，不伪装 Badge。

现状：`Badge` 实现为 `quiet` 加五个 soft 色（`neutral`/`accent`/`success`/`warning`/`danger`），业务里还没有调用方；beta 标记仍是独立的 `BetaBadge` + 全局 `.beta-badge`，见 §21。

## 10. Dialog

### 10.1 标准编辑器线框

```text
                    页面内容保持可见但不可交互
             ┌────────────────────────────┐
             │ 编辑技能                ✕ │
             │                            │
             │ 名称                       │
             │ ┌────────────────────────┐ │
             │ │ 八字格局分析           │ │
             │ └────────────────────────┘ │
             │ 说明                       │
             │ ┌────────────────────────┐ │
             │ │ 用于……                 │ │
             │ └────────────────────────┘ │
             │                            │
             │          [ 取消 ] [ 保存 ] │
             └────────────────────────────┘
```

### 10.2 规格

- 宽度：默认 512px，`dialog-sm` 384px（确认类），`dialog-md` 448px，`dialog-lg` 672px（编辑器）；搜索和整盘查看是独立领域形态，不无限增加通用 size。
- 桌面 radius 14、`--surface`、`--shadow-panel-lg`；遮罩为 40% 黑、不做背景模糊。现状：遮罩写在 `overlays.css` 的字面 `rgba(0, 0, 0, .4)`（cds 实测值），`--scrim` 令牌没人用，见 §21。
- 页面边距至少 16px，最大高度 `calc(100dvh - 32px)`；头/正文/底部在内容超高时只有正文滚动。
- 标题使用 18–20px，普通编辑 Dialog 不套大型 serif hero；关闭按钮属于 header，不与内容按钮混排。
- 底部动作右对齐；窄屏可换行但主按钮保持在最后/最容易确认的位置。
- `bare` 保留调用方外壳但仍共享焦点圈定、Escape、遮挡点击与 busy，类型上必须传 `labelledBy`；透明外壳加 `dialog-plain`，窄确认用 `dialog-sm`、常规用 `dialog-md`、编辑器用 `dialog-lg`，移动端贴底加 `dialog-sheet`。需要用户确认后果的警告传 `role="alertdialog"`。

### 10.3 焦点与关闭

- 打开：优先聚焦第一个有效字段；无字段则聚焦标题容器或首个合理操作。
- Tab/Shift+Tab 圈定在 Dialog 内；嵌套 Popover 时焦点可进入其子层但不逃到页面。
- Escape 只关闭最上层；关闭后焦点回触发器，触发器消失时落到相邻合理位置。
- busy 时禁止遮罩/Escape 误关，并明确显示正在提交；不能关闭后仍在后台执行用户以为已取消的写入。
- Dialog 内打开菜单/Select 时保持同一 top-layer 所有权，不能只用更高 z-index 解决。

## 11. ConfirmDialog

```text
╭────────────────────────────╮
│ 删除这份命盘？             │
│                            │
│ 《1994 年 5 月 18 日》将  │
│ 从已保存命盘中移除，相关   │
│ 对话不会被删除。           │
│                            │
│          [ 取消 ] [ 删除 ] │
╰────────────────────────────╯
```

- 标题直接说明结果，不写“温馨提示”“操作确认”。
- 描述包含对象、范围和是否影响关联数据；不使用“此操作不可恢复”替代具体后果。
- 默认 initialFocus 在“取消”，危险动作不能因连续 Enter 被误触。
- 确认按钮写具体动作“删除命盘”；loading 时显示“删除中…”，取消与关闭按 busy 契约处理。
- 对可轻松撤销的低风险操作优先 Undo Toast，不滥用确认弹窗。

实现现状：带操作按钮时是 `role="alertdialog"`（`showActions={false}` 时退回普通 dialog）；`confirmText` 在类型上必填，不再默认“确认”；`variant` 只有 `danger`/`default`；loading 时取消键禁用、确认键显示音浪并拦截重复点击。没有关闭键；打开后焦点落在第一个可聚焦元素（`showModal` 默认行为，没有 children 时就是“取消”）。

## 12. Popover

```text
[ 上下文  2 个命盘 ]
       ╭──────────────────────╮
       │ 本次对话使用         │
       │ 本命：庚午 甲子 …    │
       │ 当前问题：事业变化   │
       │                      │
       │ [ 管理上下文 ]       │
       ╰──────────────────────╯
```

- 用于轻量说明、筛选和短表单，不使用 `role="menu"`；内部按真实内容使用 button/input。
- 默认非模态，打开后焦点策略可为 first 或 none；不自动圈定焦点，除非业务明确是对话。
- Escape、外部点击关闭；有未提交编辑时是否提示由组合层决定，基础 Popover 不擅自弹确认。
- 宽度由内容变体决定，最大不超过 `calc(100vw - 16px)`；方向碰撞时翻转并保持 anchor 可见。
- 长内容、复杂编辑和关键流程改用 Dialog；不在 Popover 内再叠 Popover 形成深层级联。

## 13. Menu

```text
╭──────────────────╮
│ 重命名           │
│ 分享             │
│ 导出             │
│ ──────────────── │
│ 删除对话         │  danger
╰──────────────────╯
```

- 只包含命令、导航或单/多选项；含输入和自由内容时改用 Popover。
- 默认最小 128px，内容最大 320px；item 高 32px、radius 6–8px、padding 0 10px。
- 分组 label 为弱文字且不可聚焦，用 `MenuGroup label` 传入（Base UI 的 GroupLabel 离开 Group 会直接抛错）；分隔线只用于真实语义分组，危险操作单独置底。
- 支持方向键、Home/End、typeahead、Escape； submenu 有独立打开/关闭与碰撞规则。
- 选择后通常关闭并还焦触发器；多选菜单可保持打开，但行为必须一致。
- 菜单打开时 trigger 有 expanded 状态；菜单消失后不遗留 `aria-controls` 指向不存在节点。
- 菜单与自由内容浮层必须分开：菜单用 `Menu`，说明/表单/搜索面板用 `Popover`，模态内容用 `Dialog`。

## 14. Tooltip

```text
                 ╭────────────╮
                 │ 复制回答   │
                 ╰────────────╯
                      [ ⧉ ]
```

- 单行、无箭头，padding 3px 8px、radius 6、13px/18px；`--surface` + `--shadow-raised`（阴影自带发丝环，不再另加 border）。
- 默认延迟 400ms，间距 6px；应用根部唯一的 `TooltipProvider` 让相邻提示在第一个出现后立即显示。
- hover 与 focus 显示，Escape 关闭；滚动/尺寸变化时重新定位或关闭。
- 触屏不依赖 Tooltip；不承载链接、按钮、长说明和完成任务所必需的信息。
- 长文本省略不利于理解时应改用 Popover，不允许多行 Tooltip 变成小卡片。

## 15. Toast

### 15.1 线框与位置

```text
                                      ┌──────────────────────────┐
                                      │ ✓  已保存更改        ✕ │
                                      └──────────────────────────┘
                                      ┌──────────────────────────┐
                                      │ !  保存失败，请重试  ✕ │
                                      └──────────────────────────┘
                                   右下 16px；宽 360px，最多 4 条
```

### 15.2 规格与行为

- 单条最小 44px，icon 18px、正文 14px；`--surface` + `--shadow-panel-popover`（自带发丝环），图标、首行文字、操作与关闭键中线对齐；过长内容应进入页面错误区。
- 新提示从底部进入，其余按真实高度平滑移动；reduced motion 下直接更新位置。
- 成功/信息默认 3 秒，警告 5 秒，带 action 6 秒；错误不自动消失，由用户关闭或在状态恢复后清除。指针悬停或焦点在提示内时暂停倒计时，离开后按剩余时间继续。
- polite live region 用于普通反馈，error 使用 alert；流式进度不逐条触发 Toast。
- 关闭按钮名称“关闭提示”；action 使用明确动词，例如“撤销删除”。
- 关键失败同时保留字段/页面错误，Toast 只负责补充通知。
- 位置：右下，宽 360px（窄屏 `100vw - 2rem`），底部 `1rem + safe-area`；小于 1024px 时上移到 `5rem + safe-area`，让出底部导航。有模态框打开时挂进最上层对话框（`useTopModal`），否则会被 inert 和遮罩压住。

## 16. StatePanel

### 16.1 列表内空状态

```text
┌──────────────────────────────────────┐
│                 ◌                    │
│          还没有保存的命盘            │
│     完成一次排盘后，可在这里继续查看 │
│                                      │
│             [ 开始排盘 ]             │
└──────────────────────────────────────┘
```

### 16.2 变体

| layout | 用途 | 外观 |
| --- | --- | --- |
| framed | 列表、卡片、局部面板 | 虚线 hairline、留白、icon + 标题 |
| page | 整页无权限、功能关闭、加载失败 | 无外框，主区域居中 |

- icon 容器 44px，page 48px；标题 18–20px，framed/page 均可按语义使用 display 字体。
- 描述最多约 40 个汉字一行，明确下一步；action 最多一个 primary + 一个 secondary。
- `neutral` 用于空数据，`accent` 用于可开始行动，`danger` 用于错误；搜索结果为空不是错误。
- 加载骨架不套用 StatePanel；空状态不能在数据尚未返回时提前闪现。

## 17. Loading / Skeleton

- 小范围提交沿用 SoundWaveLoader inline，和动作文字一起出现。
- 全页加载保留页面壳，先展示稳定标题/导航，再加载内容，避免整页只有一个旋转图标。
- Skeleton 复刻真实内容结构，不使用“一排排完全相同灰条”；命盘、会话、设置表单各有自己的结构。
- 已有内容刷新时保留旧内容并显示局部状态，不用 Skeleton 替换整页。
- Skeleton 是装饰，不进入读屏；加载状态由外部 `aria-busy` 或简短 status 表达。

## 18. 组件组合示例

### 18.1 设置行

```text
任务助手记忆                              [ Switch ]
允许 Agent 在后续对话中使用你保存的偏好。
───────────────────────────────────────────────
解读详细度                                [ Select ]
控制 Agent 回答时展示的推演与依据。
```

规则：标题和说明左对齐，控件右对齐；宽屏 label 区最大 58ch，窄屏控件换到下一行并左对齐。设置行不是 Card，不额外加底色和阴影。

### 18.2 表单保存条

```text
● 有未保存的更改                  [ 取消 ] [ 保存更改 ]
```

- 未修改时不显示浮动保存条，或明确禁用；不能一直显示“保存成功”造成歧义。
- 保存中保留原尺寸，失败时错误留在保存条和相关字段附近。
- 页面底部预留保存条空间，不遮挡最后一项设置。

### 18.3 聊天工具行

```text
[ + ]  [ 方法：八字 ⌄ ]                  [ 模型·深入 ⌄ ] [ ↑ ]
```

- 全部使用 IconButton/Button ghost + Menu/Popover；不混入设置页 38px 表单控件。
- 选中模型/方法用 trigger 的值表达，菜单只负责更改，不重复展示大段状态卡。

## 19. 现有实现到目标组件的迁移映射

| 当前实现/写法 | 目标组件 | 迁移要点 |
| --- | --- | --- |
| `.settings-button*` 与重复按钮 class | Button | 按 primary/secondary/ghost/danger 归类，移除页面私有变体 |
| `.settings-input/.settings-textarea` | Field + Input/Textarea | label、描述、错误关联一起迁移 |
| 普通原生 select | Select | 已全部替换；保留值类型和键盘行为 |
| `SettingsSwitch` | Switch | 保留即时设置语义与行布局 |
| `SettingsTabs` | Tabs | 设置页保留薄封装：滑动指示器与外部 tabpanel id 契约；新页面直接用 Tabs |
| `BetaBadge` | Badge quiet | 未迁移：仍是独立组件 + 全局 `.beta-badge`，见 §21 |
| `Modal` | Dialog | 已完成：业务只经 `Dialog`；`Modal` 内部负责 top-layer 与 `useTopModal` |
| `ConfirmDialog` | ConfirmDialog 通用模式 | 已改为 alertdialog、`confirmText` 必填；外壳仍自写，见 §21 |
| 旧自绘菜单 | `Menu` | 菜单项、字母快捷键、子菜单、模型列表（已全部替换） |
| 旧自绘面板 | `Popover` 或 `Dialog` | 自由内容用 Popover；模态内容用 Dialog（已全部替换） |
| `Tooltip` | Tooltip | 已完成：根部唯一 Provider 统一分组延迟 |
| `Toast/useToast` | Toast 通用模式 | 已完成：调用方式不变；错误不自动消失、悬停暂停、挂进最上层模态框 |
| `StatePanel` | StatePanel | 保留并收敛 empty/error/page 用法 |

迁移时同步删除旧 class 和死 CSS；不保留 `NewButton`、`ButtonV2` 或永久兼容转发。

## 20. 设计评审与实现验收

### 每个组件

- [ ] 线框中的结构、状态、文案与令牌均有对应实现。
- [ ] 只有规定的 variant/size，无调用方私有皮肤。
- [ ] 键盘、焦点、禁用、loading、错误和暗色行为符合本文。
- [ ] 320/390/768/1440、200% 缩放、字号档位和 reduced motion 已验证。
- [ ] 与 Menu/Dialog/Popover 等组合时层级和焦点正确。
- [ ] 浏览器行为测试与真实页面视觉走查均完成。

### 整个组件族

- [ ] 同一动作在不同页面名称与样式一致。
- [ ] 没有第二个 select/menu/dialog/toast 实现继续增长。
- [ ] 没有引入 shadcn 默认主题、第二套图标或重复底层。
- [ ] 领域组件仍保持业务结构，Agent 定位和当前查看内容未受影响。
- [ ] 旧实现、死 CSS、重复 class 常量和临时适配已删除。

## 21. 已知缺口与待决事项

组件侧已经就绪、但需要设计裁决或调用方配合的项集中在这里。处理完一项就删一项，不在别处重复记录。

### 21.1 待设计裁决

- **SegmentedControl 尺寸**：轨道 40/44px（4px 内衬 + 段高 32/36px），不在 §2.1 刻度内；claude 实测为高 32px、1px 内衬、radius 8、段 radius 6。收敛到 32/38px 会改动八字/合盘表单与设置页布局，需要一次性决定，并同步 `SegmentedChoice`、通知页与解读模式切换。`mode="tabs"` 目前没有调用方。
- **确认框标题字体**：`ConfirmDialog` 标题是 `font-display` 20px，结构化 `Dialog` 是 18px/500 无衬线；§3.3 只允许 display 字体用于 h1、品牌和状态标题。二选一后统一。
- **ConfirmDialog 外壳与命名**：仍自写外壳（未复用结构化 Dialog），受控属性叫 `isOpen`/`onClose`，与 `Dialog` 的 `open`/`onOpenChange` 不一致。
- **结构化 Dialog 的去留**：39 处业务对话框全是 `bare`，结构化模式只有组件测试在用。要么把标准编辑器类对话框逐步迁过去，要么承认 bare 是主路径并精简结构化 API。
- **Badge**：quiet + 五个 soft 色都没有业务调用；beta 标记仍是 `BetaBadge` + 全局 `.beta-badge`。并入 `Badge quiet` 时注意 `chat-sidebar.css` 用 `transform: none` 覆盖它，而 Tailwind v4 的 `translate-*` 走独立的 `translate` 属性，那条覆盖不会生效。
- **遮罩令牌**：`--scrim`（45% / 60%）无人使用，对话框遮罩是 `overlays.css` 的字面 `rgba(0, 0, 0, .4)`。保留一个来源。
- **z-index 顺序**：`--z-toast` 100 < `--z-tooltip` 130 < `--z-popup` 1100，打开的菜单会盖住提示；`--z-dialog` 1200 无人使用（对话框走原生 top layer）。建议 popup < tooltip < toast，并删除 `--z-dialog`。
- **`--focus-ring-clay`**：未被使用，而且定义在 `:root`，其中的 `var(--focus-ring-bg, var(--background))` 在根元素就已求值，注释所说「可用 `--focus-ring-bg` 覆盖」在子元素上不生效。要用就移进 `@theme inline`，否则删除。
- **按下态**：§2.4 要求 pressed 稍深填色，共享 `Button`/`IconButton` 尚未实现。

### 21.2 待调用方跟进

- **设置中心**：`settings-page.css` 的 `.settings-segmented*` 覆盖已与共享默认等价，而且暗色滑块用 `--background-tertiary`，比轨道还暗，看起来像凹进去；删掉这组规则和 `SegmentedChoice` 的 `indicatorClassName`。`.app-modal.collab-dialog :where(input, textarea, .settings-combobox):focus-visible { outline: none; }` 是给已删除的对话框焦点规则打的补丁，也可删除。要中性焦点就在 `.collab-dialog` 上设 `--control-focus: var(--foreground-secondary)`，字段边框与外圈会一起变。
- **自绘分段控件**：通知页与 `InterpretationModeToggle` 紧凑模式用 `indicator={false}` + 自有类重画轨道和选中态，但没覆盖高度，轨道仍被默认的 `h-11` 撑到 44px：通知页 32px 的选项贴顶、下方空出 8px，解读模式的小号选项上下各空约 10px。定时任务的 `.sched-segmented` 同样自绘。改用默认外观，或至少修正高度。
- **音浪补丁**：`SanshiFormControls` 用 `[&_.sound-wave-bar]:bg-on-accent` 修补实色按钮里的音浪，改为 `SoundWaveLoader tone="current"`。
- **CopyTextModal**：用 `ConfirmDialog showActions={false}` 承载非确认内容，应改用 `Dialog`。
- **工作区最大化键**：`.agent-icon-button` 带 `aria-pressed`，最大化时会显示陶土淡底；不需要就在领域类里写明 `background`。
- **overlays.css**：仍混有全部占术、搜索面板、用量等领域样式，应迁回各自组件目录；其中 `.all-divinations-pin` 已显式 `background: transparent`，避免共享 IconButton 的开启底色。

### 21.3 测试跟进

- 已覆盖：确认框的 `alertdialog` 定位、`SegmentedControl` 跳过禁用段、子菜单字母快捷键不与父菜单串扰、对话框内 Toast 的 portal 与关闭。
- 仍缺自动化覆盖：字段聚焦外圈与 invalid 换色、对话框内输入不再叠加 2px outline、菜单/弹层打开时触发器保持 hover 外观、`aria-pressed` 开启态、Toast 悬停暂停、实色按钮里的音浪颜色。
