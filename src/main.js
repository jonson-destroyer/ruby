import { InferenceEngine, CVImage } from "inferencejs";
import { ROBOFLOW_CONFIG, THINNING_CONFIG, INFERENCE_INTERVAL_MS, CALIBRATION_MARKER_MM } from "./config.js";
import { clusterFruits, decideThinning } from "./cluster.js";
import "./style.css";

const els = {
  video: document.getElementById("video"),
  canvas: document.getElementById("overlay"),
  startBtn: document.getElementById("start"),
  stopBtn: document.getElementById("stop"),
  calibrateBtn: document.getElementById("calibrate"),
  saveBtn: document.getElementById("save"),
  exportBtn: document.getElementById("export"),
  status: document.getElementById("status"),
  calibStatus: document.getElementById("calib-status"),
  statTotal: document.getElementById("stat-total"),
  statClusters: document.getElementById("stat-clusters"),
  statThin: document.getElementById("stat-thin"),
  statAvg: document.getElementById("stat-avg"),
  log: document.getElementById("log"),
};

const ctx = els.canvas.getContext("2d");

let stream = null;
let inferEngine = null;
let workerId = null;
let loopTimer = null;
let running = false;

let pxPerMm = Number(localStorage.getItem("mikan_pxPerMm")) || null;
let calibrating = false;
let calibPoints = [];

let lastResult = null; // 直近の検出結果(保存ボタン用)

updateCalibStatus();
renderSavedLog();

els.startBtn.addEventListener("click", startCamera);
els.stopBtn.addEventListener("click", stopCamera);
els.calibrateBtn.addEventListener("click", toggleCalibration);
els.saveBtn.addEventListener("click", saveCurrentReading);
els.exportBtn.addEventListener("click", exportCsv);
els.canvas.addEventListener("click", onCanvasClick);

async function startCamera() {
  try {
    els.status.textContent = "カメラを起動中...";
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
    els.video.srcObject = stream;
    await els.video.play();

    els.canvas.width = els.video.videoWidth;
    els.canvas.height = els.video.videoHeight;

    if (!inferEngine) {
      els.status.textContent = "モデルを読み込み中(初回はネット接続が必要です)...";
      inferEngine = new InferenceEngine();
      workerId = await inferEngine.startWorker(
        ROBOFLOW_CONFIG.projectSlug,
        ROBOFLOW_CONFIG.version,
        ROBOFLOW_CONFIG.publishableKey
      );
    }

    running = true;
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
    els.status.textContent = "検出中";
    loop();
  } catch (err) {
    console.error(err);
    els.status.textContent = "カメラまたはモデルの起動に失敗しました: " + err.message;
  }
}

function stopCamera() {
  running = false;
  clearTimeout(loopTimer);
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  els.startBtn.disabled = false;
  els.stopBtn.disabled = true;
  els.status.textContent = "停止しました";
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
}

async function loop() {
  if (!running) return;
  try {
    await detectAndDraw();
  } catch (err) {
    console.error(err);
  }
  loopTimer = setTimeout(loop, INFERENCE_INTERVAL_MS);
}

async function detectAndDraw() {
  const img = new CVImage(els.video);
  const predictions = await inferEngine.infer(workerId, img);

  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);

  const fruits = predictions
    .filter((p) => (p.confidence ?? 0) >= ROBOFLOW_CONFIG.minConfidence)
    .map((p) => {
      // inferencejsのbboxは中心座標(x, y)+ width/height。
      // モデルによって仕様が異なる場合は、ここを実際の出力に合わせて調整してください。
      const cx = p.bbox.x;
      const cy = p.bbox.y;
      const diameterPx = (p.bbox.width + p.bbox.height) / 2;
      return {
        cx,
        cy,
        width: p.bbox.width,
        height: p.bbox.height,
        diameterMm: pxPerMm ? diameterPx / pxPerMm : null,
        confidence: p.confidence,
      };
    });

  let annotated = fruits.map((f) => ({ ...f, action: "keep", clusterIndex: 0, clusterSize: 1 }));
  let clusterSummaries = [{ clusterIndex: 0, size: fruits.length, thinnedCount: 0 }];

  if (pxPerMm) {
    const clusters = clusterFruits(fruits, pxPerMm, THINNING_CONFIG.clusterDistanceMm);
    const decision = decideThinning(clusters);
    annotated = decision.annotated;
    clusterSummaries = decision.clusterSummaries;
  }

  drawDetections(annotated);
  updateStats(annotated, clusterSummaries);
  lastResult = { annotated, clusterSummaries, timestamp: Date.now() };

  if (calibrating) drawCalibrationOverlay();
}

function drawDetections(annotated) {
  annotated.forEach((f) => {
    const x = f.cx - f.width / 2;
    const y = f.cy - f.height / 2;
    const isThin = f.action === "thin";
    ctx.lineWidth = 3;
    ctx.strokeStyle = isThin ? "#e0483e" : "#3f8f4f";
    ctx.strokeRect(x, y, f.width, f.height);

    const label = f.diameterMm ? `${f.diameterMm.toFixed(0)}mm` : "未校正";
    ctx.font = "16px sans-serif";
    ctx.fillStyle = isThin ? "#e0483e" : "#3f8f4f";
    const textY = y > 18 ? y - 6 : y + f.height + 18;
    ctx.fillText(label + (isThin ? " 摘果候補" : ""), x, textY);
  });
}

function updateStats(annotated, clusterSummaries) {
  const total = annotated.length;
  const thin = annotated.filter((f) => f.action === "thin").length;
  const withDiameter = annotated.filter((f) => f.diameterMm != null);
  const avg =
    withDiameter.length > 0
      ? (withDiameter.reduce((s, f) => s + f.diameterMm, 0) / withDiameter.length).toFixed(0)
      : "-";

  els.statTotal.textContent = total;
  els.statClusters.textContent = clusterSummaries.length;
  els.statThin.textContent = thin;
  els.statAvg.textContent = avg === "-" ? "-" : `${avg}mm`;
}

// ---- 校正(20mmマーカー) ----

function toggleCalibration() {
  calibrating = !calibrating;
  calibPoints = [];
  els.calibrateBtn.textContent = calibrating ? "校正中(2点タップ)" : "校正する";
  els.calibrateBtn.classList.toggle("active", calibrating);
}

function onCanvasClick(evt) {
  if (!calibrating) return;
  const rect = els.canvas.getBoundingClientRect();
  const scaleX = els.canvas.width / rect.width;
  const scaleY = els.canvas.height / rect.height;
  const x = (evt.clientX - rect.left) * scaleX;
  const y = (evt.clientY - rect.top) * scaleY;
  calibPoints.push({ x, y });

  if (calibPoints.length === 2) {
    const dist = Math.hypot(calibPoints[1].x - calibPoints[0].x, calibPoints[1].y - calibPoints[0].y);
    pxPerMm = dist / CALIBRATION_MARKER_MM;
    localStorage.setItem("mikan_pxPerMm", String(pxPerMm));
    calibrating = false;
    els.calibrateBtn.textContent = "校正する";
    els.calibrateBtn.classList.remove("active");
    updateCalibStatus();
  }
}

function drawCalibrationOverlay() {
  ctx.fillStyle = "#2f7cff";
  calibPoints.forEach((p) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  if (calibPoints.length === 1) {
    ctx.font = "16px sans-serif";
    ctx.fillText("マーカーのもう一方の端をタップ", 10, 24);
  }
}

function updateCalibStatus() {
  els.calibStatus.textContent = pxPerMm
    ? `校正済み(1mm = ${pxPerMm.toFixed(2)}px)`
    : `未校正:20mmのマーカーを実と同じ奥行きに置き「校正する」→マーカーの両端を2回タップ`;
}

// ---- 記録・書き出し(オフラインでlocalStorageに保存) ----

function saveCurrentReading() {
  if (!lastResult) return;
  const key = "mikan_log";
  const log = JSON.parse(localStorage.getItem(key) || "[]");
  const summary = {
    timestamp: lastResult.timestamp,
    total: lastResult.annotated.length,
    clusters: lastResult.clusterSummaries.length,
    thinCandidates: lastResult.annotated.filter((f) => f.action === "thin").length,
  };
  log.push(summary);
  localStorage.setItem(key, JSON.stringify(log));
  renderSavedLog();
}

function renderSavedLog() {
  const log = JSON.parse(localStorage.getItem("mikan_log") || "[]");
  els.log.innerHTML = "";
  log
    .slice()
    .reverse()
    .forEach((row) => {
      const li = document.createElement("li");
      const d = new Date(row.timestamp);
      li.textContent = `${d.toLocaleString()} — 総数${row.total} / 房${row.clusters} / 摘果候補${row.thinCandidates}`;
      els.log.appendChild(li);
    });
}

function exportCsv() {
  const log = JSON.parse(localStorage.getItem("mikan_log") || "[]");
  const header = "日時,総数,房数,摘果候補数\n";
  const rows = log
    .map((r) => `${new Date(r.timestamp).toISOString()},${r.total},${r.clusters},${r.thinCandidates}`)
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mikan_log.csv";
  a.click();
  URL.revokeObjectURL(url);
}

