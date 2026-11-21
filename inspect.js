/**
 * 画布自检：把 ops 渲染成带坐标的字符网格，并给出可判定的结构诊断。
 *
 * 分工原则（很重要）：
 *   模型负责「读出哪里不对」，代码负责「什么是事实」。
 *   这里只输出事实（坐标、间距、对称度、覆盖率）和违规项，
 *   不替模型改坐标——改哪一笔由模型决定。
 */

import { renderScene, spriteCatalog } from './scene.js'
import { spriteRows } from './sprites.js'

function toInt(value, fallback) {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) ? n : fallback
}

function pushBox(out, x0, y0, x1, y1) {
  out.push({
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0) + 1,
    h: Math.abs(y1 - y0) + 1,
  })
}

function pointsBox(points) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of points) {
    const [x, y] = Array.isArray(p) ? p : [p.x, p.y]
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return [x0, y0, x1, y1]
}

/** 计算一个 op 的包围盒（不追求像素级精确，够诊断用） */
function opBox(op, width, height) {
  const shape = String(op.shape || '').toLowerCase()
  const box = []
  if (shape === 'fill') {
    pushBox(box, 0, 0, width - 1, height - 1)
  } else if (shape === 'rect') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    pushBox(box, x, y, x + toInt(op.w, 1) - 1, y + toInt(op.h, 1) - 1)
  } else if (shape === 'circle') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    const r = Math.max(0, toInt(op.r, 1))
    pushBox(box, x - r, y - r, x + r, y + r)
  } else if (shape === 'ellipse') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    const rx = Math.max(1, toInt(op.rx, 1))
    const ry = Math.max(1, toInt(op.ry, 1))
    pushBox(box, x - rx, y - ry, x + rx, y + ry)
  } else if (shape === 'line') {
    const half = Math.floor(toInt(op.width, 1) / 2)
    const x1 = toInt(op.x1, 0)
    const y1 = toInt(op.y1, 0)
    const x2 = toInt(op.x2, 0)
    const y2 = toInt(op.y2, 0)
    pushBox(box, Math.min(x1, x2) - half, Math.min(y1, y2) - half, Math.max(x1, x2) + half, Math.max(y1, y2) + half)
  } else if (shape === 'polygon' || shape === 'curve' || shape === 'stroke') {
    if (Array.isArray(op.points) && op.points.length) {
      const [x0, y0, x1, y1] = pointsBox(op.points)
      pushBox(box, x0, y0, x1, y1)
    }
  } else if (shape === 'dither') {
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    pushBox(box, x, y, x + toInt(op.w, width) - 1, y + toInt(op.h, height) - 1)
  } else if (shape === 'grid') {
    const rows = Array.isArray(op.rows) ? op.rows.map(String) : []
    const x = toInt(op.x, 0)
    const y = toInt(op.y, 0)
    const w = rows.reduce((m, r) => Math.max(m, r.length), 0)
    if (rows.length && w) pushBox(box, x, y, x + w - 1, y + rows.length - 1)
  } else if (shape === 'sprite') {
    const sprite = spriteRows(String(op.name || '').toLowerCase())
    if (sprite) {
      const scale = Math.max(1, toInt(op.scale, 1))
      const x = toInt(op.x, 0)
      const y = toInt(op.y, 0)
      pushBox(box, x, y, x + sprite.width * scale - 1, y + sprite.height * scale - 1)
    }
  } else if (shape === 'mirror') {
    const axis = Number.isFinite(Number(op.axis)) ? Number(op.axis) : (width - 1) / 2
    const nested = Array.isArray(op.ops) ? op.ops : []
    for (const child of nested) {
      for (const b of opBox(child, width, height)) {
        box.push(b)
        const mx = Math.round(2 * axis - (b.x + b.w - 1))
        box.push({ x: mx, y: b.y, w: b.w, h: b.h })
      }
    }
  }
  return box
}

function collectLandmarks(ops, width, height) {
  const out = []
  const walk = (list, mirrorAxis) => {
    for (const op of list) {
      if (!op || typeof op !== 'object') continue
      if (op.label) {
        for (const b of opBox(op, width, height)) {
          const box = mirrorAxis === null ? b : { ...b }
          out.push({
            label: String(op.label),
            shape: String(op.shape || ''),
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            cx: box.x + (box.w - 1) / 2,
            cy: box.y + (box.h - 1) / 2,
          })
        }
      }
      if (String(op.shape || '').toLowerCase() === 'mirror' && Array.isArray(op.ops)) {
        walk(op.ops, Number.isFinite(Number(op.axis)) ? Number(op.axis) : width / 2)
      }
    }
  }
  walk(ops, null)
  return out
}

/** 左右对称度：非透明格子里，镜像位置同字符的比例 */
function symmetryScore(grid) {
  let ink = 0
  let hit = 0
  const w = grid[0].length
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < w; x++) {
      const ch = grid[y][x]
      if (ch === ' ') continue
      ink++
      if (grid[y][w - 1 - x] === ch) hit++
    }
  }
  return ink ? hit / ink : 1
}

function textGrid(grid, maxRows) {
  const h = grid.length
  const w = grid[0].length
  const step = Math.max(1, Math.ceil(h / Math.max(8, maxRows)))
  const picked = []
  for (let y = 0; y < h; y += step) picked.push([y, grid[y]])
  let ruler = '    '
  for (let x = 0; x < w; x += step) ruler += x % 10 === 0 ? String(Math.floor(x / 10) % 10) : ' '
  const lines = [ruler]
  for (const [y, row] of picked) {
    let line = String(y).padStart(3, ' ') + ' '
    for (let x = 0; x < w; x += step) line += row[x]
    lines.push(line)
  }
  return { text: lines.join('\n'), step }
}

function checkLandmarks(landmarks) {
  const issues = []
  const eyes = landmarks.filter((l) => /eye|眼/i.test(l.label)).sort((a, b) => a.cx - b.cx)
  const mouth = landmarks.filter((l) => /mouth|嘴/i.test(l.label))[0]
  const nose = landmarks.filter((l) => /nose|鼻/i.test(l.label))[0]

  if (eyes.length === 1) {
    issues.push({ level: 'warn', message: '只标了一只眼（label 里含 eye/眼），没法检查双眼水平' })
  }
  if (eyes.length >= 2) {
    const a = eyes[0]
    const b = eyes[eyes.length - 1]
    const dy = Math.abs(a.cy - b.cy)
    if (dy > 1) issues.push({ level: 'error', message: `双眼中心 y 差 ${dy.toFixed(1)}px（要求 ≤1）` })
    const gap = b.x - (a.x + a.w - 1)
    const avgW = (a.w + b.w) / 2
    if (gap < avgW * 0.2) issues.push({ level: 'warn', message: `双眼间距 ${gap}px 偏窄（眼宽约 ${avgW}px）` })
    if (mouth) {
      const eyeMid = (a.cy + b.cy) / 2
      if (mouth.cy <= eyeMid + 1) issues.push({ level: 'error', message: `嘴的 y（${mouth.cy}）不在双眼下方（眼中心 ${eyeMid}）` })
    }
    if (nose) {
      const minX = Math.min(a.cx, b.cx)
      const maxX = Math.max(a.cx, b.cx)
      if (nose.cx < minX || nose.cx > maxX) issues.push({ level: 'warn', message: `鼻点 x（${nose.cx}）不在两眼中点之间` })
      if (mouth && nose.cy > mouth.cy) issues.push({ level: 'error', message: '鼻点在嘴下方' })
    }
  }
  return issues
}

export function inspectArt({
  width = 32,
  height = width,
  ops = null,
  grid = null,
  palette = {},
  background = '',
  maxRows = 64,
  checkSymmetry = true,
} = {}) {
  let rows = null
  let usedPalette = palette
  if (Array.isArray(ops) && ops.length) {
    const rendered = renderScene({ width, height, ops, palette, background, scale: 1 })
    rows = rendered.grid
    usedPalette = rendered.palette
  } else if (Array.isArray(grid) && grid.length) {
    rows = grid.map(String)
  } else {
    throw new Error('要么给 ops 数组，要么给 grid 字符网格')
  }

  const w = rows[0].length
  const h = rows.length
  let ink = 0
  const colors = new Set()
  for (const row of rows) {
    for (const ch of row) {
      if (ch === ' ') continue
      ink++
      colors.add(ch)
    }
  }
  const landmarks = ops ? collectLandmarks(ops, w, h) : []
  const issues = checkLandmarks(landmarks)
  const symmetry = checkSymmetry ? symmetryScore(rows) : null
  if (checkSymmetry && symmetry !== null && symmetry < 0.9 && landmarks.length === 0) {
    issues.push({ level: 'warn', message: `左右对称度偏低（${symmetry.toFixed(2)}），如果是故意不对称可以忽略` })
  }

  const view = textGrid(rows, maxRows)
  return {
    width: w,
    height: h,
    step: view.step,
    coverage: ink / (w * h),
    colors: [...colors],
    symmetry,
    landmarks,
    issues,
    ok: issues.every((i) => i.level !== 'error'),
    gridText: view.text,
    palette: usedPalette,
  }
}

export function formatReport(report) {
  const lines = []
  lines.push(`[inspect] ${report.width}×${report.height} · 覆盖率 ${(report.coverage * 100).toFixed(1)}% · 用色 ${report.colors.length}` +
    (report.symmetry === null ? '' : ` · 对称度 ${report.symmetry.toFixed(2)}`))
  if (report.landmarks.length) {
    lines.push('标注：' + report.landmarks.map((l) => `${l.label}(${l.x},${l.y},${l.w}×${l.h})`).join(' · '))
  } else {
    lines.push('标注：无（op 里加 label 才有结构检查）')
  }
  if (report.issues.length) {
    lines.push('问题：')
    for (const issue of report.issues) lines.push(`- [${issue.level}] ${issue.message}`)
  } else {
    lines.push('问题：无')
  }
  lines.push(`网格（步长 ${report.step}，y 轴在左，x 轴在上）：`)
  lines.push(report.gridText)
  return lines.join('\n')
}
