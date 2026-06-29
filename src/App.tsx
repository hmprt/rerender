import { type CSSProperties, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SanaStreamingModel } from "@reactor-models/sana-streaming";
import {
  ExternalLink,
  Eye,
  EyeOff,
  Github,
  KeyRound,
  Loader2,
  Maximize2,
  MonitorUp,
  Pencil,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

type StreamAction = "idle" | "busy" | "ready" | "error";

type PromptPreset = {
  anchorInterval: number;
  id: string;
  label: string;
  prompt: string;
  seed: number;
};

type SavedPrompt = {
  anchorInterval: number;
  id: string;
  name: string;
  prompt: string;
  seed: number;
  updatedAt: number;
};

type DetachedControlsApi = {
  applyPrompt: () => void;
  chooseCapture: () => void;
  choosePromptById: (promptId: string) => void;
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
  promptChoices: PromptPreset[];
  seed: number;
  sourceResolution: string;
  started: boolean;
  status: string;
};

const promptPresets: PromptPreset[] = [
  {
    anchorInterval: 24,
    id: "moebius",
    label: "MOEBIUS",
    prompt: "Detailed Line Drawing. Perfect shading. Masterwork. Pastel Colors. Moebius.",
    seed: 42,
  },
  {
    anchorInterval: 24,
    id: "demake",
    label: "DEMAKE",
    prompt: "Pixelate this game beautifully, like a 16-bit SNES game.",
    seed: 42,
  },
  {
    anchorInterval: 24,
    id: "okami",
    label: "OKAMI",
    prompt: "Edit the underlying stream in the Style of Okami, preserving the controllability of the stream.",
    seed: 42,
  },
];

const reactorKeyStorageKey = "sana-game-stream.reactor-key";
const legacyReactrKeyStorageKey = "sana-game-stream.reactr-key";
const savedPromptsStorageKey = "rerender.saved-prompts.v2";
const savedPromptsSchemaStorageKey = "rerender.saved-prompts.schema";
const savedPromptsSchemaVersion = "default-styles-moebius-demake-okami-1";
const deletedBasePromptsStorageKey = "rerender.deleted-base-prompts.v2";
const deletedBasePromptsSchemaStorageKey = "rerender.deleted-base-prompts.schema";
const deletedBasePromptsSchemaVersion = "default-styles-moebius-demake-okami-1";
const normalizedInputWidth = 1280;
const normalizedInputHeight = 720;
const normalizedInputFps = 30;
const reactorKeyUrl = "https://www.reactor.inc/dashboard";
const githubUrl = "https://github.com/hmprt/rerender";
const psRemotePlayUrl = "https://www.playstation.com/en-us/remote-play/";
const xUrl = "https://x.com/npceo_";
const outputPopoutUrl = "/popout-output.html";
const controlsPopoutUrl = "/popout-controls.html";
const controlPanelWidthStorageKey = "rerender.control-panel-width";
const minControlPanelWidth = 300;
const maxControlPanelWidth = 520;
const minStageWidth = 520;
const maxSeed = 999_999_999;
const anchorChunkMin = 1;
const anchorChunkStep = 1;
const anchorChunkMax = 96;
const basePromptRecords: SavedPrompt[] = promptPresets.map((preset) => ({
  anchorInterval: preset.anchorInterval,
  id: preset.id,
  name: preset.label,
  prompt: preset.prompt,
  seed: preset.seed,
  updatedAt: 0,
}));
const basePromptIds = new Set(basePromptRecords.map((preset) => preset.id));

function readSavedPrompts() {
  if (window.localStorage.getItem(savedPromptsSchemaStorageKey) !== savedPromptsSchemaVersion) return [];

  const stored = window.localStorage.getItem(savedPromptsStorageKey);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as SavedPrompt[];
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(
        (item): item is SavedPrompt =>
          typeof item?.id === "string" &&
          typeof item.name === "string" &&
          typeof item.prompt === "string" &&
          typeof item.seed === "number" &&
          typeof item.anchorInterval === "number" &&
          typeof item.updatedAt === "number",
      )
      .slice(0, 30);
  } catch {
    return [];
  }
}

function readDeletedBasePromptIds() {
  if (window.localStorage.getItem(deletedBasePromptsSchemaStorageKey) !== deletedBasePromptsSchemaVersion) {
    return [];
  }

  const stored = window.localStorage.getItem(deletedBasePromptsStorageKey);
  if (!stored) return [];

  try {
    const parsed = JSON.parse(stored) as string[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id) => typeof id === "string" && basePromptIds.has(id));
  } catch {
    return [];
  }
}

function makeSavedPromptId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `prompt-${Date.now()}`;
}

function clampControlPanelWidth(width: number, viewportWidth = window.innerWidth) {
  const viewportMax = Math.max(minControlPanelWidth, Math.min(maxControlPanelWidth, viewportWidth - minStageWidth));
  return Math.round(Math.min(viewportMax, Math.max(minControlPanelWidth, width)));
}

function readControlPanelWidth() {
  const stored = Number(window.localStorage.getItem(controlPanelWidthStorageKey));
  return clampControlPanelWidth(Number.isFinite(stored) && stored > 0 ? stored : 348);
}

function snapAnchorChunks(value: number) {
  const finiteValue = Number.isFinite(value) ? value : anchorChunkMin;
  const snapped = Math.round((finiteValue - anchorChunkMin) / anchorChunkStep) * anchorChunkStep + anchorChunkMin;
  return clampAnchorChunks(snapped);
}

function clampAnchorChunks(value: number) {
  const finiteValue = Number.isFinite(value) ? value : anchorChunkMin;
  return Math.min(anchorChunkMax, Math.max(anchorChunkMin, Math.round(finiteValue)));
}

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
        <title>Rerender output</title>
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
          <strong>Rerender Output</strong>
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
        <title>Rerender controls</title>
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
          <strong>Rerender Controls</strong>
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
            <label>Anchor <input id="control-anchor" min="${anchorChunkMin}" type="number" /></label>
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
    if (presetId) apiRef.current.choosePromptById(presetId);
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
      ...state.promptChoices.map((preset) => {
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
  const promptLibraryInitializedRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const controlsApiRef = useRef<DetachedControlsApi>({
    applyPrompt: () => undefined,
    chooseCapture: () => undefined,
    choosePromptById: () => undefined,
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
  const [promptName, setPromptName] = useState(promptPresets[0].label);
  const [seed, setSeed] = useState(promptPresets[0].seed);
  const [anchorInterval, setAnchorInterval] = useState(promptPresets[0].anchorInterval);
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const [savedPrompts, setSavedPrompts] = useState<SavedPrompt[]>(readSavedPrompts);
  const [deletedBasePromptIds, setDeletedBasePromptIds] = useState<string[]>(readDeletedBasePromptIds);
  const [controlPanelWidth, setControlPanelWidth] = useState(readControlPanelWidth);

  const keyReady = reactorKey.trim().length > 0;
  const promptUsage = `${prompt.length} / 1400`;
  const promptLibrary = useMemo(() => {
    const savedById = new Map(savedPrompts.map((item) => [item.id, item]));
    const visibleBasePrompts = basePromptRecords
      .filter((item) => !deletedBasePromptIds.includes(item.id))
      .map((item) => savedById.get(item.id) ?? item);
    const customPrompts = savedPrompts.filter((item) => !basePromptIds.has(item.id));
    return [...visibleBasePrompts, ...customPrompts].slice(0, 50);
  }, [deletedBasePromptIds, savedPrompts]);
  const activePrompt = useMemo(
    () => promptLibrary.find((item) => item.id === activePresetId) ?? null,
    [activePresetId, promptLibrary],
  );
  const promptChoices = useMemo<PromptPreset[]>(
    () =>
      promptLibrary.map((item) => ({
        anchorInterval: item.anchorInterval,
        id: item.id,
        label: item.name,
        prompt: item.prompt,
        seed: item.seed,
      })),
    [promptLibrary],
  );
  const isBasePromptActive = basePromptIds.has(activePresetId);

  const addEvent = useCallback((message: string) => {
    setEvents((items) => [message, ...items].slice(0, 8));
  }, []);

  const playClickTick = useCallback(() => {
    const AudioContextCtor =
      window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();

    const oscillator = context.createOscillator();
    const secondOscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "triangle";
    secondOscillator.type = "sine";
    oscillator.frequency.setValueAtTime(580, now);
    oscillator.frequency.exponentialRampToValueAtTime(410, now + 0.045);
    secondOscillator.frequency.setValueAtTime(290, now);
    secondOscillator.frequency.exponentialRampToValueAtTime(230, now + 0.045);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.032, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);
    oscillator.connect(gain);
    secondOscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    secondOscillator.start(now + 0.006);
    oscillator.stop(now + 0.058);
    secondOscillator.stop(now + 0.048);
  }, []);

  const handleUiPointerDownCapture = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      const control = target?.closest("button,a");
      if (!control) return;
      if (control instanceof HTMLButtonElement && control.disabled) return;
      if (control.getAttribute("aria-disabled") === "true") return;
      playClickTick();
    },
    [playClickTick],
  );

  const appStyle = useMemo(
    () =>
      ({
        "--control-panel-width": `${controlPanelWidth}px`,
      }) as CSSProperties,
    [controlPanelWidth],
  );

  const beginControlPanelResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = controlPanelWidth;
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("resizingControlPanel");

      const resize = (moveEvent: globalThis.PointerEvent) => {
        setControlPanelWidth(clampControlPanelWidth(startWidth + moveEvent.clientX - startX, window.innerWidth));
      };

      const stopResize = (upEvent: globalThis.PointerEvent) => {
        window.removeEventListener("pointermove", resize);
        window.removeEventListener("pointerup", stopResize);
        document.body.classList.remove("resizingControlPanel");
        if (handle.hasPointerCapture(upEvent.pointerId)) handle.releasePointerCapture(upEvent.pointerId);
      };

      window.addEventListener("pointermove", resize);
      window.addEventListener("pointerup", stopResize, { once: true });
    },
    [controlPanelWidth],
  );

  useEffect(() => {
    if (window.localStorage.getItem(savedPromptsSchemaStorageKey) !== savedPromptsSchemaVersion) {
      window.localStorage.setItem(savedPromptsSchemaStorageKey, savedPromptsSchemaVersion);
      setSavedPrompts([]);
      return;
    }

    window.localStorage.setItem(savedPromptsStorageKey, JSON.stringify(savedPrompts));
  }, [savedPrompts]);

  useEffect(() => {
    window.localStorage.setItem(controlPanelWidthStorageKey, String(controlPanelWidth));
  }, [controlPanelWidth]);

  useEffect(() => {
    window.localStorage.setItem(deletedBasePromptsSchemaStorageKey, deletedBasePromptsSchemaVersion);
    window.localStorage.setItem(deletedBasePromptsStorageKey, JSON.stringify(deletedBasePromptIds));
  }, [deletedBasePromptIds]);

  useEffect(() => {
    if (promptLibraryInitializedRef.current) return;
    const initialPrompt = promptLibrary.find((item) => item.id === activePresetId) ?? promptLibrary[0] ?? null;
    if (!initialPrompt) return;
    promptLibraryInitializedRef.current = true;
    setActivePresetId(initialPrompt.id);
    setPromptName(initialPrompt.name);
    setPrompt(initialPrompt.prompt);
    setSeed(initialPrompt.seed);
    setAnchorInterval(initialPrompt.anchorInterval);
  }, [activePresetId, promptLibrary]);

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
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
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

  const updateSeed = useCallback(
    (nextValue: number) => {
      const nextSeed = Number.isFinite(nextValue) ? Math.min(maxSeed, Math.max(0, Math.round(nextValue))) : 0;
      setSeed(nextSeed);
      if (statusRef.current === "ready") {
        void modelRef.current
          ?.setSeed({ seed: nextSeed })
          .then(() => addEvent(`seed: ${nextSeed}`))
          .catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
      }
    },
    [addEvent],
  );

  const updateAnchorInterval = useCallback(
    (nextValue: number, snap = false) => {
      const nextInterval = snap ? snapAnchorChunks(nextValue) : clampAnchorChunks(nextValue);
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

  const loadPrompt = useCallback(
    (nextPrompt: SavedPrompt | PromptPreset) => {
      const nextName = "name" in nextPrompt ? nextPrompt.name : nextPrompt.label;
      setActivePresetId(nextPrompt.id);
      setPromptName(nextName);
      updatePrompt(nextPrompt.prompt, nextPrompt.id, "prompt loaded");
      updateSeed(nextPrompt.seed);
      updateAnchorInterval(nextPrompt.anchorInterval);
    },
    [updateAnchorInterval, updatePrompt, updateSeed],
  );

  const choosePreset = useCallback(
    (preset: PromptPreset) => {
      loadPrompt(preset);
    },
    [loadPrompt],
  );

  const selectPrompt = useCallback(
    (nextId: string) => {
      const nextPrompt = promptLibrary.find((item) => item.id === nextId);
      if (nextPrompt) loadPrompt(nextPrompt);
    },
    [loadPrompt, promptLibrary],
  );

  const saveCurrentPrompt = useCallback(() => {
    const now = Date.now();
    const name = promptName.trim() || activePrompt?.name || "Untitled Prompt";
    const id = activePrompt ? activePrompt.id : makeSavedPromptId();
    const nextSavedPrompt: SavedPrompt = {
      anchorInterval,
      id,
      name,
      prompt,
      seed,
      updatedAt: now,
    };

    setSavedPrompts((items) => {
      const withoutCurrent = items.filter((item) => item.id !== id);
      return basePromptIds.has(id) ? [...withoutCurrent, nextSavedPrompt] : [nextSavedPrompt, ...withoutCurrent].slice(0, 50);
    });
    setDeletedBasePromptIds((ids) => ids.filter((item) => item !== id));
    setActivePresetId(id);
    setPromptName(name);
    addEvent(activePrompt ? "prompt saved" : "prompt created");
  }, [activePrompt, addEvent, anchorInterval, prompt, promptName, seed]);

  const createPrompt = useCallback(() => {
    const id = makeSavedPromptId();
    const baseName = promptName.trim() || activePrompt?.name || "Untitled Prompt";
    const name = `${baseName} Copy`;
    const nextSavedPrompt: SavedPrompt = {
      anchorInterval,
      id,
      name,
      prompt,
      seed,
      updatedAt: Date.now(),
    };

    setSavedPrompts((items) => [nextSavedPrompt, ...items].slice(0, 50));
    setActivePresetId(id);
    setPromptName(name);
    addEvent("prompt created");
  }, [activePrompt, addEvent, anchorInterval, prompt, promptName, seed]);

  const renamePrompt = useCallback(() => {
    if (!activePrompt) return;
    const name = promptName.trim();
    if (!name) return;
    const renamedPrompt: SavedPrompt = {
      anchorInterval,
      id: activePrompt.id,
      name,
      prompt,
      seed,
      updatedAt: Date.now(),
    };

    setSavedPrompts((items) => {
      const withoutCurrent = items.filter((item) => item.id !== activePrompt.id);
      return basePromptIds.has(activePrompt.id) ? [...withoutCurrent, renamedPrompt] : [renamedPrompt, ...withoutCurrent];
    });
    setDeletedBasePromptIds((ids) => ids.filter((item) => item !== activePrompt.id));
    setPromptName(name);
    addEvent("prompt renamed");
  }, [activePrompt, addEvent, anchorInterval, prompt, promptName, seed]);

  const deletePrompt = useCallback(() => {
    if (!activePrompt) return;
    const deletedId = activePrompt.id;
    const remainingPrompts = promptLibrary.filter((item) => item.id !== deletedId);
    const nextPrompt = remainingPrompts[0] ?? null;

    setSavedPrompts((items) => items.filter((item) => item.id !== deletedId));
    if (basePromptIds.has(deletedId)) {
      setDeletedBasePromptIds((ids) => (ids.includes(deletedId) ? ids : [...ids, deletedId]));
    }

    if (nextPrompt) {
      loadPrompt(nextPrompt);
    } else {
      setActivePresetId("custom");
      setPromptName("Untitled Prompt");
      updatePrompt("", "custom", "prompt cleared");
      updateSeed(promptPresets[0].seed);
      updateAnchorInterval(promptPresets[0].anchorInterval);
    }
    addEvent(isBasePromptActive ? "base prompt deleted" : "prompt deleted");
  }, [activePrompt, addEvent, isBasePromptActive, loadPrompt, promptLibrary, updateAnchorInterval, updatePrompt, updateSeed]);

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
      promptChoices,
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
      promptChoices,
      seed,
      sourceResolution,
      started,
      status,
    ],
  );

  controlsApiRef.current = {
    applyPrompt: () => void applyPrompt(prompt, "prompt reapplied", true),
    chooseCapture: () => void chooseCapture(),
    choosePromptById: (promptId: string) => {
      const preset = promptChoices.find((item) => item.id === promptId);
      if (preset) choosePreset(preset);
    },
    choosePreset,
    connect: () => void connect(),
    detachOutput,
    disconnect: () => void disconnect(),
    reset: () => void reset(),
    setPrompt: (nextPrompt: string) => {
      updatePrompt(nextPrompt, activePresetId);
    },
    setSeed: updateSeed,
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
  const sourceLabel = capturing ? "Change Input Source" : "Select Input Source";
  const startLabel = action === "busy" ? "Starting Stream" : started ? "Restart Stream" : "Start Stream";

  return (
    <main className="sanaApp" onPointerDownCapture={handleUiPointerDownCapture} style={appStyle}>
      <header className="labHeader">
        <div className="labBrand">
          <img className="brandLogo" src="/rerender-logo.svg" alt="rerender.app - Powered by Reactor" />
          <h1 className="srOnly">rerender.app</h1>
        </div>
        <div className={`headerStatus ${error ? "error" : status}`}>
          <div className="tutorialShell">
            <button
              aria-expanded={tutorialOpen}
              className={`tutorialTab ${tutorialOpen ? "active" : ""}`}
              onClick={() => {
                setTutorialOpen((open) => !open);
                setKeyPopoverOpen(false);
              }}
              type="button"
            >
              Tutorial
            </button>
            {tutorialOpen && (
              <section className="tutorialPopover" aria-label="Tutorial">
                <h2>Quick Start</h2>
                <ol>
                  <li>Add a Reactor key.</li>
                  <li>Select a game, capture card, OBS, or Remote Play window.</li>
                  <li>Choose a style prompt, then set seed and anchor chunks.</li>
                  <li>Start the stream and keep the source window visible.</li>
                </ol>
                <p>PlayStation users can run the console feed through Sony's Remote Play app.</p>
                <a href={psRemotePlayUrl} rel="noreferrer" target="_blank">
                  <ExternalLink size={15} />
                  Download PS Remote Play
                </a>
              </section>
            )}
          </div>
          <nav className="socialLinks" aria-label="Project links">
            <a aria-label="Open Rerender on GitHub" className="iconLink" href={githubUrl} rel="noreferrer" target="_blank">
              <Github size={15} />
            </a>
            <a aria-label="Open X profile" className="iconLink xIconLink" href={xUrl} rel="noreferrer" target="_blank">
              <svg aria-hidden="true" className="xLogo" viewBox="0 0 24 24">
                <path
                  d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.63 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93 6.07-6.93Zm-1.29 19.49h2.04L6.49 3.24H4.3l13.31 17.4Z"
                  fill="currentColor"
                />
              </svg>
            </a>
          </nav>
          <span title={error ?? undefined}>{error ? "error" : status}</span>
          <button
            aria-expanded={keyPopoverOpen}
            className={`keyTrigger ${keyReady ? "keyReady" : "keyMissing"}`}
            onClick={() => {
              setKeyPopoverOpen((open) => !open);
              setTutorialOpen(false);
            }}
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
          <div className="blockTitleRow">
            <h2>Style</h2>
            <button
              aria-expanded={helpOpen}
              className="helpTrigger"
              onClick={() => setHelpOpen((open) => !open)}
              type="button"
            >
              [ Help ]
            </button>
            {helpOpen && (
              <section className="helpPopover" aria-label="SANA 2 prompting guidelines">
                <strong>SANA 2 prompting</strong>
                <p>
                  Start with what should remain stable, then describe the target look. For game streams, name the
                  gameplay invariants directly: camera motion, HUD, reticle, silhouettes, weapons, UI, traversal paths,
                  timing, and interactable objects.
                </p>
                <p>
                  Use concrete visual nouns instead of mood alone: materials, lighting, lens, texture, color grade,
                  atmosphere, edge style, and render medium. Keep one dominant style per prompt, then add a short
                  preservation clause. Avoid asking for new geometry, different characters, or composition changes unless
                  you want drift.
                </p>
                <p>
                  If output flickers, make the prompt more faithful and raise anchor chunks. If it feels too conservative,
                  lower anchor chunks or make the style language more specific.
                </p>
              </section>
            )}
          </div>
          <section className="promptLibrary" aria-label="Prompts">
            <div className="libraryTopline">
              <span>Prompts</span>
              <span>{promptLibrary.length}</span>
            </div>
            <label className="field libraryField">
              <span>Current</span>
              <select
                aria-label="Select prompt"
                disabled={promptLibrary.length === 0}
                onChange={(event) => selectPrompt(event.target.value)}
                value={activePrompt ? activePresetId : ""}
              >
                {promptLibrary.length === 0 ? (
                  <option value="">No prompts</option>
                ) : (
                  <>
                    <option disabled value="">
                      Choose prompt
                    </option>
                    {promptLibrary.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </label>
            <label className="field libraryField">
              <span>Name</span>
              <input
                aria-label="Prompt name"
                onChange={(event) => setPromptName(event.target.value)}
                placeholder="Prompt name"
                value={promptName}
              />
            </label>
            <div className="libraryActions">
              <button disabled={!prompt.trim()} onClick={saveCurrentPrompt} type="button">
                <Save size={14} />
                Save
              </button>
              <button disabled={!prompt.trim()} onClick={createPrompt} type="button">
                <Plus size={14} />
                New
              </button>
              <button disabled={!activePrompt || !promptName.trim()} onClick={renamePrompt} type="button">
                <Pencil size={14} />
                Rename
              </button>
              <button disabled={!activePrompt} onClick={deletePrompt} type="button">
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </section>
          <label className="field promptField">
            <span>Prompt</span>
            <textarea
              maxLength={1400}
              onChange={(event) => {
                updatePrompt(event.target.value, activePresetId);
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
          <div className="sliderStack">
            <label className="field seedInputField">
              <span>Seed</span>
              <input
                inputMode="numeric"
                max={maxSeed}
                min={0}
                onChange={(event) => updateSeed(Number(event.target.value))}
                type="number"
                value={seed}
              />
            </label>
            <div className="sliderField anchorField">
              <label className="anchorNumberField" htmlFor="anchor-chunks-input">
                <span>Anchor chunks</span>
                <input
                  id="anchor-chunks-input"
                  inputMode="numeric"
                  max={anchorChunkMax}
                  min={anchorChunkMin}
                  onChange={(event) => updateAnchorInterval(Number(event.target.value))}
                  type="number"
                  value={anchorInterval}
                />
              </label>
              <input
                aria-label="Anchor chunks slider"
                min={anchorChunkMin}
                max={anchorChunkMax}
                onChange={(event) => updateAnchorInterval(Number(event.target.value), true)}
                step={anchorChunkStep}
                type="range"
                value={anchorInterval}
              />
            </div>
          </div>
        </section>
      </aside>

      <button
        aria-label="Resize control panel"
        aria-orientation="vertical"
        aria-valuemax={maxControlPanelWidth}
        aria-valuemin={minControlPanelWidth}
        aria-valuenow={controlPanelWidth}
        className="panelResizeHandle"
        onPointerDown={beginControlPanelResize}
        role="separator"
        title="Drag to resize controls"
        type="button"
      >
        <span aria-hidden="true" />
      </button>

      <section className="stage">
        <div className="previewPane inputPreview">
          <span>
            <span>
              Captured game
              <em>source</em>
            </span>
            {capturing && (
              <span className="previewTools">
                <button aria-label="Change input source" onClick={chooseCapture} title="Change input source" type="button">
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
