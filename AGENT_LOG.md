# AGENT_LOG.md — 开发过程日志

按通用要求 §4.9 记录逐 task 开发过程。每 task：做了什么、验证结果、关键决策、遇到的问题。

## T1 — Project Foundation（脚手架 + 共享类型 + CI）

- **日期**：2026-07-31
- **状态**：完成
- **实现方式**：由冷启动验证 agent 在隔离 worktree 实现（T1 `4e24150`、T6a `4b3afd7`，`npm test` 7/7 通过）；经审查后 T1 cherry-pick 至 `main` 为 `bcf67a6`。
- **产物**：`package.json`（type:module、bin、files 白名单、build 含 demo/static 拷贝）、`tsconfig.json`/`tsconfig.build.json`（NodeNext、strict、exclude src/demo/project）、`vitest.config.ts`、`.github/workflows/ci.yml`（unit-test job）、`src/types.ts`（Tier/SessionStatus/FeedbackCategory/AgentAction/Decision/ToolResult/Feedback/StepRecord）、`src/index.ts`、`tests/smoke.test.ts`。
- **验证**：`npm install` + `npm test` → 1/1 通过。
- **关键决策**：相对 import 一律 `.js` 后缀（NodeNext）；`build` 脚本用 `cpSync` 复制 `src/demo/project` 与 `src/console/static` 到 dist（T10/T11 目录在 T13 收尾 build 时已存在）。
- **问题与处理**：主工作区无 node_modules，`npm test` 首次失败 → `npm install` 后通过；npm audit 报 5 个漏洞（多为 dev 依赖传递），不阻塞，后续 T13 复核。
- **下一步**：T2 config 模块。

## T2 — Config 模块（config）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/config/config.ts`（`HarnessConfig`/`PolicyRule`/`ConfigError`/`defaultConfig`/`validateConfig`/`loadConfig`）+ `tests/config/config.test.ts`。
- **验证**：TDD 红→绿（模块不存在 → 5/5 通过）；`npm run build` 通过。
- **关键决策**：默认值补齐策略（缺键取默认）、`ConfigError.field` 指明出错字段、tools 白名单过滤非法工具名。
- **问题与处理**：`npm run build` 因 `src/demo/project`/`src/console/static` 尚不存在（T10/T11 才建）而失败 → build 脚本的两处 `cpSync` 改为 `existsSync` 守卫（T13 目录存在时行为不变）。
- **下一步**：T3 secret 模块。

## T3 — Secret 模块（主密码加密文件）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/secret/crypto.ts`（scrypt 派生 + AES-256-GCM 加解密，密文尾部附 16B HMAC 标签）+ `src/secret/store.ts`（SecretStore：init/unlock/set/get/unset/list，`mode:0o600`，`list` 掩码 `••••末4位`）。
- **验证**：TDD 红→绿（6/6 通过）；`npm run build` 通过。
- **关键决策**：`check` 字段加密固定串 `"ok"` 用于 unlock 验证主密码；密钥仅存进程内 `Buffer`，从不打印明文。
- **问题与处理**：PLAN 实现代码中 `store.ts` 误从 `node:fs` import `randomBytes`（实际在 `node:crypto`）→ 已改为 `node:crypto` 导入（计划小修正）。
- **下一步**：T4 llm 抽象层。

## T4 — LLM 抽象层（client/decode/mock/openai）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/llm/client.ts`（`LLMClient`/`LLMMessage`/`LLMResult`）、`decode.ts`（`decodeAction` + `FormatError`）、`mock.ts`（`MockLLM` 脚本回放/函数式脚本/耗尽报错）、`openai.ts`（OpenAI 兼容 `chat/completions`，Bearer auth + 5xx 重试 + 可注入 fetch）。
- **验证**：TDD 红→绿（3 组 8/8 通过）；`npm run build` 通过。
- **关键决策**：mock 脚本耗尽抛 `FormatError('mock scripts exhausted')`（供 T9 停机/失败计数复用）；重试默认 3 次。
- **问题与处理**：无。
- **下一步**：T5 工具层。

## T6b — 治理 · 范围围栏（ScopeFence）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/governance/scope.ts`（`ScopeFence`：roots 绝对化 + 存在时 `realpath` 规范化，win32 忽略大小写；`resolve` 拒绝 `..` 逃逸、绝对路径越界、符号链接逃逸）+ `tests/governance/scope.test.ts`（4 用例，含符号链接逃逸，平台不支持时跳过）。
- **验证**：TDD 红→绿（模块不存在 → 4/4 通过）；`npm run build` 通过。
- **关键决策**：T5 工具层依赖 T6b/T6c，经询问用户裁定先做 T6b/T6c 再做 T5；比较用 `root + sep` 前缀法避免 `/tmp/foo` 与 `/tmp/foobar` 误判。
- **问题与处理**：无。
- **下一步**：T6c 进程执行器。

## T6c — 治理 · 进程执行器（ProcessExecutor）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/governance/split.ts`（`splitCommand` 引号感知分词）+ `src/governance/executor.ts`（`ProcessExecutor.run`：`spawn` shell:false、envFilter 剔除 SECRET/KEY/TOKEN/PASSWORD 类环境变量、`maxOutputBytes` 截断、`timeoutMs` kill、错误仅限 spawn 本身失败）+ `tests/governance/executor.test.ts`（6 用例，含超时 kill 与 spawn 失败）。
- **验证**：TDD 红→绿（模块不存在 → 6/6 通过）；`npm run build` 通过。
- **关键决策**：stdout/stderr 分别截断；`timedOut` 时 exitCode 为 null；cap 用 `Buffer.byteLength` 计字节而非字符串长度。
- **问题与处理**：无。
- **下一步**：T5 工具层。

## T5 — 工具层（Tool 接口 + 注册表 + 文件/命令工具）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/tools/registry.ts`（`Tool`/`ToolContext`/`ToolRegistry`：按名分发、schema 参数校验、invoke 永不 throw）、`file.ts`（`readFileTool`/`writeFileTool`，经 `ScopeFence.resolve` + 原子写 rename）、`run.ts`（`runCommandTool`/`runTestsTool`/`runTypecheckTool`/`runLintTool`/`doneTool`，`ProcessExecutor` + envFilter + 30s 超时 + 1MB 截断）+ `tests/tools/registry.test.ts`（5 用例）。
- **验证**：TDD 红→绿（模块不存在 → 5/5 通过）；`npm run build` 通过；`npm test` 全量 35/35 通过。
- **关键决策**：`dispatch` 对 schema 缺参/类型错返回 `{ok:false}` 而非 throw；仅未知工具 throw `ToolError`；run 系列工具 cwd=workdir 拘禁。
- **问题与处理**：按用户裁定先合入 T6b/T6c 再实现 T5，ScopeFence/ProcessExecutor 直接复用正式实现，无临时代码。
- **下一步**：T6a 护栏规则引擎（cherry-pick 冷启动已验证代码）。

## T6a — 治理 · 护栏规则引擎（GuardrailEngine）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：cherry-pick 自冷启动 `cold-start/t1-t6a` commit `4b3afd7` → `f0a1b62`（`src/governance/guardrail.ts` + `tests/governance/guardrail.test.ts`），与 PLAN 代码逐字一致，无改写。
- **验证**：6/6 通过；`npm run build` 通过。
- **关键决策**：`run_command` 匹配目标 = command 字符串，其余工具 = 工具名；`path` 型规则匹配 `args.path`；优先级 BLOCK>ASK>ALLOW，同级取首条；无命中 → `{tier:'ALLOW', reason:'no rule matched'}`。
- **问题与处理**：无。
- **下一步**：T6d HITL 审批状态机。

## T6d — 治理 · HITL 审批状态机（HITLStateMachine）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/governance/hitl.ts`（`HITLStateMachine`：request 建 PENDING → approve/deny/timeout 迁移，幂等 + 终态拒绝；`sweepExpired` 按 ttl 批量 TIMED_OUT）+ `tests/helpers/inmem.ts`（InMemoryStore 实现 RequestStore）+ `tests/governance/hitl.test.ts`（8 用例）。
- **验证**：TDD 红→绿（模块不存在 → 8/8 通过）；`npm run build` 通过。
- **关键决策**：仅 PENDING 可迁移；对目标态幂等返回当前；`decidedBy` 入 ActionRequest 接口；默认 TTL 120_000ms（SPEC M5）。
- **问题与处理**：无。
- **下一步**：T7 反馈模块（校验器 + FeedbackClassifier）。



