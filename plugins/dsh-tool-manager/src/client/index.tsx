/**
 * @dsh-external/dsh-tool-manager — client 设置页(settings.section)。
 * 在 DSH Web GUI 设置侧栏新增「工具管理」页面:枚举当前寄存器全部工具,
 * 按来源分类(原生/MCP/第三方),允许对「纯净预设(clean-agent)」单独
 * 屏蔽/启用任意工具;配置经同源 API 持久化到 $DSH_HOME/.dsh/tool-manager.json,
 * clean-agent 的 clean-tool-filter.mjs 装配时读取并生效(新会话生效)。
 *
 * ⚠️ 组件契约:settings.section 的注册组件必须是 React 组件(与 mcp-manager /
 * undo 插件一致);纯 DOM 的 { render() } 形状会导致 active:false、页面空白。
 * 本文件用 JSX(tsx)编译,tsdown 自动转 react/jsx-runtime——不要改成
 * React.createElement 全局名,那在运行时是 undefined。
 */
import { useEffect, useMemo, useState, type ReactElement, type ChangeEvent, type KeyboardEvent, type Dispatch, type SetStateAction } from 'react'
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
  mcp: 'MCP 工具（浏览器/搜索等外部能力，默认启用）',
  native: 'DSH 原生工具 / 纯净预设装配（默认启用）',
  third: '宿主第三方插件工具（纯净预设默认屏蔽）',
  unknown: '其他',
}

const catPriority = (c: string): number =>
  c === 'native' ? 0 : c === 'mcp' ? 1 : c === 'third' ? 2 : 3

const styles = `
.tm-page{font-family:ui-monospace,monospace;font-size:12px;line-height:1.6;padding:14px 16px;max-width:860px}
.tm-page h3{margin:0 0 6px;font-size:13px}
.tm-desc{color:var(--theme-text-secondary,#999);margin:0 0 12px}
.tm-rule{background:var(--theme-input-bg,#111);border:1px solid var(--theme-border,#333);border-radius:8px;padding:10px 12px;margin-bottom:12px}
.tm-rule label{display:inline-block;margin-right:10px;font-size:11px;color:var(--theme-text-secondary,#aaa)}
.tm-input{background:var(--theme-input-bg,#111);color:var(--theme-text,#ddd);border:1px solid var(--theme-border,#333);border-radius:6px;padding:5px 8px;font-size:12px;width:210px;margin-right:6px}
.tm-btn{background:var(--theme-accent,#4a9eff);color:#fff;border:none;border-radius:6px;padding:6px 12px;cursor:pointer;font-size:12px;white-space:nowrap}
.tm-btn.ghost{background:transparent;border:1px solid var(--theme-border,#444);color:var(--theme-text,#ccc)}
.tm-btn.danger{background:transparent;border:1px solid #d33;color:#d33}
.tm-group{margin-bottom:14px}
.tm-group h4{margin:0 0 4px;font-size:12px;color:var(--theme-accent,#4a9eff)}
.tm-tools{display:flex;flex-wrap:wrap;gap:6px}
.tm-chip{display:flex;align-items:center;gap:6px;border:1px solid var(--theme-border,#333);border-radius:6px;padding:4px 8px;font-size:11px;background:var(--theme-input-bg,#111);cursor:pointer}
.tm-chip input{cursor:pointer}
.tm-chip.denied{opacity:.55;border-color:#d33}
.tm-chip.denied .tm-name{text-decoration:line-through}
.tm-name{color:var(--theme-text,#ddd);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm-save-row{display:flex;gap:8px;align-items:center;margin-top:12px}
.tm-status{font-size:11px;color:#5cb85c}
.tm-status.err{color:#d9534f}
.tm-hint{font-size:11px;color:var(--theme-text-secondary,#999);margin-top:8px}
`

function ToolManagerSection(): ReactElement {
  const [tools, setTools] = useState<ToolRow[]>([])
  const [cfg, setCfg] = useState<Config>({ denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] })
  const [status, setStatus] = useState('')
  const [loaded, setLoaded] = useState(false)

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
    if (name.startsWith('mcp__')) return false
    if (cfg.denyNames.includes(name)) return true
    if (cfg.denyPrefixes.some((p) => name.startsWith(p))) return true
    return DEFAULT_THIRD_PREFIXES.some((p) => name.startsWith(p))
  }

  const toggle = (name: string, denied: boolean): void => {
    setCfg((prev) => {
      const next: Config = { ...prev, denyNames: [...prev.denyNames], allowNames: [...prev.allowNames] }
      if (denied) {
        if (!next.denyNames.includes(name)) next.denyNames.push(name)
      } else {
        next.denyNames = next.denyNames.filter((n) => n !== name)
        if (DEFAULT_THIRD_PREFIXES.some((p) => name.startsWith(p)) && !next.allowNames.includes(name)) {
          next.allowNames.push(name)
        }
      }
      return next
    })
  }

  const save = (): void => {
    void (async () => {
      try {
        const res = await fetch(`${API}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cfg),
        })
        const body = await res.json()
        setStatus(body?.ok
          ? '✅ 已保存：新会话的 clean-agent 装配将生效'
          : '❌ 保存失败：' + (body?.error ?? 'unknown'))
      } catch (e) {
        setStatus('❌ 保存失败：' + String(e))
      }
    })()
  }

  const reset = (): void => {
    setCfg({ denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] })
    setStatus('已恢复默认名单（未保存，点「保存配置」生效）')
  }

  const groups = useMemo(() => {
    const map = new Map<string, ToolRow[]>()
    for (const t of tools) {
      const arr = map.get(t.category) ?? []
      arr.push(t)
      map.set(t.category, arr)
    }
    return [...map.entries()].sort((a, b) => catPriority(a[0]) - catPriority(b[0]))
  }, [tools])

  return (
    <div className="tm-page">
      <h3>工具管理（纯净预设 clean-agent）</h3>
      <p className="tm-desc">
        针对 clean-agent 纯净预设控制工具面：MCP 工具与 DSH 原生工具默认启用，第三方插件工具默认屏蔽。
        勾选 = 屏蔽，取消勾选 = 启用。保存后对新会话生效。
      </p>
      {!loaded ? (
        <p className="tm-hint">加载中…</p>
      ) : (
        <>
          <div className="tm-rule">
            <label>屏蔽前缀（附加）</label>
            <PrefixInput cfg={cfg} setCfg={setCfg} />
          </div>
          {groups.map(([cat, rows]) => (
            <div className="tm-group" key={cat}>
              <h4>{CATEGORY_LABEL[cat] ?? cat}</h4>
              <div className="tm-tools">
                {rows.map((t) => {
                  const denied = isEffectivelyDenied(t.name)
                  return (
                    <label className={'tm-chip' + (denied ? ' denied' : '')} key={t.name} title={t.description || t.name}>
                      <input type="checkbox" checked={!denied} onChange={() => toggle(t.name, !denied)} />
                      <span className="tm-name">{t.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          ))}
          <div className="tm-save-row">
            <button className="tm-btn" onClick={save}>保存配置</button>
            <button className="tm-btn ghost" onClick={reset}>恢复默认</button>
            {status ? (
              <span className={'tm-status' + (status.startsWith('❌') || status.startsWith('⚠️') ? ' err' : '')}>{status}</span>
            ) : null}
          </div>
          <div className="tm-hint">
            提示：屏蔽/启用通过工具名前缀或精确名生效；修改后请新建 clean-agent 会话验证工具面。
            配置文件：$DSH_HOME/.dsh/tool-manager.json
          </div>
        </>
      )}
    </div>
  )
}

function PrefixInput(props: {
  cfg: Config
  setCfg: Dispatch<SetStateAction<Config>>
}): ReactElement {
  const [value, setValue] = useState('')
  const { cfg, setCfg } = props

  const add = (): void => {
    const v = value.trim()
    if (v && !cfg.denyPrefixes.includes(v)) {
      setCfg({ ...cfg, denyPrefixes: [...cfg.denyPrefixes, v] })
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
            onClick={() => setCfg({ ...cfg, denyPrefixes: cfg.denyPrefixes.filter((q) => q !== p) })}
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