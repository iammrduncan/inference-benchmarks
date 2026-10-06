#!/usr/bin/env python3
"""Capture one real request's stdout timing, render at 1x, convert MP4 to GIF.
Requires Pillow and PyAV. Runs ONE paid synthetic Cerebras request via .env.
"""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time
from datetime import datetime, timezone
import math

import av
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '.artifacts/demo-verification'
WIDTH, HEIGHT, FPS = 1100, 650, 50  # 20ms GIF-compatible frame quantization.
FONT_PATH = os.environ.get('DEMO_FONT') or next((p for p in [
    '/System/Library/Fonts/Menlo.ttc',
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
] if Path(p).exists()), None)
if not FONT_PATH:
    raise SystemExit('Set DEMO_FONT to an installed monospace TTF/TTC.')
FONT = ImageFont.truetype(FONT_PATH, 21)
SMALL = ImageFont.truetype(FONT_PATH, 17)
TITLE = ImageFont.truetype(FONT_PATH, 30)
BG, PANEL, TEXT, MUTED, GREEN = '#0b1220', '#131f31', '#e5edf8', '#9baec7', '#79e2b3'
COMMAND = ['node', '--env-file=.env', '--import', 'tsx', 'packages/gateway/examples/record-request.ts']


def draw_frame(lines):
    image = Image.new('RGB', (WIDTH, HEIGHT), BG)
    d = ImageDraw.Draw(image)
    d.text((36, 24), 'typesafe-ai-benchmark', font=TITLE, fill=TEXT)
    d.text((36, 72), 'LIVE REQUEST CAPTURE / actual timing / 1x speed', font=SMALL, fill=GREEN)
    d.rounded_rectangle((24, 112, WIDTH - 24, 560), radius=18, fill=PANEL)
    d.text((44, 132), '$ ' + ' '.join(COMMAND), font=SMALL, fill=MUTED)
    for i, line in enumerate(lines[-11:]):
        if d.textlength(line, font=FONT) > WIDTH - 88:
            raise ValueError('Captured output does not fit the frame.')
        d.text((44, 184 + i * 32), line, font=FONT,
               fill=GREEN if line.startswith(('HTTP 200', 'Tokens:', 'Estimated')) else TEXT)
    d.text((36, 585), 'Real Cerebras call / synthetic input / credentials excluded', font=SMALL, fill=MUTED)
    d.text((36, 616), 'No typing animation, reading holds, cuts, or playback speed changes.', font=SMALL, fill=MUTED)
    return image


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    events, lines, pending = [], [], b''
    started = time.monotonic()
    process = subprocess.Popen(COMMAND, cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    with selectors.DefaultSelector() as selector:
        selector.register(process.stdout, selectors.EVENT_READ)
        while selector.get_map():
            if time.monotonic() - started > 25:
                process.kill()
                raise RuntimeError('Capture deadline exceeded; not creating a misleading success video.')
            for key, _ in selector.select(timeout=0.05):
                chunk = os.read(key.fileobj.fileno(), 65536)
                observed = time.monotonic() - started
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    lines.append(line.decode('utf-8'))
                    events.append({'seconds': observed, 'line': lines[-1]})
        status = process.wait(timeout=2)
    duration = time.monotonic() - started
    if status != 0 or not any(line.startswith('HTTP 200') for line in lines):
        raise RuntimeError('Live request failed; existing video was not replaced. No automatic retry.')
    # Include the capture endpoint so a final output event is never omitted.
    frame_count = math.ceil(duration * FPS) + 1
    with av.open(str(OUT / 'demo.mp4'), 'w', options={'movflags': '+faststart'}) as video:
        stream = video.add_stream('libx264', rate=FPS)
        stream.width, stream.height, stream.pix_fmt = WIDTH, HEIGHT, 'yuv420p'
        stream.options = {'crf': '18', 'preset': 'medium'}
        visible, next_event = [], 0
        for i in range(frame_count):
            # Ceil to the next 20ms boundary: never show output before it arrived.
            at = i / FPS
            while next_event < len(events) and events[next_event]['seconds'] <= at:
                visible.append(events[next_event]['line'])
                next_event += 1
            frame = draw_frame(visible)
            for packet in stream.encode(av.VideoFrame.from_image(frame)):
                video.mux(packet)
        for packet in stream.encode():
            video.mux(packet)
    with av.open(str(OUT / 'demo.mp4')) as video:
        images = [frame.to_image().quantize(colors=64) for frame in video.decode(video=0)]
    # Play once and retain the last frame, instead of adding a synthetic end hold.
    images[0].save(OUT / 'demo.gif', save_all=True, append_images=images[1:],
                   duration=1000 // FPS, optimize=True)
    draw_frame(lines).save(OUT / 'demo-poster.png')
    (OUT / 'demo-run.json').write_text(json.dumps({
        'mode': 'live', 'generatedAt': datetime.now(timezone.utc).isoformat(),
        'command': COMMAND, 'captureDurationSeconds': duration,
        'videoDurationSeconds': frame_count / FPS, 'fps': FPS,
        'timingPolicy': '1x monotonic stdout arrival timing; 20ms frame quantization; no added holds or speed changes.',
        'events': events,
    }, indent=2) + '\n')
    print(f'Captured one live request. Actual duration: {duration:.3f}s; video: {frame_count / FPS:.3f}s.')


if __name__ == '__main__':
    main()
