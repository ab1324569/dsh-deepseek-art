/**
 * 生成经验库：每画完一张，把「下次能直接用」的结论记在这里。
 *
 * 这不是文档摆设——它会被 pixel_lessons 工具读出来，生成前先查，
 * 这样上一张踩过的坑，下一张就不用再踩。
 *
 * 字段：
 *   id     唯一标识
 *   topics 关键词（中英都行），用来检索
 *   title  一句话结论
 *   tip    具体做法（坐标/层级/颜色这类能照做的）
 */

export const LESSONS = [
  {
    id: 'apple-shape',
    topics: ['apple', '苹果', 'fruit', '水果'],
    title: '苹果不是圆',
    tip: '两个错开的圆做左右脸（间距约 2/3 半径），底部再补一个窄椭圆，剪影才有上宽下收和顶部凹口；单个圆一定像球。',
  },
  {
    id: 'apple-shape-recipe',
    topics: ['apple', '苹果', 'recipe', '配方'],
    title: '苹果剪影配方（256 画布）',
    tip: '两个 r=62 的圆放在 (104,148)、(152,148)，底部补 ellipse(128,176,rx62,ry42)；暗面三件套整体 +5,+6；顶部凹口 ellipse(128,92,rx16,ry8) 用深色，别用背景色。',
  },
  {
    id: 'apple-bite-recipe',
    topics: ['apple', '苹果', 'bite', '咬'],
    title: '咬痕配方',
    tip: '先在咬的位置铺果肉色 ellipse(rx26,ry34)，再铺一层深一点的果肉，最后用背景色圆 (214,118,r19)/(219,148,r21)/(212,178,r19) 掏扇贝；顺序反了会露出背景。',
  },
  {
    id: 'apple-dip',
    topics: ['apple', '苹果', 'stem', '梗'],
    title: '凹口和梗',
    tip: '顶部凹口用暗红椭圆压在果身上（不要用背景色掏洞，会变白环）；梗从凹口中心长出来，往一侧弯一点更自然。',
  },
  {
    id: 'apple-highlight',
    topics: ['apple', '苹果', 'highlight', '高光'],
    title: '高光要两层',
    tip: '先铺一层偏亮的同色系椭圆，再叠一个更小、更接近白的；位置在左上 1/3，不要正中。',
  },
  {
    id: 'cat-face',
    topics: ['cat', '猫', 'face', '头'],
    title: '猫头靠对称',
    tip: '耳朵三角、眼睛高光、胡须左右各三条；用 mirror 只画半边，另半边自动翻，比手摆两边稳。',
  },
  {
    id: 'cake-cream',
    topics: ['cake', '蛋糕', 'cream', '奶油'],
    title: '奶油用递减圆堆',
    tip: '从下往上每层半径减 20%，每层先画暗面圆（错 8-12px）再盖亮面圆，缝隙自然成明暗。',
  },
  {
    id: 'portrait-limit',
    topics: ['portrait', '人像', 'face', '脸'],
    title: '人像别用形状硬拼',
    tip: '64-160 格能做出「可辨认的 Q 版」，但发丝和光影做不到；先用 inspect_pixel_art 查结构（眼 y 差、嘴在眼下），别追求写实。',
  },
  {
    id: 'mirror-axis',
    topics: ['mirror', '对称', 'symmetry'],
    title: '镜像轴别用 width/2',
    tip: '像素中心是 (width-1)/2；用 width/2 会整体偏移 1px，对称度永远到不了 1。',
  },
  {
    id: 'inspect-labels',
    topics: ['inspect', '自检', 'label'],
    title: '自检要先打标签',
    tip: '把关键部件写成 op.label（left_eye / right_eye / mouth / nose / body），inspect_pixel_art 才能做结构判断；label 打错等于没查。',
  },
  {
    id: 'background',
    topics: ['background', '背景', 'bokeh'],
    title: '背景别抢主体',
    tip: '底色和光斑只做 5% 以内的明度差，主体用更高的饱和度和明暗对比；否则第一眼会落在背景上。',
  },
]

/** 按关键词检索；query 为空则返回全部 */
export function findLessons(query, limit = 6) {
  const q = String(query || '').trim().toLowerCase()
  const all = LESSONS
  if (!q) return all.slice(0, limit)
  const terms = q.split(/[\s,，、]+/).filter(Boolean)
  const scored = all.map((lesson) => {
    const hay = (lesson.topics.join(' ') + ' ' + lesson.title + ' ' + lesson.tip).toLowerCase()
    let score = 0
    for (const term of terms) {
      if (lesson.topics.some((t) => t.toLowerCase() === term)) score += 3
      else if (hay.includes(term)) score += 1
    }
    return { lesson, score }
  })
  const hit = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).map((s) => s.lesson)
  return (hit.length ? hit : all).slice(0, limit)
}
