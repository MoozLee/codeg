# Codeg

[![Release](https://img.shields.io/github/v/release/xintaofei/codeg)](https://github.com/xintaofei/codeg/releases)
[![License](https://img.shields.io/github/license/xintaofei/codeg)](../../LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED)](../../Dockerfile)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <strong>繁體中文</strong> |
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Codeg（Code Generation）是一個企業級多 Agent 編碼工作台。
它將本地 AI 編碼代理（Claude Code、Codex CLI、OpenCode、Gemini CLI、
OpenClaw、Cline 等）整合到桌面應用、獨立伺服器或 Docker 容器中——透過瀏覽器即可遠端開發——支援對話彙整、並行 `git worktree`
開發、MCP/Skills 管理、訊息渠道互動（Telegram、飛書、iLink 等），以及整合的 Git/檔案/終端工作流。

## Fork / 發布線說明

本倉庫是 [xintaofei/codeg](https://github.com/xintaofei/codeg) 的一個 fork。`main` 分支會盡量與上游保持同步，而本 fork 的 `release` 分支可能會承載一些領先上游、或不一定回到上游的面向使用者功能。近期例子包括使用者訊息歷史導覽，以及跨不同執行環境可設定的檔案開啟目標與字型偏好。下文也會介紹這個 fork 提供的其他能力，包括**訊息渠道**、**`codeg-server` 部署**、**Docker 支援**和**專案啟動器**。

![gallery](../images/gallery.svg)

## 主介面
![Codeg Light](../images/main-light.png#gh-light-mode-only)
![Codeg Dark](../images/main-dark.png#gh-dark-mode-only)

## 設定
| 代理 | MCP | Skills | 版本控制 | Web 服務 |
| :---: | :---: | :---: | :---: | :---: |
| ![Agents](../images/1-light.png#gh-light-mode-only) ![Agents](../images/1-dark.png#gh-dark-mode-only) | ![MCP](../images/2-light.png#gh-light-mode-only) ![MCP](../images/2-dark.png#gh-dark-mode-only) | ![Skills](../images/3-light.png#gh-light-mode-only) ![Skills](../images/3-dark.png#gh-dark-mode-only) | ![Version Control](../images/4-light.png#gh-light-mode-only) ![Version Control](../images/4-dark.png#gh-dark-mode-only) | ![Web Service](../images/5-light.png#gh-light-mode-only) ![Web Service](../images/5-dark.png#gh-dark-mode-only) |

## 核心亮點

- 同一專案中的多 Agent 統一工作台
- 本地對話解析與結構化渲染
- 內建 `git worktree` 並行開發流程
- **專案啟動器** — 視覺化建立新專案，即時預覽效果
- **訊息渠道** — 連接 Telegram、飛書、iLink（微信）等即時通訊應用到編碼代理，即時接收通知、完整會話交互、遠端任務控制
- MCP 管理（本地掃描 + 市場搜尋/安裝）
- Skills 管理（全域與專案級）
- Git 遠端帳號管理（支援 GitHub 及其他 Git 伺服器）
- Web 服務模式 — 開啟後可在瀏覽器中存取 Codeg，支援遠端工作
- **獨立伺服器部署** — 在任意 Linux/macOS 伺服器上執行 `codeg-server`，透過瀏覽器存取
- **Docker 支援** — `docker compose up` 或 `docker run`，可自訂令牌、連接埠，支援資料持久化及專案目錄掛載
- 整合工程閉環（檔案樹、Diff、Git 變更、提交、終端）

## 專案啟動器

視覺化建立新專案：左側設定面板，右側即時預覽。

![Project Boot Light](../images/project-boot-light.png#gh-light-mode-only)
![Project Boot Dark](../images/project-boot-dark.png#gh-dark-mode-only)

### 功能特色

- **視覺化設定** — 從下拉選單中選擇樣式、色彩主題、圖示庫、字型、圓角等，預覽面板即時更新
- **即時預覽** — 在建立專案前，即時檢視所選樣式的渲染效果
- **一鍵建立** — 點擊「建立專案」，啟動器將使用您的預設設定、框架範本（Next.js / Vite / React Router / Astro / Laravel）和套件管理器（pnpm / npm / yarn / bun）執行 `shadcn init`
- **套件管理器偵測** — 自動偵測已安裝的套件管理器並顯示版本號
- **無縫整合** — 新建立的專案會立即在 Codeg 工作台中開啟

目前支援 **shadcn/ui** 專案腳手架，分頁式設計為未來支援更多專案類型做好了準備。

## 訊息渠道

連接你喜愛的即時通訊應用——Telegram、飛書、iLink（微信）等——到 AI 編碼代理。直接在聊天中建立任務、發送後續訊息、審批權限請求、恢復會話、監控代理活動——即時接收代理回應，包含工具呼叫詳情、權限提示和完成摘要。

### 支援的渠道

| 渠道 | 協定 | 狀態 |
| --- | --- | --- |
| Telegram | Bot API（HTTP 長輪詢） | 內建 |
| 飛書 | WebSocket + REST API | 內建 |
| iLink（微信） | WebSocket + REST API | 內建 |

> 更多渠道（Discord、Slack、釘釘等）計劃在未來版本中支援。

### 主要功能

- **會話交互** — 執行完整的代理會話：`/folder` 選擇專案、`/agent` 選擇代理、`/task <描述>` 啟動任務，直接發送純文字作為後續訊息。`/resume` 繼續上次會話、`/cancel` 中止任務、`/sessions` 列出活躍會話
- **權限控制** — 代理在聊天中請求工具執行權限；使用 `/approve`（或 `/approve always` 啟用自動審批）和 `/deny` 進行回應
- **事件通知** — 代理回合完成、工具呼叫和錯誤事件即時推送，支援豐富格式展示
- **查詢命令** — `/search <關鍵字>`、`/today`、`/status`、`/help` 快速查詢；支援自訂命令前綴
- **每日報告** — 在預設時間自動產生每日摘要，包括對話數量、代理類型分佈和專案活躍度
- **多語言** — 訊息範本支援 10 種語言（英語、簡體中文/繁體中文、日語、韓語、西班牙語、德語、法語、葡萄牙語、阿拉伯語）
- **安全憑據** — 令牌儲存在作業系統密鑰環中，不會暴露在設定檔或日誌中
- **豐富訊息** — Telegram 使用 Markdown 格式，飛書使用卡片佈局，iLink 使用圖文訊息；所有平台均支援純文字回退

### 設定

1. 在 **設定 → 訊息渠道** 中建立渠道（選擇 Telegram、飛書或 iLink）
2. 輸入 Bot Token（Telegram）、應用憑據（飛書）或掃碼登入（iLink）——安全儲存在作業系統密鑰環中
3. 設定事件篩選器和可選的每日報告排程
4. 連接——當代理發出事件時，訊息將開始流轉

## 支援的 Agent

| Agent | 環境變數優先路徑 | macOS / Linux 預設路徑 | Windows 預設路徑 |
| --- | --- | --- | --- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` | `~/.claude/projects` | `%USERPROFILE%\\.claude\\projects` |
| Codex CLI | `$CODEX_HOME/sessions` | `~/.codex/sessions` | `%USERPROFILE%\\.codex\\sessions` |
| OpenCode | `$XDG_DATA_HOME/opencode/opencode.db` | `~/.local/share/opencode/opencode.db` | `%USERPROFILE%\\.local\\share\\opencode\\opencode.db` |
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini` | `~/.gemini` | `%USERPROFILE%\\.gemini` |
| OpenClaw | — | `~/.openclaw/agents` | `%USERPROFILE%\\.openclaw\\agents` |
| Cline | `$CLINE_DIR` | `~/.cline/data/tasks` | `%USERPROFILE%\\.cline\\data\\tasks` |

> 注意：環境變數的優先順序高於預設路徑。

## 快速開始

### 環境需求

- Node.js `>=22`（建議）
- pnpm `>=10`
- Rust stable（2021 edition）
- Tauri 2 建置依賴（僅桌面模式）

Linux（Debian/Ubuntu）範例：

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 開發命令

```bash
pnpm install

# 前端靜態匯出到 out/
pnpm build

# 完整桌面應用（Tauri + Next.js）
pnpm tauri dev

# 僅前端
pnpm dev

# 桌面應用建置
pnpm tauri build

# 獨立伺服器（無需 Tauri/GUI）
pnpm server:dev

# 建置伺服器發行版二進位檔
pnpm server:build

# Lint
pnpm eslint .

# Rust 檢查（在 src-tauri/ 下執行）
cargo check
cargo clippy
cargo build
```

### 伺服器部署

Codeg 可以作為獨立 Web 伺服器執行，無需桌面環境。

#### 方式一：一鍵安裝（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
```

安裝指定版本或到自訂目錄：

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash -s -- --version v0.5.2 --dir ~/.local/bin
```

然後執行：

```bash
codeg-server
```

#### 方式二：一鍵安裝（Windows PowerShell）

```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
```

或安裝指定版本：

```powershell
.\install.ps1 -Version v0.5.2
```

#### 方式三：從 GitHub Releases 下載

預建置二進位檔（已打包 Web 前端資源）可在 [Releases](https://github.com/xintaofei/codeg/releases) 頁面下載：

| 平台 | 檔案 |
| --- | --- |
| Linux x64 | `codeg-server-linux-x64.tar.gz` |
| Linux arm64 | `codeg-server-linux-arm64.tar.gz` |
| macOS x64 | `codeg-server-darwin-x64.tar.gz` |
| macOS arm64 | `codeg-server-darwin-arm64.tar.gz` |
| Windows x64 | `codeg-server-windows-x64.zip` |

```bash
# 範例：下載、解壓縮、執行
tar xzf codeg-server-linux-x64.tar.gz
cd codeg-server-linux-x64
CODEG_STATIC_DIR=./web ./codeg-server
```

#### 方式四：Docker

```bash
# 使用 Docker Compose（推薦）
docker compose up -d

# 或直接使用 Docker 執行
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest

# 自訂令牌並掛載專案目錄
docker run -d -p 3080:3080 \
  -v codeg-data:/data \
  -v /path/to/projects:/projects \
  -e CODEG_TOKEN=your-secret-token \
  ghcr.io/xintaofei/codeg:latest
```

Docker 映像採用多階段建置（Node.js + Rust → 精簡 Debian 執行環境），內建 `git` 和 `ssh` 以支援倉庫操作。資料持久化儲存在 `/data` 卷中。可選掛載專案目錄以從容器內存取本地倉庫。

#### 方式五：從原始碼建置

```bash
pnpm install && pnpm build          # 建置前端
cd src-tauri
cargo build --release --bin codeg-server --no-default-features
CODEG_STATIC_DIR=../out ./target/release/codeg-server
```

#### 設定

環境變數：

| 變數 | 預設值 | 說明 |
| --- | --- | --- |
| `CODEG_PORT` | `3080` | HTTP 連接埠 |
| `CODEG_HOST` | `0.0.0.0` | 綁定位址 |
| `CODEG_TOKEN` | *（隨機）* | 認證令牌（啟動時輸出到 stderr） |
| `CODEG_DATA_DIR` | `~/.local/share/codeg` | SQLite 資料庫目錄 |
| `CODEG_STATIC_DIR` | `./web` 或 `./out` | Next.js 靜態匯出目錄 |

## 架構

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

## 開發約束

- 前端使用靜態匯出（`output: "export"`）
- 不使用 Next.js 動態路由（`[param]`），改用查詢參數
- Tauri 命令參數：前端 `camelCase`，Rust `snake_case`
- TypeScript strict 模式

## 隱私與安全

- 預設本地優先：解析、儲存、專案操作均在本地完成
- 僅在使用者主動觸發時才存取網路
- 支援系統代理，適配企業網路環境
- Web 服務模式使用基於令牌的身份認證

## 致謝

- [LinuxDO](https://linux.do)：起源社群
- [ACP](https://agentclientprotocol.com)：Agent Client Protocol (ACP) 是 codeg 實現多智能體連接的基礎

## 授權

Apache-2.0，詳見 `LICENSE`。
