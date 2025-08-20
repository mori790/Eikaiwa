from fastapi import APIRouter, Depends, Query, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ...adapters.db import SessionLocal
from ...adapters.models import Item
from ...adapters.llm import build_prompt, stream_coach_events
from .schemas import NextResponse, AnswerIn, AnswerOut
from .service import pick_next_batch, update_srs


router = APIRouter(prefix="/drills", tags=["drills"])

async def get_session():
    async with SessionLocal() as s:
        yield s

# 次に出す問題
@router.get("/next", response_model=NextResponse)
async def get_next(
    user_id: int = Query(...),
    count: int = Query(10, ge=1, le=20),
    s: AsyncSession = Depends(get_session),
):
    # 次に出すべき問題をDBから取得
    items = await pick_next_batch(s, user_id=user_id, n=count)
    await s.commit()
    return{"items": items}

# ユーザーの回答を評価
@router.post("/answer", response_model=AnswerOut)
async def post_answer(body: AnswerIn, s: AsyncSession = Depends(get_session)):
    due_at, status = await update_srs(s, body.user_id, body.item_id, body.quality)
    await s.commit()
    return {"next_due_at": due_at, "status": status}

@router.get("/explain/stream")
async def explain_stream(item_id: int = Query(...), user_answer: str = Query(""), s: AsyncSession = Depends(get_session)):
    # アイテム取得
    it = (await s.execute(select(Item).where(Item.id == item_id))).scalars().first()
    if not it:
        raise HTTPException(404, "item not found")
    messages = build_prompt(it.jp_prompt, user_answer, it.grammar_hint)
    # ストリーミングをするためのもの
    def sse_gen():
        # text/event-streamフォーマット
        for chunk in stream_coach_events(messages):
            yield f"data: {chunk}\n\n"
        yield "event: done\ndata: [DONE]\n\n"

    return StreamingResponse(sse_gen(), media_type="text/event-stream")

@router.get("/answer_and_explain/stream")
async def answer_and_explain_stream(
    user_id: int = Query(...),
    item_id: int = Query(...),
    quality: int = Query(..., ge=0, le=3),
    user_answer: str = Query(""),
    s: AsyncSession = Depends(get_session),
):
    # 1.SRS更新
    try: 
        await update_srs(s, user_id, item_id, quality)
        await s.commit()
    except Exception as e:
        raise HTTPException(400, f"SRS update failed: {e}")
    
    # 2.アイテムを取得
    it = (await s.execute(select(Item).where(Item.id == item_id))).scalars().first()
    if not it:
        raise HTTPException(404, "item not found")
    # 3. LLMへ
    messages = build_prompt(it.jp_prompt, user_answer, it.grammar_hint)

    def sse_gen():
        try:
            for chunk in stream_coach_events(messages):
                yield f"event: token\ndata: {chunk}\n\n"
            yield "event: done\ndata: [DONE]\n\n"
        except Exception as e:
            yield f"event: error\ndata: {str(e)}\n\n"
    
    return StreamingResponse(sse_gen(), media_type="text/event-stream")

