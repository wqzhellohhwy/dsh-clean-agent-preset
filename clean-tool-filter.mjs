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
 *    deny 名单从 tools.view(undefined).restrictableNames 动态筛选,只 deny
 *    实际存在的名字,避免 host 侧工具未注册时挂载失败。
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
 *     (见 DENY_PREFIXES),可覆盖传入以适配你自己的插件集。
 *   - filterSections: 是否启用 section 过滤,默认 true。
 *
 * 注意:agent.cordis.yml 中本行必须带 `?v=N` 查询参数(打破 ESM 模块缓存),
 * 否则修改本文件不会在重挂载时生效。
 */

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
 *   anysearch_*      @anysearch/anysearch-dsh(搜索,替换官方 web_search)
 *   de_*             memory-evolve 渠道/会话工具(de_channel_send 等)
 *
 * 保留:以 mcp__ 开头的 MCP 工具(宿主 dsh-mcp-manager 注册)与官方工具
 * (web_search / ask_user_question / skill / read / write / edit 等,它们
 * 要么注册在本预设 own layer,要么不在上述前缀内)。
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
  'anysearch_',
  'de_',
]

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

export function apply(ctx, rawConfig) {
  const config = normalizeConfig(rawConfig)
  const { scopeId, denyPrefixes, filterSections } = config

  // 屏障 2a:全局工具层视图,动态筛选要剔除的工具名。
  const globalView = ctx.tools.view(undefined)
  const deny = [...globalView.restrictableNames].filter((name) =>
    denyPrefixes.some((p) => name.startsWith(p)),
  )
  if (deny.length > 0) {
    ctx.effect(() => ctx.tools.restrict({ deny }), 'clean-tool-filter.restrict')
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
        // 名是插件名(含连字符,如 dsh-undo-savepoint),剔除。
        return name.indexOf('-', 'tool:'.length) === -1
      })
      if (kept.length === assembled.sections.length) return assembled
      return { ...assembled, sections: kept }
    } catch {
      // 过滤失败时保持原样,绝不破坏装配。
      return assembled
    }
  }, { prepend: true })
}
