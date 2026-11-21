/**
 * 像素画渲染核心：字符网格 + 调色板 → PNG Buffer。
 *
 * 不 import 任何 @deepseek-ai/*，也不依赖 sharp —— PNG 用 node:zlib 手写编码，
 * 好处是插件零依赖，装到任何 profile 都能跑。
 *
 * 输入形状：
 *   grid: [".....", "..#..", ...]      // 每行一串字符，所有行等长
 *   palette: { "#": "#5fa73a", ... }   // 字符 -> #RRGGBB / #RRGGBBAA
 *   scale: 8                            // 每个像素放大几倍（最近邻）
 */

import zlib from 'node:zlib'

// ---- PNG 编码（手写，无依赖）----
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

export function encodePNG(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type RGBA
  ihdr[10] = 0  // compression
  ihdr[11] = 0  // filter
  ihdr[12] = 0  // interlace
  const stride = width * 4 + 1
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0 // filter: none
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4)
  }
  // 大图降一级压缩，1024 格时别让一次渲染卡太久
  const idat = zlib.deflateSync(raw, { level: raw.length > 2 * 1024 * 1024 ? 6 : 9 })
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---- 颜色解析 ----
export function parseColor(input) {
  if (!input) return null
  const s = String(input).trim()
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
      255,
    ]
  }
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/i.exec(s)
  if (full) {
    return [
      parseInt(full[1], 16),
      parseInt(full[2], 16),
      parseInt(full[3], 16),
      full[4] ? parseInt(full[4], 16) : 255,
    ]
  }
  return null
}

/** 默认调色板：Minecraft 风格的常见颜色 */
export const DEFAULT_PALETTE = {
  '.': '#8ec9ff', // 天空
  '-': '#d6ecff', // 天空浅
  ',': '#ffffff', // 云/白
  '#': '#5fa73a', // 草皮
  '%': '#4a8a2e', // 草深
  '=': '#8b5a2b', // 泥土
  _: '#6f4722',   // 泥土深
  '+': '#6b4423', // 木/棕
  o: '#3f8f2e',   // 叶
  O: '#4fa03a',   // 叶亮
  R: '#a83c2c',   // 红/屋顶
  r: '#8a2f22',   // 红暗
  B: '#2a2a2a',   // 黑
  W: '#ffffff',   // 白
  S: '#e8b48a',   // 肤
  H: '#4a3524',   // 头发/深棕
  T: '#3b7fd4',   // 蓝衣
  P: '#5a4a3a',   // 裤
  G: '#9aa0a6',   // 石头
  Y: '#ffe066',   // 黄
  k: '#c89b6a',   // 木板
  K: '#b0845a',   // 木板暗
  v: '#8fd0ff',   // 玻璃/水
  n: '#f7c6a3',   // 浅肤
  m: '#d8a3c0',   // 粉
  Q: '#e2504a',   // 亮红
  L: '#5ac1d8',   // 青
  U: '#8f6b3d',   // 深木
  Z: '#272727',   // 近黑
}

/**
 * 把字符网格渲染成 PNG。
 * @returns {{width:number, height:number, scale:number, png:Buffer}}
 */
export function renderPixelArt({
  grid,
  palette = {},
  scale = 8,
  background = '',
  transparent = ' ',
  autoSize = 1024,
}) {
  if (!Array.isArray(grid) || grid.length === 0) throw new Error('grid 必须是非空字符串数组')
  const rows = grid.map((r) => String(r))
  const width = rows[0].length
  if (rows.some((r) => r.length !== width)) {
    const bad = rows.findIndex((r) => r.length !== width)
    throw new Error(`第 ${bad + 1} 行长度 ${rows[bad].length}，与第 1 行 ${width} 不一致（所有行必须等长）`)
  }
  const height = rows.length
  if (width > 1024 || height > 1024) throw new Error('单边最大 1024 格')

  const map = { ...DEFAULT_PALETTE, ...palette }
  const bg = parseColor(background)

  const raw = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = rows[y][x]
      let color = null
      if (ch !== transparent) color = parseColor(map[ch]) || null
      if (!color) color = bg || [0, 0, 0, 0]
      const i = (y * width + x) * 4
      raw[i] = color[0]
      raw[i + 1] = color[1]
      raw[i + 2] = color[2]
      raw[i + 3] = color[3]
    }
  }

  // 最近邻放大（按整数倍复制，不用插值，像素颗粒保留）
  // 输出像素总量封顶，免得 1024 格再放大 32 倍时把内存撑爆
  const MAX_OUT_PIXELS = 8 * 1024 * 1024
  const wanted = Math.max(1, Math.min(32, Math.floor(Number(scale) || 8)))
  const maxFactor = Math.max(1, Math.min(32, Math.floor(Math.sqrt(MAX_OUT_PIXELS / (width * height)))))
  const factor = Math.min(wanted, maxFactor)
  const outW = width * factor
  const outH = height * factor
  const scaled = Buffer.alloc(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    const sy = (y / factor) | 0
    for (let x = 0; x < outW; x++) {
      const sx = (x / factor) | 0
      const si = (sy * width + sx) * 4
      const di = (y * outW + x) * 4
      scaled[di] = raw[si]
      scaled[di + 1] = raw[si + 1]
      scaled[di + 2] = raw[si + 2]
      scaled[di + 3] = raw[si + 3]
    }
  }

  void autoSize
  return { width, height, scale: factor, outWidth: outW, outHeight: outH, png: encodePNG(outW, outH, scaled) }
}
