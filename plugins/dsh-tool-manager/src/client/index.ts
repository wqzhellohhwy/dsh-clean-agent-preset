/**
 * @dsh-external/dsh-tool-manager — client 设置页(settings.section)。
 * 在 DSH Web GUI 设置侧栏新增「工具管理」页面:枚举当前寄存器全部工具,
 * 按来源分类(原生/MCP/第三方),允许对「纯净预设(clean-agent)」单独
 * 屏蔽/启用任意工具;配置经同源 API 持久化到 $DSH_HOME/.dsh/tool-manager.json,
 * clean-agent 的 clean-tool-filter.mjs 装配时读取并生效(新会话生效)。
 */
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

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== void 0) e.textContent = text
  return e
}

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
.tm-chip{display:flex;align-items:center;gap:6px;border:1px solid var(--theme-border,#333);border-radius:6px;padding:4px 8px;font-size:11px;background:var(--theme-input-bg,#111)}
.tm-chip input{cursor:pointer}
.tm-chip.denied{opacity:.55;border-color:#d33}
.tm-chip.denied .tm-name{text-decoration:line-through}
.tm-name{color:var(--theme-text,#ddd);max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tm-save-row{display:flex;gap:8px;align-items:center;margin-top:12px}
.tm-status{font-size:11px;color:#5cb85c}
.tm-hint{font-size:11px;color:var(--theme-text-secondary,#999);margin-top:8px}
`

const CATEGORY_LABEL: Record<string, string> = {
  mcp: 'MCP 工具（浏览器/搜索等外部能力，默认启用）',
  native: 'DSH 原生工具 / 纯净预设装配（默认启用）',
  third: '宿主第三方插件工具（纯净预设默认屏蔽）',
  unknown: '其他',
}

function catPriority(c: string): number {
  return c === 'native' ? 0 : c === 'mcp' ? 1 : c === 'third' ? 2 : 3
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.textContent = styles
    document.head.appendChild(style)
    return () => style.remove()
  }, 'tool-manager: styles')

  function ToolManagerSection(): { render(container: HTMLElement): void } {
    let tools: ToolRow[] = []
    let cfg: Config = { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] }
    let status = ''
    const container = document.createElement('div')

    async function load(): Promise<void> {
      try {
        const res = await fetch(`${API}/tools`)
        const body = await res.json()
        tools = (body?.tools ?? []) as ToolRow[]
        cfg = (body?.config ?? { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] }) as Config
      } catch {
        tools = []
        cfg = { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] }
        status = '⚠️ 无法连接 host API（/tool-manager/api）'
      }
      render()
    }

    function isEffectivelyDenied(name: string): boolean {
      if (cfg.allowNames.includes(name)) return false
      if (cfg.allowPrefixes.some((p) => name.startsWith(p))) return false
      if (name.startsWith('mcp__')) return false // 默认豁免
      if (cfg.denyNames.includes(name)) return true
      if (cfg.denyPrefixes.some((p) => name.startsWith(p))) return true
      // 默认第三方前缀与 clean-tool-filter.mjs 保持一致
      const d = ['dev_', 'memory', 'dtodo', 'skill_manage', 'undo_', 'redteam_', 'ssh_', 'context_audit', 'describe_image', 'de_']
      return d.some((p) => name.startsWith(p))
    }

    function toggle(name: string, denied: boolean): void {
      // 官方原生工具不允许整组屏蔽（只允许精确到名 + allow 豁免反向恢复）
      if (denied && !cfg.denyNames.includes(name)) cfg.denyNames.push(name)
      if (!denied) {
        cfg.denyNames = cfg.denyNames.filter((n) => n !== name)
        // 若命中默认第三方前缀且用户想启用 → 加入 allowNames 豁免
        const d = ['dev_', 'memory', 'dtodo', 'skill_manage', 'undo_', 'redteam_', 'ssh_', 'context_audit', 'describe_image', 'de_']
        if (d.some((p) => name.startsWith(p)) && !cfg.allowNames.includes(name)) cfg.allowNames.push(name)
      }
      render()
    }

    function save(): void {
      void (async () => {
        try {
          const res = await fetch(`${API}/config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cfg),
          })
          const body = await res.json()
          status = body?.ok ? '✅ 已保存：新会话的 clean-agent 装配将生效' : '❌ 保存失败：' + (body?.error ?? 'unknown')
        } catch (e) {
          status = '❌ 保存失败：' + String(e)
        }
        render()
      })()
    }

    function resetToDefault(): void {
      cfg = { denyPrefixes: [], denyNames: [], allowPrefixes: [], allowNames: [] }
      render()
    }

    function render(): void {
      container.innerHTML = ''
      container.className = 'tm-page'

      container.appendChild(el('h3', undefined, '工具管理（纯净预设 clean-agent）'))

      const desc = el('p', 'tm-desc',
        '针对 clean-agent 纯净预设控制工具面：MCP 工具与 DSH 原生工具默认启用，第三方插件工具默认屏蔽。'
        + '勾选 = 屏蔽，取消勾选 = 启用。保存后对新会话生效。')
      container.appendChild(desc)

      // ── 配置摘要 ──
      const rule = el('div', 'tm-rule')
      const ruleLabel = el('label', undefined, '屏蔽前缀（附加）')
      const prefixInput = el('input', 'tm-input')
      ;(prefixInput as HTMLInputElement).placeholder = 'screenshot_'
      const addPrefix = el('button', 'tm-btn ghost', '＋')
      addPrefix.addEventListener('click', () => {
        const v = (prefixInput as HTMLInputElement).value.trim()
        if (v && !cfg.denyPrefixes.includes(v)) cfg.denyPrefixes.push(v)
        ;(prefixInput as HTMLInputElement).value = ''
        render()
      })
      rule.appendChild(ruleLabel)
      rule.appendChild(prefixInput)
      rule.appendChild(addPrefix)
      const chips = el('div', undefined)
      cfg.denyPrefixes.forEach((p) => {
        const c = el('span', 'tm-chip', p)
        const x = el('button', 'tm-btn danger', '✕')
        x.style.padding = '0 4px'
        x.style.margin = '0 0 0 4px'
        x.addEventListener('click', () => {
          cfg.denyPrefixes = cfg.denyPrefixes.filter((q) => q !== p)
          render()
        })
        c.appendChild(x)
        chips.appendChild(c)
      })
      if (cfg.denyPrefixes.length) rule.appendChild(chips)
      container.appendChild(rule)

      // ── 工具分组清单 ──
      const groups = new Map<string, ToolRow[]>()
      for (const t of tools) {
        const arr = groups.get(t.category) ?? []
        arr.push(t)
        groups.set(t.category, arr)
      }
      const ordered = [...groups.entries()].sort((a, b) => catPriority(a[0]) - catPriority(b[0]))

      for (const [cat, rows] of ordered) {
        const group = el('div', 'tm-group')
        group.appendChild(el('h4', undefined, CATEGORY_LABEL[cat] ?? cat))
        const box = el('div', 'tm-tools')
        for (const t of rows) {
          const denied = isEffectivelyDenied(t.name)
          const chip = el('label', 'tm-chip' + (denied ? ' denied' : ''))
          const cb = document.createElement('input')
          cb.type = 'checkbox'
          cb.checked = !denied
          cb.addEventListener('change', () => toggle(t.name, !cb.checked))
          const span = el('span', 'tm-name', t.name)
          span.title = t.description || t.name
          chip.appendChild(cb)
          chip.appendChild(span)
          box.appendChild(chip)
        }
        group.appendChild(box)
        container.appendChild(group)
      }

      // ── 保存行 ──
      const row = el('div', 'tm-save-row')
      const saveBtn = el('button', 'tm-btn', '保存配置')
      saveBtn.addEventListener('click', save)
      const resetBtn = el('button', 'tm-btn ghost', '恢复默认')
      resetBtn.addEventListener('click', resetToDefault)
      row.appendChild(saveBtn)
      row.appendChild(resetBtn)
      if (status) row.appendChild(el('span', 'tm-status', status))
      container.appendChild(row)

      container.appendChild(el('div', 'tm-hint',
        '提示：屏蔽/启用通过工具名前缀或精确名生效；修改后请新建 clean-agent 会话验证工具面。'
        + '配置文件：$DSH_HOME/.dsh/tool-manager.json'))
    }

    return { render(host: HTMLElement): void { load(); host.appendChild(container) } }
  }

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'tool-manager',
    order: 20,
    label: () => '工具管理',
  }, ToolManagerSection))
}