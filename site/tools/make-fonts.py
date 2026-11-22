#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Makes the site's two Inter subsets (a maintainer tool, not part of the build).

The outputs are committed in site/assets/fonts/, so the site build needs no font tooling. Run this again only when
site/assets/fonts/charset.txt or the Inter version changes; `node site/checks/fonts.mjs` lists the characters the built
pages use that the subset lacks.

Requires fontTools and brotli (`pip install fonttools==4.60.1 brotli==1.1.0`) and the Inter 4.1 variable font
(InterVariable.woff2, from the Inter release or the inter-ui npm package's variable/ folder; its licence is
site/assets/fonts/OFL.txt, recorded in THIRD_PARTY.md).

    python3 site/tools/make-fonts.py path/to/InterVariable.woff2 [path/to/Arial.ttf]

Writes inter-400.woff2 (weight 400, the body text, preloaded) and inter-600-700.woff2 (weights 600 to 700, a variable
range, for headings and labels). Both keep the font's copyright, license and version names. Given Arial too, it prints the
fallback face's size-adjust and ascent and descent overrides for site/styles/site.css, so the swap to Inter moves nothing.
"""
import pathlib
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONTS = pathlib.Path(__file__).resolve().parent.parent / "assets" / "fonts"


def code_points():
    """The code points of charset.txt up to its "# Not in Inter" line (those fall back to the system font)."""
    points = []
    for line in (FONTS / "charset.txt").read_text(encoding="utf-8").splitlines():
        if line.lower().startswith("# not in inter"):
            break
        for item in line.split("#", 1)[0].split():
            first, _, last = item.removeprefix("U+").partition("-")
            start = int(first, 16)
            end = int(last.removeprefix("U+"), 16) if last else start
            points.extend(range(start, end + 1))
    return points


def make(source, limits, name):
    font = TTFont(source, lazy=False)
    options = subset.Options()
    options.flavor = "woff2"
    options.hinting = False
    options.desubroutinize = True
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    options.name_languages = [0x409]
    options.layout_features = ["kern", "liga", "calt", "ccmp", "locl", "mark", "mkmk", "case", "sups", "subs"]
    subsetter = subset.Subsetter(options)
    wanted = code_points()
    subsetter.populate(unicodes=wanted)
    subsetter.subset(font)
    # Subset first, then pin the axes: instancing a partial weight range before subsetting fails in fontTools 4.60.1.
    font = instancer.instantiateVariableFont(font, limits)
    cmap = font.getBestCmap()
    missing = [point for point in wanted if point not in cmap]
    font.flavor = "woff2"
    out = FONTS / name
    font.save(out)
    print(f"{name}: {out.stat().st_size} bytes; characters not in Inter (system font instead): "
          + (" ".join(f"U+{point:04X}" for point in missing) or "none"))


def fallback_metrics(inter_path, arial_path):
    def average_width(font):
        cmap, metrics = font.getBestCmap(), font["hmtx"]
        widths = [metrics[cmap[ord(c)]][0] for c in "abcdefghijklmnopqrstuvwxyz "]
        return sum(widths) / len(widths) / font["head"].unitsPerEm

    inter = instancer.instantiateVariableFont(TTFont(inter_path), {"wght": 400, "opsz": 14})
    ratio = average_width(inter) / average_width(TTFont(arial_path))
    em = inter["head"].unitsPerEm
    print(f"size-adjust: {ratio * 100:.2f}%; ascent-override: {inter['hhea'].ascent / em / ratio * 100:.2f}%; "
          f"descent-override: {-inter['hhea'].descent / em / ratio * 100:.2f}%; line-gap-override: 0%")


def main():
    source = sys.argv[1]
    axes = {axis.axisTag for axis in TTFont(source)["fvar"].axes}
    optical = {"opsz": 14} if "opsz" in axes else {}
    make(source, {"wght": 400, **optical}, "inter-400.woff2")
    make(source, {"wght": (600, 700), **optical}, "inter-600-700.woff2")
    if len(sys.argv) > 2:
        fallback_metrics(source, sys.argv[2])


if __name__ == "__main__":
    main()
