# ThinkRail 中文入门指南

[English README](README.md) · [官网](https://thinkrail.ai/) · [下载发行版](https://github.com/JetBrains/thinkrail/releases) · [贡献指南](CONTRIBUTING.md)

ThinkRail 是围绕 [pi 编程 agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 构建的开发工具。你可以在同一个界面中与 agent 对话、编辑代码、运行终端命令并检查改动，也可以为不同任务创建独立的 Git 工作树工作区。

本文介绍安装和开始使用的方法。完整功能、平台要求、更新说明和隐私说明请参阅 [英文 README](README.md)；本文与英文文档不一致时，以英文文档为准。

## 选择安装方式

ThinkRail 提供桌面应用和命令行启动器，两者使用同一套引擎。命令行启动器会在浏览器中打开应用。

### 桌面应用

从 [Releases](https://github.com/JetBrains/thinkrail/releases) 下载适合自己系统的 `thinkrail-desktop-*` 文件。

- **macOS 14 及以上**：Apple Silicon 选择 `thinkrail-desktop-darwin-arm64.dmg`，Intel 选择 `thinkrail-desktop-darwin-x64.dmg`。
- **Windows x64**：完整解压安装 ZIP，然后在解压目录中运行安装程序。安装程序需要与附带的数据文件放在一起。
- **Linux x64 / ARM64**：解压安装包并运行 `installer`。桌面应用需要 glibc 2.38 及以上，以及 GTK 3、WebKitGTK 4.1、Ayatana AppIndicator 3 和 librsvg 2。Ubuntu 24.04 及以上可安装以下依赖：

  ```bash
  sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1 librsvg2-2
  ```

平台签名、公证状态和系统拦截说明见 [英文 README 的 Platform notes](README.md#platform-notes)。

### 命令行启动器

安装脚本会下载适合当前平台的可执行文件，校验 SHA-256，并将 `thinkrail` 加入 PATH。

macOS / Linux，以及 Windows 的 Git Bash：

```bash
curl -fsSL https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.sh | bash
```

Windows 的 PowerShell 或 cmd：

```powershell
powershell -c "irm https://raw.githubusercontent.com/JetBrains/thinkrail/main/install.ps1 | iex"
```

安装后，运行 `thinkrail`，也可以直接传入要打开的 Git 仓库路径：

```bash
thinkrail ~/code/my-repo
```

上面的路径是示例，请换成自己电脑中的仓库路径。使用命令行启动器时，`git` 必须位于 PATH 中。

## 第一次启动

1. **连接模型服务。** 按首次启动引导登录 JetBrains AI，或者使用通过 pi 配置的其他模型服务凭据。ThinkRail 没有独立的用户账号体系。
2. **选择项目。** 打开已有 Git 仓库；没有仓库时，可以选择 **Start a new project** 创建空仓库。也可以通过 **Add project → Clone repository…** 克隆远程仓库。
3. **选择界面语言。** 在 **Settings → Language** 中选择语言。切换界面语言不会自动翻译 agent 回复或工具输出。
4. **为任务创建工作区。** 独立工作区使用 Git 工作树，拥有各自的分支和工作目录，适合同时处理多个任务。ThinkRail 也支持附加已有工作树或直接在项目目录中工作。
5. **开始对话并检查改动。** 在工作区内向 agent 描述任务，使用编辑器、终端和改动视图检查结果，再决定如何提交或合并。

内置语言列表以 [英文 README](README.md#what-you-get) 为准；自定义界面翻译的方法见 [贡献指南](CONTRIBUTING.md#translations)。

## 理解项目、工作区、Specs 和 Skills

| 名称 | 在 ThinkRail 中的作用 |
| --- | --- |
| 项目（Project） | 你打开的 Git 仓库。 |
| 工作区（Workspace） | 处理任务的工作环境；独立工作区使用自己的 Git 工作树和分支。 |
| 对话（Chat） | 工作区中的 pi 会话。同一个工作区可以有多个对话。 |
| Specs | 与代码放在一起的 `SPEC.md` 文件，用来记录模块职责、约束和设计决策；agent 可以读取、搜索和维护它们。 |
| Skills | 可复用的 Agent Skills，向 agent 提供完成特定工作的操作说明。ThinkRail 也自带项目设置、设计讨论和提交 PR 等工作流。 |

ThinkRail 会读取已有的 pi 配置（`~/.pi/agent`）。如需切换配置目录或设置传给 agent、终端及 MCP 服务的环境变量，可在 **Settings → Environment** 中配置，并在下次启动时生效。

## 更新

- **桌面应用**：带有有效更新源标识的正式版和 nightly 安装包会在后台检查更新。在 **Settings → Updates** 中依次选择下载、准备更新和 **Install & Restart**。只有选择安装并重启后才会应用更新。
- **命令行启动器**：可以执行 `thinkrail update`。更新成功后需要手动重启正在运行的服务。
- **从源码运行**：通过 Git 更新代码并重新构建。`thinkrail update` 安装的是已发布的可执行文件，不会更新源码工作目录。

指定版本、nightly 渠道、手动安装和卸载方式见 [英文安装说明](README.md#install)。

## 从源码开发

需要 Bun 1.4.4、Node.js 22.19 及以上；使用 agent 还需要已认证的 pi 模型服务。

```bash
git clone https://github.com/JetBrains/thinkrail.git
cd thinkrail
bun install
bun run dev
```

`bun run dev` 同时启动服务端和网页客户端，按 `Ctrl+C` 停止。

开发检查、模块约束和 PR 提交流程见 [CONTRIBUTING.md](CONTRIBUTING.md) 与 [AGENTS.md](AGENTS.md)。

## 隐私与反馈

ThinkRail 会收集与随机安装 ID 关联的基础使用事件，并始终发送经过限制的错误分类信息。**Settings → Privacy** 中的 **Share additional usage data** 控制额外数据分享；它不关闭基础事件和错误报告。详细收集范围请阅读 [Analytics & privacy](README.md#analytics--privacy)。

使用问题和交流可前往 [Discord](https://thinkrail.ai/discord)，缺陷和功能建议请提交到 [GitHub Issues](https://github.com/JetBrains/thinkrail/issues)。参与贡献前请阅读 [贡献指南](CONTRIBUTING.md) 和 [行为准则](CODE_OF_CONDUCT.md)。

项目采用 [Apache License 2.0](LICENSE)。
