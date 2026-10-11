# lockfile運用の注意点

このpresetと補助workflowを使うリポジトリ向けの運用メモです。**依存の宣言・lockfile・生成物を揃え、最新コミットのCIが通ってからマージする**ことを基本にします。

## 普段のルール

- **lockfileもGitで管理する。** `package.json`や`mise.toml`を変えたら、対応するlockfileも更新して同じPRに含めます。補助workflowはpresetの導入だけでは動きません。呼び出し側のworkflowを設定し、自動更新を使う場合はApp認証情報も用意します。
- **更新と検証を分ける。** 更新時にlockfileを生成し、通常のCIでは`pnpm install --frozen-lockfile`・`mise install --locked`で検証します。不整合をCI内で自動修正すると、コミットした内容とテストした依存がずれます。[pnpmの仕様](https://pnpm.io/cli/install#--frozen-lockfile)、[miseの仕様](https://mise.jdx.dev/dev-tools/mise-lock.html#strict-lockfile-mode)
- **生成ツールのバージョンを揃える。** ローカル・更新workflow・CIでNodeやpnpmなどの方針を揃えます。ツール更新によるlockfile形式の変更は、通常の依存更新と区別して確認します。
- **lockfileだけの差分も依存更新として扱う。** 宣言が同じでも、実際に入る直接依存・間接依存は変わります。大量の差分や意図しない更新がないかを確認し、テスト・ビルドを通します。このpresetでは火曜日のlockfile maintenanceも自動マージ対象です。[設定](../default.json)
- **競合を手編集や全削除で片づけない。** 最新の既定ブランチを取り込み、依存の宣言を確定してから対応ツールで再生成・検証します。lockfileを削除すると、無関係な依存まで更新されることがあります。

## この構成で特に注意すること

| 対象 | 運用上の注意 |
| --- | --- |
| mise | 補助workflowは**Git追跡済みのlockfile**だけを更新します。初回は人が生成・コミットしてください。sidecar（追加の依存lockfile）が生成された場合は、それも一緒に管理します。presetの`.mise/locks/`などの除外はRenovateの直接更新を避けるためで、Git管理から外す意味ではありません。[workflow](../.github/workflows/mise-lock.yml)、[sidecarの仕様](https://mise.jdx.dev/dev-tools/mise-lock.html#dependency-graphs) |
| miseの実行環境 | CIや開発環境で使うOS・CPUのlock情報を含めます。環境別の`mise.*.lock`も、その環境を選んで生成・検証してください。[プラットフォームの指定](https://mise.jdx.dev/dev-tools/mise-lock.html#preparing-platform-entries) |
| 追加の生成物 | `post-update-task`と`post-update-paths`を更新・検証の両方で同じように指定します。指定漏れは古い生成物の残存につながります。タスクはリポジトリのコードを実行するため、内容を確認し、対象パスは必要最小限にします。[workflow](../.github/workflows/mise-lock.yml) |
| Vite+を使う場合 | `@vitest/coverage-v8`はmajorのみの宣言とし、実際のバージョンとVitestの解決先をVite+内蔵のVitestに揃えます。内蔵Vitestのmajor変更でworkflowが止まったら、互換性を確認してから宣言を更新します。[workflow](../.github/workflows/vite-plus-lock.yml) |
| npmの更新方針 | このリポジトリ自身の`rangeStrategy: "update-lockfile"`は利用先には継承されません。利用先でも宣言範囲を維持してlockfileを更新したい場合は、利用先で明示します。[リポジトリ固有の設定](../renovate.json) |

## 自動マージ前の確認

1. **最新コミットの生成物を検証する。** このリポジトリでは`check`とCIの`dependency-artifacts / mise-lock`を必須にします。人・Renovate・補助Appのコミットをすべて検証し、生成物が古ければマージを止めます。利用先でも、実際に表示されるチェック名を必須にしてください。
2. **AppによるpushでもCIを動かす。** 補助workflowはGitHub Appトークンでpushします。`GITHUB_TOKEN`によるpushでは新しい`push` workflowが動かないため、安易に置き換えません。CI側でbotのコミットやlockfileだけの変更を除外しないでください。[GitHubのイベント仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)
3. **既定ブランチへの追従を必須にする。** 必要なCIをすべて必須チェックにし、ブランチ保護の **Require branches to be up to date before merging** も有効にします。[導入手順](../README.ja.md)

補助workflowの自動起動は、Mend Renovate Appからの`renovate/`ブランチへのpushに限定しています。人や別のbotのpushでは再生成されないため、手動修正時は自分で整合性を確認してください。

## 検証モードとバージョン指定

`mise-lock.yml`を`verify-only: true`で呼ぶと、追跡済みlockfile・sidecar・指定生成物を再生成し、追加・変更・削除があれば失敗します。App認証情報は不要で、コミット・pushもしません。既定の更新モード（`false`）ではApp認証情報が必須です。追跡済みlockfileがなければスキップするため、初回の生成は人が行います。pnpmなど他のlockfileには、引き続きfrozen installの検証も必要です。

このリポジトリでは、`package.json`の`engines.node: "24.21.0"`・`packageManager: "pnpm@12.10.1"`と、`mise.toml`のNode・pnpmを一致させます。Renovateはnpmの生成処理で前者を参照し、ツール別の同じPRで両ファイルを更新します。手動更新でも両方を変えてください。一致はCIで検証し、major更新は手動マージのままです。この同期設定は利用先には継承されません。

共通presetは`renovate/artifacts`を成功時も失敗時も表示します。通常のPRには出ないため全PR共通の必須チェックにはせず、上記のCI検証を必須にします。

## 失敗したとき

| 症状 | 対処 |
| --- | --- |
| frozen / locked installが失敗 | 宣言・ツールのバージョン・環境を確認し、対応するlockfileを再生成してコミットします。検証オプションを外して通さないでください。 |
| 生成物の検証が差分で失敗 | CIに表示された対象を同じツール・タスクで再生成し、sidecarや削除も含めてコミットします。 |
| pushがlease違反で失敗 | 実行中にブランチが進んだか削除されています。最新のブランチ状態を確認し、必要ならその状態から再生成します。force pushで上書きしないでください。 |
| Vite+同期が失敗 | 内蔵Vitestのmajor、coverageのバージョン、Vitestの重複、Viteのaliasを確認します。チェックを外してマージしないでください。 |
| 補助コミット後にCIが動かない | Appの認証・権限とCIのイベント／パス条件を確認します。最新コミットが未検証のままマージしないでください。 |
