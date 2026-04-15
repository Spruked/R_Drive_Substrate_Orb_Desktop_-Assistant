# CALI Floating Assistant Orb (Orb_Assistant)

A screen-aware, cursor-tracking AI assistant that integrates with UCM_4_Core ECM for cognitive enhancement.

This root README is the **authoritative** Orb documentation for this workspace. Module READMEs remain intact as historical or component-specific references.

## Architecture Note

Earlier versions of this repo included an "Immutable System Law" describing a binding Core-4 cognitive architecture.

That text is no longer authoritative for this workspace. The current Orb runtime does not implement that model end to end, and the remaining Core-4-related material in the repo is historical, partial, or stubbed.

See [IMMUTABLE_LAW.md](IMMUTABLE_LAW.md) for the deprecation note.

## Features

- 🖥️ **Screen Awareness**: Sees your screen and understands UI elements
- 🖱️ **Cursor Tracking**: Maintains ~350px distance from cursor
- 🧠 **Cognitive Integration**: Uses ECM and SKG for intelligent assistance
- 🤖 **Automation**: Can automate typing and clicks with permission
- 📊 **Habit Learning**: Learns your usage patterns via SKG
- 🔒 **Privacy-First**: Requires explicit permission for all features

## Architecture

### Core Components

1. **FloatingAssistantOrb** (Python)
   - Screen capture and OCR
   - Cursor tracking and positioning
   - ECM integration for cognitive processing
   - SKG habit learning
   - **Recently cleaned**: Organized imports, centralized path setup, improved error handling

2. **OrbController** (Python)
   - Cognitive processing controller with epistemic gravity field integration
   - **Recently cleaned**: Restructured imports, cleaner EGF setup, better error boundaries

3. **CALI SKG** (Python)
   - Machine learning subsystem with optional component loading
   - **Recently cleaned**: Consolidated optional imports into structured configuration

4. **Electron Main Process**
   - IPC bridge between Python and renderer
   - Window management
   - Permission handling

5. **Renderer UI**
   - Floating orb UI (vanilla `simple-orb.js` in current Electron runtime)
   - Optional React orb (`FloatingOrb.jsx`) for UCM-driven motion and HUD

### Recent Code Organization (2026-04-14)

The codebase has been comprehensively cleaned and organized while preserving all functionality:

- **Import Organization**: Separated standard library, third-party, and local imports
- **Path Resolution**: Centralized component path discovery for SF-ORB and ACP 3.0
- **Configuration Management**: Structured optional dependency loading with graceful degradation
- **Error Handling**: Improved error boundaries with informative logging
- **Dependencies**: Grouped requirements.txt by category (scientific, ML, web, audio, system, GUI)

All changes maintain backward compatibility and component interconnections.

### Data Flow

- Screen → OCR/Vision → ECM → Task Planning → Automation
- Cursor → Position Tracking → Orb Movement
- User Habits → SKG Learning → Personalized Assistance

## Runtime Topology

- **Electron main ↔ Python**: JSON messages over stdio via `python-shell`.
- **Renderer ↔ Electron main**: IPC (`orb:cursor-move`, `orb:get-status`, `orb:cognitive-pulse`).
- **Renderer ↔ UCM**: WebSocket + optional HTTP performance polling (React orb path).
- **Optional WS stub**: Local dev stub for status/query echo.
- **Swarm substrate (local)**: SQLite store at `system/swarm/substrate.db` for shared research cache, mesh tasks, and promoted knowledge.

## Ports & Endpoints

> **This section reflects the currently active runtime configuration (non-Docker).**

### UCM WebSocket (React orb path)
- **WebSocket**: `ws://localhost:8000/ws/orb_assistant`
  - Used by `electron/src/components/FloatingOrb.jsx`
  - Handshake: `ORB_HANDSHAKE` with `orb_id` and `capabilities`
  - Receives `lerp_optimization` and `drift_preference` updates

### UCM HTTP (React orb path)
- **HTTP**: `http://localhost:8000/api/orb/performance`
  - Polled every 5s by `FloatingOrb.jsx` for performance HUD
  - Note: the mock server in `electron/src/ucm_server.py` does **not** implement this endpoint yet

### Mock UCM WebSocket Server
- **Server**: `electron/src/ucm_server.py`
  - Binds on `0.0.0.0:8000`
  - WebSocket path: `/ws/orb_assistant`

### WS Stub (local dev)
- **WebSocket**: `ws://localhost:${ORB_WS_PORT}` (default `9876`)
  - Run with `npm run ws:stub` from `electron/`
  - Echoes status/query responses for UI testing

## Configuration & Environment Variables

- `ORB_DISABLE_PYTHON_BRIDGE=1`
  - Disables Python bridge startup in Electron main.
- `ORB_PYTHON_PATH`
  - Absolute Python executable used by Orb bridge (set to your CUDA-enabled runtime for GPU paths).
- `ORB_WS_PORT`
  - Port for the local WS stub (`electron/ws-stub.js`).
- `ORB_PRIMARY_DISPLAY_ONLY=1`
  - Runs Orb window only on the primary display (lowers renderer load on multi-monitor setups).
- `ORB_CURSOR_SAMPLE_MS`
  - Cursor sampling interval in milliseconds (`16` default, `33` recommended for balanced mode).
- `ORB_CURSOR_CLEARANCE_EXTRA_PX`
  - Adds extra cursor distance padding to keep the orb farther from the pointer.
- `ORB_TOPMOST_WATCHDOG_MS` / `ORB_TOPMOST_REFRESH_MS`
  - Topmost enforcement cadence; increase values to reduce maintenance overhead.
- `ORB_ENABLE_DESKTOP_PRESENCE=0`
  - Disables desktop presence memory background runtime.
- `ORB_ENABLE_SWARM_EXTENSION=1`
  - Enables local swarm runtime bridge and shared substrate persistence.
- `ACP3_ROOT`
  - Absolute path to the single ACP 3.0 runtime (`R:\cochlear_processor_3.0` on Windows, `/mnt/r/cochlear_processor_3.0` under WSL).
- `ACP3_SKG_PATH`
  - R-drive hearing SKG used by ACP 3.0 (`system/CALI_System/memory/hearing_skg_v3.json`).
- `ACP3_AUDIO_CACHE`
  - R-drive output cache for ACP 3.0 voice artifacts.
- `ACP_WHISPER_DEVICE=auto`
  - Optional local Whisper device selection when the active Python runtime has Whisper installed.
- Python bridge sets `PYTHONIOENCODING=utf-8` internally for clean JSON I/O.

## Setup & Run (Windows)

### Prerequisites
- Node.js 16+
- Python 3.8+
- Tesseract OCR

### Install Dependencies

- Python deps (from `electron/`):
  - `pip install -r requirements.txt`
- Node deps (from `electron/`):
  - `npm install`
- Tesseract OCR:
  - Download from GitHub releases (Windows installer)

### Run the Orb

From `electron/`:
- `npm start`

Historical note: earlier docs referenced `npm run build`, but the current `package.json` exposes `pack` and `dist` instead. Use those if you need a packaged build.

## Session Records & Development History

Development sessions are documented in `electron/SESSION_RECORD_*.md` files:

- **SESSION_RECORD_2026-04-14_120000_CDT.md**: Codebase review, testing framework development, comprehensive cleanup and organization
- Previous sessions archived for historical reference

## Development Notes

### Project Structure (Electron)

```
electron/
├── main/
│   ├── main.js          # Electron main process
│   ├── preload.js       # Secure IPC bridge
│   └── orb-bridge.js    # Python integration
├── src/
│   ├── components/
│   │   ├── FloatingOrb.jsx
│   │   └── FloatingOrb.css
│   ├── main.jsx         # React entry point (not used by default index.html)
│   ├── simple-orb.js    # Default Electron renderer orb
│   └── index.html       # App HTML
├── requirements.txt     # Python dependencies
├── package.json         # Node.js config
└── launch.sh            # Launch script (Unix)
```

### Adding New Features

1. Add Python methods to `FloatingAssistantOrb` (see `electron/src/floating_assistant_orb.py`).
2. Expose via IPC in `electron/main/orb-bridge.js`.
3. Use in renderer via `window.electronAPI` (see `electron/main/preload.js`).

## Security & Privacy

- All screen data is processed locally.
- No data is sent to external servers by default.
- User must explicitly grant permissions.
- Automation requires additional permission.
- All data is encrypted in the UCM vault system.

## Troubleshooting

### Orb Not Appearing
- Check console for permission errors.
- Ensure screen access permission is granted.
- Verify Python dependencies are installed.

### Orb Pulses but Doesn’t Move
- The default Electron UI (`simple-orb.js`) only moves on mouse proximity.
- Ensure the window is receiving mouse events and your cursor is within ~350px.
- For UCM-driven drift and richer motion, switch to the React orb (`FloatingOrb.jsx`).

### Performance Issues
- Reduce screen capture region size.
- Adjust cursor tracking frequency.
- Disable vision model if not needed.

### Permission Errors
- Restart the application.
- Check OS security settings.
- Reinstall with proper permissions.
