{\rtf1\ansi\ansicpg1252\cocoartf2870
\cocoatextscaling0\cocoaplatform0{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\colortbl;\red255\green255\blue255;}
{\*\expandedcolortbl;;}
\paperw11900\paperh16840\margl1440\margr1440\vieww11520\viewh8400\viewkind0
\pard\tx720\tx1440\tx2160\tx2880\tx3600\tx4320\tx5040\tx5760\tx6480\tx7200\tx7920\tx8640\pardirnatural\partightenfactor0

\f0\fs24 \cf0 "use strict";\
\
const express = require("express");\
const cors = require("cors");\
const ytdl = require("@distube/ytdl-core");\
const ffmpegPath = require("ffmpeg-static");\
const \{ spawn \} = require("node:child_process");\
\
if (!ffmpegPath) \{\
  throw new Error("\uc0\u3652 \u3617 \u3656 \u3614 \u3610  FFmpeg \u3626 \u3635 \u3627 \u3619 \u3633 \u3610 \u3619 \u3632 \u3610 \u3610 \u3611 \u3599 \u3636 \u3610 \u3633 \u3605 \u3636 \u3585 \u3634 \u3619 \u3609 \u3637 \u3657 ");\
\}\
\
const app = express();\
const PORT = Number(process.env.PORT) || 10000;\
\
app.disable("x-powered-by");\
\
app.use(\
  cors(\{\
    origin: "*",\
    methods: ["GET", "HEAD", "OPTIONS"],\
    exposedHeaders: ["Content-Disposition", "Content-Type"],\
  \})\
);\
\
function cleanFilename(title) \{\
  const cleaned = String(title || "youtube-audio")\
    .normalize("NFC")\
    .replace(/[\\u0000-\\u001f\\u007f-\\u009f<>:"/\\\\|?*]/g, "")\
    .replace(/\\s+/g, " ")\
    .trim()\
    .replace(/^[. ]+|[. ]+$/g, "");\
\
  let filename = Array.from(cleaned).slice(0, 120).join("");\
\
  if (!filename) \{\
    filename = "youtube-audio";\
  \}\
\
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\\.|$)/i.test(filename)) \{\
    filename = `_$\{filename\}`;\
  \}\
\
  return `$\{filename\}.mp3`;\
\}\
\
function encodeFilename(filename) \{\
  return encodeURIComponent(filename).replace(\
    /[!'()*]/g,\
    (character) =>\
      `%$\{character.charCodeAt(0).toString(16).toUpperCase()\}`\
  );\
\}\
\
app.get("/", (req, res) => \{\
  res.json(\{\
    status: "ok",\
    endpoint: "/download?url=YOUR_YOUTUBE_URL",\
  \});\
\});\
\
app.get("/download", async (req, res) => \{\
  const url = req.query.url;\
\
  if (typeof url !== "string" || !url.trim()) \{\
    return res.status(400).json(\{\
      error: "MISSING_URL",\
      message: "\uc0\u3585 \u3619 \u3640 \u3603 \u3634 \u3626 \u3656 \u3591  Query Parameter 'url' \u3648 \u3611 \u3655 \u3609 \u3621 \u3636 \u3591 \u3585 \u3660  YouTube",\
    \});\
  \}\
\
  const youtubeUrl = url.trim();\
\
  if (!ytdl.validateURL(youtubeUrl)) \{\
    return res.status(400).json(\{\
      error: "INVALID_URL",\
      message: "\uc0\u3621 \u3636 \u3591 \u3585 \u3660  YouTube \u3652 \u3617 \u3656 \u3606 \u3641 \u3585 \u3605 \u3657 \u3629 \u3591 ",\
    \});\
  \}\
\
  let audioStream;\
  let converter;\
  let timeout;\
  let stopped = false;\
  let ffmpegError = "";\
\
  function cleanup() \{\
    clearTimeout(timeout);\
\
    if (audioStream) \{\
      audioStream.destroy();\
    \}\
\
    if (converter) \{\
      converter.stdout.unpipe(res);\
      converter.stdin.destroy();\
      converter.stdout.destroy();\
\
      if (converter.exitCode === null && !converter.killed) \{\
        converter.kill("SIGKILL");\
      \}\
    \}\
  \}\
\
  function fail(error) \{\
    if (stopped) \{\
      return;\
    \}\
\
    stopped = true;\
\
    console.error("Download failed:", error.message);\
    cleanup();\
\
    if (res.destroyed || res.writableEnded) \{\
      return;\
    \}\
\
    if (res.headersSent) \{\
      // \uc0\u3648 \u3617 \u3639 \u3656 \u3629 \u3648 \u3619 \u3636 \u3656 \u3617 \u3626 \u3656 \u3591 \u3652 \u3615 \u3621 \u3660 \u3649 \u3621 \u3657 \u3623  HTTP \u3652 \u3617 \u3656 \u3626 \u3634 \u3617 \u3634 \u3619 \u3606 \u3648 \u3611 \u3621 \u3637 \u3656 \u3618 \u3609 \u3585 \u3621 \u3633 \u3610 \u3648 \u3611 \u3655 \u3609  JSON \u3652 \u3604 \u3657 \
      res.destroy();\
      return;\
    \}\
\
    res.removeHeader("Content-Disposition");\
    res.removeHeader("Content-Type");\
\
    res.status(500).json(\{\
      error: "DOWNLOAD_FAILED",\
      message: "\uc0\u3652 \u3617 \u3656 \u3626 \u3634 \u3617 \u3634 \u3619 \u3606 \u3604 \u3634 \u3623 \u3609 \u3660 \u3650 \u3627 \u3621 \u3604 \u3627 \u3619 \u3639 \u3629 \u3649 \u3611 \u3621 \u3591 \u3648 \u3626 \u3637 \u3618 \u3591 \u3652 \u3604 \u3657 ",\
      reason: error.message || "Unknown error",\
    \});\
  \}\
\
  res.on("close", () => \{\
    stopped = true;\
    cleanup();\
  \});\
\
  res.on("error", fail);\
\
  timeout = setTimeout(() => \{\
    fail(new Error("\uc0\u3588 \u3635 \u3586 \u3629 \u3651 \u3594 \u3657 \u3648 \u3623 \u3621 \u3634 \u3648 \u3585 \u3636 \u3609  15 \u3609 \u3634 \u3607 \u3637 "));\
  \}, 15 * 60 * 1000);\
\
  try \{\
    const info = await ytdl.getInfo(youtubeUrl);\
\
    if (stopped || res.destroyed) \{\
      return;\
    \}\
\
    if (info.videoDetails.isLiveContent) \{\
      throw new Error("API \uc0\u3609 \u3637 \u3657 \u3652 \u3617 \u3656 \u3619 \u3629 \u3591 \u3619 \u3633 \u3610 \u3623 \u3636 \u3604 \u3637 \u3650 \u3629 \u3606 \u3656 \u3634 \u3618 \u3607 \u3629 \u3604 \u3626 \u3604 ");\
    \}\
\
    const filename = cleanFilename(info.videoDetails.title);\
\
    // \uc0\u3651 \u3594 \u3657 \u3594 \u3639 \u3656 \u3629  ASCII \u3626 \u3635 \u3619 \u3629 \u3591  \u3649 \u3621 \u3632  filename* \u3648 \u3614 \u3639 \u3656 \u3629 \u3619 \u3629 \u3591 \u3619 \u3633 \u3610 \u3594 \u3639 \u3656 \u3629 \u3648 \u3614 \u3621 \u3591 \u3616 \u3634 \u3625 \u3634 \u3652 \u3607 \u3618 \
    const fallbackFilename =\
      filename\
        .replace(/[^\\x20-\\x7e]/g, "")\
        .replace(/["\\\\]/g, "")\
        .replace(/\\.mp3$/i, "")\
        .trim() || "youtube-audio";\
\
    res.setHeader("Content-Type", "audio/mpeg");\
    res.setHeader(\
      "Content-Disposition",\
      `attachment; filename="$\{fallbackFilename\}.mp3"; filename*=UTF-8''$\{encodeFilename(filename)\}`\
    );\
    res.setHeader("Cache-Control", "no-store");\
    res.setHeader("X-Content-Type-Options", "nosniff");\
\
    converter = spawn(\
      ffmpegPath,\
      [\
        "-hide_banner",\
        "-loglevel",\
        "error",\
        "-i",\
        "pipe:0",\
        "-vn",\
        "-c:a",\
        "libmp3lame",\
        "-b:a",\
        "192k",\
        "-f",\
        "mp3",\
        "pipe:1",\
      ],\
      \{\
        stdio: ["pipe", "pipe", "pipe"],\
        shell: false,\
      \}\
    );\
\
    converter.on("error", fail);\
\
    converter.stdin.on("error", fail);\
    converter.stdout.on("error", fail);\
\
    converter.stderr.on("data", (chunk) => \{\
      ffmpegError = (ffmpegError + chunk.toString()).slice(-4000);\
    \});\
\
    // \uc0\u3652 \u3617 \u3656 \u3611 \u3636 \u3604  response \u3592 \u3609 \u3585 \u3623 \u3656 \u3634 \u3592 \u3632 \u3618 \u3639 \u3609 \u3618 \u3633 \u3609 \u3623 \u3656 \u3634  FFmpeg \u3592 \u3610 \u3650 \u3604 \u3618 \u3652 \u3617 \u3656 \u3617 \u3637  error\
    converter.stdout.pipe(res, \{ end: false \});\
\
    converter.on("close", (code, signal) => \{\
      if (stopped) \{\
        return;\
      \}\
\
      if (code !== 0) \{\
        console.error("FFmpeg details:", ffmpegError);\
\
        fail(\
          new Error(\
            `FFmpeg \uc0\u3649 \u3611 \u3621 \u3591 \u3648 \u3626 \u3637 \u3618 \u3591 \u3652 \u3617 \u3656 \u3626 \u3635 \u3648 \u3619 \u3655 \u3592  (code: $\{code\}, signal: $\{signal || "none"\})`\
          )\
        );\
        return;\
      \}\
\
      stopped = true;\
      clearTimeout(timeout);\
      res.end();\
    \});\
\
    audioStream = ytdl(youtubeUrl, \{\
      filter: "audioonly",\
      quality: "highestaudio",\
    \});\
\
    audioStream.on("error", fail);\
\
    // YouTube audio \uc0\u8594  FFmpeg \u8594  MP3 \u8594  \u3612 \u3641 \u3657 \u3651 \u3594 \u3657 \
    audioStream.pipe(converter.stdin);\
  \} catch (error) \{\
    fail(error);\
  \}\
\});\
\
app.use((req, res) => \{\
  res.status(404).json(\{\
    error: "NOT_FOUND",\
    message: "\uc0\u3652 \u3617 \u3656 \u3614 \u3610  API \u3607 \u3637 \u3656 \u3648 \u3619 \u3637 \u3618 \u3585 \u3651 \u3594 \u3657 \u3591 \u3634 \u3609 ",\
  \});\
\});\
\
app.listen(PORT, "0.0.0.0", () => \{\
  console.log(`Server listening on port $\{PORT\}`);\
\});}