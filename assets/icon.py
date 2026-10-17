# Renders the app icons: a 96-step day-ahead "duck curve" on two axes.
# Usage (needs matplotlib): python icon.py   → writes icon.png, splash-icon.png, favicon.png next to this file
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image

TRACE, AXIS = '#E11D48', '#1F2937'  # rose-600, slate-800
here = Path(__file__).parent

# Real Belgian day-ahead prices (ENTSO-E) for 17 Oct 2026, €/MWh per quarter-hour: a duck curve.
price = [211, 209, 202, 189, 201, 189, 182, 174, 178, 174, 167, 160, 157, 154, 151, 149, 149, 148, 148, 148, 152, 152, 147, 146,
         147, 150, 152, 157, 160, 165, 171, 177, 192, 193, 192, 181, 182, 173, 171, 164, 175, 161, 161, 144, 148, 125, 119, 113,
         117, 109, 109, 101, 107, 97, 94, 90, 97, 98, 106, 105, 111, 110, 115, 116, 116, 120, 130, 160, 143, 185, 193, 210,
         205, 213, 222, 242, 251, 249, 242, 221, 219, 203, 201, 202, 216, 207, 194, 185, 187, 173, 182, 166, 166, 164, 166, 159]
assert len(price) == 96

fig = plt.figure(figsize=(4, 4), dpi=256, facecolor='white')  # 1024 px
ax = fig.add_axes((0.17, 0.17, 0.70, 0.66))
ax.axis('off')
# One step per quarter-hour; repeat the last value so the 96th step gets its width.
ax.step(range(97), price + price[-1:], where='post', color=TRACE, lw=1.6, solid_joinstyle='miter', solid_capstyle='butt')
ax.set_xlim(0, 96)  # first quarter-hour starts on the y axis
lo, hi = min(price), max(price)
ax.set_ylim(lo - 0.25 * (hi - lo), hi + 0.08 * (hi - lo))

# Axes as arrows from the corner, so it reads as a graph even at home-screen size.
ox, oy = ax.get_xlim()[0], ax.get_ylim()[0]
arrow = dict(arrowstyle='-|>,head_length=0.6,head_width=0.3', color=AXIS, lw=3, capstyle='round', shrinkA=0, shrinkB=0)
ax.annotate('', xy=(ox, ax.get_ylim()[1] + 0.12 * (hi - lo)), xytext=(ox, oy), annotation_clip=False, arrowprops=arrow)
ax.annotate('', xy=(ax.get_xlim()[1] + 6, oy), xytext=(ox, oy), annotation_clip=False, arrowprops=arrow)

fig.savefig(here / 'icon.png', facecolor='white')
icon = Image.open(here / 'icon.png').convert('RGB')  # Apple rejects alpha
icon.save(here / 'icon.png')
icon.save(here / 'splash-icon.png')
icon.resize((48, 48), Image.LANCZOS).save(here / 'favicon.png')
