import { InferenceEngine, CVImage } from "inferencejs";

const MODEL_ID = "s-workspace-ur3p4/7-o4c38-2-rfdetr-small-t1";

// 公開用キー。秘密の ROBOFLOW_API_KEY ではありません。
// この形式はWorkspace IDから定まる公開用キーです。
const PUBLISHABLE_KEY = "rf_JJ3iUSebSnMk99xBB36VpEAuSOu1";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const oldResult = document.querySelector("#result");

// 古いクラウド処理後映像は使わない。
oldResult.style.display = "none";
startButton.textContent = "端末内測定を開始";

const stage = document.createElement("div");
stage.style.cssText =
  "position:relative;width:100%;max-width:700px;margin:12px 0;" +
  "background:#111;overflow:hidden";

const video = document.createElement("video");
video.autoplay = true;
video.muted = true;
video.playsInline = true;
video.setAttribute("muted", "");
video.setAttribute("playsinline", "");
video.style.cssText = "display:block;width:100%;height:auto";

const overlay = document.createElement("canvas");
overlay.style.cssText =
  "position:absolute;inset:0;width:100%;height:100%;" +
  "pointer-events:none";

stage.append(video, overlay);
oldResult.insertAdjacentElement("beforebegin", stage);

const info = document.createElement("div");
info.style.cssText =
  "max-width:700px;padding:12px;background:#22332a;color:white;" +
  "font:15px/1.6 sans-serif;white-space:pre-line;border-radius:8px";
stage.insertAdjacentElement("afterend", info);

const ctx = overlay.getContext("2d");
const engine = new InferenceEngine();

let workerId = null;
let camera = null;
let active = false;
let generation = 0;
let nextTimer = null;

function waitForVideo(videoElement) {
  if (videoElement.videoWidth && videoElement.videoHeight) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("カメラ映像の準備がタイムアウトしました"));
    }, 10000);

    function cleanup() {
      clearTimeout(timer);
      videoElement.removeEventListener("loadedmetadata", ready);
    }

    function ready() {
      cleanup();
      resolve();
    }

    videoElement.addEventListener("loadedmetadata", ready);
  });
}

function resizeOverlay(width, height) {
  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
}

function normalizePrediction(prediction) {
  const cls = String(
    prediction?.class ?? prediction?.class_name ?? ""
  ).toLowerCase();

  // inferencejsのbbox形式を優先。座標は後で実機画像と照合する。
  const box = prediction?.bbox;
  if (!box) return null;

  const x = Number(box.x);
  const y = Number(box.y);
  const width = Number(box.width);
  const height = Number(box.height);

  if (
    !["mikan", "marker"].includes(cls) ||
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }

  return {
    cls,
    x1: x,
    y1: y,
    x2: x + width,
    y2: y + height,
    width,
    height
  };
}

function gap(a, b) {
  return Math.hypot(
    Math.max(b.x1 - a.x2, a.x1 - b.x2, 0),
    Math.max(b.y1 - a.y2, a.y1 - b.y2, 0)
  );
}

function drawBox(box, color, lineWidth) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.strokeRect(box.x1, box.y1, box.width, box.height);
}

function showDetections(predictions, width, height) {
  resizeOverlay(width, height);
  ctx.clearRect(0, 0, width, height);

  const boxes = predictions
    .map(normalizePrediction)
    .filter(Boolean);

  const fruit = boxes.filter(box => box.cls === "mikan");
  const markers = boxes.filter(box => box.cls === "marker");

  for (const box of fruit) drawBox(box, "#19e053", 3);
  for (const box of markers) drawBox(box, "#ff45d4", 4);

  let diameter = null;
  let message = "測定できません（実と20 mmマーカーを映してください）";

  if (fruit.length && markers.length) {
    // 既存Workflowと同じく、最も大きく写るマーカーを基準にする。
    const marker = markers.reduce((largest, box) =>
      box.width * box.height > largest.width * largest.height
        ? box
        : largest
    );

    const markerPx = Math.sqrt(marker.width * marker.height);
    const candidates = fruit.filter(box =>
      Math.min(box.width, box.height) >= 0.45 * markerPx
    );

    if (markerPx > 0 && candidates.length) {
      candidates.sort((a, b) => {
        const distance = gap(a, marker) - gap(b, marker);
        if (distance !== 0) return distance;

        const centerDistance = box => Math.hypot(
          (box.x1 + box.x2 - marker.x1 - marker.x2) / 2,
          (box.y1 + box.y2 - marker.y1 - marker.y2) / 2
        );
        return centerDistance(a) - centerDistance(b);
      });

      const measured = candidates[0];
      const fruitPx = (measured.width + measured.height) / 2;
      diameter = 20 * fruitPx / markerPx;
      drawBox(measured, "#ff9b22", 6);
      message = `約${diameter.toFixed(1)} mm`;
    } else {
      message = "測定できません（近くに測定に適した実がありません）";
    }
  }

  info.textContent =
    `端末内測定・現在の画面内のみかん検出数: ${fruit.length}\n` +
    `20 mmマーカー基準の推定直径: ${message}\n` +
    "実とマーカーがほぼ同じ奥行きにある場合の推定値です。";
}

async function measureLoop(runId) {
  if (!active || runId !== generation) return;

  let bitmap = null;
  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error("カメラの映像サイズを取得できません");
    }

    // 取得した「同じ1フレーム」で推論と座標表示を行う。
    const capture = document.createElement("canvas");
    capture.width = width;
    capture.height = height;
    capture.getContext("2d").drawImage(video, 0, 0, width, height);

    bitmap = await createImageBitmap(capture);
    const result = await engine.infer(workerId, new CVImage(bitmap));

    if (!active || runId !== generation) return;

    // 未確認の応答を「検出0個」と誤表示しない。
    const predictions = Array.isArray(result)
      ? result
      : Array.isArray(result?.predictions)
        ? result.predictions
        : null;

    if (!predictions) {
      throw new Error("モデルの予測形式を確認できません");
    }
    if (
      predictions.length > 0 &&
      !predictions.some(prediction => prediction?.bbox)
    ) {
      throw new Error("検出枠の形式を確認できません");
    }

    showDetections(predictions, width, height);
    status.textContent = "スマホ内で測定中（クラウド推論なし）";
  } catch (error) {
    if (active && runId === generation) {
      console.error("On-device inference failed:", error);
      info.textContent = `端末内測定エラー: ${error.message}`;
      status.textContent = "端末内測定を停止しました";
      await stop();
      return;
    }
  } finally {
    bitmap?.close?.();
  }

  if (active && runId === generation) {
    // 推論が終わってから次を開始。重複実行しない。
    nextTimer = setTimeout(() => measureLoop(runId), 700);
  }
}

async function stop() {
  active = false;
  generation++;
  if (nextTimer !== null) clearTimeout(nextTimer);
  nextTimer = null;

  camera?.getTracks?.().forEach(track => track.stop());
  camera = null;

  video.pause();
  video.srcObject = null;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  startButton.disabled = false;
  stopButton.disabled = true;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "端末内モデルを読み込み中…";
  info.textContent =
    "初回はモデルのダウンロードに通信が必要です。推論画像はクラウドへ送りません。";

  const runId = ++generation;

  try {
    if (workerId === null) {
      workerId = await engine.startWorkerByModelId(
        MODEL_ID,
        PUBLISHABLE_KEY
      );
    }
    if (runId !== generation) return;

    status.textContent = "カメラを準備中…";
    camera = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = camera;
    await video.play();
    await waitForVideo(video);

    if (runId !== generation) return;

    active = true;
    stopButton.disabled = false;
    status.textContent = "スマホ内で測定中（クラウド推論なし）";
    measureLoop(runId);
  } catch (error) {
    console.error("On-device setup failed:", error);
    info.textContent = `端末内測定を開始できません: ${error.message}`;
    await stop();
    status.textContent = "端末内測定を開始できませんでした";
  }
});

stopButton.addEventListener("click", async () => {
  await stop();
  status.textContent = "停止しました";
  info.textContent = "端末内測定は停止中です";
});

info.textContent =
  "端末内測定を開始してください。クラウド推論はこの画面から呼びません。";




