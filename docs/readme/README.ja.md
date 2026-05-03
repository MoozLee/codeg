# Codeg

[![Release](https://img.shields.io/github/v/release/xintaofei/codeg)](https://github.com/xintaofei/codeg/releases)
[![License](https://img.shields.io/github/license/xintaofei/codeg)](../../LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB)](https://tauri.app/)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](https://nextjs.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED)](../../Dockerfile)

<p>
  <a href="../../README.md">English</a> |
  <a href="./README.zh-CN.md">简体中文</a> |
  <a href="./README.zh-TW.md">繁體中文</a> |
  <strong>日本語</strong> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <a href="./README.pt.md">Português</a> |
  <a href="./README.ar.md">العربية</a>
</p>

Codeg（Code Generation）は、エンタープライズ級のマルチ Agent コーディングワークスペースです。
Claude Code、Codex CLI、OpenCode、Gemini CLI、OpenClaw、Cline などのローカル AI コーディング Agent を
デスクトップアプリ、スタンドアロンサーバー、または Docker コンテナに統合し——ブラウザからどこでもリモート開発が可能——会話集約、並列 `git worktree` 開発、MCP/Skills 管理、
チャットチャンネル連携（Telegram、Lark、iLink など）、Git/ファイル/ターミナル連携ワークフローを提供します。

## フォーク / リリース系統について

このリポジトリは [xintaofei/codeg](https://github.com/xintaofei/codeg) のフォークです。`main` ブランチは upstream に近い状態を保ちつつ、このフォークの `release` ブランチでは upstream に先行する、または upstream 以外のユーザー向け機能を含む場合があります。最近の例としては、ユーザーメッセージ履歴ナビゲーションや、ランタイム間で設定できるファイルオープン先・フォント設定などがあります。さらにこのフォーク独自の機能として、**チャットチャンネル**、**`codeg-server` デプロイ**、**Docker サポート**、**プロジェクトブート** などを以下で紹介しています。

![gallery](../images/gallery.svg)

## メインインターフェース
![Codeg Light](../images/main-light.png#gh-light-mode-only)
![Codeg Dark](../images/main-dark.png#gh-dark-mode-only)

## 設定
| エージェント | MCP | Skills | バージョン管理 | Web サービス |
| :---: | :---: | :---: | :---: | :---: |
| ![Agents](../images/1-light.png#gh-light-mode-only) ![Agents](../images/1-dark.png#gh-dark-mode-only) | ![MCP](../images/2-light.png#gh-light-mode-only) ![MCP](../images/2-dark.png#gh-dark-mode-only) | ![Skills](../images/3-light.png#gh-light-mode-only) ![Skills](../images/3-dark.png#gh-dark-mode-only) | ![Version Control](../images/4-light.png#gh-light-mode-only) ![Version Control](../images/4-dark.png#gh-dark-mode-only) | ![Web Service](../images/5-light.png#gh-light-mode-only) ![Web Service](../images/5-dark.png#gh-dark-mode-only) |

## ハイライト

- 同一プロジェクトでのマルチ Agent 統合ワークスペース
- ローカル会話の取り込みと構造化レンダリング
- 内蔵 `git worktree` フローによる並列開発
- **プロジェクトブート** — ビジュアル設定とライブプレビューで新規プロジェクトを作成
- **チャットチャンネル** — Telegram、Lark（Feishu）、iLink（Weixin）などをコーディング Agent に接続し、リアルタイム通知の受信、フルセッション操作、リモートタスク制御を実行
- MCP 管理（ローカルスキャン + レジストリ検索/インストール）
- Skills 管理（グローバルおよびプロジェクトスコープ）
- Git リモートアカウント管理（GitHub およびその他の Git サーバー）
- Web サービスモード — ブラウザから Codeg にアクセスでき、リモートワークに対応
- **スタンドアロンサーバーデプロイ** — 任意の Linux/macOS サーバーで `codeg-server` を実行し、ブラウザからアクセス
- **Docker サポート** — `docker compose up` または `docker run` に対応、カスタムトークン・ポート設定、データ永続化およびプロジェクトディレクトリのマウントをサポート
- 統合エンジニアリングループ（ファイルツリー、Diff、Git 変更、コミット、ターミナル）

## プロジェクトブート

分割ペインインターフェースで新規プロジェクトをビジュアルに作成：左側で設定、右側でリアルタイムプレビュー。

![Project Boot Light](../images/project-boot-light.png#gh-light-mode-only)
![Project Boot Dark](../images/project-boot-dark.png#gh-dark-mode-only)

### 主な機能

- **ビジュアル設定** — ドロップダウンからスタイル、カラーテーマ、アイコンライブラリ、フォント、角丸などを選択でき、プレビューが即座に更新
- **ライブプレビュー** — プロジェクト作成前に、選んだルック＆フィールをリアルタイムで確認
- **ワンクリック作成** — 「プロジェクト作成」をクリックすると、プリセット設定、フレームワークテンプレート（Next.js / Vite / React Router / Astro / Laravel）、パッケージマネージャー（pnpm / npm / yarn / bun）で `shadcn init` を実行
- **パッケージマネージャー検出** — インストール済みのパッケージマネージャーを自動検出し、バージョンを表示
- **シームレスな統合** — 新規作成されたプロジェクトは、すぐに Codeg のワークスペースで開きます

現在 **shadcn/ui** プロジェクトのスキャフォールディングをサポートしており、タブベースの設計で将来のプロジェクトタイプ追加に対応しています。

## チャットチャンネル

お気に入りのメッセージングアプリ — Telegram、Lark（Feishu）、iLink（Weixin）など — を AI コーディング Agent に接続。チャットからタスクの作成、フォローアップメッセージの送信、権限の承認、セッションの再開、アクティビティの監視が可能です。Agent のレスポンスはツールコール詳細、権限プロンプト、完了サマリーとともにリアルタイムで受信 — ブラウザを開くことなくすべて対応可能。

### 対応チャンネル

| チャンネル | プロトコル | 状態 |
| --- | --- | --- |
| Telegram | Bot API（HTTP ロングポーリング） | 内蔵 |
| Lark（Feishu） | WebSocket + REST API | 内蔵 |
| iLink（Weixin） | WebSocket + REST API | 内蔵 |

> その他のチャンネル（Discord、Slack、DingTalk など）は今後のリリースで対応予定。

### 主な機能

- **セッション操作** — チャットからフル Agent セッションを実行：`/folder` でプロジェクト選択、`/agent` で Agent 選択、`/task <説明>` でタスク開始、プレーンテキストでフォローアップ送信。`/resume` で前回セッションを継続、`/cancel` で中止、`/sessions` でアクティブセッション一覧を表示
- **権限制御** — Agent がツール実行権限をチャット内でリクエスト。`/approve`（または `/approve always` で自動承認）と `/deny` で応答
- **イベント通知** — Agent のターン完了、ツールコール、エラーがリッチフォーマットでリアルタイムにプッシュ
- **クエリコマンド** — `/search <キーワード>`、`/today`、`/status`、`/help` でクイック検索。コマンドプレフィックスの設定が可能
- **日次レポート** — 予定された時刻に自動日次サマリーを生成（会話数、Agent タイプ別内訳、プロジェクトアクティビティを含む）
- **多言語対応** — メッセージテンプレートは 10 言語に対応（英語、簡体字/繁体字中国語、日本語、韓国語、スペイン語、ドイツ語、フランス語、ポルトガル語、アラビア語）
- **セキュアな認証情報** — トークンは OS キーリングに保存され、設定ファイルやログに公開されません
- **リッチメッセージ** — Telegram では Markdown フォーマット、Lark ではカードベースレイアウト、iLink ではリッチテキストメッセージ。すべてのプラットフォームでプレーンテキストフォールバックに対応

### セットアップ

1. **設定 → チャットチャンネル** でチャンネルを作成（Telegram、Lark、または iLink を選択）
2. ボットトークン（Telegram）、アプリ認証情報（Lark）、または QR コードでログイン（iLink）— OS キーリングに安全に保存
3. イベントフィルターとオプションの日次レポートスケジュールを設定
4. 接続 — Agent がイベントを発行するとメッセージが流れ始めます

## 対応エージェント

| Agent | 環境変数パス | macOS / Linux デフォルト | Windows デフォルト |
| --- | --- | --- | --- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` | `~/.claude/projects` | `%USERPROFILE%\\.claude\\projects` |
| Codex CLI | `$CODEX_HOME/sessions` | `~/.codex/sessions` | `%USERPROFILE%\\.codex\\sessions` |
| OpenCode | `$XDG_DATA_HOME/opencode/opencode.db` | `~/.local/share/opencode/opencode.db` | `%USERPROFILE%\\.local\\share\\opencode\\opencode.db` |
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini` | `~/.gemini` | `%USERPROFILE%\\.gemini` |
| OpenClaw | — | `~/.openclaw/agents` | `%USERPROFILE%\\.openclaw\\agents` |
| Cline | `$CLINE_DIR` | `~/.cline/data/tasks` | `%USERPROFILE%\\.cline\\data\\tasks` |

> 注: 環境変数はフォールバックパスより優先されます。

## クイックスタート

### 必要条件

- Node.js `>=22`（推奨）
- pnpm `>=10`
- Rust stable（2021 edition）
- Tauri 2 ビルド依存パッケージ（デスクトップモードのみ）

Linux（Debian/Ubuntu）の例:

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### 開発

```bash
pnpm install

# フロントエンド静的エクスポート（out/ へ）
pnpm build

# デスクトップアプリ全体（Tauri + Next.js）
pnpm tauri dev

# フロントエンドのみ
pnpm dev

# デスクトップビルド
pnpm tauri build

# スタンドアロンサーバー（Tauri/GUI 不要）
pnpm server:dev

# サーバーリリースバイナリのビルド
pnpm server:build

# Lint
pnpm eslint .

# Rust チェック（src-tauri/ で実行）
cargo check
cargo clippy
cargo build
```

### サーバーデプロイ

Codeg はデスクトップ環境なしでスタンドアロン Web サーバーとして実行できます。

#### オプション 1: ワンラインインストール（Linux / macOS）

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
```

特定のバージョンまたはカスタムディレクトリにインストール:

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash -s -- --version v0.5.2 --dir ~/.local/bin
```

実行:

```bash
codeg-server
```

#### オプション 2: ワンラインインストール（Windows PowerShell）

```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
```

または特定のバージョンをインストール:

```powershell
.\install.ps1 -Version v0.5.2
```

#### オプション 3: GitHub Releases からダウンロード

ビルド済みバイナリ（Web アセットをバンドル済み）は [Releases](https://github.com/xintaofei/codeg/releases) ページからダウンロードできます:

| プラットフォーム | ファイル |
| --- | --- |
| Linux x64 | `codeg-server-linux-x64.tar.gz` |
| Linux arm64 | `codeg-server-linux-arm64.tar.gz` |
| macOS x64 | `codeg-server-darwin-x64.tar.gz` |
| macOS arm64 | `codeg-server-darwin-arm64.tar.gz` |
| Windows x64 | `codeg-server-windows-x64.zip` |

```bash
# 例: ダウンロード、解凍、実行
tar xzf codeg-server-linux-x64.tar.gz
cd codeg-server-linux-x64
CODEG_STATIC_DIR=./web ./codeg-server
```

#### オプション 4: Docker

```bash
# Docker Compose を使用（推奨）
docker compose up -d

# または Docker で直接実行
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest

# カスタムトークンとプロジェクトディレクトリのマウント
docker run -d -p 3080:3080 \
  -v codeg-data:/data \
  -v /path/to/projects:/projects \
  -e CODEG_TOKEN=your-secret-token \
  ghcr.io/xintaofei/codeg:latest
```

Docker イメージはマルチステージビルド（Node.js + Rust → 軽量 Debian ランタイム）を使用し、リポジトリ操作用の `git` と `ssh` を含みます。データは `/data` ボリュームに永続化されます。オプションでプロジェクトディレクトリをマウントして、コンテナ内からローカルリポジトリにアクセスできます。

#### オプション 5: ソースからビルド

```bash
pnpm install && pnpm build          # フロントエンドをビルド
cd src-tauri
cargo build --release --bin codeg-server --no-default-features
CODEG_STATIC_DIR=../out ./target/release/codeg-server
```

#### 設定

環境変数:

| 変数 | デフォルト | 説明 |
| --- | --- | --- |
| `CODEG_PORT` | `3080` | HTTP ポート |
| `CODEG_HOST` | `0.0.0.0` | バインドアドレス |
| `CODEG_TOKEN` | *(ランダム)* | 認証トークン（起動時に stderr に出力） |
| `CODEG_DATA_DIR` | `~/.local/share/codeg` | SQLite データベースディレクトリ |
| `CODEG_STATIC_DIR` | `./web` または `./out` | Next.js 静的エクスポートディレクトリ |

## アーキテクチャ

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

## 制約事項

- フロントエンドは静的エクスポートを使用（`output: "export"`）
- Next.js の動的ルート（`[param]`）は不可。代わりにクエリパラメータを使用
- Tauri コマンドパラメータ: フロントエンドは `camelCase`、Rust は `snake_case`
- TypeScript strict モード

## プライバシーとセキュリティ

- 解析、ストレージ、プロジェクト操作はデフォルトでローカルファースト
- ネットワークアクセスはユーザーが明示的に操作した場合のみ発生
- エンタープライズ環境向けのシステムプロキシサポート
- Web サービスモードではトークンベースの認証を使用

## 謝辞

- [LinuxDO](https://linux.do) — すべての始まりとなったコミュニティ
- [ACP](https://agentclientprotocol.com) — Agent Client Protocol (ACP) は、codeg が複数のエージェントと接続するための基盤です

## ライセンス

Apache-2.0。`LICENSE` を参照してください。
