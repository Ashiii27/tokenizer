/**
 * Small formatting helpers. Locale-aware where it matters, deterministic
 * everywhere else so unit tests stay stable.
 */

const numberFormat = new Intl.NumberFormat('en-US');

export function formatCount(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  if (digits === 0) return numberFormat.format(Math.round(value));
  return value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatBytes(bytes, digits = 1) {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatScore(value, digits = 4) {
  if (!Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function formatRatio(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}×`;
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function pluralize(count, singular, plural = `${singular}s`) {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

/** Shorten a string for labels, keeping it on one line. */
export function truncate(text, max = 48) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Seconds → "12s" / "1m 20s". */
export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 1) return 'less than a second';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/**
 * A smooth, monotonic progress estimate. Naive "bytes / elapsed" jumps around;
 * this blends it with an exponentially averaged rate so the ETA stops flicking.
 */
export function makeRateEstimator({ smoothing = 0.25 } = {}) {
  let rate = 0;
  let lastTime = null;
  let lastLoaded = 0;

  return function update(loaded, now = Date.now()) {
    if (lastTime !== null && now > lastTime && loaded >= lastLoaded) {
      const instant = (loaded - lastLoaded) / ((now - lastTime) / 1000);
      rate = rate === 0 ? instant : rate * (1 - smoothing) + instant * smoothing;
    }
    lastTime = now;
    lastLoaded = loaded;
    return rate > 0 ? rate : 0;
  };
}
