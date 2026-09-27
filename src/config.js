// ここだけ書き換えれば動きます。
// Roboflowのプロジェクト画面 → 右上「... 」→「API Docs」または
// プロジェクト設定 → API Keys で確認できます。
// URLが https://universe.roboflow.com/<workspace>/<PROJECT_SLUG>/model/<VERSION>
// のような形なら、PROJECT_SLUG と VERSION をそこから取ります。

export const ROBOFLOW_CONFIG = {
  // 例: "mikan-detection-abcde"
  projectSlug: "YOUR_PROJECT_SLUG",
  // 例: 1, 2, 3...(モデルのバージョン番号)
  version: 1,
  // Roboflow > Project Settings > API Keys の "Publishable Key"(rf_ から始まる)
  publishableKey: "YOUR_PUBLISHABLE_KEY",
  // 検出結果のうち、この confidence 未満は無視する(0〜1)
  minConfidence: 0.5,
};

// 摘果(間引き)の判定ロジック設定
export const THINNING_CONFIG = {
  // この距離(mm)より近い実同士は「同じ房(クラスタ)」とみなす。
  // 実際の木の様子を見ながら調整してください。
  clusterDistanceMm: 60,
};

// 推論を実行する間隔(ミリ秒)。数値を大きくすると端末の負荷が下がるが反応が遅くなる。
export const INFERENCE_INTERVAL_MS = 350;

// 校正マーカーの直径(mm)。20mmの円形シール/コインなどを画面内に置いて使う。
export const CALIBRATION_MARKER_MM = 20;
