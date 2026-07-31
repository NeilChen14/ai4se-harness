# AGENTS.md — 会话续接入口

本项目按 **Superpowers 工作流**推进。任何新会话开始工作前，必须先读取以下文件，严格按 PLAN 继续，不要自行重排任务顺序。

## 读取顺序（必读）

1. `SPEC.md` — 设计规约（唯一事实来源，勿改）。
2. `PLAN.md` — 实现计划（唯一任务清单，逐 task 打勾 + 记录 commit hash）。
3. `AGENT_LOG.md` — 开发过程日志。
4. `SPEC_PROCESS.md` — 规约/计划生成过程与冷启动验证记录。

## 如何继续

- 打开 `PLAN.md`，找到**第一个未勾选的 task**，从那里继续。
- 每个 task 严格 TDD：**先写失败测试 → 确认红 → 最小实现 → 确认绿 → `npm run build` 通过 → 按计划 commit → 勾选 PLAN.md 并记录 `git rev-parse --short HEAD` → 更新 AGENT_LOG.md → 再 commit 文档**。
- 依赖顺序见 PLAN.md「依赖与并行」：T1 → T2–T8（Phase 1）→ T9 → T10/T11 → T12 → T13。

## 硬纪律（不可违反）

- 相对 import 一律带 `.js` 后缀（NodeNext/TS2835）。
- 凭据永不硬编码、永不提交、永不写入日志/回显；`SecretStore` 只存密文。
- 不确定的计划内容先暂停询问，不要凭猜测实现。
- 每次提交前 `git status` 核对只暂存本 task 文件。
- T6a 的已验证代码在分支 `cold-start/t1-t6a`（commit `4b3afd7`），届时 cherry-pick 而非重写。

## 验证命令

- 单测：`npx vitest run <file>`
- 全量：`npm test`
- 类型/打包门禁：`npm run build`（每 task 完成必须通过）
- demo（T11 后可用）：`npm run demo`
