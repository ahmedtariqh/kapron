---
name: ffmpeg-skill
description: "FFmpeg multimedia conversion, audio/video transcoding, extraction, stream manipulation, and format optimization recipes."
---

# FFmpeg Multimedia Processing

This skill provides expert instructions and verified recipes for processing audio and video using FFmpeg.

## Core Principles & Conventions

1. **Ordering Matters**: In FFmpeg, input options must precede `-i input.ext`, and output options follow the input.
2. **Stream Specifiers**:
   - `0:v:0`: First video stream of first input.
   - `0:a:0`: First audio stream of first input.
3. **Avoid Re-encoding When Possible**:
   - Use `-c copy` (stream copy) when muxing/demuxing or trimming on keyframes to execute instantaneously without quality loss.
4. **Fast Seeking**:
   - Put `-ss <start>` before `-i` for fast input seeking: `ffmpeg -ss 00:01:00 -to 00:02:30 -i in.mp4 -c copy out.mp4`.

## Common Recipes

### 1. Video Transcoding (H.264 / AAC MP4)
Standard high-compatibility web delivery:
```bash
ffmpeg -i input.mov -c:v libx264 -crf 23 -preset medium -c:a aac -b:a 128k -movflags +faststart output.mp4
```

### 2. Fast Audio Extraction
Extract clean audio without re-encoding:
```bash
ffmpeg -i video.mp4 -vn -c:a copy audio.aac
```
Or convert to MP3:
```bash
ffmpeg -i video.mp4 -vn -c:a libmp3lame -q:a 2 output.mp3
```

### 3. Video Trimming / Cutting
Lossless cutting:
```bash
ffmpeg -ss 00:00:30 -to 00:01:45 -i input.mp4 -c copy trimmed.mp4
```

### 4. Create High-Quality GIF
Generate custom palette first to avoid banding:
```bash
ffmpeg -i input.mp4 -vf "fps=15,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" output.gif
```

### 5. Strip Audio / Mute Video
```bash
ffmpeg -i input.mp4 -an -c:v copy muted.mp4
```

### 6. Subtitles & Audio Tracks
Hardcode (burn) subtitles:
```bash
ffmpeg -i input.mp4 -vf "subtitles=subs.srt" -c:a copy output.mp4
```
Extract subtitle stream:
```bash
ffmpeg -i input.mkv -map 0:s:0 subs.srt
```
