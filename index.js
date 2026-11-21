/**
 * dsh-pixel-art：给 DeepSeek Harness 注册画像素画的工具。
 *
 * 分工：模型负责「画什么」——给字符网格和调色板；插件负责「怎么变成图」——
 * 逐格填色、最近邻放大、手写 PNG 编码、挂附件、落盘。
 * 全程本地，不联网、不花钱、不依赖任何第三方库。
 *
 * 0.3.0：画廊作品改为 v2 存储（空格 = 透明、自定义颜色随调色板一起存），
 * 新增删除接口；旧的 v1 作品继续能打开。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_PALETTE, renderPixelArt } from './render.js'
import { renderScene, spriteCatalog } from './scene.js'
import { formatReport, inspectArt } from './inspect.js'

export const name = 'dsh-pixel-art'
export const inject = ['tools', 'attachments', 'webServer']

function outputDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'pixel-art')
}

/** 注册过程写一份磁盘日志：桌面端收走了 stdout，没日志等于没法报障 */
function logRegister(line) {
  try {
    const dir = outputDir()
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'register.log'), `${new Date().toISOString()} ${line}\n`)
  } catch { /* 写不了就算了 */ }
}

function registerToolWhenReady(ctx, label, register) {
  let done = false
  const report = (error, stage) => {
    const text = `[dsh-pixel-art] ${label} 注册失败(${stage})：${error instanceof Error ? error.message : String(error)}`
    console.error(text)
    logRegister('FAIL ' + stage + ' ' + (error instanceof Error ? error.message : String(error)))
    try {
      if (ctx.logger && typeof ctx.logger.error === 'function') ctx.logger.error(text)
    } catch { /* logger 缺席不连坐 */ }
  }
  const safeRegister = (stage) => {
    if (done) return true
    try {
      register()
      done = true
      logRegister('OK ' + stage)
      return true
    } catch (error) {
      if (/duplicate/i.test(String((error && error.message) || error))) {
        done = true
        logRegister('DUPLICATE ' + stage)
        return true
      }
      report(error, stage)
      return false
    }
  }

  // 1) 常规路径：等 tools 服务 ACTIVE 再注册
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['tools'], () => { safeRegister('inject') })
    } catch (error) { report(error, 'inject-throw') }
  }

  // 2) 兜底：不管 inject 有没有回调，自己轮询 ctx.get('tools')
  let attempts = 0
  const timer = setInterval(() => {
    attempts++
    const tools = typeof ctx.get === 'function' ? ctx.get('tools') : null
    if (tools && typeof tools.register === 'function') safeRegister('poll#' + attempts)
    if (done || attempts >= 20) {
      clearInterval(timer)
      if (!done) logRegister('GIVE_UP after ' + attempts)
    }
  }, 800)
  try {
    if (typeof ctx.effect === 'function') ctx.effect(() => () => clearInterval(timer), 'dsh-pixel-art: register poll')
  } catch { /* effect 缺席不连坐 */ }

  // 3) 老宿主：直接同步试一次
  safeRegister('sync')
}

const PALETTE_HINT = Object.entries(DEFAULT_PALETTE)
  .map(([ch, color]) => `${ch}=${color}`)
  .join(' ')

/** 只接受 { 字符: #RRGGBB[AA] } 形状，坏值直接丢掉，别让一次脏请求把 PNG 搞花 */
function cleanPalette(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out = {}
  for (const [ch, value] of Object.entries(input)) {
    if (typeof ch !== 'string' || ch.length !== 1) continue
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value.trim())) {
      out[ch] = value.trim()
    }
  }
  return out
}

const nowStamp = () => new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')

function safePrefix(name, fallback = 'pixel') {
  if (typeof name !== 'string') return fallback
  const cleaned = name.trim().replace(/[^\w\-]/g, '').slice(0, 40)
  return cleaned || fallback
}

/** 存一份能进画板画廊的记录（PNG + 网格 JSON），返回画廊里的名字；失败返回 null */
function saveGalleryRecord(dir, png, record) {
  try {
    mkdirSync(dir, { recursive: true })
    const name = `board-${nowStamp()}`
    writeFileSync(join(dir, name + '.png'), png)
    writeFileSync(join(dir, name + '.json'), JSON.stringify({ version: 2, ...record, savedAt: Date.now() }))
    return name
  } catch (error) {
    console.error('[dsh-pixel-art] 存画廊失败：', error instanceof Error ? error.message : String(error))
    return null
  }
}

async function attachImage(ctx, png, name) {
  try {
    const att = typeof ctx.get === 'function' ? ctx.get('attachments') : null
    if (att && typeof att.saveImage === 'function') {
      return await att.saveImage({ data: png, mediaType: 'image/png', name })
    }
  } catch (error) {
    console.error('[dsh-pixel-art] 挂附件失败（图已在磁盘上）：', error instanceof Error ? error.message : String(error))
  }
  return null
}

export function apply(ctx, config = {}) {
  const settings = config && typeof config === 'object' ? config : {}
  const dir = typeof settings.outputDir === 'string' && settings.outputDir.trim()
    ? settings.outputDir.trim()
    : outputDir()

  registerToolWhenReady(ctx, 'draw_pixel_art', () => ctx.tools.register(defineTool({
    name: 'draw_pixel_art',
    description:
      '画像素画：传一份字符网格（每行一个字符串、所有行等长）和调色板，本地逐格填色渲染成 PNG，' +
      '图片会保存到磁盘并直接显示在会话里。全程离线、零成本，适合 Minecraft 风格场景、方块皮肤、' +
      '像素图标、16x16 材质。要省事、不想写整张网格，改用 draw_pixel_scene 按形状和内置精灵拼图。' +
      `内置调色板（可直接用这些字符，也可用 palette 覆盖或补充）：${PALETTE_HINT}。` +
      '字符 " "（空格）表示透明。网格单边最大 1024（建议 16 到 128，太大输出会慢）；scale 是放大倍数，默认 8。正方形画布会自动进画板画廊。',
    parameters: {
      grid: {
        type: 'array',
        items: { type: 'string' },
        description: '像素网格：每个元素是一行，每个字符是一个像素。所有行必须等长，例如 ["WWW", "W.W", "WWW"]',
      },
      palette: {
        type: 'object',
        additionalProperties: true,
        description: '调色板：字符 -> #RRGGBB 或 #RRGGBBAA。会覆盖同名内置字符。不传就用内置麦块风调色板',
      },
      scale: { type: 'number', description: '每个像素放大几倍，1–32，默认 8' },
      background: { type: 'string', description: '底色 #RRGGBB，用于填充空格/透明像素。不传则透明' },
      name: { type: 'string', description: '文件名前缀（可选），最终文件名会自动加时间戳' },
      gallery: { type: 'boolean', description: '是否同时存进画板的画廊（默认 true，只有正方形画布会进）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const parts = [{ type: 'text', text: value.message }]
        if (value.attachment) parts.push({ type: 'image', attachment: value.attachment })
        return parts
      },
    },
    async execute(args) {
      const grid = Array.isArray(args.grid) ? args.grid.map((r) => String(r)) : null
      if (!grid || grid.length === 0) return { ok: false, message: 'grid 不能为空，要传字符串数组' }

      let result
      try {
        result = renderPixelArt({
          grid,
          palette: cleanPalette(args.palette),
          scale: args.scale,
          background: typeof args.background === 'string' ? args.background : '',
        })
      } catch (error) {
        return { ok: false, message: `画不出来：${error instanceof Error ? error.message : String(error)}` }
      }

      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        return { ok: false, message: `输出目录不可写（${dir}）：${error instanceof Error ? error.message : String(error)}` }
      }

      const prefix = safePrefix(args.name)
      const file = join(dir, `${prefix}-${nowStamp()}.png`)

      try {
        writeFileSync(file, result.png)
      } catch (error) {
        return { ok: false, message: `写文件失败：${error instanceof Error ? error.message : String(error)}` }
      }

      const galleryName = args.gallery !== false && result.width === result.height
        ? saveGalleryRecord(dir, result.png, {
            size: result.width,
            grid,
            palette: cleanPalette(args.palette),
            scale: result.scale,
          })
        : null
      const attachment = await attachImage(ctx, result.png, `${prefix}.png`)

      return {
        ok: true,
        file,
        gallery: galleryName,
        attachment,
        width: result.width,
        height: result.height,
        outputWidth: result.outWidth,
        outputHeight: result.outHeight,
        bytes: result.png.length,
        message:
          `像素画好了：网格 ${result.width}×${result.height}，放大 ${result.scale} 倍 → ${result.outWidth}×${result.outHeight}，${Math.round(result.png.length / 1024)}KB\n` +
          `文件：${file}\n` +
          (galleryName
            ? '已同步进画板画廊，面板里点一下就能接着改'
            : '（非正方形画布，没进画廊）'),
      }
    },
  })))

  registerToolWhenReady(ctx, 'draw_pixel_scene', () => ctx.tools.register(defineTool({
    name: 'draw_pixel_scene',
    description:
      '用「形状 + 内置精灵」画像素画：把一组 op 按顺序叠到画布上，本地渲染成 PNG 并显示在会话里。' +
      '这条工具专门给没有生图能力的模型用——不用逐格写上千个字符，描述场景就能出图。' +
      '坐标原点在左上角，单位是像素格，超出画布自动裁掉；颜色写 #RRGGBB 或 #RRGGBBAA；不传 background 就是透明底。' +
      'op 形状：' +
      "{shape:'fill', color} 铺满；" +
      "{shape:'rect', x,y,w,h, color, fill?} 矩形（fill:false 只画框）；" +
      "{shape:'line', x1,y1,x2,y2, color, width?} 直线（width 1–16）；" +
      "{shape:'curve', points:[[x,y]×3|4], color, width?, fill?} 贝塞尔曲线（3 点二次 / 4 点三次，fill 闭合填充）；" +
      "{shape:'stroke', points:[[x,y],...], color, width?, closed?} 折线路径（2 点以上）；" +
      "{shape:'mirror', axis?, ops:[...]} 把嵌套 op 镜像到另一侧（轴默认画布中线）；" +
      "{shape:'circle', x,y,r, color, fill?} 圆（x/y 是圆心）；" +
      "{shape:'ellipse', x,y,rx,ry, color, fill?} 椭圆；" +
      "{shape:'polygon', points:[[x,y],...], color, fill?} 多边形/三角形（fill:false 只画边）；" +
      "{shape:'dither', x,y,w,h, color, density?} 点阵填充，density 25/50/75 做明暗过渡；" +
      "{shape:'sprite', name, x,y, scale?, flipX?, tint?} 贴内置精灵（x/y 是左上角，scale 1–8，tint 整体染色）；" +
      "{shape:'grid', rows:['..','..'], x,y} 小范围逐格画（空格和 . 透明）。" +
      `内置精灵（名 宽×高）：${spriteCatalog().join('、')}。` +
      '常用色：#8ec9ff 天蓝 #d6ecff 浅蓝 #ffffff 白 #5fa73a 草 #4a8a2e 深草 #8b5a2b 土 #a83c2c 红屋顶 #ffe066 黄 #2a2a2a 近黑 #e8b48a 肤 #d8a3c0 粉。' +
      '画法建议：先铺天空和地面，再摆精灵，最后用 curve/circle/polygon/grid 补细节；对称的东西只画半边再包一层 mirror，token 直接减半；圆形叠圆形再错开一点就是明暗和体积，dither 能抹平色块过渡；正方形画布会自动进画板画廊。',
    parameters: {
      ops: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: '按顺序执行的形状列表，每个元素是一个对象，例如 {shape:"rect",x:0,y:24,w:32,h:8,color:"#5fa73a"}',
      },
      width: { type: 'number', description: '画布宽 1–1024，默认 32' },
      height: { type: 'number', description: '画布高 1–1024，默认跟宽一样' },
      background: { type: 'string', description: '底色 #RRGGBB；不传就是透明底' },
      palette: { type: 'object', additionalProperties: true, description: '给 grid op 用的字符 → #RRGGBB 映射（可选）' },
      scale: { type: 'number', description: '放大倍数 1–32，默认 8' },
      name: { type: 'string', description: '文件名前缀（可选），最终文件名会自动加时间戳' },
      gallery: { type: 'boolean', description: '是否同时存进画板画廊（默认 true，只有正方形画布会进）' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => {
        const parts = [{ type: 'text', text: value.message }]
        if (value.attachment) parts.push({ type: 'image', attachment: value.attachment })
        return parts
      },
    },
    async execute(args) {
      let result
      try {
        result = renderScene({
          width: args.width,
          height: args.height,
          background: typeof args.background === 'string' ? args.background : '',
          palette: cleanPalette(args.palette),
          ops: args.ops,
          scale: args.scale,
        })
      } catch (error) {
        return { ok: false, message: `画不出来：${error instanceof Error ? error.message : String(error)}` }
      }

      try {
        mkdirSync(dir, { recursive: true })
      } catch (error) {
        return { ok: false, message: `输出目录不可写（${dir}）：${error instanceof Error ? error.message : String(error)}` }
      }

      const prefix = safePrefix(args.name, 'scene')
      const file = join(dir, `${prefix}-${nowStamp()}.png`)
      try {
        writeFileSync(file, result.png)
      } catch (error) {
        return { ok: false, message: `写文件失败：${error instanceof Error ? error.message : String(error)}` }
      }

      const galleryName = args.gallery !== false && result.width === result.height
        ? saveGalleryRecord(dir, result.png, {
            size: result.width,
            grid: result.grid,
            palette: result.palette,
            scale: result.scale,
          })
        : null
      const attachment = await attachImage(ctx, result.png, `${prefix}.png`)

      return {
        ok: true,
        file,
        gallery: galleryName,
        attachment,
        width: result.width,
        height: result.height,
        outputWidth: result.outWidth,
        outputHeight: result.outHeight,
        bytes: result.png.length,
        message:
          `场景画好了：画布 ${result.width}×${result.height}，放大 ${result.scale} 倍 → ${result.outWidth}×${result.outHeight}，${Math.round(result.png.length / 1024)}KB\n` +
          `文件：${file}\n` +
          (galleryName
            ? '已同步进画板画廊，面板里点一下就能接着改'
            : '（非正方形画布，没进画廊）'),
      }
    },
  })))

  // 自检：只输出事实，不替模型改坐标
  registerToolWhenReady(ctx, 'inspect_pixel_art', () => ctx.tools.register(defineTool({
    name: 'inspect_pixel_art',
    description:
      '把画布反序列化成「带坐标的字符网格」并做结构诊断，全程不靠识图。' +
      'op 可以带 label（left_eye / right_eye / mouth / nose），工具只返回事实和违规项：' +
      '双眼中心 y 差、嘴是否在双眼下方、鼻点是否在两眼之间、鼻嘴先后、左右对称度、覆盖率、用色数。' +
      '它不会替你改坐标——读完之后改哪个 op、改几像素，由你决定，改完再调一次本工具复核。' +
      '适合「生成 → 自检 → 只改被定位到的参数 → 再自检」的收敛循环。',
    parameters: {
      ops: {
        type: 'array',
        items: { type: 'object', additionalProperties: true },
        description: '要检查的 op 列表（和 draw_pixel_scene 同一套形状，可带 label）',
      },
      grid: {
        type: 'array',
        items: { type: 'string' },
        description: '也可以直接给字符网格（传了 ops 就忽略 grid）',
      },
      width: { type: 'number', description: '画布宽，默认 32' },
      height: { type: 'number', description: '画布高，默认跟宽一样' },
      background: { type: 'string', description: '底色 #RRGGBB（可选）' },
      palette: { type: 'object', additionalProperties: true, description: '自定义字符 → 颜色（可选）' },
      maxRows: { type: 'number', description: '文本网格最多行数，默认 64，超过会按步长降采样' },
      checkSymmetry: { type: 'boolean', description: '是否算左右对称度，默认 true' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      try {
        const report = inspectArt({
          width: args.width,
          height: args.height,
          ops: Array.isArray(args.ops) ? args.ops : null,
          grid: Array.isArray(args.grid) ? args.grid : null,
          palette: cleanPalette(args.palette),
          background: typeof args.background === 'string' ? args.background : '',
          maxRows: args.maxRows,
          checkSymmetry: args.checkSymmetry !== false,
        })
        return {
          ok: report.ok,
          ...report,
          message: formatReport(report),
        }
      } catch (error) {
        return { ok: false, message: `检查失败：${error instanceof Error ? error.message : String(error)}` }
      }
    },
  })))

  console.log(`[dsh-pixel-art] 已加载，输出目录：${dir}`)

  // ---- 网页画板 + 画廊：/dsh-pixel-art ----
  const registerBoard = () => {
    const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : null
    if (!webServer || typeof webServer.register !== 'function') {
      console.error('[dsh-pixel-art] webServer 不可用，画板路由没挂上')
      return
    }
    const boardFile = join(dirname(fileURLToPath(import.meta.url)), 'board.html')

    const sendJson = (res, code, obj) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(obj))
    }
    const readBody = (req, limit = 4 * 1024 * 1024) => new Promise((resolve, reject) => {
      let size = 0
      const chunks = []
      req.on('data', (c) => {
        size += c.length
        if (size > limit) { reject(new Error('请求体太大')); req.destroy(); return }
        chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
    const listGallery = () => {
      try {
        mkdirSync(dir, { recursive: true })
        return readdirSync(dir)
          .filter((f) => f.endsWith('.png') && f.startsWith('board-'))
          .map((f) => {
            const base = f.slice(0, -4)
            const full = join(dir, f)
            let mtime = 0
            try { mtime = statSync(full).mtimeMs } catch { /* 忽略 */ }
            return { name: base, png: f, hasGrid: existsSync(join(dir, base + '.json')), mtime }
          })
          .sort((a, b) => b.mtime - a.mtime)
          .slice(0, 120)
      } catch {
        return []
      }
    }

    ctx.effect(() => webServer.register({
      kind: 'prefix',
      path: '/dsh-pixel-art',
      async handler(req, res) {
        const url = new URL(req.url || '/', 'http://localhost')
        const sub = url.pathname.slice('/dsh-pixel-art'.length) || '/'

        if (sub === '/' || sub === '') {
          // 每次现读：改完 board.html 刷新页面就能看到，不用重启宿主
          let html = ''
          try {
            html = readFileSync(boardFile, 'utf8')
          } catch (error) {
            res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('读不到 board.html：' + (error instanceof Error ? error.message : String(error)))
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
          res.end(html)
          return
        }

        if (sub === '/api/list') {
          sendJson(res, 200, { ok: true, items: listGallery() })
          return
        }

        if (sub === '/api/save' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req))
            const palette = cleanPalette(body.palette)
            const result = renderPixelArt({
              grid: body.grid,
              palette,
              scale: body.scale,
              background: typeof body.background === 'string' ? body.background : '',
            })
            mkdirSync(dir, { recursive: true })
            const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
            const name = `board-${stamp}`
            writeFileSync(join(dir, name + '.png'), result.png)
            writeFileSync(join(dir, name + '.json'), JSON.stringify({
              version: 2,
              size: result.width,
              grid: body.grid,
              palette,
              scale: result.scale,
              savedAt: Date.now(),
            }))
            sendJson(res, 200, { ok: true, name, width: result.width, height: result.height })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        if (sub === '/api/delete' && req.method === 'POST') {
          try {
            const body = JSON.parse(await readBody(req, 64 * 1024))
            const name = typeof body.name === 'string' ? body.name : ''
            if (!/^board-[\w.\-]+$/.test(name) || name.includes('..')) {
              sendJson(res, 400, { ok: false, error: '名字不合法' })
              return
            }
            let removed = 0
            for (const file of [join(dir, name + '.png'), join(dir, name + '.json')]) {
              try {
                if (existsSync(file)) { unlinkSync(file); removed++ }
              } catch { /* 单个文件删不掉就算了 */ }
            }
            sendJson(res, 200, { ok: true, removed })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          }
          return
        }

        if (sub.startsWith('/img/')) {
          let name
          try { name = decodeURIComponent(sub.slice(5)) } catch { res.writeHead(400); res.end('bad name'); return }
          if (!/^[\w\-\.]+\.(png|json)$/.test(name)) { res.writeHead(400); res.end('bad name'); return }
          const file = join(dir, name)
          if (!existsSync(file)) { res.writeHead(404); res.end('not found'); return }
          res.writeHead(200, {
            'Content-Type': name.endsWith('.json') ? 'application/json; charset=utf-8' : 'image/png',
            'Cache-Control': 'no-store',
          })
          res.end(readFileSync(file))
          return
        }

        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end('not found')
      },
    }))
    console.log('[dsh-pixel-art] 画板已挂到 /dsh-pixel-art')
  }
  if (typeof ctx.inject === 'function') {
    try { ctx.inject(['webServer'], registerBoard) } catch { registerBoard() }
  } else {
    registerBoard()
  }
}
