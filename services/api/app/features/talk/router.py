import json, re
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..drills.service import pick_next_batch, update_srs
from ...adapters.db import SessionLocal
from ...adapters.models import Item, Session as DbSession, Message
from ...adapters.llm_audio import transcribe_bytes, tts_bytes
from openai import OpenAI
import json, base64
from datetime import datetime
from ...core.config import settings
from .evaluator import evaluate_answer

router = APIRouter(prefix="/talk", tags=["talk"])
client = OpenAI(api_key=settings.openai_api_key)

async def get_session():
    async with SessionLocal() as s:
        yield s

@router.post("/session/start")
async def talk_start(user_id: int, count: int = 10, s: AsyncSession = Depends(get_session)):
    items = await pick_next_batch(s, user_id=user_id, n=count)
    if not items:
        raise HTTPException(400, "no items")
    # DBの会話セッション記録
    sess = DbSession(user_id=user_id)
    s.add(sess); await s.flush()
    return {"session_id": sess.id, "items": items}

SYSTEM = (
    "You are a friendly ESL speaking coach. Only use English. "
    "When evaluating the learner's spoken answer, respond in STRICT JSON with keys: "
    "{model_answer:string, reason:string, examples:string[2], quality:integer(0..3)}. "
    "quality rubric: 0=Again(incorrect/very unnatural), 1=Hard(minor issues), "
    "2=Good(correct/natural), 3=Easy(perfect). Keep reason short."
)

def build_eval_messages(jp_prompt: str, student: str, hint: str | None, canonical: str | None):
    system = ("You are an English tutor. Evaluate the student's sentence. "
              "Return ONLY valid JSON with keys: quality (0-3), reason, model_answer, examples (<=2).")
    # hint の左辺（=の前）があれば見せる
    target = (hint.split("=", 1)[0].strip() if hint and "=" in hint else (hint or "(none)"))
    user = f"""JP prompt: {jp_prompt}
Student: {student}
Target expression (if any): {target}
Canonical answer: {canonical or "(none)"}"""
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def _norm(s: str) ->str:
    return re.sub(r"[^a-z0-9\s]", "", (s or "").lower())

def _extract_key_phrase(grammar_hint: str | None, model_answer: str | None) ->str | None:
    if grammar_hint and "=" in grammar_hint:
        left = grammar_hint.split("=", 1)[0].strip()
        if len(left.split()) >= 2:
            return left
    if model_answer:
        head = re.split(r"[.,:;!?]", model_answer, 1)[0]
        if len(head.split()) >= 3:
            return head.strip()
    return None

@router.post("/session/answer")
async def talk_answer(
    user_id: int = Form(...),
    session_id: int = Form(...),
    item_id: int = Form(...),
    audio: UploadFile = File(...),
    voice: str = Form("alloy"),
    s: AsyncSession = Depends(get_session),
):
    # 1.アイテム取得
    it = (await s.execute(select(Item).where(Item.id == item_id))).scalars().first()
    if not it:
        raise HTTPException(404, "item not found")
    
    # 2.STT
    raw = await audio.read()
    if not raw or len(raw) < 800:
        raise HTTPException(400, "no audio captured (too short)")
    transcript = transcribe_bytes(raw, filename=audio.filename or "speech.webm")

    # 3.採点・解説
    # ===== ここから元の4行を置き換え =====
    msgs = build_eval_messages(it.jp_prompt, transcript, it.grammar_hint, it.en_answer)

    # フェイルセーフ（必ず Again 側に倒す）
    payload = {
        "model_answer": it.en_answer or "",
        "reason": "No reliable evaluation (fallback)",
        "examples": [],
        "quality": 0,
    }
    quality = 0

    # 例外側で未定義エラーにならないように先に定義
    base_reason: list[str] = []
    penalty_cap = 3  # これより高い評価を許さない上限（初期は制限なし）

    # ASR の最低限チェック：短すぎは LLM に投げず即 Again
    if not transcript or len(transcript.split()) < 3:
        payload["reason"] = "ASR too short/low content"
    else:
        # キーフレーズ（表現）欠落なら上限を下げる
        key_phrase = _extract_key_phrase(it.grammar_hint, it.en_answer)
        if key_phrase:
            u = _norm(transcript)
            k = _norm(key_phrase.replace("’", "'").replace("'", ""))
            if k and k not in u:
                base_reason.append(f"Key phrase missing: '{key_phrase}'")
                penalty_cap = 0 if len(transcript.split()) < 6 else 1  # 短文: Again / それ以外: Hard

        client = OpenAI(api_key=settings.openai_api_key)
        try:
            # Responses API ではなく Chat Completions を使用（こちらは response_format が通る）
            cmpl = client.chat.completions.create(
                model=getattr(settings, "openai_model_text", "gpt-4o-mini"),
                messages=msgs,                 # build_eval_messages は Chat 形式の messages を返す想定
                temperature=0.2,
                # 広く互換性のある JSON モード。必要なら json_schema にしてもOK
                response_format={"type": "json_object"},
            )
            content = cmpl.choices[0].message.content or "{}"
            model_json = json.loads(content)

            payload = {
                "model_answer": (model_json.get("model_answer") or it.en_answer or "").strip(),
                "reason": model_json.get("reason") or "OK",
                "examples": model_json.get("examples") or [],
                "quality": int(model_json.get("quality", 0)),
            }

            # ルール由来の理由を追記し、上限でクリップ
            if base_reason:
                if payload["reason"]:
                    payload["reason"] += " | "
                payload["reason"] += "; ".join(base_reason)
                payload["quality"] = min(payload["quality"], penalty_cap)

            quality = int(payload["quality"])

        except Exception as e:
            # LLM 側で失敗しても安全側へ
            payload["reason"] = (("; ".join(base_reason) + " | ") if base_reason else "") + f"LLM error: {e.__class__.__name__}"
            payload["quality"] = 0
            quality = 0
    # ===== 置き換えここまで =====


    # 4.SRS更新
    due_at, status = await update_srs(s, user_id, item_id, quality)
    await s.commit()

    # 5.返答テキストを音声へ
    reply_text = (
        f"Model answer: {payload.get('model_answer','')}\n"
        f"Reason: {payload.get('reason','')}\n"
        + (f"Extra examples: - {payload['examples'][0]}\n- {payload['examples'][1]}\n" if payload.get("examples") else "")
    )
    audio_bytes = tts_bytes(reply_text, voice=voice, fmt="mp3")
    b64 = base64.b64encode(audio_bytes).decode("ascii")

    # 6.レスポンス
    return JSONResponse({
        "transcript": transcript,
        "eval": payload,
        "srs": {"status": status, "due_at": due_at.isoformat() if due_at else None},
        "audio": {"mime": "audio/mpeg", "data_url": f"data:audio/mpeg;base64, {b64}"},
    })
