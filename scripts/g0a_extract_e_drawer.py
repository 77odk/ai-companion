#!/usr/bin/env python3
"""Offline E-drawer extraction. Only work on a verified 941×1672 E original.

This is a candidate generator, NOT an accepted product asset. Existing public/
assets must never be overwritten. Pillow is an optional local art tool, not an
app/npm dependency.
"""
from __future__ import annotations

import argparse
from pathlib import Path

EXPECTED_SIZE = (941, 1672)
CROP = (460, 1429, 941, 1672)  # exact E-art source pixel coordinates
# Conservative cutout of the actual envelope/front. Do not trace the desk apron,
# chair or fabricated unseen drawer depth.
POLYGON = (
    (466, 1454), (481, 1449), (500, 1448), (575, 1462),
    (720, 1492), (940, 1541), (940, 1671), (867, 1671),
    (800, 1653), (650, 1617), (535, 1588), (466, 1569),
)
LIMIT_BYTES = 300_000

def extract(source: Path, destination: Path) -> dict:
    from PIL import Image, ImageDraw, ImageFilter
    if destination.exists():
        raise FileExistsError(f"Refusing to overwrite any existing asset: {destination}")
    with Image.open(source) as original:
        if original.size != EXPECTED_SIZE:
            raise ValueError(f"Expected E original {EXPECTED_SIZE}; found {original.size}")
        artwork = original.convert("RGBA")
    x0, y0, x1, y1 = CROP
    layer = artwork.crop(CROP)
    alpha = Image.new("L", layer.size, 0)
    draw = ImageDraw.Draw(alpha)
    draw.polygon([(x - x0, y - y0) for x, y in POLYGON], fill=255)
    alpha = alpha.filter(ImageFilter.GaussianBlur(radius=0.65))
    layer.putalpha(alpha)
    destination.parent.mkdir(parents=True, exist_ok=True)
    layer.save(destination, format="PNG", optimize=True)
    if destination.stat().st_size > LIMIT_BYTES:
        destination.unlink()
        raise ValueError("PNG exceeds 300 KB size budget; no asset retained")
    transparent = sum(v == 0 for v in alpha.getdata())
    opaque = sum(v == 255 for v in alpha.getdata())
    if not transparent or not opaque:
        destination.unlink()
        raise ValueError("Candidate must contain both empty and visible pixels")
    return {
        "size": layer.size,
        "bytes": destination.stat().st_size,
        "transparent_pixels": transparent,
        "opaque_pixels": opaque,
        "status": "EXPERIMENT_ONLY",
    }

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True,
                        help="Approved E original local image (never bundled)")
    parser.add_argument("--output", type=Path, required=True,
                        help="New filename outside existing public assets")
    args = parser.parse_args()
    print(extract(args.source, args.output))
