# SPEC_PROCESS.md — 规约与计划生成过程记录

> 本项目按 Superpowers 工作流产出：brainstorming → `SPEC.md` → `PLAN.md` → 冷启动验证（§4.5）→ TDD 实现。
> 本文档按通用要求 §4.4 / §4.5 记录过程证据。文档中所有"决策"均与 `SPEC.md` v0.1、`PLAN.md` v0.1 的最终内容一致。

---

## 1. Brainstorming 关键节点

Brainstorming 阶段（与主智能体多轮对话）中，智能体提出并被采纳或修正原设想的问题：

| # | 智能体追问的问题 | 我的初始设想 | 处理决策 |
|---|----------------|-------------|---------|
| 1 | "**部署形态是纯本地还是也要云端？**" 控制台必须同时满足本地可用 + 云端 demo | 只做本地 CLI | 采纳：本地控制台 + 云端 mock-demo 双形态；云端默认 mock LLM、只读态，开真实 LLM 需授权开关 + TLS |
| 2 | "**凭据若只存环境变量，演示/CI 里 key 会进日志吗？**" 要求防 T3 泄露 | 简单放 `.env` | 采纳并加强：主密码加密文件（scrypt N=16384/r=8/p=1 + AES-256-GCM，0600）+ `envFilter` 剔除 SECRET 类环境变量 + `.env` 仅文档化备选源 |
| 3 | "**演示如何证明三个机制真的在工作？**" 需要一个可重复的机制演示 | 无明确演示设计 | 采纳：`DEMO_SCRIPT` 三步确定性重演（① 拦截 `rm -rf` ② 注入失败→反馈→下一步改变 ③ HITL PENDING→APPROVED→执行），demo 工程 = 故意错误的 `sum.js` |
| 4 | "**停机条件怎么判定？**" 主循环必须有明确的终止语义 | 仅靠 LLM 自觉调用 done | 采纳：显式停机规则（done 工具 / 校验器 PASS + 有写文件 / 连续失败 ≥ maxFailures / 步数 ≥ maxSteps / abort()） |
| 5 | "**CI 用哪个平台？**" 作业允许 GitHub Actions 或 GitLab | 两个都配 | 修正：用户裁决只配 GitHub Actions（`unit-test`），`.gitlab-ci.yml` 仅留模板；已在 SPEC 附注记录显式偏离 |
| 6 | "**交付物放哪个路径？**" 默认是 docs/ 目录 | 用默认路径 | 修正：用户 override 为**根目录** `SPEC.md` / `PLAN.md` |
| 7 | "**进程执行器是否需要 OS 级隔离？**" 安全边界怎么写才诚实 | 声称"沙箱" | 采纳：明确区分——主贡献是**代码级**治理（命令守卫 + 范围围栏 + 执行器 + HITL），Docker 为可选强隔离，README 如实声明"非 OS 级隔离" |
| 8 | "**LLM 抽象怎么测？**" 不能每次跑测试都联网 | 只写接口 | 采纳：`MockLLM`（确定性脚本/函数式响应）+ `OpenAICompatClient` 双实现，所有循环测试走 mock |

## 2. 关键迭代节选（≥3 轮）

### 迭代 1：安全边界与凭据方案（brainstorming 中期）

- **节选（意译）**：我最初设想"把 key 放 `.env` 即可"。智能体追问"你提交给 Git 的代码、CI、演示截图里会不会出现 key？作业 §3.1 明确要求凭据安全存储"。
- **决策**：改为主密码加密文件方案。加密链路选 scrypt（N=16384, r=8, p=1）派生密钥 + AES-256-GCM + 随机盐 + 每写新 IV + HMAC 标签；`list` 只显示 `name ••••末4位`；`get --reveal` 仅 TTY。此决策影响后续 T3 全部设计。
- **后续影响**：`envFilter` 从"剔除已知 key"升级为"剔除所有含 SECRET/KEY/TOKEN 的环境变量"，宁可多滤不错放。

### 迭代 2：控制台双形态（brainstorming 后期）

- **节选（意译）**：我提出"做一个 WebUI 展示会话日志"。智能体追问"云端 demo 跑起来后，凭据页面怎么保证安全？"。
- **决策**：控制台拆两层——本地版 `console` 子命令（localhost + 真实 SecretStore + 可审批），云端 demo 默认 mock LLM（无 key 可跑）+ 只读态；开真实 LLM 需环境变量授权开关 + TLS（反向代理）。API 层保持同一个 `ConsoleServer`，仅依赖注入不同。

### 迭代 3：机制演示可重复性（brainstorming 收尾）

- **节选（意译）**：我最初想"演示就让真实 LLM 跑一遍"。智能体指出"真实 LLM 输出随机，作业要求确定性重演"。
- **决策**：`MockLLM(DEMO_SCRIPT)` 确定性驱动 demo；demo 工程每次复制到临时目录运行，保证可重复且不污染源码；`npm run demo` 与 `run --demo` 输出三行为证据 + SessionReport。

### 迭代 4：计划期跨平台/跨 task 一致性修复（writing-plans 阶段，本轮自检）

- **节选**：T9 测试原先用真实 `node --test` 执行但 demo/测试工程缺 `package.json {"type":"module"}`，`.js` 会被当 CJS 解析而失败。
- **决策**：新增 `pkg(dir)` 辅助写 ESM 包标识；demo 工程内置 `package.json`。同一轮批量修正：所有相对 import 补 `.js` 后缀（NodeNext/TS2835，113 处）、Windows 下路径用 `fileURLToPath`、`approvals` 路由改正则解析、`SessionRecorder` 补进 `run --demo`、`CliDeps` 注入 `gitignorePath`。
- **后续影响**：`npm run build`（tsc）成为每 task 的硬验收门，冷启动 agent 实测未触发任何 TS 错误。

## 3. AI 建议采纳 / 否决记录

**采纳**（均为 brainstorming 中智能体提出）：

1. 威胁模型分层 T1–T5 显式写进 SPEC §4（提示词注入/越界/凭据/控制台/DoS），并逐条映射到实现模块。
2. 主密码加密凭据文件（而非裸 `.env`）。
3. 确定性 mock LLM + 机制三行为演示。
4. `harness.config.json` 单文件配置 + 缺省补齐 + 解析报错指明字段。
5. 记忆模块 append-only jsonl + `query` 按 kind/keywords/limit。
6. `Session.configSnapshot` 只存非密字段的约束（key 永不入快照）。

**否决或修正**：

1. ~~主循环直接用现成 agent 框架~~ → 否决：作业 A.4 要求自编码主循环/分发/治理/反馈/停机，LLM 单次补全 API 仅作底层零件。
2. ~~云端 demo 也开放真实 LLM 与凭据写入~~ → 否决：只读态 + mock 默认，避免云环境成为 T4 攻击面。
3. ~~两个 CI 平台都配齐~~ → 用户裁决只 GitHub Actions，GitLab 留模板（显式偏离，已记入 SPEC 附录）。
4. ~~测试用 `node:test` 直接跑~~ → 修正：单测用 Vitest（TS 原生、mock 友好），`node --test` 仅用于工具层 `run_tests` 真实执行。
5. ~~默认交付物路径 docs/superpowers~~ → 用户 override 根目录。

## 4. 冷启动验证记录（§4.5）

### 4.1 执行参数

- **验证 agent**：`general` 类型子代理（与主开发智能体**不同类型**，全新 session，**未导入任何先前对话/memory**）。
- **提供材料**：仅 `SPEC.md` + `PLAN.md`（无任何口头补充解释）。
- **任务范围**：自主从 PLAN 选择 **T1（Project Foundation）+ T6a（GuardrailEngine）**。
- **运行环境**：隔离 git worktree（`.worktrees/cold-start`，分支 `cold-start/t1-t6a`）。
- **约束**：明确要求"遇到不确定之处即暂停询问，而非凭猜测继续"；不得修改 SPEC/PLAN。

### 4.2 结果

| 项 | 结果 |
|----|------|
| 停顿点 | **0 个**——两个 task 均可按 PLAN 字面执行，无需暂停 |
| 提交 | T1 `4e24150`；T6a `4b3afd7` |
| 测试 | `npm test` → **7/7 通过**（1 smoke + 6 guardrail） |
| 耗时 | T1 ≈15min；T6a ≈8min；共 ≈23min（含两遍全文阅读） |

### 4.3 停顿点与暴露的缺陷

- **停顿点**：无。agent 报告"测试、实现、命令均为 PLAN 字面量，无任何子步骤需要停下"。
- **暴露的 spec/plan 缺陷**：无阻塞性缺陷。两点非阻塞观察：
  1. PLAN T1 的 `build` 脚本（`cpSync('src/demo/project',...)` / `src/console/static`）指向 T10/T11 才存在的目录，`npm run build` 在中途运行会失败。**判定**：非缺陷——计划明确 `build` 验收只在 T13 收尾执行，彼时两目录均已存在；保持原样。
  2. 环境已存在 `.gitignore`（超集），agent 未按 PLAN 重建。**判定**：非缺陷，内容满足计划意图。

### 4.4 解读分歧

- 分歧 1：agent 按任务指令跳过"更新 PLAN.md / AGENT_LOG.md"（Step 5/6），因为冷启动指令禁止其修改 SPEC/PLAN。**判定**：是任务指令与计划的冲突，非 spec 错误；正式实现时按计划执行。
- 分歧 2：`.gitignore` 未按 PLAN 重建。**判定**：agent 正确判断"已存在即满足"，非 spec 错误。

### 4.5 产出与预期差距

- **产出**：T1 脚手架（package.json/tsconfig×2/vitest.config/CI/src/types/src/index/tests/smoke）+ T6a GuardrailEngine（含 validate、优先级 BLOCK>ASK>ALLOW、四类匹配）。与 PLAN 字面一致。
- **差距**：无功能差距。7 个测试全部按计划通过；实现与 PLAN 接口逐字段核对一致（`PolicyRule`/`PolicyError`/`GuardrailEngine.decide/validate`）。
- **解读**：冷启动未发现缺陷，意味着 PLAN 已把关键接口、测试、命令写成可执行字面量，接近"照抄即可"的清晰度。这是单人项目里可达到的最高确定性信号之一。

### 4.6 据此对 SPEC / PLAN 的修订

- **SPEC.md**：无需修订（冷启动未发现设计层面问题）。
- **PLAN.md**：无需修订（两处观察均判定为非缺陷）。
- 结论：**计划签字通过，可进入 T1 正式实现。**

## 5. 技能反思（brainstorming）

**做得好的地方**：

1. **先问再做**：brainstorming 阶段先确认部署形态、安全边界、演示方式、CI 平台、交付路径，避免了一大类返工（尤其凭据方案从 `.env` 升级为加密文件的时机很早，后续 T3 未改过一次接口）。
2. **追问驱动补漏**：问题 3（如何证明机制工作）直接催生了三行为演示的设计，成为作业 A.6 的核心交付。
3. **把用户裁决固化**：CI 平台、交付路径这类"人才能定"的项，全部在 brainstorming 里明确后写入 SPEC，执行阶段零决策漂移。

**让人不满的地方**：

1. **会话过长、产出依赖记忆**：brainstorming 多轮之后，隐性上下文极多；后续 writing-plans 阶段仅凭对话摘要无法完整重建，不得不回读 SPEC 全文对齐——教训是把关键决策尽早落盘（这次靠 SPEC 做到了，但过程中有反复）。
2. **成本高**：对单人学生项目，完整 brainstorming 流程偏重；可接受，但若题目简单，建议只保留"安全/部署/演示/交付"四类必问问题。
3. **"不确定即暂停"没有强制在流程层约束**：本次冷启动 agent 恰好零停顿，部分原因是 PLAN 写得足够字面；若 PLAN 有含混处，需要额外注入"必须暂停"指令才会生效——建议把该约束写进 PLAN 的全局约束区（本次已写入）。

---

*本文档由主开发智能体根据 brainstorming 决策日志、PLAN 自检记录、以及冷启动验证运行报告整理；验证 agent 的原始输出保存在冷启动 worktree（`.worktrees/cold-start`，提交 `4e24150`/`4b3afd7`）。*
