/**
 * @dsh-external/dsh-tool-manager — client 设置页(settings.section)。
 * 在 DSH Web GUI 设置侧栏新增「工具管理」页面:枚举当前寄存器全部工具,
 * 按来源(原生/MCP/第三方)分组(MCP 按 mcp server 名、第三方按归属大插件),
 * 允许对「纯净预设(clean-agent)」单独屏蔽/启用任意工具;配置经同源 API
 * 持久化到 $DSH_HOME/.dsh/tool-manager.json,clean-agent 的 clean-tool-filter.mjs
 * 装配时读取并生效(新会话生效)。
 *
 * 交互模型(2026-08-28 重构):
 *   - 每个工具有两个独立控件:「☑️ 选中」(用于批量操作) + 「启用/禁用」开关(单个生效)。
 *   - 顶部批量工具栏:全选(作用于当前筛选结果)/禁用选中/启用选中;
 *     以及「选中并禁用所有 MCP」「选中并禁用所有第三方」两个一键动作。
 *   - 一键禁用只写纯净预设屏蔽名单(denyNames),不真的关闭 MCP/插件服务。
 *
 * ⚠️ 组件契约:settings.section 的注册组件必须是 React 组件(与 mcp-manager /
 * undo 插件一致);纯 DOM 的 { render() } 形状会导致 active:false、页面空白。
 * 本文件用 JSX(tsx)编译,tsdown 自动转 react/jsx-runtime——不要改成
 * React.createElement 全局名,那在运行时是 undefined。
 */
import { useEffect, useMemo, useState, type ReactElement, type ChangeEvent, type KeyboardEvent } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
}

export const inject = ['slots']

const API = '/tool-manager/api'

interface ToolRow {
  name: string
  description: string
  category: 'mcp' | 'native' | 'third' | 'unknown'
  group: string
}

interface Config {
  denyPrefixes: string[]
  denyNames: string[]
  allowPrefixes: string[]
  allowNames: string[]
}

// 与 clean-tool-filter.mjs 默认名单一致(anysearch_ 已移出默认屏蔽)。
const DEFAULT_THIRD_PREFIXES = [
  'dev_', 'memory', 'dtodo', 'skill_manage', 'undo_', 'redteam_',
  'ssh_', 'context_audit', 'describe_image', 'de_',
]

const CATEGORY_LABEL: Record<string, string> = {
  mcp: 'MCP 工具（默认启用）',
  native: 'DSH 原生工具 / 纯净预设装配（默认启用）',
  third: '宿主第三方插件工具（纯净预设默认屏蔽）',
  unknown: '其他',
}

const CATEGORY_ORDER = ['native', 'mcp', 'third', 'unknown'] as const

const styles = `
.tm-page{font-size:14px;line-height:1.6;padding:14px 16px;max-width:860px;color:var(--dsw-alias-label-primary)}
.tm-page h3{margin:0 0 8px;font-size:16px;color:var(--dsw-alias-label-primary)}
.tm-desc{color:var(--dsw-alias-label-secondary);margin:0 0 14px;font-size:13px}
.tm-rule{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin-bottom:12px}
.tm-rule label{display:inline-block;margin-right:10px;font-size:13px;color:var(--dsw-alias-label-secondary)}
.tm-input{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:6px 8px;font-size:13px;width:210px;margin-right:6px;font-family:inherit}
.tm-btn{background:var(--dsw-alias-state-business-primary);color:#fff;border:none;border-radius:6px;padding:7px 14px;cursor:pointer;font-size:13px;white-space:nowrap;font-family:inherit}
.tm-btn.ghost{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.tm-btn.danger{background:transparent;border:1px solid var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.tm-btn:disabled{opacity:.4;cursor:not-allowed}
.tm-group{margin-bottom:14px}
.tm-group h4{margin:0 0 6px;font-size:13px;color:var(--dsw-alias-brand-primary)}
.tm-subgroup{margin-bottom:10px}
.tm-subhead{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.tm-group-actions{display:flex;gap:6px;margin-left:auto;flex-wrap:wrap}
.tm-fold{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:4px;width:22px;height:22px;line-height:1;cursor:pointer;padding:0;font-size:12px;font-family:inherit;flex:0 0 auto}
.tm-subtitle{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;font-weight:600}
.tm-subcount{color:var(--dsw-alias-label-tertiary);font-weight:400;margin-left:6px}
.tm-btn.tm-mini{padding:2px 8px;font-size:12px}
.tm-btn.tm-blue{background:var(--dsw-alias-state-business-primary);color:#fff;border:1px solid var(--dsw-alias-state-business-primary)}
.tm-btn.tm-danger{background:var(--dsw-alias-state-error-primary);color:#fff;border:1px solid var(--dsw-alias-state-error-primary)}
.tm-btn.tm-success{background:var(--dsw-alias-state-success-primary);color:#fff;border:1px solid var(--dsw-alias-state-success-primary)}
.tm-tools{display:flex;flex-wrap:wrap;gap:6px}
.tm-chip{display:flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:4px 8px;font-size:13px;background:var(--dsw-alias-bg-layer-2)}
.tm-chip input[type=checkbox]{cursor:pointer}
.tm-chip.denied{opacity:.55}
.tm-chip.denied .tm-name{text-decoration:line-through}
.tm-chip.selected{border-color:var(--dsw-alias-state-business-primary);box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary) inset}
.tm-name{color:var(--dsw-alias-label-primary);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm-switch{border:none;border-radius:999px;padding:2px 10px;cursor:pointer;font-size:12px;font-family:inherit;line-height:1.5;white-space:nowrap}
.tm-switch.on{background:var(--dsw-alias-state-success-primary);color:#fff}
.tm-switch.off{background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary)}
.tm-batch{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px;padding:8px 10px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l2);border-radius:8px}
.tm-sep{width:1px;align-self:stretch;background:var(--dsw-alias-border-l2);margin:0 2px}
.tm-save-row{display:flex;gap:8px;align-items:center;margin-top:12px}
.tm-status{font-size:13px;color:var(--dsw-alias-state-success-primary)}
.tm-status.err{color:var(--dsw-alias-state-error-primary)}
.tm-hint{font-size:12px;color:var(--dsw-alias-label-tertiary);margin-top:8px}
.tm-search{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.tm-search .tm-input{width:280px;margin-right:0}
.tm-filter{display:flex;gap:6px}
.tm-btn.tm-active{background:var(--dsw-alias-state-business-primary);color:#fff;border-color:var(--dsw-alias-state-business-primary)}
.tm-count{font-size:12px;color:var(--dsw-alias-label-tertiary);margin:0}
.tm-name mark{background:transparent;color:var(--dsw-alias-brand-primary);font-weight:600}
`

function ToolManagerSection(): ReactElement {
  const [tools, setTools] = useState<ToolRow[]>([])
  const [cfg, setCfg] = useState<Config>({ denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] })
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | 'denied'>('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`${API}/tools`)
        const body = await res.json()
        if (cancelled) return
        setTools((body?.tools ?? []) as ToolRow[])
        setCfg((body?.config ?? { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] }) as Config)
      } catch (e) {
        if (!cancelled) setStatus('⚠️ 无法连接 host API（/tool-manager/api）：' + String(e))
      } finally {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  const isEffectivelyDenied = (name: string): boolean => {
    if (cfg.allowNames.includes(name)) return false
    if (cfg.allowPrefixes.some((p) => name.startsWith(p))) return false
    if (cfg.denyNames.includes(name)) return true
    if (cfg.denyPrefixes.some((p) => name.startsWith(p))) return true
    if (name.startsWith('mcp__')) return false
    return DEFAULT_THIRD_PREFIXES.some((p) => name.startsWith(p))
  }

  // 把单个工具设为启用/禁用,返回新 Config(双向清理 allow/deny 名单,避免残留复活)。
  const applyDeny = (cfg0: Config, name: string, denied: boolean): Config => {
    const next: Config = { ...cfg0, denyNames: [...cfg0.denyNames], allowNames: [...cfg0.allowNames] }
    if (denied) {
      if (!next.denyNames.includes(name)) next.denyNames.push(name)
      next.allowNames = next.allowNames.filter((n) => n !== name)
    } else {
      next.denyNames = next.denyNames.filter((n) => n !== name)
      if (DEFAULT_THIRD_PREFIXES.some((p) => name.startsWith(p)) && !next.allowNames.includes(name)) {
        next.allowNames.push(name)
      }
    }
    return next
  }

  const persist = (next: Config): void => {
    void (async () => {
      try {
        const res = await fetch(`${API}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(next),
        })
        const body = await res.json()
        setStatus(body?.ok ? '✅ 已保存，新会话生效' : '❌ 保存失败：' + (body?.error ?? 'unknown'))
      } catch (e) {
        setStatus('❌ 保存失败：' + String(e))
      }
    })()
  }

  const commit = (next: Config): void => {
    setCfg(next)
    persist(next)
  }

  const toggle = (name: string, denied: boolean): void => {
    commit(applyDeny(cfg, name, denied))
  }

  const batchSetDenied = (names: string[], denied: boolean): void => {
    if (names.length === 0) return
    commit(names.reduce((acc, n) => applyDeny(acc, n, denied), cfg))
  }

  const toggleSelect = (name: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const reset = (): void => {
    setSelected(new Set())
    commit({ denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] })
  }

  const matches = (t: ToolRow): boolean => {
    const q = query.trim().toLowerCase()
    if (q && !t.name.toLowerCase().includes(q) && !(t.description ?? '').toLowerCase().includes(q)) return false
    const d = isEffectivelyDenied(t.name)
    if (filter === 'enabled' && d) return false
    if (filter === 'denied' && !d) return false
    return true
  }

  const filteredTools = useMemo(() => tools.filter(matches), [tools, query, filter, cfg])

  const sections = useMemo(() => {
    const byCat = new Map<string, ToolRow[]>()
    for (const t of filteredTools) {
      const arr = byCat.get(t.category) ?? []
      arr.push(t)
      byCat.set(t.category, arr)
    }
    const out: { cat: string; label: string; subs: { key: string; label: string; rows: ToolRow[] }[] }[] = []
    for (const cat of CATEGORY_ORDER) {
      const rows = byCat.get(cat)
      if (!rows || rows.length === 0) continue
      if (cat === 'mcp' || cat === 'third') {
        const byGroup = new Map<string, ToolRow[]>()
        for (const t of rows) {
          const g = t.group || '其他'
          const arr = byGroup.get(g) ?? []
          arr.push(t)
          byGroup.set(g, arr)
        }
        const subs = [...byGroup.entries()]
          .map(([g, rs]) => ({ key: g, label: g, rows: rs }))
          .sort((a, b) => a.label.localeCompare(b.label))
        out.push({ cat, label: CATEGORY_LABEL[cat] ?? cat, subs })
      } else {
        out.push({ cat, label: CATEGORY_LABEL[cat] ?? cat, subs: [{ key: cat, label: '', rows }] })
      }
    }
    return out
  }, [filteredTools])

  const allVisibleSelected = filteredTools.length > 0 && filteredTools.every((t) => selected.has(t.name))

  const toggleSelectAll = (): void => {
    setSelected(allVisibleSelected ? new Set<string>() : new Set(filteredTools.map((t) => t.name)))
  }

  const selectDisableCategory = (cat: 'mcp' | 'third'): void => {
    const names = tools.filter((t) => t.category === cat).map((t) => t.name)
    setSelected((prev) => new Set([...prev, ...names]))
    batchSetDenied(names, true)
  }

  const toggleCollapse = (key: string): void => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const disableGroup = (rows: ToolRow[]): void => {
    batchSetDenied(rows.map((t) => t.name), true)
  }

  const enableGroup = (rows: ToolRow[]): void => {
    batchSetDenied(rows.map((t) => t.name), false)
  }

  const selectGroup = (rows: ToolRow[]): void => {
    const names = rows.map((t) => t.name)
    setSelected((prev) => {
      const allSelected = names.length > 0 && names.every((n) => prev.has(n))
      const next = new Set(prev)
      for (const n of names) {
        if (allSelected) next.delete(n)
        else next.add(n)
      }
      return next
    })
  }

  const highlight = (text: string, q: string): ReactElement | string => {
    if (!q) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark>{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  return (
    <div className="tm-page">
      <h3>工具管理（纯净预设 clean-agent）</h3>
      <p className="tm-desc">
        针对 clean-agent 纯净预设控制工具面：MCP 工具与 DSH 原生工具默认启用，第三方插件工具默认屏蔽。
        每个工具右侧的开关控制「启用/禁用」，左侧 ☑️ 用于批量选中。改动即时自动保存，对新会话生效。
      </p>
      {!loaded ? (
        <p className="tm-hint">加载中…</p>
      ) : (
        <>
          <div className="tm-search">
            <input
              className="tm-input"
              placeholder="搜索工具名或描述…"
              value={query}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
            />
            <div className="tm-filter">
              {([
                ['all', '全部'],
                ['enabled', '已启用'],
                ['denied', '已屏蔽'],
              ] as const).map(([val, label]) => (
                <button
                  key={val}
                  className={'tm-btn ghost' + (filter === val ? ' tm-active' : '')}
                  onClick={() => setFilter(val)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="tm-count">
            共 {tools.length} 个工具
            {query.trim() || filter !== 'all' ? `，筛选后 ${filteredTools.length} 个` : ''}
          </div>

          <div className="tm-batch">
            <span className="tm-count">已选 {selected.size} 个</span>
            <button className="tm-btn ghost" onClick={toggleSelectAll}>
              {allVisibleSelected ? '取消全选' : '全选'}
            </button>
            <button className="tm-btn danger" onClick={() => batchSetDenied([...selected], true)} disabled={selected.size === 0}>
              禁用选中
            </button>
            <button className="tm-btn ghost" onClick={() => batchSetDenied([...selected], false)} disabled={selected.size === 0}>
              启用选中
            </button>
            <span className="tm-sep" />
            <button className="tm-btn ghost" onClick={() => selectDisableCategory('mcp')}>
              选中并禁用所有 MCP
            </button>
            <button className="tm-btn ghost" onClick={() => selectDisableCategory('third')}>
              选中并禁用所有第三方
            </button>
          </div>

          <div className="tm-rule">
            <label>屏蔽前缀（附加）</label>
            <PrefixInput cfg={cfg} commit={commit} />
          </div>

          {sections.map((sec) => (
            <div className="tm-group" key={sec.cat}>
              <h4>{sec.label}</h4>
              {sec.subs.map((sub) => {
                const isCollapsed = collapsed.has(sub.key)
                const groupAllSelected = sub.rows.length > 0 && sub.rows.every((t) => selected.has(t.name))
                return (
                  <div className="tm-subgroup" key={sub.key}>
                    <div className="tm-subhead">
                      <button
                        className="tm-fold"
                        onClick={() => toggleCollapse(sub.key)}
                        title={isCollapsed ? '展开' : '折叠'}
                      >
                        {isCollapsed ? '▸' : '▾'}
                      </button>
                      <span className="tm-subtitle">
                        {sub.label || '全部'}
                        <span className="tm-subcount">{sub.rows.length}</span>
                      </span>
                      <div className="tm-group-actions">
                        <button
                          className="tm-btn tm-mini tm-blue"
                          onClick={() => selectGroup(sub.rows)}
                          title={groupAllSelected ? '取消选中的该分组工具' : '选中该分组内所有工具（用于批量操作）'}
                        >
                          {groupAllSelected ? '取消选中' : '选中分组'}
                        </button>
                        <button
                          className="tm-btn tm-mini tm-danger"
                          onClick={() => disableGroup(sub.rows)}
                          title="把该分组内所有工具设为禁用"
                        >
                          禁用分组
                        </button>
                        <button
                          className="tm-btn tm-mini tm-success"
                          onClick={() => enableGroup(sub.rows)}
                          title="把该分组内所有工具设为启用"
                        >
                          启用分组
                        </button>
                      </div>
                    </div>
                    {!isCollapsed ? (
                      <div className="tm-tools">
                        {sub.rows.map((t) => {
                          const denied = isEffectivelyDenied(t.name)
                          const sel = selected.has(t.name)
                          return (
                            <div
                              className={'tm-chip' + (denied ? ' denied' : '') + (sel ? ' selected' : '')}
                              key={t.name}
                              title={(t.description || '') + '（' + (t.group ? t.group + ' · ' : '') + (denied ? '已禁用' : '已启用') + '）'}
                            >
                              <input
                                type="checkbox"
                                checked={sel}
                                onChange={() => toggleSelect(t.name)}
                                title="选中（用于批量操作）"
                              />
                              <span className="tm-name">{highlight(t.name, query.trim())}</span>
                              <button
                                className={'tm-switch' + (denied ? ' off' : ' on')}
                                role="switch"
                                aria-checked={!denied}
                                onClick={() => toggle(t.name, !denied)}
                                title={denied ? '点击启用' : '点击禁用'}
                              >
                                {denied ? '禁用' : '启用'}
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ))}

          <div className="tm-save-row">
            <button className="tm-btn ghost" onClick={reset}>恢复默认</button>
            {status ? (
              <span className={'tm-status' + (status.startsWith('❌') || status.startsWith('⚠️') ? ' err' : '')}>{status}</span>
            ) : null}
          </div>
          <div className="tm-hint">
            提示：启用/禁用即时自动保存，通过工具名前缀或精确名生效；「禁用分组 / 禁用选中 / 一键禁用」只写纯净预设屏蔽名单（denyNames），不关闭 MCP/插件服务本身。修改后请新建 clean-agent 会话验证工具面。
            配置文件：$DSH_HOME/.dsh/tool-manager.json
          </div>
        </>
      )}
    </div>
  )
}

function PrefixInput(props: {
  cfg: Config
  commit: (next: Config) => void
}): ReactElement {
  const [value, setValue] = useState('')
  const { cfg, commit } = props

  const add = (): void => {
    const v = value.trim()
    if (v && !cfg.denyPrefixes.includes(v)) {
      commit({ ...cfg, denyPrefixes: [...cfg.denyPrefixes, v] })
    }
    setValue('')
  }

  return (
    <>
      <input
        className="tm-input"
        placeholder="screenshot_"
        value={value}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setValue(e.target.value)}
        onKeyDown={(e: KeyboardEvent) => { if (e.key === 'Enter') add() }}
      />
      <button className="tm-btn ghost" onClick={add}>＋</button>
      {cfg.denyPrefixes.map((p) => (
        <span className="tm-chip" key={p} style={{ marginRight: 6 }}>
          {p}
          <button
            className="tm-btn danger"
            style={{ padding: '0 4px', margin: '0 0 0 4px' }}
            onClick={() => commit({ ...cfg, denyPrefixes: cfg.denyPrefixes.filter((q) => q !== p) })}
          >
            ✕
          </button>
        </span>
      ))}
    </>
  )
}

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tool-manager',
    order: 20,
    label: () => '工具管理',
  }, ToolManagerSection))
}