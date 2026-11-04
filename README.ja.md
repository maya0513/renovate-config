# renovate-config

[English](README.md)

他のGitHubリポジトリでRenovateを使うための共通presetです。自分用

[Mend Renovate App](https://github.com/apps/renovate)をインストールし、対象リポジトリを選択します。そのリポジトリの既定ブランチに`renovate.json`を追加してください。既存の設定がある場合は、`extends`にpresetの参照を追加します。

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["local>maya0513/renovate-config"]
}
```

対象リポジトリの**Settings → General → Pull Requests**で、**Allow auto-merge**を有効にします。

RenovateのPRとその後のコミットでCIが動くようにし、既定ブランチの保護ルールで必要なCIチェックをすべて必須にしてください。**Require branches to be up to date before merging**も有効にすると、最新の既定ブランチに追従して検証してから自動マージされます。[GitHubのブランチ保護](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches#require-status-checks-before-merging)

[脆弱性修正PR](https://docs.renovatebot.com/configuration-options/#vulnerabilityalerts)を利用する場合は、対象リポジトリのDependency graphとDependabot alertsを有効にします。

presetは本リポジトリの`main`ブランチを参照します。npmでのインストールやリリースタグの指定は不要です。[presetの参照方法](https://docs.renovatebot.com/config-presets/#self-hosted-git-current-git-server)

更新方針は[設定の比較](docs/comparison.ja.md)を参照してください。

pnpm利用先は7日以上の待機を設定し、[`pnpm-outputs`](.github/actions/pnpm-outputs/action.yml)を含むCIジョブを必須化します。この部品が方針とfrozen installを検証するため、既存のcallerにステップを増やす必要はありません。
急ぐセキュリティ修正はレビュー済みのバージョン限定例外で扱います。
[設定・CI・移行手順](docs/release-age.ja.md)を参照してください。Renovateのpresetを継承するだけではpnpm側の方針は強制されません。
ロック保守のRenovate側待機判定は、保護導入済みの利用先が自身の`renovate.json`で免除します。共通defaultからの一括免除は行いません。

共通defaultにはnpmの`rangeStrategy: update-lockfile`を含みます。runner変更と本リポジトリのaction・再利用workflow更新は手動レビュー対象で、共通参照は同じグループで更新します。

| 構成 | 追加するpreset | 利用先で組み合わせる部品 |
| --- | --- | --- |
| mise・Vite+の生成を使わないpnpm | 不要 | Node・pnpmの準備 → 入力なしの`pnpm-outputs`（検証のみ） |
| mise管理のNode・pnpm | [`presets/mise-pnpm.json`](presets/mise-pnpm.json) | `mise-pnpm` → `pnpm-outputs` |
| 上記＋pnpm管理のVite+ | 上記＋[`presets/viteplus.json`](presets/viteplus.json) | `mise-pnpm` → `pnpm-viteplus` → `pnpm-outputs` |
| 利用先で準備したNode・pnpm＋pnpm管理のVite+ | [`presets/viteplus.json`](presets/viteplus.json) | Node・pnpmの準備 → `pnpm-viteplus` → `pnpm-outputs` |

Vite+部品はmiseを必要としません。NixなどによるNode・pnpmの準備も利用先が担当できますが、Nix実環境での一連の動作は未検証です。追加生成入力`post-update-task`はmiseタスク専用です。

生成・検証部品はcomposite actionです。生成を使う場合は、追跡済みlockfileと更新・検証callerを用意し、更新時だけ別ジョブの`publish-pnpm-artifacts.yml`で検証済みの結果を公開します。presetだけではこれらは動きません。pnpm更新時のnpm artifact生成はRenovateに残します。

入力なしでpnpmを検証するだけなら通常CIの呼び出しだけでよく、更新用caller・公開workflowは不要です。pnpmを使わないプロジェクトでは、これらのpnpm部品も不要です。

ローカル開発では`mise install --locked`の後に`mise run check`を実行すると、設定・TypeScript・回帰テスト・workflow・内部actionを検証できます。
