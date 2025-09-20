from typing import AsyncGenerator, Iterable
from openai import OpenAI
from ..core.config import settings
# services/api/app/main.py の一番最初で
from dotenv import load_dotenv
load_dotenv()  # .env をカレントディレクトリから読み込み

client = OpenAI(api_key=settings.openai_api_key)

SYSTEM = (
    "You are a friendly ESL speaking coach for a Japanese learner. "
    "Only use English. Keep replies concise (1-3 sentences). "
    "When asked to explain, provide: (1) a model answer, (2) a brief reason, (3) two extra examples using the same construction."
)

def build_prompt(jp_prompt: str, user_answer: str, grammar_hint: str | None) ->list[dict]:
    parts = [
        {"role": "system", "content": SYSTEM},
        {"role": "user", "content":(
            f"Translate the following Japanese into natural English and the explain.\n"
            f"Japanese: {jp_prompt}\n"
            f"User answer: {user_answer}\n"
            + (f"Grammar hint: {grammar_hint}\n" if grammar_hint else "")
            + "Return in this format:\n"
            + "Model answer:\nReason:\nExtra examples:\n- ... \n-"
        )}
    ]
    return parts

def stream_coach_events(messages: list[dict]) -> Iterable[str]:
    with client.responses.stream(
        model="gpt-4o-mini",
        input=messages,
    ) as stream:
        for event in stream:
            # テキスト増分だけ送る
            if getattr(event, "type", "").endswith("output_text.delta"):
                # event.deltaに増分文字列が入る
                yield event.delta