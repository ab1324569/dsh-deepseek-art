/**
 * 场景渲染器：给「没生图能力的模型」用。
 *
 * 不要求模型逐格画 32×32（一千多个字符又贵又容易错），而是描述形状和内置精灵：
 *   { shape:'rect', x:0, y:20, w:32, h:12, color:'#5fa73a' }
 *   { shape:'sprite', name:'cat', x:8, y:10, scale:1 }
 *
 * 这里只拼像素，最后交给 render.js 手写 PNG 编码。零依赖、不联网。
 */

import { DEFAULT_PALETTE, parseColor, renderPixelArt } from './render.js'
import { SPRITES, spriteRows } from './sprites.js'

const DEFAULT_MAP = { ...DEFAULT_PALETTE }
const CHAR_OF = {}
for (const [ch, hex] of Object.entries(DEFAULT_MAP)) CHAR_OF[hex.toLowerCase()] = ch

// 自定义颜色用的备用字符（避开默认调色板）
const EXTRA = '0123456789!@$&*()[]{};:<>=?/|^~'.split('').filter((c) => !(c in DEFAULT_MAP))
const extraCache = new Map()

export function spriteCatalog() {
  return Object.keys(SPRITES).map((name) => {
    const s = spriteRows(name)
    return `${name} ${s.width}×${s.height}`
  })
}

function toHex(input, where) {
  const rgba = parseColor(input)
  if (!rgba) throw new Error(`${where} 的颜色「${input}」看不懂，要 #RRGGBB 或 #RRGGBBAA`)
  const to2 = (n) => n.toString(16).padStart(2, '0')
  return `#${to2(rgba[0])}${to2(rgba[1])}${to2(rgba[2])}${rgba[3] < 255 ? to2(rgba[3]) : ''}`
}

function nearestChar(hex) {
  const [r, g, b] = parseColor(hex)
  let best = 'W'
  let bestD = Infinity
  for (const [ch, h] of Object.entries(DEFAULT_MAP)) {
    const [r2, g2, b2] = parseColor(h)
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2
    if (d < bestD) { bestD = d; best = ch }
  }
  return best
}

function charForHex(hex) {
  if (CHAR_OF[hex]) return CHAR_OF[hex]
  if (extraCache.has(hex)) return extraCache.get(hex)
  const used = new Set(Object.keys(DEFAULT_MAP))
  for (const ch of extraCache.values()) used.add(ch)
  const ch = EXTRA.find((c) => !used.has(c))
  if (!ch) return nearestChar(hex)
  extraCache.set(hex, ch)
  return ch
}

function toInt(value, fallback) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? n : fallback
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n))
}

function setCell(cells, x, y, hex) {
  if (y < 0 || y >= cells.length) return
  const row = cells[y]
  if (x < 0 || x >= row.length) return
  row[x] = hex
}

function fillRect(cells, x, y, w, h, hex) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) setCell(cells, px, py, hex)
  }
}

function stampBranch(cells, x, y, size, hex) {
  const half = Math.floor(size / 2)
  for (let dy = 0; dy < size; dy++) {
    for (let dx = 0; dx < size; dx++) setCell(cells, x - half + dx, y - half + dy, hex)
  }
}

function drawLine(cells, x1, y1, x2, y2, size, hex) {
  let x = x1
  let y = y1
  const dx = Math.abs(x2 - x1)
  const sx = x1 < x2 ? 1 : -1
  const dy = -Math.abs(y2 - y1)
  const sy = y1 < y2 ? 1 : -1
  let err = dx + dy
  for (;;) {
    stampBranch(cells, x, y, size, hex)
    if (x === x2 && y === y2) break
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x += sx }
    if (e2 <= dx) { err += dx; y += sy }
  }
}

function drawEllipse(cells, cx, cy, rx, ry, hex, filled) {
  if (rx <= 0 || ry <= 0) return
  const irx = rx - 1
  const iry = ry - 1
  for (let dy = -ry; dy <= ry; dy++) {
    for (let dx = -rx; dx <= rx; dx++) {
      const outer = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry)
      if (outer > 1) continue
      if (!filled && irx > 0 && iry > 0) {
        const inner = (dx * dx) / (irx * irx) + (dy * dy) / (iry * iry)
        if (inner <= 1) continue
      }
      setCell(cells, cx + dx, cy + dy, hex)
    }
  }
}

function normalizePoints(input, where) {
  if (!Array.isArray(input) || input.length < 3) {
    throw new Error(`${where} 的 polygon 需要至少 3 个点，格式 [[x,y],[x,y],...]`)
  }
  return input.map((point) => {
    if (Array.isArray(point) && point.length >= 2) {
      return [toInt(point[0], 0), toInt(point[1], 0)]
    }
    if (point && typeof point === 'object') {
      return [toInt(point.x, 0), toInt(point.y, 0)]
    }
    throw new Error(`${where} 的 polygon 点「${JSON.stringify(point)}」看不懂`)
  })
}

function drawPolygon(cells, points, hex, filled) {
  const count = points.length
  if (!filled) {
    for (let i = 0; i < count; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % count]
      drawLine(cells, x1, y1, x2, y2, 1, hex)
    }
    return
  }
  let minY = Infinity
  let maxY = -Infinity
  for (const [, y] of points) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  for (let y = minY; y <= maxY; y++) {
    const crossings = []
    for (let i = 0; i < count; i++) {
      const [x1, y1] = points[i]
      const [x2, y2] = points[(i + 1) % count]
      if (y1 === y2) continue
      if ((y >= y1 && y < y2) || (y >= y2 && y < y1)) {
        crossings.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1))
      }
    }
    crossings.sort((a, b) => a - b)
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.ceil(crossings[i])
      const to = Math.floor(crossings[i + 1])
      for (let x = from; x <= to; x++) setCell(cells, x, y, hex)
    }
  }
}

function applyOp(cells, width, height, op, index, named) {
  const where = `第 ${index + 1} 个 op`
  if (!op || typeof op !== 'object') throw new Error(`${where} 不是对象`)
  const shape = String(op.shape || '').toLowerCase()
  const color = (value) => toHex(value, where)

  if (shape === 'fill') {
    fillRect(cells, 0, 0, width, height, color(op.color))
    return
  }

  if (shape === 'rect') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    const w = toInt(op.w, 0)
    const h = toInt(op.h, 0)
    if (w <= 0 || h <= 0) throw new Error(`${where} 的 rect 要 w/h 大于 0`)
    const hex = color(op.color)
    if (op.fill === false) {
      fillRect(cells, x, y, w, 1, hex)
      fillRect(cells, x, y + h - 1, w, 1, hex)
      fillRect(cells, x, y + 1, 1, h - 2, hex)
      fillRect(cells, x + w - 1, y + 1, 1, h - 2, hex)
    } else {
      fillRect(cells, x, y, w, h, hex)
    }
    return
  }

  if (shape === 'line') {
    const size = clamp(toInt(op.width, 1), 1, 16)
    drawLine(cells,
      toInt(op.x1, 0), toInt(op.y1, 0),
      toInt(op.x2, 0), toInt(op.y2, 0),
      size, color(op.color))
    return
  }

  if (shape === 'circle') {
    const cx = toInt(op.x, 0)
    const cy = toInt(op.y, 0)
    const r = Math.max(0, toInt(op.r, 1))
    const hex = color(op.color)
    const filled = op.fill !== false
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        if (!filled && r > 0 && d2 <= (r - 1) * (r - 1)) continue
        setCell(cells, cx + dx, cy + dy, hex)
      }
    }
    return
  }

  if (shape === 'ellipse') {
    drawEllipse(cells,
      toInt(op.x, 0), toInt(op.y, 0),
      Math.max(1, toInt(op.rx, 1)), Math.max(1, toInt(op.ry, 1)),
      color(op.color), op.fill !== false)
    return
  }

  if (shape === 'polygon') {
    drawPolygon(cells, normalizePoints(op.points, where), color(op.color), op.fill !== false)
    return
  }

  if (shape === 'dither') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    const w = toInt(op.w, width)
    const h = toInt(op.h, height)
    if (w <= 0 || h <= 0) throw new Error(`${where} 的 dither 要 w/h 大于 0`)
    const density = clamp(toInt(op.density, 50), 1, 99)
    const hex = color(op.color)
    for (let py = y; py < y + h; py++) {
      for (let px = x; px < x + w; px++) {
        const evenX = (px & 1) === 0
        const evenY = (py & 1) === 0
        const on = density < 38
          ? evenX && evenY
          : density < 63
            ? evenX !== evenY
            : !(evenX && evenY)
        if (on) setCell(cells, px, py, hex)
      }
    }
    return
  }

  if (shape === 'grid') {
    const rows = Array.isArray(op.rows) ? op.rows.map((row) => String(row)) : null
    if (!rows || !rows.length) throw new Error(`${where} 的 grid 要一个字符串数组 rows`)
    const ox = toInt(op.x, 0)
    const oy = toInt(op.y, 0)
    for (let ry = 0; ry < rows.length; ry++) {
      const row = rows[ry]
      for (let rx = 0; rx < row.length; rx++) {
        const ch = row[rx]
        if (ch === ' ' || ch === '.') continue
        const hex = named[ch] || DEFAULT_MAP[ch]
        if (!hex) throw new Error(`${where} 的 grid 里有不认识的字符「${ch}」`)
        setCell(cells, ox + rx, oy + ry, hex)
      }
    }
    return
  }

  if (shape === 'sprite') {
    const name = String(op.name || '').toLowerCase()
    const sprite = spriteRows(name)
    if (!sprite) throw new Error(`${where} 没有叫「${op.name}」的内置精灵，可用：${spriteCatalog().join('、')}`)
    const factor = clamp(toInt(op.scale, 1), 1, 8)
    const flip = op.flipX === true
    const tint = op.tint ? color(op.tint) : null
    const ox = toInt(op.x, 0)
    const oy = toInt(op.y, 0)
    for (let sy = 0; sy < sprite.height; sy++) {
      const row = sprite.rows[sy]
      for (let sx = 0; sx < sprite.width; sx++) {
        const ch = row[flip ? sprite.width - 1 - sx : sx]
        if (ch === '.' || ch === ' ') continue
        const hex = tint || named[ch] || DEFAULT_MAP[ch]
        if (!hex) continue
        for (let py = 0; py < factor; py++) {
          for (let px = 0; px < factor; px++) {
            setCell(cells, ox + sx * factor + px, oy + sy * factor + py, hex)
          }
        }
      }
    }
    return
  }

  throw new Error(`${where} 的 shape「${op.shape}」不认识，可选 fill / rect / line / circle / ellipse / polygon / dither / grid / sprite`)
}

/**
 * 把场景描述渲染成 PNG + 网格。
 * @returns {{width,height,scale,outWidth,outHeight,grid:string[],palette:Record<string,string>,png:Buffer}}
 */
export function renderScene({
  width = 32,
  height = width,
  background = '',
  palette = {},
  ops = [],
  scale = 8,
} = {}) {
  const wRaw = toInt(width, 32)
  const hRaw = toInt(height, wRaw)
  const w = clamp(wRaw > 0 ? wRaw : 32, 1, 1024)
  const h = clamp(hRaw > 0 ? hRaw : w, 1, 1024)
  const cells = Array.from({ length: h }, () => new Array(w).fill(null))

  const named = {}
  if (palette && typeof palette === 'object' && !Array.isArray(palette)) {
    for (const [ch, value] of Object.entries(palette)) {
      if (typeof ch !== 'string' || ch.length !== 1) continue
      named[ch] = toHex(value, 'palette')
    }
  }

  if (background) fillRect(cells, 0, 0, w, h, toHex(background, 'background'))

  const list = Array.isArray(ops) ? ops : []
  if (!list.length) throw new Error('ops 不能为空：至少给一个形状，比如 {shape:"fill", color:"#8ec9ff"}')
  for (let i = 0; i < list.length; i++) applyOp(cells, w, h, list[i], i, named)

  const extras = {}
  const grid = cells.map((row) => row.map((hex) => {
    if (!hex) return ' '
    const ch = charForHex(hex)
    if (!CHAR_OF[hex]) extras[ch] = hex
    return ch
  }).join(''))

  const result = renderPixelArt({ grid, palette: extras, scale })
  return {
    width: result.width,
    height: result.height,
    scale: result.scale,
    outWidth: result.outWidth,
    outHeight: result.outHeight,
    grid,
    palette: extras,
    png: result.png,
  }
}
