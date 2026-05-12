const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const OSS = require("ali-oss");
require("dotenv").config();

const app = express();

const PORT = process.env.PORT || 3000;
const USE_MOCK_TRANSCRIBE = process.env.USE_MOCK_TRANSCRIBE !== "false";

const ALIYUN_ACCESS_KEY_ID = process.env.ALIYUN_ACCESS_KEY_ID;
const ALIYUN_ACCESS_KEY_SECRET = process.env.ALIYUN_ACCESS_KEY_SECRET;
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL;

const ALIYUN_OSS_BUCKET = process.env.ALIYUN_OSS_BUCKET;
const ALIYUN_OSS_REGION = process.env.ALIYUN_OSS_REGION || "oss-cn-shanghai";
const ALIYUN_OSS_ENDPOINT =
  process.env.ALIYUN_OSS_ENDPOINT || "https://oss-cn-shanghai.aliyuncs.com";

const DASHSCOPE_API_KEY = process.env.DASHSCOPE_API_KEY;

const DASHSCOPE_SUBMIT_URL =
  "https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription";
const DASHSCOPE_TASK_URL = "https://dashscope.aliyuncs.com/api/v1/tasks";

const QWEN_AUDIO_MODEL = process.env.QWEN_AUDIO_MODEL || "qwen-audio-turbo-latest";
const QWEN_MULTIMODAL_URL =
  process.env.QWEN_MULTIMODAL_URL ||
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation";

const VIDEO_GENERATION_SUBMIT_URL =
  process.env.VIDEO_GENERATION_SUBMIT_URL ||
  "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis";

const WAN_VIDEO_MODEL = normalizeVideoModelName(
  process.env.WAN_VIDEO_MODEL || "wan2.7-t2v"
);
const WAN_VIDEO_DURATION = normalizeVideoDuration(process.env.WAN_VIDEO_DURATION || 5);
const WAN_VIDEO_RATIO = process.env.WAN_VIDEO_RATIO || "16:9";
const WAN_VIDEO_RESOLUTION = normalizeWanResolution(
  process.env.WAN_VIDEO_RESOLUTION || process.env.WAN_VIDEO_SIZE || "720P"
);
const WAN_VIDEO_SEED = process.env.WAN_VIDEO_SEED
  ? Number(process.env.WAN_VIDEO_SEED)
  : undefined;

const SPEAKER_GENDER_CONFIDENCE_THRESHOLD = Number(
  process.env.SPEAKER_GENDER_CONFIDENCE_THRESHOLD || 0.65
);

const uploadDir = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static(uploadDir));

const storage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, uploadDir);
  },
  filename(req, file, cb) {
    const ext = normalizeAudioExt(path.extname(file.originalname));
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024
  }
});

function cleanEnv(value) {
  return String(value || "").trim();
}

function getMockTranscript() {
  const speakerProfile = {
    roleMode: "male-female",
    leftRole: "female",
    rightRole: "male",
    speakerMap: {
      "0": {
        side: "left",
        voiceGender: "female",
        confidence: 0.9
      },
      "1": {
        side: "right",
        voiceGender: "male",
        confidence: 0.9
      }
    },
    source: "mock"
  };

  return {
    fullText:
      "今天我们来聊一个很适合年轻人的 AI 工具。它可以自动分析你的音频内容，并生成适合传播的文案。这个功能听起来还挺适合做播客摘要的。对，它也可以把不同说话人的内容做成左右气泡。",
    speakerProfile,
    segments: [
      {
        id: "mock-0",
        text: "今天我们来聊一个很适合年轻人的 AI 工具。",
        start: 0,
        end: 3.2,
        speaker: "left",
        speakerRaw: "0",
        speakerGender: "female",
        voiceGender: "female",
        roleMode: "male-female",
        leftRole: "female",
        rightRole: "male",
        speakerSource: "mock"
      },
      {
        id: "mock-1",
        text: "它可以自动分析你的音频内容，并生成适合传播的文案。",
        start: 3.2,
        end: 7.1,
        speaker: "right",
        speakerRaw: "1",
        speakerGender: "male",
        voiceGender: "male",
        roleMode: "male-female",
        leftRole: "female",
        rightRole: "male",
        speakerSource: "mock"
      },
      {
        id: "mock-2",
        text: "这个功能听起来还挺适合做播客摘要的。",
        start: 7.1,
        end: 10.5,
        speaker: "left",
        speakerRaw: "0",
        speakerGender: "female",
        voiceGender: "female",
        roleMode: "male-female",
        leftRole: "female",
        rightRole: "male",
        speakerSource: "mock"
      },
      {
        id: "mock-3",
        text: "对，它也可以把不同说话人的内容做成左右气泡。",
        start: 10.5,
        end: 14,
        speaker: "right",
        speakerRaw: "1",
        speakerGender: "male",
        voiceGender: "male",
        roleMode: "male-female",
        leftRole: "female",
        rightRole: "male",
        speakerSource: "mock"
      }
    ]
  };
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    mock: USE_MOCK_TRANSCRIBE,
    oss: Boolean(cleanEnv(ALIYUN_OSS_BUCKET)),
    dashscope: Boolean(cleanEnv(DASHSCOPE_API_KEY)),
    qwenAudio: {
      enabled: Boolean(cleanEnv(DASHSCOPE_API_KEY)),
      model: QWEN_AUDIO_MODEL,
      confidenceThreshold: SPEAKER_GENDER_CONFIDENCE_THRESHOLD
    },
    video: {
      enabled: Boolean(cleanEnv(DASHSCOPE_API_KEY)),
      model: WAN_VIDEO_MODEL,
      duration: WAN_VIDEO_DURATION,
      ratio: WAN_VIDEO_RATIO,
      resolution: WAN_VIDEO_RESOLUTION
    },
    message: "server is running"
  });
});

app.post("/api/transcribe", upload.single("audio"), async (req, res) => {
  try {
    console.log("收到 /api/transcribe 请求");

    if (!req.file) {
      return res.status(400).json({
        error: "没有收到音频文件，请确认前端字段名是 audio"
      });
    }

    const renderFileUrl = `${
      cleanEnv(PUBLIC_BASE_URL) || `http://localhost:${PORT}`
    }/uploads/${req.file.filename}`;

    console.log("收到音频文件：", req.file.originalname);
    console.log("保存文件名：", req.file.filename);
    console.log("Render 临时访问地址：", renderFileUrl);
    console.log("USE_MOCK_TRANSCRIBE：", USE_MOCK_TRANSCRIBE);

    if (USE_MOCK_TRANSCRIBE) {
      console.log("当前为 mock 模式，直接返回模拟文案。");

      return res.json({
        ...getMockTranscript(),
        fileUrl: renderFileUrl,
        mode: "mock"
      });
    }

    validateEnv();

    console.log("当前为 DashScope / Fun-ASR 真实识别模式。");
    console.log("开始上传音频到 OSS。");

    const ossInfo = await uploadAudioToOSS(req.file.path, req.file.filename);

    console.log("OSS ObjectName：", ossInfo.objectName);
    console.log("OSS 临时下载链接：", ossInfo.signedUrl);

    console.log("开始提交 OSS 链接给 DashScope Fun-ASR。");

    const dashscopeResult = await transcribeWithDashScope(ossInfo.signedUrl);

    let speakerProfile = buildFallbackSpeakerProfile(dashscopeResult.segments);

    try {
      const qwenProfile = await analyzeSpeakerProfileWithQwenAudio(
        ossInfo.signedUrl,
        dashscopeResult.segments,
        dashscopeResult.fullText
      );

      speakerProfile = mergeSpeakerProfileWithOriginalSides(
        qwenProfile,
        dashscopeResult.segments
      );

      console.log("声音风格分析结果：", JSON.stringify(speakerProfile, null, 2));
    } catch (profileError) {
      console.warn("声音风格分析失败，仅保留 Fun-ASR speaker 左右：", profileError.message);
    }

    dashscopeResult.segments = attachSpeakerProfileToSegments(
      dashscopeResult.segments,
      speakerProfile
    );

    return res.json({
      fullText: dashscopeResult.fullText,
      segments: dashscopeResult.segments,
      speakerProfile,
      raw: dashscopeResult.raw,
      fileUrl: ossInfo.signedUrl,
      ossObjectName: ossInfo.objectName,
      mode: "dashscope-fun-asr-speaker-stable-with-qwen-audio-role-profile"
    });
  } catch (error) {
    console.error("识别接口错误：", error);

    return res.status(500).json({
      error: "音频识别失败",
      detail: error.message,
      code: error.code || null,
      status: error.status || null
    });
  }
});

app.post("/api/generate-stage-video", async (req, res) => {
  try {
    console.log("收到 /api/generate-stage-video 请求");

    validateVideoEnv();

    let segments = Array.isArray(req.body?.segments) ? req.body.segments : [];
    const fullText = String(req.body?.fullText || "");
    const styleHint = String(req.body?.styleHint || "");
    const speakerProfile = req.body?.speakerProfile || null;

    if (speakerProfile && Array.isArray(segments)) {
      segments = attachSpeakerProfileToSegments(segments, speakerProfile);
    }

    if (!segments.length && !fullText) {
      return res.status(400).json({
        error: "缺少音频识别结果",
        detail: "请传入 segments 或 fullText，用于生成视频提示词。"
      });
    }

    const prompt = buildStageVideoPrompt(segments, fullText, styleHint);

    console.log("生成 stage video prompt：", prompt.slice(0, 2400));
    console.log("视频模型：", WAN_VIDEO_MODEL);
    console.log("视频参数：", {
      duration: WAN_VIDEO_DURATION,
      ratio: WAN_VIDEO_RATIO,
      resolution: WAN_VIDEO_RESOLUTION,
      seed: WAN_VIDEO_SEED
    });

    const task = await submitStageVideoTask(prompt);

    return res.json({
      ok: true,
      taskId: task.taskId,
      requestId: task.requestId,
      status: task.status,
      prompt,
      model: WAN_VIDEO_MODEL,
      parameters: {
        duration: WAN_VIDEO_DURATION,
        ratio: WAN_VIDEO_RATIO,
        resolution: WAN_VIDEO_RESOLUTION,
        seed: WAN_VIDEO_SEED
      },
      message: "视频生成任务已提交，请轮询 /api/stage-video-task/:taskId"
    });
  } catch (error) {
    console.error("生成对谈视频接口错误：", error);

    return res.status(500).json({
      error: "对谈视频生成失败",
      detail: error.message
    });
  }
});

app.get("/api/stage-video-task/:taskId", async (req, res) => {
  try {
    validateVideoEnv();

    const taskId = req.params.taskId;

    if (!taskId) {
      return res.status(400).json({
        error: "缺少 taskId"
      });
    }

    const taskResult = await queryStageVideoTask(taskId);
    const output = taskResult?.output || {};
    const status = output.task_status;

    console.log("视频生成任务查询：", {
      taskId,
      status,
      hasVideoUrl: Boolean(output.video_url)
    });

    if (status === "SUCCEEDED" && output.video_url) {
      let ossVideo = null;

      try {
        ossVideo = await saveGeneratedVideoToOSS(output.video_url, taskId);
      } catch (ossError) {
        console.warn("生成视频转存 OSS 失败，将返回 DashScope 临时链接：", ossError.message);
      }

      return res.json({
        ok: true,
        status,
        taskId,
        videoUrl: ossVideo?.signedUrl || output.video_url,
        temporaryVideoUrl: output.video_url,
        ossObjectName: ossVideo?.objectName || null,
        prompt: output.orig_prompt || "",
        raw: taskResult,
        message: ossVideo
          ? "视频生成成功，并已转存 OSS"
          : "视频生成成功，当前返回 DashScope 临时链接"
      });
    }

    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      return res.status(500).json({
        ok: false,
        status,
        taskId,
        error: "视频生成任务失败",
        detail: output.message || output.code || "未知错误",
        raw: taskResult
      });
    }

    return res.json({
      ok: true,
      status,
      taskId,
      raw: taskResult,
      message: "视频还在生成中"
    });
  } catch (error) {
    console.error("查询对谈视频任务错误：", error);

    return res.status(500).json({
      error: "查询对谈视频任务失败",
      detail: error.message
    });
  }
});

function validateEnv() {
  const missing = [];

  if (!cleanEnv(ALIYUN_ACCESS_KEY_ID)) missing.push("ALIYUN_ACCESS_KEY_ID");
  if (!cleanEnv(ALIYUN_ACCESS_KEY_SECRET)) missing.push("ALIYUN_ACCESS_KEY_SECRET");
  if (!cleanEnv(ALIYUN_OSS_BUCKET)) missing.push("ALIYUN_OSS_BUCKET");
  if (!cleanEnv(ALIYUN_OSS_REGION)) missing.push("ALIYUN_OSS_REGION");
  if (!cleanEnv(ALIYUN_OSS_ENDPOINT)) missing.push("ALIYUN_OSS_ENDPOINT");
  if (!cleanEnv(PUBLIC_BASE_URL)) missing.push("PUBLIC_BASE_URL");
  if (!cleanEnv(DASHSCOPE_API_KEY)) missing.push("DASHSCOPE_API_KEY");

  if (missing.length) {
    throw new Error(`缺少 Render 环境变量：${missing.join(", ")}`);
  }

  if (cleanEnv(PUBLIC_BASE_URL).includes("localhost")) {
    throw new Error("PUBLIC_BASE_URL 不能是 localhost，必须是 Render 的公网地址。");
  }
}

function validateVideoEnv() {
  const missing = [];

  if (!cleanEnv(DASHSCOPE_API_KEY)) missing.push("DASHSCOPE_API_KEY");

  if (missing.length) {
    throw new Error(`缺少视频生成环境变量：${missing.join(", ")}`);
  }
}

function createOSSClient() {
  const endpoint = cleanEnv(ALIYUN_OSS_ENDPOINT).replace(/\/+$/, "");

  console.log("OSS Client 配置检查：", {
    region: cleanEnv(ALIYUN_OSS_REGION),
    endpoint,
    bucket: cleanEnv(ALIYUN_OSS_BUCKET),
    hasAccessKeyId: Boolean(cleanEnv(ALIYUN_ACCESS_KEY_ID)),
    hasAccessKeySecret: Boolean(cleanEnv(ALIYUN_ACCESS_KEY_SECRET))
  });

  return new OSS({
    region: cleanEnv(ALIYUN_OSS_REGION),
    endpoint,
    accessKeyId: cleanEnv(ALIYUN_ACCESS_KEY_ID),
    accessKeySecret: cleanEnv(ALIYUN_ACCESS_KEY_SECRET),
    bucket: cleanEnv(ALIYUN_OSS_BUCKET),

    // Render 到阿里云 OSS 有时候很慢，默认 60 秒容易超时
    timeout: 300000
  });
}
  const endpoint = cleanEnv(ALIYUN_OSS_ENDPOINT).replace(/\/+$/, "");

  console.log("OSS Client 配置检查：", {
    region: cleanEnv(ALIYUN_OSS_REGION),
    endpoint,
    bucket: cleanEnv(ALIYUN_OSS_BUCKET),
    hasAccessKeyId: Boolean(cleanEnv(ALIYUN_ACCESS_KEY_ID)),
    hasAccessKeySecret: Boolean(cleanEnv(ALIYUN_ACCESS_KEY_SECRET))
  });

  return new OSS({
    region: cleanEnv(ALIYUN_OSS_REGION),
    endpoint,
    accessKeyId: cleanEnv(ALIYUN_ACCESS_KEY_ID),
    accessKeySecret: cleanEnv(ALIYUN_ACCESS_KEY_SECRET),
    bucket: cleanEnv(ALIYUN_OSS_BUCKET)
  });
}

async function uploadAudioToOSS(localFilePath, filename) {
  const client = createOSSClient();

  const ext = normalizeAudioExt(path.extname(filename));
  const objectName = `uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  console.log("准备以 Buffer 方式上传音频到 OSS：", {
    localFilePath,
    filename,
    objectName
  });

  if (!fs.existsSync(localFilePath)) {
    throw new Error(`本地音频文件不存在：${localFilePath}`);
  }

  const fileBuffer = fs.readFileSync(localFilePath);

  if (!fileBuffer || !fileBuffer.length) {
    throw new Error("读取到的音频文件为空，无法上传 OSS。");
  }

  console.log("音频 Buffer 读取成功，大小：", fileBuffer.length);

  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`开始上传 OSS，第 ${attempt}/3 次`);

      await client.put(objectName, fileBuffer, {
        timeout: 300000
      });

      console.log(`OSS 上传成功，第 ${attempt}/3 次`);

      const signedUrl = client.signatureUrl(objectName, {
        expires: 3600,
        method: "GET"
      });

      console.log("OSS Buffer 上传成功：", {
        objectName,
        signedUrl
      });

      return {
        objectName,
        signedUrl
      };
    } catch (error) {
      lastError = error;

      console.warn(`OSS 上传失败，第 ${attempt}/3 次：`, {
        message: error.message,
        code: error.code,
        status: error.status
      });

      if (attempt < 3) {
        console.log("3 秒后重试 OSS 上传...");
        await wait(3000);
      }
    }
  }

  throw lastError;
}
  const client = createOSSClient();

  const ext = normalizeAudioExt(path.extname(filename));
  const objectName = `uploads/${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;

  console.log("准备以 Buffer 方式上传音频到 OSS：", {
    localFilePath,
    filename,
    objectName
  });

  if (!fs.existsSync(localFilePath)) {
    throw new Error(`本地音频文件不存在：${localFilePath}`);
  }

  const fileBuffer = fs.readFileSync(localFilePath);

  if (!fileBuffer || !fileBuffer.length) {
    throw new Error("读取到的音频文件为空，无法上传 OSS。");
  }

  console.log("音频 Buffer 读取成功，大小：", fileBuffer.length);

  await client.put(objectName, fileBuffer);

  const signedUrl = client.signatureUrl(objectName, {
    expires: 3600,
    method: "GET"
  });

  console.log("OSS Buffer 上传成功：", {
    objectName,
    signedUrl
  });

  return {
    objectName,
    signedUrl
  };
}

async function transcribeWithDashScope(fileUrl) {
  const submitResult = await submitDashScopeTask(fileUrl);
  const taskId = submitResult?.output?.task_id;

  if (!taskId) {
    throw new Error(`DashScope 没有返回 task_id：${JSON.stringify(submitResult)}`);
  }

  console.log("DashScope TaskId：", taskId);

  const taskResult = await pollDashScopeTask(taskId);
  const transcriptionUrl = getTranscriptionUrl(taskResult);

  if (!transcriptionUrl) {
    throw new Error(`DashScope 没有返回 transcription_url：${JSON.stringify(taskResult).slice(0, 1200)}`);
  }

  console.log("DashScope transcription_url：", transcriptionUrl);

  const transcriptionJson = await fetchTranscriptionJson(transcriptionUrl);

  console.log("DashScope 最终转写 JSON 预览：", JSON.stringify(transcriptionJson).slice(0, 3000));

  const parsed = normalizeDashScopeResult(transcriptionJson);

  console.log(
    "DashScope speaker 预览：",
    parsed.segments
      .slice(0, 18)
      .map((item) => ({
        text: item.text.slice(0, 20),
        start: item.start,
        end: item.end,
        speaker: item.speaker,
        speakerRaw: item.speakerRaw,
        speakerSource: item.speakerSource
      }))
  );

  return {
    fullText: parsed.fullText,
    segments: parsed.segments,
    raw: {
      taskResult,
      transcriptionJson
    }
  };
}

async function analyzeSpeakerProfileWithQwenAudio(audioUrl, segments = [], fullText = "") {
  if (!cleanEnv(DASHSCOPE_API_KEY)) {
    throw new Error("缺少 DASHSCOPE_API_KEY，无法分析说话人声音风格。");
  }

  const speakerSummary = buildSpeakerSummaryForProfile(segments, fullText);

  const prompt = `
你是一个音频说话人分析助手。请根据音频和下面的转写时间轴，判断每个 speakerRaw 的声音风格更偏男性化、女性化还是无法判断。

请注意：
1. 只做声音风格判断，不需要判断真实身份。
2. 输出必须是严格 JSON，不要解释。
3. 如果不确定，就填 unknown。
4. 如果有一位明显女声，请把她标为 female。
5. 如果有一位明显男声，请把他标为 male。
6. speakerRaw 必须和转写时间轴里的 speakerRaw 完全一致。
7. confidence 表示你对声音风格判断的置信度，范围 0 到 1。

转写时间轴：
${speakerSummary}

请输出这个 JSON 格式：
{
  "speakers": [
    {
      "speakerRaw": "原始speakerRaw",
      "voiceGender": "male | female | unknown",
      "confidence": 0.0
    }
  ]
}
`.trim();

  const body = {
    model: QWEN_AUDIO_MODEL,
    input: {
      messages: [
        {
          role: "user",
          content: [
            {
              audio: audioUrl
            },
            {
              text: prompt
            }
          ]
        }
      ]
    },
    parameters: {
      result_format: "message"
    }
  };

  console.log("提交 Qwen-Audio 声音风格分析：", {
    model: QWEN_AUDIO_MODEL,
    audioUrl: audioUrl.slice(0, 140)
  });

  const response = await fetch(QWEN_MULTIMODAL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnv(DASHSCOPE_API_KEY)}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await safeReadJson(response);

  console.log("Qwen-Audio 声音风格分析响应：", JSON.stringify(data).slice(0, 2400));

  if (!response.ok) {
    throw new Error(`Qwen-Audio 分析失败：${response.status} ${JSON.stringify(data)}`);
  }

  const content = extractQwenMessageText(data);
  const parsed = parseJsonFromModelText(content);

  return buildSpeakerProfileFromQwenResult(parsed, segments);
}

function buildSpeakerSummaryForProfile(segments = [], fullText = "") {
  const items = Array.isArray(segments) ? segments.slice(0, 34) : [];

  if (!items.length && fullText) {
    return `fullText: ${String(fullText).slice(0, 800)}`;
  }

  return items
    .map((item, index) => {
      const raw = item?.speakerRaw ?? item?.speaker ?? `turn-${index}`;
      const side = item?.speaker || "";
      const start = Number(item?.start || 0).toFixed(2);
      const end = Number(item?.end || 0).toFixed(2);
      const text = String(item?.text || "").slice(0, 90);
      return `#${index + 1} speakerRaw=${raw}, side=${side}, time=${start}-${end}, text=${text}`;
    })
    .join("\n");
}

function extractQwenMessageText(data) {
  const message = data?.output?.choices?.[0]?.message;
  const content = message?.content;

  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item?.text) return item.text;
        return "";
      })
      .filter(Boolean)
      .join("");
  }

  if (data?.output?.text) return data.output.text;

  return JSON.stringify(data);
}

function parseJsonFromModelText(text) {
  const raw = String(text || "").trim();

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Qwen-Audio 没有返回可解析 JSON：${raw.slice(0, 500)}`);
    return JSON.parse(match[0]);
  }
}

function buildSpeakerProfileFromQwenResult(parsed, segments = []) {
  const speakers = Array.isArray(parsed?.speakers) ? parsed.speakers : [];
  const rawValues = Array.from(
    new Set(
      segments
        .map((item) => item.speakerRaw)
        .filter((value) => value !== null && value !== undefined && value !== "")
        .map(String)
    )
  );

  const byRaw = new Map();

  speakers.forEach((item) => {
    const raw = String(item?.speakerRaw ?? item?.speaker ?? "").trim();
    let gender = normalizeVoiceGender(item?.voiceGender || item?.gender);
    const confidence = Number(item?.confidence || 0);

    if (!Number.isFinite(confidence) || confidence < SPEAKER_GENDER_CONFIDENCE_THRESHOLD) {
      gender = "unknown";
    }

    if (raw && gender) {
      byRaw.set(raw, {
        voiceGender: gender,
        confidence: Number.isFinite(confidence) ? confidence : 0
      });
    }
  });

  if (!byRaw.size && speakers.length && rawValues.length) {
    speakers.slice(0, rawValues.length).forEach((item, index) => {
      let gender = normalizeVoiceGender(item?.voiceGender || item?.gender);
      const confidence = Number(item?.confidence || 0);

      if (!Number.isFinite(confidence) || confidence < SPEAKER_GENDER_CONFIDENCE_THRESHOLD) {
        gender = "unknown";
      }

      if (gender) {
        byRaw.set(rawValues[index], {
          voiceGender: gender,
          confidence: Number.isFinite(confidence) ? confidence : 0
        });
      }
    });
  }

  const speakerMap = {};
  rawValues.forEach((raw, index) => {
    const profile = byRaw.get(raw) || {
      voiceGender: "unknown",
      confidence: 0
    };

    speakerMap[raw] = {
      speakerRaw: raw,
      voiceGender: profile.voiceGender,
      confidence: profile.confidence,
      originalIndex: index
    };
  });

  return {
    roleMode: "auto",
    leftRole: "neutral",
    rightRole: "neutral",
    speakerMap,
    source: "qwen-audio"
  };
}

function mergeSpeakerProfileWithOriginalSides(profile, segments = []) {
  const map = profile?.speakerMap || {};
  const sideByRaw = {};

  segments.forEach((item) => {
    const raw = item?.speakerRaw !== null && item?.speakerRaw !== undefined
      ? String(item.speakerRaw)
      : "";

    if (!raw) return;
    if (!sideByRaw[raw]) {
      sideByRaw[raw] = item.speaker === "right" ? "right" : "left";
    }
  });

  const speakerMap = {};

  Object.keys(map).forEach((raw) => {
    const gender = normalizeVoiceGender(map[raw]?.voiceGender) || "unknown";

    speakerMap[raw] = {
      side: sideByRaw[raw] || "left",
      voiceGender: gender,
      confidence: Number(map[raw]?.confidence || 0)
    };
  });

  Object.keys(sideByRaw).forEach((raw) => {
    if (!speakerMap[raw]) {
      speakerMap[raw] = {
        side: sideByRaw[raw],
        voiceGender: "unknown",
        confidence: 0
      };
    }
  });

  const roles = inferRolesFromSpeakerMap(speakerMap);

  return {
    ...roles,
    speakerMap,
    source: profile?.source || "qwen-audio"
  };
}

function buildFallbackSpeakerProfile(segments = []) {
  const speakerMap = {};

  segments.forEach((item) => {
    const raw = item?.speakerRaw !== null && item?.speakerRaw !== undefined
      ? String(item.speakerRaw)
      : "";

    if (!raw || speakerMap[raw]) return;

    speakerMap[raw] = {
      side: item.speaker === "right" ? "right" : "left",
      voiceGender: "unknown",
      confidence: 0
    };
  });

  const roles = inferRolesFromSpeakerMap(speakerMap);

  return {
    ...roles,
    speakerMap,
    source: "fallback"
  };
}

function inferRolesFromSpeakerMap(speakerMap = {}) {
  const result = {
    roleMode: "auto",
    leftRole: "neutral",
    rightRole: "neutral"
  };

  Object.values(speakerMap).forEach((item) => {
    const side = item.side === "right" ? "right" : "left";
    const gender = normalizeVoiceGender(item.voiceGender) || "unknown";

    if (side === "left" && gender !== "unknown") {
      result.leftRole = gender;
    }

    if (side === "right" && gender !== "unknown") {
      result.rightRole = gender;
    }
  });

  if (result.leftRole === "female" && result.rightRole === "male") {
    result.roleMode = "female-male";
  } else if (result.leftRole === "male" && result.rightRole === "female") {
    result.roleMode = "male-female";
  } else if (result.leftRole === "female" && result.rightRole === "female") {
    result.roleMode = "female-female";
  } else if (result.leftRole === "male" && result.rightRole === "male") {
    result.roleMode = "male-male";
  } else if (result.leftRole !== "neutral" || result.rightRole !== "neutral") {
    result.roleMode = "mixed-partial";
  }

  return result;
}

function attachSpeakerProfileToSegments(segments = [], speakerProfile) {
  const map = speakerProfile?.speakerMap || {};

  return segments.map((item) => {
    const raw = item?.speakerRaw !== null && item?.speakerRaw !== undefined
      ? String(item.speakerRaw)
      : "";

    const profile = raw ? map[raw] : null;

    return {
      ...item,
      speaker: item.speaker,
      speakerGender: profile?.voiceGender || "unknown",
      voiceGender: profile?.voiceGender || "unknown",
      genderConfidence: profile?.confidence || 0,
      roleMode: speakerProfile?.roleMode || "auto",
      leftRole: speakerProfile?.leftRole || "neutral",
      rightRole: speakerProfile?.rightRole || "neutral"
    };
  });
}

function normalizeVoiceGender(value) {
  const raw = String(value || "").trim().toLowerCase();

  if (["female", "woman", "girl", "feminine", "女", "女性", "女声", "偏女性"].includes(raw)) {
    return "female";
  }

  if (["male", "man", "boy", "masculine", "男", "男性", "男声", "偏男性"].includes(raw)) {
    return "male";
  }

  return raw === "unknown" || raw === "未知" || raw === "不确定" ? "unknown" : "";
}

async function submitDashScopeTask(fileUrl) {
  const body = {
    model: "fun-asr",
    input: {
      file_urls: [fileUrl]
    },
    parameters: {
      diarization_enabled: true,
      speaker_count: 2,
      language_hints: ["zh"]
    }
  };

  console.log("提交 DashScope 任务参数：", JSON.stringify(body));

  const response = await fetch(DASHSCOPE_SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnv(DASHSCOPE_API_KEY)}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify(body)
  });

  const data = await safeReadJson(response);

  console.log("DashScope 提交响应：", JSON.stringify(data));

  if (!response.ok) {
    throw new Error(`DashScope 提交失败：${response.status} ${JSON.stringify(data)}`);
  }

  if (data && (data.code || String(data.message || "").toLowerCase().includes("error"))) {
    throw new Error(`DashScope 提交异常：${JSON.stringify(data)}`);
  }

  return data;
}

async function pollDashScopeTask(taskId) {
  const maxAttempts = 72;
  const intervalMs = 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`查询 DashScope 识别结果，第 ${attempt}/${maxAttempts} 次`);

    const response = await fetch(`${DASHSCOPE_TASK_URL}/${taskId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cleanEnv(DASHSCOPE_API_KEY)}`
      }
    });

    const data = await safeReadJson(response);

    console.log(
      "DashScope 查询响应：",
      JSON.stringify({
        status: response.status,
        task_status: data?.output?.task_status,
        task_id: data?.output?.task_id,
        usage: data?.usage
      })
    );

    if (!response.ok) {
      throw new Error(`DashScope 查询失败：${response.status} ${JSON.stringify(data)}`);
    }

    const taskStatus = data?.output?.task_status;

    if (taskStatus === "SUCCEEDED") {
      console.log("DashScope 识别任务成功");
      return data;
    }

    if (taskStatus === "FAILED" || taskStatus === "CANCELED" || taskStatus === "UNKNOWN") {
      throw new Error(`DashScope 识别任务失败：${JSON.stringify(data).slice(0, 2000)}`);
    }

    await wait(intervalMs);
  }

  throw new Error("DashScope 识别超时，请上传更短的音频重试。");
}

function getTranscriptionUrl(taskResult) {
  const results = taskResult?.output?.results;

  if (!Array.isArray(results) || !results.length) return "";

  const successItem =
    results.find((item) => item.subtask_status === "SUCCEEDED" && item.transcription_url) ||
    results.find((item) => item.transcription_url);

  if (!successItem) {
    const failed = results.find((item) => item.subtask_status === "FAILED");
    if (failed) {
      throw new Error(`DashScope 子任务失败：${failed.code || ""} ${failed.message || ""}`);
    }
    return "";
  }

  return successItem.transcription_url;
}

async function fetchTranscriptionJson(url) {
  const response = await fetch(url);
  const data = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(`下载 transcription_url 失败：${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function submitStageVideoTask(prompt) {
  const parameters = {
    resolution: WAN_VIDEO_RESOLUTION,
    ratio: WAN_VIDEO_RATIO,
    duration: WAN_VIDEO_DURATION,
    watermark: false
  };

  if (Number.isFinite(WAN_VIDEO_SEED)) {
    parameters.seed = WAN_VIDEO_SEED;
  }

  const body = {
    model: WAN_VIDEO_MODEL,
    input: {
      prompt
    },
    parameters
  };

  console.log("提交视频生成任务参数：", JSON.stringify(body).slice(0, 2500));

  const response = await fetch(VIDEO_GENERATION_SUBMIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cleanEnv(DASHSCOPE_API_KEY)}`,
      "Content-Type": "application/json",
      "X-DashScope-Async": "enable"
    },
    body: JSON.stringify(body)
  });

  const data = await safeReadJson(response);

  console.log("视频生成提交响应：", JSON.stringify(data).slice(0, 2000));

  if (!response.ok) {
    throw new Error(`视频生成提交失败：${response.status} ${JSON.stringify(data)}`);
  }

  if (data?.code || data?.message?.toLowerCase?.().includes("error")) {
    throw new Error(`视频生成提交异常：${JSON.stringify(data)}`);
  }

  const taskId = data?.output?.task_id;

  if (!taskId) {
    throw new Error(`视频生成没有返回 task_id：${JSON.stringify(data)}`);
  }

  return {
    taskId,
    requestId: data?.request_id,
    status: data?.output?.task_status || "PENDING"
  };
}

async function queryStageVideoTask(taskId) {
  const response = await fetch(`${DASHSCOPE_TASK_URL}/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${cleanEnv(DASHSCOPE_API_KEY)}`
    }
  });

  const data = await safeReadJson(response);

  if (!response.ok) {
    throw new Error(`视频任务查询失败：${response.status} ${JSON.stringify(data)}`);
  }

  return data;
}

async function saveGeneratedVideoToOSS(videoUrl, taskId) {
  if (
    !cleanEnv(ALIYUN_ACCESS_KEY_ID) ||
    !cleanEnv(ALIYUN_ACCESS_KEY_SECRET) ||
    !cleanEnv(ALIYUN_OSS_BUCKET) ||
    !cleanEnv(ALIYUN_OSS_REGION) ||
    !cleanEnv(ALIYUN_OSS_ENDPOINT)
  ) {
    throw new Error("OSS 环境变量不完整，无法转存生成视频。");
  }

  console.log("开始下载生成视频并转存 OSS：", videoUrl);

  const response = await fetch(videoUrl);

  if (!response.ok) {
    throw new Error(`下载生成视频失败：${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const client = createOSSClient();
  const objectName = `generated-stage-videos/${taskId}-${Date.now()}.mp4`;

  await client.put(objectName, buffer);

  const signedUrl = client.signatureUrl(objectName, {
    expires: 7 * 24 * 60 * 60,
    method: "GET"
  });

  console.log("生成视频已转存 OSS：", objectName);

  return {
    objectName,
    signedUrl
  };
}

function buildStageVideoPrompt(segments, fullText = "", styleHint = "") {
  const topic = buildAudioTopic(segments, fullText);
  const roleInfo = inferVideoRoleInfoFromSegments(segments);

  const topicBlock = topic
    ? `Audio topic inspiration: ${topic}`
    : "Audio topic inspiration: a relaxed two-person podcast conversation.";

  const styleHintBlock = styleHint
    ? `Additional style hint from user: ${styleHint}`
    : "";

  return `
A bright, warm, cozy 3D cartoon podcast studio, highly stylized, polished C4D / animated short film style, soft clean clay-like materials, smooth rounded shapes, cute appealing character design, bright beige and cream color palette, airy and cheerful atmosphere.

IMPORTANT:
This is a 5-second seamless idle loop video.
Create a clean idle loop where the first frame and the last frame are visually very similar.
The characters should return to almost the same pose at the end of the video.
Use very small repetitive motions only, such as breathing, blinking, tiny head movement.
Avoid one-way movements, hand waving, leaning forward, standing up, turning around, or any action that does not return to the starting pose.
Keep all objects, microphones, furniture, and background completely stable.
No camera movement, no zoom, no pan, no scene cut.

COMPOSITION:
Wide full-room shot.
The camera is fixed and placed relatively far back.
The room should feel spacious, bright, airy, and open.
The characters should appear smaller in the frame, while the environment occupies more of the composition.
Show more wall, more floor, more carpet, and more empty space around the characters.
Avoid a close-up or medium shot.

SCENE:
A cozy podcast studio interior with a bright warm beige wall, soft even lighting, a large textured carpet, a floor lamp on the left, a recessed wall niche shelf with small cute decorations and plants, a potted plant on the right, minimal framed wall art, and a small round table in the center.

CHARACTERS:
${roleInfo.characterPrompt}

ROLE AND BUBBLE ALIGNMENT:
The left character visually represents the left speaker in the transcript.
The right character visually represents the right speaker in the transcript.
The transcript speaker positions are stable:
left role = ${roleInfo.leftRole}
right role = ${roleInfo.rightRole}

PROPORTION:
The full bodies of both characters and the full chairs must be visible.
The two hosts should not dominate the frame.
The environment should feel larger than the people.
Keep generous negative space around the characters.

MICROPHONES:
Two podcast microphones extend diagonally from the upper left and upper right toward the hosts.
Keep the microphones elegant, slim, and visually secondary.
Do not let the microphone arms dominate the composition.

LIGHTING:
Make the whole scene brighter, cleaner, softer, and more evenly illuminated.
Use warm soft lighting with a bright airy feeling.
Avoid dim corners, heavy shadows, dramatic contrast, or dark cinematic lighting.
The image should feel warm, light, soft, and welcoming.

MOTION:
Only subtle idle loop animation:
gentle breathing,
natural blinking,
tiny head movement,
very slight hand or shoulder micro-movements,
very light body sway.
No dramatic action.
No large gestures.
No strong mouth movement.
No sudden pose changes.
No sudden object movement.

LOOP RULES:
The motion must be smooth, stable, minimal, and cyclical.
The characters should end in a pose very similar to the initial pose.
Avoid abrupt changes between the first and last frames.
Avoid one-way motion that cannot loop.
Avoid actions that clearly start and stop.
Make the last frame visually match the first frame as closely as possible.

CAMERA:
Fixed frontal wide shot.
No zoom.
No pan.
No tilt.
No camera movement.
No perspective change.
No cuts.

STYLE:
Cute 3D cartoon look, polished C4D style, clean, simplified, soft, warm, bright, friendly, not realistic, not photorealistic.

${topicBlock}

${styleHintBlock}

No subtitles, no text, no logo, no UI.
`.trim();
}

function inferVideoRoleInfoFromSegments(segments = []) {
  const gendersBySide = {
    left: null,
    right: null
  };

  for (const item of segments) {
    const side = item?.speaker === "right" ? "right" : "left";
    const gender = normalizeVoiceGender(item?.speakerGender || item?.voiceGender || item?.gender);

    if (!gendersBySide[side] && gender && gender !== "unknown") {
      gendersBySide[side] = gender;
    }
  }

  const leftRole = gendersBySide.left || "neutral";
  const rightRole = gendersBySide.right || "neutral";

  return {
    leftRole,
    rightRole,
    characterPrompt: buildCharacterPromptBySide(leftRole, rightRole)
  };
}

function buildCharacterPromptBySide(leftRole, rightRole) {
  const left = buildSingleCharacterPrompt("left", leftRole);
  const right = buildSingleCharacterPrompt("right", rightRole);

  return `
Two cute podcast hosts sit facing each other in separate white cushioned wooden armchairs.

Left host: ${left}
Right host: ${right}
`.trim();
}

function buildSingleCharacterPrompt(side, role) {
  if (role === "female") {
    return side === "left"
      ? "cute young female podcast host, soft black hair, light beige hoodie, beige pants, sneakers, relaxed and friendly, sitting naturally in the left armchair."
      : "cute young female podcast host, soft curly hair, light beige shirt, dark pants, white sneakers, relaxed and friendly, sitting naturally in the right armchair.";
  }

  if (role === "male") {
    return side === "left"
      ? "cute young male podcast host, black hair, light beige hoodie, beige pants, sneakers, relaxed and friendly, sitting naturally in the left armchair."
      : "cute curly-haired male podcast host with a short beard, light beige shirt, dark pants, white sneakers, relaxed and friendly, sitting naturally in the right armchair.";
  }

  return side === "left"
    ? "cute young neutral podcast host, black hair, light beige hoodie, beige pants, sneakers, relaxed and friendly, sitting naturally in the left armchair."
    : "cute friendly neutral podcast host with curly hair, light beige shirt, dark pants, white sneakers, relaxed and friendly, sitting naturally in the right armchair.";
}

function buildAudioTopic(segments, fullText = "") {
  const segmentText = Array.isArray(segments)
    ? segments
        .slice(0, 10)
        .map((item) => item?.text)
        .filter(Boolean)
        .join("，")
    : "";

  const sourceText = segmentText || fullText || "";

  return String(sourceText)
    .replace(/\s+/g, "")
    .slice(0, 280);
}

function normalizeDashScopeResult(resultJson) {
  const rawSentences = extractDashScopeSentences(resultJson);

  if (!rawSentences.length) {
    const fallbackText = extractTextFromResult(resultJson) || "未识别到有效文本，请换一段更清晰的音频重试。";
    const fallbackSegments = buildFallbackSegments(fallbackText);

    return {
      fullText: fallbackSegments.map((item) => item.text).join(""),
      segments: fallbackSegments
    };
  }

  const rawSegments = rawSentences
    .map((item, index) => normalizeDashScopeSentence(item, index))
    .filter((item) => item.text);

  const speakerAwareSegments = assignSpeakers(rawSegments);
  const optimizedSegments = optimizeSentenceSegments(speakerAwareSegments);

  return {
    fullText: optimizedSegments.map((item) => item.text).join(""),
    segments: optimizedSegments.map((item, index) => ({
      ...item,
      id: `dashscope-${index}`
    }))
  };
}

function extractDashScopeSentences(resultJson) {
  const transcripts = resultJson?.transcripts;

  if (!Array.isArray(transcripts)) return [];

  const sentences = [];

  transcripts.forEach((transcript) => {
    const channelId = transcript.channel_id ?? transcript.channelId ?? null;

    if (Array.isArray(transcript.sentences)) {
      transcript.sentences.forEach((sentence) => {
        sentences.push({
          ...sentence,
          channel_id: sentence.channel_id ?? channelId
        });
      });
    }
  });

  return sentences.sort((a, b) => {
    const aStart = Number(a.begin_time ?? a.BeginTime ?? a.start ?? 0);
    const bStart = Number(b.begin_time ?? b.BeginTime ?? b.start ?? 0);
    return aStart - bStart;
  });
}

function normalizeDashScopeSentence(item, index) {
  const text =
    item.text ??
    item.Text ??
    item.sentence ??
    item.Sentence ??
    "";

  const beginMs =
    item.begin_time ??
    item.BeginTime ??
    item.start_time ??
    item.StartTime ??
    item.start ??
    0;

  const endMs =
    item.end_time ??
    item.EndTime ??
    item.stop_time ??
    item.StopTime ??
    item.end ??
    Number(beginMs) + 2500;

  const speakerRaw =
    item.speaker_id ??
    item.SpeakerId ??
    item.speakerId ??
    item.speaker ??
    item.Speaker ??
    item.spk ??
    item.spk_id ??
    item.channel_id ??
    item.ChannelId ??
    null;

  const cleanedText = cleanSpeechText(String(text));
  const start = toSeconds(beginMs);
  let end = toSeconds(endMs);

  if (!Number.isFinite(end) || end <= start) {
    end = start + estimateDuration(cleanedText);
  }

  return {
    text: cleanedText,
    start,
    end,
    speakerRaw: speakerRaw === null || speakerRaw === undefined ? null : String(speakerRaw),
    rawIndex: index
  };
}

function assignSpeakers(segments) {
  const rawValues = segments
    .map((item) => item.speakerRaw)
    .filter((value) => value !== null && value !== undefined && value !== "");

  const uniqueRaw = Array.from(new Set(rawValues));

  console.log("DashScope 原始 speaker 字段：", uniqueRaw);

  if (uniqueRaw.length >= 2) {
    const numericValues = uniqueRaw
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));

    const hasZeroBasedSpeaker = numericValues.includes(0);
    const speakerMap = new Map();

    uniqueRaw.forEach((raw, index) => {
      const rawLower = String(raw).toLowerCase();
      const numeric = Number(raw);

      let speaker = null;

      if (
        ["left", "l", "speaker_left", "speaker-a", "speaker_a", "a", "spk0", "speaker0"].includes(
          rawLower
        )
      ) {
        speaker = "left";
      }

      if (
        ["right", "r", "speaker_right", "speaker-b", "speaker_b", "b", "spk1", "speaker1"].includes(
          rawLower
        )
      ) {
        speaker = "right";
      }

      if (!speaker && Number.isFinite(numeric)) {
        if (hasZeroBasedSpeaker) {
          speaker = numeric === 0 ? "left" : "right";
        } else {
          speaker = numeric === 1 ? "left" : "right";
        }
      }

      if (!speaker) {
        speaker = index % 2 === 0 ? "left" : "right";
      }

      speakerMap.set(raw, speaker);
    });

    return segments.map((item) => ({
      ...item,
      speaker: speakerMap.get(item.speakerRaw) || "left",
      speakerSource: "dashscope"
    }));
  }

  console.log("DashScope 没有返回可靠的多人 speaker_id，启用左右轮次兜底分配。");
  return assignSpeakersByHeuristic(segments);
}

function assignSpeakersByHeuristic(segments) {
  let currentSpeaker = "left";
  let lastEnd = -Infinity;
  let lastText = "";

  return segments.map((item, index) => {
    const gap = item.start - lastEnd;
    const textLength = String(item.text || "").length;

    if (index === 0) {
      currentSpeaker = "left";
    } else {
      if (gap >= 0.55) {
        currentSpeaker = currentSpeaker === "left" ? "right" : "left";
      } else if (lastText.length >= 18 && textLength <= 18) {
        currentSpeaker = currentSpeaker === "left" ? "right" : "left";
      } else if (textLength >= 30) {
        currentSpeaker = currentSpeaker === "left" ? "right" : "left";
      }
    }

    lastEnd = item.end;
    lastText = item.text;

    return {
      ...item,
      speaker: currentSpeaker,
      speakerSource: "heuristic"
    };
  });
}

function optimizeSentenceSegments(segments) {
  const cleaned = segments
    .map((segment) => ({
      ...segment,
      text: cleanSpeechText(segment.text)
    }))
    .filter((segment) => segment.text);

  const merged = mergeShortSegments(cleaned);
  const split = merged.flatMap((segment) => splitLongSegment(segment));

  return split.map((segment) => ({
    text: segment.text,
    start: Number(segment.start.toFixed(3)),
    end: Number(segment.end.toFixed(3)),
    speaker: segment.speaker,
    speakerRaw: segment.speakerRaw,
    speakerSource: segment.speakerSource
  }));
}

function mergeShortSegments(segments) {
  const result = [];

  for (const segment of segments) {
    const previous = result[result.length - 1];

    if (!previous) {
      result.push({ ...segment });
      continue;
    }

    const gap = segment.start - previous.end;
    const combinedText = previous.text + segment.text;
    const sameSpeaker = previous.speaker === segment.speaker;

    const shouldMerge =
      sameSpeaker &&
      gap <= 0.45 &&
      (previous.text.length <= 6 || segment.text.length <= 6 || combinedText.length <= 22);

    if (shouldMerge) {
      previous.text = combinedText;
      previous.end = Math.max(previous.end, segment.end);
      continue;
    }

    result.push({ ...segment });
  }

  return result;
}

function splitLongSegment(segment) {
  const text = segment.text;

  if (text.length <= 34) {
    return [segment];
  }

  if (text.length <= 54) {
    const pieces = splitByPunctuationWithMinLength(text, 18, 34);

    if (pieces.length <= 1) {
      return [segment];
    }

    return distributeSegmentTime(segment, pieces);
  }

  const pieces = splitByPunctuationWithMinLength(text, 16, 34);
  return distributeSegmentTime(segment, pieces);
}

function splitByPunctuationWithMinLength(text, minLength, maxLength) {
  if (!text || text.length <= maxLength) return [text];

  const parts = text
    .split(/(?<=[。！？!?；;，,、])/)
    .map((piece) => piece.replace(/[。！？!?；;，,、]+$/g, "").trim())
    .filter(Boolean);

  if (!parts.length) {
    return chunkByLength(text, maxLength);
  }

  const result = [];
  let buffer = "";

  for (const part of parts) {
    if (!buffer) {
      buffer = part;
      continue;
    }

    if ((buffer + part).length <= maxLength) {
      buffer += part;
      continue;
    }

    if (buffer.length < minLength) {
      buffer += part;
      continue;
    }

    result.push(buffer);
    buffer = part;
  }

  if (buffer) result.push(buffer);

  const repaired = [];

  for (const piece of result) {
    const previous = repaired[repaired.length - 1];

    if (previous && piece.length < minLength && previous.length + piece.length <= maxLength) {
      repaired[repaired.length - 1] = previous + piece;
    } else if (piece.length > maxLength) {
      repaired.push(...chunkByLength(piece, maxLength));
    } else {
      repaired.push(piece);
    }
  }

  return repaired.filter(Boolean);
}

function chunkByLength(text, maxLength) {
  const result = [];

  for (let i = 0; i < text.length; i += maxLength) {
    result.push(text.slice(i, i + maxLength));
  }

  return result;
}

function distributeSegmentTime(segment, pieces) {
  if (!pieces.length) return [];

  const totalChars = pieces.reduce((sum, piece) => sum + piece.length, 0) || 1;
  const totalDuration = Math.max(segment.end - segment.start, 0.6);
  let cursor = segment.start;

  return pieces.map((piece, index) => {
    const isLast = index === pieces.length - 1;
    const duration = isLast
      ? Math.max(0.35, segment.end - cursor)
      : Math.max(0.35, totalDuration * (piece.length / totalChars));

    const start = Number(cursor.toFixed(3));
    const end = Number((cursor + duration).toFixed(3));

    cursor = end;

    return {
      ...segment,
      text: piece,
      start,
      end
    };
  });
}

function buildFallbackSegments(text) {
  const cleaned = cleanSpeechText(text);
  const pieces = splitByPunctuationWithMinLength(cleaned, 16, 34);

  if (!pieces.length) {
    return [
      {
        id: "fallback-0",
        text: "未识别到有效文本",
        start: 0,
        end: 3,
        speaker: "left",
        speakerRaw: null,
        speakerSource: "fallback"
      }
    ];
  }

  let cursor = 0;

  return pieces.map((piece, index) => {
    const duration = Math.max(2.2, Math.min(5.2, piece.length * 0.22));
    const start = Number(cursor.toFixed(3));
    const end = Number((cursor + duration).toFixed(3));
    cursor = end;

    return {
      id: `fallback-${index}`,
      text: piece,
      start,
      end,
      speaker: index % 2 === 0 ? "left" : "right",
      speakerRaw: null,
      speakerSource: "fallback"
    };
  });
}

function cleanSpeechText(text) {
  return String(text || "")
    .replace(/[，,]?(嗯|啊|呃|额|然后呢|然后|就是|这个|那个)[，,]?/g, "")
    .replace(/\s+/g, "")
    .replace(/[。！？!?；;]+/g, "。")
    .replace(/^[，,。]+|[，,。]+$/g, "");
}

function estimateDuration(text) {
  return Math.max(1.2, Math.min(4.8, String(text || "").length * 0.18));
}

function extractTextFromResult(value) {
  if (!value) return "";

  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value.map(extractTextFromResult).filter(Boolean).join("");
  }

  if (typeof value === "object") {
    if (value.text) return String(value.text);
    if (value.Text) return String(value.Text);
    if (value.Result) return extractTextFromResult(value.Result);
    if (value.result) return extractTextFromResult(value.result);
    if (value.transcripts) return extractTextFromResult(value.transcripts);
    if (value.sentences) return extractTextFromResult(value.sentences);
  }

  return "";
}

function toSeconds(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 0;

  return Number((number / 1000).toFixed(3));
}

async function safeReadJson(response) {
  const text = await response.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (error) {
    return {
      rawText: text
    };
  }
}

function normalizeAudioExt(ext) {
  const lower = String(ext || "").toLowerCase();

  if ([".mp3", ".wav", ".m4a", ".ogg", ".mp4", ".aac", ".flac", ".webm"].includes(lower)) {
    return lower;
  }

  return ".mp3";
}

function getAudioContentType(ext) {
  switch (ext) {
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "audio/mp4";
    case ".ogg":
      return "audio/ogg";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".webm":
      return "audio/webm";
    default:
      return "audio/mpeg";
  }
}

function normalizeVideoModelName(modelName) {
  return String(modelName || "wan2.7-t2v")
    .trim()
    .toLowerCase();
}

function normalizeVideoDuration(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) return 5;

  return Math.max(3, Math.min(15, Math.round(number)));
}

function normalizeWanResolution(value) {
  const raw = String(value || "").toLowerCase();

  if (raw.includes("1080")) return "1080P";
  if (raw.includes("720")) return "720P";

  return "720P";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

app.use((error, req, res, next) => {
  console.error("全局错误：", error);

  res.status(500).json({
    error: "服务器错误",
    detail: error.message
  });
});

app.listen(PORT, () => {
  console.log(`服务已启动：http://localhost:${PORT}`);
  console.log(`当前 mock 模式：${USE_MOCK_TRANSCRIBE}`);
  console.log("Qwen-Audio 配置：", {
    model: QWEN_AUDIO_MODEL,
    confidenceThreshold: SPEAKER_GENDER_CONFIDENCE_THRESHOLD
  });
  console.log("视频生成配置：", {
    model: WAN_VIDEO_MODEL,
    duration: WAN_VIDEO_DURATION,
    ratio: WAN_VIDEO_RATIO,
    resolution: WAN_VIDEO_RESOLUTION
  });
});