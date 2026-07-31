# SPEC — Coding Agent Harness（方向 A）

> 版本：v0.1（brainstorming 签字稿）
> 项目：AI4SE 期末项目 · A · Coding Agent Harness
> 完整要求 = 《通用作业要求.md》 + 《AI4SE_Final_Project_A_Coding_Agent_Harness.md》
> 本 SPEC 将作为冷启动验证（§4.5）与 PLAN 的唯一事实来源。

---

## 1. 问题陈述

一个 LLM 只负责"决定下一步做什么"，其余工程（主循环、工具执行、记忆、治理、反馈、配置）都必须由代码封装成一台可靠、安全、可验证的系统（**Agent = LLM + Harness**）。当 LLM 能完成大部分编码"思考"时，工程师的价值落在 harness 层——尤其落在**治理**：把"不要让 agent 乱删文件 / 乱跑命令 / 越界修改"从一句提示词变成可确定性验证的代码护栏。

**目标用户**：希望让一个编码 agent 在自己仓库里安全、可控地自主干活（修 bug、写测试、实现小功能）的开发者——他能批准危险动作、能审计 agent 每步行为、能把策略声明式配置，而不是盲信 LLM 的自觉。

**为什么值得做**：治理/沙箱是 agent 系统中最"工程化"的一层：移除真实 LLM 后，护栏拦截、范围围栏、HITL 状态机、进程执行器仍是可独立验证的确定性工程。它正面回答"一个可靠的系统到底需要哪些工程"，与"只用提示词约束"形成可证伪的对照。

---

## 2. 用户故事（INVEST）

1. **US-1 安全跑任务**：作为开发者，我输入 `ai4se-harness run --task "让 src/add.ts 的单测通过"`，harness 在我 repo 工作目录内自主迭代（读文件→改代码→跑测试→按反馈修正），直到测试通过或预算耗尽。**验收**：mock LLM 下脚本可复现完整闭环；会话日志完整。
2. **US-2 危险动作拦截**：作为开发者，我配置策略 `deny "rm -rf"`，agent 一旦提议 `rm -rf /tmp/x`，代码级护栏在分发前拦截并记录，LLM 绝不真正执行。**验收**：`guardrail(Action)` 单测断言拦截，无真实 LLM。
3. **US-3 HITL 人工审批**：作为开发者，我在控制台对 `ask` 级动作（如 `git push`、删除表）收到审批请求，可批准/拒绝/超时；批准后才执行，拒绝则 agent 得到"被拒"反馈并改道。**验收**：HITL 状态机状态迁移（pending→approved/denied/timeout）确定性单测通过；控制台 WebSocket 审批可用。
4. **US-4 反馈闭环自修正**：作为开发者，agent 的第一次修改让测试红，harness 的确定性校验器（跑测试）把失败结果回灌，agent 据此发起第二次（正确的）修改。**验收**：注入失败后，mock LLM 的下一步动作断言变化。
5. **US-5 文件越界防护**：作为开发者，我限定工作区 `./repo`，agent 尝试读写 `../secret.txt`（含符号链接逃逸）时被范围围栏拒绝。**验收**：路径规范化单测断言越界拒绝。
6. **US-6 凭据安全**：作为开发者，首次运行 `secrets init` 时隐藏录入 API key，之后控制台只显示 `••••abc` 状态；`get` 永不明文回显。**验收**：加密文件在临时目录 + 注入主密码的加解密单测通过；仓库 git 无任何明文。
7. **US-7 策略声明式配置**：作为开发者，我用 `harness.config.json` 声明策略（deny 列表、ask 列表、文件根、沙箱模式、LLM 供应商），无需改代码。**验收**：配置解析 + 规则优先级的确定性单测。
8. **US-8 记忆跨会话**：作为开发者，上次会话的决策（"本项目用 vitest 不用 jest"）在下次会话自动以摘要形式提供给 agent，而非全量倾倒。**验收**：记忆写入→按需检索单测。

---

## 3. 功能规约（按模块：输入 / 行为 / 输出 / 边界 / 错误处理）

### M1. CLI 入口（`ai4se-harness`）
- `init`：在工作目录生成 `harness.config.json` 模板 + `.gitignore`（含 secrets 文件路径）。
- `run --task <t> [--config <p>] [--demo]`：启动一次 agent 会话；`--demo` 用内置 demo 工程 + mock LLM 确定性演示。
- `console [--port]`：启动本地控制台（默认 localhost:8117）。
- `secrets init|set|get|unset|list`：凭据录入/更新/查询/清除/列出。**永不明文回显**；`get` 仅在 TTY 且显式 `--reveal` 时输出到 stdout，不写日志。
- `policy validate <file>`：校验策略文件合法性。
- 边界：非 TTY 下 `--reveal` 被拒；未知子命令 → 非零退出 + 用法提示；`run` 无 `--task` 且非交互 → 报错。
- 错误：错误输出到 stderr，退出码非零；任何 key 不落日志。

### M2. agent 主循环（`loop`，内核核心）
- 输入：task 描述、config、可注入的 LLM 实现、可注入的 Tools/Guardrail/Feedback 组合。
- 行为：`run()` 循环执行——① 组装上下文（系统提示 + 记忆摘要 + 最近步反馈）→ ② 调 LLM 得到 `AgentAction` → ③ `guardrail(action)` 决策 → ④ BLOCK/ASK(HITL)/ALLOW → ⑤ 分发工具执行 → ⑥ 校验器产出客观反馈 → ⑦ 回灌 → ⑧ 停机判断。
- 停机条件：任务完成（验收校验器通过 / LLM 声明 done 且无 pending 改动）/ 步数预算耗尽 / BLOCK 触顶 / 用户中断。输出 `SessionReport`。
- 边界：LLM 输出不可解析 → 计一次失败步（计入预算），回灌"格式错误"并重试；动作参数非法 → 同。连续 N 次失败 → `stalled` 停机。
- 错误：循环永不因单个工具抛错中断；工具异常捕获为反馈回灌。

### M3. LLM 抽象层（`llm`）
- `LLMClient` 接口：`complete(messages, tools?) → LLMResult`；`AgentDecoder` 把 `LLMResult` 解析为 `AgentAction`。
- 实现：`MockLLM`（脚本化响应序列，供单测/演示）、`OpenAICompatClient`（OpenAI / DeepSeek / 本地 vLLM-Ollama，baseURL + key 从 secret store 取）。
- 边界：mock 脚本耗尽 → 明确错误；网络失败可重试（指数退避，最大 3 次）后抛 `LLMError`；超时。
- 错误：key 缺失 → 提示先 `secrets init`，不泄露 provider 之外细节。

### M4. 工具层（`tools`）
- `Tool` 接口：`{name, schema, invoke(input) → ToolResult}`；`ToolRegistry`：按名分发、参数校验、统一错误。
- 内置：`read_file`（受范围围栏）、`write_file`（受围栏 + 原子写）、`run_command`（进程执行器）、`run_tests` / `run_lint` / `run_typecheck`（校验器前置）。
- 边界：未知工具 → `ToolError`；参数缺省/类型错 → 校验失败；读二进制/超大小 → 截断或拒绝。
- 错误：invoke 永不 throw，统一返回 `{ok:false, error}` 由循环回灌。

### M5. 治理模块（`governance`，**主贡献**）
- `GuardrailEngine.decide(action) → {tier: ALLOW|ASK|BLOCK, ruleId, reason}`：规则引擎支持精确命令、正则、前缀、路径模式；优先级 BLOCK > ASK > ALLOW；`validate(policy)` 拒绝矛盾/非法规则。
- `ScopeFence.resolve(path, roots)`：规范化（`realpath` + 符号链接解析 + 平台分隔符归一）后断言在允许根内，越界拒绝。
- `ProcessExecutor.run(command, {cwd, timeout, envFilter, maxOutput})`：cwd 拘禁、超时 kill、环境变量过滤（剔除 SECRET 类 key）、输出截断；返回 `{exitCode, stdout, stderr, timedOut}`。
- `HITLStateMachine`：`request(action) → requestId`；状态 `PENDING → APPROVED|DENIED|TIMED_OUT`；幂等、持久化、可并发；`approve/deny/timeout` 由 CLI 或控制台 WebSocket 触发；批准策略可选（单次 / 会话内记住）。
- 错误：策略文件非法 → 启动即拒绝；进程超时 → 反馈类别 `timeout`。

### M6. 反馈模块（`feedback`）
- 确定性校验器：`runTests` / `runLint` / `runTypecheck` / `parseFile`（断言文件含特定导出）。
- `FeedbackClassifier`：把工具结果映射为类别 `PASS / COMPILE_ERROR / TEST_FAILURE / LINT_ERROR / TIMEOUT / OTHER` + 摘要（首 N 行、`file:line`）。
- 回灌格式：结构化 `Feedback` 对象追加进上下文，供 LLM 下一轮使用。

### M7. 记忆模块（`memory`）
- `MemoryStore`：append-only `MemoryEntry{kind, content, tags, ts}`，存会话历史、决策、HITL 审批历史；`query(kind?, keywords?, limit)` 按需检索。
- 会话启动注入：最近 N 条决策摘要 + 项目约定（按关键词匹配），非全量。

### M8. 配置模块（`config`）
- `harness.config.json`：llm（provider/baseURL/model）、workspace、policy、tools 开关、sandbox（fenceOnly|docker）、budget（maxSteps/maxFailures）、memory 路径、console{port,host}。
- 解析失败 → 明确报错并指出字段；默认值补齐。

### M9. 凭据模块（`secret`）
- `SecretStore`：AES-256-GCM 加密文件（`~/.ai4se-harness/secrets.json`，权限 0600/仅当前用户），主密码经 scrypt 派生密钥；`set/get/unset/list`；`list` 只显示 `name ••••suffix`；支持 `.env` 备选源（文档化明文风险）。

### M10. Web 控制台（`console`）
- 功能：① 实时会话日志流（WS）② HITL 审批（approve/deny + 状态回显）③ 凭据管理（set/unset，只显示掩码状态）④ 策略/配置只读查看。
- 技术：Node `http` + `ws` + 原生 TS 静态页；本地仅绑定 localhost；云 demo 默认 mock + 只读态，如开真实 LLM 需访问口令 + TLS（反向代理）。

### M11. Demo 模块（`demo`）
- 内置 demo 工程（`sum.ts` + 失败的 `sum.test.ts`）；mock LLM 脚本预演三步：`rm -rf`（被拦）→ 错误实现（测试红，反馈注入）→ 正确实现（测试绿，停机）。
- `npm run demo` 或 `run --demo` 确定性重演，输出 SessionReport。

---

## 4. 非功能需求

**性能**
- 单次循环治理/围栏/反馈判定 < 50ms（纯代码，不含 LLM 网络往返）。
- 单会话串行；控制台可同时挂多个会话只读流。
- 进程执行器按 `maxOutput`（默认 1MB）截断，防失控输出。

**安全（含凭据威胁模型）**
- 威胁模型分层：
  - T1 提示词注入：repo 内恶意文本诱导 agent 跑危险命令 → 护栏代码级拦截 + 范围围栏 + ASK 审批，不依赖 LLM 自觉。
  - T2 越界访问：读写工作区外 / 符号链接逃逸 → ScopeFence + cwd 拘禁。
  - T3 凭据泄露：key 进 git / 日志 / 明文文件 / 终端 history / 进程环境 → 主密码加密文件（0600）+ 从不打印明文 + envFilter 剔除 SECRET 类环境变量 + `.env` 明文风险文档化。
  - T4 控制台被攻破：本地绑定 localhost；云 demo 默认 mock LLM（无 key）、只读态；开真实 LLM 需环境变量授权开关 + TLS。
  - T5 超时/资源耗尽 DoS：进程超时 kill + 步数预算 + 输出截断。
- 密钥派生：scrypt（N=16384, r=8, p=1），随机盐 + 每写新 IV + HMAC 标签。
- 提交前自查：CI 扫描明文 key 模式（轻量）；git 历史不含任何 key。

**可用性**
- 新机器冷启动：`npm i -g ai4se-harness && ai4se-harness init && ai4se-harness secrets init && ai4se-harness run --demo` 三步可跑通。
- 命令错误信息含修复提示；`--help` 完整。

**可观测性**
- 每步结构化事件 `{step, action, decision, feedback, cost?}` 落盘 `sessions/<id>.jsonl`；控制台 WS 实时推流。
- `AGENT_LOG.md` 记录开发过程；`--demo` 输出可重复的 SessionReport。

---

## 5. 系统架构

组件图（依赖自上而下，均通过接口注入、可替换为 mock）：

```
┌──────────────────────────────────────────────┐
│  CLI (commander)    │   Web Console (http+ws) │
└─────────┬────────────────────────┬────────────┘
          │                        │ 审批指令(approve/deny)
          │               ┌────────▼─────────┐
          │               │ Approver (HITL)  │
          │               └────────┬─────────┘
          ▼                        │
┌──────────────────────────────────▼─────────┐
│ HarnessSession (agent 主循环)               │
│ ① ContextBuilder(记忆摘要+反馈回灌)          │
│ ② LLMClient ──► AgentDecoder ──► AgentAction│
│ ③ Governance.decide ─► ④ ToolsRegistry 分发 │
│ ⑤ FeedbackClassifier 判定 ─► ⑥ 停机判断      │
└──┬──────────┬──────────┬──────────┬─────────┘
   ▼          ▼          ▼          ▼
MemoryStore SecretStore FeedbackClassifier  Config
(jsonl)     (AES-GCM)   (确定性校验器)      (harness.config.json)

Governance（被③调用）：
  GuardrailEngine.decide(action)
   └─► ALLOW  ─► ToolsRegistry ─► ProcessExecutor(ScopeFence)
   └─► ASK    ─► HITLStateMachine ─► Approver(CLI/Console)
   └─► BLOCK  ─► 记录并回灌，不执行
```

- 纯 TypeScript，无现成 agent 框架；主循环、工具分发、治理、反馈、记忆、停机全部自编码；LLM 单次补全 API（底层零件）允许。
- 数据流：`run(task)` → ContextBuilder 组装（config + 记忆摘要 + 系统提示）→ LLMClient → AgentDecoder → `AgentAction` → GuardrailEngine 决策 → HITL(如需) → ToolsRegistry 分发 → 进程执行器/文件围栏 → FeedbackClassifier 判定 → 结果回灌 → 停机判断 → SessionReport + 记忆落盘。
- 外部依赖：LLM 供应商（OpenAI 兼容，可选）、本地文件系统、Node 内置 `crypto/child_process/fs/path`、`ws`、`commander`（CLI）。无数据库；记忆/会话用 jsonl。Docker 可选层（云 demo）。

---

## 6. 数据模型

| 实体 | 字段 | 关系与约束 |
|------|------|-----------|
| `Session` | id, task, status(running/done/stalled/aborted), configSnapshot, steps[], result, startedAt, endedAt | 1—N `Step`；id=ulid；`sessions/<id>.jsonl` |
| `Step` | index, action{name,args}, decision{ALLOW/ASK/BLOCK, ruleId, reason}, execution{exitCode,stdout,stderr,timedOut}, feedback{category,summary}, llmCallId, ts | 每循环一轮 1 条；不可变 append |
| `ActionRequest`（HITL） | id, sessionId, action, tier(ASK), status(PENDING/APPROVED/DENIED/TIMED_OUT), decidedBy(cli/console), createdAt, decidedAt, ttl | 1 Session—N；状态机迁移严格有序；超时 TTL 默认 120s |
| `MemoryEntry` | id, kind(task-decision/project-convention/approval-history/error), content, tags[], ts | append-only；`query` 按 kind/keywords/limit |
| `SecretEntry` | name, ciphertext, salt, iv, updatedAt | 仅存密文；`list` 掩码；名称唯一 |
| `PolicyRule` | id, tier(ALLOW/ASK/BLOCK), match{type: exact/regex/prefix/path}, pattern, reason | 优先级 BLOCK>ASK>ALLOW；`validate` 拒绝矛盾/非法 regex |
| `Config` | llm{provider,baseURL,model}, workspace, policy, sandbox{fenceOnly|docker}, budget{maxSteps,maxFailures}, memory, console{port,host} | 单 JSON 文件；缺省补齐 |

约束：所有路径绝对化 + 规范化后比较（围栏）；密文不落日志；`Session.configSnapshot` 只存策略/预算等非密字段（key 永不入快照）。

---

## 7. 凭据与分发设计

**凭据（API key）——威胁模型见 §4 T3**
- 存储：`~/.ai4se-harness/secrets.json`，AES-256-GCM 加密，主密码 scrypt 派生（随机盐 + 每写新 IV + HMAC 标签）。文件权限 0600（Windows 下仅当前用户 ACL）。
- 录入/更新/清除流程：
  - `secrets init` → 首次引导：无主密码则创建（隐藏式输入 + 二次确认），有则验证后解锁。
  - `secrets set openai <key>` → 交互式隐藏输入（不回显、不进 history）。
  - `secrets list` → 只显示 `name ••••末4位`；`get` 仅 TTY + 显式 `--reveal`，输出后进程内即弃。
  - `secrets unset <name>` → 删除密文条目。
  - Web 控制台"凭据管理"：set 走隐藏 input，list 掩码，unset 需确认。
- 备选源：`.env` 文件（`AI4SE_OPENAI_KEY=...`）——文档化明文风险（明文存储、进程环境可见），仅作本地开发便利，默认不推荐。
- 防护红线：源码/git/日志/终端 history 永不含 key；`ProcessExecutor.envFilter` 剔除所有含 SECRET/KEY/TOKEN 的环境变量；CI 扫描轻量模式（可配）。

**分发——npm 包 + Docker 镜像**
- npm：`npm i -g ai4se-harness` 或 `npx ai4se-harness`；目标机配置 key：`secrets init` 向导；`files` 白名单控制包内容（不含 secrets/demo 敏感物）。
- Docker：`docker build -t ai4se-harness .` + `docker run -p 8117:8117 ai4se-harness`（默认 mock LLM demo，无 key 可跑）；真实 LLM 时 `-v` 挂载加密 secrets 文件或经 `AI4SE_*_KEY` env（权衡文档化）——镜像内不内嵌任何 key。
- 云端 demo：镜像推 registry → Render/Railway/Fly 部署，公网 URL 提供 WebUI；默认 mock、只读态。
- README 必含：获取、运行命令、key 安全配置、已知限制（平台/架构/依赖前提，Node ≥ 20）。

---

## 8. 技术选型与理由

| 项 | 选型 | 理由 |
|----|------|------|
| 语言/运行时 | TypeScript / Node ≥ 20 | 与 Superpowers/opencode 同生态；CLI+WebUI 一门语言；`child_process/crypto/fs` 内置即足；类型安全利于确定性单测 |
| 内核 | 自编码单体模块（loop/llm/tools/governance/feedback/memory/config/secret） | 满足 A.4：主循环/分发/治理/反馈/停机均为自有代码，仅用 LLM 单次补全 API 作底层零件 |
| LLM | OpenAI 兼容协议（OpenAI/DeepSeek/Ollama-vLLM 等） | 一接口覆盖多数供应商，mock 为默认测试路径 |
| 测试 | Vitest | TS 原生、快、mock 友好、CI 一键 `npm test` |
| CLI | `commander` | 成熟、声明式子命令 |
| WebUI | Node `http` + `ws` + 原生 TS/HTML | 控制台非主贡献，轻量、零框架、可单测 API 层 |
| 存储 | jsonl + JSON 文件；Node `crypto`（scrypt+AES-256-GCM） | 无外部 DB，冷启动干净，文件级可审计 |
| 分发 | npm 包 + Docker 镜像 | 覆盖"开发机直用"与"云端部署"两种路径 |
| CI | GitHub Actions（unit-test job） | 见 §4.8/§五-6 偏离记录（用户裁决：仅 GitHub Actions） |
| 云部署 | Render/Railway/Fly（学生免费额度） | 单容器、自动 TLS、免费层足够 demo |

不做：Open Design（控制台为轻量工程控制面，非 UI 主项目，予以豁免并在 SPEC 说明）；SQLite/向量库（记忆为简单按需检索，YAGNI）。

---

## 9. 验收标准

| 功能 | 客观验收判定 |
|------|--------------|
| M1 CLI | `--help`/子命令可用；`run --demo` 非零退出只在失败时；未知子命令非零退出；错误进 stderr |
| M2 主循环 | mock LLM 下 `run()` 走完「组装→调用→解析→决策→分发→反馈→停机」且步序断言正确；不可解析输出计失败步并回灌；`stalled` 正确触发 |
| M3 LLM 抽象 | `MockLLM` 脚本化响应序列可精确注入；`OpenAICompatClient` 请求格式单测（不真连网）；key 缺失报错含提示 |
| M4 工具层 | 未知工具/参数非法 → `ToolError`；`read/write_file` 受围栏约束；`run_command` 返回结构化结果 |
| M5 治理（主贡献） | `guardrail(Action({command:"rm -rf /"}))` → BLOCK（无 LLM 断言）；规则优先级 BLOCK>ASK>ALLOW；`ScopeFence` 拒绝 `../`、符号链接逃逸、绝对路径越界；`ProcessExecutor` 超时 kill + envFilter 剔除 SECRET 键；HITL 状态机迁移 PENDING→{APPROVED,DENIED,TIMED_OUT} 幂等断言；策略非法启动即拒 |
| M6 反馈 | 校验器对真/假样本分类正确；`FeedbackClassifier` 类别映射断言 |
| M7 记忆 | 写入→`query` 按 kind/keywords 检索命中；会话注入只含摘要（非全量）断言 |
| M8 配置 | 缺省补齐；非法字段报错并指出字段名 |
| M9 凭据 | 临时目录 + 注入主密码：set→密文文件可解回原文；list 掩码；错误主密码解密失败；git grep 无明文 |
| M10 控制台 | 四功能 API 单测：会话流/审批/凭据掩码/配置只读 |
| M11 demo | `npm run demo` 确定性复现 A.6 三行为 ①护栏拦截 ②注入失败→改步 ③治理态机迁移 |
| 全局 | `npm test` 全绿；新机器按 README 三步跑通 `run --demo`；最后一次 CI pass；SPEC/PLAN/SPEC_PROCESS/AGENT_LOG/REFLECTION 齐 |

机制演示（§A.6）验收：`npm run demo` 输出含「拦截了 `rm -rf`」「反馈类别 TEST_FAILURE 后 mock 下一步改变」「HITL PENDING→APPROVED 迁移」三项明确证据。

---

## 10. 风险与未决问题

| # | 风险 | 缓解 |
|---|------|------|
| R1 | 治理"深度边界"难把握 | SPEC 锁定护栏规则引擎 + 范围围栏 + 进程执行器 + HITL 态机四件套为必做深度；控制台/demo 为支撑 |
| R2 | 通用要求五-6 要求 `.gitlab-ci.yml`，用户裁决仅 GitHub Actions | 记为显式偏离入 AGENT_LOG/SPEC；保留 `.gitlab-ci.yml` 模板作镜像备选（不入主 CI） |
| R3 | "线上部署 URL + 公网 WebUI" 与本地工具定位冲突 | 云 demo 实例（mock 驱动、只读态）满足；README 说明部署架构 |
| R4 | Node 沙箱无 OS 级隔离（非容器态） | 明确沙箱定义 = 代码级围栏；Docker 为可选强隔离层；SPEC 写明局限 |
| R5 | 符号链接逃逸等围栏边界在 Windows/Linux 行为差异 | 路径规范化用平台无关封装 + 跨平台单测 |
| R6 | mock 脚本与真实 LLM 行为差距大，demo 过于"剧本化" | 演示明确标注 deterministic scripted；真实 LLM 仅本地可选，不参与验收 |
| R7 | 控制台 WebSocket 审批在云部署下被滥用 | 云实例默认只读态/mock；开写需访问口令 + TLS，README 注明 |
| R8 | 主密码丢失即密文不可恢复 | 文档说明"忘记主密码只能 unset 重录"；无后门 |
| R9 | 进度与期末时间线 | PLAN 颗粒 2–5min/步、worktree 并行、每步可验证 |
| U1 | npm 包名占用 / 发布范围 | 待定：优先本地 `npm pack` + 容器分发，npm 发布为可选 |
| U2 | 云端免费层实例持久性（sleep/冷启动） | 演示可接受；README 注明 |
| U3 | 具体云平台（Render vs Railway vs Fly） | 实现期按免费层可用性定，不影响 SPEC |

---

## 11. 领域与机制设计（A.5 额外要求）

**领域判定（coding）四机制**
- 动作/工具：读文件、写文件、跑 shell 命令、跑测试/lint/类型检查。每个工具由 `Tool` 接口封装，行为确定、可单测、可被围栏截获。
- 客观反馈信号：运行测试/lint/类型检查的退出码与输出。客观、确定、可回灌，不依赖 LLM 自评。
- 危险动作：删除/覆盖关键文件、`rm -rf` 类命令、写工作区外、发布类命令（`git push`、`npm publish`）、资源耗尽型命令。边界由策略规则声明（tier + 匹配模式），而非 LLM 自觉。
- 记忆需求：跨会话项目约定、历史决策、HITL 审批史、踩过的坑；按需检索（kind/keywords/limit）而非全量。

**重点维度：治理/护栏/沙箱。** 它是六维中"最不依赖 LLM 智能"的一维——拦截、围栏、审批、执行约束在移除真实 LLM 后仍 100% 由代码决定，最契合 §A.4-C"移除 LLM 还剩多少可独立验证工程"的硬标准。其余五维做到可运行最低实现。

**机制编码方式（全部为确定性代码，非提示词）**
1. `GuardrailEngine.decide(action)`：规则引擎（exact/regex/prefix/path 四类匹配 + BLOCK>ASK>ALLOW 优先级）→ `{tier, ruleId, reason}`。对应 §A.4 护栏示例：`guardrail(Action({command:"rm -rf /"}))` 断言 BLOCK。
2. `ScopeFence.resolve(path, roots)`：规范化（realpath+符号链接+分隔符）→ 断言在允许根内。
3. `ProcessExecutor.run(cmd, {cwd,timeout,envFilter,maxOutput})`：cwd 拘禁、超时 kill、剔除 SECRET 类环境变量、输出截断。
4. `HITLStateMachine`：ASK 级动作 → PENDING → APPROVED/DENIED/TIMED_OUT，持久化、幂等、CLI/控制台双入口审批。
5. `FeedbackClassifier`：把测试/lint 结果映射为 `PASS/COMPILE_ERROR/TEST_FAILURE/LINT_ERROR/TIMEOUT/OTHER` 并结构化回灌。

**§A.6 三行为演示（`npm run demo`，mock LLM 确定性）**
① 护栏拦截 `rm -rf`（decide→BLOCK，命令未执行）② 注入一次失败实现 → 校验器 TEST_FAILURE 回灌 → mock 下一步改为正确实现 ③ 治理态机迁移（HITL PENDING→APPROVED→执行）。

---

## 附：对通用要求的显式偏离记录

1. 交付清单 §五-6 要求 `.gitlab-ci.yml`（含 unit-test job）→ **用户裁决：仅 GitHub Actions**。保留 `.gitlab-ci.yml` 模板文件作为备选，但不作为主 CI。
2. §五-9 要求公网 WebUI → 通过云端 mock-LLM demo 实例满足（详见 §7、§10-R3）。
3. §3.3 前端/UI 建议使用 Open Design → 控制台为轻量工程控制面（非 UI 主项目），予以豁免（详见 §8）。
