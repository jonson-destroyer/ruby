import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const directory = path.dirname(fileURLToPath(import.meta.url));

for (const name of ["ROBOFLOW_API_KEY", "APP_USER", "APP_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`Missing ${name}`);
}

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

app.post("/api/init-webrtc", async (req, res) => {
  try {
    const offer = req.body?.offer;
    if (
      !offer ||
      typeof offer.sdp !== "string" ||
      typeof offer.type !== "string"
    ) {
      return res.status(400).json({ error: "Invalid WebRTC offer" });
    }

    console.log("WebRTC init: request received");

    const response = await fetch(
      "https://serverless.roboflow.com/initialise_webrtc_worker",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: process.env.ROBOFLOW_API_KEY,
          workflow_configuration: {
            type: "WorkflowConfiguration",
            workspace_name: "s-workspace-ur3p4",
            workflow_id: "7-v7-o4c38-2-rfdetr-small-t1-logic",
            image_input_name: "image"
          },
          webrtc_offer: offer,
          stream_output: ["output_image"],
          data_output: [
            "predictions",
            "mikan_count",
            "diameter_mm",
            "measurement_status",
            "measurement_details"
          ]
        })
      }
    );

    const answer = await response.json();
    console.log("WebRTC init: upstream status", response.status);

    if (!response.ok) {
      // 応答本文には接続情報が含まれる可能性があるためログに出さない
      console.error("Roboflow WebRTC HTTP status:", response.status);
      return res.status(502).json({
        error: `Roboflow connection failed (${response.status})`
      });
    }

    res.json(answer);
  } catch (error) {
    console.error("WebRTC initialization failed:", error);
    res.status(502).json({ error: "Could not start camera inference" });
  }
});

app.use(express.static(path.join(directory, "dist")));
app.listen(process.env.PORT || 3000, "0.0.0.0");
