# presetと生成・検証部品の使い分け

[English](presets-and-workflows.md)

Renovateが更新する依存を選び、利用先が生成部品を組み合わせ、共通の最終検証を経て一度だけ公開します。対応構成はmise管理のNode・pnpmと、その上でpnpm管理のVite+を使う構成です。

## 選ぶもの

| 利用先の構成 | 追加するpreset | 同じ準備ジョブで呼ぶ順番 |
| --- | --- | --- |
| mise管理のNode・pnpm | `mise-pnpm` | `mise-pnpm` → `pnpm-outputs` |
| 上記＋pnpm管理のVite+ | `mise-pnpm`・`viteplus` | `mise-pnpm` → `pnpm-viteplus` → `pnpm-outputs` |

更新時だけ、別ジョブで`publish-pnpm-artifacts.yml`を呼びます。部品ごとにコミット・pushはしません。

| 責務 | 担当 |
| --- | --- |
| 更新・レビュー方針 | 共通default。npmは`update-lockfile`、major・runner・本リポジトリのaction／workflow更新は手動レビュー |
| Node・pnpm宣言のグループ化 | [`mise-pnpm` preset](../presets/mise-pnpm.json)。miseのartifact生成・maintenanceとNode更新のartifact生成を停止 |
| rootの派生依存の独立更新停止 | [`viteplus` preset](../presets/viteplus.json)。rootのcoverage・Vitest・Vite coreだけが対象。配下の独立プロジェクトは更新対象 |
| mise lockfile・sidecarと実行環境 | [`mise-pnpm` action](../.github/actions/mise-pnpm/action.yml) |
| Vite+に合わせた派生依存の同期 | [`pnpm-viteplus` action](../.github/actions/pnpm-viteplus/action.yml)。準備済みNode・pnpmを使用。miseの準備はしない |
| 追加生成・最終検証・payload収集 | [`pnpm-outputs` action](../.github/actions/pnpm-outputs/action.yml) |
| App認証・コミット・push | [`publish-pnpm-artifacts.yml`](../.github/workflows/publish-pnpm-artifacts.yml)。依存を実行しない |
| 対象OS、互換性、生成タスク、必須チェック、リリース | 利用先 |

pnpm更新時のnpm artifact生成はRenovateに残します。補助actionは、更新途中の古いpnpm管理情報を修復しません。初回frozen installに失敗したら、先にRenovateのartifact生成結果と失敗ログを確認してください。

## 導入条件

1. 初回のmise lockfile・sidecar・pnpm lockfileを生成し、追跡対象にします。Node・pnpmの完全バージョンをmiseと`package.json`で一致させ、`pnpm-workspace.yaml`に`pmOnFail: error`を設定します。
2. `extends`に共通defaultと構成に合うpresetを追加します。presetだけではactionは動きません。
3. callerの準備ジョブにcheckout（`persist-credentials: false`）とmise-action（`install: false`）を用意し、上表の順で部品を呼びます。更新・検証には同じlock group、タスク、公開パスを渡します。
4. 更新・検証の双方でCIを動かします。更新はMend Renovateのpushかつ`renovate/`ブランチに限定し、Appによる補助pushは検証として扱います。

Vite+構成：rootの`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`が必要です。coverageはmajorのみ、または安定版の完全バージョンで宣言します。内蔵Vitestのmajorが変わる場合は互換性のレビューが必要です。曖昧なoverride、YAMLのflow mapping・anchor・aliasは書き換えずエラーにします。

## 利用先での組み合わせ

以下は準備ジョブの主要ステップです。`<SHA>`はすべて同じレビュー済み40桁SHAに置き換えます。`env.VERIFY_ONLY`は更新なら`false`、通常CIなら`true`にします。composite actionの入力は文字列です。

```yaml
- id: mise
  uses: maya0513/renovate-config/.github/actions/mise-pnpm@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    lock-groups: ${{ env.LOCK_GROUPS }}
- id: viteplus
  uses: maya0513/renovate-config/.github/actions/pnpm-viteplus@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    prepared-paths: ${{ steps.mise.outputs.artifact-paths }}
- id: outputs
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
  with:
    verify-only: ${{ env.VERIFY_ONLY }}
    mise-state: ${{ steps.mise.outputs.state }}
    viteplus-state: ${{ steps.viteplus.outputs.state }}
    post-update-task: ${{ env.POST_UPDATE_TASK }}
    post-update-paths: ${{ env.POST_UPDATE_PATHS }}
```

Vite+なし：`viteplus`ステップと`viteplus-state`入力を省きます。準備ジョブの`outputs`には、最後のステップから`base`・`changed`・`artifact-id`を公開します。本リポジトリの[検証caller](../.github/workflows/ci.yml)と[更新caller](../.github/workflows/update.yml)がmise＋pnpmの実例です。

公開ジョブでは`needs: prepare`を指定し、`uses: maya0513/renovate-config/.github/workflows/publish-pnpm-artifacts.yml@<SHA>`へ次の入力を渡します。通常CIではこのジョブを呼びません。

| 公開入力 | 渡す値 |
| --- | --- |
| `base`・`changed`・`artifact-id` | `needs.prepare.outputs`の同名出力 |
| `mise` | `true`（既定）。mise生成物を公開対象にする |
| `viteplus` | Vite+部品を組み合わせた場合だけ`true`。rootの宣言・pnpm lockfileも公開対象にする |
| `post-update-paths` | 準備ジョブに渡したものと同じ値 |
| `app-client-id` | AppのClient ID |
| Secret `app-private-key` | Appの秘密鍵 |

## 入力と検証

| 部品 | 入力・出力 | 契約 |
| --- | --- | --- |
| 全生成・検証action | `verify-only`（既定`false`） | `true`／`false`だけを受け付ける。組み合わせた部品で一致させる |
| mise準備 | `lock-groups`（既定`[]`） | 明示する場合、各lockfileの全ツールを重複なく指定する |
| mise準備 | 出力`state`・`artifact-paths` | 同じジョブで後続部品に渡す。利用先で内容を編集しない |
| Vite+準備 | `prepared-paths`（省略可） | 先行するmise生成物をdirty checkoutの許可対象にする |
| Vite+準備 | 出力`state` | 最終検証へ渡す。Vite+部品自体はmiseを必要としないが、今回の対応構成ではmiseを先に呼ぶ |
| 最終検証 | `mise-state`・`viteplus-state` | 呼んだ部品の出力だけ渡す。同じリポジトリ・コミット・検証モードであることを確認 |
| 最終検証 | `post-update-task`・`post-update-paths`（既定空） | miseタスクで追加生成し、明示したパスだけを公開対象に加える |
| 最終検証 | 出力`base`・`changed`・`artifact-id` | 全検証が成功した更新だけpayloadをupload。検証モードではuploadしない |

lock groupの例：

```json
[{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]
```

- `regenerate`：指定したplatformで再生成し、検証時は差分を拒否します。
- `locked`：更新時は生成、検証時は記録済み依存のlocked installで確認します。他OSの検証は利用先のCI matrixが担当します。
- 空配列：追跡済みmise lockfileを従来の全ツール再生成で扱います。

追加生成タスクは依存宣言、有効なmise設定、管理対象lockfile・sidecarを変更できません。設定の追加・削除も拒否します。`post-update-paths`への指定では制限を解除できません。追加生成物の作成・変更・削除は可能です。依存を更新していた既存タスクは、タスク開始前の準備処理へ移してください。

最終検証：追加生成の後にmiseのlocked検証、同じ実行環境・オプションでのfrozen install、Vite+の宣言・依存グラフ検証を行います。Vite+はcoverageと内蔵Vitestの一致、一つのVitestインスタンス、Vite core alias、選択済みVite+と無関係な依存が変わっていないことを確認します。検証モードでは宣言・pnpm lockfileを修復しません。

## 認証と移行

推奨名：Variable `DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`、Secret `DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`。既存Appのインストールを再利用でき、既存Secretの改名は不要です。Appの公開権限は対象リポジトリのContents-writeに限定します。通常の`GITHUB_TOKEN`はContents-readです。

公開workflowは元SHAでcheckoutし、immutable artifact IDからpayloadを取得します。許可パス・通常ファイルであることを再検証してコミットした後にApp tokenを作り、元SHAを指定したleaseでpushします。移動・削除済みブランチは上書きしません。

旧名の互換ファイルはありません。旧preset参照を使う利用先を先に既存SHAへ固定してから、共通側の削除をmainへ入れてください。その後、新preset名と同じレビュー済みSHAの各部品へ移行します。利用先の移行・CI・App push後の最新SHA確認が済むまでは、[#3](https://github.com/maya0513/renovate-config/issues/3)全体の完了とは扱いません。

## #3の確認範囲

| イシューの要件 | 本リポジトリで確認すること | 残る確認 |
| --- | --- | --- |
| 共通方針と選択式ルール | Renovateの実際の設定解決・抽出で、major手動レビュー、root限定の派生依存停止、pnpm artifact生成の維持を確認 | 利用先の参照変更 |
| 現行pnpm設定と実行環境 | `pmOnFail: error`、準備した実行ファイルの優先、実Node・pnpm切り替えを回帰テスト | 実際のRenovate PRでの生成結果 |
| 初回frozen installの失敗 | 実pnpmの管理情報不整合を再現。native生成相当のlockfile生成後、更新・frozen検証が成功 | Renovate Bot自身によるartifact生成と利用先CI |
| 生成物と検証結果の一致 | 正常な追加生成、不正な宣言・lockfile・sidecar・importer・stateを拒否 | 利用先固有の生成タスクとCI matrix |
| 権限と公開 | 認証の分離、許可パス、immutable artifact ID、移動・削除されたブランチのleaseを検査 | 実App push後の最新SHAでのCI |

利用先の変更は後続作業です。この変更だけでイシューを閉じません。
