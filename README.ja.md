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
