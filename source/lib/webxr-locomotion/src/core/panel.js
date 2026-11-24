// The wrist panel's face (README.md § Wrist panel → Contents, Pressing): pages of cells, the press interval, the lit
// cell, notices and the face model the painter draws. Layout ported from [R] MetalWrist.swift:rect(_:).

/** @typedef {{id:string, label:string, icon:string, action:string, onLabel?:string, tone?:'danger', repeat?:boolean, keepOpen?:boolean}} Item */

/** The built-in cells. Actions starting `page:` switch pages; `jump:<id>` goes to a destination. */
export const ITEMS = Object.freeze({
  fly: { id: 'fly', label: 'Fly', onLabel: 'Flying', icon: 'fly', action: 'fly' },
  turnLeft: { id: 'turn-left', label: 'Turn', icon: 'turn-left', action: 'turn-left', keepOpen: true },
  turnRight: { id: 'turn-right', label: 'Turn', icon: 'turn-right', action: 'turn-right', keepOpen: true },
  home: { id: 'home', label: 'Home', icon: 'home', action: 'home' },
  menu: { id: 'menu', label: 'Menu', icon: 'menu', action: 'menu' },
  exit: { id: 'exit', label: 'Exit', icon: 'exit', action: 'exit', tone: 'danger' },
  places: { id: 'places', label: 'Places', icon: 'places', action: 'page:places', keepOpen: true },
  fine: { id: 'fine', label: 'Adjust', icon: 'fine', action: 'page:fine', keepOpen: true },
  back: { id: 'back', label: 'Back', icon: 'back', action: 'page:main', keepOpen: true },
});

/** The main page per profile. [R] MetalWrist.swift:Button and MetalSpace.swift:63-70 for region. */
export const MAIN = Object.freeze({
  region: [ITEMS.fly, ITEMS.turnLeft, ITEMS.turnRight, ITEMS.home, ITEMS.menu, ITEMS.exit],
  room: [ITEMS.places, ITEMS.turnLeft, ITEMS.turnRight, ITEMS.fine, ITEMS.menu, ITEMS.exit],
  planet: [ITEMS.places, ITEMS.turnLeft, ITEMS.turnRight, ITEMS.home, ITEMS.menu, ITEMS.exit],
});

/** Fine position ([G] FocusEnvironmentNudgeView.swift:82-112): the pad, the room's height and Keep this spot. */
const FINE = [
  { id: 'nudge-turn-left', label: '1°', icon: 'turn-left', action: 'nudge:turn-left', repeat: true, keepOpen: true },
  { id: 'nudge-forward', label: '2 cm', icon: 'up', action: 'nudge:forward', repeat: true, keepOpen: true },
  { id: 'nudge-turn-right', label: '1°', icon: 'turn-right', action: 'nudge:turn-right', repeat: true, keepOpen: true },
  { id: 'raise', label: 'Raise', icon: 'raise', action: 'raise', repeat: true, keepOpen: true },
  { id: 'nudge-left', label: '2 cm', icon: 'left', action: 'nudge:left', repeat: true, keepOpen: true },
  { id: 'nudge-back', label: '2 cm', icon: 'down', action: 'nudge:back', repeat: true, keepOpen: true },
  { id: 'nudge-right', label: '2 cm', icon: 'right', action: 'nudge:right', repeat: true, keepOpen: true },
  { id: 'lower', label: 'Lower', icon: 'lower', action: 'lower', repeat: true, keepOpen: true },
  { id: 'keep', label: 'Keep spot', icon: 'keep', action: 'keep', keepOpen: true },
  null,
  null,
  ITEMS.back,
];

/**
 * The cells' rectangles in face units (0…1 across, 0…1 down): a header across the top, then `rows` × `cols` cells
 * with `gap` between them and round the edges. [R] MetalWrist.swift:rect(_:) (3 × 2, top 0.24, gap 0.03)
 */
export function layoutCells(cols, rows, k) {
  const top = k.panelHeader, gap = k.panelGap;
  const width = (1 - gap * (cols + 1)) / cols;
  const height = (1 - top - gap * (rows + 1)) / rows;
  const cells = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ x: gap + col * (width + gap), y: top + gap + row * (height + gap), w: width, h: height });
    }
  }
  return cells;
}

/** The cell under a face point, or null (the header, the gaps, outside). */
export function cellAtUV(uv, cells) {
  if (!uv) return null;
  const i = cells.findIndex((c) => uv.x >= c.x && uv.x <= c.x + c.w && uv.y >= c.y && uv.y <= c.y + c.h);
  return i >= 0 ? i : null;
}

/** The panel's pages and press rules. */
export class Panel {
  /**
   * @param {object} o
   * @param {string} o.profile
   * @param {Item[]} [o.items] the main page (default: MAIN[profile])
   * @param {boolean} [o.fine] whether Fine position exists
   * @param {() => Array<{id:string, label:string, kind?:string}>} o.destinations
   * @param {object} o.k constants
   */
  constructor({ profile, items, fine, destinations, k }) {
    this.k = k;
    this.main = (items ?? MAIN[profile] ?? MAIN.region).slice(0, 6);
    if (!fine) this.main = this.main.map((item) => (item?.action === 'page:fine' ? ITEMS.home : item));
    this.destinations = destinations;
    this.page = 'main';
    this.placesOffset = 0;
    this.lastPress = -Infinity;
    this.lit = null;
    this.noticeText = null;
    this.noticeUntil = -Infinity;
  }

  setPage(page) {
    this.page = page;
    if (page !== 'places') this.placesOffset = 0;
  }

  /** The current page: its grid and items (null for an empty cell). */
  layout() {
    if (this.page === 'fine') return { cols: 4, rows: 3, items: FINE, title: 'Adjust' };
    if (this.page === 'places') {
      const all = this.destinations();
      const per = 4;
      const shown = all.slice(this.placesOffset, this.placesOffset + per)
        .map((d) => ({ id: `jump:${d.id}`, label: d.label ?? d.id, icon: d.kind === 'home' ? 'home' : 'place', action: `jump:${d.id}` }));
      while (shown.length < per) shown.push(null);
      const more = all.length > per ? { id: 'more', label: 'More', icon: 'more', action: 'more', keepOpen: true } : null;
      return { cols: 3, rows: 2, items: [...shown, more, ITEMS.back], title: 'Places' };
    }
    return { cols: 3, rows: 2, items: this.main, title: null };
  }

  cells() {
    const { cols, rows } = this.layout();
    return layoutCells(cols, rows, this.k);
  }

  /** The item under a face point, with its index, or null. */
  itemAt(uv) {
    const index = cellAtUV(uv, this.cells());
    const item = index === null ? null : this.layout().items[index];
    return item ? { index, item } : null;
  }

  /**
   * A press on a cell. Presses at least pressInterval apart ("one poke flipped Fly three times", [R]
   * MetalWrist.swift:190-191); a held repeat cell may repeat faster. Returns the item, or null.
   */
  press(index, time, { repeat = false } = {}) {
    const item = this.layout().items[index];
    if (!item) return null;
    // Fine position's steps take quick taps ([G]'s buttons have no debounce); every other cell waits pressInterval.
    const interval = item.repeat ? this.k.repeatEvery : this.k.pressInterval;
    if (!(repeat && item.repeat) && time - this.lastPress < interval) return null;
    this.lastPress = time;
    this.lit = { index, page: this.page, until: time + this.k.litSeconds };
    if (item.action === 'more') {
      const n = this.destinations().length;
      this.placesOffset = this.placesOffset + 4 >= n ? 0 : this.placesOffset + 4;
    }
    return item;
  }

  /** A message in the header's place for noticeSeconds. A refused action never fails silently. [R] AppModel.swift:958-963 */
  notice(text, time) {
    this.noticeText = text;
    this.noticeUntil = time + this.k.noticeSeconds;
  }

  /**
   * What the face shows now. Equal faces give equal keys, so a host redraws only when the key changes.
   * @param {{time:number, place?:string, clock?:string, flying?:boolean, readout?:string|null}} s
   */
  face({ time, place = '', clock = '', flying = false, readout = null }) {
    const { cols, rows, items, title } = this.layout();
    const lit = this.lit && this.lit.until > time && this.lit.page === this.page ? this.lit.index : null;
    const notice = this.noticeUntil > time ? this.noticeText : null;
    const face = {
      page: this.page,
      cols,
      rows,
      title: title ?? place,
      clock: this.page === 'main' ? clock : '',
      notice,
      readout: this.page === 'fine' ? readout : null,
      cells: items.map((item, index) =>
        item
          ? {
              label: item.id === 'fly' && flying ? item.onLabel : item.label,
              icon: item.icon,
              on: item.id === 'fly' && flying,
              lit: lit === index,
              tone: item.tone ?? null,
            }
          : null,
      ),
    };
    return { face, key: JSON.stringify(face) };
  }
}
