#!/usr/bin/env python3
"""
Cognitive Substrate Extractor — CALI_SUBSTRATE / R-Drive Integration
======================================================================

Extracts conversations from raw HTML chat exports and produces SKG-ready
cognitive seed vaults that CALI loads at boot as a_priori knowledge.

Output:
  R:\\CALI_SUBSTRATE\\seeds\\cognitive_seed_vault\\{category}_vault.json
  R:\\CALI_SUBSTRATE\\domain_knowledge\\cognitive_layer\\cognitive_topics.csv  (optional --csv)

Usage:
  python cognitive_substrate_extractor.py
  python cognitive_substrate_extractor.py --raw-dir R:/raw/chats --output-dir R:/CALI_SUBSTRATE/seeds/cognitive_seed_vault
  python cognitive_substrate_extractor.py --csv   # also write a substrate-compatible CSV

CALI loads the vault JSONs at boot via _load_cognitive_seed_vaults() in cali_skg.py.
Each high-relevance segment becomes an a_priori vault entry and a KG node of type
'cognitive_seed' linked to 'cali_identity' and 'vault_a_priori'.
"""

import argparse
import csv
import json
import logging
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

try:
    from bs4 import BeautifulSoup
    _BS4_AVAILABLE = True
except ImportError:
    _BS4_AVAILABLE = False
    logging.warning("beautifulsoup4 not installed — HTML parsing will use regex fallback")

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# ── Default paths ──────────────────────────────────────────────────────────────
RAW_CHAT_DIR    = Path(r"R:\raw\chats")
SEED_OUTPUT_DIR = Path(r"R:\CALI_SUBSTRATE\seeds\cognitive_seed_vault")
CSV_OUTPUT_DIR  = Path(r"R:\CALI_SUBSTRATE\domain_knowledge\cognitive_layer")


class CognitiveSubstrateExtractor:
    """
    Scans raw HTML chat exports and classifies content into 5 cognitive-layer
    categories.  Each matched conversation's high-signal segments are written to
    a structured JSON vault that CALI ingests as a_priori substrate knowledge.

    Five cognitive categories
    ─────────────────────────
    epistemology        — nature of knowledge, belief, truth, justification
    cognition           — consciousness, awareness, self-reflection, attention
    ethics_integrity    — moral reasoning, alignment, epistemic integrity
    architecture_systems— cognitive architecture, SKG, orb design, pipelines
    sovereignty_legacy  — user sovereignty, memory preservation, identity continuity
    """

    # ── Category taxonomy ──────────────────────────────────────────────────────
    COGNITIVE_CATEGORIES: dict = {
        "epistemology": {
            "keywords": [
                "epistemology", "knowledge", "truth", "belief", "justification",
                "uncertainty", "evidence", "reasoning", "fallacy", "epistemic",
                "a_priori", "a_posteriori", "empirical", "induction", "deduction",
            ],
            "phrases": [
                "nature of knowledge", "what counts as knowledge",
                "justified true belief", "epistemic warrant",
            ],
            "semantic_tags": "epistemology,knowledge_theory,belief,truth",
        },
        "cognition": {
            "keywords": [
                "cognition", "consciousness", "awareness", "reflection",
                "self-awareness", "attention", "qualia", "phenomenology",
                "perception", "metacognition", "introspection", "sentience",
            ],
            "phrases": [
                "nature of mind", "self-reflection", "conscious experience",
                "cognitive process", "subjective experience",
            ],
            "semantic_tags": "cognition,consciousness,mind,metacognition",
        },
        "ethics_integrity": {
            "keywords": [
                "ethics", "integrity", "moral", "deontology", "utilitarianism",
                "epistemic integrity", "alignment", "virtue", "obligation",
                "harm", "consent", "fairness", "accountability",
            ],
            "phrases": [
                "is it ethical", "moral reasoning", "epistemic integrity",
                "right and wrong", "do no harm",
            ],
            "semantic_tags": "ethics,integrity,moral,alignment,accountability",
        },
        "architecture_systems": {
            "keywords": [
                "architecture", "cognitive architecture", "skg",
                "semantic knowledge graph", "orb", "layer", "pipeline",
                "self-improving", "vault", "substrate", "swarm", "cali",
                "a_priori", "a_posteriori", "reasoning mode", "philosopher seed",
            ],
            "phrases": [
                "cognitive architecture", "system design", "knowledge graph",
                "reflection loop", "substrate injection", "reasoning path",
            ],
            "semantic_tags": "architecture,skg,cognitive_system,orb,pipeline",
        },
        "sovereignty_legacy": {
            "keywords": [
                "sovereignty", "legacy", "memory preservation", "identity continuity",
                "user control", "privacy", "perpetual learning", "inheritance",
                "heirloom", "preservation", "autonomy", "self-determination",
            ],
            "phrases": [
                "user sovereignty", "memory export", "legacy preservation",
                "identity continuity", "perpetual memory",
            ],
            "semantic_tags": "sovereignty,legacy,memory,identity,preservation",
        },
    }

    RELEVANCE_THRESHOLD = 8    # minimum score for inclusion
    MAX_SEGMENTS_PER_CONV = 4  # max segments extracted per conversation
    CONTEXT_SENTENCES = 2      # sentences of context around each match

    def __init__(self, raw_substrate_dir: Path = RAW_CHAT_DIR) -> None:
        self.raw_substrate_dir = Path(raw_substrate_dir)
        self.extracted_content: dict = defaultdict(list)

    # ── HTML ingestion ─────────────────────────────────────────────────────────

    def extract_from_html_file(self, html_path: Path) -> None:
        """Parse a single HTML chat export and classify its conversations."""
        logging.info("Processing %s", html_path.name)
        try:
            raw = html_path.read_text(encoding="utf-8", errors="ignore")

            if _BS4_AVAILABLE:
                conversations = self._parse_bs4(raw, html_path)
            else:
                conversations = self._parse_regex(raw, html_path)

            for conv_id, (title, text) in enumerate(conversations):
                self._analyze_conversation(title, text, str(html_path), conv_id)

        except Exception as exc:
            logging.error("Failed to process %s: %s", html_path, exc)

    def _parse_bs4(self, raw: str, html_path: Path) -> list:
        """BeautifulSoup parser — preferred path."""
        soup = BeautifulSoup(raw, "html.parser")
        divs = (
            soup.find_all("div", class_=re.compile(r"conversation|chat|message|thread"))
            or soup.find_all("div", attrs={"data-conversation-id": True})
            or [d for d in soup.find_all("div") if len(d.get_text(strip=True)) > 300]
        )

        results = []
        for i, div in enumerate(divs):
            text = div.get_text(separator="\n", strip=True)
            if len(text) < 200:
                continue
            title_elem = div.find(["h1", "h2", "h3", "title"])
            title = title_elem.get_text(strip=True) if title_elem else f"{html_path.stem}_conv_{i}"
            results.append((title, text))
        return results

    def _parse_regex(self, raw: str, html_path: Path) -> list:
        """Regex fallback when BS4 is unavailable."""
        text = re.sub(r"<[^>]+>", " ", raw)
        text = re.sub(r"\s{2,}", " ", text).strip()
        if len(text) < 200:
            return []
        return [(html_path.stem, text)]

    # ── Classification ─────────────────────────────────────────────────────────

    def _analyze_conversation(
        self, title: str, text: str, source_file: str, conv_id: int
    ) -> None:
        """Score one conversation against all five cognitive categories."""
        text_lower = text.lower()

        for category, criteria in self.COGNITIVE_CATEGORIES.items():
            kw_hits   = sum(1 for kw in criteria["keywords"] if kw in text_lower)
            ph_hits   = sum(1 for ph in criteria["phrases"]  if ph in text_lower)
            score     = kw_hits * 2 + ph_hits * 3
            if kw_hits >= 2 or ph_hits >= 1:
                score += 10  # strong cognitive signal bonus

            if score < self.RELEVANCE_THRESHOLD:
                continue

            segments = self._extract_segments(text, criteria)
            if not segments:
                continue

            self.extracted_content[category].append({
                "title": title,
                "conversation_id": f"conv_{conv_id}",
                "source_file": source_file,
                "timestamp": datetime.now().isoformat(),
                "segments": segments,
                "category": category,
                "relevance_score": score,
                "density": len(segments),
            })

    def _extract_segments(self, text: str, criteria: dict) -> list:
        """Extract context-windowed sentences containing category signals."""
        sentences = re.split(r"(?<=[.!?])\s+", text)
        matches = []

        for i, sentence in enumerate(sentences):
            s_lower = sentence.lower().strip()
            if len(s_lower) < 30:
                continue

            kw_count = sum(1 for kw in criteria["keywords"] if kw in s_lower)
            ph_count = sum(1 for ph in criteria["phrases"]  if ph in s_lower)

            if kw_count == 0 and ph_count == 0:
                continue

            start   = max(0, i - self.CONTEXT_SENTENCES)
            end     = min(len(sentences), i + self.CONTEXT_SENTENCES + 1)
            context = " ".join(sentences[start:end]).strip()

            matches.append({
                "text": context,
                "keywords_found": kw_count,
                "phrases_found":  ph_count,
                "density_score":  kw_count + ph_count * 3,
            })

        matches.sort(key=lambda x: x["density_score"], reverse=True)
        return matches[: self.MAX_SEGMENTS_PER_CONV]

    # ── Processing ─────────────────────────────────────────────────────────────

    def process_r_drive(self) -> int:
        """Recursively scan the raw chat directory for HTML files."""
        if not self.raw_substrate_dir.exists():
            logging.error("Raw substrate path not found: %s", self.raw_substrate_dir)
            return 0

        html_files = sorted(self.raw_substrate_dir.rglob("*.html"))
        logging.info("Found %d HTML files in %s", len(html_files), self.raw_substrate_dir)

        for i, html_file in enumerate(html_files):
            if i % 10 == 0 and i > 0:
                logging.info("Progress: %d / %d files processed", i, len(html_files))
            self.extract_from_html_file(html_file)

        total = sum(len(v) for v in self.extracted_content.values())
        logging.info("Extraction complete: %d total high-relevance conversations", total)
        return total

    # ── Output ─────────────────────────────────────────────────────────────────

    def save_vaults(self, output_dir: Path = SEED_OUTPUT_DIR) -> None:
        """
        Write one JSON vault per cognitive category.
        CALI loads these at boot via _load_cognitive_seed_vaults() in cali_skg.py.
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        for category, conversations in self.extracted_content.items():
            conversations_sorted = sorted(
                conversations, key=lambda x: x.get("relevance_score", 0), reverse=True
            )

            vault = {
                "category": category,
                "semantic_tags": self.COGNITIVE_CATEGORIES[category].get("semantic_tags", ""),
                "extraction_date": datetime.now().isoformat(),
                "total_conversations": len(conversations_sorted),
                "substrate_source": str(self.raw_substrate_dir),
                "conversations": conversations_sorted,
            }

            out_file = output_dir / f"{category}_vault.json"
            out_file.write_text(
                json.dumps(vault, indent=2, ensure_ascii=False), encoding="utf-8"
            )
            logging.info(
                "Saved vault: %s (%d conversations)", out_file.name, len(conversations_sorted)
            )

    def generate_substrate_csv(self, output_dir: Path = CSV_OUTPUT_DIR) -> None:
        """
        Write a substrate-compatible CSV to domain_knowledge/cognitive_layer/
        so CALI's _load_substrate_domain_knowledge() picks it up directly
        alongside the domain CSVs.

        Each row = one high-relevance conversation (top segment as description).
        """
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)

        rows = []
        for category, conversations in self.extracted_content.items():
            tags = self.COGNITIVE_CATEGORIES[category].get("semantic_tags", category)
            kw_list = ",".join(self.COGNITIVE_CATEGORIES[category]["keywords"][:6])

            for conv in conversations:
                top_segment = conv["segments"][0]["text"] if conv["segments"] else ""
                row_id = re.sub(r"[^a-z0-9_]", "_", conv["title"].lower())[:48]
                rows.append({
                    "id": f"cog_{category[:8]}_{row_id}",
                    "name": conv["title"],
                    "sequence": 0,
                    "description": top_segment[:300],
                    "unit": "None",
                    "category": f"Cognitive Layer — {category.replace('_', ' ').title()}",
                    "example_metric_or_standard": "",
                    "implications_for_assets": "",
                    "edge_case_handling": "",
                    "review_cycle": "as_needed",
                    "keywords": kw_list,
                    "semantic_tags": tags,
                    "cross_domain_links": "architecture_systems,epistemology",
                    "relevance_score": conv.get("relevance_score", 0),
                })

        if not rows:
            logging.info("No rows to write to substrate CSV")
            return

        fieldnames = [
            "id", "name", "sequence", "description", "unit", "category",
            "example_metric_or_standard", "implications_for_assets",
            "edge_case_handling", "review_cycle", "keywords",
            "semantic_tags", "cross_domain_links", "relevance_score",
        ]
        out_file = output_dir / "cognitive_topics.csv"
        with out_file.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.DictWriter(fh, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(rows)

        logging.info("Substrate CSV written: %s (%d rows)", out_file, len(rows))


def _build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Cognitive Substrate Extractor — CALI R-Drive integration"
    )
    parser.add_argument(
        "--raw-dir", type=Path, default=RAW_CHAT_DIR,
        help=f"Path to raw HTML chat exports (default: {RAW_CHAT_DIR})",
    )
    parser.add_argument(
        "--output-dir", type=Path, default=SEED_OUTPUT_DIR,
        help=f"Where to write vault JSON files (default: {SEED_OUTPUT_DIR})",
    )
    parser.add_argument(
        "--csv", action="store_true",
        help="Also write a substrate-compatible CSV to domain_knowledge/cognitive_layer/",
    )
    parser.add_argument(
        "--csv-dir", type=Path, default=CSV_OUTPUT_DIR,
        help=f"Where to write the substrate CSV (default: {CSV_OUTPUT_DIR})",
    )
    return parser


def main() -> None:
    args = _build_arg_parser().parse_args()

    extractor = CognitiveSubstrateExtractor(raw_substrate_dir=args.raw_dir)
    logging.info("Starting cognitive substrate extraction from %s", args.raw_dir)

    count = extractor.process_r_drive()
    if count == 0:
        logging.warning(
            "No content extracted. Place HTML chat exports in %s and re-run.", args.raw_dir
        )
        return

    extractor.save_vaults(output_dir=args.output_dir)

    if args.csv:
        extractor.generate_substrate_csv(output_dir=args.csv_dir)

    logging.info(
        "Done. Vaults ready at %s for CALI boot ingestion via _load_cognitive_seed_vaults().",
        args.output_dir,
    )


if __name__ == "__main__":
    main()
