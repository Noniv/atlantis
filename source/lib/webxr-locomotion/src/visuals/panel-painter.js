// Paints the panel's face (out.panel.face) with Canvas 2D: works on a <canvas> or an OffscreenCanvas, and in a
// worker. Redraw only when out.panel.faceKey changes. The look is [R] MetalWrist.swift:render(_:): a near-black face
// with rounded corners, the place and the time across the top, grey cells, the "on" cell blue, Exit dark red, the
// pressed cell lit, a notice in amber in the header's place. Icons are drawn as vector strokes (no icon font).

import { K } from '../core/constants.js';
import { layoutCells } from '../core/panel.js';

export const PANEL_COLOURS = Object.freeze({
  face: 'rgba(15, 15, 15, 0.96)',
  cell: 'rgb(56, 56, 56)',
  lit: 'rgb(140, 140, 140)',
  on: 'rgb(51, 122, 242)',
  danger: 'rgb(107, 36, 36)',
  text: '#ffffff',
  clock: 'rgb(191, 191, 191)',
  notice: 'rgb(255, 214, 115)',
});

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** Draws `text` within `width`, ending with an ellipsis if it doesn't fit. */
function fitText(ctx, text, x, y, width) {
  let shown = String(text ?? '');
  if (ctx.measureText && ctx.measureText(shown).width > width) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > width) shown = shown.slice(0, -1);
    shown = `${shown}…`;
  }
  ctx.fillText(shown, x, y);
}

/** Vector icons in a 44 × 44 box centred on (cx, cy). */
const ICONS = {
  fly(ctx) {
    ctx.moveTo(0, -18); ctx.lineTo(4, -4); ctx.lineTo(18, 4); ctx.lineTo(4, 2); ctx.lineTo(3, 12); ctx.lineTo(8, 17);
    ctx.lineTo(-8, 17); ctx.lineTo(-3, 12); ctx.lineTo(-4, 2); ctx.lineTo(-18, 4); ctx.lineTo(-4, -4); ctx.closePath();
  },
  'turn-left'(ctx) {
    ctx.arc(0, 2, 13, -Math.PI * 0.15, Math.PI * 1.35, true);
    ctx.moveTo(-16, -14); ctx.lineTo(-8, -9); ctx.lineTo(-17, -4);
  },
  'turn-right'(ctx) {
    ctx.arc(0, 2, 13, Math.PI * 1.15, -Math.PI * 0.35, false);
    ctx.moveTo(16, -14); ctx.lineTo(8, -9); ctx.lineTo(17, -4);
  },
  home(ctx) {
    ctx.moveTo(-17, 0); ctx.lineTo(0, -16); ctx.lineTo(17, 0);
    ctx.moveTo(-12, -4); ctx.lineTo(-12, 16); ctx.lineTo(12, 16); ctx.lineTo(12, -4);
    ctx.moveTo(-4, 16); ctx.lineTo(-4, 6); ctx.lineTo(4, 6); ctx.lineTo(4, 16);
  },
  menu(ctx) {
    ctx.rect(-17, -14, 34, 28); ctx.moveTo(-17, -6); ctx.lineTo(17, -6);
  },
  exit(ctx) {
    ctx.moveTo(4, -16); ctx.lineTo(-14, -16); ctx.lineTo(-14, 16); ctx.lineTo(4, 16);
    ctx.moveTo(-4, 0); ctx.lineTo(18, 0); ctx.moveTo(11, -7); ctx.lineTo(18, 0); ctx.lineTo(11, 7);
  },
  places(ctx) {
    ctx.arc(0, -6, 9, Math.PI * 0.8, Math.PI * 0.2); ctx.lineTo(0, 17); ctx.closePath(); ctx.moveTo(3, -6); ctx.arc(0, -6, 3, 0, Math.PI * 2);
  },
  place(ctx) {
    ICONS.places(ctx);
  },
  fine(ctx) {
    ctx.moveTo(0, -18); ctx.lineTo(0, 18); ctx.moveTo(-18, 0); ctx.lineTo(18, 0);
    ctx.moveTo(-5, -13); ctx.lineTo(0, -18); ctx.lineTo(5, -13); ctx.moveTo(-5, 13); ctx.lineTo(0, 18); ctx.lineTo(5, 13);
    ctx.moveTo(-13, -5); ctx.lineTo(-18, 0); ctx.lineTo(-13, 5); ctx.moveTo(13, -5); ctx.lineTo(18, 0); ctx.lineTo(13, 5);
  },
  back(ctx) {
    ctx.moveTo(6, -14); ctx.lineTo(-8, 0); ctx.lineTo(6, 14);
  },
  up(ctx) {
    ctx.moveTo(-14, 7); ctx.lineTo(0, -8); ctx.lineTo(14, 7);
  },
  down(ctx) {
    ctx.moveTo(-14, -7); ctx.lineTo(0, 8); ctx.lineTo(14, -7);
  },
  left(ctx) {
    ctx.moveTo(7, -14); ctx.lineTo(-8, 0); ctx.lineTo(7, 14);
  },
  right(ctx) {
    ctx.moveTo(-7, -14); ctx.lineTo(8, 0); ctx.lineTo(-7, 14);
  },
  raise(ctx) {
    ctx.moveTo(-16, 16); ctx.lineTo(16, 16); ctx.moveTo(0, 10); ctx.lineTo(0, -16); ctx.moveTo(-8, -8); ctx.lineTo(0, -16); ctx.lineTo(8, -8);
  },
  lower(ctx) {
    ctx.moveTo(-16, 16); ctx.lineTo(16, 16); ctx.moveTo(0, -16); ctx.lineTo(0, 10); ctx.moveTo(-8, 2); ctx.lineTo(0, 10); ctx.lineTo(8, 2);
  },
  keep(ctx) {
    ctx.moveTo(4, -12); ctx.arc(0, -12, 4, 0, Math.PI * 2); ctx.moveTo(0, -6); ctx.lineTo(0, 8); ctx.moveTo(-9, -2); ctx.lineTo(9, -2);
    ctx.moveTo(0, 8); ctx.lineTo(-6, 18); ctx.moveTo(0, 8); ctx.lineTo(6, 18);
  },
  // for a host's sound toggle (Atlantis's music): two beamed notes
  music(ctx) {
    ctx.moveTo(-6, 12); ctx.arc(-10, 12, 4, 0, Math.PI * 2); ctx.moveTo(-6, 12); ctx.lineTo(-6, -12); ctx.lineTo(12, -17);
    ctx.lineTo(12, 7); ctx.moveTo(16, 7); ctx.arc(12, 7, 4, 0, Math.PI * 2);
  },
  more(ctx) {
    for (const x of [-12, 0, 12]) {
      ctx.moveTo(x + 3, 0); ctx.arc(x, 0, 3, 0, Math.PI * 2);
    }
  },
};

function drawIcon(ctx, name, cx, cy) {
  const icon = ICONS[name];
  if (!icon) return;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.beginPath();
  icon(ctx);
  ctx.lineWidth = 3.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = PANEL_COLOURS.text;
  ctx.stroke();
  ctx.restore();
}

/**
 * Paints a face from out.panel.face onto a 2D context sized panelPixelsWide × panelPixelsHigh (600 × 400).
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {object} face
 */
export function paintPanelFace(ctx, face, { width = K.panelPixelsWide, height = K.panelPixelsHigh, k = K } = {}) {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = PANEL_COLOURS.face;
  roundedRect(ctx, 0, 0, width, height, 44);
  ctx.fill();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';

  if (face.notice) {
    ctx.font = `600 27px ${SANS}`;
    ctx.fillStyle = PANEL_COLOURS.notice;
    fitText(ctx, face.notice, 30, 30, width - 60);
  } else if (face.readout) {
    ctx.font = `600 30px ${SANS}`;
    ctx.fillStyle = PANEL_COLOURS.text;
    fitText(ctx, face.title, 30, 14, width - 60);
    ctx.font = `400 20px ${SANS}`;
    ctx.fillStyle = PANEL_COLOURS.clock;
    fitText(ctx, face.readout, 30, 54, width - 60);
  } else {
    ctx.font = `600 34px ${SANS}`;
    ctx.fillStyle = PANEL_COLOURS.text;
    fitText(ctx, face.title || '', 30, 24, width - 190);
    if (face.clock) {
      ctx.font = `400 34px ${MONO}`;
      ctx.fillStyle = PANEL_COLOURS.clock;
      ctx.textAlign = 'right';
      ctx.fillText(face.clock, width - 30, 24);
      ctx.textAlign = 'left';
    }
  }

  const cells = layoutCells(face.cols, face.rows, k);
  face.cells.forEach((cell, i) => {
    if (!cell) return;
    const u = cells[i];
    const x = u.x * width, y = u.y * height, w = u.w * width, h = u.h * height;
    ctx.fillStyle = cell.lit ? PANEL_COLOURS.lit : cell.on ? PANEL_COLOURS.on : cell.tone === 'danger' ? PANEL_COLOURS.danger : PANEL_COLOURS.cell;
    roundedRect(ctx, x, y, w, h, face.rows > 2 ? 18 : 26);
    ctx.fill();
    const small = face.rows > 2;
    drawIcon(ctx, cell.icon, x + w / 2, y + (small ? h * 0.38 : 18 + 22));
    ctx.font = `500 ${small ? 18 : 26}px ${SANS}`;
    ctx.fillStyle = PANEL_COLOURS.text;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    fitText(ctx, cell.label, x + w / 2, y + h - (small ? 8 : 18), w - 12);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
  });
}
