#!/usr/bin/env python3
"""Extract the hidden-depth C drawer reference without modifying the E desk.

Run offline with a user-owned native 941x1672 C reference image. This is a
visual exploration, NOT a production-accepted sprite or image replacement.
Existing public images are read-only; output names must be new.
"""
from __future__ import annotations
import argparse
from pathlib import Path

SOURCE_DIMENSIONS = (941, 1672)
CROP = (435, 1325, 941, 1535)  # only the 210px exposed inner depth
C_SILHOUETTE = (
    (441, 1424), (492, 1368), (515, 1332), (538, 1327),
    (648, 1350), (821, 1373), (940, 1398),
    (940, 1671), (441, 1606),
)
MAX_BYTES = 300_000


def extract_c_reference(source: Path, destination: Path) -> dict:
    from PIL import Image, ImageDraw, ImageFilter
    if destination.exists():
        raise FileExistsError(f"Never overwrite existing artwork: {destination}")
    if "public" in destination.parts:
        raise ValueError("Candidate-only export must not write to public")
    with Image.open(source) as raw:
        if raw.size != SOURCE_DIMENSIONS:
            raise ValueError("Native C reference must be exactly 941x1672")
        artwork = raw.convert("RGBA")
    x0, y0, x1, y1 = CROP
    drawer = artwork.crop(CROP)
    mask = Image.new("L", drawer.size, 0)
    brush = ImageDraw.Draw(mask)
    brush.polygon([(x - x0, y - y0) for x, y in C_SILHOUETTE], fill=255)
    drawer.putalpha(mask.filter(ImageFilter.GaussianBlur(.7)))
    destination.parent.mkdir(parents=True, exist_ok=True)
    drawer.save(destination, "PNG", optimize=True)
    if destination.stat().st_size > MAX_BYTES:
        destination.unlink()
        raise ValueError("Candidate exceeds 300 KB; not retained")
    if drawer.getchannel("A").getextrema() != (0, 255):
        destination.unlink()
        raise ValueError("Missing proper transparent and opaque areas")
    return {
        "dimensions": drawer.size,
        "bytes": destination.stat().st_size,
        "status": "EXPERIMENT_ONLY_NOT_VISUALLY_APPROVED",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(extract_c_reference(args.source, args.output))
