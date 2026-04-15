$ErrorActionPreference = "Stop"

# Local performance profile for Windows desktop Orb instance.
# This file is loaded by launch_desktop_orb.ps1 after orb-instance.windows.ps1.

# Keep hardware acceleration explicit.
$env:ORB_PYTHON_PATH = "C:\Users\bryan\AppData\Local\Programs\Python\Python311\python.exe"
$env:ORB_USE_GL = "angle"
$env:ORB_USE_ANGLE = "d3d11"
$env:ORB_IGNORE_GPU_BLOCKLIST = "1"
$env:ORB_ENABLE_GPU_RASTERIZATION = "1"

# Reduce renderer + bridge load.
$env:ORB_PRIMARY_DISPLAY_ONLY = "0"
$env:ORB_CURSOR_SAMPLE_MS = "33"
$env:ORB_TOPMOST_WATCHDOG_MS = "500"
$env:ORB_TOPMOST_REFRESH_MS = "3000"
$env:ORB_CURSOR_CLEARANCE_EXTRA_PX = "140"

# Reduce optional background workloads in the Python bridge.
$env:ORB_ENABLE_DESKTOP_PRESENCE = "0"
$env:ORB_ENABLE_SWARM_EXTENSION = "1"
$env:ORB_AUTO_LISTEN = "0"

# ACP / STT / TTS device preferences (auto-select CUDA when runtime supports it).
$env:ACP3_ROOT = "R:\cochlear_processor_3.0"
$env:ACP3_SKG_PATH = "R:\Orb_Assistant_Desktop\system\CALI_System\memory\hearing_skg_v3.json"
$env:ACP3_AUDIO_CACHE = "R:\Orb_Assistant_Desktop\system\CALI_System\voice_cache"
$env:ORB_AUDIO_BACKEND = "auto"
$env:ACP_WHISPER_DEVICE = "auto"

# Constrain CPU-heavy native math thread pools.
$env:OMP_NUM_THREADS = "4"
$env:MKL_NUM_THREADS = "4"
$env:OPENBLAS_NUM_THREADS = "4"
$env:NUMEXPR_MAX_THREADS = "4"
$env:UV_THREADPOOL_SIZE = "4"
