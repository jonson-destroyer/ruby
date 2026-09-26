import { connectors, webrtc, streams } from "@roboflow/inference-sdk";

const startButton = document.querySelector("#start");
const stopButton = document.querySelector("#stop");
const status = document.querySelector("#status");
const video = document.querySelector("#result");

let camera = null;
let connection = null;

async function stopCamera() {
  await connection?.cleanup();
  camera?.getTracks?.().forEach(track => track.stop());
  video.srcObject = null;
  connection = null;
  camera = null;
  startButton.disabled = false;
  stopButton.disabled = true;
}

startButton.addEventListener("click", async () => {
  startButton.disabled = true;
  status.textContent = "カメラに接続中…";

  try {
    camera = await streams.useCamera({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });

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
    await video.play();
    stopButton.disabled = false;
    status.textContent = "処理中：映像に検出枠と直径を表示します";
  } catch (error) {
    const stage = camera?.getVideoTracks?.()[0]?.readyState === "live"
      ? "カメラ取得後の映像接続"
      : "カメラ取得";

    console.error(error);
    await stopCamera();
    status.textContent = `接続できませんでした（${stage}）: ${error.message}`;
  }
});

stopButton.addEventListener("click", async () => {
  stopButton.disabled = true;
  try {
    await stopCamera();
    status.textContent = "停止しました";
  } catch (error) {
    console.error(error);
    status.textContent = `停止時にエラーが出ました: ${error.message}`;
    startButton.disabled = false;
  }
});
