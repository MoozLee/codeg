# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

codeg 是一个多模式应用，支持桌面客户端和独立服务器部署，用于聚合和浏览本地 AI 编码代理的会话记录。它从多个代理（Claude Code、Codex、OpenCode、Gemini CLI、OpenClaw、Cline）的本地文件系统中读取会话数据，统一格式后在 UI 中展示。同时支持通过聊天频道（Telegram、飞书、微信）远程交互，以及项目脚手架生成、Git 工作流、终端管理等功能。

## 技术栈

- **桌面运行时**: Tauri 2（Rust 后端 + webview 前端）
- **服务器运行时**: 独立 Rust 二进制（Axum HTTP + WebSocket）
- **前端**: Next.js 16（静态导出模式）+ React 19 + TypeScript（strict）
- **样式**: Tailwind CSS v4 + shadcn/ui（radix-maia 风格）
- **国际化**: next-intl
- **数据库**: SeaORM + SQLite
- **包管理器**: pnpm

## 代码检查（任务完成后进行必要的检查）

```bash
# 前端 检查
pnpm eslint .
pnpm build

# 后端 Rust 检查（在 src-tauri/ 目录下执行）
cargo check                                                    # 桌面模式（默认）
cargo check --bin codeg-server --no-default-features           # 服务器模式
cargo clippy
cargo build
```

目前尚未配置测试框架。

## 架构

### 双模式运行

项目通过 Cargo feature flags 支持两种运行模式：

- **`tauri-runtime`（默认）**：完整桌面应用，包含 Tauri 窗口管理、系统通知、自动更新等
- **无 feature（`--no-default-features`）**：独立服务器模式，仅编译 Axum HTTP API + WebSocket

### 共享核心

- **`app_state.rs`** — `AppState` 共享状态结构，两种模式通过 `EventEmitter` 枚举区分事件发射方式
- **`web/event_bridge.rs`** — `EventEmitter::Tauri(AppHandle)` 或 `EventEmitter::WebOnly(Arc<WebEventBroadcaster>)`
- **`web/router.rs`** — Axum 路由，接受 `Arc<AppState>`
- **`web/handlers/`** — HTTP API 端点，全部使用 `Extension<Arc<AppState>>`

### Rust 后端（`src-tauri/src/`）

后端负责读取和解析本地文件系统上的代理会话文件：

- **`app_state.rs`** — 共享状态（db、连接管理器、终端管理器、事件广播器）
- **`models/`** — 共享数据结构（agent、conversation、message、folder、chat_channel、system）
- **`parsers/`** — 每个代理一个解析器（claude、codex、opencode、gemini、cline、openclaw）
- **`commands/`** — 业务逻辑，`_core` 函数供两种模式共用，`#[tauri::command]` 函数仅桌面模式
- **`web/`** — Axum HTTP API + WebSocket + 静态文件服务 + 认证中间件
- **`acp/`** — Agent Client Protocol 连接管理（注册、预检、fork、二进制缓存、终端运行时）
- **`db/`** — SeaORM + SQLite

### 前端（`src/`）

#### 核心库（`lib/`）

- **`transport/`** — Transport 抽象层（自动检测 Tauri/Web 环境切换 `invoke()`/`fetch()`）
- **`adapters/`** — AI 响应到组件渲染的适配器
- **`types.ts`** — Rust 模型的 TypeScript 镜像
- **`api.ts`** — 主 API 客户端
- **`tauri.ts`** — Tauri API 封装

#### 国际化（`i18n/`）

- 支持 10 种语言：英语、简体中文、繁体中文、日语、韩语、西班牙语、德语、法语、葡萄牙语、阿拉伯语
- 使用 next-intl 框架，消息文件存放在 `i18n/messages/`

### 数据流

桌面模式：前端 `invoke()` → Tauri 命令 → 业务逻辑 → 返回数据
服务器模式：前端 `fetch()` → Axum HTTP API → 同一业务逻辑 → 返回 JSON
实时通信：后端事件 → EventEmitter（Tauri 事件 / WebSocket 广播）→ 前端

**事件信封**：所有 ACP 流式事件通过 `EventEnvelope { seq, connection_id, payload: AcpEvent }` 发出。`#[serde(flatten)]` 让 JSON 保持平铺：`{ seq, connection_id, type, ...变体字段 }`。`seq` 是单调递增序号（当前阶段占位 `0`，后续阶段接入 `SessionState` 后严格递增），用于前端做 snapshot 与事件流的去重对账。后端 emit 统一通过 `web/event_bridge.rs::emit_acp` 辅助函数。

**会话状态（后端权威）**：每个 `AgentConnection` 持有 `Arc<RwLock<SessionState>>`，其中累积当前 turn 的 `live_message`、in-flight `active_tool_calls`、待处理 `pending_permission`、协商出的 modes/usage 等。事件发射统一通过 `web/event_bridge.rs::emit_with_state`：先 `apply_event` 写状态、`event_seq += 1`、再 emit envelope，写状态与发事件在同一个 critical section 完成。`SessionState::to_snapshot()` 输出 `LiveSessionSnapshot`——Phase 2 的 snapshot 端点直接消费此结构。

**Snapshot 端点（Phase 2）**：`acp_get_session_snapshot(connection_id)` 与 `acp_get_session_snapshot_by_conversation(conversation_id)` 返回当前 `LiveSessionSnapshot`。前端可在打开会话面板 / 浏览器刷新后调用一次拿到当前 turn 的 in-flight 状态（live_message、active_tool_calls、pending_permission、modes、usage 等），随后用 `seq` 作为锚点对 `acp://event` 流去重——丢弃 `seq <= snapshot.event_seq` 的事件即可与 live 流对齐。`ConnectionManager::get_state` 与 `find_connection_by_conversation_id` 是这两条路径的查找入口。

**前端 Snapshot 消费（Phase 3b）**：连接建立后（`connect` action 在 `dispatch CONNECTION_CREATED` 之后）非阻塞调用 `acpGetSessionSnapshot(connectionId)`，结果通过 `denormalizeSnapshot` 转换为 `SnapshotPatch` 后 dispatch `HYDRATE_FROM_SNAPSHOT`。`ConnectionState.lastAppliedSeq` 跟踪已应用 envelope 的最高 `seq`：HYDRATE 把它推到 `snapshot.event_seq`，主 `acp://event` 监听器以及 buffered-event replay 用 `if (envelope.seq <= lastAppliedSeq) return` 去重，每次成功 apply 后 dispatch `EVENT_APPLIED` 推进 `lastAppliedSeq`。HYDRATE 自身也带 race guard：若 `snapshot.event_seq <= current.lastAppliedSeq`（snapshot 在 in-flight 事件之后到达），跳过合并以免回退状态。`denormalizeSnapshot` 解析 wire 端的 `tool_call_ref` 间接引用为本地 `LiveContentBlock` 的 inline `tool_call` 块；ToolCallOutput 折叠为单个 `raw_output_chunk`（chunk 历史不可恢复，由后续 update 事件补全）。

**Phase 3c-3 保真补强**：后端 `apply_event` 现在会在 `ToolCall` / `ToolCallUpdate` 到达时向 `live_message.content` 插入 `LiveContentBlock::ToolCallRef { tool_call_id }`（按 id 幂等），在 `PlanUpdate` 到达时插入 `LiveContentBlock::Plan { entries }`（末尾 replace-then-append），两条路径都会在 `live_message` 缺失时按 text/thinking 的方式 lazy 创建。`ToolCallState` 同步带上 `locations` 与 `meta` 字段，遵循既有的 partial-update 保留规则（`Some(_)` 覆盖、`None` no-op）。前端 `denormalizeSnapshot` 中 3b 写好的 `tool_call_ref` 解析路径在此阶段才真正起作用，并把 `ToolCallInfo.locations` / `meta` 从 wire 透传而不再强置 `null`；`raw_output_chunks` 仍由 `toolStateToInfo` 折叠为单个 chunk，后续 `TOOL_CALL_UPDATE` 会逐 chunk 补齐——这是已知限制而非回退（后端不存 chunk 历史）。

**ConversationLinked 事件**：`acp_prompt` 首次调用时后端创建 conversation 行并发出 `{ type: "conversation_linked", conversation_id, folder_id }`，前端不需要再轮询 DB 查 conversation_id。Phase 3c-1 起 `send_prompt_linked` 的 backend-creates 分支要求调用方必须传 `folder_id`，未传时直接返回 `AcpError::protocol("folder_id required for new conversation row")`，不再从 `working_dir` 自动 `find-or-create`。链路汇总在 `ConnectionManager::send_prompt_linked`：snapshot 短锁 → 检查 `state.conversation_id` → 若未链接则创建 row + 通过 `emit_with_state` 发出 `ConversationLinked` → 转交 `send_prompt`。chat_channel 路径继续走 `send_prompt`（自行管理 conversation 行），不受此约束影响。

**LifecycleSubscriber**：启动时 spawn 的 Tokio 任务（`acp/lifecycle.rs::lifecycle_subscriber_task`），订阅 `acp://event` 全局 broadcaster，把跨连接的 DB 写动作（目前是 `SessionStarted` → 持久化 `external_id` 到 conversation 行）从 `emit_with_state` 热路径解耦。`lifecycle_subscriber_task` 同步调用 `subscribe()` 后返回 `impl Future`，由调用方决定 spawn 方式：桌面模式（Tauri `setup` 在 tokio 运行时之外）走 `tauri::async_runtime::spawn`，服务器模式走 `tokio::spawn`。subscribe 发生在 future 生成时而非首次 poll，确保事件不丢失。

### 条件编译约定

- `#[cfg(feature = "tauri-runtime")]` — 仅桌面模式编译（Tauri 窗口、通知、`tauri::State` 参数等）
- `#[cfg_attr(feature = "tauri-runtime", tauri::command)]` — 函数始终可用，仅在桌面模式标记为 Tauri 命令
- `_core` 后缀函数 — 接受普通引用参数（`&AppDatabase`、`&EventEmitter`），供 Web handlers 和 Tauri 命令共用

## 关键约束

- **仅支持静态导出**：`next.config.ts` 设置 `output: "export"`，不支持动态路由（`[param]`），必须使用查询参数替代
- **路径别名**：`@/*` 映射到 `./src/*`，导入写法为 `@/lib/utils`、`@/components/ui/button`
- **Rust serde 约定**：`AgentType` 序列化为 snake_case（`claude_code`、`open_code`）。Tauri 命令参数在 JS 侧使用 camelCase，Rust 侧使用 snake_case
- **服务器部署**：通过环境变量配置（`CODEG_PORT`、`CODEG_HOST`、`CODEG_TOKEN`、`CODEG_DATA_DIR`、`CODEG_STATIC_DIR`）
- **Docker 支持**：多阶段构建（Node.js + Rust），支持 `docker-compose` 一键部署

## 代码风格

- Prettier：无分号、尾逗号（es5）、2 空格缩进、80 字符宽度
- ESLint：next/core-web-vitals + typescript + prettier
- TypeScript：strict 模式，启用 `noUnusedLocals` 和 `noUnusedParameters`
- Rust：2021 edition，使用 `thiserror` 定义错误类型
