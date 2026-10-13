# presetと生成・検証部品の使い分け

[English](presets-and-workflows.md)

Renovateが更新する依存を選び、利用先が生成部品を組み合わせ、共通の最終検証を経て一度だけ公開します。miseによるNode・pnpm管理と、pnpmによるVite+管理は独立した責務です。Vite+部品は、Node・pnpmを用意する方法を限定しません。

## 選ぶもの

| 利用先の構成 | 追加するpreset | 同じ準備ジョブで呼ぶ順番 |
| --- | --- | --- |
| mise管理のNode・pnpm | `mise-pnpm` | `mise-pnpm` → `pnpm-outputs` |
| 上記＋pnpm管理のVite+ | `mise-pnpm`・`viteplus` | `mise-pnpm` → `pnpm-viteplus` → `pnpm-outputs` |
| 利用先で準備したNode・pnpm＋pnpm管理のVite+ | `viteplus` | Node・pnpmの準備 → `pnpm-viteplus` → `pnpm-outputs` |

Nixなど別の方法でNode・pnpmを準備する場合も、Vite+には同じ部品を接続できます。ただし、Nix実環境での一連の動作は未検証です。Nixの宣言・lockfileの生成と整合検証は利用先が担当し、`mise-pnpm` preset・actionは選びません。

更新時だけ、別ジョブで`publish-pnpm-artifacts.yml`を呼びます。部品ごとにコミット・pushはしません。

| 責務 | 担当 |
| --- | --- |
| 更新・レビュー方針 | 共通default。npmは`update-lockfile`、major・runner・本リポジトリのaction／workflow更新は手動レビュー。本リポジトリの参照更新は同じグループ |
| Node・pnpm宣言のグループ化 | [`mise-pnpm` preset](../presets/mise-pnpm.json)。miseのartifact生成・maintenanceとNode更新のartifact生成を停止 |
| rootの派生依存の独立更新停止 | [`viteplus` preset](../presets/viteplus.json)。rootのcoverage・Vitest・Vite coreだけが対象。配下の独立プロジェクトは更新対象 |
| mise lockfile・sidecarと実行環境 | [`mise-pnpm` action](../.github/actions/mise-pnpm/action.yml) |
| Vite+に合わせた派生依存の同期 | [`pnpm-viteplus` action](../.github/actions/pnpm-viteplus/action.yml)。準備済みNode・pnpmを使用。miseの準備はしない |
| 追加生成・最終検証・payload収集 | [`pnpm-outputs` action](../.github/actions/pnpm-outputs/action.yml) |
| App認証・コミット・push | [`publish-pnpm-artifacts.yml`](../.github/workflows/publish-pnpm-artifacts.yml)。依存を実行しない |
| 対象OS、互換性、生成タスク、必須チェック、リリース | 利用先 |

pnpm更新時のnpm artifact生成はRenovateに残します。補助actionは、更新途中の古いpnpm管理情報を修復しません。初回frozen installに失敗したら、先にRenovateのartifact生成結果と失敗ログを確認してください。

## 導入条件

準備ジョブはUbuntuなどのLinux環境で実行します。Bash・GNU coreutils・jq・Gitが必要です。miseが必要になるのは`mise-pnpm`または`post-update-task`を使う場合です。lock groupの対象OSと、生成処理を実行するrunnerのOSは別です。

1. 初回のpnpm lockfileと、選んだ部品が管理する宣言・lockfile・sidecarを追跡対象にします。Node・pnpmの準備方法にかかわらず、既存lockfileで初回frozen installが成立する必要があります。
2. `extends`に共通defaultと構成に合うpresetを追加します。presetだけではactionは動きません。
3. callerの準備ジョブにcheckout（`persist-credentials: false`）とツール準備を用意し、上表の順で部品を呼びます。mise構成ではmise-action（`install: false`）を使い、それ以外では利用先がNode・pnpmをPATHへ置きます。更新・検証には同じlock group、タスク、公開パスを渡します。
4. 更新・検証の双方でCIを動かします。更新はMend Renovateのpushかつ`renovate/`ブランチに限定し、Appによる補助pushは検証として扱います。

mise構成の整合検査：`mise-pnpm`は宣言文字列や実行ファイルの保存場所ではなく、lockedで選ばれた版と実行版を照合します。同じ版を実行するshim・wrapperも利用できます。不一致・未追跡lockfileはエラーで、修復しません。以下は`mise-pnpm`を使う場合の条件です。

| 記述 | 条件 |
| --- | --- |
| miseのNode・pnpm | 完全バージョン、majorなどmiseが扱える指定。lockedで各ツールが一つのインストール済み版に解決されること |
| rootの`packageManager` | `pnpm@x.y.z`が必要。miseのlocked pnpm版と一致させる。標準的なintegrity suffixは保持 |
| `engines.node` | 任意。互換性の範囲として記述でき、pnpm標準の評価に従う |
| 採用major・`@types/node` | 利用先が決定 |

Renovateによるnpm artifact生成のNode選択は別です。互換性の範囲と実行版を分けて固定したい場合は、Renovateが標準で読む`.node-version`などにmiseのlocked版を指定し、更新時も揃えてください。共通actionがRenovateの実行版まで自動的に固定・照合するわけではありません。

mise以外でのツール準備：同じジョブの後続ステップで`node`・`pnpm`を実行できるようにします。管理ツールの宣言・lockfileと実行版の一致は利用先が検証します。Vite+部品はmiseやNixの設定を読みません。Renovateのnpm artifact生成に使うNodeの選択も別途揃えてください。

`pmOnFail: error`の設定はローカル実行も同じ方針に揃えるための推奨です。共通処理ではCLIで常に指定するため、設定ファイルへの記載がないこと自体では失敗しません。準備したpnpmがプロジェクトのパッケージマネージャー宣言と異なる場合は、pnpm標準の検査で拒否します。

Vite+構成：rootの`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`が必要です。coverageはmajorのみ、または安定版の完全バージョンで宣言します。内蔵Vitestのmajorが変わる場合は互換性のレビューが必要です。曖昧なoverride、YAMLのflow mapping・anchor・aliasは書き換えずエラーにします。

## 利用先での組み合わせ

以下は準備ジョブの主要ステップです。`env.LOCK_GROUPS`などの環境変数名とステップIDは例であり、固定ではありません。入力に値を直接指定しても構いません。`<SHA>`はすべて同じレビュー済み40桁SHAに置き換えます。通常CIではモード指定を省略します。更新callerだけが最初に呼ぶ準備部品に`verify-only: 'false'`を追加します。後続はstateから引き継ぎます。更新モードはMend Renovateのpushかつ`renovate/`ブランチでのみ使用できます。composite actionの入力は文字列です。

mise＋Vite+：

```yaml
- id: mise
  uses: maya0513/renovate-config/.github/actions/mise-pnpm@<SHA>
  with:
    lock-groups: ${{ env.LOCK_GROUPS || '[]' }}
- id: viteplus
  uses: maya0513/renovate-config/.github/actions/pnpm-viteplus@<SHA>
  with:
    preparation-state: ${{ steps.mise.outputs.state }}
- id: outputs
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
  with:
    mise-state: ${{ steps.mise.outputs.state }}
    viteplus-state: ${{ steps.viteplus.outputs.state }}
    post-update-task: ${{ env.POST_UPDATE_TASK }}
    post-update-paths: ${{ env.POST_UPDATE_PATHS }}
```

Vite+なし：`viteplus`ステップと`viteplus-state`入力を省きます。準備ジョブの`outputs`には、最後のステップから`base`・`changed`・`artifact-id`を公開します。本リポジトリの[検証caller](../.github/workflows/ci.yml)と[更新caller](../.github/workflows/update.yml)がmise＋pnpmの実例です。

miseなしのVite+：checkoutとNode・pnpmの準備後に、次の部品を呼びます。`preparation-state`・`mise-state`は省略します。更新callerでは`viteplus`ステップだけに`verify-only: 'false'`を追加します。

```yaml
- id: viteplus
  uses: maya0513/renovate-config/.github/actions/pnpm-viteplus@<SHA>
- id: outputs
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
  with:
    viteplus-state: ${{ steps.viteplus.outputs.state }}
```

追加生成：`post-update-task`はmiseタスク専用です。miseなしで上の接続を使う場合は省略します。Node・pnpmをNixで準備しても、この入力がNixのコマンドを実行する入口になるわけではありません。

公開ジョブでは`needs: prepare`を指定し、`uses: maya0513/renovate-config/.github/workflows/publish-pnpm-artifacts.yml@<SHA>`へ次の入力を渡します。通常CIではこのジョブを呼びません。

| 公開入力 | 渡す値 |
| --- | --- |
| `base`・`changed`・`artifact-id` | `needs.prepare.outputs`の同名出力 |
| `mise` | mise生成物を公開する構成では`true`（既定）。miseなしのVite+構成では`false` |
| `viteplus` | Vite+生成物の公開を許可する場合に`true`。rootの宣言・pnpm lockfileも公開対象にする |
| `post-update-paths` | 公開を許可する追加ファイル・ディレクトリ。準備側の指定を含む範囲 |
| `app-client-id` | AppのClient ID |
| Secret `app-private-key` | Appの秘密鍵 |

## 入力と検証

| 部品 | 入力・出力 | 契約 |
| --- | --- | --- |
| mise準備 | `verify-only`（既定`true`） | 通常CIは省略。更新だけ`false`を明示し、イベント条件も検査 |
| Vite+準備 | `verify-only`（省略可） | stateから継承。単独なら検証が既定。明示値がstateと違えばエラー |
| mise準備 | `lock-groups`（既定`[]`） | 明示する場合、各lockfileの全ツールを重複なく指定する |
| mise準備 | 出力`state` | 同じジョブで後続部品に渡す。モードと準備済みファイルの情報を含み、利用先で編集しない |
| Vite+準備 | `preparation-state`（省略可） | 先行部品のモードと準備済みファイルを引き継ぐ。miseのコマンドや設定形式には依存しない |
| Vite+準備 | 出力`state` | 最終検証へ渡す。Node・pnpmの準備方法にかかわらず同じ出力を使う |
| 最終検証 | `mise-state`・`viteplus-state` | 呼んだ部品の出力だけ渡す。モードはstateから決定し、リポジトリ・コミット・モードの一致を確認 |
| 最終検証 | `post-update-task`（既定空） | 追加生成用のmiseタスク。指定時はmiseが必要 |
| 最終検証 | `post-update-paths`（既定空） | 公開する追加生成物のファイル・ディレクトリ。指定しても生成処理は実行されない |
| 最終検証 | 出力`base`・`changed`・`artifact-id` | 全検証が成功した更新だけpayloadをupload。検証モードではuploadしない |

lock groupの例：

```json
[{"lockfile":"mise.lock","tools":["node","pnpm"],"platforms":["linux-x64","linux-arm64"],"verify":"regenerate"}]
```

- `regenerate`：指定したplatformで再生成し、検証時は差分を拒否します。
- `locked`：更新時は生成、検証時は記録済み依存のlocked installで確認します。他OSの検証は利用先のCI matrixが担当します。
- 空配列：追跡済みmise lockfileを従来の全ツール再生成で扱います。

追加生成タスクは依存宣言、有効なmise設定、管理対象lockfile・sidecarを変更できません。設定の追加・削除も拒否します。`post-update-paths`への指定では制限を解除できません。追加生成物の作成・変更・削除は可能です。依存を更新していた既存タスクは、タスク開始前の準備処理へ移してください。

最終検証：追加生成の後、`mise-state`を渡した場合はmiseのlocked検証を行います。どちらの構成でも同じ実行環境・オプションでfrozen installを行い、`viteplus-state`を渡した場合はVite+の宣言・依存グラフも検証します。Vite+はcoverageと内蔵Vitestの一致、一つのVitestインスタンス、Vite core alias、選択済みVite+と無関係な依存が変わっていないことを確認します。検証モードでは宣言・pnpm lockfileを修復しません。

## 利用先に残る記述

| 区分 | 利用先で記述すること |
| --- | --- |
| 部品の選択・接続 | Node・pnpmの準備方法を選び、必要な部品と最終検証を同じ準備ジョブで呼ぶ。stateと公開用出力を接続 |
| 固有値 | 採用バージョン、lock group、生成タスク、生成物パス。更新・検証で同じ値を渡す |
| 公開許可 | 別ジョブのApp認証と、公開する部品・追加パスを明示。生成ジョブの出力から許可を導かない |
| 任意の命名 | workflow名、ステップID、環境変数名、Secret名 |

更新・検証間の入力と、公開側の許可指定には重複が残ります。共通側は同じ準備処理内のstateと公開manifestを照合しますが、別実行間の入力一致は自動保証しません。参照更新はRenovateで同じグループにまとめ、手動編集時も全参照を同じレビュー済みSHAに揃えてください。SHA混在を実行時に検査する機能はありません。

## 認証と移行

推奨名：Variable `DEPENDENCY_ARTIFACTS_APP_CLIENT_ID`、Secret `DEPENDENCY_ARTIFACTS_APP_PRIVATE_KEY`。既存Appのインストールを再利用でき、既存Secretの改名は不要です。Appの公開権限は対象リポジトリのContents-writeに限定します。通常の`GITHUB_TOKEN`はContents-readです。

公開workflowは元SHAでcheckoutし、immutable artifact IDからpatchとデータ用manifestを取得します。元SHAの一致と、選択部品・追加公開パスが公開側の明示した許可範囲内であることを、コミットとApp token作成前に確認します。許可した部品を毎回使い切る必要はなく、許可ディレクトリ内の一部だけを生成することもできます。manifestから公開許可を増やすことはしません。実際の変更パス・通常ファイルであることを独立に再検証してコミットした後にApp tokenを作り、元SHAを指定したleaseでpushします。移動・削除済みブランチは上書きしません。

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
