import hashlib
import json
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional


class VaultManager:
    """
    Deterministic local vault manager used by SF_ORB_Controller.
    Provides:
    - lightning_query(stimulus)
    - crystallize(stimulus, resolved_predicate)
    - posteriori_cache (in-memory)
    """

    def __init__(self, base_path: str = "vault_system"):
        self.base_path = Path(base_path).expanduser().resolve()
        self.apriori_path = self.base_path / "apriori_core.json"
        self.posteriori_dir = self.base_path / "posteriori"
        self.posteriori_dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self.posteriori_cache: Dict[str, Any] = {}
        self.canonical_truths = self._load_apriori()

    def _load_apriori(self):
        if self.apriori_path.exists():
            try:
                payload = json.loads(self.apriori_path.read_text(encoding="utf-8"))
                return payload.get("canonical_truths", [])
            except Exception:
                return []
        return []

    def _to_stimulus_string(self, stimulus: Any) -> str:
        if isinstance(stimulus, dict):
            return json.dumps(stimulus, sort_keys=True, default=str)
        return str(stimulus)

    def _to_hash(self, stimulus: Any) -> str:
        stimulus_str = self._to_stimulus_string(stimulus)
        return hashlib.sha256(stimulus_str.encode("utf-8")).hexdigest()

    def lightning_query(self, stimulus: Any) -> Optional[Dict[str, Any]]:
        stimulus_str = self._to_stimulus_string(stimulus)
        normalized = stimulus_str.upper()

        # 1) Deterministic apriori truths
        for truth in self.canonical_truths:
            truth_id = str(truth.get("id", "")).upper()
            if truth_id and truth_id in normalized:
                return {
                    "status": "DETERMINISTIC",
                    "source": "APRIORI",
                    "predicate": truth.get("predicate"),
                }

        # 2) In-memory cache
        cached = self.posteriori_cache.get(stimulus_str)
        if cached is not None:
            return {"status": "DETERMINISTIC", "source": "POSTERIORI_CACHE", "data": cached}

        # 3) Disk posteriori
        stimulus_hash = self._to_hash(stimulus)
        p_path = self.posteriori_dir / f"{stimulus_hash}.json"
        if p_path.exists():
            try:
                data = json.loads(p_path.read_text(encoding="utf-8"))
                self.posteriori_cache[stimulus_str] = data
                return {"status": "DETERMINISTIC", "source": "POSTERIORI", "data": data}
            except Exception:
                return None

        return None

    def crystallize(self, stimulus: Any, resolved_predicate: Any):
        stimulus_str = self._to_stimulus_string(stimulus)
        stimulus_hash = self._to_hash(stimulus)
        p_path = self.posteriori_dir / f"{stimulus_hash}.json"

        with self._lock:
            p_path.parent.mkdir(parents=True, exist_ok=True)
            with p_path.open("w", encoding="utf-8") as f:
                json.dump(resolved_predicate, f, indent=2, default=str)
            self.posteriori_cache[stimulus_str] = resolved_predicate

