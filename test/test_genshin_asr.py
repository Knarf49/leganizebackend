"""
Genshin Impact ASR + Speaker Identification Test
-------------------------------------------------
1. Downloads enrollment clips per character, enrolls via /enroll
2. Downloads main quest audio (Prologue, 30 min trimmed)
3. Plays quest audio through VB-Audio Virtual Cable (simulated mic)
4. Captures from Cable Input, streams to server via WebSocket
5. Prints speaker identification results live

Requirements:
    pip install yt-dlp requests sounddevice numpy scipy websockets
    ffmpeg in PATH
    VB-Audio Virtual Cable installed (https://vb-audio.com/Cable/)

Usage:
    # List audio devices first:
    python test/test_genshin_asr.py --list-devices

    # Run test (auto-detect VB-Cable, or specify device index):
    python test/test_genshin_asr.py
    python test/test_genshin_asr.py --play-device 3 --capture-device 5
"""

import argparse
import asyncio
import os
import queue
import subprocess
import sys
import threading
import time
import json
import requests
import numpy as np
from pathlib import Path

# Resolve yt-dlp and ffmpeg using the current venv's Scripts dir
_SCRIPTS = Path(sys.executable).parent
YT_DLP  = str(_SCRIPTS / "yt-dlp.exe") if (_SCRIPTS / "yt-dlp.exe").exists() else "yt-dlp"
FFMPEG  = "ffmpeg"  # expected in system PATH

# ── Config ────────────────────────────────────────────────────────────────────

ASR_BASE   = os.getenv("ASR_SERVICE_URL", "http://localhost:8000")
WS_HOST    = os.getenv("WS_HOST", "localhost:3000")
ROOM_ID    = os.getenv("TEST_ROOM_ID", "test-room-genshin")
ACCESS_TOK = os.getenv("TEST_ACCESS_TOKEN", "test-token")

OUT_DIR    = Path("test/genshin_audio")
OUT_DIR.mkdir(parents=True, exist_ok=True)

SAMPLE_RATE   = 16_000   # Hz — match ASR service expectation
CHUNK_SEC     = 5        # seconds per audio chunk sent over WS
CHUNK_SAMPLES = SAMPLE_RATE * CHUNK_SEC

QUEST_VIDEO = {
    "url":        "https://www.youtube.com/watch?v=U_GNg8NIU78",
    "output":     OUT_DIR / "quest_prologue.wav",
    "trim_start": 90,    # skip ~1m30s intro music
    "duration":   1800,  # 30 min
}

SPEAKERS = [
    {
        "name":        "Paimon",
        "url":         "https://youtu.be/B4c9zqZkEjU",
        "output":      OUT_DIR / "enroll_paimon.wav",
        "trim_start":  0,
        "duration":    60,
    },
    {
        "name":        "Venti",
        "url":         "https://www.youtube.com/watch?v=PSNbi3olMKk",
        "output":      OUT_DIR / "enroll_venti.wav",
        "trim_start":  5,
        "duration":    60,
    },
    {
        "name":        "Jean",
        "url":         "https://www.youtube.com/watch?v=nQYlJwsddTY",
        "output":      OUT_DIR / "enroll_jean.wav",
        "trim_start":  5,
        "duration":    60,
    },
    {
        "name":        "Diluc",
        "url":         "https://youtu.be/ceQDg_YrQAc",
        "output":      OUT_DIR / "enroll_diluc.wav",
        "trim_start":  5,
        "duration":    60,
    },
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def run(cmd: list[str], label: str) -> None:
    print(f"  ▶ {label}")
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    ✗ {r.stderr[-400:]}")
        raise RuntimeError(f"{label} failed")
    print(f"    ✓")


def download_and_trim(url: str, output: Path, trim_start: int, duration: int) -> None:
    if output.exists():
        print(f"  ↩  cached: {output.name}")
        return

    tmp_pattern = str(output.with_suffix("")) + ".raw.%(ext)s"

    run(
        [YT_DLP, "--no-playlist", "-x", "--audio-format", "wav",
         "--audio-quality", "0", "-o", tmp_pattern, url],
        f"yt-dlp {output.name}",
    )

    candidates = sorted(output.parent.glob(output.stem + ".raw.*"))
    if not candidates:
        raise FileNotFoundError(f"No downloaded file found for {url}")
    raw = candidates[0]

    run(
        [FFMPEG, "-y", "-ss", str(trim_start), "-t", str(duration),
         "-i", str(raw), "-ar", str(SAMPLE_RATE), "-ac", "1",
         "-c:a", "pcm_s16le", str(output)],
        f"ffmpeg trim → {output.name}",
    )
    raw.unlink(missing_ok=True)


def load_wav_as_float32(path: Path) -> np.ndarray:
    """Read 16-bit mono WAV → float32 [-1, 1]."""
    import wave, struct
    with wave.open(str(path), "rb") as wf:
        assert wf.getnchannels() == 1, "must be mono"
        assert wf.getsampwidth() == 2, "must be 16-bit"
        frames = wf.readframes(wf.getnframes())
    samples = np.frombuffer(frames, dtype=np.int16).astype(np.float32)
    return samples / 32768.0


# ── Device helpers ────────────────────────────────────────────────────────────

def list_devices() -> None:
    import sounddevice as sd
    print(sd.query_devices())


def find_vbcable() -> tuple[int | None, int | None]:
    """Return (play_device, capture_device) for any virtual audio loopback device."""
    import sounddevice as sd
    devs = sd.query_devices()
    play_idx = capture_idx = None
    VIRTUAL_KEYWORDS = ("cable", "vb-audio", "magicmic", "virtual audio", "voicemeeter")
    for i, d in enumerate(devs):
        name = d["name"].lower()
        is_virtual = any(k in name for k in VIRTUAL_KEYWORDS)
        if is_virtual and d["max_output_channels"] > 0 and play_idx is None:
            play_idx = i
        if is_virtual and d["max_input_channels"] > 0 and capture_idx is None:
            capture_idx = i
    return play_idx, capture_idx


# ── Enrollment ────────────────────────────────────────────────────────────────

def list_speakers() -> list[str]:
    r = requests.get(f"{ASR_BASE}/speakers", timeout=10)
    r.raise_for_status()
    d = r.json()
    return d if isinstance(d, list) else d.get("speakers", [])


def delete_speaker(name: str) -> None:
    requests.delete(f"{ASR_BASE}/speakers/{name}", timeout=10)


def enroll_speaker(name: str, audio_path: Path) -> dict:
    with open(audio_path, "rb") as f:
        r = requests.post(
            f"{ASR_BASE}/enroll",
            files={"audio": (audio_path.name, f, "audio/wav")},
            data={"name": name},
            timeout=60,
        )
    r.raise_for_status()
    return r.json()


# ── Virtual mic test ──────────────────────────────────────────────────────────

def run_virtual_mic_test(
    quest_wav: Path,
    play_device: int | None,
    capture_device: int | None,
) -> None:
    """
    Thread A: plays quest audio to Cable Output (virtual speaker)
    Thread B: captures from Cable Input (virtual mic), sends chunks via WebSocket
    """
    import sounddevice as sd

    audio = load_wav_as_float32(quest_wav)
    total_samples = len(audio)
    capture_queue: queue.Queue[np.ndarray] = queue.Queue()
    stop_event = threading.Event()

    results: list[dict] = []

    # ── Playback thread ────────────────────────────────────────────────────
    def playback_thread() -> None:
        print(f"\n  🔊 Playing to device {play_device} "
              f"({sd.query_devices(play_device)['name']})")
        sd.play(audio, samplerate=SAMPLE_RATE, device=play_device, blocking=True)
        print("  🔊 Playback finished")
        stop_event.set()

    # ── Capture callback ───────────────────────────────────────────────────
    chunk_buf: list[np.ndarray] = []
    chunk_buf_samples = 0

    def capture_callback(indata: np.ndarray, frames: int, _time, status) -> None:
        nonlocal chunk_buf_samples
        if status:
            print(f"  ⚠ capture status: {status}")
        chunk_buf.append(indata[:, 0].copy())  # mono
        chunk_buf_samples += frames
        if chunk_buf_samples >= CHUNK_SAMPLES:
            combined = np.concatenate(chunk_buf)[:CHUNK_SAMPLES]
            capture_queue.put(combined)
            chunk_buf.clear()
            chunk_buf_samples = 0

    # ── Sender thread (capture → ASR /transcribe) ──────────────────────────
    def sender_thread() -> None:
        import io, wave, base64
        chunk_num = 0
        print(f"\n  🎙  Capturing from device {capture_device} "
              f"({sd.query_devices(capture_device)['name']})")
        while not stop_event.is_set() or not capture_queue.empty():
            try:
                samples = capture_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            chunk_num += 1
            offset_sec = (chunk_num - 1) * CHUNK_SEC + QUEST_VIDEO["trim_start"]
            mm, ss = divmod(offset_sec, 60)

            # Convert float32 → 16-bit PCM WAV bytes
            pcm = (samples * 32767).clip(-32768, 32767).astype(np.int16)
            buf = io.BytesIO()
            with wave.open(buf, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(SAMPLE_RATE)
                wf.writeframes(pcm.tobytes())
            wav_bytes = buf.getvalue()

            # POST directly to ASR service
            t0 = time.time()
            try:
                r = requests.post(
                    f"{ASR_BASE}/transcribe",
                    files={"audio": ("chunk.wav", wav_bytes, "audio/wav")},
                    timeout=15,
                )
                data = r.json() if r.ok else {"text": "", "speaker": "ERROR", "speaker_confidence": 0.0}
            except Exception as e:
                data = {"text": "", "speaker": f"ERR:{e}", "speaker_confidence": 0.0}
            latency = int((time.time() - t0) * 1000)

            speaker = data.get("speaker", "?")
            conf    = data.get("speaker_confidence", 0.0)
            text    = data.get("text", "").strip()[:60]
            bar     = "█" * int(conf * 10)

            print(f"  [{chunk_num:03d}] {mm:02d}:{ss:02d} │ {speaker:<10} {bar:<10} {conf:.2f} │ {text}")
            results.append({
                "chunk": chunk_num, "offset": f"{mm:02d}:{ss:02d}",
                "speaker": speaker, "confidence": conf,
                "text": text, "latency_ms": latency,
            })

        # Summary
        from collections import Counter
        print("\n── Summary ──")
        counts = Counter(r["speaker"] for r in results)
        total  = len(results)
        for sp, n in counts.most_common():
            print(f"  {sp:<14}: {n:3d} chunks ({n/total*100:.1f}%)")
        if results:
            print(f"  Avg confidence : {sum(r['confidence'] for r in results)/total:.3f}")
            print(f"  Avg latency    : {sum(r['latency_ms'] for r in results)/total:.0f}ms")

        out = OUT_DIR / "results.json"
        out.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        print(f"\n  Report → {out}")

    # ── Start all threads ──────────────────────────────────────────────────
    pb = threading.Thread(target=playback_thread, daemon=True)
    sn = threading.Thread(target=sender_thread, daemon=True)

    with sd.InputStream(
        device=capture_device,
        channels=1,
        samplerate=SAMPLE_RATE,
        dtype="float32",
        callback=capture_callback,
    ):
        pb.start()
        sn.start()
        pb.join()
        sn.join()


# ── Main ──────────────────────────────────────────────────────────────────────

def run_direct_test(quest_wav: Path, max_chunks: int | None = None) -> None:
    """Send WAV chunks directly to ASR — no audio routing needed."""
    import io, wave as wavemod
    results: list[dict] = []

    audio = load_wav_as_float32(quest_wav)
    total_chunks = len(audio) // CHUNK_SAMPLES
    if max_chunks:
        total_chunks = min(total_chunks, max_chunks)

    print(f"\n  Sending {total_chunks} chunks directly to {ASR_BASE}/transcribe")

    for i in range(total_chunks):
        samples = audio[i * CHUNK_SAMPLES : (i + 1) * CHUNK_SAMPLES]
        offset_sec = i * CHUNK_SEC + QUEST_VIDEO["trim_start"]
        mm, ss = divmod(offset_sec, 60)

        pcm = (samples * 32767).clip(-32768, 32767).astype(np.int16)
        buf = io.BytesIO()
        with wavemod.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(SAMPLE_RATE)
            wf.writeframes(pcm.tobytes())

        t0 = time.time()
        try:
            r = requests.post(
                f"{ASR_BASE}/transcribe",
                files={"audio": ("chunk.wav", buf.getvalue(), "audio/wav")},
                timeout=20,
            )
            data = r.json() if r.ok else {"text": "", "speaker": "ERROR", "speaker_confidence": 0.0}
        except Exception as e:
            data = {"text": "", "speaker": f"ERR:{e}", "speaker_confidence": 0.0}
        latency = int((time.time() - t0) * 1000)

        speaker = data.get("speaker", "?")
        conf    = data.get("speaker_confidence", 0.0)
        text    = data.get("text", "").strip()[:60]
        bar     = "█" * int(conf * 10)

        print(f"  [{i+1:03d}] {mm:02d}:{ss:02d} | {speaker:<10} {bar:<10} {conf:.2f} | {text}")
        results.append({
            "chunk": i + 1, "offset": f"{mm:02d}:{ss:02d}",
            "speaker": speaker, "confidence": conf,
            "text": text, "latency_ms": latency,
        })

    from collections import Counter
    print("\n── Summary ──")
    counts = Counter(r["speaker"] for r in results)
    total  = len(results)
    for sp, n in counts.most_common():
        print(f"  {sp:<14}: {n:3d} chunks ({n/total*100:.1f}%)")
    if results:
        print(f"  Avg confidence : {sum(r['confidence'] for r in results)/total:.3f}")
        print(f"  Avg latency    : {sum(r['latency_ms'] for r in results)/total:.0f}ms")

    out = OUT_DIR / "results.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  Report -> {out}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-devices",   action="store_true")
    parser.add_argument("--direct",         action="store_true", help="send WAV chunks direct to API (no virtual mic)")
    parser.add_argument("--max-chunks",     type=int, default=None)
    parser.add_argument("--play-device",    type=int, default=None)
    parser.add_argument("--capture-device", type=int, default=None)
    parser.add_argument("--skip-download",  action="store_true")
    parser.add_argument("--skip-enroll",    action="store_true")
    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        return

    print("=" * 60)
    mode = "Direct API" if args.direct else "Virtual Mic"
    print(f"  Genshin ASR + Speaker ID — {mode} Test")
    print("=" * 60)

    # 1. Download
    if not args.skip_download:
        print("\n── Step 1: Download enrollment clips ──")
        for sp in SPEAKERS:
            download_and_trim(sp["url"], sp["output"], sp["trim_start"], sp["duration"])

        print("\n── Step 2: Download quest audio ──")
        download_and_trim(
            QUEST_VIDEO["url"], QUEST_VIDEO["output"],
            QUEST_VIDEO["trim_start"], QUEST_VIDEO["duration"],
        )
    else:
        print("  skip downloads")

    # 2. Enroll
    if not args.skip_enroll:
        print("\n── Step 3: Enroll speakers ──")
        try:
            for name in list_speakers():
                delete_speaker(name)
                print(f"  removed: {name}")
        except Exception as e:
            print(f"  clear failed: {e}")

        enrolled = []
        for sp in SPEAKERS:
            try:
                res = enroll_speaker(sp["name"], sp["output"])
                print(f"  ok {sp['name']}: {res}")
                enrolled.append(sp["name"])
            except Exception as e:
                print(f"  fail {sp['name']}: {e}")

        if not enrolled:
            print("No speakers enrolled — is ASR service running?")
            sys.exit(1)
    else:
        print("  skip enrollment")

    # 3. Run test
    if args.direct:
        print("\n── Step 4: Direct API test ──")
        run_direct_test(QUEST_VIDEO["output"], args.max_chunks)
    else:
        print("\n── Step 4: Detect virtual audio device ──")
        play_dev, cap_dev = args.play_device, args.capture_device
        if play_dev is None or cap_dev is None:
            auto_play, auto_cap = find_vbcable()
            play_dev = play_dev if play_dev is not None else auto_play
            cap_dev  = cap_dev  if cap_dev  is not None else auto_cap

        if play_dev is None or cap_dev is None:
            print("  Virtual audio device not found!")
            print("  Use --direct to test without virtual mic")
            print("  Or specify: --play-device N --capture-device M")
            sys.exit(1)

        print(f"  Play device    : {play_dev}")
        print(f"  Capture device : {cap_dev}")
        print("\n── Step 5: Virtual mic simulation ──")
        run_virtual_mic_test(QUEST_VIDEO["output"], play_dev, cap_dev)


if __name__ == "__main__":
    main()
