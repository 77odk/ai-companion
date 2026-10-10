#!/usr/bin/env python3
"""G0-A full room ART preflight, no fabricated photos or user content.

The content-clean plate already contains the original empty jar, blank book,
blank tablet, wired earphones and decorations in their source positions.
Never superimpose the historical cutouts onto these same objects a second time.
The real user photos, personal memories and live music are not fabricated or copied.
This STATIC review is not authenticated App QA or a foliage-motion test; use
space_v2_component_review.mjs/.py for the actual component interaction review.
"""
from __future__ import annotations
import argparse
from pathlib import Path
import g0a_full_layer_preview as drawer


def run(root: Path, output: Path) -> int:
    original_stages = drawer.STAGES
    try:
        drawer.STAGES=(0,0.5,1.0)
        return drawer.run_chrome_cli(root, output)
    finally:
        drawer.STAGES = original_stages


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(run(args.repo.resolve(), args.out.resolve()))
