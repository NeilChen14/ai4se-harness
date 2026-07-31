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
