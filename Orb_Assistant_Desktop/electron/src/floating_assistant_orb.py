#!/usr/bin/env python3
"""Electron bridge shim for CALI Orb.

Exposes CALIFloatingOrb for PythonShell usage and supports a simple stdin/stdout
message loop so the Electron bridge can coordinate readiness and queries.
"""

# Standard library imports
import asyncio
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from datetime import datetime
from pathlib import Path

# Platform-specific setup
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

# Project path configuration
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
sys.path.insert(0, str(PROJECT_ROOT))

# Component path setup
SF_ORB_PATH = PROJECT_ROOT / "SF-ORB"
ACP_PATH = Path(os.getenv("ACP3_ROOT", str(PROJECT_ROOT.parent / "cochlear_processor_3.0")))

def _setup_component_paths():
    """Configure paths for external components."""
    paths_configured = []

    # SF-ORB path
    if SF_ORB_PATH.exists():
        sys.path.insert(0, str(SF_ORB_PATH))
        print(f"✓ SF-ORB path configured: {SF_ORB_PATH}", file=sys.stderr)
        paths_configured.append("sf-orb")
    else:
        print(f"⚠ SF-ORB path not found: {SF_ORB_PATH}", file=sys.stderr)

    # ACP 3.0 path
    if ACP_PATH.exists():
        sys.path.insert(0, str(ACP_PATH))
        print(f"✓ ACP 3.0 path configured: {ACP_PATH}", file=sys.stderr)
        paths_configured.append("acp3")
    else:
        print(f"⚠ ACP 3.0 path not found: {ACP_PATH}", file=sys.stderr)

    return paths_configured

# Initialize component paths
COMPONENT_PATHS = _setup_component_paths()

# --- Input/TTS integration ---
TTS_AVAILABLE = False
SPEECH_AVAILABLE = False
KokoroBaseline = None
MicCapture = None
frame_text_input = None
ACP_IMPORT_STATUS = "pending"
_ACP_IMPORT_ATTEMPTED = False
_ACP_IMPORT_LOCK = threading.Lock()

def _load_acp_adapters():
    """Load ACP 3.0 adapters lazily with proper error handling."""
    global ACP_IMPORT_STATUS, _ACP_IMPORT_ATTEMPTED, SPEECH_AVAILABLE, TTS_AVAILABLE
    global MicCapture, KokoroBaseline, frame_text_input

    with _ACP_IMPORT_LOCK:
        if _ACP_IMPORT_ATTEMPTED:
            return
        _ACP_IMPORT_ATTEMPTED = True
        ACP_IMPORT_STATUS = "loading"

        # Load speech recognition
        if "acp3" in COMPONENT_PATHS:
            try:
                from orb_acp3_adapter import MicCapture as ImportedMicCapture
                MicCapture = ImportedMicCapture
                SPEECH_AVAILABLE = True
                print("✓ ACP 3.0 speech recognition available", file=sys.stderr)
            except ImportError as e:
                print(f"⚠️ ACP 3.0 speech recognition import failed: {e}", file=sys.stderr)
                SPEECH_AVAILABLE = False

            # Load TTS components
            try:
                from orb_acp3_adapter import (
                    KokoroBaseline as ImportedKokoroBaseline,
                    frame_text_input as imported_frame_text_input,
                )
                KokoroBaseline = ImportedKokoroBaseline
                frame_text_input = imported_frame_text_input
                TTS_AVAILABLE = True
                print("✓ ACP 3.0 voice adapter imported successfully", file=sys.stderr)
            except ImportError as e:
                print(f"⚠️ ACP 3.0 voice adapter import failed: {e}", file=sys.stderr)
                TTS_AVAILABLE = False
        else:
            print("ℹ️ ACP 3.0 not available - using fallback components", file=sys.stderr)

        ACP_IMPORT_STATUS = "online" if (SPEECH_AVAILABLE or TTS_AVAILABLE) else "unavailable"


if os.getenv("ORB_DEBUG_TORCH", "0").strip().lower() in {"1", "true", "yes", "on"}:
    try:
        import torch

        print("✓ TORCH IS NOW AVAILABLE", file=sys.stderr)
        print(f"PyTorch version: {torch.__version__}", file=sys.stderr)
    except ImportError:
        print("Torch still missing - gravity field disabled", file=sys.stderr)

from orb_controller import SF_ORB_Controller  # noqa: E402
from cali_skg import CALISKG  # noqa: E402

DESKTOP_PRESENCE_AVAILABLE = False
DesktopPresence = None
ENABLE_PRESENCE_DEFAULT = False
try:
    from caleon_presence.core.desktop_presence import DesktopPresence  # noqa: E402

    DESKTOP_PRESENCE_AVAILABLE = True
except Exception as presence_import_error:
    print(
        f"⚠️ Desktop presence integration unavailable: {presence_import_error}",
        file=sys.stderr,
    )

SWARM_EXTENSION_AVAILABLE = False
CaliSwarmExtensionRuntime = None
ShortTermResearchCache = None
ResearchEventVault = None
CALI_SKILLS_AVAILABLE = False
SkillArbitrator = None
SkillLoader = None
SkillMemoryBridge = None
SkillRegistry = None
ENABLE_SWARM_EXTENSION_DEFAULT = False
try:
    from cali_swarm_extension.runtime_bridge import CaliSwarmExtensionRuntime  # noqa: E402
    from cali_swarm_extension.research.swarm_research_orchestrator import (  # noqa: E402
        ResearchEventVault,
        ShortTermResearchCache,
    )

    SWARM_EXTENSION_AVAILABLE = True
except Exception as swarm_import_error:
    print(
        f"⚠️ Swarm extension integration unavailable: {swarm_import_error}",
        file=sys.stderr,
    )

try:
    from cali_skills.core.arbitrator import SkillArbitrator  # noqa: E402
    from cali_skills.core.loader import SkillLoader  # noqa: E402
    from cali_skills.core.memory_bridge import SkillMemoryBridge  # noqa: E402
    from cali_skills.core.registry import SkillRegistry  # noqa: E402

    CALI_SKILLS_AVAILABLE = True
except Exception as skill_import_error:
    print(f"⚠️ CALI skills unavailable: {skill_import_error}", file=sys.stderr)


class CaliNotes:
    def __init__(self, base_path):
        self.base_path = Path(base_path).expanduser().resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)

    def normalize_topic(self, topic: str) -> str:
        folder = str(topic or "general_notes").lower().replace(" ", "_").strip()
        folder = re.sub(r"[^a-z0-9_\\-]+", "_", folder)
        folder = re.sub(r"_+", "_", folder).strip("_")
        return folder or "general_notes"

    def _existing_subject_folder(self, normalized_topic: str):
        exact = self.base_path / normalized_topic
        if exact.exists():
            return exact

        tokens = {token for token in normalized_topic.split("_") if len(token) > 2}
        if not tokens:
            return None

        best_path = None
        best_score = 0.0
        for path in self.base_path.iterdir():
            if not path.is_dir():
                continue
            existing_tokens = {token for token in path.name.split("_") if len(token) > 2}
            if not existing_tokens:
                continue
            overlap = len(tokens & existing_tokens)
            score = overlap / max(len(tokens), len(existing_tokens))
            if score > best_score:
                best_score = score
                best_path = path

        return best_path if best_score >= 0.67 else None

    def get_subject_path(self, topic):
        normalized = self.normalize_topic(topic)
        path = self._existing_subject_folder(normalized) or self.base_path / normalized
        path.mkdir(parents=True, exist_ok=True)
        return path

    def create_session(self, topic):
        subject_path = self.get_subject_path(topic)
        filename = f"session_{datetime.now().strftime('%Y-%m-%d_%H%M%S')}.txt"
        full_path = subject_path / filename

        with full_path.open("w", encoding="utf-8") as handle:
            handle.write(f"# Session: {topic}\n\n")

        return full_path

    def append(self, session_path, text):
        path = Path(session_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(str(text).rstrip() + "\n")
        return path

    def append_source(self, topic, source):
        subject_path = self.get_subject_path(topic)
        sources_path = subject_path / "sources.json"
        sources = self._read_json_list(sources_path)
        if not isinstance(sources, list):
            sources = []

        normalized = {
            "url": source.get("url") or source.get("source"),
            "title": source.get("title"),
            "timestamp": datetime.now().isoformat(),
            "confidence": source.get("confidence"),
            "domain": source.get("domain"),
            "query": source.get("query"),
        }
        if not normalized["url"] and not normalized["title"]:
            return sources_path

        key = (normalized.get("url") or normalized.get("title") or "").strip().lower()
        existing_keys = {
            (item.get("url") or item.get("title") or "").strip().lower()
            for item in sources
            if isinstance(item, dict)
        }
        if key not in existing_keys:
            sources.append(normalized)

        sources_path.write_text(json.dumps(sources, indent=2, ensure_ascii=False), encoding="utf-8")
        return sources_path

    def _read_json_list(self, path):
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            return []
        return payload if isinstance(payload, list) else []

    def store_lightweight_summary(self, topic, query, key_points, sources=None):
        subject_path = self.get_subject_path(topic)
        highlights_path = subject_path / "passive_highlights.json"
        highlights = self._read_json_list(highlights_path)
        normalized_points = [
            " ".join(str(point or "").split())
            for point in (key_points or [])
            if str(point or "").strip()
        ][:8]
        if not normalized_points:
            return highlights_path

        record = {
            "timestamp": datetime.now().isoformat(),
            "query": query,
            "key_points": normalized_points,
            "sources": [
                {
                    "url": source.get("url") or source.get("source"),
                    "title": source.get("title"),
                    "confidence": source.get("confidence"),
                    "domain": source.get("domain"),
                }
                for source in (sources or [])
                if isinstance(source, dict)
            ][:8],
        }
        signature = json.dumps(
            {"query": record["query"], "key_points": record["key_points"]},
            sort_keys=True,
            ensure_ascii=False,
        )
        existing = {
            json.dumps(
                {"query": item.get("query"), "key_points": item.get("key_points")},
                sort_keys=True,
                ensure_ascii=False,
            )
            for item in highlights
            if isinstance(item, dict)
        }
        if signature not in existing:
            highlights.append(record)
        highlights = highlights[-50:]
        highlights_path.write_text(json.dumps(highlights, indent=2, ensure_ascii=False), encoding="utf-8")
        return highlights_path

    def promote_passive_highlights(self, topic, session_path, limit=10):
        subject_path = self.get_subject_path(topic)
        highlights = self._read_json_list(subject_path / "passive_highlights.json")
        points = []
        seen = set()
        for record in reversed(highlights):
            for point in record.get("key_points", []) if isinstance(record, dict) else []:
                key = str(point).strip().lower()
                if key and key not in seen:
                    seen.add(key)
                    points.append(str(point).strip())
                if len(points) >= limit:
                    break
            if len(points) >= limit:
                break
        if not points:
            return []
        self.append(session_path, "\nSaved highlights:")
        for point in points:
            self.append(session_path, f"- {point}")
        return points

    def write_summary(self, topic, summary, key_points=None, sources=None):
        subject_path = self.get_subject_path(topic)
        summary_path = subject_path / "summary.txt"
        clean_summary = " ".join(str(summary or "").split())
        clean_points = [
            " ".join(str(point or "").split())
            for point in (key_points or [])
            if str(point or "").strip()
        ][:10]
        source_count = len(sources or [])
        lines = [
            f"# Summary: {topic}",
            "",
            f"Updated: {datetime.now().isoformat()}",
            f"Source count: {source_count}",
            "",
            "## Distilled Summary",
            clean_summary or "No confirmed summary recorded yet.",
        ]
        if clean_points:
            lines.extend(["", "## Key Points"])
            lines.extend(f"- {point}" for point in clean_points)
        summary_path.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")
        return summary_path

    def read_summary(self, topic):
        summary_path = self.get_subject_path(topic) / "summary.txt"
        if not summary_path.exists():
            return ""
        return summary_path.read_text(encoding="utf-8", errors="replace").strip()


class CaliCoreKnowledge:
    def __init__(self, base_path):
        self.base_path = Path(base_path).expanduser().resolve()
        self.base_path.mkdir(parents=True, exist_ok=True)
        self._ensure_seed_files()

    def _ensure_seed_files(self):
        seeds = {
            "truemark_mint": {
                "overview.txt": (
                    "TrueMark Mint is the local-first sovereign certification and document vault system. "
                    "Its role is to support certified, timestamped, operator-controlled records without "
                    "merging website and engine responsibilities.\n"
                ),
                "commands.json": json.dumps(
                    {
                        "start": "start truemark",
                        "open": "open truemark",
                        "status": "truemark status",
                    },
                    indent=2,
                )
                + "\n",
                "launch.json": json.dumps(
                    {
                        "name": "truemark_mint",
                        "type": "wsl_service",
                        "command": "",
                        "cwd": "",
                        "notes": "Set command/cwd after the local TrueMark Mint service path is confirmed.",
                    },
                    indent=2,
                )
                + "\n",
            },
            "goat_system": {
                "overview.txt": (
                    "GOAT is the preservation and book-building system family used for structured knowledge "
                    "capture, preservation workflows, and later publication/export paths. CALI should explain "
                    "GOAT from curated local files first.\n"
                ),
                "structure.json": json.dumps(
                    {
                        "known_roots": ["R:\\goat_substrate"],
                        "notes": "Add exact GOAT_Preservation_System paths when present on this machine.",
                    },
                    indent=2,
                )
                + "\n",
            },
            "spruked": {
                "overview.txt": (
                    "Spruked is the operator ecosystem around the Orb assistant and related websites/services. "
                    "Known website surfaces include spruked.com, truemarkmint.com, shilohridgekatahdins.com, "
                    "alphacertsig.com, and dragonithome.spruked.com.\n"
                ),
                "sites.json": json.dumps(
                    {
                        "sites": [
                            "spruked.com",
                            "truemarkmint.com",
                            "shilohridgekatahdins.com",
                            "alphacertsig.com",
                            "dragonithome.spruked.com",
                        ]
                    },
                    indent=2,
                )
                + "\n",
                "services.json": json.dumps(
                    {
                        "services": [
                            {
                                "id": "spruked",
                                "domain": "spruked.com",
                                "public_url": "https://spruked.com",
                                "local_url": "",
                                "repo_path": "",
                                "status_url": "",
                                "commands": {"start": "", "stop": "", "status": ""},
                            },
                            {
                                "id": "truemarkmint",
                                "domain": "truemarkmint.com",
                                "public_url": "https://truemarkmint.com",
                                "local_url": "",
                                "repo_path": "",
                                "status_url": "",
                                "commands": {"start": "", "stop": "", "status": ""},
                            },
                            {
                                "id": "shilohridgekatahdins",
                                "domain": "shilohridgekatahdins.com",
                                "public_url": "https://shilohridgekatahdins.com",
                                "local_url": "",
                                "repo_path": "",
                                "status_url": "",
                                "commands": {"start": "", "stop": "", "status": ""},
                            },
                            {
                                "id": "alphacertsig",
                                "domain": "alphacertsig.com",
                                "public_url": "https://alphacertsig.com",
                                "local_url": "",
                                "repo_path": "",
                                "status_url": "",
                                "commands": {"start": "", "stop": "", "status": ""},
                            },
                            {
                                "id": "dragonithome",
                                "domain": "dragonithome.spruked.com",
                                "public_url": "https://dragonithome.spruked.com",
                                "local_url": "",
                                "repo_path": "",
                                "status_url": "",
                                "commands": {"start": "", "stop": "", "status": ""},
                            },
                        ]
                    },
                    indent=2,
                )
                + "\n",
            },
        }
        for subject, files in seeds.items():
            subject_path = self.base_path / subject
            subject_path.mkdir(parents=True, exist_ok=True)
            for filename, content in files.items():
                path = subject_path / filename
                if not path.exists():
                    path.write_text(content, encoding="utf-8")

    def _subject_for_query(self, query):
        lowered = str(query or "").lower()
        if "truemark" in lowered or "true mark" in lowered:
            return "truemark_mint"
        if "goat" in lowered:
            return "goat_system"
        if "spruked" in lowered or "dragonit" in lowered or "alphacertsig" in lowered:
            return "spruked"
        return None

    def load_core(self, subject):
        subject_path = self.base_path / subject
        if not subject_path.exists():
            return None
        payload = {"subject": subject, "path": str(subject_path), "files": {}}
        for path in sorted(subject_path.iterdir()):
            if path.suffix.lower() not in {".txt", ".json"}:
                continue
            try:
                if path.suffix.lower() == ".json":
                    payload["files"][path.name] = json.loads(path.read_text(encoding="utf-8"))
                else:
                    payload["files"][path.name] = path.read_text(encoding="utf-8").strip()
            except Exception:
                payload["files"][path.name] = ""
        return payload

    def handle(self, query):
        subject = self._subject_for_query(query)
        if not subject:
            return None
        lowered = str(query or "").lower()
        core = self.load_core(subject)
        if not core:
            return None

        if any(term in lowered for term in ("start ", "launch ", "open ", "status")):
            return {"subject": subject, "action": "operator_command", "core": core}

        overview = core["files"].get("overview.txt", "")
        action_line = ""
        commands = core["files"].get("commands.json")
        if isinstance(commands, dict):
            action_line = " I can start it, open it, or check status if the local launch command is configured."
        return {
            "subject": subject,
            "action": "explain",
            "core": core,
            "response_text": (overview + action_line).strip(),
        }

    def load_services(self):
        core = self.load_core("spruked") or {}
        services = core.get("files", {}).get("services.json", {})
        if isinstance(services, dict):
            return services.get("services", [])
        return []


class CALIFloatingOrb:
    def __init__(self, project_root):
        self.project_root = Path(project_root).resolve()
        self.instance_id = os.getenv("ORB_INSTANCE_ID", "wsl").strip() or "wsl"
        self.system_root = Path(
            os.getenv("ORB_SYSTEM_ROOT", str(self.project_root))
        ).expanduser().resolve()
        self.shared_mesh_root = os.getenv("ORB_SHARED_MESH_ROOT")
        self.controller = None
        self.running = False
        self.last_cursor_pos = (0, 0)
        self.last_time = time.time()
        self.latest_presence_update = None
        self.auto_listen = os.getenv("ORB_AUTO_LISTEN", "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
        self.speech_enabled = False
        self.speech_thread = None
        self.listen_once_thread = None
        self.speech_lock = threading.Lock()
        self._emit_lock = threading.Lock()
        self.cali = None
        self.desktop_presence = None
        self.swarm_extension = None
        self.short_term_research_cache = (
            ShortTermResearchCache(self.project_root / "CALI_System" / "memory" / "short_term_cache.db")
            if ShortTermResearchCache
            else None
        )
        self.cali_notes = CaliNotes(self.project_root / "CALI_System" / "notes")
        self.core_knowledge = CaliCoreKnowledge(self.project_root / "CALI_System" / "core_knowledge")
        self.research_vault = (
            ResearchEventVault(self.project_root / "CALI_System" / "memory" / "research_vault")
            if ResearchEventVault
            else None
        )
        self.current_note_topic = None
        self.current_note_session = None
        self.note_taking_enabled = False
        self.last_response_text = ""
        self.pending_notepad_summary = None
        self.last_notepad_path = None
        self.voice = None
        self.mic = None
        self.audio_runtime_thread = None
        self.audio_runtime_status = {
            "adapters": ACP_IMPORT_STATUS,
            "voice": "pending",
            "speech": "pending",
        }
        self.skill_registry = None
        self.skill_loader = None
        self.skill_arbitrator = None
        self.skill_memory = None
        self._init_skill_library()
        self._ensure_decision_log()

        try:
            self.cali = CALISKG(self.system_root)
            print("✓ CALI SKG v3 online", file=sys.stderr)
        except Exception as e:
            print(f"⚠️ CALI SKG init failed: {e}", file=sys.stderr)
        # Attach controller after CALI is ready (or fallback without CALI)
        try:
            self.controller = SF_ORB_Controller(cali=self.cali)
        except Exception as exc:
            print(f"⚠️ Controller init failed: {exc}", file=sys.stderr)
            self.controller = SF_ORB_Controller()
        self._init_desktop_presence()
        self._init_swarm_extension()
        if self.auto_listen or os.getenv("ORB_PRELOAD_AUDIO_RUNTIME", "0").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }:
            self._start_audio_runtime_init()
        else:
            self.audio_runtime_status["adapters"] = "idle"
            self.audio_runtime_status["voice"] = "idle"
            self.audio_runtime_status["speech"] = "idle"

    def _start_audio_runtime_init(self):
        if self.audio_runtime_thread and self.audio_runtime_thread.is_alive():
            return
        self.audio_runtime_status["adapters"] = "loading"
        self.audio_runtime_thread = threading.Thread(
            target=self._init_audio_runtime,
            name="cali-audio-runtime",
            daemon=True,
        )
        self.audio_runtime_thread.start()

    def _ensure_acp_adapters(self):
        if not _ACP_IMPORT_ATTEMPTED:
            self.audio_runtime_status["adapters"] = "loading"
            _load_acp_adapters()
            self.audio_runtime_status["adapters"] = ACP_IMPORT_STATUS
        return ACP_IMPORT_STATUS == "online"

    def _ensure_voice_runtime(self):
        self._ensure_acp_adapters()
        if self.voice:
            return True
        if not TTS_AVAILABLE or KokoroBaseline is None:
            self.audio_runtime_status["voice"] = "unavailable"
            return False
        try:
            self.audio_runtime_status["voice"] = "loading"
            self.voice = KokoroBaseline()
            self.audio_runtime_status["voice"] = "online"
            return True
        except Exception as exc:
            self.audio_runtime_status["voice"] = "error"
            print(f"Voice init failed: {exc}", file=sys.stderr)
            return False

    def _ensure_mic_runtime(self):
        self._ensure_acp_adapters()
        if self.mic:
            return True
        if not SPEECH_AVAILABLE or MicCapture is None:
            self.audio_runtime_status["speech"] = "unavailable"
            return False
        try:
            self.audio_runtime_status["speech"] = "loading"
            self.mic = MicCapture()
            self.audio_runtime_status["speech"] = "online"
            return True
        except Exception as exc:
            self.audio_runtime_status["speech"] = "error"
            print(f"Speech recognition init failed: {exc}", file=sys.stderr)
            return False

    def _init_audio_runtime(self):
        try:
            _load_acp_adapters()
            self.audio_runtime_status["adapters"] = ACP_IMPORT_STATUS

            if TTS_AVAILABLE and KokoroBaseline:
                try:
                    self.audio_runtime_status["voice"] = "loading"
                    print("Initializing Sovereign Voice (Kokoro)...", file=sys.stderr)
                    self.voice = KokoroBaseline()
                    voice_health = self.voice.get_health_status()
                    self.audio_runtime_status["voice"] = "online"
                    print(
                        "✓ Voice Online"
                        f" ({voice_health.get('onnx_provider', 'unknown provider')})",
                        file=sys.stderr,
                    )
                except Exception as e:
                    self.audio_runtime_status["voice"] = "error"
                    print(f"Voice init failed: {e}", file=sys.stderr)
            else:
                self.audio_runtime_status["voice"] = "unavailable"

            if SPEECH_AVAILABLE and MicCapture:
                try:
                    self.audio_runtime_status["speech"] = "loading"
                    print("Initializing Speech Recognition...", file=sys.stderr)
                    self.mic = MicCapture()
                    self.audio_runtime_status["speech"] = "online"
                    print("✓ Speech Recognition Online", file=sys.stderr)
                except Exception as e:
                    self.audio_runtime_status["speech"] = "error"
                    print(f"Speech recognition init failed: {e}", file=sys.stderr)
            else:
                self.audio_runtime_status["speech"] = "unavailable"
        except Exception as exc:
            self.audio_runtime_status["adapters"] = "error"
            self.audio_runtime_status["voice"] = "error"
            self.audio_runtime_status["speech"] = "error"
            print(f"ACP audio runtime init failed: {exc}", file=sys.stderr)

    def _init_skill_library(self):
        if not CALI_SKILLS_AVAILABLE:
            return
        try:
            library_path = self.project_root / "cali_skills" / "library"
            self.skill_registry = SkillRegistry(str(library_path))
            self.skill_loader = SkillLoader(self.skill_registry)
            self.skill_arbitrator = SkillArbitrator(self.skill_loader)
            self.skill_memory = SkillMemoryBridge(
                str(self.project_root / "CALI_System" / "memory" / "cali_skills")
            )
            for skill in self.skill_registry.list_skills():
                self.skill_loader.activate(skill["id"])
            print(
                f"✓ CALI skill library online ({len(self.skill_loader.get_active())} active)",
                file=sys.stderr,
            )
        except Exception as exc:
            self.skill_registry = None
            self.skill_loader = None
            self.skill_arbitrator = None
            self.skill_memory = None
            print(f"⚠️ CALI skill library init failed: {exc}", file=sys.stderr)

    def _ensure_decision_log(self):
        path = self.project_root / "CALI_System" / "memory" / "decisions.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)

    def _init_desktop_presence(self):
        enabled_env = os.getenv("ORB_ENABLE_DESKTOP_PRESENCE")
        if enabled_env is None:
            enabled = ENABLE_PRESENCE_DEFAULT or self._legacy_presence_flag()
        else:
            enabled = enabled_env.strip().lower() in {
                "1",
                "true",
                "yes",
                "on",
            }
        if not enabled:
            print("Desktop presence disabled (safe mode)", file=sys.stderr)
            return
        if not DESKTOP_PRESENCE_AVAILABLE:
            print("Desktop presence module unavailable", file=sys.stderr)
            return
        if not self.controller:
            print("Desktop presence not started (controller unavailable)", file=sys.stderr)
            return
        try:
            presence_db = os.getenv(
                "ORB_PRESENCE_DB",
                str(self.system_root / "vault_system" / "behavior_learner.db"),
            )
            self.desktop_presence = DesktopPresence(
                orb_controller=self, db_path=presence_db
            )
            self.desktop_presence.start_background()
            print("✓ Desktop presence memory online", file=sys.stderr)
        except Exception as exc:
            self.desktop_presence = None
            print(f"[Presence Disabled] {exc}", file=sys.stderr)

    def _legacy_presence_flag(self):
        """Deprecated alias preserved for compatibility with older launchers."""
        return os.getenv("ENABLE_PRESENCE", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    def _init_swarm_extension(self):
        enabled_env = os.getenv("ORB_ENABLE_SWARM_EXTENSION")
        if enabled_env is None:
            enabled = ENABLE_SWARM_EXTENSION_DEFAULT or self._legacy_swarm_flag()
        else:
            enabled = enabled_env.strip().lower() in {"1", "true", "yes", "on"}
        if not enabled:
            print("Swarm extension disabled (safe mode)", file=sys.stderr)
            return
        if not SWARM_EXTENSION_AVAILABLE:
            print("Swarm extension module unavailable", file=sys.stderr)
            return
        if not self.controller:
            print("Swarm extension not started (controller unavailable)", file=sys.stderr)
            return
        try:
            self.swarm_extension = CaliSwarmExtensionRuntime(
                controller=self.controller, system_root=self.system_root
            )
            self.swarm_extension.start_background()
            if hasattr(self.controller, "attach_swarm_extension"):
                self.controller.attach_swarm_extension(self.swarm_extension)
            print("✓ Swarm extension runtime online", file=sys.stderr)
        except Exception as exc:
            self.swarm_extension = None
            print(f"[Swarm Extension Disabled] {exc}", file=sys.stderr)

    def _legacy_swarm_flag(self):
        return os.getenv("ENABLE_SWARM_EXTENSION", "").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }

    def speak(self, text):
        if not self.voice:
            self._ensure_voice_runtime()
        if self.voice:
            try:
                result = self.voice.synthesize(text)
                return result.get("audio_path")
            except Exception as e:
                print(f"Speech error: {e}", file=sys.stderr)
        return None

    def prepare_voice(self, text, emotion="thoughtful_warm"):
        if not self.cali:
            return None
        try:
            return self.cali.speak(text, emotion)
        except Exception as e:
            print(f"CALI voice packaging error: {e}", file=sys.stderr)
            return None

    def build_voice_payload(self, text, emotion="thoughtful_warm"):
        voice_package = self.prepare_voice(text, emotion)
        audio_path = None
        if self.voice and (not self.cali or self.cali.orb_state.get("voice_active", True)):
            audio_path = self.speak(text)
        return {"text": text, "audio_path": audio_path, "voice_package": voice_package}

    def emit_spoken_text(self, text, emotion="thoughtful_warm", request_id=None):
        payload = self.build_voice_payload(text, emotion)
        self._emit(
            {
                "type": "speak_result",
                "request_id": request_id,
                "data": payload,
            }
        )
        return payload

    def emit_cali_state(self, phase, text, **extra):
        data = {"phase": phase, "text": text}
        data.update(extra)
        self._emit({"type": "cali:state", "data": data})
        self.record_research_event(
            {
                "type": "cali:state",
                "data": data,
            },
            query=data.get("query"),
            topic=data.get("topic"),
        )

    def record_research_event(self, event, query=None, topic=None):
        if not self.research_vault:
            return None
        try:
            return self.research_vault.append_event(event, query=query, topic=topic)
        except Exception as exc:
            print(f"Research vault event write failed: {exc}", file=sys.stderr)
            return None

    def replay_research_events(self, query=None, topic=None, min_confidence=None, limit=20):
        if not self.research_vault:
            return []
        return self.research_vault.replay(
            query=query,
            topic=topic,
            min_confidence=min_confidence,
            limit=limit,
        )

    def handle_research_vault_command(self, text):
        normalized = str(text or "").strip().lower()
        if not self.research_vault:
            return None

        if "archive current research session" in normalized or "archive current research log" in normalized:
            archive_path = self.research_vault.archive_active()
            response_text = "Research log archived." if archive_path else "There was no active research log to archive."
            return {"response_text": response_text, "archive_path": str(archive_path) if archive_path else None}

        if "clear recent research log" in normalized or "purge active research log" in normalized:
            purge_path = self.research_vault.stage_active_for_purge()
            response_text = (
                "Recent research log staged for purge."
                if purge_path
                else "There was no active research log to stage for purge."
            )
            return {"response_text": response_text, "purge_path": str(purge_path) if purge_path else None}

        if "what did you find earlier" in normalized or "replay research" in normalized:
            topic = self.current_note_topic
            events = self.replay_research_events(topic=topic, limit=10)
            summaries = [
                event.get("result_summary")
                for event in events
                if event.get("result_summary")
            ][:5]
            response_text = (
                "Earlier findings: " + " ".join(summaries)
                if summaries
                else "I do not have enough recorded research to replay for this topic yet."
            )
            return {"response_text": response_text, "events": events}

        return None

    def handle_recall_request(self, text, input_frame=None):
        normalized = str(text or "").strip()
        lowered = normalized.lower()
        triggers = (
            "what did we find about",
            "what did you find about",
            "what did we learn about",
            "continue research on",
            "continue notes on",
            "recall notes on",
        )
        if not any(trigger in lowered for trigger in triggers):
            return None

        topic = normalized
        for trigger in triggers:
            topic = re.sub(re.escape(trigger), " ", topic, flags=re.IGNORECASE)
        topic = topic.strip(" ?.:;-") or self.current_note_topic or "general_notes"
        summary = self.cali_notes.read_summary(topic)
        events = self.replay_research_events(topic=topic, limit=10)
        event_summaries = [
            event.get("result_summary")
            for event in events
            if event.get("result_summary")
        ][:5]

        if summary:
            response_text = summary[:1200]
        elif event_summaries:
            response_text = "Recorded findings: " + " ".join(event_summaries)
        else:
            response_text = f"I don't have enough saved knowledge on {topic} yet."

        session_path = self.ensure_note_session(topic)
        self.current_note_topic = topic
        return {
            "topic": topic,
            "session_path": str(session_path),
            "summary": summary,
            "events": events,
            "response_text": response_text,
        }

    def handle_core_knowledge_request(self, text):
        result = self.core_knowledge.handle(text) if self.core_knowledge else None
        if not result:
            return None

        if result.get("action") == "operator_command":
            core = result.get("core") or {}
            launch = core.get("files", {}).get("launch.json")
            lowered = str(text or "").lower()
            if isinstance(launch, dict) and any(term in lowered for term in ("start ", "launch ")):
                command = str(launch.get("command") or "").strip()
                cwd = str(launch.get("cwd") or "").strip() or None
                if not command:
                    result["response_text"] = (
                        f"{result['subject']} is known, but its launch command is not configured yet."
                    )
                    return result
                subprocess.Popen(command, shell=True, cwd=cwd)
                result["response_text"] = f"Starting {result['subject']}."
                return result
            if any(term in lowered for term in ("open ", "status")):
                result["response_text"] = (
                    f"{result['subject']} is known. The local open/status command still needs a curated command entry."
                )
                return result

        return result

    def load_service_manifest(self):
        services = self.core_knowledge.load_services() if self.core_knowledge else []
        normalized = []
        for service in services:
            if not isinstance(service, dict):
                continue
            item = dict(service)
            item.setdefault("id", str(item.get("domain", "")).split(".")[0])
            item.setdefault("domain", item.get("id"))
            item.setdefault("public_url", f"https://{item.get('domain')}")
            item.setdefault("local_url", "")
            item.setdefault("repo_path", "")
            item.setdefault("status_url", "")
            item.setdefault("commands", {})
            normalized.append(item)
        return normalized

    def _find_service(self, service_id):
        target = str(service_id or "").strip().lower()
        for service in self.load_service_manifest():
            candidates = {
                str(service.get("id", "")).lower(),
                str(service.get("domain", "")).lower(),
                str(service.get("public_url", "")).lower(),
            }
            if target in candidates:
                return service
        return None

    def _service_status(self, service):
        repo_path = str(service.get("repo_path") or "").strip()
        status_url = str(service.get("status_url") or service.get("local_url") or "").strip()
        status = {
            "configured": bool(repo_path or status_url or any((service.get("commands") or {}).values())),
            "repo_exists": Path(repo_path).expanduser().exists() if repo_path else False,
            "status_url": status_url,
            "reachable": None,
        }
        if status_url:
            try:
                with urllib.request.urlopen(status_url, timeout=2) as response:
                    status["reachable"] = 200 <= int(response.status) < 500
                    status["http_status"] = int(response.status)
            except Exception as exc:
                status["reachable"] = False
                status["error"] = str(exc)
        return status

    def handle_service_control(self, service_id, action):
        service = self._find_service(service_id)
        normalized_action = str(action or "status").strip().lower()
        if not service:
            return {
                "status": "not_found",
                "error": f"Service not found: {service_id}",
                "service_id": service_id,
            }

        if normalized_action == "open":
            return {
                "status": "success",
                "action": "open",
                "service": service,
                "url": service.get("local_url") or service.get("public_url"),
            }

        if normalized_action == "status":
            return {
                "status": "success",
                "action": "status",
                "service": service,
                "service_status": self._service_status(service),
            }

        if normalized_action not in {"start", "stop"}:
            return {
                "status": "error",
                "error": f"Unsupported service action: {normalized_action}",
                "service": service,
            }

        commands = service.get("commands") or {}
        command = str(commands.get(normalized_action) or "").strip()
        if not command:
            return {
                "status": "needs_configuration",
                "error": f"{normalized_action} command is not configured for {service.get('domain')}.",
                "action": normalized_action,
                "service": service,
            }

        cwd = str(service.get("repo_path") or "").strip() or None
        if cwd and not Path(cwd).expanduser().exists():
            return {
                "status": "error",
                "error": f"Configured repo_path does not exist: {cwd}",
                "action": normalized_action,
                "service": service,
            }
        try:
            subprocess.Popen(command, shell=True, cwd=cwd)
        except Exception as exc:
            return {
                "status": "error",
                "error": str(exc),
                "action": normalized_action,
                "service": service,
            }
        return {
            "status": "success",
            "action": normalized_action,
            "service": service,
            "result": f"{normalized_action} requested for {service.get('domain')}.",
        }

    def handle_skill_request(self, text, input_frame=None):
        if not self.skill_registry or not self.skill_loader or not self.skill_arbitrator:
            return None
        normalized = str(text or "").strip()
        lowered = normalized.lower()

        if lowered in {"list skills", "cali list skills", "show skills", "skill status"}:
            skills = self.skill_registry.list_skills()
            active = sorted(self.skill_loader.get_active().keys())
            return {
                "response_text": f"{len(skills)} skills available. Active: {', '.join(active)}.",
                "skills": skills,
                "active": active,
            }

        activate_match = re.search(r"\bactivate skill\s+([a-z0-9_\\-]+)", lowered)
        if activate_match:
            skill_id = activate_match.group(1).replace("_skill", "")
            ok = self.skill_loader.activate(skill_id)
            return {
                "response_text": f"Skill {skill_id} {'activated' if ok else 'not found'}.",
                "skill_id": skill_id,
                "activated": ok,
            }

        deactivate_match = re.search(r"\bdeactivate skill\s+([a-z0-9_\\-]+)", lowered)
        if deactivate_match:
            skill_id = deactivate_match.group(1).replace("_skill", "")
            self.skill_loader.deactivate(skill_id)
            return {
                "response_text": f"Skill {skill_id} deactivated.",
                "skill_id": skill_id,
                "deactivated": True,
            }

        research_terms = ("research", "look up", "latest", "current", "verify", "fact check")
        if any(term in lowered for term in research_terms):
            return None

        ranked = self.skill_arbitrator.select_skill(
            normalized,
            {
                "input_frame": input_frame or {},
                "memory": self.skill_memory,
                "current_topic": self.current_note_topic,
            },
        )
        if not ranked or ranked[0]["confidence"] < 0.65:
            return None

        command = "explain"
        if any(term in lowered for term in ("start", "launch")):
            command = "start_service"
        elif "list sites" in lowered:
            command = "list_sites"
        elif "sha256" in lowered or "hash" in lowered:
            command = "sha256"

        result = self.skill_arbitrator.execute_best(
            intent=normalized,
            command=command,
            params={"text": normalized},
            context={
                "input_frame": input_frame or {},
                "memory": self.skill_memory,
                "current_topic": self.current_note_topic,
            },
        )
        response_text = result.get("result") or result.get("error") or result.get("status")
        if not isinstance(response_text, str):
            response_text = json.dumps(response_text, ensure_ascii=False, default=str)
        result["response_text"] = response_text
        return result

    def extract_topic_from_query(self, query, input_frame=None):
        normalized = str(query or "").strip()
        semantic = (input_frame or {}).get("semantic") or {}
        implied = (input_frame or {}).get("implied_intent") or {}
        domain_hints = implied.get("domain_hints") or semantic.get("domain_terms") or []
        if domain_hints:
            hint = " ".join(str(item).strip() for item in domain_hints[:3] if str(item).strip())
            if hint:
                return hint

        lowered = normalized.lower()
        removals = (
            "cali",
            "please",
            "research",
            "look up",
            "lookup",
            "investigate",
            "find sources for",
            "find sources",
            "verify",
            "fact check",
            "compare sources for",
            "compare sources",
            "use the substrate",
            "substrate research",
        )
        topic = lowered
        for phrase in removals:
            topic = topic.replace(phrase, " ")
        topic = re.sub(r"[^a-z0-9\\s_\\-]+", " ", topic)
        topic = re.sub(r"\\s+", " ", topic).strip()
        return topic[:80] or "general_notes"

    def ensure_note_session(self, topic):
        topic = topic or self.current_note_topic or "general_notes"
        if (
            self.current_note_session
            and self.current_note_topic
            and self.cali_notes.get_subject_path(self.current_note_topic)
            == self.cali_notes.get_subject_path(topic)
        ):
            return self.current_note_session
        self.current_note_topic = topic
        self.current_note_session = self.cali_notes.create_session(topic)
        return self.current_note_session

    def detect_note_intent(self, text, input_frame=None):
        normalized = str(text or "").strip()
        lowered = normalized.lower()
        semantic = (input_frame or {}).get("semantic") or {}
        semantic_intent = str(semantic.get("intent") or "").lower()
        triggers = (
            "/take note",
            "/save note",
            "take notes",
            "take note",
            "write that down",
            "save this",
            "save that",
            "don't save",
            "do not save",
            "discard notes",
            "discard that",
            "keep track",
        )
        return semantic_intent == "note" or any(trigger in lowered for trigger in triggers)

    def handle_note_request(self, text, input_frame=None, source="text"):
        if not self.detect_note_intent(text, input_frame):
            return None

        normalized = str(text or "").strip()
        lowered = normalized.lower()

        if any(phrase in lowered for phrase in ("don't save", "do not save", "discard notes", "discard that")):
            self.pending_notepad_summary = None
            payload = {
                "topic": self.current_note_topic,
                "session_path": str(self.current_note_session) if self.current_note_session else None,
                "note_text": "",
                "response_text": "Got it. I won't save that.",
            }
            self.emit_spoken_text(payload["response_text"])
            self._emit({"type": "note_result", "data": payload})
            return payload

        if any(phrase in lowered for phrase in ("save that", "save this", "/save note")) and self.pending_notepad_summary:
            saved = self.save_pending_summary()
            response_text = (
                "Saved to the topic notes."
                if saved
                else "I do not have a pending summary ready to save."
            )
            payload = {
                "topic": self.current_note_topic,
                "session_path": str(self.current_note_session) if self.current_note_session else None,
                "note_text": self.pending_notepad_summary.get("text") if self.pending_notepad_summary else "",
                "response_text": response_text,
            }
            self.emit_spoken_text(payload["response_text"])
            self._emit({"type": "note_result", "data": payload})
            return payload

        topic = self.current_note_topic or self.extract_topic_from_query(normalized, input_frame)
        session_path = self.ensure_note_session(topic)
        self.note_taking_enabled = True

        note_text = ""
        for trigger in ("/take note", "/save note", "write that down", "save this", "save that"):
            index = lowered.find(trigger)
            if index >= 0:
                note_text = normalized[index + len(trigger):].strip(" :-")
                break

        if not note_text:
            note_text = self.last_response_text or f"Note-taking started for {topic}."

        self.cali_notes.append(
            session_path,
            f"[{datetime.now().isoformat()}] {source}: {note_text}",
        )
        payload = {
            "topic": topic,
            "session_path": str(session_path),
            "note_text": note_text,
            "response_text": "Got it. I'll keep track of what we find.",
        }
        self.emit_spoken_text(payload["response_text"])
        self._emit({"type": "note_result", "data": payload})
        return payload

    def build_research_notepad_summary(self, query, research, topic):
        synthesis = research.get("research_synthesis") or {}
        key_findings = synthesis.get("key_findings") or []
        sources = research.get("sources") or []
        summary = (
            research.get("response_text")
            or research.get("voice_response")
            or synthesis.get("summary")
            or " ".join(key_findings[:3])
            or "I do not have enough to confirm that yet."
        )
        lines = [
            f"CALI Research Summary: {topic}",
            f"Query: {query}",
            f"Generated: {datetime.now().isoformat()}",
            "",
            "Summary:",
            str(summary).strip(),
        ]
        if key_findings:
            lines.extend(["", "Key Points:"])
            lines.extend(f"- {point}" for point in key_findings[:8])
        if sources:
            lines.extend(["", "Sources:"])
            for source in sources[:10]:
                if not isinstance(source, dict):
                    continue
                title = source.get("title") or "Untitled"
                url = source.get("url") or source.get("source") or ""
                confidence = source.get("confidence")
                suffix = f" confidence={confidence}" if confidence is not None else ""
                lines.append(f"- {title}: {url}{suffix}")
        return "\n".join(lines).rstrip() + "\n"

    def open_notepad_summary(self, text):
        with tempfile.NamedTemporaryFile(delete=False, suffix=".txt", mode="w", encoding="utf-8") as handle:
            handle.write(text)
            temp_path = handle.name
        self.last_notepad_path = temp_path
        if sys.platform == "win32":
            subprocess.Popen(["notepad.exe", temp_path])
        else:
            print(f"Notepad summary prepared: {temp_path}", file=sys.stderr)
        return temp_path

    def save_pending_summary(self):
        if not self.pending_notepad_summary:
            return None
        topic = self.pending_notepad_summary.get("topic") or self.current_note_topic or "general_notes"
        text = self.pending_notepad_summary.get("text") or ""
        research = self.pending_notepad_summary.get("research") or {}
        session_path = self.ensure_note_session(topic)
        summary_path = self.cali_notes.write_summary(
            topic,
            text,
            key_points=(research.get("research_synthesis") or {}).get("key_findings") or [],
            sources=research.get("sources") or [],
        )
        for source in research.get("sources") or []:
            if isinstance(source, dict):
                source.setdefault("query", self.pending_notepad_summary.get("query"))
                self.cali_notes.append_source(topic, source)
        self.cali_notes.append(session_path, f"[{datetime.now().isoformat()}] saved_summary: {summary_path}")
        return summary_path

    def record_research_notes(self, query, research, input_frame=None):
        topic = self.extract_topic_from_query(query, input_frame)
        session_path = self.ensure_note_session(topic) if self.note_taking_enabled else None
        sources = research.get("sources") or []
        domains = research.get("domains") or []
        default_domain = domains[0] if isinstance(domains, list) and domains else None

        synthesis = research.get("research_synthesis") or {}
        key_findings = synthesis.get("key_findings") or []
        event_findings = [
            event.get("result_summary")
            for event in self.replay_research_events(topic=topic, min_confidence=0.7, limit=20)
            if event.get("result_summary")
        ]
        passive_points = list(key_findings or []) + event_findings
        if not self.note_taking_enabled:
            return {
                "topic": topic,
                "session_path": None,
                "passive_highlights": len(passive_points),
                "promoted_highlights": 0,
                "pending_only": True,
            }

        for source in sources:
            if isinstance(source, dict):
                source.setdefault("query", query)
                source.setdefault("domain", default_domain)
                self.cali_notes.append_source(topic, source)

        self.cali_notes.store_lightweight_summary(topic, query, passive_points, sources)
        summary = (
            research.get("response_text")
            or research.get("voice_response")
            or synthesis.get("summary")
            or " ".join(event_findings[:5])
            or ""
        )
        if summary:
            self.cali_notes.write_summary(
                topic,
                summary,
                key_points=passive_points,
                sources=sources,
            )
        promoted = []
        if self.note_taking_enabled:
            promoted = self.cali_notes.promote_passive_highlights(topic, session_path)
        if self.note_taking_enabled and key_findings:
            self.cali_notes.append(session_path, "\nKey points:")
            for finding in key_findings[:5]:
                self.cali_notes.append(session_path, f"- {finding}")
        if self.note_taking_enabled and event_findings:
            self.cali_notes.append(session_path, "\nHigh-confidence event notes:")
            for finding in event_findings[:5]:
                self.cali_notes.append(session_path, f"- {finding}")
        return {
            "topic": topic,
            "session_path": str(session_path) if session_path else None,
            "passive_highlights": len(passive_points),
            "promoted_highlights": len(promoted),
        }

    def reason_with_cali(self, text, context=None):
        if not self.cali:
            return None
        try:
            return self.cali.reason(text, context=context or {})
        except Exception as e:
            print(f"CALI reasoning error: {e}", file=sys.stderr)
            return None

    def research_with_cali(self, query, domains=None):
        if not self.cali:
            return None
        domain_list = domains or []
        topic = self.extract_topic_from_query(query)
        note_meta = {
            "topic": topic,
            "session_path": str(self.current_note_session) if self.note_taking_enabled and self.current_note_session else None,
        }
        started_at = time.time()

        self.emit_cali_state("planning", "", query=query, domains=domain_list, topic=topic)
        self.emit_spoken_text(
            f"I'm glad I can help with your research on {topic}. "
            "If you want me to take notes, just say it or type it."
        )

        if self.short_term_research_cache:
            cached = self.short_term_research_cache.get(query, domain_list)
            if cached:
                if isinstance(cached, dict):
                    cached["_short_term_cache_hit"] = True
                    cached["_swarm_cache_hit"] = True
                    cached["notes"] = note_meta
                self.record_research_event(
                    {
                        "type": "swarm:complete",
                        "data": {
                            "query": query,
                            "topic": topic,
                            "source": "short_term_cache",
                            "cache_hit": True,
                            "confidence": cached.get("confidence") if isinstance(cached, dict) else None,
                            "result_summary": (
                                cached.get("response_text")
                                or cached.get("voice_response")
                                or ""
                            )
                            if isinstance(cached, dict)
                            else "",
                            "latency_ms": int((time.time() - started_at) * 1000),
                        },
                    },
                    query=query,
                    topic=topic,
                )
                if isinstance(cached, dict):
                    summary_text = self.build_research_notepad_summary(query, cached, topic)
                    self.pending_notepad_summary = {
                        "topic": topic,
                        "query": query,
                        "text": summary_text,
                        "research": cached,
                        "created_at": datetime.now().isoformat(),
                    }
                    self.open_notepad_summary(summary_text)
                self.emit_cali_state("speaking", "", query=query, topic=topic)
                return cached

        if self.swarm_extension and hasattr(self.swarm_extension, "lookup_cached_research"):
            self.emit_cali_state("searching", "", query=query, topic=topic)
            cached = self.swarm_extension.lookup_cached_research(query, domain_list)
            if cached:
                if isinstance(cached, dict):
                    cached["_swarm_cache_hit"] = True
                    cached["notes"] = note_meta
                if self.short_term_research_cache:
                    self.short_term_research_cache.store(query, cached, domain_list, source="substrate")
                self.record_research_notes(query, cached)
                self.record_research_event(
                    {
                        "type": "swarm:complete",
                        "data": {
                            "query": query,
                            "topic": topic,
                            "source": "substrate",
                            "cache_hit": True,
                            "confidence": cached.get("confidence") if isinstance(cached, dict) else None,
                            "result_summary": (
                                cached.get("response_text")
                                or cached.get("voice_response")
                                or ""
                            )
                            if isinstance(cached, dict)
                            else "",
                            "latency_ms": int((time.time() - started_at) * 1000),
                        },
                    },
                    query=query,
                    topic=topic,
                )
                if isinstance(cached, dict):
                    summary_text = self.build_research_notepad_summary(query, cached, topic)
                    self.pending_notepad_summary = {
                        "topic": topic,
                        "query": query,
                        "text": summary_text,
                        "research": cached,
                        "created_at": datetime.now().isoformat(),
                    }
                    self.open_notepad_summary(summary_text)
                self.emit_cali_state("speaking", "", query=query, topic=topic)
                return cached

        try:
            self.emit_cali_state("searching", "", query=query, topic=topic)
            research = asyncio.run(self.cali.research(query, domain_list))
            if isinstance(research, dict):
                research["_swarm_cache_hit"] = False
                research["notes"] = note_meta
            self.emit_cali_state("synthesizing", "", query=query, topic=topic)
            if research and self.short_term_research_cache:
                self.short_term_research_cache.store(query, research, domain_list, source="live_research")
            if (
                research
                and self.swarm_extension
                and hasattr(self.swarm_extension, "store_research_result")
            ):
                self.swarm_extension.store_research_result(query, domain_list, research)
            if research:
                summary_text = self.build_research_notepad_summary(query, research, topic)
                self.pending_notepad_summary = {
                    "topic": topic,
                    "query": query,
                    "text": summary_text,
                    "research": research,
                    "created_at": datetime.now().isoformat(),
                }
                self.open_notepad_summary(summary_text)
                research["notes"] = self.record_research_notes(query, research)
                synthesis = research.get("research_synthesis") or {}
                self.record_research_event(
                    {
                        "type": "swarm:complete",
                        "data": {
                            "query": query,
                            "topic": topic,
                            "source": "live_research",
                            "cache_hit": False,
                            "confidence": research.get("confidence")
                            or synthesis.get("confidence")
                            or synthesis.get("confidence_aggregate"),
                            "result_summary": research.get("response_text")
                            or research.get("voice_response")
                            or synthesis.get("summary")
                            or " ".join((synthesis.get("key_findings") or [])[:3]),
                            "latency_ms": int((time.time() - started_at) * 1000),
                        },
                    },
                    query=query,
                    topic=topic,
                )
            self.emit_cali_state("speaking", "", query=query, topic=topic)
            return research
        except Exception as e:
            print(f"CALI research error: {e}", file=sys.stderr)
            return None

    def detect_research_intent(self, text, input_frame=None):
        normalized = str(text or "").strip()
        lowered = normalized.lower()
        if not normalized:
            return {"is_research": False, "domains": [], "reason": "empty"}

        explicit_terms = (
            "research",
            "look up",
            "lookup",
            "find sources",
            "source check",
            "verify",
            "fact check",
            "investigate",
            "compare sources",
            "what are the sources",
            "current",
            "latest",
            "today",
            "recent",
            "web search",
            "search the web",
            "use the substrate",
            "substrate research",
        )
        question_terms = ("who is", "what is", "when did", "where is", "how many", "how much")
        domain_terms = {
            "finance": ("stock", "market", "price", "sec", "filing", "revenue", "earnings"),
            "academic": ("paper", "study", "journal", "citation", "scholar"),
            "biomedical": ("clinical", "medical", "health", "trial", "pubmed"),
            "weather": ("weather", "storm", "climate", "forecast"),
            "space": ("nasa", "space", "launch", "satellite", "astronomy"),
            "geospatial": ("map", "location", "geospatial", "earthquake", "transport"),
        }

        semantic = (input_frame or {}).get("semantic") or {}
        implied = (input_frame or {}).get("implied_intent") or {}
        action_terms = [str(term).lower() for term in semantic.get("action_terms", [])]
        domain_hints = [str(term).lower() for term in implied.get("domain_hints", [])]

        matched = [term for term in explicit_terms if term in lowered]
        if not matched:
            matched.extend([term for term in action_terms if term in {"research", "verify", "compare", "find"}])

        is_research = bool(matched)
        if not is_research and any(term in lowered for term in question_terms):
            is_research = any(term in lowered for term in ("latest", "current", "today", "recent", "source", "verify"))

        domains = []
        for domain, terms in domain_terms.items():
            if domain in domain_hints or any(term in lowered for term in terms):
                domains.append(domain)

        return {
            "is_research": is_research,
            "domains": domains,
            "reason": matched[0] if matched else ("current_question" if is_research else "general_query"),
        }

    def normalize_research_response(self, query, domains, research):
        payload = dict(research or {})
        synthesis = payload.get("research_synthesis")
        if not isinstance(synthesis, dict):
            synthesis = {}
            payload["research_synthesis"] = synthesis

        sources = payload.get("sources") or payload.get("references") or synthesis.get("sources") or []
        if not isinstance(sources, list):
            sources = [sources]

        payload.setdefault("query", query)
        payload.setdefault("domains", domains or [])
        payload["sources"] = sources
        payload["source_count"] = len(sources) or int(synthesis.get("sources_queried") or 0)
        payload["confidence"] = synthesis.get("confidence_aggregate", synthesis.get("confidence", 0.0))
        payload["response_text"] = payload.get("voice_response") or payload.get("summary") or "Research complete."
        payload["substrate_record"] = {
            "cache_hit": bool(payload.get("_swarm_cache_hit")),
            "query": query,
            "domains": domains or [],
        }
        if payload.get("notes"):
            payload["notes"] = payload["notes"]
        return payload

    def run_research_request(self, query, domains=None):
        domain_list = domains or []
        research = self.research_with_cali(query, domain_list) or {
            "voice_response": "Research is unavailable right now.",
            "research_synthesis": {"error": "CALI research offline"},
        }
        return self.normalize_research_response(query, domain_list, research)

    def hear_with_cali(self, audio_signal):
        if not self.cali:
            return None
        try:
            return asyncio.run(self.cali.hear(audio_signal))
        except Exception as e:
            print(f"CALI hearing error: {e}", file=sys.stderr)
            return None

    def frame_text_with_acp(self, text, context=None):
        if not frame_text_input and os.getenv("ORB_ENABLE_ACP_TEXT_FRAME", "1").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }:
            self._ensure_acp_adapters()
        if not frame_text_input:
            normalized = str(text or "").strip()
            return {
                "source": "text_input",
                "raw_input": text,
                "normalized_text": normalized,
                "transcript": normalized,
                "confidence": 1.0 if normalized else 0.0,
                "_source": "fallback_text_frame",
                "context": context or {},
            }
        try:
            return frame_text_input(
                text,
                context=context or {},
                speaker_id=os.getenv("ORB_OPERATOR_ID", "orb_operator"),
            )
        except Exception as e:
            print(f"ACP 3.0 text framing error: {e}", file=sys.stderr)
            normalized = str(text or "").strip()
            return {
                "source": "text_input",
                "raw_input": text,
                "normalized_text": normalized,
                "transcript": normalized,
                "confidence": 1.0 if normalized else 0.0,
                "_source": "fallback_text_frame",
                "context": context or {},
            }

    def set_cali_orb_state(self, setting, value):
        if not self.cali:
            return False
        try:
            return self.cali.set_orb_state(setting, value)
        except Exception as e:
            print(f"CALI orb state error: {e}", file=sys.stderr)
            return False

    def _emotion_from_reasoning(self, reasoning):
        if not reasoning:
            return "thoughtful_warm"
        advisory = reasoning.get("advisory_verdict", {})
        confidence = advisory.get("confidence", 0.5)
        if confidence >= 0.8:
            return "confident"
        if confidence <= 0.45:
            return "uncertain"
        if advisory.get("tension_detected"):
            return "analytical"
        return "thoughtful_warm"

    def _presence_profile_from_stimulus(self, stimulus):
        payload = stimulus or {}
        context = payload.get("presence_context") or {}
        meta = payload.get("meta") or {}
        event = str(meta.get("event") or "").lower()
        idle_seconds = int(
            context.get("idle_seconds")
            or meta.get("idle_seconds")
            or 0
        )
        is_idle = (
            payload.get("type") == "idle_reflection"
            or event == "idle_start"
            or idle_seconds >= 30
        )
        autonomy_level = 0.94 if is_idle else 0.82
        return {
            "is_idle": is_idle,
            "idle_seconds": idle_seconds,
            "autonomy_level": autonomy_level,
            "cursor_influence": "minimal" if is_idle else "low",
            "movement_intent": "free_float",
            "quadrant": context.get("quadrant"),
            "active_process": context.get("active_process"),
            "active_window": context.get("active_window"),
        }

    def _to_ratio(self, raw_value, fallback=0.0):
        try:
            numeric = float(raw_value)
        except Exception:
            return float(fallback)
        if numeric > 1.0:
            numeric = numeric / 100.0
        return max(0.0, min(1.0, numeric))

    def _build_presence_update(self, stimulus, cognitive):
        payload = stimulus or {}
        context = payload.get("presence_context") or {}
        meta = payload.get("meta") or {}
        profile = self._presence_profile_from_stimulus(payload)
        advisory = cognitive.get("advisory_verdict", {}) if isinstance(cognitive, dict) else {}
        confidence = advisory.get("confidence")
        if confidence is None and isinstance(cognitive, dict):
            confidence = cognitive.get("confidence")
        if confidence is None:
            confidence = profile.get("autonomy_level", 0.82)

        event_name = str(meta.get("event") or payload.get("type") or "presence")
        if event_name == "desktop_context":
            event_name = "context_update"

        return {
            "type": "presence_update",
            "schema_version": "1.0",
            "ts": float(context.get("timestamp") or time.time()),
            "idle": bool(profile.get("is_idle")),
            "idle_seconds": int(profile.get("idle_seconds") or 0),
            "active_window": str(context.get("active_window") or "unknown"),
            "active_process": str(context.get("active_process") or "unknown"),
            "cpu": self._to_ratio(context.get("system_load"), fallback=0.0),
            "memory": self._to_ratio(context.get("memory_usage"), fallback=0.0),
            "cognitive_mode": (
                str(cognitive.get("cognitive_mode", "DEDUCTIVE"))
                if isinstance(cognitive, dict)
                else "DEDUCTIVE"
            ),
            "autonomy_level": float(profile.get("autonomy_level") or 0.82),
            "confidence_state": max(0.0, min(1.0, float(confidence))),
            "last_event": event_name,
            "quadrant": context.get("quadrant"),
            "stimulus_type": str(payload.get("type") or ""),
            "cursor_influence": profile.get("cursor_influence"),
            "movement_intent": profile.get("movement_intent"),
        }

    def _emit_presence_pulse(self, stimulus, thought):
        stype = str((stimulus or {}).get("type", ""))
        if stype not in {"desktop_context", "idle_transition", "idle_reflection"}:
            return

        cognitive = None
        if thought is not None:
            try:
                cognitive = thought.pulse() if hasattr(thought, "pulse") else thought
            except Exception:
                cognitive = None

        update = self._build_presence_update(stimulus, cognitive)
        self.latest_presence_update = update
        self._emit(update)

    def cognitively_emerge(self, stimulus):
        if not self.controller:
            return None
        thought = self.controller.cognitively_emerge(stimulus)
        self._emit_presence_pulse(stimulus, thought)
        return thought

    def idle_cognition(self, stimulus):
        if not self.controller:
            return None
        if hasattr(self.controller, "idle_cognition"):
            thought = self.controller.idle_cognition(stimulus)
        else:
            thought = self.controller.cognitively_emerge(stimulus)
        self._emit_presence_pulse(stimulus, thought)
        return thought

    def _emit(self, payload):
        with self._emit_lock:
            print(json.dumps(payload), flush=True)

    def start_speech_recognition(self):
        if not self._ensure_mic_runtime():
            return False
        if self.speech_thread and self.speech_thread.is_alive():
            return True

        self.speech_thread = threading.Thread(target=self._speech_loop)
        self.speech_thread.daemon = True
        self.speech_thread.start()
        return True

    def set_speech_recognition(self, enabled):
        if enabled and not self._ensure_mic_runtime():
            return False
        if not self.mic:
            return False

        self.speech_enabled = bool(enabled)
        if self.speech_enabled:
            self.start_speech_recognition()

        self._emit(
            {
                "type": "listening_mode",
                "data": {"enabled": self.speech_enabled, "mode": "continuous"},
            }
        )
        return True

    def listen_once(self):
        if self.speech_enabled:
            return False
        if not self._ensure_mic_runtime():
            return False
        if self.speech_lock.locked():
            return False
        if self.listen_once_thread and self.listen_once_thread.is_alive():
            return False

        self.listen_once_thread = threading.Thread(
            target=self._capture_speech_chunk,
            kwargs={"mode": "oneshot"},
            daemon=True,
        )
        self.listen_once_thread.start()
        return True

    def _capture_speech_chunk(self, mode="continuous"):
        if not self.mic:
            return None
        if not self.speech_lock.acquire(blocking=False):
            return None

        try:
            self._emit({"type": "listening_state", "data": {"listening": True, "mode": mode}})
            import soundfile as sf
            import tempfile

            # Record and process audio chunk
            audio_data = self.mic.record_chunk()
            cali_hearing = self.hear_with_cali(audio_data.flatten())

            # Save to temp file since processor expects a file path
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
                temp_path = temp_file.name
                sf.write(temp_path, audio_data.flatten(), self.mic.sample_rate)

            try:
                hearing_result = self.mic.processor.hear(
                    temp_path,
                    context={"source": "orb_microphone", "mode": mode},
                )
                transcription = (
                    hearing_result.get("transcript", "")
                    if isinstance(hearing_result, dict)
                    else str(hearing_result or "")
                )

                if transcription and transcription.strip():
                    print(f"🎤 Heard: {transcription}", file=sys.stderr)

                    vault_command = self.handle_research_vault_command(transcription)
                    if vault_command:
                        self.emit_spoken_text(vault_command["response_text"])
                        self._emit({"type": "research_vault_result", "data": vault_command})
                        return transcription

                    skill_result = self.handle_skill_request(transcription)
                    if skill_result:
                        self.emit_spoken_text(skill_result["response_text"])
                        self._emit({"type": "skill_result", "data": skill_result})
                        return transcription

                    core_result = self.handle_core_knowledge_request(transcription)
                    if core_result:
                        self.emit_spoken_text(core_result["response_text"])
                        self._emit({"type": "core_knowledge_result", "data": core_result})
                        return transcription

                    recall_result = self.handle_recall_request(transcription)
                    if recall_result:
                        self.emit_spoken_text(recall_result["response_text"])
                        self._emit({"type": "query_result", "data": recall_result})
                        return transcription

                    note_result = self.handle_note_request(transcription, source="voice")
                    if note_result:
                        return transcription

                    # Check for verbal commands
                    self._process_verbal_command(transcription)

                    # Process the speech input like a text query
                    stimulus = {
                        "type": "speech_query",
                        "content": transcription,
                        "coordinates": [0, 0],
                        "velocity": 0.0,
                    }

                    thought = self.cognitively_emerge(stimulus)
                    intent = self.detect_research_intent(transcription)
                    research = None
                    cali_reasoning = None
                    if intent.get("is_research"):
                        research = self.run_research_request(
                            transcription,
                            intent.get("domains") or [],
                        )
                        response_text = research.get("response_text") or research.get("voice_response")
                    else:
                        cali_reasoning = self.reason_with_cali(
                            transcription,
                            context={"source": "speech_query", "stimulus_type": "speech_query"},
                        )
                        response_text = (
                            cali_reasoning.get("recommended_response")
                            if cali_reasoning
                            else f"I heard you say: {transcription}"
                        )
                    voice_payload = self.build_voice_payload(
                        response_text,
                        "analytical" if research else self._emotion_from_reasoning(cali_reasoning),
                    )
                    self.last_response_text = response_text or ""
                    if thought:
                        pulse = thought.pulse() if hasattr(thought, "pulse") else thought

                        # Send cognitive pulse to Electron
                        response = {
                            "type": "speech_pulse",
                            "data": pulse,
                            "transcription": transcription,
                            "intent": intent,
                            "response_text": response_text,
                            "audio_path": voice_payload.get("audio_path"),
                            "voice_package": voice_payload.get("voice_package"),
                            "research": research,
                            "cali_reasoning": cali_reasoning,
                            "advisory_verdict": (
                                cali_reasoning.get("advisory_verdict") if cali_reasoning else None
                            ),
                            "cali_hearing": cali_hearing,
                        }
                        self._emit(response)
                    else:
                        self._emit(
                            {
                                "type": "speech_pulse",
                                "data": {},
                                "transcription": transcription,
                                "intent": intent,
                                "response_text": response_text,
                                "audio_path": voice_payload.get("audio_path"),
                                "voice_package": voice_payload.get("voice_package"),
                                "research": research,
                                "cali_reasoning": cali_reasoning,
                                "advisory_verdict": (
                                    cali_reasoning.get("advisory_verdict") if cali_reasoning else None
                                ),
                                "cali_hearing": cali_hearing,
                            }
                        )
                    return transcription
                return ""
            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)

        except Exception as e:
            print(f"Speech processing error: {e}", file=sys.stderr)
            time.sleep(1)
            return None
        finally:
            self._emit({"type": "listening_state", "data": {"listening": False, "mode": mode}})
            self.speech_lock.release()

    def _speech_loop(self):
        while self.running:
            if not self.speech_enabled:
                time.sleep(0.05)
                continue

            self._capture_speech_chunk(mode="continuous")
            time.sleep(0.1)

    def _process_verbal_command(self, transcription):
        """Process verbal commands starting with 'CALI'"""
        if not transcription.lower().startswith("cali"):
            return

        command = transcription.lower()[5:].strip()

        if "slow down" in command:
            # Adjust animation speed (send to Electron)
            response = {"type": "verbal_command", "command": "slow_down"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Slowing down")

        elif "speed up" in command:
            response = {"type": "verbal_command", "command": "speed_up"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Speeding up")

        elif "change color" in command:
            # Extract color if specified
            if "blue" in command:
                color = "#00ff88"
            elif "red" in command:
                color = "#ff4444"
            elif "green" in command:
                color = "#44ff44"
            else:
                color = "#00ff88"  # default glassy blue-green

            response = {
                "type": "verbal_command",
                "command": "change_color",
                "color": color,
            }
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Changing color")

        elif "increase size" in command:
            response = {"type": "verbal_command", "command": "increase_size"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Increasing size")

        elif "decrease size" in command:
            response = {"type": "verbal_command", "command": "decrease_size"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Decreasing size")

        elif "dock" in command:
            response = {"type": "verbal_command", "command": "dock_orb"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Docking")

        elif "front and center" in command or "launch orb" in command or "show orb" in command:
            response = {"type": "verbal_command", "command": "show_orb"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Front and center")

        elif "toggle orb" in command:
            response = {"type": "verbal_command", "command": "toggle_visibility"}
            print(json.dumps(response), flush=True)
            self.emit_spoken_text("Toggling")

    def stop(self):
        self.running = False
        self.speech_enabled = False
        cognitive_thread = getattr(self, "cognitive_thread", None)
        speech_thread = getattr(self, "speech_thread", None)
        listen_once_thread = getattr(self, "listen_once_thread", None)
        if cognitive_thread:
            cognitive_thread.join(timeout=1)
        if speech_thread:
            speech_thread.join(timeout=1)
        if listen_once_thread:
            listen_once_thread.join(timeout=1)
        if self.desktop_presence:
            try:
                self.desktop_presence.graceful_shutdown()
            except Exception:
                pass
        if self.swarm_extension:
            try:
                self.swarm_extension.shutdown()
            except Exception:
                pass
        if self.cali:
            self.cali.close()
        if self.controller and hasattr(self.controller, "shutdown"):
            try:
                self.controller.shutdown()
            except Exception:
                pass

    def process_cursor_movement(self, x, y):
        current_time = time.time()
        dx = x - self.last_cursor_pos[0]
        dy = y - self.last_cursor_pos[1]
        dt = current_time - self.last_time
        velocity = ((dx**2 + dy**2) ** 0.5) / max(dt, 0.001) if dt > 0 else 0

        self.last_cursor_pos = (x, y)
        self.last_time = current_time

        stimulus = {
            "type": "cursor_movement",
            "coordinates": [x, y],
            "velocity": min(velocity, 50.0),
            "intent": "navigation",
        }

        thought = self.cognitively_emerge(stimulus)
        if thought:
            if hasattr(thought, "pulse"):
                pulse = thought.pulse()
                # Enrich with tribunal fields that thought.pulse() omits
                pulse["field_density"] = (
                    getattr(thought, "logic_validity", {}).get("field_density", 0)
                )
                ucm = getattr(thought, "ucm_envelope", None) or {}
                flags = (ucm.get("cali_reflection") or {}).get("flags", {})
                pulse["drift_detected"] = flags.get("drift_detected", False)
                if getattr(thought, "epistemic_traces", None):
                    pulse["four_mind"] = {
                        mind: round(data.get("confidence", 0.5), 3)
                        for mind, data in thought.epistemic_traces.items()
                    }
            else:
                # Lightning bypass returns dict directly
                pulse = thought
            # Send cognitive pulse to Electron
            response = {"type": "cognitive_pulse", "data": pulse}
            print(json.dumps(response), flush=True)
            return pulse
        return None

    def _cognitive_loop(self):
        while self.running:
            # Periodic cognitive processing if needed
            time.sleep(0.1)

    def start(self):
        self.running = True
        # Start background cognitive processing
        self.cognitive_thread = threading.Thread(target=self._cognitive_loop)
        self.cognitive_thread.daemon = True
        self.cognitive_thread.start()

        # Continuous speech recognition is opt-in for the artifact overlay model.
        if self.auto_listen:
            self.set_speech_recognition(True)

    def get_status(self):
        cali_root = self.project_root / "CALI_System"
        memory_root = cali_root / "memory"
        voice_cache_root = cali_root / "voice_cache"
        decisions_path = memory_root / "decisions.jsonl"
        short_term_cache_path = memory_root / "short_term_cache.db"
        last_decision = None
        if decisions_path.exists():
            try:
                decision_lines = [
                    line.strip()
                    for line in decisions_path.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
                if decision_lines:
                    last_decision = json.loads(decision_lines[-1])
            except Exception:
                last_decision = None
        status = {
            "instance_id": self.instance_id,
            "running": self.running,
            "controller_status": "active" if self.controller else "inactive",
            "listening_enabled": self.speech_enabled,
            "auto_listen": self.auto_listen,
            "project_root": str(self.project_root),
            "system_root": str(self.system_root),
            "shared_mesh_root": self.shared_mesh_root,
            "notes": {
                "base_path": str(self.cali_notes.base_path),
                "active_topic": self.current_note_topic,
                "active_session": str(self.current_note_session) if self.current_note_session else None,
                "taking_notes": self.note_taking_enabled,
                "pending_notepad_summary": bool(self.pending_notepad_summary),
                "last_notepad_path": self.last_notepad_path,
            },
            "core_knowledge": {
                "base_path": str(self.core_knowledge.base_path) if self.core_knowledge else None,
                "available": bool(self.core_knowledge),
            },
            "skills": {
                "available": bool(self.skill_registry),
                "catalog_count": len(self.skill_registry.catalog) if self.skill_registry else 0,
                "active": sorted(self.skill_loader.get_active().keys()) if self.skill_loader else [],
                "last_decision": last_decision,
            },
            "research_vault": {
                "active_path": str(self.research_vault.active_path) if self.research_vault else None,
                "index_path": str(self.research_vault.index_path) if self.research_vault else None,
                "available": bool(self.research_vault),
            },
            "substrate": {
                "project_root": str(self.project_root),
                "cali_system_root": str(cali_root),
                "memory_root": str(memory_root),
                "notes_root": str(self.cali_notes.base_path),
                "voice_cache_root": str(voice_cache_root),
                "short_term_cache_path": str(short_term_cache_path),
                "short_term_cache_exists": short_term_cache_path.exists(),
                "decisions_path": str(decisions_path),
                "decisions_exists": decisions_path.exists(),
            },
            "acp_io": {
                "acp3_root": str(ACP_PATH),
                "acp3_root_exists": ACP_PATH.exists(),
                "adapter_import_status": ACP_IMPORT_STATUS,
                "audio_runtime_status": dict(self.audio_runtime_status),
                "speech_adapter_available": MicCapture is not None,
                "speech_runtime_ready": self.mic is not None,
                "voice_adapter_available": KokoroBaseline is not None,
                "voice_runtime_ready": self.voice is not None,
                "text_framing_available": frame_text_input is not None,
                "audio_input_source": "orb_microphone",
                "text_input_source": "ipc_query",
                "listening_enabled": self.speech_enabled,
            },
            "services": {
                "domains": [service.get("domain") for service in self.load_service_manifest()],
                "items": self.load_service_manifest(),
                "manifest_path": str(self.core_knowledge.base_path / "spruked" / "services.json") if self.core_knowledge else None,
                "mode": "local_manifest_required",
            },
        }
        if self.cali:
            status["cali_status"] = self.cali.get_status()
        if self.desktop_presence:
            status["desktop_presence"] = self.desktop_presence.get_status()
        else:
            status["desktop_presence"] = {"running": False}
        if self.latest_presence_update:
            status["presence_update"] = self.latest_presence_update
        if self.swarm_extension:
            status["swarm_extension"] = self.swarm_extension.get_status()
        else:
            status["swarm_extension"] = {"running": False}
        return status


__all__ = ["CALIFloatingOrb"]


def _main() -> None:
    """Run Orb and respond to simple IPC messages over stdin/stdout (JSON lines)."""
    orb = CALIFloatingOrb(PROJECT_ROOT)
    orb.start()

    # Check UCM status
    try:
        with urllib.request.urlopen(
            "http://localhost:5050/orb/status", timeout=5
        ) as response:
            data = json.loads(response.read().decode())
            if data.get("status") == "active":
                print("UCM status active", file=sys.stderr)
            else:
                print("UCM status not active", file=sys.stderr)
    except Exception as e:
        print(f"UCM status check failed: {e}", file=sys.stderr)

    # Signal readiness to Electron bridge
    print(json.dumps({"type": "ready"}), flush=True)

    for line in sys.stdin:
        try:
            msg = json.loads(line.strip())
        except Exception:
            continue

        msg_type = msg.get("type")
        request_id = msg.get("request_id")

        if msg_type == "shutdown":
            orb.stop()
            print(json.dumps({"type": "shutdown_ack", "request_id": request_id}), flush=True)
            break

        elif msg_type == "cursor_move":
            x = msg.get("x", 0)
            y = msg.get("y", 0)
            orb.process_cursor_movement(x, y)

        elif msg_type == "get_status":
            status = orb.get_status()
            response = {"type": "status_response", "request_id": request_id, "data": status}
            print(json.dumps(response), flush=True)

        elif msg_type == "service_control":
            result = orb.handle_service_control(
                msg.get("service_id") or msg.get("service"),
                msg.get("action") or "status",
            )
            response = {"type": "service_result", "request_id": request_id, "data": result}
            print(json.dumps(response), flush=True)

        elif msg_type == "listen_once":
            accepted = orb.listen_once()
            orb._emit(
                {
                    "type": "listen_once_ack",
                    "request_id": request_id,
                    "data": {"accepted": accepted},
                }
            )

        elif msg_type == "set_listening":
            enabled = bool(msg.get("enabled", False))
            ok = orb.set_speech_recognition(enabled)
            orb._emit(
                {
                    "type": "listening_mode",
                    "request_id": request_id,
                    "data": {
                        "enabled": orb.speech_enabled if ok else False,
                        "ok": ok,
                        "mode": "continuous",
                    },
                }
            )

        elif msg_type == "query":
            text = msg.get("text", "")
            input_frame = orb.frame_text_with_acp(
                text,
                context={"source": "ipc_query", "stimulus_type": "text_query"},
            )
            framed_text = input_frame.get("normalized_text") or input_frame.get("transcript") or text
            vault_command = orb.handle_research_vault_command(framed_text)
            if vault_command:
                voice_payload = orb.build_voice_payload(vault_command["response_text"])
                orb._emit(
                    {
                        "type": "query_result",
                        "request_id": request_id,
                        "data": {
                            "echo": text,
                            "input_frame": input_frame,
                            "intent": {"is_research_vault_command": True},
                            "response_text": vault_command["response_text"],
                            "audio_path": voice_payload.get("audio_path"),
                            "voice_package": voice_payload.get("voice_package"),
                            "research_vault": vault_command,
                        },
                    }
                )
                continue
            skill_result = orb.handle_skill_request(framed_text, input_frame)
            if skill_result:
                voice_payload = orb.build_voice_payload(skill_result["response_text"])
                orb.last_response_text = skill_result["response_text"]
                orb._emit(
                    {
                        "type": "query_result",
                        "request_id": request_id,
                        "data": {
                            "echo": text,
                            "input_frame": input_frame,
                            "intent": {"is_skill": True},
                            "response_text": skill_result["response_text"],
                            "audio_path": voice_payload.get("audio_path"),
                            "voice_package": voice_payload.get("voice_package"),
                            "skill": skill_result,
                        },
                    }
                )
                continue
            core_result = orb.handle_core_knowledge_request(framed_text)
            if core_result:
                voice_payload = orb.build_voice_payload(core_result["response_text"])
                orb.last_response_text = core_result["response_text"]
                orb._emit(
                    {
                        "type": "query_result",
                        "request_id": request_id,
                        "data": {
                            "echo": text,
                            "input_frame": input_frame,
                            "intent": {"is_core_knowledge": True},
                            "response_text": core_result["response_text"],
                            "audio_path": voice_payload.get("audio_path"),
                            "voice_package": voice_payload.get("voice_package"),
                            "core_knowledge": core_result,
                        },
                    }
                )
                continue
            recall_result = orb.handle_recall_request(framed_text, input_frame)
            if recall_result:
                voice_payload = orb.build_voice_payload(recall_result["response_text"])
                orb.last_response_text = recall_result["response_text"]
                orb._emit(
                    {
                        "type": "query_result",
                        "request_id": request_id,
                        "data": {
                            "echo": text,
                            "input_frame": input_frame,
                            "intent": {"is_recall": True},
                            "response_text": recall_result["response_text"],
                            "audio_path": voice_payload.get("audio_path"),
                            "voice_package": voice_payload.get("voice_package"),
                            "recall": recall_result,
                        },
                    }
                )
                continue
            note_result = orb.handle_note_request(framed_text, input_frame, source="text")
            if note_result:
                orb._emit(
                    {
                        "type": "query_result",
                        "request_id": request_id,
                        "data": {
                            "echo": text,
                            "input_frame": input_frame,
                            "intent": {"is_note": True},
                            "response_text": note_result["response_text"],
                            "notes": note_result,
                        },
                    }
                )
                continue
            intent = orb.detect_research_intent(framed_text, input_frame)
            # Use SF-ORB cognitive processing
            stimulus = {
                "type": "text_query",
                "content": framed_text,
                "coordinates": [0, 0],  # dummy
                "velocity": 0.0,
                "input_frame": input_frame,
                "intent": intent,
            }
            result = orb.cognitively_emerge(stimulus)
            research = None
            cali_reasoning = None
            if intent.get("is_research"):
                research = orb.run_research_request(framed_text, intent.get("domains") or [])
                response_text = research.get("response_text") or research.get("voice_response")
            else:
                cali_reasoning = orb.reason_with_cali(
                    framed_text,
                    context={
                        "source": "ipc_query",
                        "stimulus_type": "text_query",
                        "input_frame": input_frame,
                        "semantic": input_frame.get("semantic"),
                        "implied_intent": input_frame.get("implied_intent"),
                    },
                )
                response_text = (
                    cali_reasoning.get("recommended_response")
                    if cali_reasoning
                    else f"Analyzed: {framed_text}"
                )
            voice_payload = orb.build_voice_payload(
                response_text,
                "analytical" if research else orb._emotion_from_reasoning(cali_reasoning),
            )
            orb.last_response_text = response_text or ""

            response = {
                "type": "query_result",
                "request_id": request_id,
                "data": {
                    "echo": text,
                    "input_frame": input_frame,
                    "intent": intent,
                    "response_text": response_text,
                    "audio_path": voice_payload.get("audio_path"),
                    "voice_package": voice_payload.get("voice_package"),
                    "research": research,
                    "research_synthesis": research.get("research_synthesis") if research else None,
                    "sources": research.get("sources") if research else [],
                    "substrate_record": research.get("substrate_record") if research else None,
                    "cali_reasoning": cali_reasoning,
                    "advisory_verdict": (
                        cali_reasoning.get("advisory_verdict") if cali_reasoning else None
                    ),
                    "cognitive_result": (
                        result.pulse() if hasattr(result, "pulse") else result
                    ),
                    "state": orb.get_status(),
                },
            }
            print(json.dumps(response), flush=True)

        elif msg_type == "research":
            query = msg.get("query") or msg.get("text", "")
            domains = msg.get("domains") or []
            research = orb.run_research_request(query, domains)
            voice_payload = orb.build_voice_payload(research.get("response_text", ""))
            orb.last_response_text = research.get("response_text", "") or research.get("voice_response", "")
            orb._emit(
                {
                    "type": "research_result",
                    "request_id": request_id,
                    "data": {
                        **research,
                        "voice_package": voice_payload.get("voice_package"),
                        "audio_path": voice_payload.get("audio_path"),
                    },
                }
            )

        elif msg_type == "speak":
            text = msg.get("text", "")
            emotion = msg.get("emotion", "thoughtful_warm")
            orb._emit(
                {
                    "type": "speak_result",
                    "request_id": request_id,
                    "data": orb.build_voice_payload(text, emotion),
                }
            )

        elif msg_type == "set_orb_state":
            setting = msg.get("setting")
            value = msg.get("value")
            ok = orb.set_cali_orb_state(setting, value)
            orb._emit(
                {
                    "type": "orb_state_result",
                    "request_id": request_id,
                    "data": {"ok": ok, "state": orb.get_status()},
                }
            )


if __name__ == "__main__":
    _main()
