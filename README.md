# wx-video

视频号每日资讯短片流水线。一条选题进来，出来一条 1080×1920 / 60fps / 约 40 秒的竖屏短片：AI 生成底图、AI 配音、数据类镜头（数字、图表、时间线、对比、引文）、字幕、配乐、封面，最后自动填好视频号的发布表单。

这个仓库同时干两件事：

1. **选题收件箱**：带 `topic` 标签的 issue，正文里嵌一段 JSON，就是一条待做选题。
2. **生产引擎**：`engine/` 下的代码，把选题做成成片。

完整的操作手册在 [`RUNBOOK.md`](RUNBOOK.md)，本文件讲怎么把它跑起来。

---

## 它长什么样

```
GitHub issue（topic 标签 + json 块）
        │  tools/fetch_topics.py
        ▼
runs/<日期>-<issue号>/topic.json          文案定稿，一字不改
        │  人/agent 写 prompts/*.txt + spec.json
        ▼
tools/make.sh
        ├─ plates.sh        文生图 → 无字竖屏底图 →（可选）Real-ESRGAN 放大
        ├─ tts.py           IndexTTS2 逐段配音 → voice/segNN.wav
        ├─ asr_check.py     Whisper 回听，和实际送进 TTS 的文本比对（可选）
        ├─ timeline.mjs     字幕时间轴（按实际音频时长分屏）
        ├─ score.py         人声 + 配乐侧链混音 + 音效 → audio/mix.wav
        ├─ still.mjs        每个镜头取一张静帧 → qa_sheet.jpg（目检用）
        ├─ remote_render.sh 远端或本机渲染 → out/master.mp4 → out/upload.mp4
        ├─ cover.mjs        3:4 / 9:16 封面
        └─ package.py       发布信息 + 记账 runs/ledger.json
        │
        ▼
tools/wx_post.sh          视频号助手网页端自动填表并发表（可选，也可以手动发）
tools/close_topic.sh      评论、关 issue、ledger 标 published
```

渲染层是 headless Chrome + Three.js：每个镜头都是网页里的一层，`window.renderFrame(f)` 逐帧求值，Puppeteer 截图直接送进 ffmpeg。所以改画面只需要改 `engine/web/src/`，不用碰视频编码。

## 目录

```
RUNBOOK.md              操作手册：每日步骤、spec.json 格式、镜头类型、多样性要求
config.example.sh       环境变量模板
engine/
  agent_backends.json   调度用的 AI 后端顺序（agy → codex → claude），可删
  music_config.json     配乐配置（指向你自己的音轨）
  tools/                选题、出图、配音、时间轴、发布、关单
  audio/                混音与合成音效
  web/                  渲染器（Three.js 镜头 + 字体 + 截图脚本）
  scripts/              渲染机侧的并行分片渲染
examples/20261022-76/   一条完整样例：topic.json / spec.json / prompts / research.md / qa_sheet.jpg
runs/                   生产目录，不进 git（只保留 ledger.json）
```

## 需要什么

| 环节 | 依赖 | 必需 |
|---|---|---|
| 选题 | `gh` CLI（已登录）+ 一个带 `topic` 标签的 issue 仓库 | 是 |
| 底图 | 任意文生图 CLI，默认接 `reference/gen-frame.py` | 是 |
| 放大 | `realesrgan-ncnn-vulkan` + models | 否 |
| 配音 | IndexTTS2 HTTP 服务（`/v1/audio/speech`，默认 7861 端口） | 是 |
| 混音/编码 | `ffmpeg`、Python 3 + numpy/scipy/soundfile | 是 |
| 渲染 | Node 18+、Google Chrome、`npm install` 在 `engine/web` | 是 |
| 回听 | 能输出词级时间戳的 Whisper 包装命令 + `opencc-python-reimplemented`（繁简归一） | 否 |
| 发布 | Ego Lite（`ego-browser`）+ 已登录的视频号助手 | 否，可手动发 |

渲染机不是必需的：`WX_SSH_HOST` 留空就在本机渲。有 GPU 会快很多，纯 CPU 也能跑，只是慢。

## 跑起来

```bash
git clone https://github.com/lauzhihao/wx-video.git && cd wx-video

# 1. 环境
python3 -m venv .venv && .venv/bin/pip install numpy scipy soundfile
cd engine/web && npm install && cd ../..

# 2. 配置
cp config.example.sh config.local.sh && $EDITOR config.local.sh
source config.local.sh
export WX_TOPIC_REPO="<你的 GitHub 账号>/wx-video"

# 3. 拉选题
cd engine && ../.venv/bin/python tools/fetch_topics.py

# 4. 照 RUNBOOK 第二节写 runs/<id>/spec.json 和 prompts/*.txt
#    （最省事：把 examples/20261022-76/ 整个复制成一个新 run 再改）

# 5. 出片
tools/make.sh ../runs/<id>
```

跑完看 `runs/<id>/qa_sheet.jpg`（每个镜头一张静帧），有问题改 `spec.json` 重跑；没改的步骤会走缓存。

### 只发预览、不发表

```bash
tools/wx_post.sh ../runs/<id>            # 填好表单，窗口留给你自己点「发表」
tools/wx_post.sh ../runs/<id> --publish  # 直接发表
```

没有 Ego Lite 的话，按 `out/发布信息.txt` 手动上传 `out/upload.mp4` 和封面即可，内容一样。

## 选题 issue 的格式

正文里放一段 ```json 代码块，`fetch_topics.py` 原样取出：

```json
{
  "date": "2026-10-22",
  "angle": "大佬",
  "event": "Anthropic 开启 Claude Duet 研究预览",
  "title": ["AI主动干活", "Claude替你上班"],
  "body": ["第一段旁白", "第二段旁白", "第三段旁白"],
  "intro": "视频简介，原样填进发布表单",
  "tags": ["#AI", "#科技资讯"],
  "source": "出处"
}
```

约束：`title` 两行、每行 ≤10 字；`body` 三行。`date` 决定 run 目录名。

## 关于这个仓库里的东西

- **配乐不在仓库里**。`music_config.json` 指向 `audio/bgm/`，放你自己的音轨；文件不存在时流水线会跳过配乐继续出片。原创作品请注意版权。
- **字体**：`engine/web/fonts/` 里的 Inter、JetBrains Mono、Noto Sans SC 都是 SIL Open Font License 1.1，随字体分发。
- **账号与登录态**：不包含任何 cookie、profile 或 token。`.chrome-profile/` 被 gitignore。
- **样例 run** 里的选题与文案来自 2026-10-22 的一条真实生产记录，只作格式参考。

## License

Apache License 2.0，见 [LICENSE](LICENSE)。
