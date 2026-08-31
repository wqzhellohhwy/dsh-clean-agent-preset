/**
 * clean-tool-filter — 剔除宿主第三方插件注入到本预设会话的全局工具与
 * 提示词 section,仅保留 MCP(mcp__*)、官方工具与预设自己注册的内容。
 *
 * 这是一个通用化的屏蔽过滤器,可挂载到任意 Agent 预设:
 *
 * 两条拦截路径:
 *
 * 1) 工具面(tools.restrict):在调用者(预设 standing scope)作用域内过滤
 *    INHERITED 的全局工具层;预设自身注册的工具(own layer)不受影响。
 *    deny 名单 = 默认前缀(第三方插件) + config.denyPrefixes 覆盖
 *    + GUI 配置 denyPrefixes/denyNames,再减去 GUI 配置
 *    allowNames/allowPrefixes 的豁免。deny 名单从
 *    tools.view(undefined).restrictableNames 动态筛选,只 deny 实际存在的
 *    名字,避免 host 侧工具未注册时挂载失败。
 *
 * 2) 提示词 section(system-prompt/assemble):第三方插件常通过
 *    systemPrompt.section() 显式注册操作说明(如 undo 插件的
 *    `tool:dsh-undo-savepoint`),它不属于工具 schema 投影,restrict 挡不住。
 *    这里拦截装配,把名字含插件标识的第三方 `tool:*` section 剔除。
 *
 *    命名规律:官方工具 section 名是纯功能词(`tool:read` / `tool:jobs` /
 *    `tool:web_search` 等,无连字符);第三方插件 section 名是插件名
 *    (`tool:dsh-undo-savepoint`,含连字符)。据此区分,既精确又不误伤官方。
 *
 * 配置(config):
 *   - scopeId: 本预设的 agentPreset id(装配作用域判定),默认 'clean-agent'。
 *     装配时 context.scope.agentPreset === scopeId 才做 section 过滤。
 *   - denyPrefixes: 要剔除的第三方工具名前缀数组。默认覆盖常见宿主插件
 *     (见 DEFAULT_DENY_PREFIXES),可覆盖传入以适配你自己的插件集。
 *   - filterSections: 是否启用 section 过滤,默认 true。
 *
 * GUI 配置(dsh-tool-manager 插件写入 <DSH_HOME|USERPROFILE>/.dsh/tool-manager.json):
 *   {
 *     "denyPrefixes": ["screenshot_"],   // 用户额外屏蔽的前缀
 *     "denyNames":    ["web_search"],    // 用户额外屏蔽的精确工具名
 *     "allowPrefixes":["mcp__"],         // 豁免前缀(默认含 mcp__)
 *     "allowNames":   []                 // 豁免精确名(优先级高于 deny)
 *   }
 *   allow 命中 ⇒ 该工具永不 deny;deny 命中(预设前缀 ∪ config ∪ 配置)且
 *   未豁免 ⇒ deny。默认豁免前缀硬编码含 mcp__(宿主 MCP 管理器注册),用户
 *   可通过 GUI 显式添加 deny 前缀/名称来屏蔽特定 MCP 工具。
 *
 * 注意:agent.cordis.yml 中本行必须带 `?v=N` 查询参数(打破 ESM 模块缓存),
 * 否则修改本文件不会在重挂载时生效。
 */

import { readFileSync } from 'node:fs'

export const name = 'clean-tool-filter'
export const inject = ['tools']

/**
 * 第三方插件工具的识别前缀默认值(宿主层全局注册):
 *   dev_*            dsh-super-injector(热重载/注入器)
 *   memory/dtodo/... dsh-memory-evolve(记忆系统,含 memory_suggest /
 *                    memory_evolve_*)
 *   skill_manage     dsh-memory-evolve(技能管理工具,非官方 skill 工具)
 *   undo_*           dsh-undo-savepoint(撤销快照)
 *   redteam_*        dsh-redteam-mode(红队演练)
 *   ssh_*            @linxin666/dsh-ssh(SSH 工具)
 *   context_audit    dsh-context-doctor(上下文审计)
 *   describe_image   @linxin666/dsh-tool-describe-image(看图)
 *   de_*             memory-evolve 渠道/会话工具(de_channel_send 等)
 *
 * 保留:mcp__* 开头的 MCP 工具(默认豁免,可在 GUI 中单独屏蔽)、官方工具
 * (web_search / web_fetch / ask_user_question / skill / read / write / edit
 * 等),以及搜索类 anysearch_*(本身是搜索能力,默认不屏蔽,按需启用)。
 */
const DEFAULT_DENY_PREFIXES = [
  'dev_',
  'memory',
  'dtodo',
  'skill_manage',
  'undo_',
  'redteam_',
  'ssh_',
  'context_audit',
  'describe_image',
  'de_',
]

// MCP 工具默认豁免:宿主 dsh-mcp-manager 注册,是用户可控的浏览器/搜索等能力。
const DEFAULT_ALLOW_PREFIXES = ['mcp__']

/** 校验 config 项类型,返回规范化后的配置对象。 */
function normalizeConfig(raw) {
  const source = raw === undefined ? {} : raw
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    throw new TypeError('clean-tool-filter: config must be an object')
  }
  const scopeId = source.scopeId === undefined ? 'clean-agent' : source.scopeId
  if (typeof scopeId !== 'string' || scopeId.length === 0) {
    throw new TypeError('clean-tool-filter: config.scopeId must be a non-empty string')
  }
  const denyPrefixes = source.denyPrefixes === undefined
    ? DEFAULT_DENY_PREFIXES
    : source.denyPrefixes
  if (!Array.isArray(denyPrefixes) || denyPrefixes.some((p) => typeof p !== 'string' || p.length === 0)) {
    throw new TypeError('clean-tool-filter: config.denyPrefixes must be an array of non-empty strings')
  }
  const filterSections = source.filterSections === undefined ? true : source.filterSections
  if (typeof filterSections !== 'boolean') {
    throw new TypeError('clean-tool-filter: config.filterSections must be a boolean')
  }
  return { scopeId, denyPrefixes, filterSections }
}

// GUI 配置文件(与 dsh-tool-manager 插件共用)。
function configPath() {
  const env = process?.env ?? {}
  // DSH_HOME 已经是 .dsh 目录本身;USERPROFILE/HOME 才是用户主目录,需要拼 .dsh。
  const base = env.DSH_HOME || `${env.USERPROFILE || env.HOME || '.'}/.dsh`
  return `${base}/tool-manager.json`
}

function readGuiConfig() {
  try {
    const raw = readFileSync(configPath(), 'utf8')
    const cfg = JSON.parse(raw)
    return {
      denyPrefixes: Array.isArray(cfg?.denyPrefixes) ? cfg.denyPrefixes : [],
      denyNames: Array.isArray(cfg?.denyNames) ? cfg.denyNames : [],
      allowPrefixes: Array.isArray(cfg?.allowPrefixes) ? cfg.allowPrefixes : [],
      allowNames: Array.isArray(cfg?.allowNames) ? cfg.allowNames : [],
      allowSections: Array.isArray(cfg?.allowSections) ? cfg.allowSections : [],
    }
  } catch {
    // 配置缺失/损坏时回退默认,绝不阻断装配。
    return { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [], allowSections: [] }
  }
}

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const { scopeId, denyPrefixes: presetDenyPrefixes, filterSections } = config
  const gui = readGuiConfig()

  // 生效豁免 = 默认 MCP 豁免 ∪ GUI 配置豁免。
  const allowPrefixes = DEFAULT_ALLOW_PREFIXES.concat(gui.allowPrefixes)
  // 生效 deny = 预设前缀(默认或 config 覆盖) ∪ GUI 配置追加前缀;精确名另计。
  const denyPrefixes = presetDenyPrefixes.concat(gui.denyPrefixes)

  const isAllowed = (name) =>
    gui.allowNames.includes(name) || allowPrefixes.some((p) => name.startsWith(p))
  const isDenied = (name) =>
    denyPrefixes.some((p) => name.startsWith(p)) || gui.denyNames.includes(name)

  // 屏障 2a:全局工具层视图,动态筛选要剔除的工具名。
  try {
    const globalView = ctx.tools.view(undefined)
    const deny = [...globalView.restrictableNames].filter((name) =>
      isDenied(name) && !isAllowed(name),
    )
    if (deny.length > 0) {
      ctx.effect(() => ctx.tools.restrict({ deny }), 'clean-tool-filter.restrict')
    }
  } catch (error) {
    // restrict 失败不阻断装配(例如前缀命中平台缺失工具)。
    console.error('[clean-tool-filter] restrict failed:', error?.message ?? error)
  }

  // 屏障 2b:拦截 system-prompt/assemble,剔除第三方插件 section。
  // 仅处理本预设(scopeId)作用域的装配;host 全局(scope=undefined)及其他
  // 预设原样放行。prepend 让过滤器成为最外层 transform,避免后续注册的
  // 插件重新注入。
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const scope = context && context.scope
    if (!scope || typeof scope !== 'object' || scope.agentPreset !== scopeId) {
      return next()
    }
    const assembled = await next()
    if (!filterSections) return assembled
    try {
      if (!assembled || !Array.isArray(assembled.sections)) return assembled
      const kept = assembled.sections.filter((section) => {
        const name = typeof section?.name === 'string' ? section.name : ''
        if (!name.startsWith('tool:')) return true // 非 tool: section(官方 harness:/app:/deployment:/ui:)保留
        // 官方工具 section 名是纯功能词(无连字符),保留;第三方插件 section
        // 名是插件名(含连字符,如 dsh-undo-savepoint),默认剔除,仅当 GUI
        // 配置 allowSections 显式豁免时才保留(「注入上下文管理」)。
        return name.indexOf('-', 'tool:'.length) === -1 || gui.allowSections.includes(name)
      })
      if (kept.length === assembled.sections.length) return assembled
      return { ...assembled, sections: kept }
    } catch {
      // 过滤失败时保持原样,绝不破坏装配。
      return assembled
    }
  }, { prepend: true })
}