"""
Generates the scene's tiling textures.

They live here as code rather than as binary blobs with no source, because a
texture is a design decision and a decision that cannot be re-derived cannot be
reviewed. Run with:

    python tools/make-textures.py

Every size is a power of two: the docs cap textures at 1024 and scale anything
else down in the asset-bundle conversion.

All of these are GREYSCALE on purpose. They multiply the per-pad albedoColor,
so the colour stays in code where the palette rules can see it, and one texture
serves every pad in the tower for a single texture slot.
"""

from PIL import Image, ImageDraw
import os

SIZE = 512
OUT = os.path.join(os.path.dirname(__file__), '..', 'images', 'textures')


def slab() -> Image.Image:
    """
    A landing pad: bright rim, darker face.

    The rim is the point. In a parkour game the single most useful thing a
    platform can tell you is where its edge is, and a flat-coloured slab tells
    you nothing until you are already falling off it. The previous version had
    the contrast backwards - edge 196 against a 227 face, a 12% difference
    nobody could see.

    Bright-on-dark rather than dark-on-bright because the pads are lit from
    above by a bright sky, which washes the top face; a dark line washes out
    with it, a bright one does not.
    """
    im = Image.new('L', (SIZE, SIZE), 140)
    d = ImageDraw.Draw(im)

    rim = int(SIZE * 0.055)
    # The lip itself, full white so the albedo tint comes through at strength.
    d.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=255, width=rim)
    # A darker groove just inside it. Two edges read as a moulding rather than
    # as a sticker, and the groove is what gives the lip its thickness.
    d.rectangle([rim, rim, SIZE - 1 - rim, SIZE - 1 - rim], outline=105, width=max(2, rim // 3))

    # A very slight top-to-bottom fall across the face, so a large pad does not
    # read as a single flat fill.
    px = im.load()
    inner = rim * 2
    for y in range(inner, SIZE - inner):
        shade = int(10 * (y - inner) / max(1, SIZE - 2 * inner))
        for x in range(inner, SIZE - inner):
            px[x, y] = max(0, px[x, y] - shade)

    return im.convert('RGB')


def core() -> Image.Image:
    """
    Bark for the trunk: vertical grain, no horizontal features.

    Horizontal detail on the trunk competes with the checkpoint collars, and
    the collars are the only thing up there that carries meaning.
    """
    im = Image.new('L', (SIZE, SIZE), 190)
    d = ImageDraw.Draw(im)

    # Deterministic grain: a fixed set of strips rather than random noise, so
    # the file is byte-identical on every machine that regenerates it.
    x = 0
    step = 7
    while x < SIZE:
        width = 2 + (x * 13 % 5)
        shade = 150 + (x * 29 % 60)
        d.rectangle([x, 0, x + width, SIZE], fill=shade)
        x += width + step + (x * 7 % 5)

    return im.convert('RGB')


def ground() -> Image.Image:
    """
    The clearing floor: a soft mottle, no straight lines.

    Anything with an edge on the floor reads as a seam between two surfaces,
    and the clearing is meant to read as one continuous piece of ground.
    """
    im = Image.new('L', (SIZE, SIZE), 205)
    d = ImageDraw.Draw(im)

    # A fixed lattice of soft blotches. Same reasoning as the bark: no RNG, so
    # the output is reproducible.
    for i in range(90):
        cx = (i * 137) % SIZE
        cy = (i * 89) % SIZE
        r = 12 + (i * 17) % 26
        shade = 190 + (i * 31) % 26
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=shade)

    return im.convert('RGB')


def main() -> None:
    for name, make in (('slab', slab), ('core', core), ('ground', ground)):
        path = os.path.abspath(os.path.join(OUT, name + '.png'))
        make().save(path, optimize=True)
        print('wrote %s' % path)


if __name__ == '__main__':
    main()
