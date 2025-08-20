from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class DrillItem(BaseModel):
    id: int
    jp_prompt: str
    grammar_hint: Optional[str] = None

class NextResponse(BaseModel):
    items: List[DrillItem]

class AnswerIn(BaseModel):
    user_id: int
    item_id: int
    quality: int

class AnswerOut(BaseModel):
    next_due_at: Optional[datetime] = None
    status: str