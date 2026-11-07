/**
 * Byte-weighted download progress.
 *
 * The old version averaged the *percentage of each file*, so a page with four
 * files read "75% done" while the 23 MB weights had barely started. This one
 * uses real loaded/total bytes (the worker already aggregates them), shows MB,
 * and estimates the remaining time from a smoothed transfer rate.
 */

import { formatBytes, formatDuration, makeRateEstimator } from './format.js';

export function createProgressView({ root, bar, file, meta }) {
  const rate = makeRateEstimator();

  return {
    update(data) {
      if (!data) return;
      root.hidden = false;

      const percent = Math.max(0, Math.min(1, data.progress ?? 0));
      bar.style.width = `${(percent * 100).toFixed(1)}%`;

      if (data.total > 0) {
        const bytesPerSecond = rate(data.loaded);
        const remaining = bytesPerSecond > 0 ? (data.total - data.loaded) / bytesPerSecond : NaN;
        const eta = Number.isFinite(remaining) && remaining > 0.5
          ? ` · ~${formatDuration(remaining)} left`
          : '';
        meta.textContent = `${formatBytes(data.loaded)} / ${formatBytes(data.total)} · ${Math.round(
          percent * 100,
        )}%${eta}`;
      } else {
        meta.textContent = `${Math.round(percent * 100)}%`;
      }

      if (file && data.file) {
        file.textContent = `${data.file} — ${Math.round(data.progress ?? 0)}%`;
      }
    },

    setFile(data) {
      if (!file || !data?.file) return;
      const percent = data.status === 'done' ? 100 : Math.round(data.progress ?? 0);
      file.textContent = `${data.file} — ${percent}%`;
    },

    complete() {
      bar.style.width = '100%';
      bar.classList.add('is-ok');
      if (file) file.textContent = 'model ready';
    },

    reset() {
      bar.style.width = '0%';
      bar.classList.remove('is-ok');
      if (file) file.textContent = 'waiting to start…';
      if (meta) meta.textContent = '0%';
    },
  };
}
