/**
 * Panel 6 — the meaning map.
 *
 * 384 dimensions reduced to 2 with PCoA/PCA, drawn on a canvas. Similar
 * sentences cluster because the projection preserves the dominant directions
 * of variance — which for sentence embeddings usually means topic.
 */

import { pca2d, fitToBox } from '../lib/pca.js';
import { corpusStore } from '../lib/store.js';
import { formatPercent, formatScore, truncate } from '../lib/format.js';

const HEIGHT = 380;

export function initMapPanel({ onSelect }) {
  const canvas = document.getElementById('map-canvas');
  const empty = document.getElementById('map-empty');
  const tooltip = document.getElementById('map-tooltip');
  const explained = document.getElementById('map-explained');
  const host = canvas.parentElement;
  const ctx = canvas.getContext('2d');

  let projected = []; // { x, y } in data space
  let fitted = []; // { x, y } in CSS pixels
  let theme = readThemeColors();

  function readThemeColors() {
    const styles = getComputedStyle(document.documentElement);
    return {
      accent: styles.getPropertyValue('--signal').trim() || '#c0380f',
      accentStrong: styles.getPropertyValue('--signal-deep').trim() || '#a3320e',
      text: styles.getPropertyValue('--ink').trim() || '#16130f',
      muted: styles.getPropertyValue('--ink-2').trim() || '#5b5449',
      border: styles.getPropertyValue('--rule-2').trim() || '#b6ab92',
      surface: styles.getPropertyValue('--paper-sunk').trim() || '#e9e3d5',
    };
  }

  function relayout() {
    fitted = projected.length
      ? fitToBox(projected, host.clientWidth || 640, HEIGHT)
      : [];
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    const width = host.clientWidth || 640;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(HEIGHT * dpr);
    canvas.style.height = `${HEIGHT}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    relayout(); // fitted pixels are size-dependent
    draw();
  }

  function draw() {
    const width = host.clientWidth || 640;
    ctx.clearRect(0, 0, width, HEIGHT);

    const state = corpusStore.state;
    if (!state.vectors.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    // Guide crosshair through the centre — this is 0,0 of the projection.
    ctx.strokeStyle = theme.border;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, HEIGHT / 2);
    ctx.lineTo(width, HEIGHT / 2);
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, HEIGHT);
    ctx.stroke();
    ctx.globalAlpha = 1;

    fitted.forEach((point, index) => {
      const isSelected = index === state.selectedIndex;
      const radius = isSelected ? 7 : 5;

      if (isSelected) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius + 5, 0, Math.PI * 2);
        ctx.strokeStyle = theme.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = isSelected ? theme.accentStrong : theme.accent;
      ctx.fill();
      ctx.strokeStyle = theme.surface;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.fillStyle = theme.text;
      ctx.font = '600 10px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(String(index + 1), point.x, point.y - radius - 5);
    });
  }

  function update(state) {
    if (!state.vectors.length) {
      projected = [];
      fitted = [];
      explained.textContent = '';
      draw();
      return;
    }

    const result = pca2d(state.vectors);
    projected = result.points;
    relayout();

    if (state.vectors.length === 1) {
      explained.textContent = 'One text makes a lonely map — add more lines in section 5.';
    } else {
      explained.textContent = `The first two components explain ${formatPercent(
        result.explained[0],
        0,
      )} and ${formatPercent(result.explained[1], 0)} of the variance in these ${
        result.dimensions
      }-dimensional vectors (${formatPercent(
        Math.min(1, result.explained[0] + result.explained[1]),
        0,
      )} together). Distances here are an approximation — trust the cosine matrix in section 5 for exact numbers.`;
    }

    draw();
  }

  /* ---- hover / click --------------------------------------------------- */
  function pointAt(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    let best = -1;
    let bestDistance = 16;
    fitted.forEach((point, index) => {
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    return best;
  }

  canvas.addEventListener('mousemove', (event) => {
    const index = pointAt(event);
    if (index === -1) {
      tooltip.hidden = true;
      canvas.style.cursor = 'default';
      return;
    }

    const state = corpusStore.state;
    const score = state.matrix[state.selectedIndex]?.[index];
    tooltip.hidden = false;
    tooltip.textContent = '';
    tooltip.append(
      `${index + 1}. ${truncate(state.texts[index] ?? '', 80)}` +
        (Number.isFinite(score) && index !== state.selectedIndex
          ? ` · ${formatScore(score, 3)} vs selected`
          : ''),
    );

    const rect = canvas.getBoundingClientRect();
    const point = fitted[index];
    tooltip.style.left = `${Math.min(rect.width - 180, point.x + 12)}px`;
    tooltip.style.top = `${Math.max(6, point.y - 12)}px`;
    canvas.style.cursor = 'pointer';
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.hidden = true;
  });

  canvas.addEventListener('click', (event) => {
    const index = pointAt(event);
    if (index !== -1) onSelect?.(index);
  });

  // Keyboard: the canvas is not focusable, so expose selection through the
  // corpus panel — this handler at least keeps it consistent for pointer users.
  canvas.addEventListener('keydown', (event) => {
    const state = corpusStore.state;
    if (!state.texts.length) return;
    const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = Math.min(state.texts.length - 1, Math.max(0, state.selectedIndex + delta));
    onSelect?.(next);
  });

  /* ---- lifecycle ------------------------------------------------------- */
  const resizeObserver = new ResizeObserver(() => resizeCanvas());
  resizeObserver.observe(host);

  if (typeof MutationObserver !== 'undefined') {
    new MutationObserver(() => {
      theme = readThemeColors();
      draw();
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  corpusStore.subscribe(update);

  resizeCanvas();
  update(corpusStore.state);

  return { redraw: draw };
}
