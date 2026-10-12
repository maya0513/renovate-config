# プリセットの境界と利用先の移行

共通化の単位は、**同じ前提と責務を持つ機能**です。設定が重複していることだけでは共通化しません。

| 判断する内容 | 置き場所 |
| --- | --- |
| 自分の各リポジトリで採用する更新・レビュー方針 | 共通default |
| 特定のツール構成で必要になる更新ルール | 選択式preset |
| 選択済み依存からのlockfile・生成物の作成と整合性検証 | 再利用workflow |
| アプリの互換性・対象環境・独自のリリース判定 | 利用先リポジトリ |

新しい候補はまず利用先で運用します。共通の前提・期待結果・検証方法を説明できるようになったら昇格させます。重複が残ることは許容し、設定行数の最小化を目標にしません。

## 提供する方針と機能

共通defaultはnpmの`rangeStrategy: update-lockfile`を採用します。範囲内では宣言を維持してlockfileを更新し、範囲外では宣言範囲も更新します。runner変更と`maya0513/renovate-config`の再利用workflow参照更新は手動レビュー対象です。後者はリリース時刻のないmainのSHAを更新するため、7日待機を免除します。通常のAction更新には既存のnon-major自動マージ方針を適用します。

`mise-pnpm`は、mise管理のNode・pnpmと`dependency-artifacts.yml`の併用を前提にします。Nodeとpnpmのnpm・mise宣言をそれぞれ同じPRにまとめ、miseのartifact生成とmaintenance、Node更新時のartifact生成を止めます。更新・検証callerと追跡済みlockfileを必ず用意してください。Node・pnpmは`package.json`とmiseで同じ完全バージョンを宣言します。

**pnpm更新のnpm artifact生成はRenovateに残します。** 新しいpnpmの宣言だけでは、lockfileの別文書にある`packageManagerDependencies`が古いままになることがあります。補助workflowは最初にfrozen installするため、その状態を修復できません。グループ内のartifact生成は、すべての更新がskipを要求する場合だけ停止します。[Renovateの仕様](https://docs.renovatebot.com/configuration-options/#skipartifactsupdate)

`vite-plus`は独立したpresetです。Vite+内蔵のVitest・coverage・Vite coreの独立更新を止め、宣言同期workflowへ任せます。miseの有無は条件にせず、miseと併用する場合は両presetを選び、workflowを一つに統合します。

Nodeの採用majorと`@types/node`の制約、Conda/Luaの制約・registry、ツール一覧、OS、lock group、生成タスク・パス、CI matrix、必須チェック名、リリース処理は利用先に残します。vfox-moonbitのMoonBit配布物の公開完了判定とLua rocks更新も利用先の責務です。Dependency reviewは利用先CIで実行し、Nodeのmajor変更時には型定義の制約も一緒に見直します。

## vfox-moonbit・gnome-wallpaperの移行

共通変更がmainへ入ってから、次の移行を行います。presetはmainを参照するため、存在しないpresetを先に利用先へ入れないでください。

1. 両利用先の`extends`を次の3つにします。

   ```json
   {
     "extends": [
       "local>maya0513/renovate-config",
       "local>maya0513/renovate-config//presets/mise-pnpm",
       "local>maya0513/renovate-config//presets/vite-plus"
     ]
   }
   ```

2. ローカルのnpm rangeルール、Node/pnpmグループ、runnerと共通workflowのレビュー方針、`mise`のartifact・maintenance設定を削除します。vfox-moonbitのpnpmグループにある`skipArtifactsUpdate: true`も削除します。gnome-wallpaperには`@types/node`の制約だけ、vfox-moonbitにはそれとConda registry・Lua 5.1の制約を残します。
3. `pmOnFail: error`を使います。vfox-moonbitの`ignore`から変更する際は、宣言に一致するpnpmで`pnpm install --lockfile-only --ignore-scripts --ignore-pnpmfile --pm-on-fail=error`を実行し、pnpm自身を記録するlockfile文書の追加もコミットします。通常の依存グラフが変わっていないことを確認し、frozen installを通します。
4. 利用先のテストも、共通化した設定のローカル記述を要求する検証から、presetの選択とリポジトリ固有の制約を確認する検証へ変えます。vfox-moonbitの「pnpmはmise.lockだけに記録する」という検証・説明も更新します。共通ルールの動作検証は本リポジトリで行います。
5. 更新・検証callerの参照を、共通変更を含むmainの同じ40桁SHAへ固定します。`# main`を添え、ツール・OS・検証方法と生成タスク・パスは両callerで一致させます。既存Appと既存のSecret名はそのまま使えます。
6. 各利用先の全CIを通します。OS matrixやGNOMEの実行環境など、利用先固有の検証も省略しません。App補助コミット後の最新SHAでCIが動くことを確認してからマージします。

導入・認証・失敗時の対処は[lockfile運用メモ](lockfile-operations.ja.md)を参照してください。

## 後続課題

[#3](https://github.com/maya0513/renovate-config/issues/3)のうち、pnpm更新途中の古いlockfileを補助workflowが修復する機能は今回の対象から外します。追加する場合は、更新モードだけで限定した差分を生成し、通常CIのfrozen/locked検証を維持し、無関係な依存を変更しないことを別途検証します。現段階ではpnpmのnpm artifact生成を停止しません。
