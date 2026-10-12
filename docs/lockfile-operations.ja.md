# lockfile運用の注意点

このpresetと補助workflowを使うリポジトリ向けの運用メモです。**依存の宣言・lockfile・生成物を揃え、最新コミットのCIが通ってからマージする**ことを基本にします。

再利用可能な本体は[`dependency-artifacts.yml`](../.github/workflows/dependency-artifacts.yml)です。このリポジトリでは、[`update.yml`](../.github/workflows/update.yml)がRenovateのpushで更新モードを呼び出し、[`ci.yml`](../.github/workflows/ci.yml)が検証モードを呼び出します。

Vite+単独で使う場合は[`vite-plus.yml`](../.github/workflows/vite-plus.yml)を呼び出せます。これは本体を`mise-enabled: false`・`sync-vite-plus: true`で呼ぶwrapperです。

## 普段のルール

- **lockfileもGitで管理する。** `package.json`や`mise.toml`を変えたら、対応するlockfileも更新して同じPRに含めます。補助workflowはpresetの導入だけでは動きません。呼び出し側のworkflowを設定し、自動更新を使う場合はApp認証情報も用意します。
- **更新と検証を分ける。** 更新時にlockfileを生成し、通常のCIでは`pnpm install --frozen-lockfile`・`mise install --locked`で検証します。不整合をCI内で自動修正すると、コミットした内容とテストした依存がずれます。[pnpmの仕様](https://pnpm.io/cli/install#--frozen-lockfile)、[miseの仕様](https://mise.jdx.dev/dev-tools/mise-lock.html#strict-lockfile-mode)
- **生成ツールのバージョンを揃える。** ローカル・更新workflow・CIでNodeやpnpmなどの方針を揃えます。ツール更新によるlockfile形式の変更は、通常の依存更新と区別して確認します。
- **lockfileだけの差分も依存更新として扱う。** 宣言が同じでも、実際に入る直接依存・間接依存は変わります。大量の差分や意図しない更新がないかを確認し、テスト・ビルドを通します。このpresetでは火曜日のlockfile maintenanceも自動マージ対象です。[設定](../default.json)
- **競合を手編集や全削除で片づけない。** 最新の既定ブランチを取り込み、依存の宣言を確定してから対応ツールで再生成・検証します。lockfileを削除すると、無関係な依存まで更新されることがあります。

## この構成で特に注意すること

| 対象 | 運用上の注意 |
| --- | --- |
| mise | 補助workflowは**Git追跡済みのlockfile**だけを更新します。初回は人が生成・コミットしてください。sidecar（追加の依存lockfile）が生成された場合は、それも一緒に管理します。presetの`.mise/locks/`などの除外はRenovateの直接更新を避けるためで、Git管理から外す意味ではありません。[workflow](../.github/workflows/dependency-artifacts.yml)、[sidecarの仕様](https://mise.jdx.dev/dev-tools/mise-lock.html#dependency-graphs) |
| miseの実行環境 | CIや開発環境で使うOS・CPUのlock情報を含めます。環境別の`mise.*.lock`も、その環境を選んで生成・検証してください。[プラットフォームの指定](https://mise.jdx.dev/dev-tools/mise-lock.html#preparing-platform-entries) |
| 追加の生成物 | `post-update-task`と`post-update-paths`を更新・検証の両方で同じように指定します。指定漏れは古い生成物の残存につながります。タスクはリポジトリのコードを実行するため、内容を確認し、対象パスは必要最小限にします。[workflow](../.github/workflows/dependency-artifacts.yml) |
| Vite+を使う場合 | 既定ではmajorのみのcoverage宣言を維持し、lockfileのcoverageを内蔵Vitestに揃えます。coverageのexact宣言・Vitest override・Vite core aliasも同期する場合は`sync-declarations: true`にします。内蔵Vitestのmajor変更は互換性を確認してから対応します。[workflow](../.github/workflows/vite-plus.yml) |
| npmの更新方針 | 共通defaultの`rangeStrategy: "update-lockfile"`を利用先にも適用します。範囲内では宣言を維持し、範囲外では宣言範囲も更新します。[共通設定](../default.json) |

## 自動マージ前の確認

1. **最新コミットの生成物を検証する。** このリポジトリでは`check`とCIの`dependency-artifacts / prepare`を必須にします。人・Renovate・補助Appのコミットをすべて検証し、生成物が古ければマージを止めます。利用先でも、実際に表示されるチェック名を必須にしてください。
2. **AppによるpushでもCIを動かす。** 補助workflowはGitHub Appトークンでpushします。`GITHUB_TOKEN`によるpushでは新しい`push` workflowが動かないため、安易に置き換えません。CI側でbotのコミットやlockfileだけの変更を除外しないでください。[GitHubのイベント仕様](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow#triggering-a-workflow-from-a-workflow)
3. **既定ブランチへの追従を必須にする。** 必要なCIをすべて必須チェックにし、ブランチ保護の **Require branches to be up to date before merging** も有効にします。[導入手順](../README.ja.md)

補助workflowの自動起動は、Mend Renovate Appからの`renovate/`ブランチへのpushに限定しています。人や別のbotのpushでは再生成されないため、手動修正時は自分で整合性を確認してください。

## 検証モードとバージョン指定

`dependency-artifacts.yml`を`verify-only: true`で呼ぶと、既定では追跡済みlockfile・sidecar・指定生成物を再生成し、追加・変更・削除があれば失敗します。App認証情報は不要で、コミット・pushもしません。更新モード（既定の`false`）ではApp認証情報が必須です。追跡済みmise lockfileがなければmiseの処理はスキップします。初回の生成は人が行ってください。pnpmなど他のlockfileには、引き続きfrozen installの検証も必要です。

生成と検証は`contents: read`の準備ジョブで行います。更新モードでは、別の公開ジョブが準備時のSHAと差分の許可パスを再確認してコミットし、リポジトリ単位のAppトークンでpushします。公開ジョブは依存インストールや生成タスクを実行しません。差分は準備ジョブが出力したartifact IDで受け渡します。

`post-update-paths`は改行区切りのリポジトリ相対パスです。ファイル名は文字どおりに扱い、globとして展開しません。ディレクトリを指定すると配下の追加・変更・削除も対象になります。リポジトリ全体を示す`.`、親ディレクトリ、絶対パス、`.git`は指定できません。公開する生成物は通常ファイルに限ります。

このリポジトリでは、`package.json`の`engines.node: "24.21.0"`・`packageManager: "pnpm@12.10.1"`と、`mise.toml`のNode・pnpmを一致させます。`mise-pnpm` presetがnpm・miseの宣言をツール別の同じPRにまとめます。利用先も同じ完全バージョンを両方に宣言し、手動更新では両方を変えてください。一致は各利用先のCIで検証し、major更新は手動マージのままです。

共通presetは`statusCheckWhen.artifactError: "failed"`とし、生成エラーがある場合に`renovate/artifacts`を表示します。全PR共通の必須チェックにはせず、上記のCI検証を必須にします。

## mise・pnpmの選択式preset

mise管理のNode・pnpmと共有workflowを併用する場合は、`local>maya0513/renovate-config//presets/mise-pnpm`を追加します。追跡済みmise lockfileと、更新・検証の両callerを先に用意してください。presetはmiseのartifact生成・maintenanceとNode更新時のartifact生成を止めます。pnpm更新時のnpm artifact生成とnpmのmaintenanceはRenovateに残します。workflowを使わないリポジトリではこのpresetを選びません。

mise管理構成では`pnpm-workspace.yaml`に`pmOnFail: error`を指定し、実行ファイルと`packageManager`の不一致を失敗させます。共有workflowも同じオプションを明示し、別バージョンの自動取得を避けます。Vite+単独利用では、`node-version`・`pnpm-version`入力による独立した生成用バージョンを維持するため`--pm-on-fail=ignore`を使います。[pnpmの仕様](https://pnpm.io/settings/cli#pmonfail)

`ignore`から`error`へ移行する場合は、宣言に一致するpnpmでlockfileを再生成してください。pnpm自身の依存を記録する別の文書が追加される場合があります。新しいpnpm宣言に古い`packageManagerDependencies`が残ると初回frozen installが失敗するため、pnpm更新のnpm artifact生成を止めないでください。共有workflowはこの不整合の修復を行いません。

## App認証とcallerの例

新規導入ではRepository variableの`DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`とSecretの`DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`を推奨します。既存のApp・installationと既存名の認証情報は再利用でき、利用先ごとの新しいApp作成やSecret改名は不要です。更新側だけが認証情報を受け取り、対象リポジトリへのContents write権限で公開します。PR作成権限はこのworkflowには不要です。検証側にはApp認証情報を渡しません。

以下はmiseのツールがNode・pnpmだけの利用先の例です。共通変更がmainへ入った後、両callerの`<mainの40桁SHA>`を同じSHAに置き換えます。

更新caller:

```yaml
name: Synchronize dependency artifacts
on:
  push:
    branches: ["renovate/**"]
permissions:
  contents: read
jobs:
  dependency-artifacts:
    uses: maya0513/renovate-config/.github/workflows/dependency-artifacts.yml@<mainの40桁SHA> # main
    with:
      verify-only: false
      lock-groups: >-
        [{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]
      app-client-id: ${{ vars.DEPENDENCY_ARTIFACTS_APP_CLIENT_ID }}
    secrets:
      app-private-key: ${{ secrets.DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY }}
```

検証caller（既存CIへの追加例）:

```yaml
jobs:
  dependency-artifacts:
    uses: maya0513/renovate-config/.github/workflows/dependency-artifacts.yml@<mainの40桁SHA> # main
    with:
      verify-only: true
      lock-groups: >-
        [{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]
```

検証callerには`contents: read`を設定し、人・Renovate・AppによるPRの最新コミットすべてで実行します。実際のチェック名を必須にしてください。両callerで同じ`lock-groups`・生成タスク・生成パスを使います。Vite+も使う場合は、両方に`sync-vite-plus: true`・`sync-declarations: true`を追加し、以下のpresetも選択します。

## Vite+とツール別の生成・検証

Vite+を使う利用先では、`presets/`内の選択式presetを追加します。共通defaultには含まれません。以下はmiseとVite+を併用する例です。Vite+単独利用では`mise-pnpm`の参照を省きます。

```json
{
  "extends": [
    "local>maya0513/renovate-config",
    "local>maya0513/renovate-config//presets/mise-pnpm",
    "local>maya0513/renovate-config//presets/vite-plus"
  ]
}
```

`vite-plus`はnpm managerが検出する`@vitest/coverage-v8`・`vitest`・`@voidzero-dev/vite-plus-core`の独立更新を止めます。workspace overrideのaliasも対象です。**Vite+を使うリポジトリで、`sync-vite-plus: true`・`sync-declarations: true`のworkflowとセット**で導入してください。Vite+の有無は判定しないため、Vite+がなくても対象パッケージの独立更新は停止します。これらの脆弱性がVite+側で解消されない場合は、手動で対応を判断します。

`lock-groups`はJSON配列です。各要素に`lockfile`・`tools`・`platforms`・`verify`を指定し、追跡済みlockfileの設定ツールを重複・漏れなく分けます。指定しなければ従来の全ツール再生成です。

要素のキーはこの4つだけを指定し、`tools`・`platforms`には空でない文字列配列を渡します。`lockfile`は追跡済みの`mise.lock`または`mise.*.lock`の相対パスで、nested・local・環境別lockfileもそれぞれ対象になります。明示的にgroupを指定した場合は、すべての対象lockfileと設定ツールの網羅が必須です。`mise-enabled: false`の場合、`lock-groups`は空配列`[]`にします。再生成は`mise lock`で行い、`--bump`は付けません。

| `verify` | 通常CIでの検証 | 更新時 |
| --- | --- | --- |
| `regenerate` | 指定ツール・OSを再生成し、差分があれば失敗 | 同じ指定で再生成 |
| `locked` | 再解決せず、現在のrunnerでlocked install | 指定ツール・OSを再生成 |

Condaは同じトップレベルのバージョンでも再解決で間接依存が変わるため、`locked`を使います。これは**全OSでの再生成結果の一致を保証する検証ではありません**。他OS・CPUのインストールは利用先のCI matrixで確認してください。[mise lockの仕様](https://mise.jdx.dev/dev-tools/mise-lock.html#preparing-platform-entries)

miseとVite+の両方を使う場合は、**`dependency-artifacts.yml`だけを呼び出して統合**します。別々のworkflowから同じブランチへpushすると競合します。処理順はmise→Vite+→`post-update-task`で、最後に1コミット・1pushへまとめます。タスクには「最新を探して更新する処理」を含めず、選択済み依存からの生成だけを行わせます。

以下の`<mainの40桁SHA>`は、共通機能がmainに入った後のコミットSHAへ置き換えてください。タグは使いません。

```yaml
jobs:
  dependency-artifacts:
    uses: maya0513/renovate-config/.github/workflows/dependency-artifacts.yml@<mainの40桁SHA> # main
    with:
      verify-only: true
      sync-vite-plus: true
      sync-declarations: true
      lock-groups: >-
        [{"lockfile":"mise.lock","tools":["conda:lua"],"platforms":["linux-x64","linux-arm64"],"verify":"locked"},
         {"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64","macos-arm64","windows-x64"],"verify":"regenerate"}]
```

この例は3ツールの構成です。実際のツール一覧へ合わせ、更新workflowにも同じ入力を指定します。更新側は`verify-only: false`とし、`app-client-id`・`app-private-key`を渡してください。統合時のNode・pnpmは利用先のmise lockfileから使います。Vite+単独のworkflowでは`node-version`・`pnpm-version`にmajorまたはexactを指定できます。

`mise-pnpm`を選択した構成では、miseの再生成は共有workflowが担当します。選択していなければRenovate自身も再生成します。Linux専用Condaがある場合は、利用先のmise設定で`lockfile_platforms = ["linux-x64", "linux-arm64"]`を指定し、補助workflowの明示的なgroupsで他ツールの対象OSを補います。`os = ["linux"]`だけではlock生成の対象OSを制限できないケースがあるため、実際の更新でも確認してください。

Vite+同期には、ルートの`package.json`・`pnpm-workspace.yaml`・`pnpm-lock.yaml`が通常ファイルとしてGit管理されている必要があります。`@vitest/coverage-v8`は`devDependencies`にmajorのみで宣言し、`sync-declarations: true`の場合はexactの安定版も指定できます。同期は選択済みVite+を使い、coverage宣言と内蔵Vitestのmajorが異なる場合は失敗します。

Vite+の宣言同期は、トップレベルの`overrides:`配下に単純なscalarで書かれた`vite`／`vite@*`・`vitest`／`vitest@*`を対象にします。selectorがなければ`vite@*`・`vitest@*`を追加します。flow形式・anchor・重複するselectorは使わないでください。pnpmの依存スクリプトとpnpmfileは実行せず、同期後にfrozen installと依存グラフを再検証します。lockfile内のVitestは1バージョン、runnerとcoverageから解決されるVitestは同一実体であることを確認します。Vite+本体や無関係な直接・間接依存のバージョン変更も失敗にします。`post-update-task`の後には、同期済み宣言と依存グラフを再度検証します。

## 失敗したとき

| 症状 | 対処 |
| --- | --- |
| frozen / locked installが失敗 | 宣言・ツールのバージョン・環境を確認し、対応するlockfileを再生成してコミットします。検証オプションを外して通さないでください。 |
| 生成物の検証が差分で失敗 | CIに表示された対象を同じツール・タスクで再生成し、sidecarや削除も含めてコミットします。 |
| pushがlease違反で失敗 | 実行中にブランチが進んだか削除されています。最新のブランチ状態を確認し、必要ならその状態から再生成します。force pushで上書きしないでください。 |
| Vite+同期が失敗 | 内蔵Vitestのmajor、coverageのバージョン、Vitestの重複、Viteのaliasを確認します。チェックを外してマージしないでください。 |
| 補助コミット後にCIが動かない | Appの認証・権限とCIのイベント／パス条件を確認します。最新コミットが未検証のままマージしないでください。 |
