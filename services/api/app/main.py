# FastAPI エントリ（ルータ登録/SSE設定）
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .features.drills.router import router as drills_router

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return {"ok": True}

app.include_router(drills_router)