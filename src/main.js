import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const resultVideo = document.querySelector("#result");

// 既存の処理後映像の横に、処理前のカメラ映像を追加
const comparison = document.createElement("div");
comparison.style.cssText =
  "display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);" +
  "gap:8px;width:100%;margin:12px 0;";

function makePanel(title, videoElement) {
  const panel = document.createElement("div");
  panel.style.minWidth = "0";

  const label = document.createElement("div");
  label.textContent = title;
  label.style.cssText =
    "font:14px sans-serif;font-weight:bold;margin-bottom:5px;";

  videoElement.style.width = "100%";
  videoElement.style.maxWidth = "100%";
  videoElement.style.height = "auto";
  videoElement.style.background = "#111";
  videoElement.style.objectFit = "contain";

  panel.append(label, videoElement);
  return panel;
}

const rawVideo = document.createElement("video");
rawVideo.autoplay = true;
rawVideo.muted = true;
rawVideo.playsInline = true;
rawVideo.setAttribute("muted", "");
rawVideo.setAttribute("playsinline", "");

resultVideo.autoplay = true;
resultVideo.muted = true;
resultVideo.playsInline = true;
resultVideo.setAttribute("muted", "");
resultVideo.setAttribute("playsinline", "");

resultVideo.insertAdjacentElement("beforebegin", comparison);
comparison.append(
  makePanel("カメラの元映像", rawVideo),
  makePanel("処理後の映像", resultVideo)
);

const diagnostics = document.createElement("div");
diagnostics.style.cssText =
  "margin:12px 0;padding:12px;background:#222;color:#fff;" +
  "font:14px/1.6 sans-serif;white-space:pre-line;border-radius:8px";
comparison.insertAdjacentElement("afterend", diagnostics);

let camera = null;
let connection = null;
let timer = null;
let rawCallbackId = null;
let resultCallbackId = null;
let rawFrames = 0;
let resultFrames = 0;
let cameraInfo = "未取得";
let outputSize = "未取得";

function showDiagnostics(rawFps = "計測中", resultFps = "計測中") {
  diagnostics.textContent =
    `カメラ取得解像度: ${cameraInfo}\n` +
    `処理後の表示解像度: ${outputSize}\n` +
    `元映像の表示: ${rawFps}\n` +
    `処理後の表示: ${resultFps}`;
}

function watchFrames() {
  if (rawVideo.requestVideoFrameCallback) {
    const countRaw = () => {
      rawFrames += 1;
      rawCallbackId = rawVideo.requestVideoFrameCallback(countRaw);
    };
    rawCallbackId = rawVideo.requestVideoFrameCallback(countRaw);
  }

  if (resultVideo.requestVideoFrameCallback) {
    const countResult = () => {
      resultFrames += 1;
      resultCallbackId = resultVideo.requestVideoFrameCallback(countResult);
    };
    resultCallbackId = resultVideo.requestVideoFrameCallback(countResult);
  }

  timer = setInterval(() => {
    if (resultVideo.videoWidth && resultVideo.videoHeight) {
      outputSize = `${resultVideo.videoWidth}×${resultVideo.videoHeight}`;
    }

    showDiagnostics(
      rawVideo.requestVideoFrameCallback
        ? `${rawFrames} fps（直近1秒）`
        : "このブラウザでは計測不可",
      resultVideo.requestVideoFrameCallback
        ? `${resultFrames} fps（直近1秒）`
        : "このブラウザでは計測不可"
    );

    rawFrames = 0;
    resultFrames = 0;
  }, 1000);
}

function stopDiagnostics() {
  if (timer !== null) clearInterval(timer);
  if (rawCallbackId !== null && rawVideo.cancelVideoFrameCallback) {
    rawVideo.cancelVideoFrameCallback(rawCallbackId);
  }
  if (resultCallbackId !== null && resultVideo.cancelVideoFrameCallback) {
    resultVideo.cancelVideoFrameCallback(resultCallbackId);
  }

  timer = null;
  rawCallbackId = null;
  resultCallbackId = null;
  rawFrames = 0;
  resultFrames = 0;
}

async function stopCamera() {
  stopDiagnostics();

  try {
    await connection?.cleanup();
  } catch (error) {
    console.warn("WebRTC cleanup failed:", error);
  }

  camera?.getTracks?.().forEach(track => track.stop());
  rawVideo.pause();
  resultVideo.pause();
  rawVideo.srcObject = null;
  resultVideo.srcObject = null;

  camera = null;
  connection = null;
  startButton.disabled = false;
  stopButton.disabled = true;
}

showDiagnostics();

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "カメラに接続中…";
  cameraInfo = "取得中";
  outputSize = "未取得";
  showDiagnostics();

  try {
    camera = await streams.useCamera({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

    const settings = camera.getVideoTracks()[0]?.getSettings?.();
    cameraInfo = settings?.width && settings?.height
      ? `${settings.width}×${settings.height}` +
        (settings.frameRate ? `（設定 ${settings.frameRate} fps）` : "")
      : "ブラウザから取得できません";

    rawVideo.srcObject = camera;
    await rawVideo.play();
    status.textContent = "カメラ取得済み・映像接続中…";

    connection = await webrtc.useStream({
      source: camera,
      connector: connectors.withProxyUrl("/api/init-webrtc"),
      wrtcParams: {
        workspaceName: "s-workspace-ur3p4",
        workflowId: "7-v7-o4c38-2-rfdetr-small-t1-logic",
        imageInputName: "image",
        streamOutputNames: ["output_image"],
        dataOutputNames: [
          "diameter_mm",
          "mikan_count",
          "measurement_status"
        ]
      },
      onData: data => console.log("Workflow output:", data)
    });

    resultVideo.srcObject = await connection.remoteStream();
    await resultVideo.play();
    watchFrames();

    stopButton.disabled = false;
    status.textContent = "処理中：元映像と処理後の映像を比較できます";
  } catch (error) {
    const stage = camera?.getVideoTracks?.()[0]?.readyState === "live"
      ? "カメラ取得後の映像接続"
      : "カメラ取得";

    console.error(error);
    await stopCamera();
    status.textContent = `接続できませんでした（${stage}）: ${error.message}`;
    showDiagnostics("接続できませんでした", "接続できませんでした");
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  await stopCamera();
  status.textContent = "停止しました";
  showDiagnostics("停止中", "停止中");
});


