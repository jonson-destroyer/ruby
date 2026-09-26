// HTTPS静止画モード：既存のWebRTC表示には手を加えない
const frameButton = document.createElement("button");
frameButton.type = "button";
frameButton.textContent = "4G/5Gで1枚測定";
frameButton.style.margin = "8px";
stopButton.insertAdjacentElement("afterend", frameButton);

const frameResult = document.createElement("div");
frameResult.style.cssText =
  "margin:12px 0;padding:12px;background:#22332a;color:white;" +
  "font:15px/1.6 sans-serif;white-space:pre-line;border-radius:8px";
frameButton.insertAdjacentElement("afterend", frameResult);

const frameImage = document.createElement("img");
frameImage.alt = "撮影した1枚の測定結果";
frameImage.style.cssText =
  "display:none;width:100%;height:auto;margin:8px 0";
frameResult.insertAdjacentElement("afterend", frameImage);

frameButton.addEventListener("click", async () => {
  frameButton.disabled = true;
  frameResult.textContent = "1枚撮影して測定中…";
  frameImage.style.display = "none";

  try {
    // WebRTC接続中に別の有料推論を重ねない
    if (connection) {
      throw new Error("先に「停止」を押してください");
    }

    if (!camera || camera.getVideoTracks()[0]?.readyState !== "live") {
      camera = await streams.useCamera({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      rawVideo.srcObject = camera;
      await rawVideo.play();
    }

    if (!rawVideo.videoWidth || !rawVideo.videoHeight) {
      throw new Error("カメラ映像の準備ができていません");
    }

    const snapshot = document.createElement("canvas");
    snapshot.width = rawVideo.videoWidth;
    snapshot.height = rawVideo.videoHeight;
    snapshot.getContext("2d").drawImage(rawVideo, 0, 0);

    const jpeg = snapshot.toDataURL("image/jpeg", 0.8).split(",")[1];
    const response = await fetch("/api/infer-frame", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: jpeg })
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `HTTP ${response.status}`);
    }

    const count = Number(result.mikan_count);
    const diameter = Number(result.diameter_mm);
    const measurable =
      result.measurement_status === "estimated_same_depth_required" &&
      Number.isFinite(diameter) &&
      diameter > 0;

    frameResult.textContent =
      `撮影した1枚の結果（ライブ更新ではありません）\n` +
      `画面内のみかん検出数: ${
        Number.isFinite(count) ? count : "取得できません"
      }\n` +
      `20 mmマーカー基準の推定直径: ${
        measurable ? `約${diameter.toFixed(1)} mm` : "測定できません"
      }`;

    const output = result.output_image;
    const value = typeof output === "string" ? output : output?.value;
    if (typeof value === "string" && value.length > 0) {
      frameImage.src = value.startsWith("data:image/")
        ? value
        : `data:image/jpeg;base64,${value}`;
      frameImage.style.display = "block";
    }
  } catch (error) {
    frameResult.textContent = `1枚測定できませんでした: ${error.message}`;
  } finally {
    frameButton.disabled = false;
  }
});




