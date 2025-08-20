"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

// === 設定 ===
const API_BASE = "http://127.0.0.1:8000"; // FastAPI の起動URLに合わせて変更可

// 品質マップ（Again/Hard/Good/Easy → 0..3）
const QUALITY = {
  Again: 0,
  Hard: 1,
  Good: 2,
  Easy: 3,
} as const;

export default function EikaiwaDrillUI() {
  const [userId, setUserId] = useState<number>(() => {
    const stored =
      typeof window !== "undefined" ? window.localStorage.getItem("uid") : null;
    return stored ? Number(stored) : 1;
  });
  const [item, setItem] = useState<{
    id: number;
    jp_prompt: string;
    grammar_hint?: string;
  } | null>(null);
  const [answer, setAnswer] = useState("");
  const [streamText, setStreamText] = useState("");
  const [loadingNext, setLoadingNext] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // 初回 & userId変更時に次の問題を取得
    void fetchNext(1);
    // クリーンアップ: アンマウント時にSSEを閉じる
    return () => {
      if (esRef.current) esRef.current.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  async function fetchNext(count = 1) {
    setLoadingNext(true);
    setError(null);
    setStreamText("");
    try {
      const url = new URL(`${API_BASE}/drills/next`);
      url.searchParams.set("user_id", String(userId));
      url.searchParams.set("count", String(count));
      const res = await fetch(url.toString());
      if (!res.ok) throw new Error(`Failed to fetch next: ${res.status}`);
      const data = await res.json();
      if (data.items && data.items.length > 0) {
        setItem(data.items[0]);
        setAnswer("");
      } else {
        setItem(null);
        setError("No items to show. Add more seeds.");
      }
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? String(e));
    } finally {
      setLoadingNext(false);
    }
  }

  function startStream(quality: number) {
    if (!item) return;
    if (esRef.current) esRef.current.close();
    setStreamText("");
    setStreaming(true);
    setError(null);

    const url = new URL(`${API_BASE}/drills/answer_and_explain/stream`);
    url.searchParams.set("user_id", String(userId));
    url.searchParams.set("item_id", String(item.id));
    url.searchParams.set("quality", String(quality));
    url.searchParams.set("user_answer", answer);

    const es = new EventSource(url.toString());
    esRef.current = es;

    // デフォルトの message（/drills/explain/stream 用の互換）
    es.onmessage = (ev) => {
      if (!ev.data || ev.data === "[DONE]") return;
      setStreamText((prev) => prev + (prev ? "" : "") + ev.data);
    };

    // 明示イベント（answer_and_explain/stream の token/done）
    es.addEventListener("token", (ev: MessageEvent) => {
      if (!ev.data) return;
      setStreamText((prev) => prev + ev.data);
    });
    es.addEventListener("done", () => {
      es.close();
      setStreaming(false);
    });
    es.addEventListener("error", (ev: MessageEvent) => {
      setError(typeof ev.data === "string" ? ev.data : "stream error");
      es.close();
      setStreaming(false);
    });
  }

  function stopStream() {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
      setStreaming(false);
    }
  }

  function saveUserId(val: string) {
    const n = Number(val);
    if (!Number.isNaN(n) && n > 0) {
      setUserId(n);
      if (typeof window !== "undefined")
        window.localStorage.setItem("uid", String(n));
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            Eikaiwa Drill (MVP UI)
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-500">User ID</span>
              <input
                defaultValue={userId}
                onBlur={(e) => saveUserId(e.target.value)}
                className="w-20 rounded-lg border px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <span className="hidden md:inline text-slate-400">
              API: {API_BASE}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* 出題カード */}
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium text-slate-700">Question</h2>
              <button
                onClick={() => fetchNext(1)}
                disabled={loadingNext || streaming}
                className="rounded-xl bg-slate-900 px-3 py-1.5 text-white text-sm disabled:opacity-50"
              >
                {loadingNext ? "Loading…" : "Next"}
              </button>
            </div>

            {item ? (
              <div className="mt-3">
                <p className="text-xl leading-relaxed">{item.jp_prompt}</p>
                {item.grammar_hint && (
                  <p className="mt-2 inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    <span className="font-semibold">Hint</span>
                    <span>{item.grammar_hint}</span>
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-slate-500">
                No item yet. Click "Next" to fetch.
              </p>
            )}

            {/* 回答欄 */}
            <div className="mt-5">
              <label className="text-sm text-slate-600">
                Your Answer (English)
              </label>
              <textarea
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                rows={3}
                placeholder="Type your English sentence…"
                className="mt-1 w-full resize-y rounded-xl border px-3 py-2 outline-none ring-slate-200 focus:ring-2"
              />
            </div>

            {/* 採点ボタン */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Object.entries(QUALITY).map(([label, q]) => (
                <button
                  key={label}
                  onClick={() => startStream(q)}
                  disabled={!item || streaming}
                  className={
                    "rounded-xl border px-3 py-2 text-sm font-medium transition " +
                    (label === "Again"
                      ? "bg-red-50 text-red-700 border-red-200 hover:bg-red-100 disabled:opacity-50"
                      : label === "Hard"
                      ? "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 disabled:opacity-50"
                      : label === "Good"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                      : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 disabled:opacity-50")
                  }
                >
                  {label}
                </button>
              ))}
              {streaming && (
                <button
                  onClick={stopStream}
                  className="col-span-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Stop
                </button>
              )}
            </div>

            {/* ストリーミング表示 */}
            <div className="mt-5 rounded-xl border bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-600">Tutor</p>
              <pre className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                {streamText || "(waiting...)"}
              </pre>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          </div>
        </section>

        {/* 使い方メモ */}
        <section className="rounded-2xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-200">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              まず上の <b>User ID</b>{" "}
              を、初期化時に出たゲストIDに合わせてください（保存されます）。
            </li>
            <li>
              <b>Next</b> で出題を取得 → 英語で回答 →
              4つの採点ボタンのいずれかをクリック。
            </li>
            <li>
              クリック後、採点の保存と同時に <b>SSE</b>{" "}
              で解説が流れます。止めたい場合は <b>Stop</b>。
            </li>
            <li>
              サーバの CORS で <code>http://localhost:3000</code>{" "}
              を許可しておくと Next.js から動かしやすいです。
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
