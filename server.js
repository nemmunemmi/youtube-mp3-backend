"use strict";

const express = require("express");
const cors = require("cors");
const ytdl = require("@distube/ytdl-core");
const ffmpegPath = require("ffmpeg-static");
const { spawn } = require("node:child_process");

if (!ffmpegPath) {
  throw new Error("ไม่พบ FFmpeg สำหรับระบบปฏิบัติการนี้");
}

const app = express();
const PORT = Number(process.env.PORT) || 10000;

app.disable("x-powered-by");

app.use(
  cors({
    origin: "*",
    methods: ["GET", "HEAD", "OPTIONS"],
    exposedHeaders: ["Content-Disposition", "Content-Type"],
  })
);

function cleanFilename(title) {
  const cleaned = String(title || "youtube-audio")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f-\u009f<>:"/\\|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[. ]+|[. ]+$/g, "");

  let filename = Array.from(cleaned).slice(0, 120).join("");

  if (!filename) {
    filename = "youtube-audio";
  }

  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename)) {
    filename = `_${filename}`;
  }

  return `${filename}.mp3`;
}

function encodeFilename(filename) {
  return encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    endpoint: "/download?url=YOUR_YOUTUBE_URL",
  });
});

app.get("/download", async (req, res) => {
  const url = req.query.url;

  if (typeof url !== "string" || !url.trim()) {
    return res.status(400).json({
      error: "MISSING_URL",
      message: "กรุณาส่ง Query Parameter 'url' เป็นลิงก์ YouTube",
    });
  }

  const youtubeUrl = url.trim();

  if (!ytdl.validateURL(youtubeUrl)) {
    return res.status(400).json({
      error: "INVALID_URL",
      message: "ลิงก์ YouTube ไม่ถูกต้อง",
    });
  }

  let audioStream;
  let converter;
  let timeout;
  let stopped = false;
  let ffmpegError = "";

  function cleanup() {
    clearTimeout(timeout);

    if (audioStream) {
      audioStream.destroy();
    }

    if (converter) {
      converter.stdout.unpipe(res);
      converter.stdin.destroy();
      converter.stdout.destroy();

      if (converter.exitCode === null && !converter.killed) {
        converter.kill("SIGKILL");
      }
    }
  }

  function fail(error) {
    if (stopped) {
      return;
    }

    stopped = true;

    console.error("Download failed:", error.message);
    cleanup();

    if (res.destroyed || res.writableEnded) {
      return;
    }

    if (res.headersSent) {
      // เมื่อเริ่มส่งไฟล์แล้ว HTTP ไม่สามารถเปลี่ยนกลับเป็น JSON ได้
      res.destroy();
      return;
    }

    res.removeHeader("Content-Disposition");
    res.removeHeader("Content-Type");

    res.status(500).json({
      error: "DOWNLOAD_FAILED",
      message: "ไม่สามารถดาวน์โหลดหรือแปลงเสียงได้",
      reason: error.message || "Unknown error",
    });
  }

  res.on("close", () => {
    stopped = true;
    cleanup();
  });

  res.on("error", fail);

  timeout = setTimeout(() => {
    fail(new Error("คำขอใช้เวลาเกิน 15 นาที"));
  }, 15 * 60 * 1000);

  try {
    const info = await ytdl.getInfo(youtubeUrl);

    if (stopped || res.destroyed) {
      return;
    }

    if (info.videoDetails.isLiveContent) {
      throw new Error("API นี้ไม่รองรับวิดีโอถ่ายทอดสด");
    }

    const filename = cleanFilename(info.videoDetails.title);

    // ใช้ชื่อ ASCII สำรอง และ filename* เพื่อรองรับชื่อเพลงภาษาไทย
    const fallbackFilename =
      filename
        .replace(/[^\x20-\x7e]/g, "")
        .replace(/["\\]/g, "")
        .replace(/\.mp3$/i, "")
        .trim() || "youtube-audio";

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${fallbackFilename}.mp3"; filename*=UTF-8''${encodeFilename(filename)}`
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    converter = spawn(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        "pipe:0",
        "-vn",
        "-c:a",
        "libmp3lame",
        "-b:a",
        "192k",
        "-f",
        "mp3",
        "pipe:1",
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      }
    );

    converter.on("error", fail);

    converter.stdin.on("error", fail);
    converter.stdout.on("error", fail);

    converter.stderr.on("data", (chunk) => {
      ffmpegError = (ffmpegError + chunk.toString()).slice(-4000);
    });

    // ไม่ปิด response จนกว่าจะยืนยันว่า FFmpeg จบโดยไม่มี error
    converter.stdout.pipe(res, { end: false });

    converter.on("close", (code, signal) => {
      if (stopped) {
        return;
      }

      if (code !== 0) {
        console.error("FFmpeg details:", ffmpegError);

        fail(
          new Error(
            `FFmpeg แปลงเสียงไม่สำเร็จ (code: ${code}, signal: ${signal || "none"})`
          )
        );
        return;
      }

      stopped = true;
      clearTimeout(timeout);
      res.end();
    });

    audioStream = ytdl(youtubeUrl, {
      filter: "audioonly",
      quality: "highestaudio",
    });

    audioStream.on("error", fail);

    // YouTube audio → FFmpeg → MP3 → ผู้ใช้
    audioStream.pipe(converter.stdin);
  } catch (error) {
    fail(error);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "NOT_FOUND",
    message: "ไม่พบ API ที่เรียกใช้งาน",
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server listening on port ${PORT}`);
});
