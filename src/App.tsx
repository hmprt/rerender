import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SanaStreamingModel } from "@reactor-models/sana-streaming";
import {
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Maximize2,
  MonitorUp,
  Play,
  Square,
  Trash2,
} from "lucide-react";

type StreamAction = "idle" | "busy" | "ready" | "error";

type PromptPreset = {
  id: string;
  label: string;
  prompt: string;
};

type DetachedControlsApi = {
  applyPrompt: () => void;
  chooseCapture: () => void;
  choosePreset: (preset: PromptPreset) => void;
  connect: () => void;
  detachOutput: () => void;
  disconnect: () => void;
  reset: () => void;
  setPrompt: (prompt: string) => void;
  setSeed: (seed: number) => void;
  start: () => void;
  updateAnchorInterval: (chunks: number) => void;
};

type DetachedControlsState = {
  action: StreamAction;
  activePresetId: string;
  anchorInterval: number;
  capturing: boolean;
  detachedOutput: boolean;
  error: string | null;
  keyReady: boolean;
  normalizedReady: boolean;
  outputLive: boolean;
  prompt: string;
  seed: number;
  sourceResolution: string;
  started: boolean;
  status: string;
};

const promptGuardrail =
  "Preserve gameplay readability, camera motion, input timing, HUD placement, silhouettes, interactable objects, and the original scene layout.";

const promptPresets: PromptPreset[] = [
  {
    id: "faithful-remaster",
    label: "Faithful Remaster",
    prompt:
      `Turn this live game feed into a modern faithful remaster. Upgrade materials, lighting, texture detail, shadows, reflections, and color depth while keeping the level geometry, UI, characters, weapons, crosshair, and gameplay cues in the same places. ${promptGuardrail}`,
  },
  {
    id: "cinematic-realism",
    label: "Cinematic",
    prompt:
      `Transform this gameplay into cinematic live-action footage with realistic materials, lens contrast, filmic exposure, natural light, believable atmosphere, and grounded color grading. Keep the original game composition and timing intact. ${promptGuardrail}`,
  },
  {
    id: "source-engine-film",
    label: "Source Film",
    prompt:
      `Reinterpret this Source-engine-style gameplay as a high-budget grounded sci-fi film. Keep the industrial layout, readable corridors, weapons, props, portals, hazards, and player viewpoint stable, but add photographic lighting, concrete texture, glass, metal, dust, and practical set detail. ${promptGuardrail}`,
  },
  {
    id: "anime-cel",
    label: "Anime Cel",
    prompt:
      `Restyle this game feed as crisp anime cel animation with clean linework, expressive color blocking, soft painted backgrounds, readable effects, and stable character silhouettes. Keep the camera, HUD, reticle, projectiles, and level layout aligned with the source gameplay. ${promptGuardrail}`,
  },
  {
    id: "graphic-novel",
    label: "Graphic Novel",
    prompt:
      `Render this live gameplay like a graphic novel panel in motion: inked edges, confident shadows, selective halftone texture, controlled contrast, and dramatic color accents. Do not move HUD elements or invent new geometry. ${promptGuardrail}`,
  },
  {
    id: "clay-render",
    label: "Clay Render",
    prompt:
      `Convert this gameplay into a tactile clay-render diorama with matte surfaces, soft studio lighting, subtle fingerprints, readable props, and miniature-set depth. Keep player motion, collision shapes, UI, enemies, and objectives visually consistent. ${promptGuardrail}`,
  },
  {
    id: "watercolor",
    label: "Watercolor",
    prompt:
      `Style this live game feed as hand-painted watercolor with translucent washes, textured paper, gentle pigment blooms, and softened lighting. Keep high-contrast gameplay information legible and avoid drifting away from the original scene layout. ${promptGuardrail}`,
  },
  {
    id: "retro-box-art",
    label: "Retro Box Art",
    prompt:
      `Make this gameplay look like playable 1990s sci-fi box art: bold airbrushed surfaces, saturated highlights, smoky shadows, dramatic weapon and portal effects, and crisp readable action. Keep the source geometry, camera, UI, and gameplay timing stable. ${promptGuardrail}`,
  },
  {
    id: "low-poly",
    label: "Low Poly",
    prompt:
      `Restyle this live gameplay as a sharp low-poly realtime render with faceted surfaces, chunky readable props, crisp silhouettes, restrained neon rim light, and stable player-facing geometry. Keep HUD elements, reticle, enemies, pickups, traversal paths, and timing aligned with the source. ${promptGuardrail}`,
  },
];

const reactorKeyStorageKey = "sana-game-stream.reactor-key";
const legacyReactrKeyStorageKey = "sana-game-stream.reactr-key";
const normalizedInputWidth = 1280;
const normalizedInputHeight = 720;
const normalizedInputFps = 30;
const reactorKeyUrl = "https://www.reactor.inc/dashboard";
const outputPopoutUrl = "/popout-output.html";
const controlsPopoutUrl = "/popout-controls.html";

async function getJwt(apiKey: string) {
  const response = await fetch("/api/reactor/token", {
    body: JSON.stringify({ apiKey }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "Could not get Reactor token.");
  if (typeof payload.jwt !== "string") throw new Error("Reactor token response did not include a JWT.");
  return payload.jwt as string;
}

function waitForReady(model: SanaStreamingModel, timeoutMs = 120_000) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for SANA to become ready."));
    }, timeoutMs);

    const cleanup = () => {
      window.clearTimeout(timeout);
      model.off("statusChanged", onStatusChanged);
      model.off("error", onError);
    };

    const onStatusChanged = (nextStatus: string) => {
      if (nextStatus === "ready") {
        cleanup();
        resolve();
      }
    };

    const onError = (error: { code?: string; message?: string }) => {
      cleanup();
      reject(new Error(error.message ?? error.code ?? "SANA connection failed."));
    };

    model.on("statusChanged", onStatusChanged);
    model.on("error", onError);
  });
}

function writeDetachedOutputWindow(detachedWindow: Window) {
  detachedWindow.document.open();
  detachedWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>SANA game output</title>
        <style>
          html,
          body {
            background: #050606;
            color: #f4f1ea;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            height: 100%;
            margin: 0;
            overflow: hidden;
          }

          body {
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
          }

          header {
            align-items: center;
            background: #151817;
            border-bottom: 1px solid #292f2b;
            display: flex;
            justify-content: space-between;
            padding: 10px 12px;
          }

          strong {
            font-size: 13px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          span {
            color: #aeb6af;
            font-size: 12px;
          }

          video {
            background: #050606;
            height: 100%;
            object-fit: contain;
            width: 100%;
          }
        </style>
      </head>
      <body>
        <header>
          <strong>SANA Game Output</strong>
          <span>Resize this window freely</span>
        </header>
        <video id="sana-output-video" autoplay muted playsinline></video>
      </body>
    </html>
  `);
  detachedWindow.document.close();
}

function attachDetachedOutput(detachedWindow: Window | null, stream: MediaStream | null) {
  if (!detachedWindow || detachedWindow.closed) return;
  const video = detachedWindow.document.getElementById("sana-output-video") as HTMLVideoElement | null;
  if (!video) return;
  video.srcObject = stream;
  if (stream) void video.play();
}

function whenPopoutReady(detachedWindow: Window, elementId: string, onReady: () => void) {
  let attempts = 0;

  const tryReady = () => {
    if (detachedWindow.closed) return;
    if (detachedWindow.document.getElementById(elementId)) {
      onReady();
      return;
    }
    if (attempts < 80) {
      attempts += 1;
      window.setTimeout(tryReady, 50);
    }
  };

  detachedWindow.addEventListener("load", tryReady, { once: true });
  tryReady();
}

function writeDetachedControlsWindow(detachedWindow: Window) {
  detachedWindow.document.open();
  detachedWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <title>SANA game controls</title>
        <style>
          html,
          body {
            background: #0b0d0c;
            color: #f4f1ea;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            height: 100%;
            margin: 0;
            overflow: hidden;
          }

          body {
            display: grid;
            grid-template-rows: auto auto minmax(0, 1fr);
          }

          header {
            align-items: center;
            background: #151817;
            border-bottom: 1px solid #292f2b;
            display: flex;
            gap: 12px;
            justify-content: space-between;
            padding: 9px 12px;
          }

          strong {
            font-size: 12px;
            letter-spacing: 0.08em;
            text-transform: uppercase;
          }

          #control-status-line {
            color: #aeb6af;
            font-size: 12px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .controlBar {
            align-items: center;
            background: #111512;
            border-bottom: 1px solid #292f2b;
            display: flex;
            gap: 10px;
            min-width: 0;
            overflow-x: auto;
            padding: 10px 12px;
            white-space: nowrap;
          }

          .controlGroup,
          #control-presets {
            align-items: center;
            display: flex;
            flex: 0 0 auto;
            gap: 7px;
          }

          button,
          input,
          textarea {
            font: inherit;
          }

          button {
            align-items: center;
            background: #252b28;
            border: 1px solid #424b45;
            border-radius: 0;
            color: #f7f4ed;
            cursor: pointer;
            display: inline-flex;
            justify-content: center;
            min-height: 32px;
            padding: 0 10px;
          }

          button:hover:not(:disabled) {
            background: #303832;
          }

          button:disabled {
            cursor: not-allowed;
            opacity: 0.48;
          }

          button.active {
            background: #d6cb73;
            border-color: #efe58c;
            color: #11130f;
          }

          label {
            align-items: center;
            color: #aeb6af;
            display: inline-flex;
            font-size: 12px;
            gap: 6px;
          }

          input {
            background: #080a09;
            border: 1px solid #303731;
            border-radius: 0;
            color: #f4f1ea;
            height: 32px;
            padding: 0 8px;
            width: 72px;
          }

          .promptWrap {
            display: grid;
            grid-template-rows: auto minmax(0, 1fr);
            min-height: 0;
            padding: 10px 12px 12px;
          }

          .promptWrap span {
            color: #aeb6af;
            font-size: 11px;
            letter-spacing: 0.08em;
            margin-bottom: 6px;
            text-transform: uppercase;
          }

          textarea {
            background: #080a09;
            border: 1px solid #303731;
            border-radius: 0;
            color: #f4f1ea;
            min-height: 86px;
            outline: none;
            padding: 10px;
            resize: none;
            width: 100%;
          }

          .error {
            color: #ffb0a8;
          }
        </style>
      </head>
      <body>
        <header>
          <strong>SANA Game Controls</strong>
          <span id="control-status-line"></span>
        </header>
        <div class="controlBar">
          <div class="controlGroup">
            <button id="control-capture" type="button"></button>
            <button id="control-connect" type="button">Connect SANA</button>
            <button id="control-start" type="button"></button>
            <button id="control-apply" type="button">Reapply Prompt</button>
            <button id="control-reset" type="button">Reset</button>
            <button id="control-disconnect" type="button">Disconnect</button>
            <button id="control-output" type="button"></button>
          </div>
          <div class="controlGroup">
            <label>Seed <input id="control-seed" min="0" type="number" /></label>
            <label>Anchor <input id="control-anchor" min="0" type="number" /></label>
          </div>
          <div id="control-presets"></div>
        </div>
        <label class="promptWrap">
          <span>Raw prompt</span>
          <textarea id="control-prompt" maxlength="1400"></textarea>
        </label>
      </body>
    </html>
  `);
  detachedWindow.document.close();
}

function bindDetachedControlsWindow(detachedWindow: Window, apiRef: { current: DetachedControlsApi }) {
  const doc = detachedWindow.document;
  doc.getElementById("control-capture")?.addEventListener("click", () => apiRef.current.chooseCapture());
  doc.getElementById("control-connect")?.addEventListener("click", () => apiRef.current.connect());
  doc.getElementById("control-start")?.addEventListener("click", () => apiRef.current.start());
  doc.getElementById("control-apply")?.addEventListener("click", () => apiRef.current.applyPrompt());
  doc.getElementById("control-reset")?.addEventListener("click", () => apiRef.current.reset());
  doc.getElementById("control-disconnect")?.addEventListener("click", () => apiRef.current.disconnect());
  doc.getElementById("control-output")?.addEventListener("click", () => apiRef.current.detachOutput());

  doc.getElementById("control-presets")?.addEventListener("click", (event) => {
    const presetId = event
      .composedPath()
      .map((item) => (item as HTMLElement).dataset?.presetId)
      .find((id): id is string => Boolean(id));
    const preset = promptPresets.find((item) => item.id === presetId);
    if (preset) apiRef.current.choosePreset(preset);
  });

  doc.getElementById("control-seed")?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    apiRef.current.setSeed(Number(target.value));
  });

  doc.getElementById("control-anchor")?.addEventListener("change", (event) => {
    const target = event.target as HTMLInputElement;
    apiRef.current.updateAnchorInterval(Number(target.value));
  });

  doc.getElementById("control-prompt")?.addEventListener("input", (event) => {
    const target = event.target as HTMLTextAreaElement;
    apiRef.current.setPrompt(target.value);
  });
}

function renderDetachedControlsWindow(detachedWindow: Window | null, state: DetachedControlsState) {
  if (!detachedWindow || detachedWindow.closed) return;
  const doc = detachedWindow.document;
  const byId = <T extends HTMLElement>(id: string) => doc.getElementById(id) as T | null;

  const statusLine = byId<HTMLSpanElement>("control-status-line");
  if (statusLine) {
    statusLine.textContent = [
      state.status,
      state.keyReady ? "key ready" : "missing key",
      state.capturing ? "capture ready" : "no capture",
      state.normalizedReady ? state.sourceResolution || "normalized" : "normalizing",
      state.outputLive ? "output live" : "waiting output",
      state.error ? `error: ${state.error}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
    statusLine.classList.toggle("error", Boolean(state.error));
  }

  const captureButton = byId<HTMLButtonElement>("control-capture");
  if (captureButton) captureButton.textContent = state.capturing ? "Change Capture" : "Capture Game";

  const connectButton = byId<HTMLButtonElement>("control-connect");
  if (connectButton) connectButton.disabled = !state.keyReady || state.status === "ready" || state.action === "busy";

  const startButton = byId<HTMLButtonElement>("control-start");
  if (startButton) {
    startButton.textContent = state.started ? "Restart Stream" : "Start Stream";
    startButton.disabled = !state.keyReady || !state.capturing || state.action === "busy";
  }

  const applyButton = byId<HTMLButtonElement>("control-apply");
  if (applyButton) applyButton.disabled = state.status !== "ready";

  const resetButton = byId<HTMLButtonElement>("control-reset");
  if (resetButton) resetButton.disabled = state.status !== "ready";

  const disconnectButton = byId<HTMLButtonElement>("control-disconnect");
  if (disconnectButton) disconnectButton.disabled = state.status === "disconnected";

  const outputButton = byId<HTMLButtonElement>("control-output");
  if (outputButton) outputButton.textContent = state.detachedOutput ? "Focus Output" : "Detach Output";

  const seedInput = byId<HTMLInputElement>("control-seed");
  if (seedInput && seedInput.value !== String(state.seed)) seedInput.value = String(state.seed);

  const anchorInput = byId<HTMLInputElement>("control-anchor");
  if (anchorInput && anchorInput.value !== String(state.anchorInterval)) anchorInput.value = String(state.anchorInterval);

  const promptInput = byId<HTMLTextAreaElement>("control-prompt");
  if (promptInput && promptInput.value !== state.prompt) promptInput.value = state.prompt;

  const presets = byId<HTMLDivElement>("control-presets");
  if (presets) {
    presets.replaceChildren(
      ...promptPresets.map((preset) => {
        const button = doc.createElement("button");
        button.dataset.presetId = preset.id;
        button.className = state.activePresetId === preset.id ? "active" : "";
        button.type = "button";
        button.textContent = preset.label;
        return button;
      }),
    );
  }
}

function drawContain(context: CanvasRenderingContext2D, video: HTMLVideoElement, width: number, height: number) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) return false;

  const scale = Math.min(width / sourceWidth, height / sourceHeight);
  const drawWidth = Math.round(sourceWidth * scale);
  const drawHeight = Math.round(sourceHeight * scale);
  const drawX = Math.round((width - drawWidth) / 2);
  const drawY = Math.round((height - drawHeight) / 2);

  context.fillStyle = "#050606";
  context.fillRect(0, 0, width, height);
  context.drawImage(video, drawX, drawY, drawWidth, drawHeight);
  return true;
}

export function App() {
  const modelRef = useRef<SanaStreamingModel | null>(null);
  const inputVideoRef = useRef<HTMLVideoElement | null>(null);
  const outputVideoRef = useRef<HTMLVideoElement | null>(null);
  const captureStreamRef = useRef<MediaStream | null>(null);
  const captureTrackRef = useRef<MediaStreamTrack | null>(null);
  const normalizedInputStreamRef = useRef<MediaStream | null>(null);
  const normalizedInputTrackRef = useRef<MediaStreamTrack | null>(null);
  const normalizerFrameRef = useRef<number | null>(null);
  const detachedWindowRef = useRef<Window | null>(null);
  const detachedControlsWindowRef = useRef<Window | null>(null);
  const outputStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef("disconnected");
  const startedRef = useRef(false);
  const cameraPublishedRef = useRef(false);
  const lastPromptSentRef = useRef(promptPresets[0].prompt);
  const controlsApiRef = useRef<DetachedControlsApi>({
    applyPrompt: () => undefined,
    chooseCapture: () => undefined,
    choosePreset: () => undefined,
    connect: () => undefined,
    detachOutput: () => undefined,
    disconnect: () => undefined,
    reset: () => undefined,
    setPrompt: () => undefined,
    setSeed: () => undefined,
    start: () => undefined,
    updateAnchorInterval: () => undefined,
  });

  const [status, setStatus] = useState("disconnected");
  const [action, setAction] = useState<StreamAction>("idle");
  const [started, setStarted] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [detached, setDetached] = useState(false);
  const [controlsDetached, setControlsDetached] = useState(false);
  const [sourceResolution, setSourceResolution] = useState("");
  const [normalizedReady, setNormalizedReady] = useState(false);
  const [outputLive, setOutputLive] = useState(false);
  const [activePresetId, setActivePresetId] = useState(promptPresets[0].id);
  const [prompt, setPrompt] = useState(promptPresets[0].prompt);
  const [seed, setSeed] = useState(42);
  const [anchorInterval, setAnchorInterval] = useState(24);
  const [reactorKey, setReactorKey] = useState(
    () => window.localStorage.getItem(reactorKeyStorageKey) ?? window.localStorage.getItem(legacyReactrKeyStorageKey) ?? "",
  );
  const [showReactorKey, setShowReactorKey] = useState(false);
  const [keyPopoverOpen, setKeyPopoverOpen] = useState(false);
  const [savedKey, setSavedKey] = useState(() =>
    Boolean(window.localStorage.getItem(reactorKeyStorageKey) ?? window.localStorage.getItem(legacyReactrKeyStorageKey)),
  );
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<string[]>([]);

  const keyReady = reactorKey.trim().length > 0;
  const promptUsage = `${prompt.length} / 1400`;

  const addEvent = useCallback((message: string) => {
    setEvents((items) => [message, ...items].slice(0, 8));
  }, []);

  useEffect(() => {
    const model = new SanaStreamingModel();
    modelRef.current = model;

    const onStatusChanged = (nextStatus: string) => {
      statusRef.current = nextStatus;
      setStatus(nextStatus);
      addEvent(`status: ${nextStatus}`);
    };

    const onError = (nextError: { code?: string; message?: string }) => {
      setError(nextError.message ?? nextError.code ?? "SANA error");
    };

    const unsubscribeMainVideo = model.onMainVideo((_track, stream) => {
      outputStreamRef.current = stream;
      if (!outputVideoRef.current) return;
      outputVideoRef.current.srcObject = stream;
      void outputVideoRef.current.play();
      attachDetachedOutput(detachedWindowRef.current, stream);
      setOutputLive(true);
      addEvent("main_video received");
    });

    const unsubscribeMessages = model.onMessage((message) => {
      if (message.type === "command_error") {
        setError(`${message.command} failed: ${message.reason}`);
        return;
      }
      if (message.type === "generation_started") {
        startedRef.current = true;
        setStarted(true);
      }
      if (message.type === "generation_reset" || message.type === "generation_complete") {
        startedRef.current = false;
        cameraPublishedRef.current = false;
        setStarted(false);
      }
      addEvent(message.type);
    });

    model.on("statusChanged", onStatusChanged);
    model.on("error", onError);

    return () => {
      unsubscribeMainVideo();
      unsubscribeMessages();
      model.off("statusChanged", onStatusChanged);
      model.off("error", onError);
      void model.disconnect();
      cameraPublishedRef.current = false;
      if (normalizerFrameRef.current !== null) {
        window.cancelAnimationFrame(normalizerFrameRef.current);
      }
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
      normalizedInputStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (detachedWindowRef.current && !detachedWindowRef.current.closed) {
        detachedWindowRef.current.close();
      }
      if (detachedControlsWindowRef.current && !detachedControlsWindowRef.current.closed) {
        detachedControlsWindowRef.current.close();
      }
    };
  }, [addEvent]);

  const saveReactorKey = useCallback(() => {
    const trimmedKey = reactorKey.trim();
    if (!trimmedKey) return;
    window.localStorage.setItem(reactorKeyStorageKey, trimmedKey);
    window.localStorage.removeItem(legacyReactrKeyStorageKey);
    setReactorKey(trimmedKey);
    setSavedKey(true);
    setKeyPopoverOpen(false);
    addEvent("Reactor key saved locally");
  }, [addEvent, reactorKey]);

  const clearReactorKey = useCallback(() => {
    window.localStorage.removeItem(reactorKeyStorageKey);
    window.localStorage.removeItem(legacyReactrKeyStorageKey);
    setReactorKey("");
    setSavedKey(false);
    addEvent("Reactor key cleared");
  }, [addEvent]);

  const ensureReady = useCallback(async () => {
    const model = modelRef.current;
    if (!model) throw new Error("SANA model is not initialized.");
    if (statusRef.current === "ready") return model;

    const apiKey = reactorKey.trim();
    if (!apiKey) throw new Error("Enter a Reactor API key before connecting.");

    setAction("busy");
    setError(null);
    await model.connect(await getJwt(apiKey), { maxAttempts: 12 });
    if (statusRef.current !== "ready") await waitForReady(model);
    setAction("ready");
    return model;
  }, [reactorKey]);

  const connect = useCallback(async () => {
    try {
      await ensureReady();
    } catch (reason) {
      setAction("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [ensureReady]);

  const publishCameraTrack = useCallback(
    async (track: MediaStreamTrack) => {
      const model = modelRef.current;
      if (!model) throw new Error("SANA model is not initialized.");

      if (cameraPublishedRef.current) {
        await model.unpublishCamera().catch(() => undefined);
        cameraPublishedRef.current = false;
      }

      try {
        await model.publishCamera(track);
      } catch (reason) {
        const message = reason instanceof Error ? reason.message : String(reason);
        if (!/already taken/i.test(message)) throw reason;

        await model.unpublishCamera().catch(() => undefined);
        await model.publishCamera(track);
      }

      cameraPublishedRef.current = true;
      addEvent("normalized game track published");
    },
    [addEvent],
  );

  const chooseCapture = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        video: {
          frameRate: { ideal: 30, max: 30 },
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });
      if (normalizerFrameRef.current !== null) {
        window.cancelAnimationFrame(normalizerFrameRef.current);
        normalizerFrameRef.current = null;
      }
      captureStreamRef.current?.getTracks().forEach((track) => track.stop());
      normalizedInputStreamRef.current?.getTracks().forEach((track) => track.stop());
      captureStreamRef.current = stream;
      const rawCaptureTrack = stream.getVideoTracks()[0] ?? null;
      captureTrackRef.current = null;
      normalizedInputTrackRef.current = null;
      setCapturing(Boolean(rawCaptureTrack));
      setNormalizedReady(false);

      if (inputVideoRef.current) {
        inputVideoRef.current.srcObject = stream;
        void inputVideoRef.current.play();
      }

      const normalizerCanvas = document.createElement("canvas");
      normalizerCanvas.width = normalizedInputWidth;
      normalizerCanvas.height = normalizedInputHeight;
      const normalizerContext = normalizerCanvas.getContext("2d", { alpha: false });
      if (!normalizerContext) throw new Error("Could not create the SANA input normalizer.");

      const normalizedStream = normalizerCanvas.captureStream(normalizedInputFps);
      normalizedInputStreamRef.current = normalizedStream;
      normalizedInputTrackRef.current = normalizedStream.getVideoTracks()[0] ?? null;
      captureTrackRef.current = normalizedInputTrackRef.current;

      const drawNormalizedFrame = () => {
        const video = inputVideoRef.current;
        if (video && drawContain(normalizerContext, video, normalizedInputWidth, normalizedInputHeight)) {
          setSourceResolution(`${video.videoWidth}x${video.videoHeight} -> ${normalizedInputWidth}x${normalizedInputHeight}`);
          setNormalizedReady(true);
        }
        normalizerFrameRef.current = window.requestAnimationFrame(drawNormalizedFrame);
      };
      normalizerFrameRef.current = window.requestAnimationFrame(drawNormalizedFrame);

      rawCaptureTrack?.addEventListener("ended", () => {
        if (normalizerFrameRef.current !== null) {
          window.cancelAnimationFrame(normalizerFrameRef.current);
          normalizerFrameRef.current = null;
        }
        setCapturing(false);
        captureTrackRef.current = null;
        normalizedInputTrackRef.current = null;
        setNormalizedReady(false);
      });

      if (statusRef.current === "ready" && startedRef.current && captureTrackRef.current) {
        await publishCameraTrack(captureTrackRef.current);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [publishCameraTrack]);

  const start = useCallback(async () => {
    try {
      const model = await ensureReady();
      const track = captureTrackRef.current;
      if (!track) throw new Error("Choose a game window before starting SANA.");
      if (!normalizedReady) throw new Error("Waiting for the normalized game frame. Try Start Stream again in a second.");

      setAction("busy");
      setError(null);
      await publishCameraTrack(track);
      await model.setSeed({ seed });
      await model.setAnchorInterval({ chunks: anchorInterval });
      await model.setPrompt({ prompt });
      lastPromptSentRef.current = prompt;
      await model.start();
      startedRef.current = true;
      setStarted(true);
      setAction("ready");
      addEvent("SANA started with normalized input");
    } catch (reason) {
      setAction("error");
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, [addEvent, anchorInterval, ensureReady, normalizedReady, prompt, publishCameraTrack, seed]);

  const reset = useCallback(async () => {
    try {
      await modelRef.current?.reset();
      startedRef.current = false;
      cameraPublishedRef.current = false;
      outputStreamRef.current = null;
      setStarted(false);
      setOutputLive(false);
      attachDetachedOutput(detachedWindowRef.current, null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      await modelRef.current?.disconnect();
      statusRef.current = "disconnected";
      startedRef.current = false;
      cameraPublishedRef.current = false;
      outputStreamRef.current = null;
      setStatus("disconnected");
      setStarted(false);
      setOutputLive(false);
      attachDetachedOutput(detachedWindowRef.current, null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  const applyPrompt = useCallback(
    async (nextPrompt = prompt, eventMessage = "prompt applied", force = false) => {
      if (statusRef.current !== "ready") return;
      if (!force && nextPrompt === lastPromptSentRef.current) return;
      lastPromptSentRef.current = nextPrompt;

      try {
        setError(null);
        await modelRef.current?.setPrompt({ prompt: nextPrompt });
        addEvent(eventMessage);
      } catch (reason) {
        lastPromptSentRef.current = "";
        setError(reason instanceof Error ? reason.message : String(reason));
      }
    },
    [addEvent, prompt],
  );

  const updatePrompt = useCallback(
    (nextPrompt: string, nextPresetId = "custom", eventMessage = "prompt live-applied") => {
      setActivePresetId(nextPresetId);
      setPrompt(nextPrompt);
      void applyPrompt(nextPrompt, eventMessage);
    },
    [applyPrompt],
  );

  const choosePreset = useCallback(
    (preset: PromptPreset) => {
      updatePrompt(preset.prompt, preset.id, "preset applied");
    },
    [updatePrompt],
  );

  const updateAnchorInterval = useCallback(
    (nextValue: number) => {
      const nextInterval = Number.isFinite(nextValue) ? Math.max(0, Math.round(nextValue)) : 0;
      setAnchorInterval(nextInterval);
      if (statusRef.current === "ready") {
        void modelRef.current
          ?.setAnchorInterval({ chunks: nextInterval })
          .then(() => addEvent(`anchor chunks: ${nextInterval}`))
          .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
      }
    },
    [addEvent],
  );

  const detachOutput = useCallback(() => {
    const detachedWindow = window.open(
      outputPopoutUrl,
      "sana-game-stream-output",
      "popup=yes,width=960,height=560,resizable=yes,scrollbars=no",
    );

    if (!detachedWindow) {
      setError("The browser blocked the detached output window.");
      return;
    }

    detachedWindowRef.current = detachedWindow;
    whenPopoutReady(detachedWindow, "sana-output-video", () => {
      attachDetachedOutput(detachedWindow, outputStreamRef.current);
    });
    detachedWindow.addEventListener("beforeunload", () => {
      if (detachedWindowRef.current === detachedWindow) {
        detachedWindowRef.current = null;
        setDetached(false);
      }
    });
    detachedWindow.focus();
    setDetached(true);
    addEvent("output detached");
  }, [addEvent]);

  const detachedControlsState = useMemo<DetachedControlsState>(
    () => ({
      action,
      activePresetId,
      anchorInterval,
      capturing,
      detachedOutput: detached,
      error,
      keyReady,
      normalizedReady,
      outputLive,
      prompt,
      seed,
      sourceResolution,
      started,
      status,
    }),
    [
      action,
      activePresetId,
      anchorInterval,
      capturing,
      detached,
      error,
      keyReady,
      normalizedReady,
      outputLive,
      prompt,
      seed,
      sourceResolution,
      started,
      status,
    ],
  );

  controlsApiRef.current = {
    applyPrompt: () => void applyPrompt(prompt, "prompt reapplied", true),
    chooseCapture: () => void chooseCapture(),
    choosePreset,
    connect: () => void connect(),
    detachOutput,
    disconnect: () => void disconnect(),
    reset: () => void reset(),
    setPrompt: (nextPrompt: string) => {
      updatePrompt(nextPrompt);
    },
    setSeed,
    start: () => void start(),
    updateAnchorInterval,
  };

  useEffect(() => {
    const detachedControlsWindow = detachedControlsWindowRef.current;
    if (!detachedControlsWindow) return;
    if (detachedControlsWindow.closed) {
      detachedControlsWindowRef.current = null;
      setControlsDetached(false);
      return;
    }
    renderDetachedControlsWindow(detachedControlsWindow, detachedControlsState);
  }, [detachedControlsState]);

  const detachControls = useCallback(() => {
    const detachedControlsWindow = window.open(
      controlsPopoutUrl,
      "sana-game-stream-controls",
      "popup=yes,width=1500,height=300,resizable=yes,scrollbars=no",
    );

    if (!detachedControlsWindow) {
      setError("The browser blocked the detached controls window.");
      return;
    }

    detachedControlsWindowRef.current = detachedControlsWindow;
    whenPopoutReady(detachedControlsWindow, "control-prompt", () => {
      const boundWindow = detachedControlsWindow as Window & { __sanaControlsBound?: boolean };
      if (!boundWindow.__sanaControlsBound) {
        bindDetachedControlsWindow(detachedControlsWindow, controlsApiRef);
        boundWindow.__sanaControlsBound = true;
      }
      renderDetachedControlsWindow(detachedControlsWindow, detachedControlsState);
    });
    detachedControlsWindow.addEventListener("beforeunload", () => {
      if (detachedControlsWindowRef.current === detachedControlsWindow) {
        detachedControlsWindowRef.current = null;
        setControlsDetached(false);
      }
    });
    detachedControlsWindow.focus();
    setControlsDetached(true);
    addEvent("controls detached");
  }, [addEvent, detachedControlsState]);

  const keyLabel = keyReady ? "Reactor key ready" : "Add Reactor key";
  const sourceLabel = capturing ? "Change Capture" : "Capture Game";
  const startLabel = action === "busy" ? "Starting Stream" : started ? "Restart Stream" : "Start Stream";

  return (
    <main className="sanaApp">
      <header className="labHeader">
        <div className="labBrand">
          <div className="labMark" aria-hidden="true">
            {Array.from({ length: 9 }).map((_, index) => (
            <span key={index} />
          ))}
        </div>
        <div>
          <h1>Neon Chunk Lab</h1>
          <span>Real-time style transfer</span>
        </div>
      </div>
        <div className={`headerStatus ${error ? "error" : status}`}>
          <span title={error ?? undefined}>{error ? "error" : status}</span>
          <button
            aria-expanded={keyPopoverOpen}
            className="keyTrigger"
            onClick={() => setKeyPopoverOpen((open) => !open)}
            type="button"
          >
            <KeyRound size={14} />
            {keyLabel}
          </button>
          {keyPopoverOpen && (
            <section className="keyPopover" aria-label="Reactor key">
              <label className="field">
                <span>Reactor API key</span>
                <div className="keyInputWrap">
                  <input
                    autoComplete="off"
                    onChange={(event) => {
                      setReactorKey(event.target.value);
                      setSavedKey(false);
                    }}
                    placeholder="rk_..."
                    type={showReactorKey ? "text" : "password"}
                    value={reactorKey}
                  />
                  <button
                    aria-label={showReactorKey ? "Hide Reactor key" : "Show Reactor key"}
                    className="iconButton"
                    onClick={() => setShowReactorKey((visible) => !visible)}
                    title={showReactorKey ? "Hide Reactor key" : "Show Reactor key"}
                    type="button"
                  >
                    {showReactorKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </label>
              <div className="keyActions">
                <button disabled={!keyReady} onClick={saveReactorKey} type="button">
                  <KeyRound size={16} />
                  {savedKey ? "Saved" : "Save"}
                </button>
                <button disabled={!reactorKey && !savedKey} onClick={clearReactorKey} type="button">
                  <Trash2 size={16} />
                  Clear
                </button>
                <a href={reactorKeyUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={16} />
                  Get Key
                </a>
              </div>
            </section>
          )}
        </div>
      </header>

      <aside className="controlPanel">
        <section className="panelBlock styleBlock" aria-label="Style">
          <h2>Style</h2>
          <label className="field">
            <span>Preset</span>
            <select
              onChange={(event) => {
                const preset = promptPresets.find((item) => item.id === event.target.value);
                if (preset) choosePreset(preset);
              }}
              value={activePresetId}
            >
              {promptPresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field promptField">
            <span>Prompt</span>
            <textarea
              maxLength={1400}
              onChange={(event) => {
                updatePrompt(event.target.value);
              }}
              value={prompt}
            />
          </label>
          <div className="promptActions">
            <span>{promptUsage}</span>
            <button disabled={status !== "ready"} onClick={() => void applyPrompt(prompt, "prompt reapplied", true)} type="button">
              Apply Style
            </button>
          </div>
        </section>

        <section className="panelBlock settingsBlock" aria-label="Settings">
          <h2>Settings</h2>
          <div className="row tuningRow">
            <label className="field small">
              <span>Seed</span>
              <input min={0} onChange={(event) => setSeed(Number(event.target.value))} type="number" value={seed} />
            </label>
            <label className="field small">
              <span>Anchor chunks</span>
              <input
                min={0}
                onChange={(event) => updateAnchorInterval(Number(event.target.value))}
                type="number"
                value={anchorInterval}
              />
            </label>
          </div>
        </section>
      </aside>

      <section className="stage">
        <div className="previewPane inputPreview">
          <span>
            <span>
              Captured game
              <em>source</em>
            </span>
            {capturing && (
              <span className="previewTools">
                <button aria-label="Change capture" onClick={chooseCapture} title="Change capture" type="button">
                  <MonitorUp size={14} />
                </button>
              </span>
            )}
          </span>
          <video muted playsInline ref={inputVideoRef} />
          {!capturing && (
            <div className="empty">
              <button className="paneAction" onClick={chooseCapture} type="button">
                <MonitorUp size={18} />
                {sourceLabel}
              </button>
            </div>
          )}
        </div>
        <div className="previewPane outputPreview">
          <span>
            <span>
              SANA output
              <em>output</em>
            </span>
            <span className="previewTools">
              <button aria-label="Detach output" onClick={detachOutput} title="Detach output" type="button">
                <Maximize2 size={14} />
              </button>
            </span>
          </span>
          <video muted playsInline ref={outputVideoRef} />
          {!outputLive && (
            <div className="empty">
              <Square size={34} />
              <button
                className="paneAction"
                disabled={!keyReady || !capturing || action === "busy"}
                onClick={start}
                type="button"
              >
                {action === "busy" ? <Loader2 className="spin" size={18} /> : <Play size={18} />}
                {startLabel}
              </button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
