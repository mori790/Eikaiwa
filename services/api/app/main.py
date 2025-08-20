# FastAPI エントリ（ルータ登録/SSE設定）
from fastapi import FastAPI
from .features.drills.router import router as drills_router

app = FastAPI()
@app.get("/health")
def health():
    return {"ok": True}

app.include_router(drills_router)