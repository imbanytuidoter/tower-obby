"""
The 480x480 mark for the submission profile.

Drawn rather than screenshotted: at the size a listing shows it, a screenshot
of the tower is a grey smudge with a HUD across it. A mark has to survive being
48 pixels wide, so this is four shapes - trunk, slabs, crown, glow - in the
scene's own palette, taken from src/game/palette.ts and config.ts so the logo
cannot drift from the game it stands for.

The first version put a wide gold disc on a brown stalk and read as a MUSHROOM
at small sizes. The crown is smaller now and the slabs narrow as they rise, so
the silhouette says height and climbing rather than fungus.

Supersampled 4x and resampled down: the client renders anti-aliased, and a
hard-edged logo beside it looks like a different product.
"""
from PIL import Image, ImageDraw, ImageChops, ImageFilter

S = 4
W = 480 * S

BARK        = (0x7A, 0x65, 0x53)
BARK_DARK   = (0x5C, 0x4B, 0x3E)
CANOPY_NEAR = (0x3D, 0x52, 0x40)
CANOPY_DEEP = (0x21, 0x2E, 0x24)
SAFE        = (0x4E, 0xE3, 0xF2)
SAFE_SIDE   = (0x2B, 0x9C, 0xAA)
UNSTABLE    = (0xD2, 0x65, 0x1A)
UNSTABLE_SD = (0x93, 0x45, 0x10)
GOAL        = (0xFF, 0xD2, 0x3F)
GOAL_SIDE   = (0xC2, 0x99, 0x1E)

img = Image.new("RGB", (W, W), CANOPY_DEEP)
d = ImageDraw.Draw(img)
for y in range(W):
    t = 1 - y / W
    c = tuple(int(CANOPY_DEEP[i] + (CANOPY_NEAR[i] - CANOPY_DEEP[i]) * t ** 1.5)
              for i in range(3))
    d.line([(0, y), (W, y)], fill=c)

# Light above the crown, so the eye is pulled up the way a climber is.
halo = Image.new("RGB", (W, W), (0, 0, 0))
ImageDraw.Draw(halo).ellipse(
    [W * 0.5 - W * 0.26, W * 0.155 - W * 0.26,
     W * 0.5 + W * 0.26, W * 0.155 + W * 0.26], fill=(58, 46, 12))
img = ImageChops.add(img, halo.filter(ImageFilter.GaussianBlur(W * 0.055)))
d = ImageDraw.Draw(img)

# The trunk, tapered the way the real one is: setCylinder(0.5, 0.28).
TOP, BOT = W * 0.225, W * 0.97
half_bot, half_top = W * 0.068, W * 0.036
d.polygon([(W / 2 - half_bot, BOT), (W / 2 + half_bot, BOT),
           (W / 2 + half_top, TOP), (W / 2 - half_top, TOP)], fill=BARK)
d.polygon([(W / 2, BOT), (W / 2 + half_bot, BOT),
           (W / 2 + half_top, TOP), (W / 2, TOP)], fill=BARK_DARK)

# Slabs climbing around it, narrowing with height so the mark reads as depth
# rather than a ladder. Two are rust: the tower is not all safe ground.
SLABS = [(-1, 0.910), (1, 0.833), (-1, 0.756), (1, 0.679),
         (-1, 0.602), (1, 0.525), (-1, 0.448), (1, 0.371), (-1, 0.294)]
RUST = {2, 6}
for i, (side, y) in enumerate(SLABS):
    k = (0.910 - y) / (0.910 - 0.294)          # 0 at the foot, 1 at the top
    scale = 1.0 - 0.34 * k
    w, h = W * 0.132 * scale, W * 0.030 * scale
    cx = W / 2 + side * W * 0.128 * scale
    cy = W * y
    face, edge = (UNSTABLE, UNSTABLE_SD) if i in RUST else (SAFE, SAFE_SIDE)
    d.rounded_rectangle([cx - w, cy - h, cx + w, cy + h * 0.75],
                        radius=h * 0.55, fill=edge)
    d.rounded_rectangle([cx - w, cy - h, cx + w, cy + h * 0.10],
                        radius=h * 0.55, fill=face)

# The crown: the object of the game, and the only gold in the mark.
cw, ch = W * 0.132, W * 0.036
cx, cy = W / 2, W * 0.205
d.ellipse([cx - cw, cy - ch * 0.45, cx + cw, cy + ch * 1.30], fill=GOAL_SIDE)
d.ellipse([cx - cw, cy - ch, cx + cw, cy + ch], fill=GOAL)

img.filter(ImageFilter.SMOOTH).resize((480, 480), Image.LANCZOS).save(
    "images/buidl-logo.png", optimize=True)
print("images/buidl-logo.png written")
