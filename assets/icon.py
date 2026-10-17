# Renders the app icons: a 96-step day-ahead "duck curve" on two axes.
# Usage (needs matplotlib): python icon.py   → writes icon.png, splash-icon.png, favicon.png next to this file
import math
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from PIL import Image

TRACE, AXIS = '#E11D48', '#1F2937'  # rose-600, slate-800
here = Path(__file__).parent

# Duck curve in €/MWh: flat night, morning peak, negative solar dip at noon, tall evening peak.
g = lambda h, mu, sd: math.exp(-((h - mu) / sd) ** 2 / 2)
price = [90 + 55 * g(h, 8, 1.3) - 125 * g(h, 13.25, 2.2) + 150 * g(h, 19.5, 1.5) for h in (i / 4 + 0.125 for i in range(96))]
assert len(price) == 96 and min(price) < 0 < max(price)

fig = plt.figure(figsize=(4, 4), dpi=256, facecolor='white')  # 1024 px
ax = fig.add_axes((0.19, 0.19, 0.64, 0.62))
ax.axis('off')
# One step per quarter-hour; repeat the last value so the 96th step gets its width.
ax.step(range(97), price + price[-1:], where='post', color=TRACE, lw=3.2, solid_joinstyle='miter', solid_capstyle='butt')
ax.set_xlim(-6, 100)
lo, hi = min(price), max(price)
ax.set_ylim(lo - 0.12 * (hi - lo), hi + 0.06 * (hi - lo))

# Axes as arrows from the corner, so it reads as a graph even at home-screen size.
ox, oy = ax.get_xlim()[0], ax.get_ylim()[0]
arrow = dict(arrowstyle='-|>,head_length=0.9,head_width=0.45', color=AXIS, lw=6, capstyle='round', shrinkA=0, shrinkB=0)
ax.annotate('', xy=(ox, ax.get_ylim()[1] + 0.12 * (hi - lo)), xytext=(ox, oy), annotation_clip=False, arrowprops=arrow)
ax.annotate('', xy=(ax.get_xlim()[1] + 8, oy), xytext=(ox, oy), annotation_clip=False, arrowprops=arrow)

fig.savefig(here / 'icon.png', facecolor='white')
icon = Image.open(here / 'icon.png').convert('RGB')  # Apple rejects alpha
icon.save(here / 'icon.png')
icon.save(here / 'splash-icon.png')
icon.resize((48, 48), Image.LANCZOS).save(here / 'favicon.png')
