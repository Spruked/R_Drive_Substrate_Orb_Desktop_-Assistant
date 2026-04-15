import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const toJulianDate = (epochMs) => epochMs / 86400000 + 2440587.5;
const toClock = (epochMs) => new Date(epochMs).toTimeString().slice(0, 8);
const toNumberOr = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const truncate = (value, max = 26) => {
  const text = String(value ?? "unknown");
  return text.length > max ? `${text.slice(0, max)}...` : text;
};
const STATION_CONFIG_KEY = "orb.dock.station.config.v1";
const safeReadJson = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
};

const INITIAL_TELEMETRY = {
  systemHealth: 0,
  coreIntegrity: 0,
  uptimeSeconds: 0,
  epochTime: Date.now(),
  julianDate: toJulianDate(Date.now()),
  activeLLM: "unknown",
  llmLatency: 0,
  llmSuccessRate: 0,
  governanceIntegrity: 0,
  complianceScore: 0,
  confidenceWeight: 0,
  consensusIndex: 0,
  driftLevel: 0,
  anomalies: 0,
  responseSpeed: 0,
  throughput: 0,
  efficiency: 0,
  memUsage: 0,
  cpuLoad: 0,
  networkActivity: 0,
  instanceId: "unknown",
  controllerStatus: "unknown",
  listeningEnabled: false,
  autoListen: false,
  presenceRunning: false,
  presenceIdle: false,
  idleSeconds: 0,
  activeWindow: "unknown",
  activeProcess: "unknown",
  lastEvent: "boot",
  cognitiveMode: "UNKNOWN",
  autonomyLevel: 0,
  confidenceState: 0,
  presenceSchemaVersion: "n/a",
  presenceTs: 0,
  device: "unknown",
  vramGb: 0,
  encoderBackend: "unknown",
  knowledgeGraphNodes: 0,
  knowledgeGraphEdges: 0,
  interactionCount: 0,
  projectRoot: "n/a",
  systemRoot: "n/a",
  sharedMeshRoot: "n/a",
  swarmRunning: false,
  orbVisible: true,
  events: [],
};

function useTelemetry() {
  const bootRef = useRef(Date.now());
  const nextId = useRef(1);
  const statsRef = useRef({ total: 0, ok: 0, err: 0 });
  const lastIdleRef = useRef(null);
  const lastRunningRef = useRef(null);
  const lastControllerRef = useRef(null);
  const [t, setT] = useState(() => ({
    ...INITIAL_TELEMETRY,
    events: [
      {
        id: 0,
        time: toClock(Date.now()),
        type: "INFO",
        msg: "Dock station connected. Awaiting bridge telemetry.",
      },
    ],
  }));

  const pushEvent = useCallback((type, msg) => {
    setT((prev) => {
      const events = [
        {
          id: nextId.current++,
          time: toClock(Date.now()),
          type,
          msg,
        },
        ...prev.events,
      ].slice(0, 20);
      return { ...prev, events };
    });
  }, []);

  const applyReliability = useCallback(() => {
    setT((prev) => {
      const total = Math.max(0, statsRef.current.total);
      const success = total > 0 ? (statsRef.current.ok / total) * 100 : 0;
      return {
        ...prev,
        llmSuccessRate: clamp(success, 0, 100),
        anomalies: statsRef.current.err,
        efficiency: clamp(success, 0, 100),
      };
    });
  }, []);

  const markSuccess = useCallback(() => {
    statsRef.current.total += 1;
    statsRef.current.ok += 1;
    applyReliability();
  }, [applyReliability]);

  const markError = useCallback(() => {
    statsRef.current.total += 1;
    statsRef.current.err += 1;
    applyReliability();
  }, [applyReliability]);

  const applyStatus = useCallback(
    (status, source = "status_sync") => {
      if (!status || typeof status !== "object") {
        return;
      }

      const presence = status.desktop_presence || {};
      const presenceSnapshot =
        status.presence_update && typeof status.presence_update === "object"
          ? status.presence_update
          : null;

      const running = Boolean(status.running);
      const controllerStatus = String(status.controller_status || "unknown");
      const controllerReady = ["active", "ready"].includes(
        controllerStatus.toLowerCase()
      );

      const snapshotIdle = presenceSnapshot
        ? Boolean(presenceSnapshot.idle)
        : Boolean(presence.is_idle);
      const snapshotIdleSeconds = presenceSnapshot
        ? Math.max(0, toNumberOr(presenceSnapshot.idle_seconds, 0))
        : Math.max(0, toNumberOr(presence.idle_seconds, 0));
      const caliStatus = status.cali_status || {};
      const activeModel = caliStatus.identity || status.active_llm || "unknown";
      const confidenceRaw = presenceSnapshot
        ? toNumberOr(presenceSnapshot.confidence_state, 0)
        : 0;
      const autonomyRaw = presenceSnapshot
        ? toNumberOr(presenceSnapshot.autonomy_level, 0)
        : 0;

      setT((prev) => ({
        ...prev,
        systemHealth: running ? (controllerReady ? 100 : 72) : 0,
        coreIntegrity: controllerReady ? 100 : running ? 70 : 0,
        activeLLM: String(activeModel),
        governanceIntegrity: running && controllerReady ? 100 : 0,
        complianceScore: running ? 100 : 0,
        driftLevel: 0,
        throughput: toNumberOr(caliStatus.interaction_count, prev.throughput),
        responseSpeed: prev.responseSpeed,
        networkActivity: prev.networkActivity,
        instanceId: String(status.instance_id || prev.instanceId || "unknown"),
        controllerStatus,
        listeningEnabled: Boolean(status.listening_enabled),
        autoListen: Boolean(status.auto_listen),
        presenceRunning: Boolean(presence.running),
        presenceIdle: snapshotIdle,
        idleSeconds: Math.round(snapshotIdleSeconds),
        activeWindow: presenceSnapshot
          ? String(presenceSnapshot.active_window || prev.activeWindow || "unknown")
          : prev.activeWindow,
        activeProcess: presenceSnapshot
          ? String(presenceSnapshot.active_process || prev.activeProcess || "unknown")
          : prev.activeProcess,
        lastEvent: presenceSnapshot
          ? String(presenceSnapshot.last_event || prev.lastEvent || "presence")
          : prev.lastEvent,
        cognitiveMode: presenceSnapshot
          ? String(presenceSnapshot.cognitive_mode || prev.cognitiveMode || "DEDUCTIVE")
          : prev.cognitiveMode,
        autonomyLevel: clamp(
          presenceSnapshot ? autonomyRaw : prev.autonomyLevel,
          0,
          1
        ),
        confidenceState: clamp(
          presenceSnapshot ? confidenceRaw : prev.confidenceState,
          0,
          1
        ),
        presenceSchemaVersion: presenceSnapshot
          ? String(presenceSnapshot.schema_version || prev.presenceSchemaVersion || "1.0")
          : prev.presenceSchemaVersion,
        presenceTs: presenceSnapshot
          ? toNumberOr(presenceSnapshot.ts, prev.presenceTs)
          : prev.presenceTs,
        cpuLoad: presenceSnapshot
          ? clamp(toNumberOr(presenceSnapshot.cpu, prev.cpuLoad / 100) * 100, 0, 100)
          : prev.cpuLoad,
        memUsage: presenceSnapshot
          ? clamp(toNumberOr(presenceSnapshot.memory, prev.memUsage / 100) * 100, 0, 100)
          : prev.memUsage,
        device: String(caliStatus.device || prev.device || "unknown"),
        vramGb: Math.max(0, toNumberOr(caliStatus.vram_gb, prev.vramGb)),
        encoderBackend: String(
          caliStatus.encoder_backend || prev.encoderBackend || "unknown"
        ),
        knowledgeGraphNodes: Math.max(
          0,
          toNumberOr(caliStatus.knowledge_graph_nodes, prev.knowledgeGraphNodes)
        ),
        knowledgeGraphEdges: Math.max(
          0,
          toNumberOr(caliStatus.knowledge_graph_edges, prev.knowledgeGraphEdges)
        ),
        interactionCount: Math.max(
          0,
          toNumberOr(caliStatus.interaction_count, prev.interactionCount)
        ),
        projectRoot: String(status.project_root || prev.projectRoot || "n/a"),
        systemRoot: String(status.system_root || prev.systemRoot || "n/a"),
        sharedMeshRoot: String(
          status.shared_mesh_root || prev.sharedMeshRoot || "n/a"
        ),
        swarmRunning: Boolean(status?.swarm_extension?.running),
      }));

      if (lastRunningRef.current === null || lastRunningRef.current !== running) {
        pushEvent("INFO", `Runtime ${running ? "running" : "stopped"}`);
      } else if (
        lastControllerRef.current === null ||
        lastControllerRef.current !== controllerStatus
      ) {
        pushEvent("INFO", `Controller ${controllerStatus}`);
      } else if (lastIdleRef.current === null || lastIdleRef.current !== snapshotIdle) {
        pushEvent("INFO", `Presence ${snapshotIdle ? "idle" : "active"} (${Math.round(snapshotIdleSeconds)}s idle)`);
      } else if (source === "poll") {
        pushEvent("PASS", "Status sync complete");
      }
      lastRunningRef.current = running;
      lastControllerRef.current = controllerStatus;
      lastIdleRef.current = snapshotIdle;
    },
    [pushEvent]
  );

  const applyCognitivePulse = useCallback(
    (pulse, source = "cognitive") => {
      if (!pulse || typeof pulse !== "object") {
        return;
      }
      const advisory = pulse.advisory_verdict || {};
      const confidence = clamp(
        toNumberOr(advisory.confidence, toNumberOr(pulse.confidence, 0.82)),
        0,
        1
      );
      const mode = String(pulse.cognitive_mode || pulse.mode || "DEDUCTIVE");
      const tension = Boolean(advisory.tension_detected);
      const activeModel = pulse.active_llm || pulse.model || pulse.model_name || null;
      const modeLabel = mode.toUpperCase().includes("INTUITION")
        ? "INTUITION"
        : mode.toUpperCase().includes("HABIT")
          ? "HABIT"
          : "DEDUCTIVE";

      setT((prev) => ({
        ...prev,
        activeLLM: activeModel || prev.activeLLM,
        confidenceWeight: confidence,
        consensusIndex: confidence,
        driftLevel: tension ? 1 : 0,
        cognitiveMode: modeLabel,
      }));
      pushEvent(
        tension ? "WARN" : "PASS",
        `${source} pulse -> ${modeLabel} (confidence ${confidence.toFixed(2)})`
      );
    },
    [pushEvent]
  );

  const applyPresenceUpdate = useCallback(
    (message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const isSchemaV1 = String(message?.type || "").toLowerCase() === "presence_update";
      const payload = message?.data || {};
      const profile = payload.presence_profile || {};
      const isIdle = isSchemaV1 ? Boolean(message?.idle) : Boolean(profile.is_idle);
      const idleSeconds = Math.max(
        0,
        toNumberOr(isSchemaV1 ? message?.idle_seconds : profile.idle_seconds, 0)
      );
      const autonomy = clamp(
        toNumberOr(isSchemaV1 ? message?.autonomy_level : profile.autonomy_level, 0.82),
        0.45,
        1
      );
      const confidence = clamp(
        toNumberOr(
          isSchemaV1
            ? message?.confidence_state
            : payload?.cognitive?.advisory_verdict?.confidence,
          autonomy
        ),
        0,
        1
      );

      setT((prev) => ({
        ...prev,
        responseSpeed: prev.responseSpeed,
        consensusIndex: autonomy,
        confidenceWeight: confidence,
        driftLevel: 0,
        networkActivity: prev.networkActivity + 1,
        presenceRunning: true,
        presenceIdle: isIdle,
        idleSeconds: Math.round(idleSeconds),
        activeWindow: String(
          isSchemaV1 ? (message?.active_window || "unknown") : (profile.active_window || "unknown")
        ),
        activeProcess: String(
          isSchemaV1 ? (message?.active_process || "unknown") : (profile.active_process || "unknown")
        ),
        lastEvent: String(
          isSchemaV1 ? (message?.last_event || "presence") : (payload?.stimulus_type || "presence_pulse")
        ),
        cognitiveMode: String(
          isSchemaV1
            ? (message?.cognitive_mode || prev.cognitiveMode || "DEDUCTIVE")
            : (payload?.cognitive?.cognitive_mode || prev.cognitiveMode || "DEDUCTIVE")
        ),
        autonomyLevel: autonomy,
        confidenceState: confidence,
        presenceSchemaVersion: isSchemaV1
          ? String(message?.schema_version || "1.0")
          : prev.presenceSchemaVersion,
        presenceTs: toNumberOr(isSchemaV1 ? message?.ts : Date.now() / 1000, prev.presenceTs),
        cpuLoad: isSchemaV1
          ? clamp(toNumberOr(message?.cpu, prev.cpuLoad / 100) * 100, 0, 100)
          : prev.cpuLoad,
        memUsage: isSchemaV1
          ? clamp(toNumberOr(message?.memory, prev.memUsage / 100) * 100, 0, 100)
          : prev.memUsage,
      }));

      if (lastIdleRef.current === null || lastIdleRef.current !== isIdle) {
        pushEvent(
          "INFO",
          `Presence ${isIdle ? "idle" : "active"} | autonomy ${autonomy.toFixed(2)} | idle ${Math.round(idleSeconds)}s`
        );
      } else if (isSchemaV1 && String(message?.last_event || "") !== "context_update") {
        pushEvent("PASS", `Presence update ${String(message?.last_event || "presence")}`);
      }
      lastIdleRef.current = isIdle;

      if (!isSchemaV1 && payload.cognitive && typeof payload.cognitive === "object") {
        applyCognitivePulse(payload.cognitive, "presence");
      }
    },
    [applyCognitivePulse, pushEvent]
  );

  const handleBridgeMessage = useCallback(
    (message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      const type = String(message.type || "").toLowerCase();
      if (!type) {
        return;
      }

      if (type === "ready") {
        pushEvent("PASS", "Python bridge ready");
        return;
      }
      if (type === "status_response") {
        applyStatus(message.data, "status_response");
        return;
      }
      if (type === "presence_update" || type === "presence_pulse") {
        applyPresenceUpdate(message);
        return;
      }
      if (type === "cognitive_pulse") {
        applyCognitivePulse(message.data || {}, "cognitive");
        return;
      }
      if (type === "speech_pulse") {
        applyCognitivePulse(message.data || {}, "speech");
        pushEvent("INFO", `Speech heard: ${message.transcription || "voice input processed"}`);
        return;
      }
      if (type === "query_result" || type === "research_result" || type === "speak_result") {
        markSuccess();
        const reportedLatency = toNumberOr(
          message?.data?.latency_ms,
          toNumberOr(message?.data?.latency, NaN)
        );
        setT((prev) => ({
          ...prev,
          llmLatency: clamp(
            Number.isFinite(reportedLatency) ? reportedLatency : prev.llmLatency,
            40,
            1200
          ),
          networkActivity: prev.networkActivity + 1,
        }));
        pushEvent("PASS", `${type.replace("_", " ")} received`);
        return;
      }
      if (type === "listening_mode") {
        const enabled = Boolean(message?.data?.enabled);
        setT((prev) => ({ ...prev, listeningEnabled: enabled }));
        pushEvent("INFO", `Listening ${enabled ? "enabled" : "disabled"}`);
        return;
      }
      if (type === "listening_state") {
        const listening = Boolean(message?.data?.listening);
        setT((prev) => ({ ...prev, listeningEnabled: listening }));
        pushEvent("INFO", listening ? "Microphone listening" : "Microphone idle");
        return;
      }
      if (type === "listen_once_ack") {
        pushEvent(message?.data?.accepted ? "PASS" : "WARN", `Listen once ${message?.data?.accepted ? "accepted" : "rejected"}`);
        return;
      }
      if (type === "orb_state_result" && message?.data?.state) {
        applyStatus(message.data.state, "orb_state_result");
        return;
      }
      if (type === "bridge_spawn_error" || type === "bridge_write_failed" || type === "bridge_stream_warning" || type === "bridge_exit") {
        markError();
        pushEvent("ERR", `${type}: ${message?.data?.message || "bridge runtime issue"}`);
        return;
      }
      if (type === "stderr") {
        pushEvent("WARN", message?.data?.text || "stderr event");
        return;
      }
      if (type === "stdout") {
        pushEvent("INFO", message?.data?.text || "stdout event");
      }
    },
    [applyCognitivePulse, applyPresenceUpdate, applyStatus, markError, markSuccess, pushEvent]
  );

  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setT((prev) => ({
        ...prev,
        epochTime: now,
        julianDate: toJulianDate(now),
        uptimeSeconds: Math.max(0, Math.floor((now - bootRef.current) / 1000)),
      }));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) {
      pushEvent("WARN", "electronAPI unavailable - live telemetry offline");
      return undefined;
    }

    let active = true;
    const refreshStatus = async (source = "poll") => {
      try {
        const status = await api.getOrbStatus();
        if (active) {
          applyStatus(status, source);
        }
        if (typeof api.getOrbVisibility === "function") {
          const visibility = await api.getOrbVisibility();
          if (active) {
            setT((prev) => ({ ...prev, orbVisible: Boolean(visibility?.visible) }));
          }
        }
      } catch (error) {
        if (active) {
          markError();
          pushEvent("ERR", `Status poll failed: ${error?.message || String(error)}`);
        }
      }
    };

    refreshStatus("initial");
    if (typeof api.getOrbVisibility === "function") {
      api.getOrbVisibility()
        .then((state) => {
          if (!active) return;
          const visible = Boolean(state?.visible);
          setT((prev) => ({ ...prev, orbVisible: visible }));
          pushEvent("INFO", visible ? "Orb launched" : "Orb docked");
        })
        .catch(() => {});
    }
    const statusPoll = setInterval(() => refreshStatus("poll"), 5000);

    const unsubs = [
      api.onOrbBridgeMessage((_event, message) => handleBridgeMessage(message)),
      api.onOrbStatusChange((_event, status) => applyStatus(status, "status_change")),
      api.onOrbVisibilityChanged((_event, payload) => {
        const visible = Boolean(payload?.visible);
        setT((prev) => ({ ...prev, orbVisible: visible }));
        pushEvent("INFO", visible ? "Orb launched" : "Orb docked");
      }),
      api.onHysteresis((_event, data) => {
        pushEvent("WARN", `Hysteresis ${data?.triggerThreshold} -> ${data?.releaseThreshold}`);
      }),
      api.onOrbSkinUpdated((_event, payload) => {
        if (payload?.imageUrl) {
          pushEvent("INFO", "Skin socket updated");
        }
      }),
    ];

    return () => {
      active = false;
      clearInterval(statusPoll);
      unsubs.forEach((fn) => {
        try {
          if (typeof fn === "function") fn();
        } catch (_error) {}
      });
    };
  }, [applyStatus, handleBridgeMessage, markError, pushEvent]);

  return t;
}

function Sparkline({ value, color = "#00e5ff", points = 28 }) {
  const initial = toNumberOr(value, 0);
  const history = useRef(Array(points).fill(initial));
  useEffect(() => {
    history.current = [...history.current.slice(1), toNumberOr(value, 0)];
  }, [value]);
  const h = history.current;
  const min = Math.min(...h);
  const max = Math.max(...h);
  const w = 78;
  const hh = 24;
  const pts = h
    .map((v, i) => `${(i / (points - 1)) * w},${hh - ((v - min) / (max - min || 1)) * hh}`)
    .join(" ");
  const lastY = hh - ((h[h.length - 1] - min) / (max - min || 1)) * hh;
  return (
    <svg width={w} height={hh}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.4" opacity="0.9" />
      <circle cx={w} cy={lastY} r="2.4" fill={color} />
    </svg>
  );
}

function Gauge({ value, max = 100, label, color = "#00e5ff", size = 72 }) {
  const numericValue = toNumberOr(value, 0);
  const pct = numericValue / max;
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const dash = pct * c * 0.75;
  const off = c * 0.125;
  return (
    <div style={{ position: "relative", width: size, height: size }}>
      <svg width={size} height={size}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="4"
          strokeDasharray={`${c * 0.75} ${c}`}
          strokeDashoffset={-off}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          strokeDashoffset={-off}
          style={{ transition: "stroke-dasharray .7s ease", filter: `drop-shadow(0 0 5px ${color})` }}
        />
        <text
          x={size / 2}
          y={size / 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill={color}
          fontSize="11"
          fontFamily="monospace"
          fontWeight="bold"
        >
          {numericValue < 10 ? numericValue.toFixed(2) : Math.round(numericValue)}
        </text>
      </svg>
      <div style={{ position: "absolute", bottom: 1, width: "100%", textAlign: "center", fontSize: 8, color: "rgba(255,255,255,.45)", letterSpacing: 1, fontFamily: "monospace" }}>
        {label}
      </div>
    </div>
  );
}

function Pill({ label, value, ok = true }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        fontFamily: "monospace",
        padding: "3px 8px",
        borderRadius: 4,
        border: `1px solid ${ok ? "rgba(0,229,255,.25)" : "rgba(255,95,95,.35)"}`,
        background: "rgba(255,255,255,.03)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: ok ? "#00e5ff" : "#ff5050",
          boxShadow: ok ? "0 0 6px #00e5ff" : "0 0 6px #ff5050",
        }}
      />
      <span style={{ fontSize: 9, color: "rgba(255,255,255,.5)", letterSpacing: 0.5 }}>{label}</span>
      <span style={{ marginLeft: "auto", color: ok ? "#00e5ff" : "#ff8080", fontSize: 10, fontWeight: "bold" }}>{value}</span>
    </div>
  );
}

function Panel({ title, accent = "#00e5ff", children, badge }) {
  return (
    <div
      style={{
        background: "linear-gradient(145deg, rgba(0,20,40,.88), rgba(0,9,22,.95))",
        borderRadius: 8,
        border: `1px solid ${accent}22`,
        borderTop: `2px solid ${accent}66`,
        padding: "10px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 6 }}>
        <div style={{ width: 4, height: 4, borderRadius: "50%", background: accent, boxShadow: `0 0 6px ${accent}` }} />
        <span style={{ fontSize: 9, letterSpacing: 1.8, textTransform: "uppercase", color: accent, fontFamily: "monospace" }}>{title}</span>
        {badge ? (
          <span style={{ marginLeft: "auto", fontSize: 8, color: accent, border: `1px solid ${accent}44`, background: `${accent}22`, borderRadius: 3, padding: "1px 6px", fontFamily: "monospace" }}>
            {badge}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function OrbDiagram({ telemetry, accent = "#00e5ff" }) {
  const ref = useRef(null);
  const telemetryRef = useRef(telemetry);

  useEffect(() => {
    telemetryRef.current = telemetry;
  }, [telemetry]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    let frame = 0;
    let raf = 0;
    const draw = () => {
      const live = telemetryRef.current || {};
      const confidence = clamp(toNumberOr(live.confidenceState, 0.3), 0, 1);
      const cpuRatio = clamp(toNumberOr(live.cpuLoad, 0) / 100, 0, 1);
      const isIdle = Boolean(live.presenceIdle);
      const speed = isIdle ? 0.0035 : 0.0075 + confidence * 0.01;
      frame += speed;

      ctx.clearRect(0, 0, w, h);
      const outerR = 118 + confidence * 14;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(0,229,255,${0.22 + cpuRatio * 0.5})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      [0.56, 0.72, 0.88].forEach((rf, idx) => {
        const r = outerR * rf;
        const phase = frame * (0.35 + idx * 0.2 + confidence * 0.15) * (idx % 2 ? -1 : 1);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(phase);
        ctx.beginPath();
        ctx.ellipse(0, 0, r, r * 0.34, 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,${145 + idx * 30},${220 + idx * 10},${0.22 + idx * 0.05})`;
        ctx.setLineDash([4, 8]);
        ctx.stroke();
        ctx.setLineDash([]);
        const nx = Math.cos(phase * 2) * r;
        const ny = Math.sin(phase * 2) * r * 0.34;
        ctx.beginPath();
        ctx.arc(nx, ny, 3, 0, Math.PI * 2);
        ctx.fillStyle = [accent, "#7c4dff", "#00e676"][idx];
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.restore();
      });
      ctx.fillStyle = accent;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      ctx.fillText(isIdle ? "IDLE" : "LIVE", cx, cy + 4);
      ctx.fillStyle = "rgba(0,229,255,.75)";
      ctx.font = "7px monospace";
      ctx.fillText(String(live.cognitiveMode || "UNKNOWN").slice(0, 14), cx, cy + 16);
      ctx.fillStyle = "rgba(255,255,255,.52)";
      ctx.fillText(`CPU ${Math.round(toNumberOr(live.cpuLoad, 0))}%`, cx, cy + 27);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [accent]);
  return <canvas ref={ref} width={300} height={300} style={{ display: "block" }} />;
}

function DockedOrbMirror({ telemetry, accent = "#00e5ff" }) {
  const confidence = clamp(toNumberOr(telemetry?.confidenceState, 0.6), 0, 1);
  const cpu = clamp(toNumberOr(telemetry?.cpuLoad, 0), 0, 100);
  const mode = String(telemetry?.cognitiveMode || "UNKNOWN");
  return (
    <div
      style={{
        marginTop: 8,
        border: `1px solid ${accent}44`,
        borderRadius: 8,
        padding: "10px 12px",
        background: "linear-gradient(160deg, rgba(0,20,40,.7), rgba(0,8,24,.85))",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            background: `radial-gradient(circle at 35% 30%, #ffffffaa 0%, ${accent}aa 35%, #05101f 100%)`,
            border: `1px solid ${accent}66`,
            boxShadow: `0 0 ${8 + confidence * 12}px ${accent}66`,
          }}
        />
        <div style={{ display: "grid", gap: 2, flex: 1 }}>
          <span style={{ fontSize: 10, color: accent }}>DOCKED ORB MIRROR</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.7)" }}>
            Mode {mode} | Confidence {(confidence * 100).toFixed(0)}% | CPU {cpu.toFixed(0)}%
          </span>
        </div>
      </div>
    </div>
  );
}

const SKINS = [
  { id: "deep-space", label: "Deep Space", accent: "#00e5ff" },
  { id: "solar-flare", label: "Solar Flare", accent: "#ff9d00" },
  { id: "bio-pulse", label: "Bio Pulse", accent: "#00e676" },
  { id: "quantum", label: "Quantum", accent: "#e040fb" },
];

const ORB_SKIN_STUDIO_ROOT_URL = "file:///R:/Orb_Skin_Studio";
const ORB_SKIN_STUDIO_TABS = [
  { id: "studio", label: "Studio", file: "orb_skin_gen.html" },
  { id: "gallery", label: "Gallery", file: "gallery.html" },
  { id: "cart", label: "Cart", file: "cart.html" },
  { id: "checkout", label: "Checkout", file: "checkout.html" },
  { id: "upload", label: "Upload", file: "upload.html" },
  { id: "account", label: "Account", file: "account.html" },
  { id: "admin", label: "Admin", file: "admin.html" },
  { id: "pricing", label: "Pricing", file: "pricing.html" },
  { id: "login", label: "Login", file: "login.html" },
  { id: "contact", label: "Contact", file: "contact.html" },
];

function toSkinStudioUrl(file) {
  return `${ORB_SKIN_STUDIO_ROOT_URL}/${encodeURIComponent(file)}`;
}

const EVENT_COLOR = { INFO: "#00b4d8", PASS: "#00e676", WARN: "#ffd740", ERR: "#ff5050" };

function ChatPanel({ accent = "#00e5ff" }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api || typeof api.onChatMessage !== "function") return undefined;
    const unsub = api.onChatMessage((_event, msg) => {
      setMessages((prev) => [...prev, msg]);
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      await window.electronAPI?.orbChat?.(text);
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const handleKey = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <Panel title="Talk to Orb" accent={accent} badge="LIVE CHANNEL">
      <div
        style={{
          height: 220,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "4px 0",
          marginBottom: 8,
        }}
      >
        {messages.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,.3)", fontSize: 9, padding: "8px 0", fontFamily: "monospace" }}>
            No messages yet. Type below to talk to Orb.
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  maxWidth: "80%",
                  padding: "6px 10px",
                  borderRadius: 8,
                  fontSize: 10,
                  lineHeight: 1.45,
                  background: msg.role === "user" ? `${accent}22` : "rgba(255,255,255,.07)",
                  border: `1px solid ${msg.role === "user" ? accent + "55" : "rgba(255,255,255,.12)"}`,
                  color: msg.role === "user" ? accent : "#e0f7fa",
                  fontFamily: "monospace",
                  wordBreak: "break-word",
                }}
              >
                {msg.text}
              </div>
              <span style={{ fontSize: 7, color: "rgba(255,255,255,.28)", marginTop: 2, fontFamily: "monospace" }}>
                {msg.role === "orb" ? "ORB" : "YOU"} · {msg.time}
              </span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Message Orb..."
          disabled={sending}
          style={{
            flex: 1,
            background: "rgba(0,0,0,.4)",
            border: `1px solid ${accent}44`,
            borderRadius: 4,
            color: "#e0f7fa",
            padding: "7px 10px",
            fontSize: 10,
            fontFamily: "monospace",
            outline: "none",
          }}
        />
        <button
          onClick={send}
          disabled={!input.trim() || sending}
          style={{
            padding: "7px 16px",
            borderRadius: 4,
            border: `1px solid ${accent}66`,
            background: `${accent}22`,
            color: accent,
            fontSize: 10,
            fontFamily: "monospace",
            cursor: !input.trim() || sending ? "not-allowed" : "pointer",
            opacity: !input.trim() || sending ? 0.45 : 1,
            letterSpacing: 0.5,
          }}
        >
          {sending ? "..." : "Send"}
        </button>
      </div>
    </Panel>
  );
}

function OrbDockStation() {
  const tel = useTelemetry();
  const [level, setLevel] = useState(2);
  const [stationConfig, setStationConfig] = useState(() => {
    const persisted = safeReadJson(STATION_CONFIG_KEY, {});
    return {
      skinId: persisted.skinId || "deep-space",
      llmRoute: persisted.llmRoute || "cali",
      apiBase: persisted.apiBase || "",
      apiModel: persisted.apiModel || "",
      apiKey: persisted.apiKey || "",
      localEndpoint: persisted.localEndpoint || "http://127.0.0.1:11434",
      localModel: persisted.localModel || "",
      governanceWrapper: persisted.governanceWrapper !== false,
      retainVoice: persisted.retainVoice !== false,
    };
  });
  const [skinId, setSkinId] = useState(stationConfig.skinId);
  const [skinStudioTabId, setSkinStudioTabId] = useState("studio");
  const [skinStudioFrameNonce, setSkinStudioFrameNonce] = useState(0);
  const [skinStudioFrameState, setSkinStudioFrameState] = useState("loading");
  const [savingLlmConfig, setSavingLlmConfig] = useState(false);
  const skin = useMemo(() => SKINS.find((s) => s.id === skinId) || SKINS[0], [skinId]);
  const skinStudioTab = useMemo(
    () =>
      ORB_SKIN_STUDIO_TABS.find((tab) => tab.id === skinStudioTabId) ||
      ORB_SKIN_STUDIO_TABS[0],
    [skinStudioTabId]
  );
  const skinStudioUrl = useMemo(
    () => toSkinStudioUrl(skinStudioTab.file),
    [skinStudioTab]
  );
  const accent = skin.accent;
  const uptime = `${Math.floor(tel.uptimeSeconds / 86400)}d ${Math.floor((tel.uptimeSeconds % 86400) / 3600)}h ${Math.floor((tel.uptimeSeconds % 3600) / 60)}m`;
  const windowLabel = truncate(tel.activeWindow, 26);
  const processLabel = truncate(tel.activeProcess, 24);
  const meshRootLabel = truncate(tel.sharedMeshRoot, 26);
  const controllerLabel = String(tel.controllerStatus || "unknown").toUpperCase();
  const cognitiveModeLabel = String(tel.cognitiveMode || "DEDUCTIVE").toUpperCase();
  const isDocked = !tel.orbVisible;
  const governanceEnabled = stationConfig.llmRoute !== "cali" && stationConfig.governanceWrapper;
  const configuredLlmLabel =
    stationConfig.llmRoute === "api"
      ? (stationConfig.apiModel || "API model (unset)")
      : stationConfig.llmRoute === "local"
        ? (stationConfig.localModel || "Local model (unset)")
        : "CALI local cognitive core";
  const llm = configuredLlmLabel || tel.activeLLM || "unknown";

  useEffect(() => {
    setStationConfig((prev) => {
      if (prev.skinId === skinId) return prev;
      const next = { ...prev, skinId };
      window.localStorage.setItem(STATION_CONFIG_KEY, JSON.stringify(next));
      return next;
    });
  }, [skinId]);

  const persistConfig = useCallback((next) => {
    setStationConfig(next);
    window.localStorage.setItem(STATION_CONFIG_KEY, JSON.stringify(next));
  }, []);

  const applyLlmConfig = useCallback(async () => {
    const api = window.electronAPI;
    if (!api || typeof api.setOrbState !== "function") return;
    setSavingLlmConfig(true);
    try {
      const writes = [
        api.setOrbState("llm_route", stationConfig.llmRoute),
        api.setOrbState("llm_api_base", stationConfig.apiBase || ""),
        api.setOrbState("llm_api_model", stationConfig.apiModel || ""),
        api.setOrbState("llm_api_key", stationConfig.apiKey || ""),
        api.setOrbState("llm_local_endpoint", stationConfig.localEndpoint || ""),
        api.setOrbState("llm_local_model", stationConfig.localModel || ""),
        api.setOrbState("llm_governance_wrapper", governanceEnabled),
        api.setOrbState("llm_retain_voice", Boolean(stationConfig.retainVoice)),
      ];
      await Promise.allSettled(writes);
    } finally {
      setSavingLlmConfig(false);
    }
  }, [governanceEnabled, stationConfig]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 30% 20%, rgba(0,20,50,1) 0%, rgba(0,5,15,1) 60%, rgba(0,0,8,1) 100%)",
        color: "#e0f7fa",
        fontFamily: "'Courier New', monospace",
      }}
    >
      <style>{`
        @keyframes pulse-ring {0%{box-shadow:0 0 0 0 rgba(0,229,255,.4)}100%{box-shadow:0 0 0 20px rgba(0,229,255,0)}}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-thumb{background:rgba(0,229,255,.28);border-radius:2px}
      `}</style>
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 20,
          padding: "12px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: `1px solid ${accent}22`,
          background: "linear-gradient(90deg, rgba(0,10,25,.95), rgba(0,20,50,.9))",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", border: `2px solid ${accent}66`, background: `radial-gradient(circle, ${accent}44, ${accent}11)`, animation: "pulse-ring 2s infinite" }} />
          <div>
            <div style={{ fontSize: 14, letterSpacing: 3, color: accent, fontWeight: "bold" }}>ORB DOCK STATION</div>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,.42)", letterSpacing: 2 }}>OFDA DIAGNOSTIC & CONTROL INTERFACE</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {[1, 2, 3].map((lv) => (
            <button
              key={lv}
              onClick={() => setLevel(lv)}
              style={{
                padding: "4px 10px",
                fontSize: 8,
                letterSpacing: 1,
                cursor: "pointer",
                borderRadius: 4,
                fontFamily: "monospace",
                background: level === lv ? `${accent}22` : "transparent",
                border: `1px solid ${level === lv ? accent : "rgba(255,255,255,.15)"}`,
                color: level === lv ? accent : "rgba(255,255,255,.45)",
              }}
            >
              VIEW {lv}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Pill label="SCOPE" value="DESKTOP ORB" />
          <Pill label="INSTANCE" value={String(tel.instanceId || "unknown")} />
          <Pill label="ORB STATE" value={isDocked ? "DOCKED" : "DEPLOYED"} ok={isDocked} />
          <button
            onClick={async () => {
              const api = window.electronAPI;
              if (!api || typeof api.setOrbVisibility !== "function") return;
              await api.setOrbVisibility(isDocked);
            }}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${isDocked ? "rgba(0,230,118,.55)" : "rgba(0,229,255,.45)"}`,
              background: isDocked ? "rgba(0,230,118,.16)" : "rgba(0,229,255,.16)",
              color: isDocked ? "#00e676" : "#00e5ff",
              fontSize: 9,
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            {isDocked ? "Launch Orb" : "Dock Orb"}
          </button>
          <span style={{ color: accent, fontSize: 10 }}>{new Date(tel.epochTime).toTimeString().slice(0, 8)}</span>
        </div>
      </div>

      <div style={{ padding: "14px 16px", display: "grid", gap: 12, gridTemplateColumns: level === 2 ? "220px 1fr 220px" : "1fr 1fr 1fr" }}>
        <Panel title="Core System" accent={accent}>
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <Gauge value={tel.systemHealth} label="HEALTH" color={accent} size={84} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Pill label="CORE INTEGRITY" value={`${tel.coreIntegrity.toFixed(1)}%`} />
            <Pill label="UPTIME" value={uptime} />
            <Pill
              label="CONTROLLER"
              value={controllerLabel}
              ok={["active", "ready"].includes(String(tel.controllerStatus || "").toLowerCase())}
            />
            <Pill label="PRESENCE" value={tel.presenceIdle ? "IDLE" : "ACTIVE"} ok={tel.presenceRunning} />
            <Pill label="PRESENCE LOOP" value={tel.presenceRunning ? "ONLINE" : "OFF"} ok={tel.presenceRunning} />
            <Pill label="IDLE SECONDS" value={`${Math.round(tel.idleSeconds || 0)}s`} />
            <Pill label="WINDOW" value={windowLabel} />
            <Pill label="PROCESS" value={processLabel} />
            <Pill label="MESH ROOT" value={meshRootLabel} />
          </div>
        </Panel>

        <Panel title="Orb Observatory" accent={accent} badge={isDocked ? "DOCKED" : "LIVE"}>
          <div style={{ display: "flex", justifyContent: "center", padding: "8px 0" }}>
            <OrbDiagram telemetry={tel} accent={accent} />
          </div>
          {isDocked ? <DockedOrbMirror telemetry={tel} accent={accent} /> : null}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 6 }}>
            <div style={{ textAlign: "center", border: "1px solid rgba(0,229,255,.2)", background: "rgba(0,229,255,.08)", borderRadius: 4, padding: 4 }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,.5)" }}>CPU</div>
              <div style={{ fontSize: 11, color: "#00e676", fontWeight: "bold" }}>{Math.round(toNumberOr(tel.cpuLoad, 0))}%</div>
            </div>
            <div style={{ textAlign: "center", border: "1px solid rgba(124,77,255,.2)", background: "rgba(124,77,255,.1)", borderRadius: 4, padding: 4 }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,.5)" }}>MEM</div>
              <div style={{ fontSize: 11, color: "#7c4dff", fontWeight: "bold" }}>{Math.round(toNumberOr(tel.memUsage, 0))}%</div>
            </div>
            <div style={{ textAlign: "center", border: "1px solid rgba(255,215,64,.2)", background: "rgba(255,215,64,.08)", borderRadius: 4, padding: 4 }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,.5)" }}>KG NODES</div>
              <div style={{ fontSize: 11, color: "#ffd740", fontWeight: "bold" }}>{Math.round(toNumberOr(tel.knowledgeGraphNodes, 0))}</div>
            </div>
            <div style={{ textAlign: "center", border: "1px solid rgba(0,230,118,.2)", background: "rgba(0,230,118,.08)", borderRadius: 4, padding: 4 }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,.5)" }}>KG EDGES</div>
              <div style={{ fontSize: 11, color: "#00e676", fontWeight: "bold" }}>{Math.round(toNumberOr(tel.knowledgeGraphEdges, 0))}</div>
            </div>
            <div style={{ textAlign: "center", border: "1px solid rgba(255,215,64,.2)", background: "rgba(255,215,64,.08)", borderRadius: 4, padding: 4 }}>
              <div style={{ fontSize: 7, color: "rgba(255,255,255,.5)" }}>CONF</div>
              <div style={{ fontSize: 11, color: "#ffd740", fontWeight: "bold" }}>{Math.round(tel.confidenceWeight * 100)}%</div>
            </div>
          </div>
        </Panel>

        <Panel title="Live Runtime" accent="#7c4dff">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Pill label="ACTIVE LLM" value={llm} />
            <Pill label="GOV WRAPPER" value={governanceEnabled ? "ON" : "OFF"} ok={governanceEnabled || stationConfig.llmRoute === "cali"} />
            <Pill label="VOICE RETENTION" value={stationConfig.retainVoice ? "ON" : "OFF"} ok={stationConfig.retainVoice} />
            <Pill label="LATENCY" value={tel.llmLatency > 0 ? `${Math.round(tel.llmLatency)}ms` : "n/a"} ok={tel.llmLatency > 0 ? tel.llmLatency < 200 : true} />
            <Pill label="SUCCESS RATE" value={`${tel.llmSuccessRate.toFixed(1)}%`} />
            <Pill label="ANOMALIES" value={tel.anomalies} ok={tel.anomalies === 0} />
            <Pill label="LISTENING" value={tel.listeningEnabled ? "ON" : "OFF"} ok={tel.listeningEnabled} />
            <Pill label="AUTO LISTEN" value={tel.autoListen ? "ON" : "OFF"} ok={tel.autoListen} />
            <Pill label="DEVICE" value={String(tel.device || "unknown")} />
            <Pill label="ENCODER" value={String(tel.encoderBackend || "unknown")} />
            <Pill label="INTERACTIONS" value={Math.round(toNumberOr(tel.interactionCount, 0))} />
            <Pill label="COGNITIVE MODE" value={cognitiveModeLabel} />
            <Pill label="AUTONOMY" value={tel.autonomyLevel.toFixed(2)} />
            <Pill label="CONFIDENCE" value={tel.confidenceState.toFixed(2)} />
            <Pill label="LAST EVENT" value={String(tel.lastEvent || "presence")} />
            <Pill label="PRESENCE SCHEMA" value={String(tel.presenceSchemaVersion || "n/a")} />
          </div>
          <div style={{ marginTop: 8, border: "1px solid rgba(124,77,255,.35)", borderRadius: 6, padding: 8, display: "grid", gap: 6 }}>
            <div style={{ fontSize: 9, color: "#b388ff", letterSpacing: 0.6 }}>LLM CONNECTOR (DOCK-EDIT)</div>
            <select
              value={stationConfig.llmRoute}
              disabled={!isDocked}
              onChange={(e) => persistConfig({ ...stationConfig, llmRoute: e.target.value })}
              style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
            >
              <option value="cali">CALI (local cognitive core)</option>
              <option value="api">External API LLM</option>
              <option value="local">Local model endpoint</option>
            </select>
            {stationConfig.llmRoute === "api" ? (
              <>
                <input
                  placeholder="API Base URL"
                  value={stationConfig.apiBase}
                  disabled={!isDocked}
                  onChange={(e) => persistConfig({ ...stationConfig, apiBase: e.target.value })}
                  style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
                />
                <input
                  placeholder="API Model"
                  value={stationConfig.apiModel}
                  disabled={!isDocked}
                  onChange={(e) => persistConfig({ ...stationConfig, apiModel: e.target.value })}
                  style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
                />
                <input
                  placeholder="API Key"
                  type="password"
                  value={stationConfig.apiKey}
                  disabled={!isDocked}
                  onChange={(e) => persistConfig({ ...stationConfig, apiKey: e.target.value })}
                  style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
                />
              </>
            ) : null}
            {stationConfig.llmRoute === "local" ? (
              <>
                <input
                  placeholder="Local Endpoint"
                  value={stationConfig.localEndpoint}
                  disabled={!isDocked}
                  onChange={(e) => persistConfig({ ...stationConfig, localEndpoint: e.target.value })}
                  style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
                />
                <input
                  placeholder="Local Model"
                  value={stationConfig.localModel}
                  disabled={!isDocked}
                  onChange={(e) => persistConfig({ ...stationConfig, localModel: e.target.value })}
                  style={{ background: "rgba(0,0,0,.35)", color: "#e0f7fa", border: "1px solid rgba(255,255,255,.2)", borderRadius: 4, padding: "4px 6px", fontSize: 10 }}
                />
              </>
            ) : null}
            <label style={{ fontSize: 9, color: "rgba(255,255,255,.75)", display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={stationConfig.governanceWrapper}
                disabled={!isDocked || stationConfig.llmRoute === "cali"}
                onChange={(e) => persistConfig({ ...stationConfig, governanceWrapper: e.target.checked })}
              />
              Governance wrapper (applies to API/local LLM only)
            </label>
            <label style={{ fontSize: 9, color: "rgba(255,255,255,.75)", display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={stationConfig.retainVoice}
                disabled={!isDocked}
                onChange={(e) => persistConfig({ ...stationConfig, retainVoice: e.target.checked })}
              />
              Retain Orb voice in governance wrapper
            </label>
            <button
              disabled={!isDocked || savingLlmConfig}
              onClick={applyLlmConfig}
              style={{
                padding: "4px 8px",
                borderRadius: 4,
                border: "1px solid rgba(179,136,255,.6)",
                background: !isDocked ? "rgba(100,100,100,.2)" : "rgba(179,136,255,.2)",
                color: !isDocked ? "rgba(255,255,255,.45)" : "#d1b2ff",
                cursor: !isDocked ? "not-allowed" : "pointer",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              {savingLlmConfig ? "Applying..." : "Apply LLM Routing"}
            </button>
          </div>
          <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,.45)" }}>LATENCY TREND</span>
            <Sparkline value={tel.llmLatency} color="#7c4dff" />
          </div>
          <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <Gauge value={tel.cpuLoad} label="CPU" color="#00e5ff" size={62} />
            <Gauge value={tel.memUsage} label="MEM" color="#ffd740" size={62} />
          </div>
          <div style={{ marginTop: 8, display: "grid", gap: 4 }}>
            {SKINS.map((s) => (
              <button
                key={s.id}
                disabled={!isDocked}
                onClick={async () => {
                  if (!isDocked) return;
                  setSkinId(s.id);
                  persistConfig({ ...stationConfig, skinId: s.id });
                  const api = window.electronAPI;
                  if (api && typeof api.setOrbState === "function") {
                    await api.setOrbState("skin", s.id);
                  }
                }}
                style={{
                  padding: "4px 8px",
                  borderRadius: 4,
                  border: `1px solid ${skinId === s.id ? s.accent + "66" : "rgba(255,255,255,.12)"}`,
                  background: !isDocked ? "rgba(120,120,120,.15)" : skinId === s.id ? `${s.accent}22` : "transparent",
                  color: !isDocked ? "rgba(255,255,255,.35)" : skinId === s.id ? s.accent : "rgba(255,255,255,.6)",
                  textAlign: "left",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: !isDocked ? "not-allowed" : "pointer",
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ padding: "0 16px 12px 16px" }}>
        <ChatPanel accent={accent} />
      </div>

      <div style={{ padding: "0 16px 12px 16px" }}>
        <Panel title="Event Feed" accent="#4dd0e1" badge="STREAM">
          <div style={{ maxHeight: 220, overflowY: "auto" }}>
            {tel.events.map((ev) => (
              <div key={ev.id} style={{ display: "flex", gap: 8, padding: "3px 0", borderBottom: "1px solid rgba(255,255,255,.05)" }}>
                <span style={{ fontSize: 8, color: "rgba(255,255,255,.35)", width: 58 }}>{ev.time}</span>
                <span style={{ fontSize: 8, width: 34, color: EVENT_COLOR[ev.type] || "#aaa" }}>[{ev.type}]</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,.7)" }}>{ev.msg}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div style={{ padding: "0 16px 18px 16px" }}>
        <Panel title="Orb Skin Studio" accent="#00e676" badge={isDocked ? "DOCK-EDIT ENABLED" : "LOCKED UNTIL DOCKED"}>
          <div style={{ marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, color: isDocked ? "#00e676" : "#ffd740" }}>
              {isDocked
                ? "Studio edits are enabled and persisted while docked."
                : "Dock the Orb to edit Studio. Launch state is read-only."}
            </span>
            {!isDocked ? (
              <button
                onClick={async () => {
                  const api = window.electronAPI;
                  if (!api || typeof api.setOrbVisibility !== "function") return;
                  await api.setOrbVisibility(false);
                }}
                style={{
                  marginLeft: "auto",
                  padding: "4px 9px",
                  borderRadius: 4,
                  border: "1px solid rgba(0,230,118,.6)",
                  background: "rgba(0,230,118,.14)",
                  color: "#00e676",
                  fontSize: 10,
                  fontFamily: "monospace",
                  cursor: "pointer",
                }}
              >
                Dock Orb To Edit
              </button>
            ) : null}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {ORB_SKIN_STUDIO_TABS.map((tab) => (
              <button
                key={tab.id}
                disabled={!isDocked}
                onClick={() => {
                  if (!isDocked) return;
                  setSkinStudioTabId(tab.id);
                  setSkinStudioFrameState("loading");
                }}
                style={{
                  padding: "4px 9px",
                  borderRadius: 4,
                  border: `1px solid ${skinStudioTabId === tab.id ? "rgba(0,230,118,.6)" : "rgba(255,255,255,.15)"}`,
                  background: !isDocked ? "rgba(120,120,120,.12)" : skinStudioTabId === tab.id ? "rgba(0,230,118,.15)" : "transparent",
                  color: !isDocked ? "rgba(255,255,255,.35)" : skinStudioTabId === tab.id ? "#00e676" : "rgba(255,255,255,.6)",
                  fontSize: 10,
                  fontFamily: "monospace",
                  cursor: !isDocked ? "not-allowed" : "pointer",
                }}
              >
                {tab.label}
              </button>
            ))}
            <button
              disabled={!isDocked}
              onClick={() => {
                if (!isDocked) return;
                setSkinStudioFrameNonce((v) => v + 1);
                setSkinStudioFrameState("loading");
              }}
              style={{
                marginLeft: "auto",
                padding: "4px 9px",
                borderRadius: 4,
                border: "1px solid rgba(0,229,255,.4)",
                background: !isDocked ? "rgba(120,120,120,.12)" : "rgba(0,229,255,.12)",
                color: !isDocked ? "rgba(255,255,255,.35)" : "#00e5ff",
                fontSize: 10,
                fontFamily: "monospace",
                cursor: !isDocked ? "not-allowed" : "pointer",
              }}
            >
              Reload Tab
            </button>
          </div>

          <div
            style={{
              border: "1px solid rgba(0,230,118,.25)",
              borderRadius: 8,
              background: "rgba(0,0,0,.28)",
              minHeight: 700,
              height: "70vh",
              overflow: "hidden",
              position: "relative",
            }}
          >
            <iframe
              key={`${skinStudioTab.id}-${skinStudioFrameNonce}`}
              title={`Orb Skin Studio - ${skinStudioTab.label}`}
              src={skinStudioUrl}
              onLoad={() => setSkinStudioFrameState("ready")}
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                background: "#0a0a0f",
                pointerEvents: isDocked ? "auto" : "none",
                opacity: isDocked ? 1 : 0.58,
              }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
            {!isDocked ? (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(2,7,18,.45)",
                  color: "#ffd740",
                  fontSize: 12,
                  fontFamily: "monospace",
                  letterSpacing: 0.7,
                }}
              >
                STUDIO LOCKED: DOCK ORB TO EDIT
              </div>
            ) : null}
          </div>

          <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,.5)" }}>
              Source: <span style={{ color: "#00e676" }}>R:\Orb_Skin_Studio\{skinStudioTab.file}</span>
            </span>
            <span style={{ marginLeft: "auto", fontSize: 9, color: skinStudioFrameState === "ready" ? "#00e676" : "#ffd740" }}>
              Frame: {skinStudioFrameState.toUpperCase()}
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (rootEl) {
  const root = ReactDOM.createRoot(rootEl);
  root.render(<OrbDockStation />);
}
