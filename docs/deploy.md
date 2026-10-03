# GitHub Pagesと中継の公開手順

公開先リポジトリとCloudflareアカウントを決めてから実施します。ここにある `REPLACE_WITH_...` は必ず置き換えます。

## 1. ビューワをGitHub Pagesへ

1. 家計簿用のリポジトリを用意し、このフォルダの内容をルートへ配置します。`.github/workflows/pages.yml` も含めます。
2. リポジトリの Settings → Pages → Build and deployment → Source を **GitHub Actions** にします。
3. `main` にコミットします。Actionsの **Publish ledger viewer** が `web/` だけを公開します。必要ならRun workflowで起動します。
4. Actionsが表示する公開URLを記録します。一般的な形は `https://GITHUB_USER.github.io/REPOSITORY/` です。

公開するファイルに家計簿本体や秘密情報を含めないでください。GitHub Pagesの利用条件はリポジトリの公開範囲・契約に依存するため、Pages設定画面で利用可否を確認します。既存サイトのあるリポジトリへそのまま上書きせず、専用の公開先を使います。

## 2. WorkerとD1

PCでNode.js 24以降とCloudflareアカウントを使います。Cloudflareが表示する利用条件・料金を確認してアカウントを選びます。

プロジェクト内の `relay/` で実行します。

```sh
cd relay
npx wrangler login
npx wrangler d1 create local-ledger
```

返された `database_id` を `relay/wrangler.toml` に設定します。

```toml
[vars]
PUBLIC_BASE_URL = "https://REPLACE_WITH_YOUR_WORKER.workers.dev"
VIEWER_ORIGIN = "https://REPLACE_WITH_YOUR_GITHUB_USERNAME.github.io"
```

`PUBLIC_BASE_URL` はWorkerの公開ドメインのみです。`/mcp` やパスを付けません。CloudflareのアカウントのWorkersサブドメインとWorker名から確認します。

`VIEWER_ORIGIN` はビューワURLのoriginのみです。GitHub Pagesのリポジトリ部分は含めません。独自ドメインを使う場合は、そのHTTPS originに変更します。

```sh
npx wrangler d1 migrations apply local-ledger --remote
```

別々のランダム文字列を、パスワードマネージャー等で作ります。

| 設定名 | 用途 | 条件 |
| --- | --- | --- |
| `VIEWER_TOKEN` | ビューワからの同期 | 32文字以上のランダム値 |
| `OWNER_PASSWORD` | ChatGPTの接続認証画面 | 16文字以上の独立したランダム値 |
| 復元用パスフレーズ | 暗号化と復元 | 12文字以上。端末側だけで設定 |

Gmailや銀行のパスワードとは別の値です。秘密値はコードやチャットに貼らず、次のコマンドの対話入力で登録します。

```sh
npx wrangler secret put VIEWER_TOKEN
npx wrangler secret put OWNER_PASSWORD
npx wrangler deploy
```

`relay/.dev.vars.example` はローカルテスト専用の公開済みダミー値です。本番では使いません。CloudflareのCronは認証用の期限切れデータの掃除だけです。Gmail送信はChatGPTの定期タスクで行います。

公開後に `https://YOUR_WORKER/health` で応答を確認します。公開ドメインが設定値と違う場合は `PUBLIC_BASE_URL` を直し、もう一度deployします。

## 3. 主端末の初期設定

1. Androidの通常ブラウザでGitHub Pagesのビューワを開きます。
2. 銀行・財布・カードの基準日と基準残高を設定します。カード名は利用通知に対応する呼び名へ変更します。
3. 同期先URLにWorkerのドメイン、接続キーに `VIEWER_TOKEN` を入力します。
4. 復元用パスフレーズを設定し、別途保管します。
5. 「同期する」を押します。「バックアップ同期済み」が表示されれば、端末の暗号化版が中継に保存されています。この表示はメール送信完了を意味しません。
6. 暗号化バックアップを端末にも保存します。

最初は主端末を1つにします。同期先に別の家計簿がある場合は、新しい空の家計簿を上書きせず、保存済みバックアップを復元します。

## 4. ChatGPTに接続

利用中のChatGPT環境でカスタムMCP接続を利用できることを確認します。開発者モードで中継を追加し、次のURLを指定します。

```text
https://YOUR_WORKER/mcp
```

OAuth認証を使います。表示される中継の認証ページで `OWNER_PASSWORD` を入力します。認証は単一所有者用のOAuth 2.1 / PKCEです。ツールには確定・承認操作を設けていません。

接続後は `get_profile` と `get_account_catalog` で疎通を確認し、架空の候補を1件だけ送ります。ビューワで同期して「確認待ち」に入り、ユーザー操作で承認できることを確かめます。架空データは実際の家計簿に承認せず却下してください。

Gmailも接続し、`docs/chatgpt-workflow.md` の運用指示を使います。この配布版には、利用中のChatGPTにカスタムMCPを登録する操作や自動送信権限を付与する操作は含まれていません。実接続後に、利用通知の取り込みとメール添付を1回ずつ確認してから定期タスクを有効にします。

## 5. メールバックアップ

週1回、日曜日の日本時間19時ごろを初期案とします。ChatGPTが `prepare_backup_email` を実行し、返された暗号化添付をGmailの自分宛て送信へ渡します。復元用パスフレーズは送信しません。

最初の送信後、Gmailでメールと添付を確認し、添付から復元用パスフレーズで復元できることを確かめます。自動送信が利用中のプラン・権限で認められない場合は、下書き作成や確認依頼の運用へ変更します。未送信を「送信済み」と報告しないことが必要です。

## 6. オフライン確認

初回はオンラインで読み込みを完了させます。Androidを機内モードにし、同じビューワURLを開き直します。保存済み記録と集計が見えることを確認します。復帰後に同期して、オフライン中の編集を暗号化バックアップへ反映します。

## 参考資料

- [GitHub Pagesの公開元設定](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [Cloudflare D1のコマンド](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare D1のマイグレーション](https://developers.cloudflare.com/d1/reference/migrations/)
- [ChatGPTとの接続と検証](https://developers.openai.com/plugins/deploy/connect-chatgpt)
- [OpenAIのMCP認証要件](https://developers.openai.com/plugins/build/auth)

複数ユーザー用に拡張する場合は、認証基盤とユーザーごとのデータ分離を設計し直します。OpenAIの認証資料は既存の認証プロバイダーの利用を推奨しています。
