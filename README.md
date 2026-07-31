# ai4se-harness

A self-hosted coding agent harness. **Agent = LLM + Harness**：LLM 只负责"下一步输出什么动作"，其余全部由确定性代码接管——主循环、工具分发、治理护栏、范围围栏、进程执行、反馈分类、记忆、审批。本项目的核心贡献在**治理/护栏/沙箱**这一维度：拦截、围栏、审批与执行约束全部是代码逻辑，不依赖 LLM 的自觉或提示词。

要求 Node ≥ 20。

## 安装

```bash
npm i -g ai4se-harness   # 全局安装（bin: ai4se-harness）
# 或无需安装，直接用：
npx ai4se-harness --help
```

本地开发运行：`npm install`，命令用 `npm run dev -- <args>`，测试用 `npm test`，构建用 `npm run build`。

## 快速运行

**无 key 演示**（mock LLM，确定性三机制演示：护栏拦截 / 失败反馈改步 / HITL 审批）：

```bash
ai4se-harness run --demo
```

**真实 LLM 完整流程**：

```bash
ai4se-harness init                                    # 生成 harness.config.json 模板 + .gitignore
ai4se-harness secrets init                            # 创建主密码加密的凭据库
ai4se-harness secrets set openai                      # 存入 OpenAI 兼容 API key（掩码输入）
ai4se-harness run --task "修复 src/sum.js 使测试通过"   # 运行一个会话
```

会话过程与结果落盘到 `sessions/<sessionId>.jsonl`，命令结束时打印摘要；`done` 状态退出码 0，`stalled`/`aborted` 退出码 1。

**配置**：`harness.config.json`（缺省自动补齐）。`llm.provider` 支持 `mock` 与 `openai-compat`（配 `baseURL`/`model`）；`policy` 声明护栏规则（`exact`/`regex`/`prefix`/`path` 四类匹配，tier 为 `ALLOW`/`ASK`/`BLOCK`，`BLOCK > ASK > ALLOW` 优先级）；`tools.enabled` 白名单；`budget.maxSteps`/`maxFailures` 控制预算。

```bash
ai4se-harness policy validate policy.json              # 校验策略文件，非法退出非零
```

## Web 控制台

```bash
ai4se-harness console           # 默认 http://127.0.0.1:8117
```

控制台提供会话流实时日志（WS）、Demo 一键运行、审批、凭据查看与配置只读页。默认绑定 `127.0.0.1`。

**只读模式（云端 demo）**：设置环境变量 `AI4SE_READONLY=1` 启动 console 时，不要求本机存在凭据文件，凭据 API 一律只读（GET 返回空、POST/DELETE 返回 403），页面隐藏凭据表单并显示只读横幅；适合部署为公网 mock demo 实例（见「云端部署」）。

## Docker 分发

```bash
docker build -t ai4se-harness .
docker run -p 8117:8117 ai4se-harness        # mock demo 控制台
```

真实 LLM 时需把主密码加密的凭据文件挂进容器并注入主密码（权衡：容器内读写凭据与挂载路径需自行管理）：

```bash
docker run -p 8117:8117 \
  -v ~/.ai4se-harness:/root/.ai4se-harness \
  ai4se-harness
```

## 云端部署（公网 mock demo）

镜像内不内嵌任何 key，云端实例以 `AI4SE_READONLY=1` 运行，只提供 mock demo 与只读页面。以 Render 免费 Web Service 为例：

1. 把仓库推到 GitHub，在 Render 新建 **Web Service**，选择该仓库与分支。
2. Build 命令：`docker build -t ai4se-harness .`；Start 命令：`docker run -p 8117:8117 -e AI4SE_READONLY=1 ai4se-harness`（或直接在服务的环境变量里设 `AI4SE_READONLY=1`）。
3. 平台自动分配公网 URL 并配 TLS（https）。
4. **验收**：打开公网 URL → 页面显示只读横幅、凭据表单隐藏；点「运行 Demo 会话」应输出 ① 拦截 `rm -rf` ② 失败反馈改步 ③ HITL 审批三行日志。凭据 API 写入应返回 403。

> 安全：公网实例不开真实 LLM、不接收任何 key（SPEC §4-T4）。开放真实 LLM 需额外授权开关 + TLS 并在反向代理层处理，默认不建议。

## 凭据安全

- API key 存于主密码加密文件 `~/.ai4se-harness/secrets.json`：scrypt 派生密钥 + AES-256-GCM + 随机盐 + 每写新 IV + HMAC 标签，文件权限 `0600`，**绝不落盘明文、绝不打印明文**。`secrets list` 只显示 `name ••••末4位`；`secrets get <name> --reveal` 仅在 TTY 下可用。
- 忘掉主密码即不可恢复，只能 `secrets unset <name>` 后重录（无后门）。
- 进程执行器用 `envFilter` 过滤环境变量（含 `SECRET`/`KEY`/`TOKEN`/`PASSWORD` 的键）后才会传给子进程；`.env` 仅作为文档化的备选源，明文风险自担。
- 代码与 CI 均不包含、不接受任何真实 key。

## 安全边界（重要）

本项目的"沙箱"是**代码级**围栏，**不是 OS 级隔离**：

1. **命令守卫**（GuardrailEngine）：策略规则匹配动作，`BLOCK` 直接拦截（不执行）。
2. **范围围栏**（ScopeFence）：路径规范化 + `realpath` + 符号链接解析，拒绝 `../` 逃逸、绝对路径越界、符号链接逃逸；win32 忽略大小写。
3. **进程执行器**（ProcessExecutor）：cwd 拘禁、超时 kill、输出 1MB 截断、`envFilter` 剔除凭据环境变量。
4. **人工审批**（HITL）：`ASK` 级动作进入 `PENDING → APPROVED/DENIED/TIMED_OUT` 状态机，CLI 与控制台双入口审批，幂等。

需要更强隔离时使用 Docker 镜像（`Dockerfile` 提供了打包与运行方式），但默认交付是进程内代码级围栏，不对抗恶意宿主。

## 目录结构

```
src/
├── cli.ts               CLI 入口（commander）：init / run / console / secrets / policy validate
├── cli/                 掩码/普通输入读取（readHidden / readLine）
├── config/              配置类型、默认值补齐、加载与校验（harness.config.json）
├── llm/                 LLM 抽象：client 接口、动作解码、MockLLM、OpenAI 兼容客户端
├── loop/                主循环 HarnessSession：组装→调用→解析→决策→分发→反馈→停机
├── governance/          治理（核心）：guardrail 规则引擎、scope 范围围栏、executor 进程执行、hitl 审批态机、store
├── tools/               工具层：registry 注册表 + read/write_file + run_command/run_tests/run_typecheck/run_lint/done
├── feedback/            反馈分类（PASS/COMPILE_ERROR/TEST_FAILURE/LINT_ERROR/TIMEOUT/OTHER）
├── memory/              跨会话记忆（append-only jsonl + 按 kind/keywords 检索）
├── secret/              凭据存储（scrypt + AES-256-GCM 加密文件）
├── console/             Web 控制台（Node http + ws）与静态页
├── demo/                机制演示（mock LLM 确定性脚本 + demo 工程）
└── session/             会话记录落盘（sessions/<id>.jsonl）
```

## 已知限制

- 需要 Node ≥ 20（ESM + `node:test` 等）。
- 路径规范化在 Windows 与 Linux 上行为存在差异（win32 忽略大小写、`\` 分隔符），跨平台使用以单元测试覆盖的主要路径为准。
- `run_lint` 依赖项目自身配置了 `npm run lint` 脚本。
- `--demo` 是 deterministic scripted 的 mock 演示，不反映真实 LLM 的行为多样性与输出格式波动。
- 单会话串行；控制台可并发挂接多个会话只读流。
- 云部署只建议 mock 只读态；开放真实 LLM 需自行加授权开关与 TLS（见 SPEC §4 T4）。
