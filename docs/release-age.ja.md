# pnpm利用先のリリース待機方針

[English](release-age.md)

通常の依存は公開後7日以上待って採用します。Renovateは`minimumReleaseAge: "7 days"`で
更新候補を選び、pnpmは直接依存・推移依存を解決するときに独立した待機設定を適用します。
Renovateのpresetだけでは、利用先のpnpm設定の追加や検証は行われません。

## 必要な設定とCI

安定版のpnpm 12.10.1以上を使用します。この版が本方針の検証済み下限です。
rootの`pnpm-workspace.yaml`を追跡し、次を設定してください。

```yaml
minimumReleaseAge: 10080 # 分単位。7日
minimumReleaseAgeStrict: true
minimumReleaseAgeIgnoreMissingTime: false
```

14日など、より長い待機も認めます。対応するpnpmでは待機期間を明示するとstrictが既定に
なるため、`minimumReleaseAgeStrict`の省略も認めます。公開日時が分からない依存は
エラーにします。`trustLockfile`は標準の`false`を維持し、frozen installでpnpmによる
lockfileの方針検証を省略しないでください。[pnpmの設定](https://pnpm.io/settings/dependency-resolution#minimumreleaseage)

既存の`pnpm-outputs`が追加生成・最終frozen installの前に方針を検証します。
導入済みの利用先はaction呼び出し・必須ジョブを増やさず、レビュー済みの共通参照を
更新し、上記のpnpm設定を追加します。

mise・Vite+の生成を使わない通常のpnpmプロジェクトでは、Node・pnpmの準備後に
入力なしで`pnpm-outputs`を呼びます。

```yaml
- name: Verify pnpm dependencies
  uses: maya0513/renovate-config/.github/actions/pnpm-outputs@<SHA>
```

`<SHA>`はレビュー済み40桁SHAに置き換え、同じリポジトリの他の部品とそろえます。
通常のPR・push CIで呼び、**このステップを含むジョブをブランチ保護で必須化**してください。
composite action自体が独立したステータス名を作るわけではありません。準備stateがなければ
Mendのpushでも方針とfrozen installの検証だけを行い、生成・indexのreset・stage・公開は
行いません。mise・App認証情報は不要です。mise・Vite+の生成を行う場合は従来どおりstateを
渡し、更新・検証callerの双方で`pnpm-outputs`を使います。生成用入力には準備stateが必要です。
同じcheckout・コミットで準備部品を実行した場合、そのstateの渡し忘れはエラーです。
単独検証は他の準備処理のファイル一覧を作成・消去しません。一つのcheckoutの準備チェーンは
一つのジョブで完結させ、配下の独立したpnpm rootの検証は別ジョブへ分けてください。

frozen installはscriptsを無効化する検証用です。依存のbuild scriptを必要とするアプリでは、
既存のbuild・test用セットアップも維持してください。

検査には`pnpm config list --json`の実効設定を使い、pnpmfileの実行とパッケージ
マネージャーの自動切替を禁止します。環境変数で待機期間を短くした場合、strictを
無効化した場合、公開日時不明を許可した場合、lockfileを無条件に信頼した場合も
エラーです。方針検査のステップは依存をインストールせず、ファイルを変更せず、認証情報を
含む設定内容をログへ出しません。その後、`pnpm-outputs`がscripts・pnpmfileを無効化した
frozen installを実行します。他のコマンドも同じ方針・環境を使い、CLIで制限を弱めないでください。
この検査は、後続CIを意図的に変更するコードに対するsandboxではありません。
実際の依存グラフはpnpmのインストール処理が検証します。Git・URL依存、ローカル・
workspace依存、pnpmのintegrity付き設定依存は、registryの公開日時による保証の対象外です。

## 急ぐセキュリティ修正

Renovateのセキュリティ更新は曜日・待機期間を免除しますが、pnpmの独立した設定は
自動では解除しません。そのため、新しい修正版は例外をレビュー・コミットするまで
artifact生成に失敗する場合があります。

1. 脆弱性情報と必要な修正版を確認します。十分に古い修正版があれば、例外なしで採用します。
2. 新しい修正版を急いで採用する場合、利用先の`pnpm-workspace.yaml`へ
   `パッケージ名@完全バージョン`を1件ずつ追加し、コメントに根拠へのリンクを残します。

   ```yaml
   minimumReleaseAgeExclude:
     # 緊急修正：レビューした脆弱性情報へのリンクを記載する。
     - 'example-lib@1.2.3'
   ```

3. Botへ生成を任せる場合は、例外を先に別のレビュー済みPRでbaseへ反映し、その後で
   Renovate PRのrebase/retryを依頼します。同じPRで手動対応する場合は、例外・lockfile・
   派生宣言・生成物を自分でそろえ、Botへのrebase/retryは依頼せずにPRを完成させます。
4. 最終SHAで方針チェック・frozen install・利用先のテストを通します。利用先が指定する
   待機期間を経過した後に例外を削除します。

人がRenovateブランチへコミットすると、通常のBot更新は停止します。強制再生成はbaseから
更新を作り直すため、PR上だけの例外コミットが失われ得ます。人のpushでは共通の更新用
workflowも実行されません。例外だけをPRへ追加してBotに再生成させる手順は使わないでください。
[Renovateの更新・rebase仕様](https://docs.renovatebot.com/updating-rebasing/)

scope付きパッケージや完全指定のprereleaseも認めます。将来の版まで待機を免除しないよう、
パッケージ全体・wildcard・バージョン範囲の除外はエラーです。例外はその版だけに適用され、
推移依存には波及しません。追加の例外が必要なら個別にレビューしてください。
セキュリティPR全体の待機制限は解除しません。ラベルやブランチ名だけでは承認しません。
CIは例外の範囲を検証し、理由の妥当性はレビューで確認します。
[pnpmのバージョン限定除外](https://pnpm.io/settings/dependency-resolution#minimumreleaseageexclude)

## ロック保守とVite+

共通defaultはロック保守の待機判定を解除しません。`main`追従のpresetとSHA固定のactionは
更新時期が独立しており、共通defaultで免除すると、保護未導入の利用先へ免除だけが先に
配布されるためです。npm・Yarnの保守も自動では免除しません。

pnpm設定と新しい`pnpm-outputs`を含む必須CIを用意した利用先は、同じ移行PRの
`renovate.json`で次を明示できます。既存の`extends`などは維持してください。

```json
{
  "npm": {
    "lockFileMaintenance": {
      "minimumReleaseAge": null
    }
  }
}
```

これはnpm managerのロック保守だけをパッケージマネージャーの検証に委譲します。
npm・Yarnも同じmanagerなので、複数方式を含むリポジトリでは対象すべての保護を確認するか、
`packageRules`の`matchFileNames`などで保護済みファイルへ条件を限定してください。
他のmanagerと通常更新は7日待機を維持します。
Renovateはlockfile内の各依存の公開日時を確認できず、免除しない保守の
`renovate/stability-days`はpendingのままになる場合があります。
[Renovateの説明](https://docs.renovatebot.com/key-concepts/minimum-release-age/#lockfilemaintenance-updates)

pnpmのロック保守も通常更新と同じ待機設定・レビュー済み例外を使います。火曜日は更新の
実施曜日で、公開後の待機期間とは別です。再作成される保守PRを閉じても待機にはなりません。
公開日時がないためにpendingになる状態も、単に7日経過するだけでは解消しません。

Vite+本体が十分に古くても、完全指定された内蔵Vitest・coverage・Vite coreが新しい
場合があります。その場合は選択された版の整合性を維持して待つか、急ぐセキュリティ
修正について個別の例外をレビューします。共通生成部品は整合したグラフを作るために
例外を自動追加したり、待機制限を弱めたりしません。

## 既存利用先の移行

利用先ごとの移行PRで、設定・必要なレビュー済み例外・レビュー済みSHAの`pnpm-outputs`・
CIの必須化をそろえます。その最終SHAの検証成功を確認してから、上記のロック保守免除を
含めてマージします。既存のcallerにaction・ジョブ・state入力の追加は不要です。
独立したpnpmプロジェクトが複数ある場合はrootごとに
検証します。このactionが調べるのは現在のrootで、配下の全プロジェクトではありません。
旧SHAのactionを使う利用先は、設定・CI・参照の移行が終わるまで免除を追加しません。
共通defaultの更新だけでは既存利用先の待機判定は解除されません。

既存lockfileに新しすぎる依存がある場合は、移行PRで意図的に方針に合うグラフを再生成
するか、待機期間の経過を待ちます。通常CIでは修復しません。pnpmの版と生成された
管理情報もそろえます。本リポジトリは`bootstrap`の前に`mise run policy`で自身の設定を
検証し、CIと更新準備でも`pnpm-outputs`を呼びます。本リポジトリ自身の免除は
[`renovate.json`](../renovate.json)で選択しています。他リポジトリへの移行と実CIの確認は、
利用先ごとの別作業として実施します。
