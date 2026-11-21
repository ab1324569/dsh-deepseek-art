# dsh-pixel-art

在 DeepSeek Harness 里画像素画：左侧栏一整页的本地画板 + 两条给模型用的工具。

**没有生图能力的模型也能画**（比如只能出文本的 DeepSeek）：

- `draw_pixel_scene`：用「形状 + 内置精灵」拼场景，`fill / rect / line / curve / stroke / mirror / circle / ellipse / polygon / dither / grid / sprite` 叠一叠就成图，不用逐格写上千字符；`curve` 是贝塞尔曲线，`mirror` 只画半边自动镜像，`dither` 的 25/50/75 点阵用来做明暗过渡。
- `draw_pixel_art`：要精确到每个像素时，直接给字符网格。
- `inspect_pixel_art`：把画布反序列化成**带坐标的字符网格**并做结构诊断（双眼是否同高、嘴是否在眼下方、鼻点位置、对称度、覆盖率）。op 可以带 `label`；工具只给事实，不替你改坐标——改哪一笔由模型决定。
- `pixel_lessons`：插件里积累的**生成经验库**，按主题检索（苹果/猫/蛋糕/人像/对称/自检）。每画完一张，把能复用的结论追加进去，下次生成前先查。

两条画图工具都会把正方形画布同步进画板画廊（PNG + 网格 JSON），面板里点一下就能接着改。

> 0.8.0：`pixel_lessons` 经验库（画完就记）；0.7.0：`inspect_pixel_art` 自检（文本网格 + 结构约束）；0.6.0：调色板查表把 1024 网格渲染从 331ms 压到 ~50ms，`curve / stroke / mirror` 三个新 op。

## 画板

- 画布 16 到 1024 格；「适应 / − / +」缩放，大画布在窗口里滚动查看。
- 画笔/橡皮/吸管、粗细 1–3、网格线、撤销重做、右键擦除、快捷键、草稿自动恢复（切走面板不丢画）。
- 1024 格自动降级：撤销步数按面积收（大画布 3 步）、草稿不存、导出倍数按 8M 输出像素封顶。
- 画廊每 8 秒自己刷新：AI 画完自动出现；点缩略图载回原图，可删除。
- 「AI 画」卡片：写一句想画什么，复制指令贴到对话里，模型就会调用上面的工具。
- 网格约定：空格 = 透明，`.` = 天蓝（默认调色板）。

## 内置精灵与模板

- 精灵：cat 16×16、house 16×14、tree 12×13、cloud 14×7、sun 11×11、heart 12×9、star 11×10、flower 9×9、cake 13×10、mushroom 9×9、slime 13×9。
- 模板：`cathead` 64×64 猫头，可以直接 `{shape:'sprite', name:'cathead', scale:3}` 贴到画布上；只用默认调色板字符，不带额外颜色。
- 模板由 [templates.js](templates.js) 提供，设计稿在 `test-cathead64.mjs`，改完重跑导出即可。

## 页面

- `/dsh-pixel-art` 独立画板页
- `/dsh-pixel-art/api/list` 画廊列表
- `/dsh-pixel-art/api/save` 保存（POST）
- `/dsh-pixel-art/api/delete` 删除（POST）

## 快捷键

`B` 画笔 · `E` 橡皮 · `I` 吸管 · `[` `]` 笔刷粗细 · `G` 网格线 · `Ctrl+Z` 撤销 · `Ctrl+Shift+Z` 重做 · `Ctrl+S` 存进画廊 · 右键擦除。
