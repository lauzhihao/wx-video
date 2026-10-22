# 视频号每日出片手册（wx-daily）

每天固定时间，上游往 GitHub 选题仓库（默认 `WX_TOPIC_REPO`）发 3 条选题 issue（open + `topic` 标签）。
每条做成一条 1080×1920 竖屏短片，QA 通过后发布到视频号。
- 发布用 Ego Lite 的 `WX_VIDEOS` profile 在视频号助手网页端发表（见第一节第三步）。视频号没有开放发布接口。
- 发布成功之前，不评论、不关 issue。

所有命令都在 `engine/` 下执行。示例工程：`examples/20261022-76/`（spec.json、prompts/、qa_sheet.jpg）。

环境变量与依赖见 `README.md`；`WX_SSH_HOST` 为空时渲染在本机进行。

## Agent 后端切换（2026-10-20 用户要求）

- 总调度按 `agent_backends.json` 的顺序使用 agy + Gemini、Codex + GPT、Claude Code + DeepSeek。三者接收相同的生产任务；DeepSeek 的同提示词产出质量已由用户人工确认。
- 后端启动失败、额度不足、非零退出或超时时切换下一家；沿用已有产物与账本继续工作。这里只替换执行后端，保留下面原有制作、QA、发布和关单步骤。
- 用户已明确取消本轮新增门禁：不要求质量证书、产物哈希凭证、额外发布开关或 BGM 凭据，不因增加这些机制阻断原工作流。
- 后续作品统一使用用户于 2026-10-20 指定的 Aurelia《We Never Choose》改编版音轨，取代此前《千年之后》的选曲计划和旧合成 BGM。`engine/music_config.json` 配置共享音源 `engine/audio/bgm/aurelia-7691973908303686757/we-never-choose-aurelia.m4a`，不需要手机端另行选曲。
- 保留旁白与原有音效。用户于 2026-10-22 选定 #76 的“BGM 约提高 12 dB”试听版作为后续默认：`music_config.json` 使用 `music-forward-12db` 预设，在原有侧链混音后将 BGM 提高 12 dB，人声与音乐差距约为 6 LU。配置里的 `voice_over_music_lu: 18` 是增强前的参考，不是最终差距；不要再次把增强后的音乐压回 18 LU。超过音源长度时复用共享无缝循环工具。共享音源不属于 run 临时媒体，不随作品清理。

## 一、每日步骤

1. **拉选题**：`.venv/bin/python tools/fetch_topics.py`。它会：
   - 输出待做列表；
   - 为每条建 `runs/<日期>-<issue号>/topic.json`，正文里的 json 块原样保存；
   - 跳过 `runs/ledger.json` 里已做过的。

   列表为空就结束，并告诉 Operator「今天没有新选题」。

2. **逐条制作**（串行，一条做完再做下一条）。
   1. **读 `topic.json`**：date / angle / event / title（2 行）/ body（3 行）/ intro / tags / source。
      - 文案是定稿，一个字都不改。选题获取时已在上游验证过真实性，制作时不进行事实复查。
   2. **找素材（信息增量）**：用 WebSearch/WebFetch 搜这件事，挑 3–6 个能上屏的具体信息：数字、日期、谁说了什么、时间线、对比项。
      - 为分镜数据卡片（number/chart/compare/timeline/points/quote 等）提取上屏信息，出处记进 `research.md`，不作为事实审查门禁。
      - 有合适的报道或推文，可以截一张做 `headline` 镜头：
        `cd web && node shot_url.mjs <url> ../../runs/<id>/media/<名>.png --w=1000 --h=1300`。
        X 帖子可以走 `api.fxtwitter.com` 取原图。截图白底太大、有弹窗或付费墙就不用。
   3. **写底图提示词** `prompts/<名>.txt`：2–4 张，其中一张叫 `hero`，用于开场和封面。风格要求见第三节。
   4. **写分镜** `spec.json`：格式见第二节，多样性要求见第四节。
   5. **出片**：`tools/make.sh ../runs/<id>`。它会依次完成：
      - codex 生成底图，再用 Real-ESRGAN 放大；
      - TTS 服务合成旁白；
      - 生成时间轴，混合指定 BGM、原旁白和音效；
      - 出 QA 静帧；
      - 渲染和编码；
      - 生成封面和发布信息。

      没做改动的步骤会走缓存。一条大约 8 分钟机器时间。
   6. **目检 `runs/<id>/qa_sheet.jpg`**（每个镜头一张静帧），用 Read 看图，查这几项：
      - 字压字；
      - 字出框、超出 y 250–1450 的安全区；
      - 镜头空白；
      - 数字或文字错；
      - 画面吓人。

      有问题就改 spec.json 或提示词，再跑一遍 make.sh。最多返工两轮。
3. **发布**（每条 QA 通过后自动发，逐条串行，两条之间隔 3–5 分钟）：`tools/wx_post.sh ../runs/<id> --publish`。
   - 走 Ego Lite 的 `WX_VIDEOS` profile（已登录视频号助手，网页端发表不用扫码）。登录过期时脚本打印 `NEED LOGIN` 并把窗口交给 Operator 登录，登录后重跑；不要自己登录。
   - 它会上传 `upload.mp4`，原样填简介和标签，短标题用两行标题以空格连接（短标题不许逗号；上限 16 字且符号只许《》“”：+？%°，不合规依次退到去空格、第一行、第二行），封面换成 `cover_1080x1440.png`（3:4），位置设为「不显示位置」，视频标注选「含AI生成内容」，其余默认，然后点「发表」。
   - 不带 `--publish` 只填表，窗口交给 Operator 自己点。
   - 定时发：`tools/wx_post.sh ../runs/<id> --publish --at HH:MM [--date YYYY-MM-DD]`，时间要晚于现在；`--date` 只能选当月（面板约可排 30 天内），不带就是当天。列表里显示「将于…发表」即成功，关单说明里写清上线时间。
   - 每步截图在 `runs/<id>/publish_*.png`；发完看一眼 `publish_list.png` 里新条目在列表顶部。
   - 某条画面或音画两轮没修好就不发，交付时说明，等 Operator 决定。
4. **关单**：发布成功后 `tools/close_topic.sh <issue号> "已于 <日期 时:分> 在视频号「<你的视频号名称>」发布（视频号助手网页端发表）"`。它会评论「done，视频号链接：…」，关闭 issue，并把 ledger 标成 published。
5. **交付**：每条用 SendUserFile 发三样东西：`out/upload.mp4`、`out/cover_1080x1260.png`、`out/发布信息.txt`。全部发完，再用中文写一段总结：
   - 每条的 issue 号、时长、发布时间；
   - 用了哪些素材、镜头和情绪；
   - 有没有技术硬伤、哪条没发及原因。

出错时：
- codex 出图失败、TTS 起不来、渲染失败、成片规格不对，都**立刻停下**，把日志贴给 Operator，不要反复重试。
- 例外：底图失败可以换提示词重试一次。

## 二、spec.json

```json
{
 "id": "<run 目录名>", "date": "<topic.date>", "tag": "<topic.angle>", "theme": "ocean", "seed": 23,
 "title": ["<title[0]>", "<title[1]>"],
 "accent": ["要上色的关键词", "…"],
 "music": {"mood": "bright", "key": "E", "seed": 23},
 "voice": {"enabled": true, "voice": "matrix_female"},
 "segments": [
  {"vo": "<title[0]>，<title[1]>", "shots": [{"type": "hook", "plate": "hero"}]},
  {"vo": "<body[0] 原文>", "shots": [ {…}, {…} ]},
  {"vo": "<body[1] 原文>", "shots": [ {…} ]},
  {"vo": "<body[2] 原文>", "shots": [ {…}, {…} ]},
  {"vo": "", "caption": false, "shots": [{"type": "outro", "lines": ["…", "…"]}], "min": 3.0}
 ],
 "tail": 0.8
}
```

- **旁白（vo）**：开场段 = 两行标题连读（行尾没有标点就补「，」）；正文三段 = body 三行原文；收尾段不配旁白。
  - 字幕自动取 vo，按语速分屏，每屏最多两行。
  - 保持 `voice.enabled: true`；英文缩写等读音不合适时用 `say` 调整读音，保留原文字幕与旁白。
- **收尾 lines**：只用文案里已有的词，重组成一两句收束，不加新观点。
- **每段 1–3 个镜头**，`w` 是这段时间内的相对权重，默认 1。段长由旁白决定，每个镜头至少约 2.2 秒。
- **accent**：2–5 个关键词，字幕和标题里会自动上主题色；「」“”里的字也会上色。

### 镜头类型

| type | 参数 | 用途 |
|---|---|---|
| hook | plate, kb(in/out/left/right/up/down) | 开场：底图 + 两行标题（只放第一段） |
| plate | plate, kb, label | 底图推拉，label 在底部胶囊里 |
| headline | media（相对 run 目录，如 `media/wsj.png`）, hi:[x0,y0,x1,y1]（0–1，y 从上往下量）, label, zoom | 报道或推文截图，飞入后给关键句划标记 |
| number | value, from, prefix, suffix, decimals, label, sub | 一个撑起故事的数字，从 from 数到 value |
| chart | points:[数], labels:[x 轴], style(line/bar), hi（高亮下标）, prefix/suffix/decimals, unit, min/max | 走势或对比 |
| compare | left/right:{title,value,sub}, vs, label | 左右对照（反差题常用） |
| timeline | items:[{date,text}]（≤5） | 事件时间线 |
| points | items:[文字]（2–4） | 要点列表 |
| quote | text, who, role, plate（可选，调暗作背景） | 某人的原话（译文要忠实） |
| globe | points:[{lat,lon,label}], from:[lat,lon]（可选，画弧线） | 地点、跨国 |
| ai | label | 抽象 AI 粒子球（讲模型或行为时用） |
| outro | lines:[…] | 收尾 |

`theme`：ocean（蓝青）/ graphite（石墨配琥珀）/ dawn（暖珊瑚）/ mint（薄荷绿）/ violet（紫）。
`music.mood`、`key`、`seed` 为历史分镜兼容字段；BGM 统一读取 `engine/music_config.json`，不随每条分镜换成合成配乐。

`key` 用 C D E F G A Bb Eb 等。`seed` 每条都换。

## 三、底图提示词

- **固定写法**：「电影级写实画面，竖版 9:16。<具体场景>。<主题色调>，柔和光线，浅景深，细腻胶片颗粒。画面上方三分之一留出干净的深色空间用于加字。画面里不要人物面孔，绝对不要任何文字、字母、数字、logo、水印。」
- **不要惊悚**：禁止红色警报、面具、裂开的脸、血色、阴森机房这类意象（容易被按《视频号运营规范》5.13.1「引起不适或惊吓」举报）。要干净、克制、有质感的科技风。
- **不画真人**：写「剪影」「背影」「远景人群」，或者用物件、场景来隐喻。
- **色调和主题对应**：
  - ocean：蓝青；
  - graphite：石墨灰配琥珀光；
  - dawn：暖橙珊瑚；
  - mint：青绿；
  - violet：紫蓝。
- **每条的场景要不同**：别总是「实验室里的发光屏」，从题目里找具体物件，比如芯片、数据中心外景、城市、工厂、会议桌、交易屏（不带字）、服务器走廊、机械臂……

## 四、多样性（避开「同质化」）

《视频号运营规范》5.12 禁止「批量发布通过近似的情景、文案、元素等编造的同质化内容」；5.14.1 把「大字覆盖、简单拼凑」列为低质。Muse 的文案格式是固定的，所以画面必须每条都不一样。

- 同一天 3 条的 `theme` 两两不同；BGM 按用户要求统一，画面与镜头保持多样。
- 读 `runs/ledger.json` 里最近 6 条的 `shots` 序列，新一条的镜头类型序列不能和其中任何一条完全相同；正文三段至少用上 3 种不同的数据类镜头（number/chart/compare/timeline/points/headline/globe/quote）。
- 开场底图的构图、主体每条都换；开场 `kb` 方向和 `seed` 也换。
- 每条至少 2 个画面带真实信息（数字、日期、原话、截图），不能全靠底图配字幕。

## 五、技术备忘

- 渲染可以放在远端渲染机（`WX_SSH_HOST`，目录 `WX_REMOTE_DIR`）或本机：6 路并行，ss=2，2 个运动模糊子帧。40 秒的片子约 1.5 分钟渲完，编码约 1 分钟；纯 CPU 会慢很多，但能跑。
- TTS：IndexTTS2 服务（`WX_TTS_URL`，默认端口 7861）。设置 `WX_SSH_HOST` 时，tts.py 用前启动、用后停回去；不设置就假设服务常开。音色用 `matrix_female`。
- 读音：字幕照原文，送进 TTS 的文本自动做读音规整。
  - 字母和数字之间的连字符换成空格：「GPT-6.1」读「GPT 6.1」。不规整的话会读成「GPT 负六点一」。
  - 数字之间的连字符读「到」：2025-2026 → 2025到2026。
  - 其他读不对的词，在该段加 `"say": "<想让它读的文本>"`，只影响读音，不影响字幕。
- 听写检查：逐阶段合成旁白后运行 `tools/asr_check.py`，用 Whisper 听写，再和实际送入 TTS 的文本比对；不能只看退出码，必须读取每段 `heard` 与 `ok`。
  - 优先使用 `voice.json:text`，并核对它与当前 `say`/`vo` 经读音规整后的文本一致；缓存不一致时扣留。`copy` 和字幕仍保留原 `vo`，另记 `caption_similarity`。
  - 分段边界按 WAV 实际帧数计算；每个听写词按最大正重叠唯一归属，无重叠时才尝试原有起点窗口。歧义、漏归属或无效时间进入诊断并扣留，不能丢词后宣称通过。
  - 出现 `FLAG`（相似度 < 0.85，或者文案里没有却读出了「负」），就看 `voice/asr_check.json` 里 heard 那一栏，用 `say` 修正后重跑。
  - 交付前所有段都要是 `OK`。
  - TTS 请求、远端 ASR 与远端渲染跨 run 串行运行；进入前已 active 的 TTS 服务保持原状态。常驻模型仍占用显存，不能把无请求当成空 GPU。
- 缓存：底图已存在就跳过；旁白读音文本没变就跳过；改了 spec 只会重做时间轴、配乐和渲染。
- 本地静帧：`cd web && node still.mjs ../../runs/<id>/stills 1.0 5.0 --run=runs/<id>`。
- 上传版码率约 5.5 Mbps，40 秒约 30 MB。发布时标注选「含AI生成内容」，不要声明原创（时事资讯不在原创范围内）。
