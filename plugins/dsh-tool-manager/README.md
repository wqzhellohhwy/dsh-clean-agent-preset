# dsh-tool-manager

**纯净预设工具管理** —— 在 DeepSeek Harness (dsh) Web 设置界面提供「工具管理」页，
针对 clean-agent 纯净预设单独屏蔽/启用任意工具。是
[dsh-clean-agent-preset](https://github.com/wqzhellohhwy/dsh-clean-agent-preset)
的配套插件（可选安装，不装则预设按默认名单工作）。

## 功能

- **枚举全部工具**：从宿主 tools registry 读取当前注册的所有工具，按来源分组
  （原生 / MCP / 第三方），与具体会话无关（全局注册面）。
- **单独屏蔽/启用**：每个工具一个勾选开关——勾选 = 在纯净预设中屏蔽，取消 =
  启用/豁免；也支持按前缀批量屏蔽。
- **持久化**：保存到 `$DSH_HOME/.dsh/tool-manager.json`，
  clean-agent 预设的 `clean-tool-filter.mjs` 装配时读取同一文件（新会话生效）。
- **豁免优先**：`allowNames` / `allowPrefixes` 命中即保留，`mcp__` 默认豁免；
  用户可显式屏蔽特定 MCP 工具。

## 主机 API（同源）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/tool-manager/api/tools` | 枚举全部工具 + 当前配置 |
| GET | `/tool-manager/api/config` | 读当前配置 |
| POST | `/tool-manager/api/config` | 保存配置（denyPrefixes / denyNames / allowPrefixes / allowNames） |

## 配置格式（tool-manager.json）

```json
{
  "denyPrefixes": ["screenshot_"],   // 用户额外屏蔽的前缀
  "denyNames":    ["web_search"],    // 用户额外屏蔽的精确工具名
  "allowPrefixes":["mcp__"],         // 豁免前缀（默认含 mcp__）
  "allowNames":   []                 // 豁免精确名（优先级高于 deny）
}
```

## 构建与安装

```bash
# 构建（host 端 esbuild + client 端 tsdown）
DSH_CHECKOUT=<dsh 源码 checkout 路径> bash scripts/build.sh

# 安装（唯一推荐方式）：super-injector 运行时注入
# 注入 registry 持久化于 ~/.dsh/super-injector/，dsh 重启后由 super-injector 自动恢复
dev_inject_plugin <本目录>
```

> ⚠️ **禁止加入 `dsh.profile.bundles`**：本插件是标准双端 Cordis 插件（仅声明
> `dsh.client`，无 `dsh.bundle.patch` + `cordis.patch.yml`），**不是 bundle**。
> 把它加入 profile 的 bundles 列表会让 dsh 启动时 `loadProfile` 强校验失败、
> 整个 dsh 崩溃（实测踩坑：dsh-terminal-probe、dsh-tool-manager 均因此崩过）。
> 不要使用 `dsh plugin --profile web add` 或手工编辑 bundles 数组。

构建产出：`lib/index.js`（host）+ `lib/client.js`（browser，ModuleLoader 注册
`@dsh-external/dsh-tool-manager`，注入 `settings.section` 显示「工具管理」页）。

## 实现说明

- **host**（`src/index.ts`）：`webServer.register({ kind: 'prefix', path:
  '/tool-manager/api' })` 提供 JSON API；工具枚举用 `tools.view(undefined).
  knownNames`（全量注册名），描述用 `tools.get(name)`。
- **client**（`src/client/index.tsx`）：`slots.inject('settings.section', …)`
  注册设置页。⚠️ **settings.section 的组件契约是 React 组件**——必须用
  JSX/React 实现（与 mcp-manager / undo 插件一致），纯 DOM 的 `{ render() }`
  形状会导致该设置项 `active:false`、页面空白。tsdown 配 `jsx: 'automatic'`
  编译，运行时由浏览器 ModuleLoader 的 `react` / `react/jsx-runtime` 提供；
  不要使用全局 `React.createElement`（运行时无 `React` 全局变量）。
- `ctx.get('webServer')` / `ctx.get('tools')` 均为可选读取，缺服务时静默降级。