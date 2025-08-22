from __future__ import annotations
import io
from openai import OpenAI, BadRequestError
from ..core.config import settings

client = OpenAI(api_key=settings.openai_api_key)

def transcribe_bytes(data: bytes, filename: str = "speech.webm", model: str = "gpt-4o-mini-transcribe") -> str:
    """
    音声(STT)：webm/mp3/wav などのバイト列 -> 文字列
    """
    if not data or len(data) < 800:
        raise ValueError(f"音声データが不足しています (size: {len(data) if data else 0} bytes, minimum: 800)")
    
    bio = io.BytesIO(data)
    bio.name = filename  # SDKが拡張子を参照する実装もあるため付与
    try: 
        r = client.audio.transcriptions.create(model=model, file=bio)
        return getattr(r, "text", "") or ""
    except BadRequestError:
        # 相性悪かったときは whisper-1を試す
        bio.seek(0)
        r = client.audio.transcriptions.create(model="whisper-1", file=bio)
        return getattr(r, "text", "") or ""

def tts_bytes(text: str, voice: str = "alloy", fmt: str = "mp3") -> bytes:
    """
    文字(TTS)：テキスト -> 音声バイト列（mp3既定）
    SDKの引数名差異(format / audio_format)にフォールバック対応
    """
    try:
        resp = client.audio.speech.create(model="gpt-4o-mini-tts", voice=voice, input=text)
    except TypeError:
        resp = client.audio.speech.create(model="gpt-4o-mini-tts", voice=voice, input=text)

    # 返り値の型はSDK版で差があるため吸収
    if hasattr(resp, "read") and callable(resp.read):
        return resp.read()
    if hasattr(resp, "content"):
        return resp.content
    audio = getattr(resp, "audio", None)
    if isinstance(audio, (bytes, bytearray)):
        return bytes(audio)
    raise RuntimeError("Unknown TTS response shape")
