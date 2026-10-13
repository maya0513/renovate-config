# 設定の比較

[English](comparison.md)

確認時点：2026-10-13・Renovate 44.145.1。継承される標準値を含み、利用先・Bot運営側の上書きは含みません。
参照元：本リポジトリの[`default.json`](../default.json)、jdxの[`d574ac27`時点の設定](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/default.json)。

## 共通preset

公式の[`config:recommended`](https://docs.renovatebot.com/presets-config/#configrecommended)を基盤に、[`config:best-practices`](https://docs.renovatebot.com/presets-config/#configbest-practices)・jdx・本リポジトリがそれぞれ方針を追加しています。Renovate公式は[`config:best-practices`を推奨](https://docs.renovatebot.com/upgrade-best-practices/#use-the-configbest-practices-preset)しています。

| 設定 | `config:recommended` | `config:best-practices` | `local>jdx/renovate-config` | `local>maya0513/renovate-config` |
| --- | --- | --- | --- | --- |
| 基盤 | `config:recommended` | `config:recommended`＋7つの追加preset | `config:recommended`＋4つの追加preset | `config:recommended`＋4つの追加preset |
| [検出するmanager](https://docs.renovatebot.com/configuration-options/#enabledmanagers) | 標準で有効なmanager | 同じ。許可リストで限定しない | 同じ。ただしGoのdirectiveは後述の例外あり | 同じ。許可リストで限定しない |
| 除外パス | 依存物・examples・tests・fixtures | `config:recommended`と同じ | `config:recommended`＋`**/.mise/locks/**`・`**/.config/mise/locks/**` | `local>jdx/renovate-config`と同じ |
| [曜日・タイムゾーン](https://docs.renovatebot.com/configuration-options/#schedule) | 常時・UTC | 常時・UTC | 火曜日・`America/Chicago` | 火曜日・`Asia/Tokyo` |
| [リリース待機](https://docs.renovatebot.com/key-concepts/minimum-release-age/) | 全体の待機指定なし | npm datasourceに`3 days`。全体の待機指定なし | `7 days`。指定されたjdxパッケージには例外あり | `7 days` |
| [内部チェックのフィルター](https://docs.renovatebot.com/configuration-options/#internalchecksfilter) | `strict` | `strict` | 標準の`strict`を継承 | `strict` |
| [Dependency Dashboard](https://docs.renovatebot.com/configuration-options/#dependencydashboard) | 有効 | 有効 | 無効 | 無効 |
| [submoduleの取得](https://docs.renovatebot.com/configuration-options/#clonesubmodules) | 無効 | 無効 | 有効 | 有効 |
| [PR上限](https://docs.renovatebot.com/configuration-options/#prhourlylimit)（毎時／同時） | 2件／10件 | 2件／10件 | 10件／10件 | 10件／10件 |
| 通常更新のグループ | 既知の関連パッケージ・monorepo | `config:recommended`と同じ | npm・mise・GitHub Actions・Cargo・Go・Docker別。その他は共通。指定されたjdx cratesは専用グループ | `config:recommended`＋本リポジトリのaction・workflow参照を1グループ |
| `pin`更新 | 標準のグループ分け | 標準のグループ分け | 技術別グループの条件に含まない | 標準のグループ分け |
| non-majorの自動マージ | 無効 | 無効 | 有効 | 有効 |
| `0.x` minorの自動マージ | 無効 | 無効 | 有効 | 有効 |
| major更新 | 分離・手動マージ | 分離・手動マージ | 分離。全体の`automerge: true`を継承して自動マージ対象 | 分離・手動マージ。脆弱性修正も同様 |
| [プラットフォーム側の自動マージ](https://docs.renovatebot.com/configuration-options/#platformautomerge) | `true`。自動マージを有効にした場合に使用 | `config:recommended`と同じ | 標準の`true`を継承 | `true`。GitHubがマージする |
| [CIチェック](https://docs.renovatebot.com/configuration-options/#ignoretests) | `ignoreTests: false` | `ignoreTests: false` | 標準の`false`を継承。ネイティブ自動マージにはプラットフォームの保護ルールが適用 | 標準の`false`を継承。GitHubの必須チェックがネイティブ自動マージの条件を管理 |
| [生成結果のステータス](https://docs.renovatebot.com/configuration-options/#statuscheckwhen) | `artifactError: "failed"` | 同じ | 同じ | 同じ。失敗時のみ表示 |
| [rebase方針](https://docs.renovatebot.com/configuration-options/#rebasewhen) | `auto` | `auto` | `conflicted` | `auto` |
| [GitHub ActionsのSHA固定](https://docs.renovatebot.com/presets-helpers/#helperspingithubactiondigests) | 強制しない | 有効 | 有効。ただし`taiki-e/install-action`は除外 | 有効 |
| [Dockerのdigest固定](https://docs.renovatebot.com/presets-docker/#dockerpindigests) | 強制しない | 有効 | 有効 | 有効 |
| 設定移行PR | 無効 | 有効 | 有効 | 有効 |
| [保守停止の判定ルール](https://docs.renovatebot.com/presets-abandonments/#abandonmentsrecommended) | 専用presetなし | `abandonments:recommended` | `abandonments:recommended` | `abandonments:recommended` |
| [lockfile maintenance](https://docs.renovatebot.com/configuration-options/#lockfilemaintenance) | 無効 | UTCの月曜日04:00より前・手動マージ | Chicago時間の月曜日04:00より前・`7 days`・自動マージ | 日本時間の火曜日・自動マージ |
| [脆弱性修正](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts) | 曜日・待機の制限なし。手動マージ | `config:recommended`と同じ | 同じ例外。majorも全体の自動マージ対象 | 同じ例外。non-majorは自動、majorは手動 |
| パッケージ別の例外 | コミュニティpresetのルール | コミュニティのルール＋後述のnpm待機の例外 | 指定されたjdx cratesは曜日・待機を免除。指定されたjdxツールは待機を免除 | runnerと本リポジトリのaction・再利用workflow更新は手動レビュー。後者は待機免除 |
| Go固有の上書き | 追加なし | 追加なし | `go` directiveの更新を無効化し、`gomodTidy`を有効化 | 追加なし |
| npmのrange方針 | managerの標準値（`auto`） | 開発用依存は`pin`、それ以外はmanagerの標準値 | managerの標準値（`auto`） | `update-lockfile` |
| 補助コミットの無視対象作者 | 追加なし | 追加なし | `github-actions[bot]`のメールアドレス | `github-actions[bot]`のメールアドレス |

表を読む際の補足：

- **自動マージ**：表は設定上の対象です。GitHubではAllow auto-merge、必要なCIの必須化、Require branches to be up to date before mergingも設定します。`rebaseWhen: auto`だけでは最新ブランチへの追従を強制できません。[仕様](https://docs.renovatebot.com/configuration-options/#platformautomerge)
- **曜日・待機**：曜日は通常更新の新規作成を制限し、既存ブランチの更新・自動マージは時間枠の外でも可能です。待機には標準のタイムスタンプ必須条件と追加バッファーも適用されます。[曜日](https://docs.renovatebot.com/configuration-options/#updatenotscheduled)・[待機](https://docs.renovatebot.com/key-concepts/minimum-release-age/)
- **best-practicesの例外**：npm待機はmaintenance・置き換え・pin・タイムスタンプのない更新種別を除外。開発用依存の固定は`devDependencies`・`dev-dependencies`・`dev`が対象です。[待機ルール](https://docs.renovatebot.com/presets-security/#securityminimumreleaseagenpm)・[固定ルール](https://docs.renovatebot.com/presets-default/#pindevdependencies)
- **独自presetの自動マージ**：jdx・本リポジトリとも`0.x`を含みます。Renovateの[任意導入用の例](https://docs.renovatebot.com/key-concepts/automerge/#automerge-non-major-updates)とは異なります。jdxのmajorは、比較時点の全体設定`automerge: true`と無効化ルールがないことから判定しています。
- **`update-lockfile`**：範囲内では宣言を維持し、範囲外では宣言範囲も更新します。[仕様](https://docs.renovatebot.com/configuration-options/#rangestrategy)

## 補助処理

presetとは別に導入する処理の比較です。参照元：[jdxの同じリビジョン](https://github.com/jdx/renovate-config/blob/d574ac27d15201ebe7f30af8a9ab1bb90dd23bb0/.github/workflows/mise-lock.yml)、本リポジトリの[生成・検証部品](../.github/actions)と[公開workflow](../.github/workflows/publish-pnpm-artifacts.yml)。

| 項目 | Renovate公式preset | jdx | 本リポジトリ |
| --- | --- | --- | --- |
| 提供形式 | 補助workflowなし | `mise-lock.yml` | mise・Vite+・最終検証のactionを利用先で組み合わせ、別workflowで公開 |
| mise | — | lockfile生成 | lockfile・sidecar生成。`lock-groups`でツール・OS・検証方法を指定 |
| Vite+ | — | — | 内蔵Vitest・Vite coreにcoverage宣言・override・lockfileを同期 |
| 追加生成 | — | taskと公開パスを入力 | `post-update-task`・`post-update-paths`。依存入力の変更は禁止 |
| 検証 | — | 専用モードなし | 検証が既定。後続部品はstateから継承。miseは差分またはlocked、pnpmはfrozen、Vite+はグラフも検証 |
| App認証 | — | 任意。未指定時は`GITHUB_TOKEN` | 公開ジョブだけに必要。生成・検証には渡さない |
| 更新イベント | — | Mendのsender IDを確認 | 更新callerだけが最初の部品に`false`を指定。生成と公開の双方でMend・push・`renovate/`を確認 |
| 公開 | — | miseの補助コミット | 最終検証後に1コミット・1push。manifestを公開許可と照合し、許可パスと元SHAのleaseを確認 |
