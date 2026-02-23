#!/usr/bin/env python3
"""
Transcribe audio to Thai text using OpenAI Whisper API
Usage: python transcribe.py <audio_file_path> <openai_api_key> [context_prompt]
"""

import sys
import os
import json
import re
from openai import OpenAI

def clean_transcription(text: str) -> str:
    """Clean transcription by removing unwanted characters"""
    if not text:
        return ""
    
    # Remove characters that are not Thai/English/numbers/punctuation
    # Thai: \u0E00-\u0E7F
    cleaned = re.sub(r'[^\u0E00-\u0E7Fa-zA-Z0-9\s\.\,\!\?\-\(\)\:\;]', '', text)
    
    # Remove excessive repeated words (e.g., "word word word" -> "word")
    cleaned = re.sub(r'\b(\w+)(\s+\1\b){2,}', r'\1', cleaned, flags=re.IGNORECASE)
    
    # Remove excessive whitespace
    cleaned = re.sub(r'\s+', ' ', cleaned)
    
    return cleaned.strip()

def filter_low_confidence_segments(segments: list, threshold: float = 0.6) -> str:
    """Filter out segments with low confidence (high no_speech_prob)"""
    filtered = []
    for segment in segments:
        no_speech_prob = segment.get('no_speech_prob', 0)
        if no_speech_prob < threshold:
            filtered.append(segment.get('text', ''))
    
    return ' '.join(filtered).strip()

def transcribe_audio(audio_path: str, api_key: str, prompt: str = None) -> dict:
    """
    Transcribe audio file to Thai text using OpenAI Whisper API
    
    Args:
        audio_path: Path to audio file (webm, mp3, wav, etc.)
        api_key: OpenAI API key
        prompt: Optional context prompt from previous transcriptions
    
    Returns:
        dict with transcription result
    """
    try:
        # Initialize OpenAI client
        print(f"🔄 Initializing OpenAI client...", file=sys.stderr)
        client = OpenAI(api_key=api_key)
        
        # Default prompt if not provided
        if not prompt:
            prompt = "นี่คือการสนทนาทางธุรกิจเป็นภาษาไทย อาจมีคำภาษาอังกฤษปนอยู่บ้าง"
        
        print(f"📝 Using prompt: {prompt[:50]}...", file=sys.stderr)
        
        # Open audio file
        print(f"🎤 Transcribing audio: {audio_path}", file=sys.stderr)
        with open(audio_path, "rb") as audio_file:
            # Call OpenAI Whisper API with verbose response
            transcription = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file,
                language="th",
                temperature=0.0,  # Reduce randomness/hallucination
                response_format="verbose_json",
                prompt=prompt
            )
        
        # Filter low-confidence segments
        print(f"🔍 Filtering low-confidence segments...", file=sys.stderr)
        if hasattr(transcription, 'segments') and transcription.segments:
            text = filter_low_confidence_segments(
                [{'text': s.text, 'no_speech_prob': s.no_speech_prob} 
                 for s in transcription.segments],
                threshold=0.6
            )
        else:
            text = transcription.text
        
        # Clean transcription
        print(f"🧹 Cleaning transcription...", file=sys.stderr)
        text = clean_transcription(text)
        
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
        print(json.dumps({"success": False, "error": "Usage: python transcribe.py <audio_file_path> <api_key> [context_prompt]"}))
        sys.exit(1)
    
    audio_file = sys.argv[1]
    api_key = sys.argv[2]
    context_prompt = sys.argv[3] if len(sys.argv) > 3 else None
    
    if not os.path.exists(audio_file):
        print(json.dumps({"success": False, "error": f"File not found: {audio_file}"}))
        sys.exit(1)
    
    result = transcribe_audio(audio_file, api_key, context_prompt)
    print(json.dumps(result))

