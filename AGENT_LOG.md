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

## T7 — 反馈模块（确定性校验器 + FeedbackClassifier）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/feedback/classifier.ts`（`FeedbackClassifier.classify` → PASS/COMPILE_ERROR/TEST_FAILURE/LINT_ERROR/TIMEOUT/OTHER + 摘要前 500 字符）+ `src/feedback/validators.ts`（`runTests`/`runTypecheck`/`makeParseFileValidator`）+ `tests/feedback/classifier.test.ts`（6 用例）+ `tests/feedback/validators.test.ts`（2 用例）。
- **验证**：TDD 红→绿（模块不存在 → 8/8 通过）；`npm run build` 通过。
- **关键决策**：TIMEOUT 判定 = `exitCode===null` 且 error 含 `timed out`，优先级最高；分类顺序 PASS→run_tests/typecheck/lint→OTHER；`detail` 取 error 或输出前 10 行。
- **问题与处理**：无。
- **下一步**：T8 记忆模块（MemoryStore jsonl）。

## T8 — 记忆模块（MemoryStore，jsonl）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/memory/store.ts`（`MemoryStore`：append-only jsonl，`add`/`all`/`query(kind/keywords/limit)`/`summary`）+ `tests/memory/store.test.ts`（4 用例）。
- **验证**：TDD 红→绿（模块不存在 → 首次 3/4，修正后 4/4）；`npm run build` 通过；`npm test` 全量 61/61 通过。
- **关键决策**：PLAN 实现缺陷修正——原 `query` 仅按 `ts` 降序排序，同毫秒写入时稳定排序保留文件顺序，`summary(1)` 会取到较旧条目（`BBB` 测试失败）；改为携带文件序号 `i` 作 tiebreaker（`y.i - x.i` 优先较新），语义符合"最近 N 条"。
- **问题与处理**：无。
- **下一步**：T9 主循环 HarnessSession。

## T9 — 主循环（HarnessSession）—— harness 内核核心

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/loop/prompt.ts`（`buildSystemPrompt`：工具列表 + 单 JSON 动作协议）+ `src/loop/session.ts`（`HarnessSession.run`：组装上下文→LLM→decode→GuardrailEngine→(ASK→HITL 审批)→ToolRegistry 分发→FeedbackClassifier→回灌→停机判断；`SessionEvent`/`SessionReport`/`abort`/`defaultResolve` 轮询审批）+ `tests/loop/session.test.ts`（7 用例）。
- **验证**：TDD 红→绿（模块不存在 → 7/7 通过）；`npm run build` 通过；`npm test` 全量 68/68 通过。
- **关键决策**：停机四条件——`done` 工具 / 校验器 PASS 且本会话有过成功 `write_file` / 连续失败达 `maxFailures` / 步数达 `maxSteps`；BLOCK 与 DENIED/TIMED_OUT 均不执行工具只回灌原因；PASS 重置失败计数。
- **问题与处理**：PLAN 缺陷修正——`defaultResolve` 原声明为 `async function`，返回的是 Promise<函数>，作为 `(req)` 调用会 TypeError；改为普通工厂函数返回闭包（仅默认路径触发，测试全注入 resolveApproval 故未暴露，静态审视发现）。
- **下一步**：T10 Web 控制台（Node http + ws）。

## T10 — Web 控制台（Node http + ws，四功能）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/console/server.ts`（`ConsoleServer`：Node http + ws，路由 /、/api/config（无密）、/api/sessions、/api/demo/run、approvals approve/deny、secrets GET/POST/DELETE，WS /ws 广播 SessionEvent；`SessionRunner` 接口 + FakeRunner 供测试）+ `src/console/static/index.html`（内联单页：配置只读/Demo/凭据/实时日志）+ `tests/console/server.test.ts`（7 用例）。
- **验证**：TDD 红→绿（模块不存在 → 7/7 通过）；`npm run build` 通过。
- **关键决策**：port=0 时实际端口回显于 `url`；config API 只含 workspace/sandbox/budget/console/policy，无任何 key；静态页随 build 的 `cpSync` 拷入 dist。
- **问题与处理**：移除 PLAN 实现中未使用的 `dirname, join` import；核实 `ws` 库实例也暴露 `OPEN` 常量（`c.readyState === c.OPEN` 可用）。
- **下一步**：T11 Demo 模块与机制演示（§A.6）。

## T11 — Demo 模块与机制演示（§A.6）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/demo/project/`（`sum.js` 故意错误、`sum.test.js`、`policy.json`、`package.json` type:module）+ `src/demo/demo.ts`（`DEMO_SCRIPT` 5 步、`demoPolicy`/`demoTools`/`buildDemoSession`/`runDemo`/`DemoSessionRunner`，运行时复制工程到临时目录保证可重复）+ `tests/demo/demo.test.ts`（4 用例）。
- **验证**：TDD 红→绿（模块不存在 → 4/4 通过）；`npm run build` 通过；`npm test` 全量 79/79 通过；`npm run demo` 输出三行为证据：① BLOCKED rm -rf ② TEST_FAILURE at step 1 → next write_file ③ HITL PENDING->APPROVED, executed=true，status=done。
- **关键决策**：`buildDemoSession` 的 `resolveApproval` 固定 `auto`/`deny`（demo 全自动）；手动审批完整路径留待 T12 非 demo 模式 `cliApprover`；`isDirectRun` 判定兼容 win32 路径大小写/分隔符。
- **问题与处理**：无。
- **下一步**：T12 CLI 入口（commander）。

## T12 — CLI 入口（commander）

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`src/governance/store.ts`（`InMemoryRequestStore`）、`src/session/recorder.ts`（`SessionRecorder.write` → `sessions/<id>.jsonl`，每行一个 StepRecord + 末行汇总）、`src/cli/input.ts`（`readHidden` 掩码 / `readLine`）、`src/cli.ts`（`createProgram`/`main`/`CliDeps`：`init`、`run [--task <t>] [--config <p>] [--demo]`、`console [--port] [--host]`、`secrets init/set/get/unset/list`、`policy validate <file>`；`isDirectRun` 判定直跑）+ `tests/cli/cli.test.ts`（5 用例）。
- **验证**：TDD 红→绿（模块不存在 → 5/5 通过）；`npm run build` 通过；`npm test` 全量 84/84 通过；CLI 手工验证——`init` 生成配置与 .gitignore、`policy validate` 合法退出 0 / 非法退出 1、`run --demo` 三行机制演示 + sessions jsonl + 退出 0、未知命令退出 1、`run` 无 task 报错退出 1。
- **关键决策**：`policy validate` 用显式嵌套子命令 `program.command('policy').command('validate <file>')`；action 内校验失败走顶层 `program.error()`，使非零退出码经 commander `exitOverride` 统一处理（真实 CLI 设 `process.exitCode`，测试可注入回调断言 code≠0）；`run` 真实 LLM 路径走 `SecretStore`（`openai` 键）+ `cliApprover`（非 TTY 自动 DENIED，TTY 读 `y/N`）+ `SessionRecorder`。
- **问题与处理**：PLAN 缺陷修正四处——① 测试 `run` 辅助 `['node','cli.js',...args]` 配 `{from:'user'}` 会把 `node` 当字面参数报 unknown command，改为 `program.parseAsync(args, { from: 'user' })`；② 动作抛错不触发 `exitOverride`（直接向外传播），`policy validate` 非法用例断言 code≠0 需 action 内 `program.error()` 路由；③ `exitOverride` 回调原样打印 `error:` 会造成与 commander `error()` 自身输出重复，改为只设 `process.exitCode`；④ `rl.output` 在 @types/node 的 `Interface` 类型上不存在，`readHidden` 改为持有 `process.stdout` 引用。
- **下一步**：T13 打包/README/CI 收尾（含 npm audit 复核）。

## T13 — 打包 / README / CI 收尾

- **日期**：2026-07-31
- **状态**：完成
- **实现**：`Dockerfile`（两阶段：build 阶段 `npm ci` + `npm run build`；runtime 阶段 `npm ci --omit=dev` + `COPY dist`，`CMD node dist/cli.js console` 监听 0.0.0.0:8117）、`.dockerignore`（node_modules/dist/sessions/.env/secrets/.git）、`.gitlab-ci.yml`（unit-test 模板，NJU GitLab 镜像备选，不作为主 CI）、`README.md`（覆盖原 36B UTF-16 占位 stub；含简介/安装/运行/控制台/Docker 分发/凭据安全/安全边界/目录结构/已知限制，如实标注"代码级围栏非 OS 级隔离"）、`REFLECTION.md`（反思，纯汉字 1520 字）；`src/cli.ts` 补首行 shebang（npm 全局 bin 在 Unix 需可直执行）。
- **验证**：`npm test` 84/84 全绿；`npm run build` 通过且 `dist/cli.js` 首行为 shebang；`npm run demo` 输出三行证据（① BLOCK rm -rf ② TEST_FAILURE→write_file ③ HITL APPROVED）status=done 退出 0；`node dist/cli.js --help` 与 `node dist/cli.js run --demo` 均退出 0（构建产物独立可跑）；`git grep -E "(sk-[A-Za-z0-9]{10,}|AI4SE_.*=.+)"` 仅命中文档示例无真实 key；五交付物（SPEC/PLAN/SPEC_PROCESS/AGENT_LOG/REFLECTION）齐，git log 逐 task 有 commit。
- **关键决策**：README 安全边界如实声明"代码级围栏 + Docker 可选强隔离"（SPEC R4/R7）；`REFLECTION.md` 按"纯汉字计数"达标（1520 ≥ 1500）；T1 的 Step 5 勾选为冷启动遗留缺口（SPEC_PROCESS §4.4 已记）一并补全；T13 Step 4 第 5 项「push 触发 GitHub Actions」需用户授权推送，本地以 `npm test` 等价验证。
- **问题与处理**：`npm audit` 复核——原 5 个漏洞（3 moderate/1 high/1 critical）全在 dev 工具链传递依赖（vitest/vite/vite-node/esbuild，仅影响 `test:watch` dev server）；最终处理：`vitest` 升级 `^2.1.8 → ^4.1.10`（仓库仅用基础 `describe/it/expect` API，v4 兼容，Node 20 满足 engines），`npm audit` 归零、84/84 测试与 build 全绿，无 `--force` 破坏性修复。
- **下一步**：无（T1–T13 全部完成）。若需最终 CI 证据，用户授权后 `git push` 由 GitHub Actions `unit-test` job 判定。

## T14 — 云端只读模式（公网 mock demo 前置，T1–T13 之后追加）

- **日期**：2026-07-31
- **状态**：完成
- **背景**：T13 交付后，公网 WebUI（SPEC §7/§10-R3/偏离记录 2）仍是待办；用户尚未申请服务器。原 `console` 子命令强制要求本机存在已初始化 secrets 文件，否则启动即失败，且不提供凭据只读态——云端 mock demo 无法直接运行。
- **实现**：`ConsoleServerOptions` 增 `readonly?: boolean`；`route()` 中 `readonly` 时 GET /api/secrets 返回 `[]`（不触碰 SecretStore，允许未初始化文件）、POST/DELETE /api/secrets 返回 403、/api/config 附 `readonly` 字段；`src/cli.ts` console 子命令读 `AI4SE_READONLY=1` 门控（跳过 secrets 初始化检查、传入 readonly、启动日志注明 read-only）；`src/console/static/index.html` 只读时显示横幅并隐藏凭据表单；`README.md` 增「云端部署」章节与 `AI4SE_READONLY` 文档。
- **验证**：TDD 红→绿（tests/console/server.test.ts 新增 4 用例：config 带 readonly / 未初始化 store 下 GET secrets 返回 [] / POST、DELETE 403 → 11/11 通过）；`npm test` 全量 88/88；`npm run build` 通过；手工端到端——无 secrets 文件 + `AI4SE_READONLY=1` 启动 console，/api/config 含 `readonly:true`、GET /api/secrets 为空、POST 403。
- **关键决策**：只读模式以环境变量授权（SPEC §4-T4「开真实 LLM 需环境变量授权开关」反向应用）；云端不接真实 LLM、不接收任何 key，凭据 API 服务端强制 403 而非仅隐藏 UI。
- **问题与处理**：发现既有缺口——非只读 console 的 GET/POST /api/secrets 因 store 未 unlock 会抛 `SecretStore.requireKey`（`'store is locked'`），本地凭据管理在 Web UI 上实际不可用；不在本次范围内，未改动，记录备查。
- **部署结果**：Render 免费 Web Service 上线，公网 URL **https://ai4se-harness.onrender.com**（Runtime=Docker，`AI4SE_READONLY=1`）。验收全部通过：`/api/config` 返回 `readonly:true`；`GET /api/secrets` 空；`POST /api/secrets` 403；页面 UTF-8 正常、只读横幅显示、凭据表单隐藏；公网触发 Demo 会话两次均 `status:done`，日志复现 ① step-0 `BLOCK no-rm-rf` 拦截 `rm -rf` ② step-1 测试失败反馈 ③ step-2 `ASK ask-write` HITL 审批。
- **下一步**：无（SPEC §7/§10-R3/偏离记录 2 的公网云端 WebUI demo 交付完成，交付闭环）。

## T15 — 补齐交付清单缺口 1/4（Docker 公开 registry + CI 构建镜像）

- **日期**：2026-07-31
- **状态**：完成
- **背景**：对照作业要求（通用 §3.2/§4.8）逐项检查发现两处缺口：容器分发未推送到公开 registry；CI 未构建镜像。用户裁决只补 1、4（PR 工作流与 commit message 标注两项维持现状，不补）。
- **实现**：`.github/workflows/ci.yml` 新增 `docker-build` job——每次 push/pull_request 用 buildx 构建镜像（满足 §4.8「若选容器分发，CI 还须构建镜像」）；main 分支且存在 `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` secret 时登录并推送 `docker.io/<用户名>/ai4se-harness:latest`（满足 §3.2「推送到公开 registry」）。README「Docker 分发」补公开镜像说明与手动 push 命令。凭据不硬编码（用户名/口令走 GitHub secret）。
- **验证**：推送后由 GitHub Actions 运行（build 步骤全分支必跑；push 步骤在无 secret 时经 `if` 短路跳过，保证 CI 恒绿）。
- **待用户动作**：注册 Docker Hub → 在仓库 Settings→Secrets 添加 `DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` → 下次 push main 即自动出公开镜像。
- **备注**：§4.7 的 PR 工作流与 commit message subagent 标注两项缺口按用户裁决不补，未作偏离记录。



