# REFLECTION.md — 项目反思

## 一、项目做了什么

本项目实现了一个自托管的编码 agent harness：LLM 只做"下一步输出什么动作"这一件事，其余全部由确定性代码接管——主循环 `HarnessSession`、工具注册表与分发、`GuardrailEngine` 命令守卫、`ScopeFence` 范围围栏、`ProcessExecutor` 进程执行、`HITLStateMachine` 人工审批、`FeedbackClassifier` 反馈分类、`MemoryStore` 跨会话记忆。最终交付五份文档（SPEC/PLAN/SPEC_PROCESS/AGENT_LOG/REFLECTION）与 13 个 task 的全部代码，`npm test` 84/84 全绿，`npm run build` 通过，`npm run demo` 确定性复现三机制演示。

## 二、核心贡献：治理/护栏/沙箱

SPEC 把"治理"锁定为主贡献维度，这是最不依赖 LLM 智能的一维。回顾实现，这一点是站得住的：`guardrail(Action({command:"rm -rf /"}))` 返回 BLOCK 的判定、`ScopeFence` 拒绝符号链接逃逸、`ProcessExecutor` 超时 kill 并剔除 `SECRET` 类环境变量、HITL 状态机幂等迁移——这四件套在移除真实 LLM 后依然 100% 由代码决定、可单测、可断言。这也回应了作业"移除 LLM 还剩多少可独立验证工程"的硬标准：把不可控的部分压缩到最小面，把可控的部分做深。

## 三、过程层面做得好的

**1. 先问再做（brainstorming）**。部署形态、凭据方案、演示方式、CI 平台、交付路径这五类"人才能定"的问题在动工前全部确认并固化进 SPEC，执行阶段零决策漂移。最有价值的是凭据方案：最初设想 `.env`，追问"演示和 CI 里会不会出现 key"后改为 scrypt + AES-256-GCM 加密文件，这个决策在 T3 一次成型，之后从未改过接口。

**2. 计划写到"照抄即可"（writing-plans）**。PLAN 把每个 task 的测试、实现、命令都写成字面量。冷启动验证（不同 agent、全新 session、仅凭 SPEC+PLAN）零停顿完成 T1+T6a，说明计划的确定性达到了可独立执行的程度。后续 T6a 直接 cherry-pick 冷启动已验证代码，避免了重复开发。冷启动用的还是隔离 worktree 与独立分支，正式实现与验证互不污染，这也让"计划是否真的可执行"有了一个客观的验证入口，而不是靠开发时临时补课。

**3. TDD 纪律 + 每 task 独立 commit + 文档同步**。13 个 task 全部按"红→绿→build→commit→PLAN 勾选→AGENT_LOG 记录"推进，历史可逐 task 复盘，PLAN.md 里每个 commit hash 与测试数都真实可查。`npm run build` 被设为每个 task 的硬门禁，任何 `.js` 后缀、类型、未使用 import 的问题都会被 tsc 卡住，而不是拖到最后一起爆雷。

## 四、过程中的问题与修正

**PLAN 缺陷的发现与修正是一个反复出现的模式**。T8 记忆 `query` 同毫秒写入时稳定排序失效（需文件序号 tiebreaker）、T9 `defaultResolve` 写成 `async function` 返回了 Promise<函数>、T12 测试辅助 `['node','cli.js',...]` 配 `from:'user'` 会把 `node` 当字面参数、动作抛错不触发 commander `exitOverride`、`rl.output` 在类型定义上不存在……每个缺陷都是先写测试让它暴露（或静态审视发现），再以"最小修正 + 记入 AGENT_LOG"处理。这说明即便是精心设计的计划，也会在真实工具版本（commander v12、@types/node）与运行时行为上出现偏差；把缺陷写回日志而不是悄悄改掉，是单人项目里最有价值的自我审计方式。另一个细节是依赖顺序被真实需求纠正：T5 工具层依赖 T6b/T6c 的围栏与执行器，经询问用户后调整了实施顺序，说明计划里"依赖与并行"不能只靠直觉排。

**跨平台是个持续的坑**。win32 的路径大小写、`\` 分隔符、`rm -rf` 在 Windows 下无此命令、`isDirectRun` 判定……凡是触碰文件系统与进程的地方都要单独考虑平台差异。教训是尽早建立"路径统一经 `ScopeFence`/`fileURLToPath`/`norm` 封装"的约定，而不是到处特判。相对 import 强制 `.js` 后缀（NodeNext/TS2835）这类"硬纪律"被证明必要——它把一类批量错误消灭在规范层面。

**"剧本化"演示的诚实标注**。demo 用 `MockLLM(DEMO_SCRIPT)` 确定性重演三行为，这是可重复验证与真实 LLM 行为之间的一种取舍。README 与 SPEC 都明确标注 deterministic scripted，避免把演示误读为真实能力。同理，云端形态只开放 mock 只读态、真实凭据仅在本地 TTY 使用——所有"看起来很强"的能力都对应一句"这里不开"的边界说明，安全声明必须与实现一致。

## 五、不足与改进方向

1. **安全边界仍是"代码级"而非"OS 级"**。`Dockerfile` 提供了可选强隔离，但默认交付不对抗恶意宿主。若要面向真实团队使用，需要把 sandbox 模式（`fence-only`/`docker`）的 docker 分支真正实现并在 CI 里验证。
2. **审批 UX 偏命令行**。`cliApprover` 与 `DemoSessionRunner` 的审批路径已打通，但非 TTY 下自动 DENIED 会拖慢真实自动化会话；需要更成熟的"策略驱动的审批阈值"（如按工具/路径自动放行）。
3. **真实 LLM 会话未纳入验收**。所有循环测试走 mock，OpenAI 客户端只有请求格式单测。上真实 key 的冒烟路径依赖人工，后续应加一个可选的、带 fake fetch 的端到端会话测试。
4. **记忆仍是最薄的一环**。`MemoryStore` 是 append-only + 关键词检索，没有去重、衰减与结构化抽取；跨会话收益有限，属于"可运行最低实现"的定位，够用但谈不上智能。

另一个值得反省的是**测试分布不均**：治理、工具、循环这些"确定性内核"有充足的断言，而 CLI 层只覆盖了 5 条主路径，`console` 与 `secrets` 子命令的交互完全靠手工验证。对单人项目这可以接受，但暴露了一个倾向——把精力集中在"有趣"的机制上，忽略了"枯燥"的入口面。若再有一次机会，我会给 secrets 全命令链路补上临时目录端到端测试，而不是依赖 README 步骤手点一遍。

## 六、一句话总结

这个项目最大的收获不是功能多少，而是验证了一条工程路线：**把 LLM 压缩为"输出下一步动作"的单一零件，其余全部用确定性代码兜底、用测试锁定、用文档留痕**——治理与护栏是这条路线里最扎实、最可独立验证的部分，也是我对"AI 编码 agent 可信度"这个问题给出的最小可行回答。
