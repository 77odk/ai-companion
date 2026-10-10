#!/usr/bin/env python3
"""Pixel-faithful G0-A E/C drawer candidates. Local art tooling, not app runtime.

Source E is the user-approved 941x1672 drawer image. C is the original
deeper-open variant. Never edit existing public/ assets, never upscale.
Outputs are candidates only; manifest.artApproved stays false until visual QA.
Pillow is an offline authoring tool, not an npm/runtime dependency.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from g0a_extract_e_drawer import extract as extract_e
from g0a_extract_c_drawer_depth import extract_c_reference

ORIGINALS = {
    "E": "f772bab67fd89bd6284909ad3c2fe30c576da917dfb4a15dad21f1bc94a9cd56",
    "C": "ffcc66ab9943c31a319dfdc805a2e2e406b2065b63326cc82873bf34cfe71454",
}
SIZES = {"E": (481, 243), "C": (506, 210)}
MIN_WEBP_BYTES = {"E": 12_000, "C": 20_000}
MAX_FILE_BYTES = 300_000


def sha256(file: Path) -> str:
    return hashlib.sha256(file.read_bytes()).hexdigest()


def export(source_e: Path, source_c: Path, destination: Path) -> dict:
    from PIL import Image, ImageChops, ImageStat
    if "public" in destination.parts or destination.exists():
        raise ValueError("Write only to a new candidate directory outside public/")
    source_paths = {"E": source_e, "C": source_c}
    for label, src in source_paths.items():
        if sha256(src) != ORIGINALS[label]:
            raise ValueError(f"{label} source hash differs from approved native reference")

    destination.mkdir(parents=True, exist_ok=False)
    results = {}
    for label, src in source_paths.items():
        name = "e_drawer_hq_v2" if label == "E" else "c_drawer_depth_hq_v2"
        png = destination / (name + ".png")
        webp = destination / (name + ".webp")
        if label == "E":
            extract_e(src, png)
        else:
            extract_c_reference(src, png)
        with Image.open(png) as loaded:
            original = loaded.convert("RGBA")
        assert original.size == SIZES[label], "Unexpected source crop dimensions"
        original.save(webp, format="WEBP", quality=96, method=6, exact=True)
        with Image.open(webp) as loaded:
            encoded = loaded.convert("RGBA")

        # Alpha must survive compression byte-for-byte: no accidental opaque
        # rectangles that would repaint the fixed desk or the photo wall.
        if ImageChops.difference(original.getchannel("A"), encoded.getchannel("A")).getbbox():
            raise ValueError(f"{label} WebP transparency was altered")
        opaque = original.getchannel("A").point(lambda a: 255 if a == 255 else 0)
        diff = ImageChops.difference(original.convert("RGB"), encoded.convert("RGB"))
        rgb_mae = sum(ImageStat.Stat(diff, mask=opaque).mean) / 3
        if rgb_mae > 4.0:
            raise ValueError(f"{label} WebP changed opaque source colors: {rgb_mae:.3f}")
        if not (MIN_WEBP_BYTES[label] <= webp.stat().st_size <= MAX_FILE_BYTES):
            raise ValueError(f"{label} compressed asset fails quality/size proxy")
        if png.stat().st_size > MAX_FILE_BYTES:
            raise ValueError(f"{label} PNG exceeds 300KB")
        extrema = original.getchannel("A").getextrema()
        if extrema != (0, 255):
            raise ValueError(f"{label} is not a genuine alpha sprite")
        results[label] = {
            "source_sha256": ORIGINALS[label],
            "source_filename": src.name,
            "pixel_size": list(original.size),
            "png_bytes": png.stat().st_size,
            "webp_bytes": webp.stat().st_size,
            "png_sha256": sha256(png),
            "webp_sha256": sha256(webp),
            "opaque_rgb_mean_abs_error": round(rgb_mae, 4),
            "alpha_exact": True,
            "visual_approval": False,
        }
    audit = {
        "coordinate_world": [941, 1672],
        "fixed_desk_reference": "E",
        "inner_depth_reference": "C",
        "no_original_images_modified": True,
        "no_resolution_upscaling": True,
        "status": "G0-A_CANDIDATE_NOT_APPROVED",
        "outputs": results,
    }
    (destination / "fidelity.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n")
    return audit


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--e", type=Path, required=True, help="Exact approved E original")
    parser.add_argument("--c", type=Path, required=True, help="Exact C deeper-open original")
    parser.add_argument("--out", type=Path, required=True, help="New candidate directory, never public/")
    args = parser.parse_args()
    print(json.dumps(export(args.e, args.c, args.out), ensure_ascii=False, indent=2))
