/**
 * dsh-deepseek-art — 客户端半边（0.3.0）。
 *
 * 左侧栏「像素画板」入口 + 中间整页面板：面板只负责仪表盘（作品数 / 今日 / 可编辑 / 最新）
 * 和把画板页嵌进来，真正的画布在 board.html 里，样式与数据都落在插件自己的路线上。
 *
 * 设计规范：白底 + #111 前景，只用黑白灰；强调/选中用反色；图标用 SVG；圆角 12/8/4；边框 1px；正文 13px。
 */
window.__ModuleLoader__.load({
  id: 'dsh-deepseek-art',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')
    const h = React.createElement
    const { useState, useEffect } = React

    const inject = ['slots']

    const API = '/dsh-deepseek-art'
    const KEY = 'dsh-deepseek-art'

    const CSS = `
      .pix-page{
        display:flex;flex-direction:column;gap:14px;
        padding:18px 22px 20px;height:100%;box-sizing:border-box;
        overflow:hidden;color:#111111;background:#ffffff;
        font-size:13px;line-height:1.55;
      }
      .pix-head{display:flex;align-items:center;gap:10px;flex:none;flex-wrap:wrap}
      .pix-head h1{margin:0;font-size:17px;font-weight:600;letter-spacing:.2px;color:#111111}
      .pix-pill{
        font-size:11px;padding:2px 9px;border-radius:999px;
        border:1px solid #e6e6e6;color:#777777;
      }
      .pix-spacer{flex:1}
      .pix-hint{font-size:12px;color:#999999}
      .pix-open{
        display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;
        border:1px solid #e6e6e6;border-radius:8px;background:#ffffff;
        color:#111111;font-size:12px;text-decoration:none;
        transition:background .12s,border-color .12s;
      }
      .pix-open:hover{background:#f6f6f6;border-color:#c9c9c9}
      .pix-open:focus-visible{outline:2px solid #111111;outline-offset:2px}
      .pix-kpis{
        display:grid;grid-template-columns:repeat(4,minmax(0,1fr));
        gap:12px;flex:none;
      }
      .pix-kpi{
        border:1px solid #e6e6e6;border-radius:12px;padding:12px 14px;
        background:#ffffff;display:flex;flex-direction:column;gap:3px;min-width:0;
      }
      .pix-kpi .k{font-size:11px;color:#777777;letter-spacing:.3px}
      .pix-kpi .v{
        font-size:22px;font-weight:600;line-height:1.15;color:#111111;
        font-variant-numeric:tabular-nums;
        white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      }
      .pix-kpi .s{font-size:11px;color:#999999;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .pix-frame-wrap{
        flex:1 1 auto;min-height:320px;display:flex;
        border:1px solid #e6e6e6;border-radius:12px;overflow:hidden;background:#ffffff;
      }
      .pix-frame{flex:1;width:100%;height:100%;border:0;display:block;background:#ffffff}
      .pix-empty{
        flex:1;display:flex;align-items:center;justify-content:center;
        color:#999999;font-size:12.5px;
      }
      @media (max-width:720px){
        .pix-page{padding:14px}
        .pix-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
        .pix-hint{display:none}
      }
      @media (prefers-reduced-motion: reduce){ .pix-open{transition:none} }
    `

    function useStyleOnce() {
      useEffect(() => {
        const tag = document.createElement('style')
        tag.textContent = CSS
        tag.dataset.pixArt = '1'
        document.head.appendChild(tag)
        return () => { tag.remove() }
      }, [])
    }

    function relTime(ms) {
      if (!ms) return '—'
      const diff = Date.now() - ms
      const m = Math.floor(diff / 60000)
      if (m < 1) return '刚刚'
      if (m < 60) return m + ' 分钟前'
      const hour = Math.floor(m / 60)
      if (hour < 24) return hour + ' 小时前'
      const day = Math.floor(hour / 24)
      if (day === 1) return '昨天'
      const dt = new Date(ms)
      const now = new Date()
      if (dt.getFullYear() === now.getFullYear()) return (dt.getMonth() + 1) + '月' + dt.getDate() + '日'
      return dt.getFullYear() + '/' + (dt.getMonth() + 1) + '/' + dt.getDate()
    }

    function KPI(props) {
      return h('div', { className: 'pix-kpi' }, [
        h('div', { className: 'k', key: 'k' }, props.label),
        h('div', { className: 'v', key: 'v' }, props.value),
        h('div', { className: 's', key: 's' }, props.sub || ''),
      ])
    }

    function PixelPage() {
      useStyleOnce()
      const [items, setItems] = useState([])
      const [ready, setReady] = useState(false)

      useEffect(() => {
        let alive = true
        const pull = () => {
          if (document.hidden) return
          fetch(`${API}/api/list`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((j) => { if (alive) { setItems(Array.isArray(j.items) ? j.items : []); setReady(true) } })
            .catch(() => { if (alive) setReady(true) })
        }
        pull()
        // 画板里存图/删图会发消息；轮询只做兜底，别在后台空转
        const timer = setInterval(pull, 15000)
        const onMessage = (e) => {
          if (e.origin !== window.location.origin) return
          if (e.data && e.data.type === 'dsh-deepseek-art:changed') pull()
        }
        const onVisible = () => { if (!document.hidden) pull() }
        window.addEventListener('message', onMessage)
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive = false
          clearInterval(timer)
          window.removeEventListener('message', onMessage)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [])

      const total = items.length
      const today = items.filter((it) => it.mtime && Date.now() - it.mtime < 86400000).length
      const withGrid = items.filter((it) => it.hasGrid).length
      const latest = items[0]

      return h('div', { className: 'pix-page' }, [
        h('div', { className: 'pix-head', key: 'head' }, [
          h('h1', { key: 't' }, '像素画板'),
          h('span', { className: 'pix-pill', key: 'p' }, 'dsh-deepseek-art'),
          h('span', { className: 'pix-spacer', key: 'sp' }),
          h('span', { className: 'pix-hint', key: 'h' }, '手写 PNG · 离线渲染 · 对话里说「画一个…」也行'),
          h('a', {
            className: 'pix-open', key: 'open', href: API, target: '_blank', rel: 'noreferrer',
            title: '在新标签页打开画板',
          }, [
            '独立打开',
            h('svg', {
              key: 'i', width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none',
              stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
              'aria-hidden': true,
            }, [
              h('path', { key: 'a', d: 'M6 3h7v7' }),
              h('path', { key: 'b', d: 'M13 3 7 9' }),
              h('path', { key: 'c', d: 'M11.5 9.5V12a1.5 1.5 0 0 1-1.5 1.5H4A1.5 1.5 0 0 1 2.5 12V6A1.5 1.5 0 0 1 4 4.5h2.5' }),
            ]),
          ]),
        ]),
        h('div', { className: 'pix-kpis', key: 'kpis' }, [
          h(KPI, { key: 'a', label: '作品总数', value: total, sub: '画廊里存着' }),
          h(KPI, { key: 'b', label: '今日新增', value: today, sub: '24 小时内' }),
          h(KPI, { key: 'c', label: '可继续编辑', value: withGrid, sub: '带网格数据' }),
          h(KPI, { key: 'd', label: '最近一张', value: latest ? relTime(latest.mtime) : '—', sub: latest ? '点缩略图就能接着改' : '还没画过' }),
        ]),
        h('div', { className: 'pix-frame-wrap', key: 'frame' },
          ready
            ? h('iframe', {
                className: 'pix-frame',
                src: `${API}?embed=1`,
                title: '像素画板',
                allow: 'clipboard-write',
              })
            : h('div', { className: 'pix-empty' }, '加载中…'),
        ),
      ])
    }

    /**
     * 侧边栏图标：2×2 像素块，三空一实，跟随侧栏前景色（黑白单色）。
     */
    function PixelIcon(props) {
      const size = typeof props?.size === 'number' ? props.size : 16
      const box = (key, x, y, solid) => h('rect', {
        key,
        x, y,
        width: 5, height: 5,
        rx: 1,
        fill: solid ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: solid ? 0 : 1.2,
      })
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16',
        style: { display: 'block' },
        'aria-hidden': 'true',
        focusable: 'false',
      }, [
        box('a', 1.5, 1.5, false),
        box('b', 9.5, 1.5, false),
        box('c', 1.5, 9.5, false),
        box('d', 9.5, 9.5, true),
      ])
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (!slots) {
        console.error('[dsh-deepseek-art] slots 服务不可用，界面入口没挂上')
        return
      }

      // 一级页面：左侧导航项 + 中间整页
      slots.inject('main', () => slots.register(
        { name: 'main', key: KEY },
        () => h(PixelPage),
      ))
      slots.inject('sidebar.panellist', () => slots.register(
        { name: 'sidebar.panellist', id: KEY, order: 30, label: () => '像素画板' },
        (props) => h(PixelIcon, props),
      ))

      // 设置页里也保留一份入口
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'pixel-art', order: 26, label: '像素画板' },
        () => h(PixelPage),
      ))

      // 插件详情页也有一份
      slots.inject('plugins.bundle.config', () => slots.register(
        { name: 'plugins.bundle.config', key: KEY },
        () => h(PixelPage),
      ))
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
