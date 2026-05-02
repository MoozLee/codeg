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
  <a href="./README.ja.md">日本語</a> |
  <a href="./README.ko.md">한국어</a> |
  <a href="./README.es.md">Español</a> |
  <a href="./README.de.md">Deutsch</a> |
  <a href="./README.fr.md">Français</a> |
  <strong>Português</strong> |
  <a href="./README.ar.md">العربية</a>
</p>

Codeg (Code Generation) é um workspace de codificação multi-agentes de nível empresarial.
Ele unifica agentes de codificação IA locais (Claude Code, Codex CLI, OpenCode, Gemini CLI,
OpenClaw, Cline, etc.) em um aplicativo desktop, servidor standalone ou contêiner
Docker — possibilitando o desenvolvimento remoto a partir de qualquer navegador — com agregação de conversas, desenvolvimento
paralelo via `git worktree`, gerenciamento de MCP/Skills, interação com canais de chat (Telegram, Lark, iLink, etc.)
e fluxos integrados de Git/arquivos/terminal.

## Nota sobre o fork e a linha de release

Este repositório é um fork de [xintaofei/codeg](https://github.com/xintaofei/codeg). O branch `main` permanece próximo ao upstream, enquanto o branch `release` deste fork pode trazer trabalho voltado ao usuário antes de chegar ao upstream ou além dele. Exemplos recentes incluem navegação pelo histórico de mensagens, além de destinos de abertura de arquivos e preferências de fonte configuráveis entre runtimes. Outras capacidades deste fork também estão documentadas abaixo, como **Canais de Chat**, implantação do **`codeg-server`**, **suporte a Docker** e **Inicializador de Projeto**.

![gallery](../images/gallery.svg)

## Interface principal
![Codeg Light](../images/main-light.png#gh-light-mode-only)
![Codeg Dark](../images/main-dark.png#gh-dark-mode-only)

## Configurações
| Agentes | MCP | Skills | Controle de versão | Serviço web |
| :---: | :---: | :---: | :---: | :---: |
| ![Agents](../images/1-light.png#gh-light-mode-only) ![Agents](../images/1-dark.png#gh-dark-mode-only) | ![MCP](../images/2-light.png#gh-light-mode-only) ![MCP](../images/2-dark.png#gh-dark-mode-only) | ![Skills](../images/3-light.png#gh-light-mode-only) ![Skills](../images/3-dark.png#gh-dark-mode-only) | ![Version Control](../images/4-light.png#gh-light-mode-only) ![Version Control](../images/4-dark.png#gh-dark-mode-only) | ![Web Service](../images/5-light.png#gh-light-mode-only) ![Web Service](../images/5-dark.png#gh-dark-mode-only) |

## Destaques

- Workspace multi-agentes unificado no mesmo projeto
- Ingestão local de conversas com renderização estruturada
- Desenvolvimento paralelo com fluxos `git worktree` integrados
- **Inicializador de Projeto** — crie novos projetos visualmente com pré-visualização em tempo real
- **Canais de Chat** — conecte Telegram, Lark (Feishu), iLink (Weixin) e mais aos seus agentes de codificação para notificações em tempo real, interação completa de sessão e controle remoto de tarefas
- Gerenciamento de MCP (varredura local + busca/instalação no registro)
- Gerenciamento de Skills (escopo global e por projeto)
- Gerenciamento de contas remotas Git (GitHub e outros servidores Git)
- Modo de serviço web — acesse o Codeg de qualquer navegador para trabalho remoto
- **Implantação de servidor standalone** — execute `codeg-server` em qualquer servidor Linux/macOS, acesse via navegador
- **Suporte a Docker** — `docker compose up` ou `docker run`, com token/porta personalizáveis, persistência de dados e montagem de diretórios de projetos
- Ciclo de engenharia integrado (árvore de arquivos, diff, alterações git, commit, terminal)

## Inicializador de Projeto

Crie novos projetos visualmente com uma interface de painel dividido: configure à esquerda, pré-visualize em tempo real à direita.

![Project Boot Light](../images/project-boot-light.png#gh-light-mode-only)
![Project Boot Dark](../images/project-boot-dark.png#gh-dark-mode-only)

### O que oferece

- **Configuração visual** — selecione estilo, tema de cores, biblioteca de ícones, fonte, raio de borda e mais nos menus suspensos; o iframe de pré-visualização atualiza instantaneamente
- **Pré-visualização ao vivo** — veja o visual escolhido renderizado em tempo real antes de criar qualquer coisa
- **Criação com um clique** — clique em "Criar Projeto" e o launcher executa `shadcn init` com seu preset, template de framework (Next.js / Vite / React Router / Astro / Laravel) e gerenciador de pacotes (pnpm / npm / yarn / bun)
- **Detecção de gerenciadores de pacotes** — verifica automaticamente quais gerenciadores estão instalados e exibe suas versões
- **Integração perfeita** — o projeto recém-criado abre diretamente no workspace do Codeg

Atualmente suporta scaffolding de projetos **shadcn/ui**, com um design baseado em abas preparado para mais tipos de projetos no futuro.

## Canais de Chat

Conecte seus aplicativos de mensagens favoritos — Telegram, Lark (Feishu), iLink (Weixin) e mais — aos seus agentes de codificação IA. Crie tarefas, envie mensagens de acompanhamento, aprove permissões, retome sessões e monitore a atividade diretamente do chat — recebendo respostas do agente em tempo real com detalhes de chamadas de ferramentas, prompts de permissão e resumos de conclusão, tudo sem abrir o navegador.

### Canais suportados

| Canal | Protocolo | Status |
| --- | --- | --- |
| Telegram | Bot API (HTTP long-polling) | Integrado |
| Lark (Feishu) | WebSocket + REST API | Integrado |
| iLink (Weixin) | WebSocket + REST API | Integrado |

> Mais canais (Discord, Slack, DingTalk, etc.) estão planejados para versões futuras.

### Recursos principais

- **Interação de sessão** — execute sessões completas de agente: `/folder` para selecionar o projeto, `/agent` para escolher o agente, `/task <descrição>` para iniciar uma tarefa, envie mensagens de acompanhamento como texto simples. `/resume` para continuar uma sessão anterior, `/cancel` para cancelar, `/sessions` para listar sessões ativas
- **Controle de permissões** — os agentes solicitam permissões de execução de ferramentas diretamente no chat; `/approve` (ou `/approve always` para aprovação automática) e `/deny`
- **Notificações de eventos** — conclusões de turno, chamadas de ferramentas e erros dos agentes são enviados em tempo real com formatação rica
- **Comandos de consulta** — `/search <palavra-chave>`, `/today`, `/status`, `/help` para consultas rápidas; prefixo de comando configurável
- **Relatórios diários** — resumo diário automatizado em um horário programado, incluindo contagem de conversas, divisão por tipo de agente e atividade do projeto
- **Multi-idioma** — templates de mensagens em 10 idiomas (inglês, chinês simplificado/tradicional, japonês, coreano, espanhol, alemão, francês, português, árabe)
- **Credenciais seguras** — tokens armazenados no chaveiro do SO, nunca expostos em arquivos de configuração ou logs
- **Mensagens ricas** — formatação Markdown para Telegram, layout baseado em cartões para Lark; fallback em texto simples para todas as plataformas

### Configuração

1. Crie um canal em **Configurações → Canais de Chat** (escolha Telegram, Lark ou iLink)
2. Insira seu token de bot (Telegram), credenciais do app (Lark) ou escaneie o código QR para fazer login (iLink) — armazenados com segurança no chaveiro do SO
3. Configure filtros de eventos e programação opcional do relatório diário
4. Conecte — as mensagens começam a fluir assim que os agentes emitem eventos

## Agentes suportados

| Agente | Caminho por variável de ambiente | Padrão macOS / Linux | Padrão Windows |
| --- | --- | --- | --- |
| Claude Code | `$CLAUDE_CONFIG_DIR/projects` | `~/.claude/projects` | `%USERPROFILE%\\.claude\\projects` |
| Codex CLI | `$CODEX_HOME/sessions` | `~/.codex/sessions` | `%USERPROFILE%\\.codex\\sessions` |
| OpenCode | `$XDG_DATA_HOME/opencode/opencode.db` | `~/.local/share/opencode/opencode.db` | `%USERPROFILE%\\.local\\share\\opencode\\opencode.db` |
| Gemini CLI | `$GEMINI_CLI_HOME/.gemini` | `~/.gemini` | `%USERPROFILE%\\.gemini` |
| OpenClaw | — | `~/.openclaw/agents` | `%USERPROFILE%\\.openclaw\\agents` |
| Cline | `$CLINE_DIR` | `~/.cline/data/tasks` | `%USERPROFILE%\\.cline\\data\\tasks` |

> Nota: as variáveis de ambiente têm prioridade sobre os caminhos padrão.

## Início rápido

### Requisitos

- Node.js `>=22` (recomendado)
- pnpm `>=10`
- Rust stable (2021 edition)
- Dependências de build do Tauri 2 (somente modo desktop)

Exemplo Linux (Debian/Ubuntu):

```bash
sudo apt-get update
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

### Desenvolvimento

```bash
pnpm install

# Exportação estática do frontend para out/
pnpm build

# Aplicativo desktop completo (Tauri + Next.js)
pnpm tauri dev

# Apenas frontend
pnpm dev

# Build do aplicativo desktop
pnpm tauri build

# Servidor standalone (sem Tauri/GUI necessário)
pnpm server:dev

# Build do binário do servidor
pnpm server:build

# Lint
pnpm eslint .

# Verificações Rust (executar em src-tauri/)
cargo check
cargo clippy
cargo build
```

### Implantação do servidor

O Codeg pode ser executado como um servidor web standalone sem ambiente desktop.

#### Opção 1: Instalação em uma linha (Linux / macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash
```

Instalar uma versão específica ou em um diretório personalizado:

```bash
curl -fsSL https://raw.githubusercontent.com/xintaofei/codeg/main/install.sh | bash -s -- --version v0.5.2 --dir ~/.local/bin
```

Em seguida, executar:

```bash
codeg-server
```

#### Opção 2: Instalação em uma linha (Windows PowerShell)

```powershell
irm https://raw.githubusercontent.com/xintaofei/codeg/main/install.ps1 | iex
```

Ou instalar uma versão específica:

```powershell
.\install.ps1 -Version v0.5.2
```

#### Opção 3: Baixar do GitHub Releases

Binários pré-compilados (com recursos web incluídos) estão disponíveis na página de [Releases](https://github.com/xintaofei/codeg/releases):

| Plataforma | Arquivo |
| --- | --- |
| Linux x64 | `codeg-server-linux-x64.tar.gz` |
| Linux arm64 | `codeg-server-linux-arm64.tar.gz` |
| macOS x64 | `codeg-server-darwin-x64.tar.gz` |
| macOS arm64 | `codeg-server-darwin-arm64.tar.gz` |
| Windows x64 | `codeg-server-windows-x64.zip` |

```bash
# Exemplo: baixar, extrair e executar
tar xzf codeg-server-linux-x64.tar.gz
cd codeg-server-linux-x64
CODEG_STATIC_DIR=./web ./codeg-server
```

#### Opção 4: Docker

```bash
# Usando Docker Compose (recomendado)
docker compose up -d

# Ou executar diretamente com Docker
docker run -d -p 3080:3080 -v codeg-data:/data ghcr.io/xintaofei/codeg:latest

# Com token personalizado e diretório de projeto montado
docker run -d -p 3080:3080 \
  -v codeg-data:/data \
  -v /path/to/projects:/projects \
  -e CODEG_TOKEN=your-secret-token \
  ghcr.io/xintaofei/codeg:latest
```

A imagem Docker usa um build multi-stage (Node.js + Rust → runtime Debian slim) e inclui `git` e `ssh` para operações com repositórios. Os dados são persistidos no volume `/data`. Opcionalmente, você pode montar diretórios de projetos para acessar repositórios locais de dentro do contêiner.

#### Opção 5: Compilar a partir do código-fonte

```bash
pnpm install && pnpm build          # compilar frontend
cd src-tauri
cargo build --release --bin codeg-server --no-default-features
CODEG_STATIC_DIR=../out ./target/release/codeg-server
```

#### Configuração

Variáveis de ambiente:

| Variável | Padrão | Descrição |
| --- | --- | --- |
| `CODEG_PORT` | `3080` | Porta HTTP |
| `CODEG_HOST` | `0.0.0.0` | Endereço de bind |
| `CODEG_TOKEN` | *(aleatório)* | Token de autenticação (impresso no stderr ao iniciar) |
| `CODEG_DATA_DIR` | `~/.local/share/codeg` | Diretório do banco de dados SQLite |
| `CODEG_STATIC_DIR` | `./web` ou `./out` | Diretório de exportação estática do Next.js |

## Arquitetura

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

## Restrições

- O frontend usa exportação estática (`output: "export"`)
- Sem rotas dinâmicas do Next.js (`[param]`); use parâmetros de consulta em vez disso
- Parâmetros de comandos Tauri: `camelCase` no frontend, `snake_case` no Rust
- TypeScript em modo strict

## Privacidade e segurança

- Local-first por padrão para análise, armazenamento e operações do projeto
- O acesso à rede ocorre apenas em ações iniciadas pelo usuário
- Suporte a proxy do sistema para ambientes corporativos
- O modo de serviço web usa autenticação baseada em token

## Agradecimentos

- [LinuxDO](https://linux.do) — a comunidade onde tudo começou
- [ACP](https://agentclientprotocol.com) — o Agent Client Protocol (ACP) é a base que permite ao Codeg conectar-se a múltiplos agentes

## Licença

Apache-2.0. Veja `LICENSE`.
