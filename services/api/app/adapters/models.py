# モデル定義
from sqlalchemy import String, Text, Integer, Float, SmallInteger, ForeignKey, DateTime, func, JSON, UniqueConstraint, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .db import Base

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped["DateTime"] = mapped_column(DateTime, server_default=func.now())

class Item(Base):
    __tablename__ = "items"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    jp_prompt: Mapped[str] = mapped_column(Text)
    en_answer: Mapped[str] = mapped_column(Text, nullable=True)
    grammar_hint: Mapped[str] = mapped_column(String(255), nullable=True)
    tags: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped["DateTime"] = mapped_column(DateTime, server_default=func.now())

class UserItemState(Base):
    __tablename__ = "user_item_states"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    item_id: Mapped[int] = mapped_column(ForeignKey("items.id", ondelete="CASCADE"), index=True)

    status: Mapped[str] = mapped_column(String(16), default="new")
    ef: Mapped[float] = mapped_column(Float, default=2.5)
    interval_days: Mapped[float] = mapped_column(Float, default=0.0)
    streak: Mapped[int] = mapped_column(Integer, default=0)
    due_at: Mapped["DateTime | None"] = mapped_column(DateTime, nullable=True)
    last_result: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    last_seen_at: Mapped["DateTime | None"] = mapped_column(DateTime, nullable=True)
    new_index: Mapped[int] = mapped_column(Integer, default=0)

    __table_args__ = (
        UniqueConstraint("user_id", "item_id", name="uq_user_item"),
        Index("ix_user_due", "user_id", "due_at"),
        Index("ix_user_newidx", "user_id", "new_index"),
    )

class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    started_at: Mapped["DateTime"] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped["DateTime | None"] = mapped_column(DateTime, nullable=True)

class Message(Base):
    __tablename__ = "messages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(16))
    content_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped["DateTime"] = mapped_column(DateTime, server_default=func.now())

class Feedback(Base):
    __tablename__ = "feedback"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    session_id: Mapped[int] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), index=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    tips_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped["DateTime"] = mapped_column(DateTime, server_default=func.now())
    