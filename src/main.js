import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const video = document.querySelector("#result");

// 診断表示を映像の下に追加
const diagnostics = document.createElement("div");
diagnostics.style.cssText =
  "margin:12px 0;padding:12px;background:#222;color:#fff;" +
  "font:14px/1.6 sans-serif;white-space:pre-line;border-radius:8px";
video.insertAdjacentElement("afterend", diagnostics);

let camera = null;
let connection = null;
let timer = null;
let frameCallbackId = null;
let displayedFrames = 0;
let cameraInfo = "未取得";
let outputSize = "未取得";

function updateDiagnostics(fps = "計測中") {
  diagnostics.textContent =
    `カメラ取得解像度: ${cameraInfo}\n` +
    `処理後の表示解像度: ${outputSize}\n` +
    `処理後の表示フレーム数: ${fps}`;
}

function stopDiagnostics() {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  if (frameCallbackId !== null && video.cancelVideoFrameCallback) {
    video.cancelVideoFrameCallback(frameCallbackId);
    frameCallbackId = null;
  }
  displayedFrames = 0;
}

function watchFrames() {
  // 対応ブラウザでは、実際に表示された処理後フレームを数える
  if (!video.requestVideoFrameCallback) {
    updateDiagnostics("このブラウザでは計測できません");
    return;
  }

  const countFrame = () => {
    displayedFrames += 1;
    frameCallbackId = video.requestVideoFrameCallback(countFrame);
  };
  frameCallbackId = video.requestVideoFrameCallback(countFrame);

  timer = setInterval(() => {
    if (video.videoWidth && video.videoHeight) {
      outputSize = `${video.videoWidth}×${video.videoHeight}`;
    }
    updateDiagnostics(`${displayedFrames} fps（直近1秒）`);
    displayedFrames = 0;
  }, 1000);
}

async function stopCamera() {
  stopDiagnostics();

  try {
    await connection?.cleanup();
  } catch (error) {
    console.warn("WebRTC cleanup failed:", error);
  }

  camera?.getTracks?.().forEach(track => track.stop());
  video.pause();
  video.srcObject = null;
  connection = null;
  camera = null;
  startButton.disabled = false;
  stopButton.disabled = true;
}

updateDiagnostics();

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "カメラに接続中…";
  cameraInfo = "取得中";
  outputSize = "未取得";
  updateDiagnostics();

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
    updateDiagnostics();

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

    video.srcObject = await connection.remoteStream();
    video.muted = true;
    video.playsInline = true;
    await video.play();

    if (video.videoWidth && video.videoHeight) {
      outputSize = `${video.videoWidth}×${video.videoHeight}`;
    }
    watchFrames();

    stopButton.disabled = false;
    status.textContent = "処理中：映像に検出枠と直径を表示します";
  } catch (error) {
    const stage = camera?.getVideoTracks?.()[0]?.readyState === "live"
      ? "カメラ取得後の映像接続"
      : "カメラ取得";

    console.error(error);
    await stopCamera();
    status.textContent = `接続できませんでした（${stage}）: ${error.message}`;
    updateDiagnostics("接続できませんでした");
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  await stopCamera();
  status.textContent = "停止しました";
  updateDiagnostics("停止中");
});

