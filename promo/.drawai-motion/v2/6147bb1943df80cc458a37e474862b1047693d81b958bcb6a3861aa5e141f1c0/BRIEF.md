# 视频工程

规格：1080×1920 / 30fps / 576 帧（19.20 秒）

## 分镜

- shot-1：第 0–89 帧，文件 scene-0.tsx
- shot-2：第 90–173 帧，文件 scene-1.tsx
- shot-3：第 174–293 帧，文件 scene-2.tsx
- shot-4：第 294–401 帧，文件 scene-3.tsx
- shot-5：第 402–491 帧，文件 scene-4.tsx
- shot-6：第 492–575 帧，文件 scene-5.tsx

## 分镜表

- shot-1：钩子：这里没有词典；画面 深蓝底，大字标题，lime 高亮，鲸尾升起；文案 这里没有词典，只有一条会查词的鱼。
- shot-2：痛点：词典是别人写好的；画面 米色纸面，三张卡片被红线划掉；文案 词典是别人写好的。可你的问题，它从来没写过。
- shot-3：现场生成词条；画面 纸质背景，打字 serendipity，音标释义落下，骨架条生长；文案 释义 · 音标 · 例句 · 同根词，一次写完。
- shot-4：真实词页滚动；画面 手机框内词条页滚动，三个标签依次亮起；文案 每一条都是现写的，不是抄的。
- shot-5：延伸功能；画面 三张截图卡错落进入：五种语气 / 四套主题 / 离线缓存；文案 而且不止查词。
- shot-6：收尾与署名；画面 深蓝底 logo、标语、网址，片尾署名 MADE WITH · dsh-drawai；文案 不是词典，是会写词条的 AI。

## 音频

（无音频）

## 约定

- 内置素材可用 motion_assets list 查看：builtin/paper.svg、builtin/grain.svg、builtin/grid.svg 可用 staticFile 引用；builtin/whoosh.wav、builtin/impact.wav 可通过 motion_audio add 加入时间轴。素材是 DrawAI 程序生成的通用素材，不是上游原片素材。
- 工程内置 Noto Sans SC、Noto Serif SC 及常用上游字体，场景可按字体名使用；个别字体与上游特定字重可能仍需补充。
- 需要纹理或乐器单音时，先看用户素材和 motion_assets {action:"list",nodeId}，再用 {action:"library",nodeId,query:"纸张"} 或 query:"钢琴" 搜索插件库；{action:"use",nodeId,assetId:id} 导入所选条目。图片用返回的 file 调 staticFile，声音须另用 motion_audio {action:"add",nodeId,file,role:"sfx",at:秒} 放入时间轴；先查看来源和许可，试听确认电平。单音不是完整配乐。
- 插件素材随安装包提供，素材 ID 不是工作区路径。不要猜路径、从其他工程拷贝素材或手写 manifest.json；使用 library 返回的 ID 调 use，失败时报告具体错误。
- 一场景一文件，单文件不超过 120 行；共享元素放 components/。
- 场景组件 default export，签名 ({ shot, anchors, assets, render }) => ReactNode；时间用 useCurrentFrame()，相对本段起点。
- scene-kit/ 是场景层脚手架：det.ts（确定性随机 + Halton 抖动，禁 Math.random）、grow.ts（弹簧/落体/生长曲线闭式解）、look.tsx（SSAA/软阴影/色调映射/颗粒/暗角）。要画质就先看这三件，别在场景里另写一套。
- 累积采样数与快门时长从 render.samples / render.shutter 读，不要写死数字。
- 改完先渲染 3 帧看图（motion_preview），确认后再跑全片（motion_render）。
- 配色主题：custom（颜色/字体从 theme.ts 取，别手写十六进制）。

- 时间轴改动只改 timeline.json 的 startFrame / durationFrames，不要改场景文件里的绝对帧号。

## 描述

竖屏 9:16 英语查词应用 talk. 的现代宣传片：强调 0 预置词条、每个词条由 AI（大肥鱼/DeepSeek）现场生成；风格贴合站点 paper/ink/lime/navy，硬边卡片、克制排版、确定性动画；片尾署名 MADE WITH · dsh-drawai。

