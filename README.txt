CALI / UCM Data Drive
=====================

Role
- Preserve-first offline cache and research substrate for CALI.
- Long-term data plane for high-value public datasets, mirrors, indexes, embeddings, and registry exports.
- Fallback substrate when APIs are slow, down, rate-limited, or changed.
- Durable memory layer for Cali-centered research continuity.

Current state
- The drive now contains both the original data-plane scaffold and the ORB mesh scaffold.
- `R:\manifests` remains the main populated research metadata area.
- `R:\orb_mesh` now exists as the shared publish/subscribe bridge between sovereign ORB instances.
- `R:\Orb_Assistant_Desktop` now exists as a separate desktop ORB runtime copy with its own local state and CALI system root.
- The website orb now has server-side mesh access as a third `web` instance when the `spruked.com` site is running locally in WSL.

Why this drive matters
- Full local mirrors beat fragile API-only workflows.
- Local indexes and embeddings reduce latency and improve cross-reference speed.
- Snapshots, manifests, and registry exports make the system reproducible.
- CALI can correlate local and online sources instead of depending on either one alone.

Core capabilities
- Offline research cache
- Bulk public dataset mirrors
- Geospatial tile caching
- Embeddings and vector search
- Cross-reference indexes and entity graphs
- Snapshotting and registry export
- Compression, dedupe, sharding, and retrieval

Top-level folders
- api_cache: raw and normalized API responses
- datasets: bulk public data mirrors and curated local corpora
- embeddings: semantic embeddings by domain and source family
- indexes: search indexes, lookup tables, and cross-reference structures
- logs: ingestion, sync, and audit logs
- manifests: drive manifests, source registries, category registries, and build plans
- orb_mesh: shared knowledge, task, result, and checkpoint plane for sovereign ORBs
- Orb_Assistant_Desktop: separate desktop-side ORB instance rooted on `R:\`
- registry_exports: exported metadata, catalogs, and shareable registries
- snapshots: dated point-in-time captures of important datasets and indexes
- tiles: geospatial and visualization tile caches
- vector_indexes: vector database artifacts and nearest-neighbor search structures

Folder notes
- `datasets\\bulk_mirrors` is the preferred home for large mirrored public sources.
- This drive is primarily the data plane, not the primary code plane.
- Registry metadata may continue to reference `C:\dev\registry\apis` where appropriate.
- Live products like True Mark remain separate unless explicitly mirrored here for research reasons.

Orb Assistant placement guidance
- The primary forge copy should still live on the Linux filesystem for the best WSL development performance.
- `R:\` is now being used for three ORB-specific roles:
- `R:\orb_mesh` is the shared substrate for exports, imports, tasks, results, checkpoints, and promoted knowledge.
- `R:\Orb_Assistant_Desktop` is a sovereign desktop runtime copy with its own identity and local state.
- The `spruked.com` website orb can also connect to the same mesh as a third `web` instance through server-side access.
- Under WSL, active code on `/mnt/r` is still slower than code on the Linux filesystem because mounted Windows drives are worse for many small file operations, dependency installs, indexing, and file watching.
- The desktop runtime copy on `R:\` is appropriate as a separate integrated system instance, not as the preferred home for the WSL development forge.
- Native Windows launch requires a Windows-side Node/Python runtime or packaging; the current scaffold includes launch metadata and a PowerShell launcher path, but it does not eliminate that dependency by itself.

ORB mesh layout
- `R:\orb_mesh\exports\wsl`, `R:\orb_mesh\exports\desktop`, and `R:\orb_mesh\exports\web` for selective high-value artifact publication
- `R:\orb_mesh\imports\wsl`, `R:\orb_mesh\imports\desktop`, and `R:\orb_mesh\imports\web` for pulled cross-ORB artifacts
- `R:\orb_mesh\tasks\wsl_to_desktop`, `R:\orb_mesh\tasks\desktop_to_wsl`, `R:\orb_mesh\tasks\web_to_wsl`, `R:\orb_mesh\tasks\web_to_desktop`, `R:\orb_mesh\tasks\wsl_to_web`, `R:\orb_mesh\tasks\desktop_to_web`, and `R:\orb_mesh\tasks\broadcast` for inter-ORB task handoff
- `R:\orb_mesh\results\wsl`, `R:\orb_mesh\results\desktop`, `R:\orb_mesh\results\web`, and `R:\orb_mesh\results\shared` for result publication
- `R:\orb_mesh\checkpoints` for sync receipts and import state
- `R:\orb_mesh\promoted_knowledge` for curated cross-ORB memory above raw exports
- `R:\orb_mesh\audit` for append-only mesh activity logs

Policies
- Preserve-first: avoid deletion or major cleanup without explicit confirmation.
- Prefer manifest-driven storage so future sessions can rebuild context fast.
- Keep naming stable and obvious.
- Archive before replacing when practical.

Rebuilt manifests
- `R:\manifests\cali_research_substrate.json`
- `R:\manifests\machine_learning.json`
- `R:\manifests\advanced_categories_registry.json`

Recovered API registry artifacts
- `R:\manifests\top_200_public_research_apis_batch_01.md`
- `R:\manifests\top_200_public_research_apis_batch_02.md`
- `R:\manifests\top_200_public_research_apis_batch_03.md`
- `R:\manifests\top_200_public_research_apis_batch_04.md`
- `R:\manifests\top_200_public_research_apis_registry.partial.json`
- `R:\manifests\top_200_public_research_apis_registry.full.json`
- `R:\manifests\top_200_public_research_apis_registry.by_domain.json`
- Current recovery state: full rebuild complete
- Registry total: 200 recovered APIs across the rebuilt registry set
- Note: `partial` is currently retained as a continuity artifact even though the `full` registry also exists
