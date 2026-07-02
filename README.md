# Discord通話向け ワンナイト人狼

Discord の音声通話と併用して遊ぶ、ワンナイト人狼の Web 卓です。ボイスチャット機能は持たず、ルーム作成、参加、役職配布、夜能力、議論タイマー、同時投票、結果公開を Supabase Auth / Postgres / Realtime で同期します。

## セットアップ方法

```bash
npm install
copy .env.example .env.local
npm run dev
```

`.env.local` に Supabase の URL と anon key を入れてください。開発サーバーは通常 `http://localhost:5173` で起動します。すでに使われている場合は Vite が別ポートを表示します。

## Supabase設定方法

1. Supabase でプロジェクトを作成します。
2. Authentication > Providers で Anonymous sign-ins を有効化します。
3. Project Settings > API から Project URL と anon public key を確認します。
4. `.env.local` に以下を設定します。

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

5. Supabase SQL Editor で `supabase/schema.sql` を実行します。
6. Database > Replication で `rooms` と `private_states` が Realtime 対象になっていることを確認します。

## デプロイ方法

このアプリは静的サイトとしてデプロイできます。Vercel、Netlify、Cloudflare Pages、Supabase Hosting 相当の静的ホスティングで動きます。

```bash
npm run build
```

出力先は `dist` です。SPA なので、ホスティング側では全パスを `index.html` にリライトしてください。

## ディレクトリ構成

```text
src/
  domain/
    gameLogic.ts        ゲーム開始、夜処理、投票、勝敗判定
    types.ts            Supabase と UI で共有する型
    roles/Role.ts       役職定義と追加ポイント
  hooks/
    useAuth.ts          Supabase 匿名ログイン
    useRoom.ts          ルームと個人情報の購読
  services/
    supabase.ts         Supabase クライアント
    roomRepository.ts   rooms / private_states の読み書き
  App.tsx               画面構成
  index.css             Tailwind とデザイン基盤
supabase/
  schema.sql            テーブル、RLS、Realtime 設定
```

## 新しい役職を追加する方法

1. `src/domain/types.ts` の `RoleId` に ID を追加します。
2. `src/domain/roles/Role.ts` の `ROLE_DEFINITIONS` に役職名、陣営、夜順、説明、夜能力の有無を追加します。
3. 夜能力が必要な場合は `src/domain/gameLogic.ts` に公開情報や交換処理を追加します。
4. 操作 UI が必要な場合は `src/App.tsx` の `NightScreen` に、その役職専用の入力を追加します。
5. `DEFAULT_ROLE_COUNTS` に初期枚数を設定します。

役職定義とゲーム進行ロジックを分けているため、能力なしの役職は `Role.ts` への追加だけでほぼ完結します。

## セキュリティについて

夜の個人情報は `private_states` テーブルに分離し、RLS で原則本人だけが読めるようにしています。投票フェーズ以降は結果集計のため参加者が private state を読める設定にしています。

厳密に「最後まで本人以外は一切読めない」設計にする場合は、勝敗判定と夜能力解決を Supabase Edge Functions か Postgres RPC に移してください。クライアントだけで秘匿情報を扱う構成では、完全な不正対策には限界があります。
