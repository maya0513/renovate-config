# 設定の比較

[English](comparison.md)

確認日：**2026-10-09**。公式の2列は、[`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended)と[`config:best-practices`](https://docs.renovatebot.com/presets-config/#configbest-practices)に、継承される標準値を含めた比較です。比較の基準と本リポジトリのvalidatorは、本リポジトリのpnpmの24時間待機ルールを満たす最新安定版、Renovate **44.145.1**に揃えています。

本リポジトリの共通設定は[`default.json`](../default.json)、jdxは[`d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0`](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/default.json)時点の設定を参照しています。利用先リポジトリやBot運営側の上書き設定は比較に含めません。

## 共通preset

`config:recommended`と`config:best-practices`は、Renovate公式が提供するpresetです。前者は汎用的な基盤、後者はその基盤に開発用依存の完全固定や週次lockfile更新などの運用方針を追加したセットです。[Renovate公式の運用ガイド](https://docs.renovatebot.com/upgrade-best-practices/#use-the-configbest-practices-preset)は`config:best-practices`を推奨しています。

jdxと本リポジトリのpresetは、`config:recommended`を基にした独自設定です。

自動マージは設定上の対象を示しており、実際のマージにはリポジトリの権限・保護ルールも適用されます。公式の2つのpresetは、どちらも自動マージを有効にしません。

GitHubのネイティブ自動マージには、**Allow auto-merge**を有効にし、必要なCIチェックをすべて必須にします。最新の既定ブランチに追従して検証するには、**Require branches to be up to date before merging**も有効にしてください。GitHubがマージする場合、`rebaseWhen: auto`だけではこの条件を強制できません。[プラットフォーム側の自動マージ](https://docs.renovatebot.com/configuration-options/#platformautomerge)

| 設定 | `config:recommended` | `config:best-practices` | `local>jdx/renovate-config` | `local>maya0513/renovate-config` |
| --- | --- | --- | --- | --- |
| 基盤 | `config:recommended` | `config:recommended`＋7つの追加preset | `config:recommended`＋4つの追加preset | `config:recommended`＋3つの追加preset |
| [検出するmanager](https://docs.renovatebot.com/configuration-options/#enabledmanagers) | 標準で有効なmanager | 同じ。許可リストで限定しない | 同じ。ただしGoのdirectiveは後述の例外あり | 同じ。許可リストで限定しない |
| 除外パス | 依存物・examples・tests・fixtures | `config:recommended`と同じ | `config:recommended`＋`**/.mise/locks/**`・`**/.config/mise/locks/**` | `local>jdx/renovate-config`と同じ |
| [曜日・タイムゾーン](https://docs.renovatebot.com/configuration-options/#schedule) | 常時・UTC | 常時・UTC | 火曜日・`America/Chicago` | 火曜日・`Asia/Tokyo` |
| [リリース待機](https://docs.renovatebot.com/key-concepts/minimum-release-age/) | 全体の待機指定なし | npm datasourceに`3 days`。全体の待機指定なし | `7 days`。指定されたjdxパッケージには例外あり | `7 days` |
| [内部チェックのフィルター](https://docs.renovatebot.com/configuration-options/#internalchecksfilter) | `strict` | `strict` | 標準の`strict`を継承 | `strict` |
| [Dependency Dashboard](https://docs.renovatebot.com/configuration-options/#dependencydashboard) | 有効 | 有効 | 無効 | 無効 |
| [submoduleの取得](https://docs.renovatebot.com/configuration-options/#clonesubmodules) | 無効 | 無効 | 有効 | 有効 |
| [PR上限](https://docs.renovatebot.com/configuration-options/#prhourlylimit)（毎時／同時） | 2件／10件 | 2件／10件 | 10件／10件 | 10件／10件 |
| 通常更新のグループ | 既知の関連パッケージ・monorepo | `config:recommended`と同じ | npm・mise・GitHub Actions・Cargo・Go・Docker別。その他は共通。指定されたjdx cratesは専用グループ | `config:recommended`と同じ |
| `pin`更新 | 標準のグループ分け | 標準のグループ分け | 技術別グループの条件に含まない | 標準のグループ分け |
| non-majorの自動マージ | 無効 | 無効 | 有効 | 有効 |
| `0.x` minorの自動マージ | 無効 | 無効 | 有効 | 有効 |
| major更新 | 分離・手動マージ | 分離・手動マージ | 分離。全体の`automerge: true`を継承して自動マージ対象 | 分離・手動マージ。脆弱性修正も同様 |
| [プラットフォーム側の自動マージ](https://docs.renovatebot.com/configuration-options/#platformautomerge) | `true`。自動マージを有効にした場合に使用 | `config:recommended`と同じ | 標準の`true`を継承 | `true`。GitHubがマージする |
| [CIチェック](https://docs.renovatebot.com/configuration-options/#ignoretests) | `ignoreTests: false` | `ignoreTests: false` | 標準の`false`を継承。ネイティブ自動マージにはプラットフォームの保護ルールが適用 | 明示的に`false`。GitHubの必須チェックがネイティブ自動マージの条件を管理 |
| [rebase方針](https://docs.renovatebot.com/configuration-options/#rebasewhen) | `auto` | `auto` | `conflicted` | `auto` |
| [GitHub ActionsのSHA固定](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests) | 強制しない | 有効 | 有効。ただし`taiki-e/install-action`は除外 | 無効。タグ・ブランチ参照を使用 |
| [Dockerのdigest固定](https://docs.renovatebot.com/presets-docker/#dockerpindigests) | 強制しない | 有効 | 有効 | 有効 |
| 設定移行PR | 無効 | 有効 | 有効 | 有効 |
| [保守停止の判定ルール](https://docs.renovatebot.com/presets-abandonments/#abandonmentsrecommended) | 専用presetなし | `abandonments:recommended` | `abandonments:recommended` | `abandonments:recommended` |
| [lockfile maintenance](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance) | 無効 | UTCの月曜日04:00より前・手動マージ | Chicago時間の月曜日04:00より前・`7 days`・自動マージ | 日本時間の火曜日・自動マージ |
| [脆弱性修正](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts) | 曜日・待機の制限なし。手動マージ | `config:recommended`と同じ | 同じ例外。majorも全体の自動マージ対象 | 同じ例外。non-majorは自動、majorは手動 |
| パッケージ別の例外 | コミュニティpresetのルール | コミュニティのルール＋後述のnpm待機の例外 | 指定されたjdx cratesは曜日・待機を免除。指定されたjdxツールは待機を免除 | 所有者固有の例外なし |
| Go固有の上書き | 追加なし | 追加なし | `go` directiveの更新を無効化し、`gomodTidy`を有効化 | 追加なし |
| npmのrange方針 | managerの標準値（`auto`） | 開発用依存は`pin`、それ以外はmanagerの標準値 | managerの標準値（`auto`） | 共通presetはmanagerの標準値（`auto`） |
| 補助コミットの無視対象作者 | 追加なし | 追加なし | `github-actions[bot]`のメールアドレス | `github-actions[bot]`のメールアドレス |

`config:best-practices`のnpm待機ルールは、lockfile maintenance・置き換え・pin・リリースタイムスタンプを持たない更新種別を対象外にします。開発用依存の完全固定は`devDependencies`・`dev-dependencies`・`dev`に適用されます。[npm待機のルール](https://docs.renovatebot.com/presets-security/#securityminimumreleaseagenpm)、[開発用依存の固定](https://docs.renovatebot.com/presets-default/#pindevdependencies)

曜日の指定は通常更新の新規作成を制限します。既存ブランチの更新や自動マージは時間枠の外でも行われます。リリース待機には、標準のタイムスタンプ必須条件と追加の待機バッファーも適用されます。[スケジュール](https://docs.renovatebot.com/configuration-options/#updatenotscheduled)、[リリース待機の仕様](https://docs.renovatebot.com/key-concepts/minimum-release-age/)

`0.x`の行はpresetの実際の設定です。Renovateの[任意導入用のnon-major自動マージ例](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates)では1.0未満を除外しますが、jdxと本リポジトリの独自presetは対象に含めます。jdxのmajorについては、比較時点の全体設定が`automerge: true`であり、majorを無効にするルールがないことから判定しています。

## 補助workflow

以下はworkflowの設定で、公式の2つのpresetには含まれません。参照元：[同じリビジョンのjdx workflow](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/.github/workflows/mise-lock.yml)、[本リポジトリのworkflow](../.github/workflows/mise-lock.yml)。

| 設定 | `config:recommended` | `config:best-practices` | `local>jdx/renovate-config` | `local>maya0513/renovate-config` |
| --- | --- | --- | --- | --- |
| 再利用可能なlockfile workflow | presetでは提供しない | presetでは提供しない | `mise-lock.yml` | `mise-lock.yml` |
| App認証情報 | 定義なし | 定義なし | 任意の`MISE_LOCK_APP_ID`＋`MISE_LOCK_APP_PRIVATE_KEY` Secrets。未指定時は`GITHUB_TOKEN` | 必須の`app-client-id`入力＋`app-private-key` Secret |
| 生成物の入力 | 定義なし | 定義なし | `post_update_task`・`post_update_paths` | `post-update-task`・`post-update-paths` |
| 自分のpushによる再生成の防止 | 定義なし | 定義なし | Mendのsender IDを確認。ブランチは呼び出し側で限定 | Mendのsender ID・pushイベント・`renovate/`ブランチを確認 |
| ブランチの移動 | 定義なし | 定義なし | lease失敗後に取得・判定し、状況に応じて再試行・rebase | SHAを限定したleaseで移動・削除を拒否 |
| Vite+の整合 | — | — | — | coverageを内蔵Vitestに同期 |

本リポジトリ自身の[`renovate.json`](../renovate.json)だけが、npmに`rangeStrategy: "update-lockfile"`を指定しています。範囲内ではlockfileを更新し、範囲外では宣言範囲も更新します。利用先にはこのリポジトリ固有の上書きは継承されません。[range方針](https://docs.renovatebot.com/configuration-options/#rangestrategy)
