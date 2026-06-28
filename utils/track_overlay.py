"""
Track minimap + lap board overlay for the SERVER-SIDE video-editor export.

Mirrors the client logic in static/js/video-editor.js (buildTrackMap / detectLaps /
computeAveragedPath / drawTrackMap / drawLapTimer) so the FFmpeg-composited export
looks identical to the in-browser preview / Local Export.

Public API:
    prepare_track_overlay(vbo_path, gate_lat, gate_lon, settings) -> dict | None
    draw_track_overlay(img, W, H, settings, track, video_time,
                       vbo_time_offset, vbo_trim_start, vbo_trim_end) -> None
"""
import math
import re
import logging
from PIL import Image, ImageDraw, ImageFont

GATE_T = 0.03            # gate capture radius in normalized track units (~7m on 230m)
NAV_WINDOW_M = 250       # metres shown across the navigator box (non-circuit rides)
_BOLD_FONT = 'fonts/sf-ui-display-bold.otf'
_REG_FONT = 'fonts/sf-ui-display-regular.otf'
_font_cache = {}


def _font(size, bold=True):
    size = max(6, int(size))
    key = (size, bold)
    if key not in _font_cache:
        try:
            _font_cache[key] = ImageFont.truetype(_BOLD_FONT if bold else _REG_FONT, size)
        except Exception:
            _font_cache[key] = ImageFont.load_default()
    return _font_cache[key]


# ---------- parsing ----------
def _parse(vbo_path):
    cols = []
    in_data = False
    want_cols = False
    kmh = False
    data = []
    first_t = None
    try:
        with open(vbo_path, 'r', errors='ignore') as f:
            lines = f.read().split('\n')
    except OSError:
        return None
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        low = s.lower()
        if 'velocity kmh' in low or 'velocity km' in low:
            kmh = True
        if s in ('[column names]', '[columns]'):
            want_cols = True
            continue
        if want_cols:
            cols = [c.lower() for c in s.split()]
            want_cols = False
            continue
        if s == '[data]':
            in_data = True
            continue
        if s.startswith('[') and s.endswith(']'):
            if in_data:
                break
            continue
        if not in_data or not cols:
            continue
        p = s.split()
        if len(p) < len(cols):
            continue
        row = {cols[j]: p[j] for j in range(len(cols))}
        ts = row.get('time', '')
        if len(ts) < 6:
            continue
        try:
            t = int(ts[0:2]) * 3600 + int(ts[2:4]) * 60 + float(ts[4:])
        except ValueError:
            continue
        if first_t is None:
            first_t = t
        try:
            lat = float(row.get('lat', row.get('latitude', 'nan'))) / 60.0
        except ValueError:
            lat = None
        try:
            lon = -float(row.get('long', row.get('longitude', row.get('lon', 'nan')))) / 60.0
        except ValueError:
            lon = None
        try:
            v = float((row.get('velocity', row.get('speed', '0')) or '0').replace(',', '.'))
        except ValueError:
            v = 0.0
        if not kmh:
            v *= 1.852
        data.append({'t': t - first_t, 'lat': lat, 'lon': lon, 'speed': v})
    return data if len(data) >= 2 else None


# ---------- projection ----------
def _project(data):
    lat0 = lon0 = None
    for p in data:
        if p['lat'] is not None and p['lon'] is not None:
            lat0, lon0 = p['lat'], p['lon']
            break
    if lat0 is None:
        return None
    cos_lat = math.cos(lat0 * math.pi / 180.0)
    MPD = 111320.0
    min_x = min_y = float('inf')
    max_x = max_y = float('-inf')
    for p in data:
        if p['lat'] is None:
            p['_gx'] = None
            continue
        gx = (p['lon'] - lon0) * cos_lat * MPD
        gy = (p['lat'] - lat0) * MPD
        p['_gx'], p['_gy'] = gx, gy
        min_x = min(min_x, gx); max_x = max(max_x, gx)
        min_y = min(min_y, gy); max_y = max(max_y, gy)
    range_x = max(1e-6, max_x - min_x)
    range_y = max(1e-6, max_y - min_y)
    scale = 1.0 / max(range_x, range_y)
    off_x = (1 - range_x * scale) / 2
    off_y = (1 - range_y * scale) / 2
    last_mx = last_my = 0.5
    for p in data:
        if p.get('_gx') is None:
            p['mx'], p['my'] = last_mx, last_my
            continue
        nx = off_x + (p['_gx'] - min_x) * scale
        ny = off_y + (p['_gy'] - min_y) * scale
        p['mx'] = nx
        p['my'] = 1 - ny
        last_mx, last_my = p['mx'], p['my']
    # closed-loop detection
    a = next((p for p in data if p['lat'] is not None), None)
    b = next((p for p in reversed(data) if p['lat'] is not None), None)
    closed = False
    if a and b and a is not b:
        diag = math.sqrt(range_x * range_x + range_y * range_y)
        R = 6371000.0
        d_lat = (b['lat'] - a['lat']) * math.pi / 180
        d_lon = (b['lon'] - a['lon']) * math.pi / 180
        hv = (math.sin(d_lat / 2) ** 2 +
              math.cos(a['lat'] * math.pi / 180) * math.cos(b['lat'] * math.pi / 180) * math.sin(d_lon / 2) ** 2)
        dist = 2 * R * math.asin(min(1, math.sqrt(hv)))
        closed = dist < max(30, diag * 0.05)
    return {'closed': closed, 'mpu': max(range_x, range_y)}  # mpu = metres per normalized unit


# ---------- gate + laps ----------
def _count_passes(data, gi, min_lap):
    gx, gy = data[gi]['mx'], data[gi]['my']
    in_zone = False; best_d = 9; best_i = -1; last = -9e9; n = 0
    for i, p in enumerate(data):
        d = math.hypot(p['mx'] - gx, p['my'] - gy)
        if d < GATE_T:
            in_zone = True
            if d < best_d:
                best_d, best_i = d, i
        elif in_zone:
            if data[best_i]['t'] - last >= min_lap:
                n += 1; last = data[best_i]['t']
            in_zone = False; best_d = 9; best_i = -1
    return n


def _find_auto_gate(data):
    best, best_n = 0, -1
    for gi in range(0, len(data), 500):
        n = _count_passes(data, gi, 5)
        if n > best_n:
            best_n, best = n, gi
    return best


def _gate_for_latlon(data, lat, lon):
    if lat is None or lon is None:
        return None
    best, best_d = -1, float('inf')
    for i, p in enumerate(data):
        if p['lat'] is None:
            continue
        d = (p['lat'] - lat) ** 2 + (p['lon'] - lon) ** 2
        if d < best_d:
            best_d, best = d, i
    return best if best >= 0 else None


def _detect_laps(data, gate_idx):
    gx, gy = data[gate_idx]['mx'], data[gate_idx]['my']

    def passes(min_lap):
        in_zone = False; best_d = 9; best_i = -1; last = -9e9; cr = []
        for i, p in enumerate(data):
            d = math.hypot(p['mx'] - gx, p['my'] - gy)
            if d < GATE_T:
                in_zone = True
                if d < best_d:
                    best_d, best_i = d, i
            elif in_zone:
                if data[best_i]['t'] - last >= min_lap:
                    cr.append(best_i); last = data[best_i]['t']
                in_zone = False; best_d = 9; best_i = -1
        if in_zone and best_i >= 0 and data[best_i]['t'] - last >= min_lap:
            cr.append(best_i)
        return cr

    def laps_from(cr):
        out = []
        for k in range(1, len(cr)):
            a, b = cr[k - 1], cr[k]
            mx = 0.0; sm = 0.0; cnt = 0
            for i in range(a, b + 1):
                sp = data[i]['speed']
                if sp > mx:
                    mx = sp
                sm += sp; cnt += 1
            out.append({'i0': a, 'i1': b, 't': data[b]['t'] - data[a]['t'],
                        'avg': sm / cnt if cnt else 0, 'max': mx})
        return out

    cr0 = passes(5)
    lp0 = laps_from(cr0)
    med0 = sorted(l['t'] for l in lp0)[len(lp0) // 2] if lp0 else 0
    cr = passes(max(5, 0.4 * med0))
    laps = laps_from(cr)
    med = sorted(l['t'] for l in laps)[len(laps) // 2] if laps else 0
    return laps, med


def _averaged_path(data, laps, med, N=240):
    if not laps or len(laps) < 2 or med <= 0:
        return None

    def resample(lap):
        pts = [(data[i]['mx'], data[i]['my']) for i in range(lap['i0'], lap['i1'] + 1)]
        if len(pts) < 2:
            return None
        dist = [0.0]
        for i in range(1, len(pts)):
            dist.append(dist[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
        total = dist[-1]
        if total <= 0:
            return None
        out = []
        for k in range(N):
            target = total * k / (N - 1)
            j = 0
            while j < len(dist) - 1 and dist[j + 1] < target:
                j += 1
            if j >= len(pts) - 1:
                out.append(pts[-1]); continue
            seg = dist[j + 1] - dist[j]
            f = (target - dist[j]) / seg if seg > 0 else 0
            out.append((pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f,
                        pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f))
        return out

    res = []
    for lap in laps:
        if lap['t'] < 0.6 * med or lap['t'] > 1.5 * med:
            continue
        r = resample(lap)
        if r:
            res.append(r)
    if not res:
        return None
    avg = []
    for k in range(N):
        sx = sum(r[k][0] for r in res) / len(res)
        sy = sum(r[k][1] for r in res) / len(res)
        avg.append((sx, sy))
    avg.append(avg[0])  # close
    return avg


# ---------- public: precompute ----------
def prepare_track_overlay(vbo_path, gate_lat=None, gate_lon=None, settings=None):
    """Parse + project + detect laps once for the whole export. Returns a dict or None."""
    data = _parse(vbo_path)
    if not data:
        return None
    proj = _project(data)
    if proj is None:
        return None
    gate_idx = _gate_for_latlon(data, gate_lat, gate_lon)
    if gate_idx is None:
        gate_idx = _find_auto_gate(data)
    laps, med = _detect_laps(data, gate_idx)
    avg_path = _averaged_path(data, laps, med)
    # downsampled raw bundle for the faint background line
    step = max(1, len(data) // 1000)
    raw_path = [(data[i]['mx'], data[i]['my']) for i in range(0, len(data), step)]
    raw_path.append((data[-1]['mx'], data[-1]['my']))
    logging.info('track_overlay: pts=%d gate=%d laps=%d median=%.1fs avg=%s closed=%s',
                 len(data), gate_idx, len(laps), med, 'yes' if avg_path else 'no', proj['closed'])
    return {
        'data': data, 'gate_idx': gate_idx, 'laps': laps, 'median': med,
        'avg_path': avg_path, 'raw_path': raw_path, 'closed': proj['closed'],
        'mpu': proj.get('mpu', 1),
    }


# ---------- helpers for drawing ----------
def _gate_info(data, gi):
    n = len(data)
    a = max(0, gi - 30); b = min(n - 1, gi + 30)
    tx = data[b]['mx'] - data[a]['mx']
    ty = data[b]['my'] - data[a]['my']
    L = math.hypot(tx, ty) or 1
    return data[gi]['mx'], data[gi]['my'], -ty / L, tx / L


def _rider_pos(data, vbo_t):
    lo, hi = 0, len(data) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if data[mid]['t'] < vbo_t:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return data[0]['mx'], data[0]['my']
    if lo >= len(data):
        return data[-1]['mx'], data[-1]['my']
    a, b = data[lo - 1], data[lo]
    if b['t'] == a['t']:
        return a['mx'], a['my']
    f = (vbo_t - a['t']) / (b['t'] - a['t'])
    return a['mx'] + (b['mx'] - a['mx']) * f, a['my'] + (b['my'] - a['my']) * f


def _rider_index(data, vbo_t):
    lo, hi = 0, len(data) - 1
    while lo < hi:
        mid = (lo + hi) // 2
        if data[mid]['t'] < vbo_t:
            lo = mid + 1
        else:
            hi = mid
    if lo == 0:
        return {'mx': data[0]['mx'], 'my': data[0]['my'], 'idx': 0}
    if lo >= len(data):
        return {'mx': data[-1]['mx'], 'my': data[-1]['my'], 'idx': len(data) - 1}
    a, b = data[lo - 1], data[lo]
    f = 0 if b['t'] == a['t'] else (vbo_t - a['t']) / (b['t'] - a['t'])
    return {'mx': a['mx'] + (b['mx'] - a['mx']) * f, 'my': a['my'] + (b['my'] - a['my']) * f, 'idx': lo}


# Smoothed forward direction: chord from ~5 m behind to ~22 m ahead (anticipates turns,
# averages out GPS jitter). Mirrors navForward() in video-editor.js.
def _nav_forward(data, idx, mpu):
    behind_n = 5.0 / mpu; ahead_n = 22.0 / mpu
    ox, oy = data[idx]['mx'], data[idx]['my']
    ib = idx; ia = idx
    while ib > 0 and math.hypot(data[ib]['mx'] - ox, data[ib]['my'] - oy) < behind_n:
        ib -= 1
    while ia < len(data) - 1 and math.hypot(data[ia]['mx'] - ox, data[ia]['my'] - oy) < ahead_n:
        ia += 1
    fx = data[ia]['mx'] - data[ib]['mx']; fy = data[ia]['my'] - data[ib]['my']
    L = math.hypot(fx, fy) or 1.0
    return fx / L, fy / L


# Navigator (non-circuit). North-up: rider centred. Heading-up (settings.nav_heading_up):
# future path points up, rider in the lower 1/3, with smoothed rotation.
def _draw_navigator(layer, d, rx, ry, S, inner, track, vbo_t, settings=None):
    data = track['data']
    pos = _rider_index(data, vbo_t)
    if pos is None:
        return
    mpu = track.get('mpu', 1) or 1
    px_per_unit = inner / (NAV_WINDOW_M / mpu)        # inner px span = NAV_WINDOW_M metres
    Si = max(1, int(round(S)))
    rmx, rmy, idx = pos['mx'], pos['my'], pos['idx']
    heading_up = bool(settings and settings.get('nav_heading_up'))
    cx = S / 2.0
    anchor_y = S * 0.66 if heading_up else S / 2.0    # lower-1/3 vs centre (sublayer-local)
    cos_a, sin_a = 1.0, 0.0
    if heading_up:
        fx, fy = _nav_forward(data, idx, mpu)
        ang = (-math.pi / 2) - math.atan2(fy, fx)     # rotate forward → up
        cos_a, sin_a = math.cos(ang), math.sin(ang)
    win_r = NAV_WINDOW_M / mpu
    CAP = 6000
    i0 = idx; i1 = idx
    while i0 > 0 and (idx - i0) < CAP and math.hypot(data[i0 - 1]['mx'] - rmx, data[i0 - 1]['my'] - rmy) < win_r:
        i0 -= 1
    while i1 < len(data) - 1 and (i1 - idx) < CAP and math.hypot(data[i1 + 1]['mx'] - rmx, data[i1 + 1]['my'] - rmy) < win_r:
        i1 += 1

    def proj(i):
        dx = (data[i]['mx'] - rmx) * px_per_unit
        dy = (data[i]['my'] - rmy) * px_per_unit
        return (cx + (dx * cos_a - dy * sin_a), anchor_y + (dx * sin_a + dy * cos_a))

    # route on a box-sized sublayer → naturally clipped to the box
    nav = Image.new('RGBA', (Si, Si), (0, 0, 0, 0))
    nd = ImageDraw.Draw(nav)
    pts = [proj(i) for i in range(i0, i1 + 1)]
    if len(pts) > 1:
        nd.line(pts, fill=(0, 0, 0, 140), width=max(2, int(S * 0.05)), joint='curve')
        nd.line(pts, fill=(255, 255, 255, 242), width=max(1, int(S * 0.024)), joint='curve')
    layer.alpha_composite(nav, (int(round(rx)), int(round(ry))))
    # rider dot at the anchor
    DX = rx + cx; DY = ry + anchor_y
    dot = max(3, S * 0.045); halo = dot + max(1, S * 0.012)
    d.ellipse([DX - halo, DY - halo, DX + halo, DY + halo], fill=(0, 0, 0, 153))
    d.ellipse([DX - dot, DY - dot, DX + dot, DY + dot], fill=(59, 168, 255, 255),
              outline=(255, 255, 255, 242), width=max(1, int(S * 0.01)))


def _fmt_lap(s):
    if s is None or not math.isfinite(s) or s < 0:
        return '—'
    m = int(s // 60)
    sec = s - m * 60
    return '%d:%05.2f' % (m, sec)   # m:ss.ZZ (hundredths)


# ---------- public: per-frame draw ----------
def draw_track_overlay(img, W, H, settings, track, video_time,
                       vbo_time_offset, vbo_trim_start, vbo_trim_end):
    """Composite the minimap (if show_track_map) + lap board (if show_lap_table) onto an RGBA frame."""
    show_map = settings.get('show_track_map', False)
    show_board = settings.get('show_lap_table', False)
    if not (show_map or show_board) or not track:
        return
    data = track['data']

    ref = min(W, H)
    S = max(40, settings.get('track_map_size', 0.24) * ref)
    rx = settings.get('track_map_x', 0.84) * W - S / 2
    ry = settings.get('track_map_y', 0.24) * H - S / 2
    pad = max(6, S * 0.10)
    inner = S - 2 * pad
    op = max(0, min(100, settings.get('track_map_opacity', 100))) / 100.0  # background-panel opacity

    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)

    vbo_t = video_time - vbo_time_offset
    in_range = not (vbo_trim_end > 0 and (vbo_t < vbo_trim_start or vbo_t > vbo_trim_end))

    # Circuit (>=2 laps recognized) → whole averaged track + gate.  Otherwise → navigator.
    is_circuit = bool(track.get('laps') and len(track['laps']) >= 2 and track.get('avg_path'))

    if show_map and is_circuit:
        # ---- CIRCUIT: whole averaged track + gate + rider dot ----
        d.rounded_rectangle([rx, ry, rx + S, ry + S], radius=int(max(6, S * 0.06)), fill=(0, 0, 0, int(255 * op)))
        raw = track.get('raw_path')
        raw_op = max(0, min(100, settings.get('raw_track_opacity', 20))) / 100.0
        if settings.get('show_raw_track') and raw_op > 0 and raw and len(raw) > 1:
            pts = [(rx + pad + mx * inner, ry + pad + my * inner) for mx, my in raw]
            d.line(pts, fill=(150, 160, 170, int(255 * raw_op)), width=max(1, int(S * 0.012)), joint='curve')
        path = track.get('avg_path') or raw
        if path and len(path) > 1:
            pts = [(rx + pad + mx * inner, ry + pad + my * inner) for mx, my in path]
            d.line(pts, fill=(0, 0, 0, 140), width=max(2, int(S * 0.05)), joint='curve')
            d.line(pts, fill=(255, 255, 255, 242), width=max(1, int(S * 0.024)), joint='curve')
        gmx, gmy, px, py = _gate_info(data, track['gate_idx'])
        gx = rx + pad + gmx * inner; gy = ry + pad + gmy * inner
        half = max(6, S * 0.075); ex, ey = px * half, py * half
        d.line([(gx - ex, gy - ey), (gx + ex, gy + ey)], fill=(0, 0, 0, 153), width=max(3, int(S * 0.05)))
        d.line([(gx - ex, gy - ey), (gx + ex, gy + ey)], fill=(255, 59, 48, 255), width=max(2, int(S * 0.03)))
        if in_range:
            rmx, rmy = _rider_pos(data, vbo_t)
            dx = rx + pad + rmx * inner; dy = ry + pad + rmy * inner
            dot = max(3, S * 0.045); halo = dot + max(1, S * 0.012)
            d.ellipse([dx - halo, dy - halo, dx + halo, dy + halo], fill=(0, 0, 0, 153))
            d.ellipse([dx - dot, dy - dot, dx + dot, dy + dot], fill=(59, 168, 255, 255),
                      outline=(255, 255, 255, 242), width=max(1, int(S * 0.01)))
    elif show_map:
        # ---- NAVIGATOR: rider centred (or heading-up), local route, clipped to box ----
        d.rounded_rectangle([rx, ry, rx + S, ry + S], radius=int(max(6, S * 0.06)), fill=(0, 0, 0, int(255 * op)))
        if in_range:
            _draw_navigator(layer, d, rx, ry, S, inner, track, vbo_t, settings)

    if show_board and is_circuit:
        _draw_board(d, W, H, track, vbo_t, settings, S)

    img.alpha_composite(layer)


def _draw_board(d, W, H, track, vbo_t, settings, map_S=0):
    # Independent draggable widget. Each lap = a telemetry-styled black plaque, in a vertical
    # column or horizontal row, growing away from the LAP-1 anchor (lap_board_x/y).
    laps = track['laps']; data = track['data']; med = track['median']
    rows = []
    for i, lap in enumerate(laps):
        t0 = data[lap['i0']]['t']; t1 = data[lap['i1']]['t']
        if vbo_t < t0:
            break
        if vbo_t >= t1:
            rows.append((i + 1, lap['t'], True))
        else:
            rows.append((i + 1, vbo_t - t0, False)); break
    if not rows:
        rows.append((None, None, False))  # "LAP —"
    best_t = float('inf'); best_idx = -1
    for i, (num, tt, done) in enumerate(rows):
        if done and tt is not None and 0.6 * med <= tt <= 1.5 * med and tt < best_t:
            best_t, best_idx = tt, i

    horiz = bool(settings.get('lap_board_horizontal'))
    rev = bool(settings.get('lap_board_above'))     # vertical → up, horizontal → left
    sf = W / 1920.0
    fs0 = settings.get('font_size', 22) * sf
    bh0 = max(10, settings.get('bottom_padding', 41)) * sf
    sp0 = settings.get('spacing', 10) * sf
    tp0 = settings.get('top_padding', 14) * sf
    rad0 = settings.get('border_radius', 13) * sf
    margin = 6 * sf
    ax = settings.get('lap_board_x', 0.77) * W
    ay = settings.get('lap_board_y', 0.40) * H
    n = len(rows)

    reg0 = _font(fs0, bold=False); bold0 = _font(fs0, bold=True)
    gap_x0 = fs0 * 0.9

    def tw(txt, fnt):
        try:
            return d.textlength(txt, font=fnt)
        except Exception:
            return len(txt) * fs0 * 0.55

    # Measure with digits replaced by '0' → constant width (no per-frame jitter from the ticking lap)
    box_w0 = 0
    for (num, tt, done) in rows:
        lw = tw(re.sub(r'\d', '0', 'LAP ' + (str(num) if num is not None else '—')), reg0)
        vw = tw(re.sub(r'\d', '0', _fmt_lap(tt)), bold0)
        box_w0 = max(box_w0, tp0 * 2 + lw + gap_x0 + vw)

    match_map = bool(settings.get('lap_board_match_map')) and map_S > 0
    primary0 = (map_S if match_map else box_w0) if horiz else bh0
    total0 = n * primary0 + (n - 1) * sp0
    avail = (ax - margin if rev else W - ax - margin) if horiz else (ay - margin if rev else H - ay - margin)
    avail = max(primary0, avail)
    # map-width boxes can't shrink in width → keep scale 1 horizontally, cap rows instead
    scale = 1.0 if (match_map and horiz) else (1.0 if total0 <= avail else max(0.4, avail / total0))
    fs = fs0 * scale; bh = bh0 * scale
    sp = sp0 * scale; tp = tp0 * scale; rad = rad0 * scale
    box_w = map_S if match_map else box_w0 * scale

    primary = box_w if horiz else bh
    step = primary + sp
    if n * primary + (n - 1) * sp > avail:
        max_rows = max(1, int((avail + sp) / step))
        start = max(0, n - max_rows)
        rows = rows[start:]; best_idx -= start; n = len(rows)

    reg = _font(fs, bold=False); bold = _font(fs, bold=True)
    box_alpha = int(round(255 * max(0, min(100, settings.get('box_opacity', 100))) / 100.0))
    tvo = settings.get('text_vertical_offset', 0) * sf * scale

    for i, (num, tt, done) in enumerate(rows):
        if horiz:
            bx = (ax - i * step) if rev else (ax + i * step); by = ay
        else:
            bx = ax; by = (ay - i * step) if rev else (ay + i * step)
        d.rounded_rectangle([bx, by, bx + box_w, by + bh], radius=int(max(1, rad)), fill=(0, 0, 0, box_alpha))
        col = (54, 211, 107, 255) if i == best_idx else (255, 255, 255, 255)
        ty = by + bh / 2 + fs * 0.35 + tvo
        d.text((bx + tp, ty), 'LAP ' + (str(num) if num is not None else '—'), font=reg, fill=col, anchor='ls')
        d.text((bx + box_w - tp, ty), _fmt_lap(tt), font=bold, fill=col, anchor='rs')
