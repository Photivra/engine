#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Writes site/assets/icon.svg: the letter "P" in Inter Bold on the dark ground (docs/design/engine-site.md, decision 11).

A maintainer tool, not part of the build. The letter is the glyph's outline as a path, so the icon needs no font.
Requires fontTools (`pip install fonttools==4.60.1 brotli==1.1.0`) and Inter's variable font (see make-fonts.py).

    python3 site/tools/make-icon-svg.py path/to/InterVariable.woff2
"""
import pathlib
import sys

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = pathlib.Path(__file__).resolve().parent.parent / "assets" / "icon.svg"
GROUND = "#111113"  # the dark ground token (8.2)
INK = "#F2F2F7"     # the dark ink token


def main():
    font = instancer.instantiateVariableFont(TTFont(sys.argv[1], lazy=False), {"wght": 700, "opsz": 32})
    glyphs = font.getGlyphSet()
    name = font.getBestCmap()[ord("P")]
    bounds = BoundsPen(glyphs)
    glyphs[name].draw(bounds)
    x0, y0, x1, y1 = bounds.bounds
    size = 64
    height = size * 0.62
    scale = height / (y1 - y0)
    dx = (size - (x1 - x0) * scale) / 2 - x0 * scale
    dy = (size + height) / 2 + y0 * scale
    pen = SVGPathPen(glyphs, ntos=lambda value: f"{value:.2f}".rstrip("0").rstrip("."))
    glyphs[name].draw(TransformPen(pen, (scale, 0, 0, -scale, dx, dy)))
    OUT.write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}">'
        f'<rect width="{size}" height="{size}" rx="12" fill="{GROUND}"/>'
        f'<path fill="{INK}" d="{pen.getCommands()}"/></svg>\n', encoding="utf-8")
    print(f"{OUT.name}: {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
