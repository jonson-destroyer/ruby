import { InferenceEngine, CVImage } from "inferencejs";

const VERSION = "診断版 2026-09-27-2";
const MODEL_ID = "s-workspace-ur3p4/7-o4c38-2-rfdetr-small-t1";

// 公開用キー。秘密の ROBOFLOW_API_KEY はここに置かない。
const PUBLISHABLE_KEY = "rf_JJ3iUSebSnMk99xBB36VpEAuSOu1";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const oldResult = document.querySelector("#result");

oldResult.style.display = "none";
startButton.textContent = "端末内測定を開始";
stopButton.disabled = true;

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
  "position:absolute;inset:0;width:100%;height:100%;pointer-events:none";

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
let completedInferences = 0;
let progressMessage = "開始待ち";
let measurementMessage = "まだ推論は完了していません。";

function renderInfo() {
  info.textContent =
    `${VERSION}\n` +
    `進行状況: ${progressMessage}\n` +
    `完了した推論: ${completedInferences}回\n` +
    measurementMessage;
}

function progress(text) {
  progressMessage = text;
  renderInfo();
}

function withTimeout(promise, milliseconds, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label}が${Math.round(milliseconds / 1000)}秒以内に完了しませんでした`)),
        milliseconds
      );
    })
  ]).finally(() => clearTimeout(timer));
}

function errorText(error) {
  return error instanceof Error
    ? `${error.name}: ${error.message}`
    : String(error);
}

function waitForVideo(element) {
  if (element.videoWidth && element.videoHeight) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("カメラ映像の準備がタイムアウトしました"));
    }, 10000);

    function cleanup() {
      clearTimeout(timer);
      element.removeEventListener("loadedmetadata", ready);
    }

    function ready() {
      cleanup();
      resolve();
    }

    element.addEventListener("loadedmetadata", ready);
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

  const boxes = predictions.map(normalizePrediction).filter(Boolean);
  const fruit = boxes.filter(box => box.cls === "mikan");
  const markers = boxes.filter(box => box.cls === "marker");

  for (const box of fruit) drawBox(box, "#19e053", 3);
  for (const box of markers) drawBox(box, "#ff45d4", 4);

  let message = "測定できません（実と20 mmマーカーを映してください）";

  if (fruit.length && markers.length) {
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
      const diameter = 20 * fruitPx / markerPx;
      drawBox(measured, "#ff9b22", 6);
      message = `約${diameter.toFixed(1)} mm`;
    } else {
      message = "測定できません（近くに測定に適した実がありません）";
    }
  }

  measurementMessage =
    `現在の画面内のみかん検出数: ${fruit.length}\n` +
    `20 mmマーカー基準の推定直径: ${message}\n` +
    "実とマーカーがほぼ同じ奥行きにある場合の推定値です。";
  renderInfo();
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

async function measureLoop(runId) {
  if (!active || runId !== generation) return;

  let bitmap = null;

  try {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error("カメラの映像サイズを取得できません");
    }

    progress("カメラ画像を取得中");

    const capture = document.createElement("canvas");
    capture.width = width;
    capture.height = height;
    capture.getContext("2d").drawImage(video, 0, 0, width, height);

    bitmap = await createImageBitmap(capture);
    progress("端末内で推論中");

    const result = await withTimeout(
      engine.infer(workerId, new CVImage(bitmap)),
      45000,
      "推論"
    );

    if (!active || runId !== generation) return;

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

    completedInferences++;
    showDetections(predictions, width, height);
    progress("推論完了・次の画像を待機中");
    status.textContent = "スマホ内で測定中（クラウド推論なし）";
  } catch (error) {
    if (active && runId === generation) {
      console.error("On-device inference failed:", error);
      await stop();
      progress(`推論エラー: ${errorText(error)}。再試行する場合はページを開き直してください`);
      status.textContent = "端末内測定を停止しました";
    }
    return;
  } finally {
    bitmap?.close?.();
  }

  if (active && runId === generation) {
    nextTimer = setTimeout(() => measureLoop(runId), 700);
  }
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  completedInferences = 0;
  measurementMessage = "まだ推論は完了していません。";
  progress("モデルを読み込み中");
  status.textContent = "端末内モデルを読み込み中…";

  const runId = ++generation;

  try {
    if (workerId === null) {
      workerId = await withTimeout(
        engine.startWorkerByModelId(MODEL_ID, PUBLISHABLE_KEY),
        120000,
        "モデル読込"
      );
    }
    if (runId !== generation) return;

    progress("モデル読込完了・カメラを準備中");
    status.textContent = "カメラを準備中…";

    camera = await withTimeout(
      navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      }),
      15000,
      "カメラ起動"
    );

    video.srcObject = camera;
    await video.play();
    await waitForVideo(video);

    if (runId !== generation) return;

    active = true;
    stopButton.disabled = false;
    progress("カメラ準備完了・最初の推論を開始");
    status.textContent = "スマホ内で測定中（クラウド推論なし）";
    measureLoop(runId);
  } catch (error) {
    console.error("On-device setup failed:", error);
    await stop();
    progress(`開始エラー: ${errorText(error)}。再試行する場合はページを開き直してください`);
    status.textContent = "端末内測定を開始できませんでした";
  }
});

stopButton.addEventListener("click", async () => {
  await stop();
  progress("停止しました");
  status.textContent = "停止しました";
});

renderInfo();

