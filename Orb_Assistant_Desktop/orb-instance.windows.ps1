$orbRoot = $PSScriptRoot
$defaultMeshRoot = if (Test-Path "O:\") {
  "O:\orb_mesh"
} elseif (Test-Path "R:\") {
  "R:\orb_mesh"
} else {
  Join-Path $orbRoot "orb_mesh"
}

if (-not $env:ORB_INSTANCE_ID) { $env:ORB_INSTANCE_ID = "desktop" }
if (-not $env:ORB_PRODUCT_NAME) { $env:ORB_PRODUCT_NAME = "Orb Assistant Desktop" }
if (-not $env:ORB_APP_ID) { $env:ORB_APP_ID = "com.orbassistant.desktop" }
if (-not $env:ORB_USER_DATA_DIR) { $env:ORB_USER_DATA_DIR = Join-Path $orbRoot ".orb-assistant-desktop" }
if (-not $env:ORB_SYSTEM_ROOT) { $env:ORB_SYSTEM_ROOT = Join-Path $orbRoot "system" }
if (-not $env:ORB_SHARED_MESH_ROOT) { $env:ORB_SHARED_MESH_ROOT = $defaultMeshRoot }
if (-not $env:ORB_SINGLE_INSTANCE) { $env:ORB_SINGLE_INSTANCE = "1" }
if (-not $env:ORB_PYTHON_PATH) { $env:ORB_PYTHON_PATH = "python" }
if (-not $env:ORB_ENABLE_DESKTOP_PRESENCE) { $env:ORB_ENABLE_DESKTOP_PRESENCE = "1" }
