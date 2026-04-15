const { useEffect, useMemo, useRef, useState } = React;
const { pathToFileURL } = require('url');
const rand = (min, max) => Math.random() * (max - min) + min;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const parseEnvInt = (name, fallback, min = null, max = null) => {
  const raw = process?.env?.[name];
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const boundedMin = min === null ? parsed : Math.max(min, parsed);
  return max === null ? boundedMin : Math.min(max, boundedMin);
};

const ORB_DIAMETER = 160;
const ORB_RADIUS = ORB_DIAMETER / 2;
const ORB_MARGIN = 124;
const ORB_CURSOR_CLEARANCE_EXTRA_PX = parseEnvInt('ORB_CURSOR_CLEARANCE_EXTRA_PX', 0, 0, 400);
const ORB_MIN_CURSOR_CLEARANCE = ORB_RADIUS + 52 + ORB_CURSOR_CLEARANCE_EXTRA_PX;
const ORB_CURSOR_COMFORT_RADIUS = ORB_RADIUS + 138 + ORB_CURSOR_CLEARANCE_EXTRA_PX;
const ORB_CURSOR_PANIC_RADIUS = ORB_MIN_CURSOR_CLEARANCE + 18;
const ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE = 150;
const ORB_AUTONOMOUS_WAYPOINT_MAX_DISTANCE = 420;
const ORB_AUTONOMOUS_RETARGET_INTERVAL_MS = 9800;
const ORB_AUTONOMOUS_RETARGET_INTERVAL_IDLE_MAX_MS = 16000;
const ORB_AUTONOMOUS_FORCE_RETARGET_BASE_MS = 7200;
const ORB_AUTONOMOUS_FORCE_RETARGET_IDLE_MS = 11200;
const ORB_CURSOR_REACTION_COOLDOWN_MS = 480;
const ORB_RETARGET_STABILITY_WINDOW_MS = 1400;
const ORB_INTERACTION_RADIUS = 72;
const ORB_SMOOTHING = 0.12;
const ORB_SNAP_DISTANCE = 1.5;
const ORB_DIRECTION_EPSILON = 2;
const ORB_DEFAULT_TRAIL_DIRECTION = { x: -0.9, y: -0.42 };
const ORB_RETARGET_DISTANCE = 36;
const ORB_VISUAL_MODE_LOCK = '';
const ORB_AUTONOMOUS_BASE_SPEED = 1.9;
const ORB_AUTONOMOUS_IDLE_SPEED_BONUS = 0.35;
const ORB_STEER_BLEND = 0.09;
const ORB_CURSOR_REPEL_RADIUS = ORB_CURSOR_COMFORT_RADIUS + 12;
const ORB_CURSOR_LEASH_MIN = ORB_CURSOR_COMFORT_RADIUS - 18;
const ORB_CURSOR_LEASH_MAX = ORB_CURSOR_COMFORT_RADIUS + 116;
const ORB_EDGE_REPEL_DISTANCE = 150;
const ORB_EDGE_REPEL_GAIN = 1.35;
const ORB_CENTER_RECOVERY_GAIN = 0.65;
const ORB_HARD_ESCAPE_CLEARANCE = ORB_MIN_CURSOR_CLEARANCE - 8;
const ORB_MAX_ACCELERATION = 0.11;
const ORB_VELOCITY_DAMPING = 0.992;
const ORB_DOCK_TRANSITION_TOTAL_MS = 420;
const ORB_DOCK_TRANSITION_ACK_MS = 90;
const ORB_DOCK_TRANSITION_TRAVEL_MS = 220;
const ORB_DOCK_TRANSITION_LOCK_MS = 110;

// Radial gradients for CSS-config-based skins (used when no image skin is set)
const SKIN_CONFIG_GRADIENTS = {
  cyber:  'radial-gradient(circle at 38% 32%, #c0ffff 0%, #00e5ff 22%, #b829dd 65%, #0e001e 100%)',
  sunset: 'radial-gradient(circle at 38% 32%, #fff4a0 0%, #ff9f43 30%, #ff6b6b 65%, #2e0010 100%)',
  forest: 'radial-gradient(circle at 38% 32%, #b0fff0 0%, #00cec9 30%, #00b894 65%, #002018 100%)',
  neon:   'radial-gradient(circle at 38% 32%, #ffffff 0%, #80ffb0 22%, #ff0080 65%, #120016 100%)',
  cosmic: 'radial-gradient(circle at 38% 32%, #e0d0ff 0%, #8a6cdd 30%, #4169e1 65%, #000820 100%)',
  fire:   'radial-gradient(circle at 38% 32%, #fff0a0 0%, #ff8c00 28%, #ff4500 65%, #180000 100%)',
  ice:    'radial-gradient(circle at 38% 32%, #ffffff 0%, #e8f8ff 30%, #87ceeb 65%, #0e2030 100%)',
  plasma: 'radial-gradient(circle at 38% 32%, #ffffff 0%, #80e8ff 22%, #ff1493 65%, #080010 100%)',
};

const LOGIC_VISUALS = {
  deductive: {
    label: 'Deductive',
    tone: 'Logic guard',
    color: '#67c6ff',
    aura: 'rgba(103, 198, 255, 0.32)',
    hueRotate: 0,
    brightness: 0.96,
  },
  inductive: {
    label: 'Inductive',
    tone: 'Learning drift',
    color: '#63e6a6',
    aura: 'rgba(99, 230, 166, 0.3)',
    hueRotate: 42,
    brightness: 1.02,
  },
  intuitive: {
    label: 'Intuitive',
    tone: 'Pattern lock',
    color: '#f5c96a',
    aura: 'rgba(245, 201, 106, 0.34)',
    hueRotate: -20,
    brightness: 1.08,
  },
};

function modeFromCognitiveMode(cognitiveMode) {
  const mode = String(cognitiveMode || '').toUpperCase();
  if (mode.includes('INTUITION')) return 'intuitive';
  if (mode.includes('HABIT')) return 'inductive';
  return 'deductive';
}

function makeSwarmNodes(count = 4) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.45;
    const distance = 280 + Math.random() * 260;
    return {
      id: `${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
      dx: Math.cos(angle) * distance,
      dy: Math.sin(angle) * distance,
      progress: 0,
      phase: 'out',
    };
  });
}

function clampOrbPosition(x, y) {
  const width = window.innerWidth;
  const height = window.innerHeight;

  return {
    x: Math.min(width - ORB_MARGIN, Math.max(ORB_MARGIN, x)),
    y: Math.min(height - ORB_MARGIN, Math.max(ORB_MARGIN, y)),
  };
}

function normalizeDirection(dx, dy, fallback = ORB_DEFAULT_TRAIL_DIRECTION) {
  const magnitude = Math.hypot(dx, dy);
  if (magnitude < ORB_DIRECTION_EPSILON) {
    return fallback;
  }

  return {
    x: dx / magnitude,
    y: dy / magnitude,
  };
}

function computeEdgeSlack(position) {
  return Math.min(
    position.x - ORB_MARGIN,
    window.innerWidth - ORB_MARGIN - position.x,
    position.y - ORB_MARGIN,
    window.innerHeight - ORB_MARGIN - position.y
  );
}

function chooseAutonomousDriftTarget(current, cursor, driftHeading, presenceProfile = null) {
  const autonomyLevel = clamp(
    Number(presenceProfile?.autonomy_level ?? 0.82),
    0.45,
    1
  );
  if (cursor) {
    const awayFromCursor = normalizeDirection(
      current.x - cursor.x,
      current.y - cursor.y,
      driftHeading
    );
    const tangentCW = { x: -awayFromCursor.y, y: awayFromCursor.x };
    const tangentCCW = { x: awayFromCursor.y, y: -awayFromCursor.x };
    const tangent = (
      tangentCW.x * driftHeading.x + tangentCW.y * driftHeading.y
      >= tangentCCW.x * driftHeading.x + tangentCCW.y * driftHeading.y
    )
      ? tangentCW
      : tangentCCW;
    const desiredRadius = clamp(
      lerp(ORB_CURSOR_LEASH_MIN + 26, ORB_CURSOR_LEASH_MAX, autonomyLevel) + rand(-20, 20),
      ORB_CURSOR_LEASH_MIN,
      ORB_CURSOR_LEASH_MAX
    );
    const orbitalDirection = normalizeDirection(
      awayFromCursor.x * 0.82 + tangent.x * 0.44 + rand(-0.16, 0.16),
      awayFromCursor.y * 0.82 + tangent.y * 0.44 + rand(-0.16, 0.16),
      awayFromCursor
    );
    const forwardDrift = rand(24, 64);
    const anchoredTarget = clampOrbPosition(
      cursor.x + orbitalDirection.x * desiredRadius + driftHeading.x * forwardDrift,
      cursor.y + orbitalDirection.y * desiredRadius + driftHeading.y * forwardDrift
    );
    return ensureCursorClearance(anchoredTarget, cursor, orbitalDirection);
  }

  const viewportCenter = {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
  };
  const centerBias = normalizeDirection(
    viewportCenter.x - current.x,
    viewportCenter.y - current.y,
    ORB_DEFAULT_TRAIL_DIRECTION
  );
  const maxCenterDistance = Math.min(window.innerWidth, window.innerHeight) * 0.38;
  const heading = normalizeDirection(
    driftHeading.x,
    driftHeading.y,
    ORB_DEFAULT_TRAIL_DIRECTION
  );
  const minDistanceFromCursor = ORB_CURSOR_COMFORT_RADIUS + 34 + autonomyLevel * 48;
  const attempts = 12;
  let bestCandidate = null;
  let bestScore = -Infinity;

  for (let i = 0; i < attempts; i += 1) {
    const jitteredDirection = normalizeDirection(
      heading.x + centerBias.x * 0.55 + rand(-0.9, 0.9),
      heading.y + centerBias.y * 0.55 + rand(-0.9, 0.9),
      heading
    );
    const travelDistance = rand(
      ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE,
      ORB_AUTONOMOUS_WAYPOINT_MAX_DISTANCE
    );
    const candidate = clampOrbPosition(
      current.x + jitteredDirection.x * travelDistance,
      current.y + jitteredDirection.y * travelDistance
    );

    const edgeSlack = computeEdgeSlack(candidate);
    const cursorDistance = cursor
      ? Math.hypot(candidate.x - cursor.x, candidate.y - cursor.y)
      : Number.POSITIVE_INFINITY;
    const centerDistance = Math.hypot(
      candidate.x - viewportCenter.x,
      candidate.y - viewportCenter.y
    );
    const centerPenalty = centerDistance > maxCenterDistance
      ? (centerDistance - maxCenterDistance) * 2.8
      : 0;
    const safeCursorScore = Math.min(400, cursorDistance) * 0.45;
    const openSpaceScore = edgeSlack * 1.65;
    const momentumScore =
      (jitteredDirection.x * heading.x + jitteredDirection.y * heading.y) * 55;
    const score = safeCursorScore + openSpaceScore + momentumScore - centerPenalty;

    if (cursorDistance >= minDistanceFromCursor && score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    } else if (!bestCandidate && score > bestScore) {
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  const fallback = bestCandidate
    || clampOrbPosition(
      current.x + heading.x * ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE,
      current.y + heading.y * ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE
    );
  const fallbackSlack = computeEdgeSlack(fallback);
  const correctedFallback = fallbackSlack < 42
    ? clampOrbPosition(
      current.x + centerBias.x * ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE,
      current.y + centerBias.y * ORB_AUTONOMOUS_WAYPOINT_MIN_DISTANCE
    )
    : fallback;
  return ensureCursorClearance(correctedFallback, cursor, heading);
}

function ensureCursorClearance(position, cursor, driftHeading) {
  if (!position || !cursor) {
    return position;
  }

  const distance = Math.hypot(position.x - cursor.x, position.y - cursor.y);
  if (distance >= ORB_MIN_CURSOR_CLEARANCE) {
    return clampOrbPosition(position.x, position.y);
  }

  const away = normalizeDirection(
    position.x - cursor.x,
    position.y - cursor.y,
    { x: -driftHeading.x, y: -driftHeading.y }
  );

  // Primary escape candidate: move away from the cursor to the minimum clearance distance
  const primaryX = cursor.x + away.x * (ORB_MIN_CURSOR_CLEARANCE + 14);
  const primaryY = cursor.y + away.y * (ORB_MIN_CURSOR_CLEARANCE + 14);
  let safePosition = clampOrbPosition(primaryX, primaryY);

  // If the clamped position ends up too close to the window edge (e.g., a corner),
  // try an extended-away candidate or fall back to a safer center position to
  // avoid being trapped against margins and oscillating.
  const edgeSlack = computeEdgeSlack(safePosition);
  if (edgeSlack < 20) {
    const extendedX = cursor.x + away.x * (ORB_MIN_CURSOR_CLEARANCE + 140);
    const extendedY = cursor.y + away.y * (ORB_MIN_CURSOR_CLEARANCE + 140);
    const extendedPosition = clampOrbPosition(extendedX, extendedY);
    const extendedSlack = computeEdgeSlack(extendedPosition);
    if (extendedSlack > edgeSlack) {
      safePosition = extendedPosition;
    } else {
      // Last-resort: place near center to avoid corner trapping
      safePosition = clampOrbPosition(window.innerWidth * 0.5, window.innerHeight * 0.5);
    }
  }

  return safePosition;
}

function shouldRetargetDrift(current, target, cursor, lastRetargetAt, presenceProfile = null) {
  const idleSeconds = Number(presenceProfile?.idle_seconds ?? 0);
  const intervalBoost = clamp(idleSeconds * 65, 0, ORB_AUTONOMOUS_RETARGET_INTERVAL_IDLE_MAX_MS - ORB_AUTONOMOUS_RETARGET_INTERVAL_MS);
  const dynamicRetargetIntervalMs = ORB_AUTONOMOUS_RETARGET_INTERVAL_MS + intervalBoost;

  if (!current || !target) {
    return true;
  }

  if (Date.now() - lastRetargetAt < ORB_RETARGET_STABILITY_WINDOW_MS) {
    return false;
  }

  const distanceToTarget = Math.hypot(target.x - current.x, target.y - current.y);
  const reachedTarget = distanceToTarget <= ORB_RETARGET_DISTANCE;

  if (computeEdgeSlack(target) < 28) {
    return true;
  }

  if (cursor) {
    const targetDistanceToCursor = Math.hypot(target.x - cursor.x, target.y - cursor.y);
    if (
      targetDistanceToCursor < ORB_CURSOR_LEASH_MIN * 0.92
      || targetDistanceToCursor > ORB_CURSOR_LEASH_MAX * 1.65
    ) {
      return true;
    }
  }

  if (reachedTarget && Date.now() - lastRetargetAt > dynamicRetargetIntervalMs * 0.45) {
    return true;
  }

  return Date.now() - lastRetargetAt > dynamicRetargetIntervalMs;
}

function buildSteeringVector(current, target, cursor, presenceProfile, fallbackDirection) {
  const autonomyLevel = clamp(
    Number(presenceProfile?.autonomy_level ?? 0.82),
    0.45,
    1
  );
  const targetDirection = normalizeDirection(
    target.x - current.x,
    target.y - current.y,
    fallbackDirection
  );
  let sx = targetDirection.x;
  let sy = targetDirection.y;

  const centerDirection = normalizeDirection(
    window.innerWidth * 0.5 - current.x,
    window.innerHeight * 0.5 - current.y,
    targetDirection
  );
  const edgeSlack = computeEdgeSlack(current);
  if (edgeSlack < ORB_EDGE_REPEL_DISTANCE * 0.8) {
    sx += centerDirection.x * ORB_CENTER_RECOVERY_GAIN;
    sy += centerDirection.y * ORB_CENTER_RECOVERY_GAIN;
  }

  const leftDistance = current.x - ORB_MARGIN;
  const rightDistance = window.innerWidth - ORB_MARGIN - current.x;
  const topDistance = current.y - ORB_MARGIN;
  const bottomDistance = window.innerHeight - ORB_MARGIN - current.y;

  if (leftDistance < ORB_EDGE_REPEL_DISTANCE) {
    sx += (1 - leftDistance / ORB_EDGE_REPEL_DISTANCE) * ORB_EDGE_REPEL_GAIN;
  }
  if (rightDistance < ORB_EDGE_REPEL_DISTANCE) {
    sx -= (1 - rightDistance / ORB_EDGE_REPEL_DISTANCE) * ORB_EDGE_REPEL_GAIN;
  }
  if (topDistance < ORB_EDGE_REPEL_DISTANCE) {
    sy += (1 - topDistance / ORB_EDGE_REPEL_DISTANCE) * ORB_EDGE_REPEL_GAIN;
  }
  if (bottomDistance < ORB_EDGE_REPEL_DISTANCE) {
    sy -= (1 - bottomDistance / ORB_EDGE_REPEL_DISTANCE) * ORB_EDGE_REPEL_GAIN;
  }

  if (cursor) {
    const distanceToCursor = Math.hypot(
      current.x - cursor.x,
      current.y - cursor.y
    );
    if (distanceToCursor < ORB_CURSOR_REPEL_RADIUS) {
      const away = normalizeDirection(
        current.x - cursor.x,
        current.y - cursor.y,
        { x: -targetDirection.x, y: -targetDirection.y }
      );
      const pressure = clamp(
        1 - distanceToCursor / ORB_CURSOR_REPEL_RADIUS,
        0,
        1
      );
      const repelStrength = Math.pow(pressure, 1.5) * (1.3 + autonomyLevel * 0.7);
      sx += away.x * repelStrength;
      sy += away.y * repelStrength;
    }
  }

  return normalizeDirection(sx, sy, targetDirection);
}

function toPlayableAudioUrl(audioPath) {
  if (!audioPath || typeof audioPath !== 'string') {
    return null;
  }

  if (/^(file|https?):/i.test(audioPath)) {
    return audioPath;
  }

  try {
    return pathToFileURL(audioPath).href;
  } catch (_error) {
    return null;
  }
}

function FloatingOrb() {
  const [logicMode, setLogicMode] = useState('deductive');
  const [bridgeStatus, setBridgeStatus] = useState('Bridge booting');
  const [tone, setTone] = useState('Observing');
  const [bloomLevel, setBloomLevel] = useState(0.22);
  const [orbScale, setOrbScale] = useState(1);
  const [skinUrl, setSkinUrl] = useState(null);
  const [skinConfig, setSkinConfig] = useState(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandText, setCommandText] = useState('');
  const [lastResponseText, setLastResponseText] = useState('');
  const [speechBubbleText, setSpeechBubbleText] = useState('');
  const [speechBubbleMode, setSpeechBubbleMode] = useState('response');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [nodOffset, setNodOffset] = useState({ x: 0, y: 0 });
  const [socketHint, setSocketHint] = useState('Base frame');
  const [orbVisible, setOrbVisible] = useState(true);
  const [dockTransitionOffset, setDockTransitionOffset] = useState({ x: 0, y: 0 });
  const [dockTransitionScale, setDockTransitionScale] = useState(1);
  const [dockTransitionOpacity, setDockTransitionOpacity] = useState(1);
  const [displayActive, setDisplayActive] = useState(true);
  const [hasPositionUpdate, setHasPositionUpdate] = useState(false);
  const [swarmNodes, setSwarmNodes] = useState([]);
  const [cursorPosition, setCursorPosition] = useState({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.46),
  });
  const swarmPhaseTimerRef = useRef(null);
  const cursorPositionRef = useRef(cursorPosition);
  const displayActiveRef = useRef(displayActive);
  const targetCursorPositionRef = useRef(cursorPosition);
  const animationFrameRef = useRef(null);
  const draggingRef = useRef(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const mousePassthroughRef = useRef(true);
  const nodTimerRef = useRef(null);
  const lastCursorPointRef = useRef({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.46),
  });
  const driftHeadingRef = useRef(ORB_DEFAULT_TRAIL_DIRECTION);
  const lastRetargetAtRef = useRef(0);
  const lastPointerRef = useRef({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.46),
  });
  const lastKnownCursorRef = useRef({
    x: Math.round(window.innerWidth * 0.5),
    y: Math.round(window.innerHeight * 0.46),
  });
  const activeAudioRef = useRef(null);
  const speechBubbleTimerRef = useRef(null);
  const dockTransitionTimersRef = useRef([]);
  const dockingInProgressRef = useRef(false);
  const presenceProfileRef = useRef({
    is_idle: false,
    idle_seconds: 0,
    autonomy_level: 0.82,
    movement_intent: 'free_float',
    cursor_influence: 'low',
  });
  const velocityRef = useRef({
    x: ORB_DEFAULT_TRAIL_DIRECTION.x * ORB_AUTONOMOUS_BASE_SPEED,
    y: ORB_DEFAULT_TRAIL_DIRECTION.y * ORB_AUTONOMOUS_BASE_SPEED,
  });
  const lastForcedRetargetAtRef = useRef(0);
  const lastCursorAvoidAtRef = useRef(0);

  const visualMode = ORB_VISUAL_MODE_LOCK || logicMode;
  const visual = useMemo(() => LOGIC_VISUALS[visualMode], [visualMode]);

  const showSpeechBubble = (text, options = {}) => {
    const normalized = String(text || '').trim();
    if (!normalized) {
      return;
    }
    const mode = typeof options === 'string' ? options : options.mode || 'response';
    const persistMs =
      typeof options === 'number'
        ? options
        : options.persistMs ||
          (mode === 'state'
            ? 1200
            : Math.min(9000, Math.max(700, normalized.length * 45)));
    if (speechBubbleTimerRef.current) {
      clearTimeout(speechBubbleTimerRef.current);
    }
    setSpeechBubbleMode(mode);
    setSpeechBubbleText(normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized);
    speechBubbleTimerRef.current = setTimeout(() => {
      setSpeechBubbleText('');
      speechBubbleTimerRef.current = null;
    }, Math.min(Math.max(Number(persistMs) || 4200, 700), 9000));
  };

  useEffect(() => {
    const decay = setInterval(() => {
      setBloomLevel((current) => Math.max(0.16, current - 0.045));
    }, 130);
    return () => clearInterval(decay);
  }, []);

  useEffect(() => {
    if (!swarmNodes.length) {
      return undefined;
    }

    const interval = setInterval(() => {
      let absorbed = 0;

      setSwarmNodes((current) =>
        current
          .map((node) => {
            const nextProgress = Math.min(1, node.progress + (node.phase === 'out' ? 0.18 : 0.16));
            if (node.phase === 'in' && nextProgress >= 1) {
              absorbed += 1;
              return null;
            }
            return { ...node, progress: nextProgress };
          })
          .filter(Boolean)
      );

      if (absorbed > 0) {
        setBloomLevel((current) => Math.max(current, 0.88));
        setOrbScale(1.09);
        setTimeout(() => setOrbScale(1), 220);
      }
    }, 33);

    return () => clearInterval(interval);
  }, [swarmNodes.length]);

  useEffect(() => () => {
    if (swarmPhaseTimerRef.current) {
      clearTimeout(swarmPhaseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    cursorPositionRef.current = cursorPosition;
  }, [cursorPosition]);

  useEffect(() => {
    displayActiveRef.current = displayActive;
  }, [displayActive]);

  useEffect(() => {
    if (commandOpen) {
      window.electronAPI?.setIgnoreMouseEvents(false);
    }
  }, [commandOpen]);

  useEffect(() => () => {
    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current = null;
    }
    if (speechBubbleTimerRef.current) {
      clearTimeout(speechBubbleTimerRef.current);
      speechBubbleTimerRef.current = null;
    }
    if (dockTransitionTimersRef.current?.length) {
      dockTransitionTimersRef.current.forEach((id) => clearTimeout(id));
      dockTransitionTimersRef.current = [];
    }
    if (nodTimerRef.current) {
      nodTimerRef.current.forEach((id) => clearTimeout(id));
      nodTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const animateOrb = () => {
      try {
        if (!draggingRef.current) {
          const current = cursorPositionRef.current;
          const now = Date.now();
          const profile = presenceProfileRef.current || {};
          const forceIntervalMs = profile?.is_idle
            ? ORB_AUTONOMOUS_FORCE_RETARGET_IDLE_MS
            : ORB_AUTONOMOUS_FORCE_RETARGET_BASE_MS;

          if (now - lastForcedRetargetAtRef.current >= forceIntervalMs) {
            targetCursorPositionRef.current = chooseAutonomousDriftTarget(
              current,
              lastKnownCursorRef.current,
              driftHeadingRef.current,
              profile
            );
            lastForcedRetargetAtRef.current = now;
            lastRetargetAtRef.current = now;
          }

          if (
            shouldRetargetDrift(
              current,
              targetCursorPositionRef.current,
              lastKnownCursorRef.current,
              lastRetargetAtRef.current,
              profile
            )
          ) {
            targetCursorPositionRef.current = chooseAutonomousDriftTarget(
              current,
              lastKnownCursorRef.current,
              driftHeadingRef.current,
              profile
            );
            lastRetargetAtRef.current = now;
          }

          const target = targetCursorPositionRef.current;
          const steeringDirection = buildSteeringVector(
            current,
            target,
            lastKnownCursorRef.current,
            profile,
            driftHeadingRef.current
          );
          const autonomyLevel = clamp(
            Number(profile?.autonomy_level ?? 0.82),
            0.45,
            1
          );
          const targetSpeed = clamp(
            ORB_AUTONOMOUS_BASE_SPEED +
              (profile?.is_idle ? ORB_AUTONOMOUS_IDLE_SPEED_BONUS : 0) +
              (autonomyLevel - 0.7) * 0.6,
            1.3,
            3.1
          );
          const desiredVelocity = {
            x: steeringDirection.x * targetSpeed,
            y: steeringDirection.y * targetSpeed,
          };
          const velocity = velocityRef.current;
          const blendedVelocity = {
            x: lerp(velocity.x, desiredVelocity.x, ORB_STEER_BLEND),
            y: lerp(velocity.y, desiredVelocity.y, ORB_STEER_BLEND),
          };
          const deltaVelocity = {
            x: blendedVelocity.x - velocity.x,
            y: blendedVelocity.y - velocity.y,
          };
          const deltaMagnitude = Math.hypot(deltaVelocity.x, deltaVelocity.y);
          const maxAcceleration = ORB_MAX_ACCELERATION + (profile?.is_idle ? 0.03 : 0);
          const accelerationScale = deltaMagnitude > maxAcceleration
            ? maxAcceleration / deltaMagnitude
            : 1;
          const nextVelocity = {
            x: (velocity.x + deltaVelocity.x * accelerationScale) * ORB_VELOCITY_DAMPING,
            y: (velocity.y + deltaVelocity.y * accelerationScale) * ORB_VELOCITY_DAMPING,
          };
          velocityRef.current = nextVelocity;

          const projectedPosition = clampOrbPosition(
            current.x + nextVelocity.x,
            current.y + nextVelocity.y
          );
          if (projectedPosition.x === ORB_MARGIN || projectedPosition.x === window.innerWidth - ORB_MARGIN) {
            velocityRef.current.x *= 0.45;
          }
          if (projectedPosition.y === ORB_MARGIN || projectedPosition.y === window.innerHeight - ORB_MARGIN) {
            velocityRef.current.y *= 0.45;
          }

          const safePosition = ensureCursorClearance(
            projectedPosition,
            lastKnownCursorRef.current,
            driftHeadingRef.current
          );
          const moved = Math.hypot(
            safePosition.x - current.x,
            safePosition.y - current.y
          );
          if (moved < 0.16 && computeEdgeSlack(safePosition) < 18) {
            const centerRecovery = clampOrbPosition(
              window.innerWidth * 0.5 + rand(-140, 140),
              window.innerHeight * 0.5 + rand(-95, 95)
            );
            targetCursorPositionRef.current = centerRecovery;
            lastRetargetAtRef.current = now;
          }

          driftHeadingRef.current = normalizeDirection(
            velocityRef.current.x,
            velocityRef.current.y,
            driftHeadingRef.current
          );
          cursorPositionRef.current = safePosition;
          setCursorPosition(safePosition);
        }
      } catch (error) {
        console.warn('Orb animation loop error:', error);
      }

      animationFrameRef.current = window.requestAnimationFrame(animateOrb);
    };

    animationFrameRef.current = window.requestAnimationFrame(animateOrb);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const setMousePassthrough = (ignore) => {
      if (mousePassthroughRef.current === ignore) {
        return;
      }
      mousePassthroughRef.current = ignore;
      window.electronAPI?.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
    };

    const isPointerOverOrb = (x, y) => {
      const dx = x - cursorPositionRef.current.x;
      const dy = y - cursorPositionRef.current.y;
      return Math.hypot(dx, dy) <= ORB_INTERACTION_RADIUS;
    };

    const handleMouseMove = (event) => {
      const pointer = { x: event.clientX, y: event.clientY };
      lastPointerRef.current = pointer;

      if (draggingRef.current) {
        const nextPosition = clampOrbPosition(
          pointer.x - dragOffsetRef.current.x,
          pointer.y - dragOffsetRef.current.y
        );
        velocityRef.current = { x: 0, y: 0 };
        targetCursorPositionRef.current = nextPosition;
        cursorPositionRef.current = nextPosition;
        setCursorPosition(nextPosition);
        setMousePassthrough(false);
        return;
      }

      const hoveringOrb = isPointerOverOrb(pointer.x, pointer.y);
      setMousePassthrough(!(hoveringOrb && event.shiftKey));
    };

    const handleMouseUp = () => {
      if (!draggingRef.current) {
        return;
      }

      draggingRef.current = false;
      const releasedPosition = ensureCursorClearance(
        cursorPositionRef.current,
        lastKnownCursorRef.current,
        driftHeadingRef.current
      );
      cursorPositionRef.current = releasedPosition;
      driftHeadingRef.current = normalizeDirection(
        releasedPosition.x - lastKnownCursorRef.current.x,
        releasedPosition.y - lastKnownCursorRef.current.y,
        driftHeadingRef.current
      );
      targetCursorPositionRef.current = chooseAutonomousDriftTarget(
        releasedPosition,
        lastKnownCursorRef.current,
        driftHeadingRef.current,
        presenceProfileRef.current
      );
      velocityRef.current = {
        x: driftHeadingRef.current.x * ORB_AUTONOMOUS_BASE_SPEED,
        y: driftHeadingRef.current.y * ORB_AUTONOMOUS_BASE_SPEED,
      };
      lastRetargetAtRef.current = Date.now();
      setCursorPosition(releasedPosition);
      setMousePassthrough(true);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  useEffect(() => {
    if (!window.electronAPI) {
      return undefined;
    }

    const playOrbAudio = (audioPath) => {
      const audioUrl = toPlayableAudioUrl(audioPath);
      if (!audioUrl) {
        return;
      }

      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
        activeAudioRef.current = null;
      }

      const audio = new Audio(audioUrl);
      audio.preload = 'auto';
      audio.volume = 1;
      activeAudioRef.current = audio;

      const clearIfCurrent = () => {
        if (activeAudioRef.current === audio) {
          activeAudioRef.current = null;
        }
      };

      audio.addEventListener('ended', clearIfCurrent, { once: true });
      audio.addEventListener('error', clearIfCurrent, { once: true });

      audio.play().catch((error) => {
        console.warn('Orb audio playback failed:', error);
        clearIfCurrent();
      });
    };

    const applyPulse = (pulse) => {
      const payload = pulse?.data?.predicate || pulse;
      const nextMode = modeFromCognitiveMode(payload?.cognitive_mode);
      setLogicMode(nextMode);
      const recalledFromPosteriori = pulse?.source === 'POSTERIORI';
      const recalledFromApriori = pulse?.source === 'APRIORI';
      setTone(
        recalledFromPosteriori
          ? 'Remembering'
          : recalledFromApriori
            ? 'Law recall'
            : LOGIC_VISUALS[nextMode].tone
      );
      setBridgeStatus(
        recalledFromPosteriori
          ? 'Posteriori recall'
          : recalledFromApriori
            ? 'Apriori recall'
            : `${LOGIC_VISUALS[nextMode].label} channel live`
      );
      setBloomLevel(
        Math.max(
          recalledFromPosteriori || recalledFromApriori ? 0.62 : 0.45,
          Math.min(1, payload?.glow_intensity ?? 0.5)
        )
      );
      setSwarmNodes((current) =>
        current.map((node) => (node.phase === 'out' ? { ...node, phase: 'in', progress: 0 } : node))
      );
    };

    const unsubscribers = [
      window.electronAPI.onOrbPositionUpdate((_event, payload) => {
        if (draggingRef.current) {
          return;
        }

        setHasPositionUpdate(true);
        const isActiveDisplay = payload?.active !== false;
        if (!isActiveDisplay) {
          draggingRef.current = false;
          displayActiveRef.current = false;
          setDisplayActive(false);
          return;
        }

        const cursorPoint = {
          x: payload?.x ?? window.innerWidth / 2,
          y: payload?.y ?? window.innerHeight / 2,
        };
        lastKnownCursorRef.current = cursorPoint;
        const previousCursorPoint = lastCursorPointRef.current;
        const movement = {
          x: cursorPoint.x - previousCursorPoint.x,
          y: cursorPoint.y - previousCursorPoint.y,
        };
        if (Math.hypot(movement.x, movement.y) > ORB_DIRECTION_EPSILON) {
          driftHeadingRef.current = normalizeDirection(
            driftHeadingRef.current.x * 0.985 + movement.x * 0.015,
            driftHeadingRef.current.y * 0.985 + movement.y * 0.015,
            driftHeadingRef.current
          );
        }
        lastCursorPointRef.current = cursorPoint;
        if (!displayActiveRef.current) {
          const resetPosition = ensureCursorClearance(
            cursorPositionRef.current,
            cursorPoint,
            driftHeadingRef.current
          );
          cursorPositionRef.current = resetPosition;
          setCursorPosition(resetPosition);
        }
        displayActiveRef.current = true;
        setDisplayActive(true);
        const distanceToCursor = Math.hypot(
          cursorPositionRef.current.x - cursorPoint.x,
          cursorPositionRef.current.y - cursorPoint.y
        );

        if (
          distanceToCursor < ORB_HARD_ESCAPE_CLEARANCE &&
          Date.now() - lastCursorAvoidAtRef.current >= ORB_CURSOR_REACTION_COOLDOWN_MS
        ) {
          const away = normalizeDirection(
            cursorPositionRef.current.x - cursorPoint.x,
            cursorPositionRef.current.y - cursorPoint.y,
            driftHeadingRef.current
          );
          const softEscapeTarget = clampOrbPosition(
            cursorPoint.x + away.x * (ORB_CURSOR_LEASH_MIN + 28),
            cursorPoint.y + away.y * (ORB_CURSOR_LEASH_MIN + 28)
          );
          targetCursorPositionRef.current = {
            x: lerp(targetCursorPositionRef.current.x, softEscapeTarget.x, 0.34),
            y: lerp(targetCursorPositionRef.current.y, softEscapeTarget.y, 0.34),
          };
          velocityRef.current = {
            x: lerp(velocityRef.current.x, away.x * (ORB_AUTONOMOUS_BASE_SPEED + 0.28), 0.28),
            y: lerp(velocityRef.current.y, away.y * (ORB_AUTONOMOUS_BASE_SPEED + 0.28), 0.28),
          };
          const now = Date.now();
          lastRetargetAtRef.current = now;
          lastCursorAvoidAtRef.current = now;
        }
      }),
      window.electronAPI.onCognitivePulse((_event, pulse) => applyPulse(pulse)),
      window.electronAPI.onSpeechPulse((_event, message) => {
        applyPulse(message?.data || {});
        setTone('Responding');
        setBridgeStatus(message?.response_text || message?.transcription || 'Voice response ready');
        setBloomLevel(0.82);
        setOrbScale(1.08);
        setTimeout(() => setOrbScale(1), 260);
      }),
      window.electronAPI.onHysteresis((_event, data) => {
        setTone('Bloom threshold');
        setBridgeStatus(`Hysteresis ${data.triggerThreshold} -> ${data.releaseThreshold}`);
        setBloomLevel(1);
        setOrbScale(1.06);
        setTimeout(() => setOrbScale(1), 260);
      }),
      window.electronAPI.onOrbSkinUpdated((_event, payload) => {
        const nextSkinUrl = payload?.imageUrl || null;
        setSkinUrl(nextSkinUrl);
        setSocketHint(nextSkinUrl ? 'Socket engaged' : 'Base frame');
      }),
      window.electronAPI.onSkinConfigUpdated && window.electronAPI.onSkinConfigUpdated((_event, config) => {
        setSkinConfig(config || null);
        setSocketHint(config ? `Skin: ${config.name || config.colorScheme || 'Custom'}` : 'Base frame');
      }),
      window.electronAPI.onOrbBridgeMessage((_event, message) => {
        const payload = message?.data || {};
        const audioPath = payload?.audio_path || message?.audio_path;
        if (audioPath) {
          playOrbAudio(audioPath);
        }

        if (message?.type === 'ready') {
          setBridgeStatus('Python bridge ready');
          setTone('Present');
          setBloomLevel(0.72);
        }
        if (message?.type === 'bridge_exit') {
          setBridgeStatus('Bridge offline');
          setTone('Sleeping');
        }
        if (message?.type === 'listening_state') {
          const active = Boolean(message?.data?.listening);
          const mode = message?.data?.mode === 'oneshot' ? 'Voice capture' : 'Listening';
          setTone(active ? mode : 'Present');
          setBridgeStatus(active ? `${mode} armed` : 'Awaiting gesture');
          setBloomLevel(active ? 0.95 : 0.42);
          setOrbScale(active ? 1.08 : 1);
        }
        if (message?.type === 'listen_once_ack' && !message?.data?.accepted) {
          setTone('Voice busy');
          setBridgeStatus('Voice capture unavailable');
          setBloomLevel(0.68);
        }
        if (message?.type === 'presence_update' || message?.type === 'presence_pulse') {
          const profile = message?.type === 'presence_update'
            ? {
              is_idle: Boolean(message?.idle),
              idle_seconds: Number(message?.idle_seconds || 0),
              autonomy_level: Number(message?.autonomy_level || 0.82),
              movement_intent: message?.movement_intent || 'free_float',
              cursor_influence: message?.cursor_influence || 'low',
              active_window: message?.active_window,
              active_process: message?.active_process,
              quadrant: message?.quadrant,
            }
            : (message?.data?.presence_profile || {});
          presenceProfileRef.current = {
            ...presenceProfileRef.current,
            ...profile,
          };
          const autonomy = Number(
            profile.autonomy_level ?? presenceProfileRef.current.autonomy_level ?? 0.82
          );
          const idleSeconds = Number(
            profile.idle_seconds ?? presenceProfileRef.current.idle_seconds ?? 0
          );
          setTone(profile.is_idle ? 'Ambient presence' : 'Autonomous drift');
          setBridgeStatus(
            `Presence autonomy ${autonomy.toFixed(2)} | idle ${Math.round(idleSeconds)}s`
          );
          setBloomLevel((current) => Math.max(current, profile.is_idle ? 0.58 : 0.46));
        }
        if (message?.type === 'query_result') {
          setTone('Responding');
          const text = message?.data?.response_text || message?.data?.text || 'Response ready';
          setBridgeStatus(text);
          setLastResponseText(text);
          showSpeechBubble(text);
          setBloomLevel(1);
          setOrbScale(1.1);
          setTimeout(() => setOrbScale(1), 260);
          triggerSwarmDeployment(5);
        }
        if (message?.type === 'research_result') {
          setTone('Research ready');
          const text = message?.data?.voice_response || message?.data?.response_text || message?.data?.summary || 'Research response ready';
          setBridgeStatus(text);
          setLastResponseText(text);
          showSpeechBubble(text, { persistMs: 5600 });
          setBloomLevel(0.96);
          setOrbScale(1.08);
          setTimeout(() => setOrbScale(1), 260);
          triggerSwarmDeployment(5);
        }
        if (message?.type === 'cali:state') {
          const phase = message?.data?.phase || 'processing';
          const text =
            message?.data?.text ||
            {
              planning: 'Working with you on this.',
              searching: 'Looking through the available memory and sources.',
              verifying: 'Checking the source picture.',
              synthesizing: 'Pulling the answer together.',
              speaking: 'Ready.',
            }[phase] ||
            '';
          const prefix = {
            planning: '*',
            searching: '~',
            verifying: '+',
            synthesizing: '=',
            speaking: 'o',
          }[phase] || '*';
          if (text) {
            setTone(`CALI ${phase}`);
            setBridgeStatus(text);
            showSpeechBubble(`${prefix} ${text}`, { mode: 'state' });
          }
        }
        if (message?.type === 'speech_pulse') {
          const text = message?.response_text || message?.data?.response_text || message?.research?.response_text || '';
          if (text) {
            showSpeechBubble(text);
          }
        }
        if (message?.type === 'speak_result') {
          setTone('Speaking');
          const text = message?.data?.text || 'Voice response ready';
          setBridgeStatus(text);
          setLastResponseText(text);
          showSpeechBubble(text);
          setBloomLevel(0.88);
          setOrbScale(1.08);
          setTimeout(() => setOrbScale(1), 260);
        }
        if (message?.type === 'note_result') {
          setTone('Taking notes');
          const text = message?.data?.response_text || 'Note saved';
          setBridgeStatus(text);
          showSpeechBubble(text, { persistMs: 2600 });
          setBloomLevel(0.82);
        }
        if (message?.type === 'research_vault_result') {
          setTone('Research memory');
          const text = message?.data?.response_text || 'Research memory updated';
          setBridgeStatus(text);
          showSpeechBubble(text, { persistMs: 3200 });
          setBloomLevel(0.84);
        }
        if (message?.type === 'core_knowledge_result') {
          setTone('Core knowledge');
          const text = message?.data?.response_text || 'Core knowledge ready';
          setBridgeStatus(text);
          showSpeechBubble(text, { persistMs: 4200 });
          setBloomLevel(0.86);
        }
        if (message?.type === 'skill_result') {
          setTone('CALI skill');
          const text = message?.data?.response_text || 'Skill result ready';
          setBridgeStatus(text);
          showSpeechBubble(text, { persistMs: 4200 });
          setBloomLevel(0.86);
        }
      }),
      window.electronAPI.onOrbStatusChange((_event, status) => {
        if (status?.controller_status) {
          setBridgeStatus(`Brain ${status.controller_status}`);
        }
      }),
      window.electronAPI.onOrbVisibilityChanged((_event, payload) => {
        const visible = payload?.visible !== false;
        setOrbVisible(visible);
        setTone(visible ? 'Present' : 'Docked');
        setBridgeStatus(visible ? 'Orb deployed' : 'Tray docked');
        if (visible) {
          cancelDockTransition();
          setBloomLevel(0.9);
          setOrbScale(1.08);
          setTimeout(() => setOrbScale(1), 260);
        }
      }),
      window.electronAPI.onDockTransition?.((_event, payload) => {
        if (payload?.phase === 'cancel') {
          cancelDockTransition();
          setTone('Present');
          setBridgeStatus('Dock canceled');
          return;
        }
        if (payload?.phase === 'start') {
          startDockTransition(payload);
        }
      }),
    ];

    window.electronAPI.getOrbStatus?.().catch(() => {});

    return () => {
      unsubscribers.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') unsubscribe();
      });
    };
  }, []);

  const handleCommandSubmit = async (mode) => {
    if (!commandText.trim()) return;
    setIsSubmitting(true);
    const text = commandText.trim();
    try {
      if (mode === 'ask') {
        setTone('Querying');
        setBridgeStatus(text);
        pulseOrb(0.92, 1.08, 240);
        const result = await window.electronAPI?.orbQuery?.(text);
        const responseText = result?.response_text || result?.text || 'Response ready';
        setLastResponseText(responseText);
        setBridgeStatus(responseText);
        showSpeechBubble(responseText);
      } else if (mode === 'search') {
        setTone('Researching');
        setBridgeStatus(text);
        pulseOrb(0.96, 1.08, 260);
        triggerSwarmDeployment(5);
        const result = await window.electronAPI?.orbResearch?.(text, []);
        const responseText = result?.voice_response || result?.response_text || result?.summary || 'Research response ready';
        setLastResponseText(responseText);
        setBridgeStatus(responseText);
        showSpeechBubble(responseText, { persistMs: 5600 });
      } else if (mode === 'shop') {
        await window.electronAPI?.openSearch?.(text, 'shopping');
        setBridgeStatus(`Opened shopping for "${text}"`);
        setLastResponseText(`Shopping: ${text}`);
        pulseOrb(0.82, 1.04, 200);
      }
    } catch (error) {
      setBridgeStatus('Command failed');
      setLastResponseText(`Error: ${error.message || error}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const playNod = (direction = 'yes') => {
    if (nodTimerRef.current) {
      nodTimerRef.current.forEach((id) => clearTimeout(id));
    }
    const frames =
      direction === 'no'
        ? [
            { x: -10, y: 0 },
            { x: 10, y: 0 },
            { x: -8, y: 0 },
            { x: 0, y: 0 },
          ]
        : [
            { x: 0, y: -10 },
            { x: 0, y: 10 },
            { x: 0, y: -6 },
            { x: 0, y: 0 },
          ];
    const timers = [];
    frames.forEach((offset, idx) => {
      timers.push(
        setTimeout(() => {
          setNodOffset(offset);
        }, idx * 110)
      );
    });
    nodTimerRef.current = timers;
  };

  const clearDockTransitionTimers = () => {
    if (!dockTransitionTimersRef.current?.length) {
      return;
    }
    dockTransitionTimersRef.current.forEach((id) => clearTimeout(id));
    dockTransitionTimersRef.current = [];
  };

  const cancelDockTransition = () => {
    clearDockTransitionTimers();
    dockingInProgressRef.current = false;
    setDockTransitionOffset({ x: 0, y: 0 });
    setDockTransitionScale(1);
    setDockTransitionOpacity(1);
  };

  const startDockTransition = async (spec = {}) => {
    if (dockingInProgressRef.current) {
      return;
    }

    dockingInProgressRef.current = true;
    clearDockTransitionTimers();

    const ackMs = Number(spec?.ackMs) || ORB_DOCK_TRANSITION_ACK_MS;
    const travelMs = Number(spec?.travelMs) || ORB_DOCK_TRANSITION_TRAVEL_MS;
    const lockMs = Number(spec?.lockMs) || ORB_DOCK_TRANSITION_LOCK_MS;
    const totalMs = Number(spec?.totalMs) || ORB_DOCK_TRANSITION_TOTAL_MS;

    const current = cursorPositionRef.current;
    const dockAnchor = {
      x: Math.round(window.innerWidth * 0.5),
      y: Math.max(110, window.innerHeight - 110),
    };
    const dockVector = {
      x: dockAnchor.x - current.x,
      y: dockAnchor.y - current.y,
    };

    setTone('Docking');
    setBridgeStatus('Dock acknowledge');
    setBloomLevel(0.94);
    setDockTransitionScale(1.03);

    dockTransitionTimersRef.current.push(
      setTimeout(() => {
        setBridgeStatus('Dock trajectory');
        setDockTransitionOffset(dockVector);
        setDockTransitionScale(1.04);
        setDockTransitionOpacity(0.96);
      }, ackMs),
      setTimeout(() => {
        setBridgeStatus('Dock lock');
        setDockTransitionScale(0.97);
        setDockTransitionOpacity(0.86);
      }, ackMs + travelMs),
      setTimeout(() => {
        setDockTransitionScale(1);
      }, ackMs + travelMs + Math.max(50, Math.floor(lockMs * 0.6))),
      setTimeout(async () => {
        setTone('Docked');
        setBridgeStatus('Docked');
        setBloomLevel(0.58);
        try {
          await window.electronAPI?.completeDockTransition?.();
        } catch (_error) {}
        cancelDockTransition();
      }, totalMs + 20)
    );
  };

  const orbStyle = {
    position: 'absolute',
    left: `${cursorPosition.x}px`,
    top: `${cursorPosition.y}px`,
    width: `${ORB_DIAMETER}px`,
    height: `${ORB_DIAMETER}px`,
    pointerEvents: 'auto',
    cursor: draggingRef.current ? 'grabbing' : 'grab',
    transform: `translate(-50%, -50%) translate(${nodOffset.x + dockTransitionOffset.x}px, ${nodOffset.y + dockTransitionOffset.y}px) scale(${(orbScale + bloomLevel * 0.08) * dockTransitionScale})`,
    opacity: dockTransitionOpacity,
    transition: 'transform 220ms cubic-bezier(0.22, 0.8, 0.2, 1), opacity 180ms ease',
    willChange: 'left, top, transform',
    WebkitAppRegion: 'no-drag',
  };

  const commandPanelStyle = {
    position: 'absolute',
    left: '54%',
    top: '-12px',
    minWidth: '240px',
    maxWidth: '360px',
    padding: '12px 14px',
    borderRadius: '18px',
    background: 'rgba(12,18,31,0.9)',
    color: '#e8f0ff',
    boxShadow: '0 8px 28px rgba(0,0,0,0.32)',
    border: '1px solid rgba(103,198,255,0.32)',
    display: commandOpen ? 'block' : 'none',
    pointerEvents: 'auto',
    transform: 'translateY(-50%)',
    backdropFilter: 'blur(10px)',
    zIndex: 3,
  };

  const buttonRowStyle = {
    display: 'flex',
    gap: '8px',
    marginTop: '8px',
  };

  const auraStyle = {
    position: 'absolute',
    inset: '-18px',
    borderRadius: '50%',
    background: `radial-gradient(circle, ${visual.aura} 0%, rgba(255,255,255,0.06) 45%, rgba(255,255,255,0) 72%)`,
    opacity: 0.34 + bloomLevel * 0.56,
    filter: `blur(${10 + bloomLevel * 12}px)`,
    transform: `scale(${1 + bloomLevel * 0.18})`,
    transition: 'all 160ms ease',
  };

  // Determine inner content gradient from config skin or cognitive visual
  const innerContentBackground = skinUrl
    ? 'transparent'
    : skinConfig && SKIN_CONFIG_GRADIENTS[skinConfig.colorScheme]
      ? SKIN_CONFIG_GRADIENTS[skinConfig.colorScheme]
      : `radial-gradient(circle at 36% 30%, rgba(255,255,255,0.92), ${visual.color} 28%, rgba(8,12,24,0.98) 75%)`;

  // Glass outer shell — the encasing sphere
  const glassShellStyle = {
    position: 'absolute',
    inset: '10px',
    borderRadius: '50%',
    // Glass rim material: clear center, increasingly opaque glassy edges
    background: `radial-gradient(circle at 50% 50%,
      transparent 52%,
      rgba(180, 220, 255, 0.03) 62%,
      rgba(180, 220, 255, 0.10) 74%,
      rgba(200, 235, 255, 0.20) 86%,
      rgba(230, 245, 255, 0.26) 93%,
      rgba(255, 255, 255, 0.12) 100%)`,
    boxShadow: [
      `inset 0 0 0 1.5px rgba(210, 235, 255, 0.32)`,
      `inset 0 10px 28px rgba(255,255,255,0.09)`,
      `inset 0 -8px 20px rgba(0, 0, 20, 0.28)`,
      `0 0 ${38 + bloomLevel * 65}px ${visual.color}`,
      `0 0 ${10 + bloomLevel * 14}px rgba(0,0,0,0.55)`,
    ].join(', '),
    overflow: 'hidden',
    opacity: 0.80 + bloomLevel * 0.16,
    isolation: 'isolate',
  };

  // Inner content layer — the skin lives here, enclosed by the glass
  const innerVolumeStyle = {
    position: 'absolute',
    inset: '7%',
    borderRadius: '50%',
    background: innerContentBackground,
    overflow: 'hidden',
    filter: skinConfig
      ? `saturate(${1.05 + bloomLevel * 0.2}) brightness(${0.92 + bloomLevel * 0.12})`
      : undefined,
    transition: 'background 0.4s ease, filter 0.3s ease',
  };

  // Image skin rendered inside inner volume
  const skinImageStyle = {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    backgroundImage: `url("${skinUrl}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    filter: `hue-rotate(${visual.hueRotate}deg) saturate(${1.04 + bloomLevel * 0.2}) brightness(${visual.brightness + bloomLevel * 0.1})`,
    transform: `scale(${1 + bloomLevel * 0.04})`,
    transition: 'transform 160ms ease, filter 160ms ease',
  };

  // Glass caustic refraction ring — subtle light bending at inner glass edge
  const glassCausticStyle = {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: `radial-gradient(circle at 50% 50%,
      transparent 50%,
      rgba(${visual.color.startsWith('#') ? '100,180,255' : '100,180,255'}, 0.07) 57%,
      rgba(200, 230, 255, 0.13) 63%,
      transparent 68%)`,
    mixBlendMode: 'screen',
    pointerEvents: 'none',
  };

  // Primary glass specular — the bright highlight where light hits the glass surface
  const glassSpecularStyle = {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: `radial-gradient(ellipse 48% 38% at 34% 22%,
      rgba(255,255,255,0.88) 0%,
      rgba(255,255,255,0.50) 18%,
      rgba(255,255,255,0.18) 34%,
      transparent 52%)`,
    mixBlendMode: 'screen',
    pointerEvents: 'none',
  };

  // Secondary glass reflection — dim environmental reflection at lower right
  const glassReflectionStyle = {
    position: 'absolute',
    inset: 0,
    borderRadius: '50%',
    background: `radial-gradient(ellipse 28% 22% at 68% 76%,
      rgba(200, 225, 255, 0.22) 0%,
      rgba(200, 225, 255, 0.08) 45%,
      transparent 72%)`,
    mixBlendMode: 'screen',
    pointerEvents: 'none',
  };

  const pulseOrb = (nextBloom = 0.74, nextScale = 1.05, settleMs = 180) => {
    setBloomLevel(nextBloom);
    setOrbScale(nextScale);
    setTimeout(() => setOrbScale(1), settleMs);
  };

  const triggerSwarmDeployment = (count = 4) => {
    if (swarmPhaseTimerRef.current) {
      clearTimeout(swarmPhaseTimerRef.current);
    }

    setTone('Swarm deployed');
    setBridgeStatus(`Dispatching ${count} nodes`);
    setSwarmNodes(makeSwarmNodes(count));
    setBloomLevel(0.7);

    swarmPhaseTimerRef.current = setTimeout(() => {
      setTone('Digesting return');
      setBridgeStatus('Swarm returning');
      setSwarmNodes((current) =>
        current.map((node) => ({ ...node, phase: 'in', progress: 0 }))
      );
    }, 460);
  };

  return React.createElement(
    'div',
    {
        style: {
          position: 'fixed',
          inset: 0,
          background: 'transparent',
          pointerEvents: 'none',
          opacity: orbVisible && (displayActive || !hasPositionUpdate) ? 1 : 0,
          transition: 'opacity 220ms ease',
        },
      },
    speechBubbleText
      ? React.createElement(
          'div',
          {
            style: {
              position: 'fixed',
              left: `${cursorPosition.x + 20}px`,
              top: `${cursorPosition.y - 64}px`,
              background:
                speechBubbleMode === 'state'
                  ? 'rgba(18,32,34,0.88)'
                  : 'rgba(20,20,30,0.92)',
              backdropFilter: 'blur(8px)',
              color: '#e2e8f0',
              padding: '8px 16px',
              borderRadius: '999px',
              fontSize: '13px',
              fontWeight: 500,
              maxWidth: '280px',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
              pointerEvents: 'none',
              zIndex: 9999,
              transition: 'opacity 0.2s ease, transform 0.2s ease',
              transform: speechBubbleMode === 'state' ? 'translateY(-2px)' : 'translateY(0)',
            },
          },
          speechBubbleText
        )
      : null,
    React.createElement(
      'div',
      {
        style: orbStyle,
        onMouseEnter: (event) => {
          if (event.shiftKey) {
            window.electronAPI?.setIgnoreMouseEvents(false);
          }
        },
        onMouseLeave: () => {
          if (!draggingRef.current) {
            window.electronAPI?.setIgnoreMouseEvents(true, { forward: true });
          }
        },
        onMouseDown: (event) => {
          if (event.button !== 0) {
            return;
          }

          event.preventDefault();
          setCommandOpen(true);
          window.electronAPI?.setIgnoreMouseEvents(false);
          draggingRef.current = true;
          dragOffsetRef.current = {
            x: event.clientX - cursorPositionRef.current.x,
            y: event.clientY - cursorPositionRef.current.y,
          };
          window.electronAPI?.setIgnoreMouseEvents(false);
        },
        onClick: () => {
          if (!draggingRef.current) {
            pulseOrb();
          }
        },
        onContextMenu: async (event) => {
          event.preventDefault();
          window.electronAPI?.setIgnoreMouseEvents(false);
          const text = window.prompt('Ask the orb', '');
          if (text === null) {
            return;
          }

          const trimmed = text.trim();
          if (!trimmed) {
            return;
          }

          setTone('Querying');
          setBridgeStatus(trimmed);
          pulseOrb(0.92, 1.08, 240);
          triggerSwarmDeployment(4);
          await window.electronAPI?.orbQuery?.(trimmed);
        },
        onDragOver: (event) => {
          event.preventDefault();
          setSocketHint('Release to socket');
          setBloomLevel(0.92);
        },
        onDragLeave: () => {
          setSocketHint(skinUrl ? 'Socket engaged' : 'Base frame');
        },
        onDrop: async (event) => {
          event.preventDefault();
          const droppedFilePath = event.dataTransfer?.files?.[0]?.path || '';
          const droppedUrl = event.dataTransfer?.getData('text/uri-list')
            || event.dataTransfer?.getData('text/plain')
            || '';

          if (droppedFilePath && window.electronAPI?.ingestOrbSkin) {
            const result = await window.electronAPI.ingestOrbSkin(droppedFilePath);
            setSkinUrl(result?.imageUrl || null);
            setSocketHint(result?.imageUrl ? 'Vaulted locally' : 'Base frame');
            triggerSwarmDeployment(5);
            return;
          }

          if (!droppedUrl || !window.electronAPI?.setOrbSkin) {
            setSocketHint(skinUrl ? 'Socket engaged' : 'Base frame');
            return;
          }
          const result = await window.electronAPI.setOrbSkin(droppedUrl);
          setSkinUrl(result?.imageUrl || null);
          setSocketHint(result?.imageUrl ? 'Socket engaged' : 'Base frame');
          triggerSwarmDeployment(5);
        },
        onDoubleClick: async (event) => {
          event.preventDefault();

          if (event.altKey) {
            if (!window.electronAPI?.setOrbSkin || !window.electronAPI?.ingestOrbSkin) {
              return;
            }
            const source = window.prompt('Set Orb skin source: local file path or direct image URL', skinUrl || '');
            if (source === null) {
              return;
            }
            const trimmed = source.trim();
            const isLocalPath = trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed);
            const result = isLocalPath
              ? await window.electronAPI.ingestOrbSkin(trimmed)
              : await window.electronAPI.setOrbSkin(trimmed);
            setSkinUrl(result?.imageUrl || null);
            setSocketHint(result?.imageUrl ? (isLocalPath ? 'Vaulted locally' : 'Socket engaged') : 'Base frame');
            triggerSwarmDeployment(5);
            return;
          }

          setTone('Voice capture');
          setBridgeStatus('Listening for speech');
          pulseOrb(1, 1.1, 300);
          const accepted = await window.electronAPI?.listenOnce?.();
          if (!accepted) {
            setTone('Voice busy');
            setBridgeStatus('Try again in a moment');
            setBloomLevel(0.62);
          }
        },
      },
      React.createElement(
        'div',
        { style: commandPanelStyle },
        React.createElement(
          'div',
          { style: { fontSize: '13px', marginBottom: '6px', opacity: 0.78 } },
          'Local CALI SKG - ACP framed input'
        ),
        React.createElement('input', {
          type: 'text',
          value: commandText,
          onChange: (e) => setCommandText(e.target.value),
          placeholder: 'Ask, research, or shop...',
          style: {
            width: '100%',
            padding: '8px 10px',
            borderRadius: '10px',
            border: '1px solid rgba(103,198,255,0.5)',
            background: 'rgba(18,26,42,0.8)',
            color: '#e8f0ff',
            outline: 'none',
          },
          onFocus: () => window.electronAPI?.setIgnoreMouseEvents(false),
        }),
        React.createElement(
          'div',
          { style: buttonRowStyle },
          React.createElement(
            'button',
            {
              disabled: isSubmitting || !commandText.trim(),
              onClick: () => handleCommandSubmit('ask'),
              style: {
                flex: 1,
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid #63e6a6',
                background: '#0f1d2c',
                color: '#63e6a6',
                cursor: 'pointer',
              },
            },
            'Ask'
          ),
          React.createElement(
            'button',
            {
              disabled: isSubmitting || !commandText.trim(),
              onClick: () => handleCommandSubmit('search'),
              style: {
                flex: 1,
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid #67c6ff',
                background: '#0f1d2c',
                color: '#67c6ff',
                cursor: 'pointer',
              },
            },
            'Research'
          ),
          React.createElement(
            'button',
            {
              disabled: isSubmitting || !commandText.trim(),
              onClick: () => handleCommandSubmit('shop'),
              style: {
                flex: 1,
                padding: '8px 10px',
                borderRadius: '10px',
                border: '1px solid #f5c96a',
                background: '#0f1d2c',
                color: '#f5c96a',
                cursor: 'pointer',
              },
            },
            'Shop'
          )
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', gap: '8px', marginTop: '8px' } },
          React.createElement(
            'button',
            {
              onClick: () => playNod('yes'),
              style: {
                flex: 1,
                padding: '6px 8px',
                borderRadius: '10px',
                border: '1px solid #63e6a6',
                background: '#0f1d2c',
                color: '#63e6a6',
                cursor: 'pointer',
              },
            },
            'Yes Nod'
          ),
          React.createElement(
            'button',
            {
              onClick: () => playNod('no'),
              style: {
                flex: 1,
                padding: '6px 8px',
                borderRadius: '10px',
                border: '1px solid #f5c96a',
                background: '#0f1d2c',
                color: '#f5c96a',
                cursor: 'pointer',
              },
            },
            'No Nod'
          )
        ),
        lastResponseText &&
          React.createElement(
            'div',
            {
              style: {
                marginTop: '10px',
                padding: '8px 10px',
                borderRadius: '10px',
                background: 'rgba(255,255,255,0.06)',
                color: '#dce7ff',
                fontSize: '12px',
                lineHeight: 1.45,
                maxHeight: '110px',
                overflow: 'auto',
              },
            },
            lastResponseText
          ),
        React.createElement(
          'div',
          {
            style: {
              marginTop: '8px',
              fontSize: '11px',
              color: '#8aa3c2',
              cursor: 'pointer',
              textAlign: 'right',
            },
            onClick: () => setCommandOpen(false),
          },
          'Hide'
        )
      ),
      swarmNodes.map((node) => {
        const direction = node.phase === 'out' ? 1 : -1;
        const translateX = node.dx * node.progress * direction;
        const translateY = node.dy * node.progress * direction;
        const opacity = node.phase === 'out'
          ? Math.max(0, 1 - node.progress * 1.1)
          : Math.min(1, node.progress * 1.3);

        return React.createElement('div', {
          key: node.id,
          style: {
            position: 'absolute',
            left: '50%',
            top: '46%',
            width: '12px',
            height: '12px',
            borderRadius: '50%',
            background: visual.color,
            boxShadow: `0 0 22px ${visual.color}`,
            transform: `translate(calc(-50% + ${translateX}px), calc(-50% + ${translateY}px))`,
            opacity,
            transition: 'transform 33ms linear, opacity 33ms linear',
            pointerEvents: 'none',
          },
        });
      }),
      React.createElement('div', { style: auraStyle }),
      // Glass casing — outer glass shell encases the inner skin/content
      React.createElement(
        'div',
        { style: glassShellStyle },
        // Inner volume — the skin lives here, protected by the glass
        React.createElement(
          'div',
          { style: innerVolumeStyle },
          skinUrl && React.createElement('div', { style: skinImageStyle })
        ),
        // Caustic refraction ring at inner glass edge
        React.createElement('div', { style: glassCausticStyle }),
        // Primary specular highlight (top-left, main light source)
        React.createElement('div', { style: glassSpecularStyle }),
        // Secondary environmental reflection (bottom-right)
        React.createElement('div', { style: glassReflectionStyle })
      )
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(React.createElement(FloatingOrb));
