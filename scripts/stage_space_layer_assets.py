#!/usr/bin/env python3
"""Stage approved layered Space PNG/WebP assets without altering legacy assets.

Usage:
  python3 scripts/stage_space_layer_assets.py /path/to/eluvin_space_layered_delivery_20261009.zip

Images are copied to public/space/layered/. Manifest remains disabled: review the
room-closed image and run 390x844 browser acceptance before enabling it in PR.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent.parent
DEST = ROOT / "public" / "space" / "layered"
MAX_SIZE = 300_000
ROOM_SOURCE = "extra/room-closed.webp"
ROOM_DEST = "room-closed.webp"


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Delivered ZIP containing manifest.json and space PNGs")
    args = parser.parse_args()
    if not args.archive.is_file():
        parser.error("Asset ZIP does not exist")

    with ZipFile(args.archive) as z:
        manifest = json.loads(z.read("manifest.json"))
        if not isinstance(manifest, list):
            raise ValueError("Invalid asset manifest")
        staged: dict[str, bytes] = {}
        for entry in manifest:
            name = entry["file"]
            if not name.startswith("public/space/layered/") or not name.endswith(".png"):
                continue
            filename = Path(name).name
            if filename in staged:
                raise ValueError("Duplicate asset: " + filename)
            data = z.read(name)
            if digest(data) != entry["sha256"] or len(data) != entry["size_bytes"]:
                raise ValueError("SHA-256 / size mismatch: " + filename)
            if len(data) > MAX_SIZE or data[:8] != b"\\x89PNG\\r\\n\\x1a\\n" or data[25] != 6:
                raise ValueError("Expected <=300KB true RGBA PNG: " + filename)
            staged[filename] = data
        if len(staged) != 28:
            raise ValueError(f"Expected 28 transparent cutouts; found {len(staged)}")
        if ROOM_SOURCE not in z.namelist():
            raise ValueError("Missing reviewed closed-drawer source " + ROOM_SOURCE)
        room = z.read(ROOM_SOURCE)
        if len(room) > MAX_SIZE or room[:4] != b"RIFF" or room[8:12] != b"WEBP":
            raise ValueError("Closed scene must be a local <=300KB WebP")
        staged[ROOM_DEST] = room

    DEST.mkdir(parents=True, exist_ok=True)
    for name, data in staged.items():
        dst = DEST / name
        if dst.is_file():
            if digest(dst.read_bytes()) != digest(data):
                raise FileExistsError("Refusing to overwrite an existing different asset: " + str(dst))
            continue
        fd, temp = tempfile.mkstemp(prefix=".space-", dir=DEST)
        try:
            with os.fdopen(fd, "wb") as out:
                out.write(data)
            os.replace(temp, dst)
        finally:
            if os.path.exists(temp):
                os.unlink(temp)
    print(f"Staged {len(staged)} verified files in {DEST.relative_to(ROOT)}")
    print("Manifest stays disabled. Do not enable until visual comparison, drawer motion and real App browser checks pass.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, FileExistsError, KeyError) as exc:
        print("Asset staging rejected:", exc, file=sys.stderr)
        sys.exit(1)
