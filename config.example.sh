# 复制成你自己的环境变量文件再 source，例如：source config.local.sh
# 这些变量都有默认值，只设你需要的。

# --- 选题来源 ---
export WX_TOPIC_REPO="your-github-user/wx-video"   # 带 topic 标签的 issue 仓库

# --- 渲染 ---
export WX_SSH_HOST="render-box"                    # 渲染机的 ssh alias；留空 = 本机渲染
export WX_REMOTE_DIR="wx-daily"                    # 渲染机上的工作目录（默认 ~/wx-daily）

# --- 旁白 ---
export WX_TTS_URL="http://127.0.0.1:7861"          # IndexTTS2 服务地址
# export WX_SSH_HOST=...                            # 设了就由 tts.py 负责启停 index-tts.service

# --- 底图 ---
export WX_IMAGE_CMD="python3 reference/gen-frame.py"   # 接任何文生图 CLI，参数见 tools/plates.sh
export WX_ESRGAN_DIR="$HOME/tools/realesrgan"          # 可选：放 realesrgan-ncnn-vulkan 的目录

# --- 听写复核（可选）---
# 一个能输出词级时间戳的 Whisper 包装命令
# export WX_WHISPER_CMD="python3 tools/remote_whisper.py"
