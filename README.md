# Eikaiwa

**AI搭載英会話学習アプリケーション** - 音声認識とSpaced Repetition Systemを活用した効率的な英語学習プラットフォーム

## 🎯 概要

Eikaiwаは、日本語話者向けの英会話学習アプリです。OpenAI APIを活用した音声認識・合成技術と、科学的根拠に基づいたSpaced Repetition System（間隔反復学習）を組み合わせ、効率的な英語学習を提供します。

## ✨ 主な機能

### 🎙️ 音声会話練習
- **7秒録音システム**: ワンクリックで7秒間録音、自動送信
- **AI音声評価**: OpenAI Whisperによる高精度な音声認識
- **リアルタイム採点**: 発音・文法・表現の総合的な評価（0-3点スケール）
- **AI音声フィードバック**: GPT-4による詳細な解説とTTSによる音声返答

### 📚 Spaced Repetition System (SRS)
- **SM-2アルゴリズム**: 科学的に証明された間隔反復学習法
- **個別最適化**: ユーザーの習熟度に応じた出題スケジューリング
- **効率的な配分**: 新規学習8割、復習2割の最適バランス
- **長期記憶定着**: 忘却曲線に基づいた復習タイミング

### 💬 インタラクティブ学習
- **10問ターン制**: 集中力を保つ適切な学習量
- **日本語プロンプト**: 自然な学習フロー
- **文法ヒント**: 学習者をサポートする適切なガイダンス
- **プログレス追跡**: 学習進捗の可視化

## 🏗️ 技術スタック

### バックエンド
- **FastAPI**: 高性能なPython Webフレームワーク
- **SQLAlchemy + SQLite**: 軽量で効率的なデータベース
- **OpenAI API**: GPT-4o-mini（テキスト）、Whisper（音声認識）、TTS（音声合成）
- **Pydantic**: 型安全なデータバリデーション

### フロントエンド
- **Next.js 15**: React + TypeScriptによるモダンなUI
- **Tailwind CSS**: 効率的なスタイリング
- **Web Audio API**: ブラウザ内音声録音

### 開発・運用
- **Alembic**: データベースマイグレーション
- **Docker**: コンテナ化による環境統一
- **GitHub Actions**: CI/CDパイプライン

## 🚀 セットアップ手順

### 1. 環境構築

```bash
# リポジトリをクローン
git clone <repository-url>
cd Eikaiwa

# Python仮想環境を作成・有効化
python3 -m venv .venv
source .venv/bin/activate  # macOS/Linux
# .venv\Scripts\activate   # Windows

# Python依存関係をインストール
pip install --upgrade pip
pip install -r requirements.txt
```

### 2. 環境変数設定

```bash
# services/api/.env ファイルを作成
cd services/api
cp .env.example .env

# 必要な環境変数を設定
# OPENAI_API_KEY=your_openai_api_key_here
# DATABASE_URL=sqlite+aiosqlite:///./dev.db
# JWT_SECRET=your_jwt_secret_here
```

### 3. データベース初期化

```bash
# データベースマイグレーション実行
cd services/api
alembic upgrade head

# 初期データ投入（オプション）
python scripts/seed_data.py
```

### 4. サーバー起動

#### バックエンドAPI
```bash
cd services/api
uvicorn app.main:app --reload --port 8000
```

#### フロントエンド
```bash
cd eikaiwa-ui
npm install
npm run dev
```

## 📱 使い方

### 基本的な学習フロー

1. **学習開始**: ブラウザで `http://localhost:3000` にアクセス
2. **ユーザーID設定**: 右上でユーザーIDを入力
3. **セッション開始**: 「Start Talk」ボタンで10問セッションを開始
4. **音声回答**: 日本語プロンプトを見て「🎙️ Speak (7s)」で回答
5. **AI評価**: 音声認識→採点→音声フィードバックを受信
6. **次の問題**: 「Next ▶」ボタンで次の問題へ進む
7. **学習継続**: 10問完了後、新しいセッションで継続学習

### 評価システム
- **0点 (Again)**: 不正確、要再学習
- **1点 (Hard)**: 軽微な問題あり
- **2点 (Good)**: 正確で自然
- **3点 (Easy)**: 完璧な回答

## 🎯 学習効果を最大化するコツ

1. **定期的な学習**: 毎日少しずつでも継続する
2. **音声品質**: 静かな環境で明瞭に発話する
3. **文法ヒント活用**: 表示されるヒントを参考に構文を意識する
4. **復習重視**: SRSが提示する復習問題を積極的に取り組む
5. **フィードバック活用**: AI解説を聞いて改善点を把握する

## 🐳 Docker を使用したセットアップ

```bash
# Docker Compose で全サービスを起動
cd infra/docker
docker-compose up -d

# サービス確認
# API: http://localhost:8000
# UI: http://localhost:3000
```

## 🔧 開発者向け情報

### プロジェクト構造
```
Eikaiwa/
├── services/
│   ├── api/              # FastAPI バックエンド
│   └── worker/           # バックグラウンドジョブ
├── eikaiwa-ui/           # Next.js フロントエンド
├── infra/
│   ├── docker/           # Docker設定
│   └── terraform/        # インフラ定義
├── ops/                  # CI/CD設定
└── scripts/              # ユーティリティスクリプト
```

### API エンドポイント
- `GET /drills/next`: 次の問題を取得
- `POST /talk/session/start`: 会話セッション開始
- `POST /talk/session/answer`: 音声回答の評価
- `GET /talk/explain/stream`: ストリーミング解説

### テスト実行
```bash
# バックエンドテスト
cd services/api
pytest

# フロントエンドテスト
cd eikaiwa-ui
npm test
```

## 📄 ライセンス

MIT License

## 🤝 コントリビューション

プルリクエストやイシューの報告を歓迎します。開発ガイドラインについては `CONTRIBUTING.md` を参照してください。

## 📞 サポート

- 📧 Email: support@example.com
- 🐛 Issues: [GitHub Issues](https://github.com/username/eikaiwa/issues)
- 📖 Documentation: [Wiki](https://github.com/username/eikaiwa/wiki)

---

**Happy Learning! 🎓**