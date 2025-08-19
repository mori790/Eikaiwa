# Eikaiwa

English conversation learning application with spaced repetition system.

python3 -m venv .venv
source .venv/bin/activate # → プロンプトに (.venv) が付けば OK
python -V

# 2) 依存インストール（SQLite 運用で OK）

pip install --upgrade pip
pip install "fastapi[standard]" pydantic-settings sqlalchemy aiosqlite alembic httpx
