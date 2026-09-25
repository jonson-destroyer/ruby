import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { InferenceHTTPClient } from "@roboflow/inference-sdk/api";

const app = express();
const directory = path.dirname(fileURLToPath(import.meta.url));

for (const name of ["ROBOFLOW_API_KEY", "APP_USER", "APP_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

// 試験用：ページと接続開始APIをパスワードで保護
app.use((req, res, next) => {
  const expected = Buffer.from(
    `${process.env.APP_USER}:${process.env.APP_PASSWORD}`
  );
  const encoded = req.headers.authorization?.match(/^Basic (.+)$/)?.[1];
  const supplied = Buffer.from(encoded || "", "base64");

  if (
    supplied.length !== expected.length ||
    !crypto.timingSafeEqual(supplied, expected)
  ) {
    res.set("WWW-Authenticate", 'Basic realm="Mikan Camera"');
    return res.status(401).send("Login required");
  }
  next();
});

app.use(express.json({ limit: "1mb" }));

const client = InferenceHTTPClient.init({
  apiKey: process.env.ROBOFLOW_API_KEY
});

app.post("/api/init-webrtc", async (req, res) => {
  try {
    const { offer } = req.body;
    if (!offer) return res.status(400).json({ error: "Missing offer" });

    const answer = await client.initializeWebrtcWorker({
      offer,
      workspaceName: "s-workspace-ur3p4",
      workflowId: "7-v7-o4c38-2-rfdetr-small-t1-logic",
      config: {
        imageInputName: "image",
        streamOutputNames: ["output_image"],
        dataOutputNames: [
          "diameter_mm",
          "mikan_count",
          "measurement_status"
        ]
      }
    });

    res.json(answer);
  } catch (error) {
    console.error("WebRTC initialization failed:", error);
    res.status(502).json({ error: "Could not start camera inference" });
  }
});

app.use(express.static(path.join(directory, "dist")));
app.listen(process.env.PORT || 3000, "0.0.0.0");
