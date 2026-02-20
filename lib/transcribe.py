#!/usr/bin/env python3
"""
Transcribe audio to Thai text using OpenAI Whisper API
Usage: python transcribe.py <audio_file_path> <openai_api_key>
"""

import sys
import os
import json
from openai import OpenAI

def transcribe_audio(audio_path: str, api_key: str) -> dict:
    """
    Transcribe audio file to Thai text using OpenAI Whisper API
    
    Args:
        audio_path: Path to audio file (webm, mp3, wav, etc.)
        api_key: OpenAI API key
    
    Returns:
        dict with transcription result
    """
    try:
        # Initialize OpenAI client
        print(f"🔄 Initializing OpenAI client...", file=sys.stderr)
        client = OpenAI(api_key=api_key)
        
        # Open audio file
        print(f"🎤 Transcribing audio: {audio_path}", file=sys.stderr)
        with open(audio_path, "rb") as audio_file:
            # Call OpenAI Whisper API
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="th",
            )
        
        # Extract text
        text = transcription.text.strip()
        
        print(f"✅ Transcribed: {text}", file=sys.stderr)
        
        return {
            "success": True,
            "text": text,
            "language": "th",
        }
    except Exception as e:
        error_msg = str(e)
        print(f"❌ Transcription error: {error_msg}", file=sys.stderr)
        return {
            "success": False,
            "error": error_msg,
        }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Usage: python transcribe.py <audio_file_path> <api_key>"}))
        sys.exit(1)
    
    audio_file = sys.argv[1]
    api_key = sys.argv[2]
    
    if not os.path.exists(audio_file):
        print(json.dumps({"success": False, "error": f"File not found: {audio_file}"}))
        sys.exit(1)
    
    result = transcribe_audio(audio_file, api_key)
    print(json.dumps(result))

