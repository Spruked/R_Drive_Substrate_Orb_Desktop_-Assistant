# ORB Mesh

Shared knowledge and task plane for sovereign ORB instances.

Principles
- Each ORB keeps its own local memory and system state.
- Only selected artifacts are published here.
- Imports are pull-based and checkpointed.
- Tasks and results are append-only, source-tagged artifacts.

Core folders
- `exports/`: high-value artifacts published by each ORB
- `imports/`: per-ORB import staging and receipts
- `tasks/`: task handoff queues
- `results/`: task outcomes and shared synthesis
- `promoted_knowledge/`: curated cross-ORB knowledge promoted above raw exports
- `checkpoints/`: per-ORB sync cursors and receipts
- `locks/`: optional cooperative file locks
- `audit/`: mesh activity and sync logs
