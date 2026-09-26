import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const processedVideo = document.querySelector("#result");

// 元映像をメイン表示。既存の #result は比較用に残す。
const stage = document.createElement("div");
stage.style.cssText =
  "position:relative;width:100%;margin:12px 0;background:#111;overflow:hidden";

const rawVideo = document.createElement("video");
rawVideo.autoplay = true;
rawVideo.muted = true;
rawVideo.playsInline = true;
rawVideo.setAttribute("muted", "");
rawVideo.setAttribute("playsinline", "");
rawVideo.style.cssText =
  "display:block;width:100%;height:auto;object-fit:contain";

const overlay = document.createElement("canvas");
overlay.style.cssText =
  "position:absolute;inset:0;width:100%;height:100%;" +
  "pointer-events:none";

processedVideo.autoplay = true;
processedVideo.muted = true;
processedVideo.playsInline = true;
processedVideo.setAttribute("muted", "");
processedVideo.setAttribute("playsinline", "");
processedVideo.style.cssText =
  "display:none;width:100%;height:auto;object-fit:contain";

const switchButton = document.createElement("button");
switchButton.type = "button";
switchButton.textContent = "処理後映像に切替";
switchButton.style.margin = "8px 0";
switchButton.disabled = true;

const info = document.createElement("div");
info.style.cssText =
  "margin:8px 0;padding:10px;background:#222;color:white;" +
  "font:14px/1.5 sans-serif;white-space:pre-line;border-radius:8px";

processedVideo.insertAdjacentElement("beforebegin", stage);
stage.append(rawVideo, overlay);
processedVideo.insertAdjacentElement("afterend", switchButton);
switchButton.insertAdjacentElement("afterend", info);

let camera = null;
let connection = null;
let showingProcessed = false;
let latest = null;
let lastResultAt = 0;
let paintTimer = null;
let rawFrames = 0;
let rawFps = 0;
let rawFrameCallback = null;

const ctx = overlay.getContext("2d");

function outputFields(data) {
  // SDKが出力だけを渡す場合と、WebRTCメッセージ全体を渡す場合に対応。
  if (Array.isArray(data)) return data[0] || {};
  return data?.serialized_output_data ?? data ?? {};
}

function predictionList(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.predictions)) return value.predictions;
  if (Array.isArray(value?.model_predictions?.predictions)) {
    return value.model_predictions.predictions;
  }
  return null;
}

function predictionSize(value) {
  const image = value?.image ?? value?.model_predictions?.image;
  return {
    width: Number(image?.width),
    height: Number(image?.height)
  };
}

function setView(processed) {
  showingProcessed = processed;
  stage.style.display = processed ? "none" : "block";
  processedVideo.style.display = processed ? "block" : "none";
  switchButton.textContent = processed
    ? "滑らかな元映像に切替"
    : "処理後映像に切替";
}

function drawBox(p, sx, sy, color, width) {
  const x = Number(p.x);
  const y = Number(p.y);
  const w = Number(p.width);
  const h = Number(p.height);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.strokeRect(
    (x - w / 2) * sx,
    (y - h / 2) * sy,
    w * sx,
    h * sy
  );
}

function paint() {
  const width = rawVideo.videoWidth;
  const height = rawVideo.videoHeight;
  if (!width || !height) return;

  if (overlay.width !== width || overlay.height !== height) {
    overlay.width = width;
    overlay.height = height;
  }
  ctx.clearRect(0, 0, width, height);

  const age = (Date.now() - lastResultAt) / 1000;
  if (!latest || age > 1.5) {
    info.textContent =
      `元映像: ${width}×${height} / 約${rawFps} fps\n` +
      "検出結果: 更新待ち（古い枠は非表示）";
    return;
  }

  const fields = latest;
  const source = fields.predictions;
  const predictions = predictionList(source);
  const size = predictionSize(source);

  const count = Number(fields.mikan_count);
  const diameter = Number(fields.diameter_mm);
  const details = fields.measurement_details;
  const measuredIndex = Number(details?.measured_fruit_index);

  let lines = [
    `元映像: ${width}×${height} / 約${rawFps} fps`,
    `画面内のみかん検出数: ${
      Number.isFinite(count) ? count : "取得待ち"
    }`,
    `推定直径: ${
      fields.measurement_status === "estimated_same_depth_required" &&
      Number.isFinite(diameter) && diameter > 0
        ? `約${diameter.toFixed(1)} mm`
        : "測定できません"
    }`
  ];

  if (!predictions) {
    lines.push("枠: 予測データを取得待ち");
    info.textContent = lines.join("\n");
    return;
  }

  // 座標が元映像と同じ向きのときだけ描く。
  const sameOrientation =
    Number.isFinite(size.width) &&
    Number.isFinite(size.height) &&
    size.width > 0 &&
    size.height > 0 &&
    Math.abs(
      size.width / size.height - width / height
    ) < 0.08;

  if (!sameOrientation) {
    lines.push(
      `枠: 座標の向き・サイズを確認中` +
      (size.width && size.height
        ? `（予測 ${size.width}×${size.height}）`
        : "（予測サイズなし）")
    );
    info.textContent = lines.join("\n");
    return;
  }

  const sx = width / size.width;
  const sy = height / size.height;

  predictions.forEach((p, index) => {
    const cls = String(p.class ?? p.class_name ?? "").toLowerCase();
    if (cls === "marker") {
      drawBox(p, sx, sy, "#ff45d4", 4);
    } else if (cls === "mikan") {
      const measured =
        Number.isInteger(measuredIndex) && index === measuredIndex &&
        fields.measurement_status === "estimated_same_depth_required";
      drawBox(p, sx, sy, measured ? "#ff9b22" : "#19e053",
        measured ? 6 : 3);
    }
  });

  lines.push("枠: 表示中（移動中は遅れて見える場合があります）");
  info.textContent = lines.join("\n");
}

function countRawFrames() {
  if (!rawVideo.requestVideoFrameCallback) return;
  const count = () => {
    rawFrames++;
    rawFrameCallback = rawVideo.requestVideoFrameCallback(count);
  };
  rawFrameCallback = rawVideo.requestVideoFrameCallback(count);
}

function startPainting() {
  countRawFrames();
  paintTimer = setInterval(() => {
    rawFps = rawFrames;
    rawFrames = 0;
    paint();
  }, 200);
}

async function stopCamera() {
  if (paintTimer !== null) clearInterval(paintTimer);
  paintTimer = null;

  if (rawFrameCallback !== null && rawVideo.cancelVideoFrameCallback) {
    rawVideo.cancelVideoFrameCallback(rawFrameCallback);
  }
  rawFrameCallback = null;

  try {
    await connection?.cleanup();
  } catch (error) {
    console.warn("WebRTC cleanup failed:", error);
  }

  camera?.getTracks?.().forEach(track => track.stop());
  rawVideo.pause();
  processedVideo.pause();
  rawVideo.srcObject = null;
  processedVideo.srcObject = null;

  camera = null;
  connection = null;
  latest = null;
  lastResultAt = 0;
  rawFrames = 0;
  rawFps = 0;
  ctx.clearRect(0, 0, overlay.width, overlay.height);

  startButton.disabled = false;
  stopButton.disabled = true;
  switchButton.disabled = true;
  setView(false);
}

switchButton.addEventListener("click", () => {
  setView(!showingProcessed);
});

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "カメラに接続中…";
  info.textContent = "元映像を準備中…";

  try {
    camera = await streams.useCamera({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    rawVideo.srcObject = camera;
    await rawVideo.play();
    startPainting();
    status.textContent = "カメラ取得済み・Roboflowに接続中…";

    connection = await webrtc.useStream({
      source: camera,
      connector: connectors.withProxyUrl("/api/init-webrtc"),
      wrtcParams: {
        workspaceName: "s-workspace-ur3p4",
        workflowId: "7-v7-o4c38-2-rfdetr-small-t1-logic",
        imageInputName: "image",
        streamOutputNames: ["output_image"],
        dataOutputNames: [
          "predictions",
          "mikan_count",
          "diameter_mm",
          "measurement_status",
          "measurement_details"
        ]
      },
      onData: data => {
        const fields = outputFields(data);
        if (!fields || typeof fields !== "object") return;

        // 値が届いたときだけ更新する。空の結果で枠を消さない。
        if (
          !("predictions" in fields) &&
          !("mikan_count" in fields)
        ) return;

        latest = fields;
        lastResultAt = Date.now();
      }
    });

    processedVideo.srcObject = await connection.remoteStream();
    processedVideo.play().catch(() => {
      // iPhoneで非表示動画の自動再生が保留されても元映像は使える。
    });

    switchButton.disabled = false;
    stopButton.disabled = false;
    status.textContent = "処理中：元映像に検出結果を重ねています";
  } catch (error) {
    const stageName = camera?.getVideoTracks?.()[0]?.readyState === "live"
      ? "カメラ取得後の映像接続"
      : "カメラ取得";

    console.error(error);
    await stopCamera();
    status.textContent =
      `接続できませんでした（${stageName}）: ${error.message}`;
    info.textContent = "接続できませんでした";
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  await stopCamera();
  status.textContent = "停止しました";
  info.textContent = "停止中";
});

setView(false);
info.textContent = "開始すると元映像と検出結果を表示します";


