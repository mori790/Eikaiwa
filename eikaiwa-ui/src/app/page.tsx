"use client";
import React, { useEffect, useRef, useState } from "react";

/**
 * Talk Mode UI – 10問ターン制のボイス会話（改良版）
 * - Start Talk: サーバで10問を確定
 * - Hold to Speak: 長押しで録音 → 離したら送信
 * - サーバが STT → 採点+解説(JSON) → TTS音声返却
 * - 返答後は「Next ▶」ボタンで次へ（自動遷移はしない）
 */

const API_BASE = "http://localhost:8000"; // CORS の許可と一致させてね

// 型
type DrillItem = {
  id: number;
  jp_prompt: string;
  grammar_hint?: string | null;
};
type TalkSession = { id: number; items: DrillItem[]; idx: number };
type EvalPayload = {
  model_answer?: string;
  reason?: string;
  examples?: string[];
  quality?: number;
} | null;

export default function Page() {
  // ──────────────────────────────────────────────────────────────
  // State
  // ──────────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const saved = window.localStorage.getItem("uid");
    return saved ? Number(saved) : 1;
  });

  const [talk, setTalk] = useState<TalkSession | null>(null);
  const [item, setItem] = useState<DrillItem | null>(null);
  const [transcript, setTranscript] = useState("");
  const [evaluation, setEvaluation] = useState<EvalPayload>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [finished, setFinished] = useState(false);

  // UI 制御：ユーザーのタイミングで次へ
  const [canNext, setCanNext] = useState(false);

  // 録音関連
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const [recording, setRecording] = useState(false);
  const startAtRef = useRef<number | null>(null);

  // 同期ズレ防止用の最新 talk 参照
  const talkRef = useRef<TalkSession | null>(null);
  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);

  // LocalStorage にユーザーID保存
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem("uid", String(userId));
    }
  }, [userId]);

  // アンマウント時に確実に後始末
  useEffect(() => {
    return () => {
      try {
        recorderRef.current?.stop();
      } catch {}
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const progressPct = talk
    ? Math.round((talk.idx / talk.items.length) * 100)
    : 0;
  const qualityLabel = ["Again", "Hard", "Good", "Easy"] as const;

  // ──────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────
  function getSupportedMime(): string {
    // ブラウザ差分を吸収
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/mp4;codecs=mp4a.40.2", // Safari系
      "audio/mp4",
      "audio/aac",
      "audio/wav",
    ];
    const MR: any =
      typeof window !== "undefined" ? (window as any).MediaRecorder : null;
    if (!MR || !MR.isTypeSupported) return "";
    for (const c of candidates) {
      try {
        if (MR.isTypeSupported(c)) return c;
      } catch {
        /* no-op */
      }
    }
    return "";
  }

  // ──────────────────────────────────────────────────────────────
  // Talk control
  // ──────────────────────────────────────────────────────────────
  async function startTalk() {
    setError(null);
    setFinished(false);
    setTranscript("");
    setEvaluation(null);
    setCanNext(false);
    try {
      const res = await fetch(
        `${API_BASE}/talk/session/start?user_id=${encodeURIComponent(
          userId
        )}&count=10`,
        { method: "POST" }
      );
      if (!res.ok) throw new Error(`start failed: ${res.status}`);
      const data = await res.json();
      const sess: TalkSession = {
        id: data.session_id,
        items: data.items,
        idx: 0,
      };
      setTalk(sess);
      setItem(sess.items[0] ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  function resetTalk() {
    // 録音停止とストリーム停止
    if (recorderRef.current) {
      try {
        recorderRef.current.onstop = null;
        recorderRef.current.stop();
      } catch {}
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());

    // 状態クリア
    setTalk(null);
    setItem(null);
    setTranscript("");
    setEvaluation(null);
    setFinished(false);
    setRecording(false);
    setError(null);
    setCanNext(false);
  }

  // ──────────────────────────────────────────────────────────────
  // Recording
  // ──────────────────────────────────────────────────────────────
  async function startRecording(e?: React.SyntheticEvent) {
    e?.preventDefault?.();
    if (recording || loading) return; // 二重起動ガード
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const mime = getSupportedMime();
      const rec = mime
        ? new MediaRecorder(stream, { mimeType: mime })
        : new MediaRecorder(stream);
      recorderRef.current = rec;

      chunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      await new Promise<void>((resolve) => {
        rec.onstart = () => resolve();
        rec.start(); // timeslice なし（環境差を避ける）
      });

      startAtRef.current = Date.now();
      setRecording(true);
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function stopRecordingAndSend(e?: React.SyntheticEvent) {
    e?.preventDefault?.();

    const rec = recorderRef.current;
    if (!rec) return;

    // 最低録音時間を確保（短押し対策）
    const minMs = 900;
    const started = startAtRef.current ?? Date.now();
    const elapsed = Date.now() - started;
    if (elapsed < minMs)
      await new Promise((r) => setTimeout(r, minMs - elapsed));

    // stop → 最終 dataavailable を確実に待つ
    const waitData = new Promise<void>((resolve) => {
      rec.addEventListener("dataavailable", () => resolve(), { once: true });
    });
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      try {
        rec.stop();
      } catch {
        resolve();
      }
    });
    await waitData;

    // 完全なクリーンアップ
    setRecording(false);
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    recorderRef.current = null;
    startAtRef.current = null;

    const mime = rec?.mimeType || "audio/webm";
    const blob = new Blob(chunksRef.current, { type: mime });
    
    // デバッグログ出力
    console.log(`Recording completed: ${blob.size} bytes, duration: ${elapsed}ms`);
    
    // chunks をクリア（完全なリセット）
    chunksRef.current = [];

    // 空や極小のデータは送らない（バックエンドと統一）
    if (!blob || blob.size < 800) {
      setError(`録音が短すぎます (${blob.size} bytes)。もう一度お試しください。`);
      return;
    }

    await sendAnswerBlob(blob, mime);
  }

  // ワンクリック7秒録音
  async function record7sec() {
    if (recording || loading) return;
    await startRecording();
    setTimeout(() => {
      void stopRecordingAndSend();
    }, 7000);
  }

  // ──────────────────────────────────────────────────────────────
  // Send to server
  // ──────────────────────────────────────────────────────────────
  async function sendAnswerBlob(blob: Blob, mime?: string) {
    const currentTalk = talkRef.current;
    if (!currentTalk) return;
    const currentItem = currentTalk.items[currentTalk.idx];
    if (!currentItem) return;

    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();

      // MIMEに合わせて拡張子を決定（STT 側の判定を助ける）
      const m = (mime || blob.type || "").toLowerCase();
      const filename =
        m.includes("m4a") || m.includes("mp4")
          ? "speech.m4a"
          : m.includes("aac")
          ? "speech.aac"
          : m.includes("wav")
          ? "speech.wav"
          : m.includes("ogg")
          ? "speech.ogg"
          : "speech.webm";

      fd.append("audio", blob, filename);
      fd.append("user_id", String(userId));
      fd.append("session_id", String(currentTalk.id));
      fd.append("item_id", String(currentItem.id));

      const res = await fetch(`${API_BASE}/talk/session/answer`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) throw new Error(`answer failed: ${res.status}`);
      const data = await res.json();

      setTranscript(data.transcript || "");
      setEvaluation((data.eval as EvalPayload) ?? null);

      // 音声が来たら再生（自動再生がブロックされたら無視）
      if (data?.audio?.data_url) {
        try {
          const audio = new Audio(data.audio.data_url);
          await audio.play();
        } catch {
          /* autoplay policy 等で失敗しても無視 */
        }
      }

      // 返答が返ったので Next を有効化（自動では進まない）
      setCanNext(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  // 次の問題へ（ユーザー操作でのみ進む）
  function goNext() {
    setCanNext(false);
    setTranscript("");
    setEvaluation(null);
    setError(null);

    setTalk((prev) => {
      if (!prev) return prev;
      const nextIdx = prev.idx + 1;
      if (nextIdx < prev.items.length) {
        const nextTalk = { ...prev, idx: nextIdx };
        setItem(nextTalk.items[nextIdx] ?? null);
        return nextTalk;
      } else {
        setFinished(true);
        return prev;
      }
    });
  }

  // ──────────────────────────────────────────────────────────────
  // UI
  // ──────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">
            Eikaiwa – Talk Mode (10 rounds)
          </h1>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <span className="text-slate-500">User ID</span>
              <input
                value={Number.isFinite(userId) ? userId : ""}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isNaN(n)) {
                    setUserId(0);
                  } else {
                    setUserId(Math.max(0, Math.floor(n)));
                  }
                }}
                className="w-20 rounded-lg border px-2 py-1"
                inputMode="numeric"
              />
            </label>
            <button
              onClick={startTalk}
              className="rounded-xl bg-indigo-600 px-3 py-1.5 text-white disabled:opacity-50"
              disabled={!!talk && !finished}
            >
              Start Talk
            </button>
            <button
              onClick={resetTalk}
              className="rounded-xl border px-3 py-1.5 text-slate-700"
            >
              Reset
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-6">
        {/* 進捗バー */}
        {talk && (
          <div className="rounded-2xl bg-white p-4 ring-1 ring-slate-200">
            <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
              <span>Progress</span>
              <span>
                {talk.idx}/{talk.items.length}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full bg-indigo-600"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* 出題カード */}
        <section className="rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="p-4 md:p-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-medium text-slate-700">Question</h2>
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
                Press <b>Start Talk</b> to begin a 10-round session.
              </p>
            )}

            {/* 録音コントロール */}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={() => void record7sec()}
                disabled={!item || loading || recording}
                className="rounded-xl bg-blue-600 text-white border-blue-700 hover:bg-blue-700 disabled:opacity-50 px-4 py-2 text-sm font-medium border transition"
              >
                🎙️ Speak (7s)
              </button>

              <button
                onClick={() => goNext()}
                disabled={!talk || !item || loading || !canNext}
                title={!canNext ? "Answer first to enable Next" : ""}
                className="rounded-xl border px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
              >
                Next ▶
              </button>

              {loading && (
                <span className="text-sm text-slate-500">Processing…</span>
              )}
            </div>

            {/* STT & 解説表示 */}
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-600">
                  Your Speech (Transcript)
                </p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                  {transcript || "(waiting…)"}
                </pre>
              </div>
              <div className="rounded-xl border bg-slate-50 p-3">
                <p className="text-sm font-semibold text-slate-600">
                  Tutor Feedback
                </p>
                {evaluation ? (
                  <div className="mt-2 space-y-2 text-[15px]">
                    {typeof evaluation.quality === "number" && (
                      <p className="text-sm">
                        Quality:{" "}
                        <span className="font-semibold">
                          {qualityLabel[evaluation.quality] ??
                            evaluation.quality}
                        </span>
                      </p>
                    )}
                    {evaluation.model_answer && (
                      <p>
                        <span className="font-semibold">Model:</span>{" "}
                        {evaluation.model_answer}
                      </p>
                    )}
                    {evaluation.reason && (
                      <p>
                        <span className="font-semibold">Reason:</span>{" "}
                        {evaluation.reason}
                      </p>
                    )}
                    {evaluation.examples?.length ? (
                      <ul className="list-disc pl-5">
                        {evaluation.examples.slice(0, 2).map((ex, i) => (
                          <li key={i}>{ex}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-slate-500">(waiting…)</p>
                )}
              </div>
            </div>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            {finished && (
              <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800">
                <p className="font-semibold">Great job! 10 questions done.</p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={startTalk}
                    className="rounded-xl bg-emerald-600 px-3 py-1.5 text-white"
                  >
                    Start Another Set
                  </button>
                  <button
                    onClick={resetTalk}
                    className="rounded-xl border px-3 py-1.5"
                  >
                    Close
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* 使い方メモ */}
        <section className="rounded-2xl bg-white p-4 text-sm text-slate-600 ring-1 ring-slate-200">
          <ul className="list-disc pl-5 space-y-1">
            <li>
              まず右上の <b>User ID</b> を設定し、<b>Start Talk</b>{" "}
              を押します（10問を確定）。
            </li>
            <li>
              各問題で <b>🎙️ Hold to Speak</b>{" "}
              を長押しして話し、離すと送信（または <b>Speak (3s)</b>）。
            </li>
            <li>
              サーバが STT → 採点+解説 → TTS の音声を返します。
              <br />
              その後、<b>Next ▶</b>{" "}
              を押して次の問題へ進みます（自動では進みません）。
            </li>
            <li>
              10問で終了。もう一度やる場合は <b>Start Another Set</b>{" "}
              を押してください。
            </li>
          </ul>
        </section>
      </main>
    </div>
  );
}
