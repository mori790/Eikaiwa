# services/api/app/features/talk/evaluator.py
import json
import re
from typing import Any, Dict, List, Optional

from openai import OpenAI
from ...core.config import settings

# 文字正規化（小文字化・記号除去）
def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9\\s]", "", s.lower())

def _extract_key_phrase(grammar_hint: Optional[str], model_answer: Optional[str]) -> Optional[str]:
    """
    grammar_hint が 'For what it's worth = 参考までに' のような形式なら
    '=' の左側をキーフレーズとして使う。なければ model_answer から 3語以上の句を狙う（簡易）。
    """
    if grammar_hint and "=" in grammar_hint:
        left = grammar_hint.split("=", 1)[0].strip()
        if len(left.split()) >= 2:
            return left
    if model_answer:
        # 最初の ,.:;!? の前までで、3語以上なら使う
        head = re.split(r"[\\.,:;!?]", model_answer, 1)[0]
        if len(head.split()) >= 3:
            return head.strip()
    return None

async def evaluate_answer(
    *,
    user_text: str,
    jp_prompt: str,
    model_answer: Optional[str],
    grammar_hint: Optional[str],
) -> Dict[str, Any]:
    """
    返り値: { quality: 0-3, reason: str, model_answer: str|None, examples: [str] }
    - まず ASR/キーフレーズのルールベース評価
    - その後 LLM（JSON Schema 強制）で上書き
    - どちらもダメなら quality=0 (Again) でフェイルセーフ
    """
    user_text = (user_text or "").strip()
    base_reason: List[str] = []

    # フェイルセーフ初期値（Again）
    result: Dict[str, Any] = {
        "quality": 0,
        "reason": "No reliable evaluation (fallback)",
        "model_answer": model_answer or "",
        "examples": [],
    }

    # 1) ASR最低限チェック
    if len(user_text) < 2 or len(user_text.split()) < 3:
        result["quality"] = 0
        result["reason"] = "ASR too short/low content"
        return result  # ここで確定（短すぎは LLMに投げない）

    # 2) キーフレーズ検出（ある場合）
    key_phrase = _extract_key_phrase(grammar_hint, model_answer)
    if key_phrase:
        nu = _norm(user_text)
        nk = _norm(key_phrase.replace("’", "'").replace("'", ""))  # アポストロフィ差異吸収
        if nk not in nu:
            # キーフレーズが入ってない：Again or Hard に制限
            base_reason.append(f"Key phrase missing: '{key_phrase}'")
            # ざっくり長さで Again/Hard を分ける
            result["quality"] = 0 if len(user_text.split()) < 6 else 1
            result["reason"] = "; ".join(base_reason)

    # 3) LLM 採点（JSON Schemaで強制）
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        system = (
            "You are an English tutor. Evaluate the student's English sentence "
            "against the target expression and the canonical answer. "
            "Return strict JSON only."
        )
        user_prompt = (
            f"JP prompt: {jp_prompt}\n"
            f"Student: {user_text}\n"
            f"Target expression (if any): {key_phrase or '(none)'}\n"
            f"Canonical answer: {model_answer or '(none)'}\n\n"
            "Rules:\n"
            "- quality must be an integer: 0=Again, 1=Hard, 2=Good, 3=Easy\n"
            "- Prefer penalizing if the key phrase is missing when it's required.\n"
            "- Provide a brief reason.\n"
            "- Provide up to 2 short example sentences using the same structure.\n"
        )

        response = client.chat.completions.create(
            model=getattr(settings, "openai_model_text", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.2,
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": "Eval",
                    "strict": True,
                    "schema": {
                        "type": "object",
                        "properties": {
                            "quality": {"type": "integer", "minimum": 0, "maximum": 3},
                            "reason": {"type": "string"},
                            "model_answer": {"type": "string"},
                            "examples": {
                                "type": "array",
                                "items": {"type": "string"},
                                "maxItems": 2,
                            },
                        },
                        "required": ["quality", "reason", "model_answer"],
                        "additionalProperties": False,
                    },
                },
            },
        )
        content = response.choices[0].message.content or "{}"
        parsed = json.loads(content)

        # キーフレーズ欠落でルールが低評価なら、LLMの点数が高すぎる場合は下方制限
        if base_reason:
            parsed["reason"] = (parsed.get("reason") or "").strip()
            if parsed["reason"]:
                parsed["reason"] += " | "
            parsed["reason"] += "; ".join(base_reason)
            parsed["quality"] = min(parsed.get("quality", 0), result["quality"])

        # 正常採点を採用
        result = {
            "quality": int(parsed.get("quality", 0)),
            "reason": parsed.get("reason") or "OK",
            "model_answer": (parsed.get("model_answer") or model_answer or "").strip(),
            "examples": parsed.get("examples") or [],
        }
    except Exception as e:
        # 失敗時はルールベース結果（またはフェイルセーフ）
        if base_reason:
            result["reason"] = "; ".join(base_reason) + " | LLM error"
        else:
            result["reason"] = f"LLM error: {e.__class__.__name__}"

    return result
