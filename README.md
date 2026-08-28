# dsh-clean-agent-preset

**纯净智能体预设 —— 为 DeepSeek Harness (dsh) 提供一个屏蔽第三方插件提示词注入与工具面的极简 Agent。**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## 项目背景

DeepSeek Harness（dsh）是一个高度插件化的宿主。宿主层（HOST 组合）默认装配了大量第三方插件（记忆系统、热重载系统、撤销快照、红队演练、SSH 工具、上下文审计、看图工具……）。这些插件会通过两条通道向**每一个会话**注入内容：

1. **运行时上下文**（`systemPrompt.context()`）—— 长期记忆快照、系统插件说明等；
2. **提示词分区**（`systemPrompt.section()`）—— 工具操作说明等；
3. **全局工具面**（tools registry）—— 插件注册的工具会出现在所有会话里。

如果你希望某个 Agent 会话保持"纯净"——只保留系统提示词、技能、MCP 工具和 dsh 原生工具，屏蔽其他一切插件注入——本预设就是为此设计的。它提供一个**通用化的双屏障屏蔽机制**，可挂载到任意预设，而不仅限于本仓库自带的 clean-agent 配置。

## 核心功能

- **运行时上下文全屏蔽**：会话 `contexts=0`，记忆/热重载/undo 等插件的 context 注入完全不可见。
- **第三方工具剔除**：`tools.restrict({ deny })` 按前缀动态剔除宿主层注册的第三方工具，MCP（`mcp__*`）、官方工具与搜索类工具（`anysearch_*`）保留。
- **第三方 section 剔除**：拦截 `system-prompt/assemble`，剔除第三方插件显式注册的操作说明 section（如 `tool:dsh-undo-savepoint`）。
- **GUI 工具管理**：配套 `dsh-tool-manager` 插件在 DSH Web 设置界面提供「工具管理」页，可针对本预设单独屏蔽/启用任意工具，配置实时生效（新会话）。
- **可移植可配置**：作用域 id、deny 前缀、是否启用 section 过滤均可通过预设行 config 调整，适配任意插件组合。
- **非破坏**：任何过滤失败都保持原装配结果，绝不吞掉用户上下文。

## 技术栈

- **DeepSeek Harness（dsh）** —— 目标宿主，Cordis 插件体系
- **Cordis composition** —— Agent 预设采用 AGENT-PLANE 组合（`agent.cordis.yml`）
- **`@deepseek-ai/dsh-tools`** —— `tools.restrict` / `tools.view` 工具层作用域机制
- **`@deepseek-ai/dsh-system-prompt`** —— `systemPrompt.section/context` 与 `system-prompt/assemble` 事件
- **`@deepseek-ai/dsh-scope`** —— scope 作用域体系
- **YAML / ESM（.mjs）** —— 预设组合文件与过滤器实现
- **esbuild / tsdown** —— 配套插件打包（host 端 esbuild，client 端 tsdown）

## 目录结构

```
dsh-clean-agent-preset/
├── agent.cordis.yml        # 预设组合：装配官方工具/技能/压缩/persona + 屏蔽行
├── clean-tool-filter.mjs   # 屏蔽机制核心（restrict + assemble 拦截，可配置 + GUI 联动）
├── preset.yml              # 预设元数据（name / description）
├── plugins/
│   └── dsh-tool-manager/   # 配套插件：GUI 设置页「工具管理」（host API + client 页）
├── README.md               # 本文档
└── LICENSE                 # MIT 许可证
```

## 快速开始

### 前置要求

- 已安装并配置好 [DeepSeek Harness](https://github.com/deepseek-ai/dsh)（dsh），能正常创建 Agent 预设会话。
- dsh 的 Agent 预设目录在**用户目录**下：`~/.dsh/.agent-presets/<preset-id>/`（即系统用户主目录中的 `.dsh` 文件夹，dsh 默认安装于此，无需配置环境变量）。

### 安装

1. 将本仓库克隆或复制到你本机的预设目录：

- Windows PowerShell 写法：

   ```powershell
   Copy-Item -Recurse .\dsh-clean-agent-preset "$env:USERPROFILE\.dsh\.agent-presets\clean-agent"
   ```
- Unix bash 写法：
   ```bash
   # 以预设 id 命名目录，例如 clean-agent
   # $HOME 即用户主目录（Windows 上通常是 C:\Users\<你的用户名>），
   # dsh 默认就装在这里，无需设置任何环境变量。
   cp -r dsh-clean-agent-preset "$HOME/.dsh/.agent-presets/clean-agent"
   ```
2. 在 dsh 中新建会话，把该会话的预设切换为`clean-agent`或你的预设 id。
3. （可选）自定义该预设 id：如果你把目录命名为别的 id（如 `minimal`），请同步修改两处：
- `agent.cordis.yml` 中 `clean-tool-filter` 行的 `config.scopeId`（默认 `clean-agent`）；
- `preset.yml` 的 `name` / `description`。

### 验证生效

切换预设后，在会话中确认：

- **上下文**：会话提示词不含宿主插件的运行时上下文（长期记忆、热重载系统说明等）。
- **工具面**：模型可见的工具只有 MCP 工具 + dsh 原生工具，没有 `dev_*`、`memory`、`undo_*`、`ssh_*` 等第三方工具。
- **section**：提示词分区里没有第三方插件的操作说明（如 `tool:dsh-undo-savepoint`）。

## 使用方法

### 屏蔽机制详解

本预设通过**两条正交的拦截路径**实现屏蔽，互不依赖：

| 屏障 | 机制 | 位置 | 拦截内容 |
|---|---|---|---|
| 屏障 1 | `persona.includeRuntimeContext: false` | `agent.cordis.yml` | 运行时上下文（`context`） |
| 屏障 2a | `tools.restrict({ deny })` | `clean-tool-filter.mjs` | 第三方全局工具 |
| 屏障 2b | `system-prompt/assemble` 拦截 | `clean-tool-filter.mjs` | 第三方提示词 section |

**屏障 1**：`persona` 行 `includeRuntimeContext: false` 等价于官方 minimal 预设的「Runtime context snapshots are suppressed」，在预设作用域内调用 `suppressRuntimeContext()`。

**屏障 2a**：deny 名单从 `tools.view(undefined).restrictableNames` 动态筛选，只 deny 实际存在的工具，避免 host 侧工具未注册时挂载失败。

**屏障 2b**：第三方插件常通过 `systemPrompt.section()` 显式注册操作说明（不属于工具 schema 投影，restrict 挡不住）。拦截 `system-prompt/assemble` 事件按命名规律剔除。

### 命名规律（判定第三方 section）

- **官方工具 section 名**：纯功能词，无连字符 —— `tool:read` / `tool:jobs` / `tool:goal` / `tool:web_search`
- **第三方插件 section 名**：插件名，含连字符 —— `tool:dsh-undo-savepoint`

规则：`tool:` 后含连字符的 section 剔除，其余保留。

### 配置项（clean-tool-filter）

`agent.cordis.yml` 中 `clean-tool-filter` 行的 `config` 支持：

| 配置项 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `scopeId` | string | `clean-agent` | 装配作用域判定：`context.scope.agentPreset === scopeId` 才做 section 过滤，必须等于你的预设 id |
| `denyPrefixes` | string[] | 见下文 | 要剔除的第三方工具名前缀，覆盖传入可适配你的插件集 |
| `filterSections` | boolean | `true` | 是否启用 section 过滤 |

默认 `denyPrefixes`：

```js
['dev_', 'memory', 'dtodo', 'skill_manage', 'undo_',
 'redteam_', 'ssh_', 'context_audit', 'describe_image',
 'de_']
```

> 注意：`anysearch_*`（搜索类工具）**不在默认屏蔽名单**——它是搜索能力，默认保留；你可以在 GUI 工具管理页或 `denyPrefixes` 中显式屏蔽。

### GUI 工具管理（dsh-tool-manager 插件）

配套插件 `plugins/dsh-tool-manager` 在 DSH Web 设置界面的侧栏新增一个「**工具管理**」页面：

- **枚举全部工具**：从宿主 tools registry 读取当前注册的所有工具，按来源分组显示（原生 / MCP / 第三方）。
- **单独屏蔽/启用**：每个工具一个勾选开关。勾选 = 在纯净预设中屏蔽，取消 = 启用/豁免。也支持按前缀批量屏蔽。
- **持久化**：保存后写入 `$DSH_HOME/.dsh/tool-manager.json`（与 `clean-tool-filter.mjs` 共用同一文件）。
- **生效时机**：保存后**新会话**生效；别名「豁免」优先级高于屏蔽（`allowNames` / `allowPrefixes` 命中即保留，`mcp__` 默认豁免）。

主机 API（同源）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tool-manager/api/tools` | 枚举全部工具 + 当前配置 |
| GET | `/tool-manager/api/config` | 读当前配置 |
| POST | `/tool-manager/api/config` | 保存配置（denyPrefixes / denyNames / allowPrefixes / allowNames） |

插件构建：宿主平面 bundle 插件，装配到 web profile 的 bundles 列表即长期生效（`dsh plugin --profile web add plugins/dsh-tool-manager`，或以 super-injector `dev_install_package` 热装配）。未安装该插件时，`clean-tool-filter.mjs` 静默使用默认名单，纯净预设功能不受影响。

## 可移植性 / 适配你的环境

本项目**不含任何硬编码的本地路径、用户名或专属目录**。迁移到其他机器或插件组合时，按需调整：

1. **预设 id**：目录名决定预设 id。改名后同步 `agent.cordis.yml` 的 `config.scopeId` 和 `preset.yml` 的 `name`。
2. **deny 前缀**：你的 dsh 宿主装配了不同的第三方插件时，在 `clean-tool-filter` 行传入你自己的 `denyPrefixes`，覆盖默认值。
3. **MCP 工具**：MCP 由宿主层 dsh-mcp-manager 注册进全局 registry，天然被继承，无需在本预设装配任何 MCP 行。
4. **Windows / POSIX**：`tool-pwsh` 行已用 `disabled: !!js process.platform !== 'win32'` 做平台判定；在 POSIX 上会自动禁用 pwsh 工具。
5. **上下文压缩**：compaction 组（`cordis:group` + `isolate`）按官方方式启用，无需改动。
6. **保留官方工具**：如果你需要增加/删减官方工具，直接在 `agent.cordis.yml` 中增删对应行（`@deepseek-ai/dsh-tool-*`）。
7. **配套插件**：GUI 工具管理页是可选的。不装插件时预设仍按默认名单工作；装了则可以可视化覆盖。

### 重要：ESM 缓存

`clean-tool-filter.mjs` 以相对路径引用，Node ESM 有模块缓存。**修改该文件后必须递增引用处的 `?v=N` 查询参数**（如 `?v=1` → `?v=2`），否则重挂载时加载的是旧模块，改动不生效。这是调试本机制时的常见坑。

## 验证结果（实测）

在 dsh 中实测 clean-agent 会话装配：

- `contexts` = **0**（运行时上下文全屏蔽）
- `sections` 仅含官方 + 原生工具，无第三方插件 section
- 工具面 = **MCP 工具（playwright-mcp 全套 28 个）+ 官方原生工具 + 搜索工具**，第三方工具（memory/dev_*/undo_*/ssh_* 等）全部剔除
- `GET /tool-manager/api/tools` 枚举 90+ 工具并正确分类（mcp/native/third）；配置读写往返验证通过
- GUI 配置联动：屏蔽 `web_fetch` → filter 装配时剔除；豁免 `memory` → 保留；均验证通过

## 许可证

[MIT](LICENSE)

## 相关资源

- [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/dsh)
- [Cordis](https://github.com/cordiverse/cordis)
