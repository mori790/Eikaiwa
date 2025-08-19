# SQLAlchemy セッション/接続
from sqlalchemy.orm import DeclarativeBase , sessionmaker
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine, AsyncSession
from ..core.config import settings

class Base(DeclarativeBase):
    pass

engine: AsyncEngine = create_async_engine(settings.database_url, echo=False, future=True)
SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)