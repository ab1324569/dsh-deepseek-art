/**
 * 内置像素小精灵：给「没生图能力的模型」当积木用。
 *
 * 每行一个字符串，字符取自 render.js 的 DEFAULT_PALETTE：
 *   B 近黑 / W 白 / n 浅肤 / S 肤 / H 深棕 / R 红 / r 暗红 / Q 亮红
 *   o O 绿叶 / Y 黄 / k K 木板 / = _ 泥土 / m 粉 / T 蓝 / L 青 / G 石头
 * '.' 和空格表示透明。
 *
 * 行尾不用补齐，载入时按最长行右补透明；前导空格有意义，别删。
 * cathead 是模板（64×64），来自 templates.js。
 */

import { CATHEAD } from './templates.js'

export const SPRITES = {
  cathead: { rows: CATHEAD },
  heart: {
    rows: [
      '..QQQ..QQQ..',
      '.QQQQQQQQQQ.',
      'QQQQQQQQQQQQ',
      'QQQQQQQQQQQQ',
      '.QQQQQQQQQQ.',
      '..QQQQQQQQ..',
      '...QQQQQQ...',
      '....QQQQ....',
      '.....QQ.....',
    ],
  },
  star: {
    rows: [
      '.....Y.....',
      '....YYY....',
      '....YYY....',
      'YYYYYYYYYYY',
      '.YYYYYYYYY.',
      '..YYYYYYY..',
      '..YYYYYYY..',
      '.YYYY.YYYY.',
      '.YY.....YY.',
      'YY.......YY',
    ],
  },
  cloud: {
    rows: [
      '....WWWW......',
      '..WWWWWWWW....',
      '.WWWWWWWWWWW..',
      'WWWWWWWWWWWWWW',
      'WWWWWWWWWWWWWW',
      '.WWWWWWWWWWWW.',
      '..WWWWWWWWWW..',
    ],
  },
  sun: {
    rows: [
      '.....Y.....',
      '..Y..Y..Y..',
      '...YYYYY...',
      '..YYYYYYY..',
      '.YYYYYYYYY.',
      'YYYYYYYYYYY',
      '.YYYYYYYYY.',
      '..YYYYYYY..',
      '...YYYYY...',
      '..Y..Y..Y..',
      '.....Y.....',
    ],
  },
  tree: {
    rows: [
      '....oooo....',
      '..oooooOO...',
      '.oooOOOOOoo.',
      '.ooOOOOOOOo.',
      'oooOOOOOOOOo',
      'ooOOOOOOOOOo',
      '.oOOOOOOOOo.',
      '..ooOOOOoo..',
      '....===.....',
      '....===.....',
      '....===.....',
      '....===.....',
      '...=====....',
    ],
  },
  house: {
    rows: [
      '.......RR.......',
      '......RRRR......',
      '.....RRRRRR.....',
      '....RRRRRRRR....',
      '...RRRRRRRRRR...',
      '..RRRRRRRRRRRR..',
      '.RRRRRRRRRRRRRR.',
      'RRRRRRRRRRRRRRRR',
      'WWWWWWWWWWWWWWWW',
      'WWYYWWW++WWWYYWW',
      'WWYYWWW++WWWYYWW',
      'WWWWWWW++WWWWWWW',
      'WWWWWWW++WWWWWWW',
      'WWWWWWWWWWWWWWWW',
    ],
  },
  flower: {
    rows: [
      '..mYYYm..',
      '.mYYYYYm.',
      '..mYYYm..',
      '...mYm...',
      '....o....',
      '....o....',
      '...Oo....',
      '....o....',
      '....o....',
    ],
  },
  cat: {
    rows: [
      '................',
      '...B........B...',
      '..BWB......BWB..',
      '..BWBBBBBBBBWB..',
      '..BWWWWWWWWWWB..',
      '..BWBBWWWWBBWB..',
      '..BWWWWWWWWWWB..',
      '..BWWWWmmWWWWB..',
      '..BWWWWWWWWWWB..',
      '...BWWWWWWWWB...',
      '...BWWWWWWWWB...',
      '..BWWWWWWWWWWB..',
      '.BWWWWWWWWWWWWB.',
      '.BWWW.WWWW.WWWB.',
      '.BBBB.BBBB.BBBB.',
      '................',
    ],
  },
  cake: {
    rows: [
      '.....Y.......',
      '.....Y.......',
      '..WWWWWWWWW..',
      '..WmmmmmmmW..',
      '..WWWWWWWWW..',
      '.WWWWWWWWWWW.',
      '.WnnnnnnnnnW.',
      '.WWWWWWWWWWW.',
      'WWWWWWWWWWWWW',
      'WWWWWWWWWWWWW',
    ],
  },
  mushroom: {
    rows: [
      '..QQQQQ..',
      '.QQQWQQQ.',
      'QQQWWWQQQ',
      'QQQQWQQQQ',
      '.QQQQQQQ.',
      '..WWWWW..',
      '...WWW...',
      '...WWW...',
      '...WWW...',
    ],
  },
  slime: {
    rows: [
      '....ooooo....',
      '..ooOOOOOoo..',
      '.oOOOOOOOOOo.',
      'oOOOOOOOOOOOo',
      'oOOBBOOOBBOOo',
      'oOOBBOOOBBOOo',
      'oOOOOOOOOOOOo',
      'oOOOOOOOOOOOo',
      '.OOOOOOOOOOO.',
    ],
  },
}

/** 统一补齐成方形行宽，返回 { rows, width, height } */
export function spriteRows(name) {
  const sprite = SPRITES[name]
  if (!sprite) return null
  const rows = sprite.rows
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const height = rows.length
  return {
    rows: rows.map((row) => row.padEnd(width, '.')),
    width,
    height,
  }
}
