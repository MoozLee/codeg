# Codeg

[![Release](https://img.shields.io/github/v/release/xintaofei/codeg)](https://github.com/xintaofei/codeg/releases)
[![License](https://img.shields.io/github/license/xintaofei/codeg)](../../LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED)](../../Dockerfile)

<p>
  <a href="../../README.md">English</a> |
  <strong>简体中文</strong> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Codeg（Code Generation）是一个企业级多 Agent 编码工作台。
它将本地 AI 编码代理（Claude Code、Codex CLI、OpenCode、Gemini CLI、
OpenClaw、Cline 等）统一到桌面应用、独立服务器或 Docker 容器中——通过浏览器即可远程开发——支持对话聚合、
并行 `git worktree` 开发、MCP/Skills 管理、消息渠道交互（Telegram、飞书、iLink 等），以及集成的 Git/文件/终端工作流。

## Fork / 发布线说明

本仓库是 [xintaofei/codeg](https://github.com/xintaofei/codeg) 的一个 fork。`main` 分支会尽量保持与上游同步，而本 fork 的 `release` 分支可能会承载一些领先于上游、或不一定回到上游的面向用户功能。近期示例包括用户消息历史导航，以及跨不同运行时可配置的文件打开目标和字体偏好。下文也会介绍这个 fork 提供的其他能力，包括**消息渠道**、**`codeg-server` 部署**、**Docker 支持**和**项目启动器**。

![gallery](../images/gallery.svg)

## 主界面
![Codeg Light](../images/main-light.png#gh-light-mode-only)
![Codeg Dark](../images/main-dark.png#gh-dark-mode-only)

## 设置
| 代理 | MCP | Skills | 版本控制 | Web 服务 |
| :---: | :---: | :---: | :---: | :---: |
| ![Agents](../images/1-light.png#gh-light-mode-only) ![Agents](../images/1-dark.png#gh-dark-mode-only) | ![MCP](../images/2-light.png#gh-light-mode-only) ![MCP](../images/2-dark.png#gh-dark-mode-only) | ![Skills](../images/3-light.png#gh-light-mode-only) ![Skills](../images/3-dark.png#gh-dark-mode-only) | ![Version Control](../images/4-light.png#gh-light-mode-only) ![Version Control](../images/4-dark.png#gh-dark-mode-only) | ![Web Service](../images/5-light.png#gh-light-mode-only) ![Web Service](../images/5-dark.png#gh-dark-mode-only) |

## 核心亮点

- 同一项目中的多 Agent 统一工作台
- 本地对话解析与结构化渲染
- 内置 `git worktree` 并行开发流程
- **项目启动器** — 可视化创建新项目，实时预览效果
- **消息渠道** — 连接 Telegram、飞书、iLink（微信）等即时通讯应用到编码代理，实时接收通知、完整会话交互、远程任务控制
- MCP 管理（本地扫描 + 市场搜索/安装）
- Skills 管理（全局与项目级）
- Git 远程账号管理（支持 GitHub 及其它 Git 服务器）
- Web 服务模式 — 开启后可在浏览器中访问 Codeg，支持远程工作
- **独立服务器部署** — 在任意 Linux/macOS 服务器上运行 `codeg-server`，通过浏览器访问
- **Docker 支持** — `docker compose up` 或 `docker run`，可自定义令牌、端口，支持数据持久化及项目目录挂载
- 集成工程闭环（文件树、Diff、Git 变更、提交、终端）

## 项目启动器

可视化创建新项目：左侧配置面板，右侧实时预览。

![Project Boot Light](../images/project-boot-light.png#gh-light-mode-only)
![Project Boot Dark](../images/project-boot-dark.png#gh-dark-mode-only)

### 功能特性

- **可视化配置** — 从下拉菜单中选择样式、颜色主题、图标库、字体、圆角等，预览面板即时更新
- **实时预览** — 在创建项目前，实时查看所选样式的渲染效果
- **一键创建** — 点击"创建项目"，启动器将使用您的预设配置、框架模板（Next.js / Vite / React Router / Astro / Laravel）和包管理器（pnpm / npm / yarn / bun）执行 `shadcn init`
- **包管理器检测** — 自动检测已安装的包管理器并显示版本号
- **无缝集成** — 新创建的项目会立即在 Codeg 工作台中打开

目前支持 **shadcn/ui** 项目脚手架，选项卡式设计为未来支持更多项目类型做好了准备。

## 消息渠道

连接你喜爱的即时通讯应用——Telegram、飞书、iLink（微信）等——到 AI 编码代理。直接在聊天中创建任务、发送后续消息、审批权限、恢复会话、监控活动。实时接收代理响应（包含工具调用详情、权限提示和完成摘要），无需打开浏览器。

### 支持的渠道

| 渠道 | 协议 | 状态 |
| --- | --- | --- |
| Telegram | Bot API（HTTP 长轮询） | 内置 |
| 飞书 | WebSocket + REST API | 内置 |
| iLink（微信） | WebSocket + REST API | 内置 |

> 更多渠道（Discord、Slack、钉钉等）计划在未来版本中支持。

### 主要功能

- **会话交互** — 在聊天应用中运行完整代理会话：`/folder` 选择项目、`/agent` 选择代理、`/task <描述>` 启动任务，然后直接发送纯文本作为后续消息。`/resume` 恢复历史会话、`/cancel` 取消任务、`/sessions` 查看活跃会话
- **权限控制** — 代理可在聊天中请求工具执行权限；使用 `/approve`（或 `/approve always` 自动审批）和 `/deny` 响应，无需切换上下文
- **事件通知** — 代理回合完成、工具调用和错误事件实时推送到所有已启用渠道，支持富文本格式
- **查询命令** — `/search <关键词>`、`/today`、`/status`、`/help` 快速查询；支持自定义命令前缀
- **每日报告** — 在预设时间自动生成每日摘要，包括对话数量、代理类型分布和项目活跃度
- **多语言** — 消息模板支持 10 种语言（英语、简体中文/繁体中文、日语、韩语、西班牙语、德语、法语、葡萄牙语、阿拉伯语）
- **安全凭据** — 令牌存储在操作系统密钥环中，不会暴露在配置文件或日志中
- **富文本消息** — Telegram 使用 Markdown 格式，飞书使用卡片布局，iLink 使用图文消息；所有平台均支持纯文本回退

### 设置

1. 在 **设置 → 消息渠道** 中创建渠道（选择 Telegram、飞书或 iLink）
2. 输入 Bot Token（Telegram）、应用凭据（飞书）或扫码登录（iLink）——安全存储在操作系统密钥环中
3. 配置事件过滤器和可选的每日报告计划
4. 连接——当代理发出事件时，消息将开始流转

## 支持的Agent

| Agent | 环境变量优先路径 | macOS / Linux 默认路径 | Windows 默认路径 |
| --- | --- | --- | --- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` | `~/.claude/projects` | `%USERPROFILE%\\.claude\\projects` |
| Codex CLI | `$CODEX_HOME/sessions` | `~/.codex/sessions` | `%USERPROFILE%\\.codex\\sessions` |
| OpenCode | `$XDG_DATA_HOME/opencode/opencode.db` | `~/.local/share/opencode/opencode.db` | `%USERPROFILE%\\.local\\share\\opencode\\opencode.db` |
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini` | `~/.gemini` | `%USERPROFILE%\\.gemini` |
| OpenClaw | — | `~/.openclaw/agents` | `%USERPROFILE%\\.openclaw\\agents` |
| Cline | `$CLINE_DIR` | `~/.cline/data/tasks` | `%USERPROFILE%\\.cline\\data\\tasks` |

> 注意：环境变量的优先级高于默认路径。

## 快速开始

### 环境要求

- Node.js `>=22`（推荐）
- pnpm `>=10`
- Rust stable（2021 edition）
- Tauri 2 构建依赖（仅桌面模式）

Linux（Debian/Ubuntu）示例：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 开发命令

```bash
pnpm install

# 前端静态导出到 out/
pnpm build

# 完整桌面应用（Tauri + Next.js）
pnpm tauri dev

# 仅前端
pnpm dev

# 桌面应用构建
pnpm tauri build

# 独立服务器（无需 Tauri/GUI）
pnpm server:dev

# 构建服务器发布二进制
pnpm server:build

# Lint
pnpm eslint .

# Rust 检查（在 src-tauri/ 下执行）
cargo check
cargo clippy
cargo build
```

### 服务器部署

Codeg 可以作为独立 Web 服务器运行，无需桌面环境。

#### 方式一：一键安装（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
```

安装指定版本或到自定义目录：

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash -s -- --version v0.5.2 --dir ~/.local/bin
```

然后运行：

```bash
codeg-server
```

#### 方式二：一键安装（Windows PowerShell）

```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
```

或安装指定版本：

```powershell
.\install.ps1 -Version v0.5.2
```

#### 方式三：从 GitHub Releases 下载

预构建二进制文件（已打包 Web 前端资源）可在 [Releases](https://github.com/xintaofei/codeg/releases) 页面下载：

| 平台 | 文件 |
| --- | --- |
| Linux x64 | `codeg-server-linux-x64.tar.gz` |
| Linux arm64 | `codeg-server-linux-arm64.tar.gz` |
| macOS x64 | `codeg-server-darwin-x64.tar.gz` |
| macOS arm64 | `codeg-server-darwin-arm64.tar.gz` |
| Windows x64 | `codeg-server-windows-x64.zip` |

```bash
# 示例：下载、解压、运行
tar xzf codeg-server-linux-x64.tar.gz
cd codeg-server-linux-x64
CODEG_STATIC_DIR=./web ./codeg-server
```

#### 方式四：Docker

```bash
# 使用 Docker Compose（推荐）
docker compose up -d

# 或直接使用 Docker 运行
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest

# 自定义令牌并挂载项目目录
docker run -d -p 3080:3080 \
  -v codeg-data:/data \
  -v /path/to/projects:/projects \
  -e CODEG_TOKEN=your-secret-token \
  ghcr.io/xintaofei/codeg:latest
```

Docker 镜像采用多阶段构建（Node.js + Rust → 精简 Debian 运行时），内置 `git` 和 `ssh` 以支持仓库操作。数据持久化存储在 `/data` 卷中。可选挂载项目目录以从容器内访问本地仓库。

#### 方式五：从源码构建

```bash
pnpm install && pnpm build          # 构建前端
cd src-tauri
cargo build --release --bin codeg-server --no-default-features
CODEG_STATIC_DIR=../out ./target/release/codeg-server
```

#### 配置

环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEG_PORT` | `3080` | HTTP 端口 |
| `CODEG_HOST` | `0.0.0.0` | 绑定地址 |
| `CODEG_TOKEN` | *（随机）* | 认证令牌（启动时输出到 stderr） |
| `CODEG_DATA_DIR` | `~/.local/share/codeg` | SQLite 数据库目录 |
| `CODEG_STATIC_DIR` | `./web` 或 `./out` | Next.js 静态导出目录 |

## 架构

```text
Next.js 16 (Static Export) + React 19
        |
        | invoke() (desktop) / fetch() + WebSocket (web)
        v
  ┌─────────────────────────┐
  │   Transport Abstraction  │
  │  (Tauri IPC or HTTP/WS) │
  └─────────────────────────┘
        |
        v
┌─── Tauri Desktop ───┐    ┌─── codeg-server ───┐
│  Tauri 2 Commands    │    │  Axum HTTP + WS    │
│  (window management) │    │  (standalone mode)  │
└──────────┬───────────┘    └──────────┬──────────┘
           └──────────┬───────────────┘
                      v
            Shared Rust Core
              |- AppState
              |- ACP Manager
              |- Parsers (conversation ingestion)
              |- Chat Channels
              |- Git / File Tree / Terminal
              |- MCP marketplace + config
              |- SeaORM + SQLite
                      |
              ┌───────┼───────┐
              v       v       v
  Local Filesystem  Git   Chat Channels
    / Git Repos    Repos  (Telegram, Lark, iLink)
```

## 开发约束

- 前端使用静态导出（`output: "export"`）
- 不使用 Next.js 动态路由（`[param]`），统一使用查询参数
- Tauri 命令参数：前端 `camelCase`，Rust `snake_case`
- TypeScript strict 模式

## 隐私与安全

- 默认本地优先：解析、存储、项目操作均在本地完成
- 仅在用户主动触发时才访问网络
- 支持系统代理，适配企业网络环境
- Web 服务模式使用基于令牌的身份认证

## 鸣谢

- [LinuxDO](https://linux.do)：起源社区
- [ACP](https://agentclientprotocol.com)：智能体客户端协议 (ACP) 是 codeg 实现多智能体连接的基础

## 许可证

Apache-2.0，详见 `LICENSE`。
