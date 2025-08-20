from datetime import datetime, timedelta
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from ...adapters.models import Item, UserItemState

BATCH_N = 10
TARGET_NEW = 8
SHORT_RETRY_MIN = 10

async def pick_next_batch(s: AsyncSession, user_id: int, n: int = BATCH_N):
    now = datetime.now()

    # 期限到来の復習2個
    rev_q = (
        select(UserItemState.item_id)
        .where(
            and_(
                UserItemState.user_id == user_id,
                UserItemState.due_at.is_not(None),
                UserItemState.due_at <= now,
            )
        )
        .order_by(UserItemState.due_at.asc())
        .limit(2)
    )
    rev_ids = (await s.execute(rev_q)).scalars().all()

    # 2.新規はnew_index順
    need_new = max(0, TARGET_NEW - min(len(rev_ids), TARGET_NEW))
    new_q = (
        select(UserItemState.item_id)
        .where(
            and_(
                UserItemState.user_id == user_id,
                UserItemState.status == "new",
            )
        )
        .order_by(UserItemState.new_index.asc(), UserItemState.item_id.asc())
        .limit(need_new)
    )
    new_ids = (await s.execute(new_q)).scalars().all()

    batch_ids = (rev_ids + new_ids)[:n]
    if len(batch_ids) < n:
        extra_needed = n - len(batch_ids)
        extra_q = (
            select(UserItemState.item_id)
            .where(
                and_(
                    UserItemState.user_id == user_id,
                    UserItemState.item_id.not_in(batch_ids),
                )
            )
            .order_by(UserItemState.new_index.asc(), UserItemState.item_id.asc())
            .limit(extra_needed)
        )
        batch_ids += (await s.execute(extra_q)).scalars().all()

    # 本文の読み出し
    items = (
        await s.execute(select(Item).where(Item.id.in_(batch_ids)))
    ).scalars().all()

    # 新規のローテーション
    if new_ids:
        last_idx = (
            await s.execute(
                select(func.coalesce(func.max(UserItemState.new_index), 0))
                .where(
                    UserItemState.user_id == user_id
                )
            )
        ).scalar_one()
        for i, iid in enumerate(new_ids, start=1):
            await s.execute(
                UserItemState.__table__.update()
                .where(
                    and_(
                        UserItemState.user_id == user_id,
                        UserItemState.item_id == iid,
                    )
                )
                .values(new_index=last_idx + i)
            )
    
    return [
        {"id": it.id, "jp_prompt": it.jp_prompt, "grammar_hint": it.grammar_hint}
        for it in items[:n]
    ]

def _update_ef(prev_ef: float, quality: int) -> float:
    # 間隔反復
    ef = max(1.3, prev_ef + (0.1 - (3 - quality) * (0.08 + (3-quality) * 0.02)))
    return ef

async def update_srs(s: AsyncSession, user_id: int, item_id: int, quality: int):
    now = datetime.now()
    # データの取得
    row = (
        await s.execute(
            select(UserItemState)
            .where(
                and_(
                    UserItemState.user_id == user_id,
                    UserItemState.item_id == item_id
                )
            )
        )
    ).scalars().first()
    if not row:
        raise ValueError("state not found")
    
    row.ef = _update_ef(row.ef or 2.5, quality)
    # 覚えていない場合
    if quality < 2:
        row.interval_days = 0.0
        row.due_at = now + timedelta(minutes=SHORT_RETRY_MIN)
        row.streak = 0
        row.status = "learning"
    # ある程度覚えていた場合
    else:
        if row.interval_days <= 0:
            row.interval_days = 1
        elif row.interval_days < 3:
            row.interval_days = 3
        else:
            row.interval_days = round(row.interval_days * row.ef)
        row.due_at = now + timedelta(days=row.interval_days)
        row.streak = (row.streak or 0) + 1
        row.status = "review"
    row.last_result = quality
    row.last_seen_at = now
    return row.due_at, row.status