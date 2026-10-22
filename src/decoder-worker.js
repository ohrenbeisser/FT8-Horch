// Web Worker: decodiert eine Aufnahme im Hintergrund, damit die Oberfläche nicht stockt.
// Nachricht herein: { id, samples (Float32Array), profile: { kt, kf, f0 }, opt }
// Nachricht heraus: { id, signals, unsupported, candidates, attempts, ms } oder { id, error }
import { decodeAll } from './decoder.js';
import { createProfile } from './profile.js';
import { kompaktiere } from './empfang.js';

self.onmessage = (ev) => {
  const { id, samples, profile, opt } = ev.data;
  try {
    const t0 = performance.now();
    const p = createProfile({ kt: profile.kt, kf: profile.kf, f0: profile.f0 });
    const r = decodeAll(samples, p, opt ?? {});
    self.postMessage({
      id,
      // Die Zwischenwerte (Tonleistungen, LLR, BP-Verlauf) gehen nur mit, wenn die Oberfläche sie anfragt (opt.zwischenwerte)
      signals: r.signals.map((s) => ({
        text: s.text, message: s.message, startSec: s.startSec, dtSec: s.dtSec, f0: s.f0, snrDb: s.snrDb, score: s.score,
        ...(opt?.zwischenwerte ? { zw: kompaktiere(s, p) } : {}),
      })),
      unsupported: r.unsupported.map(({ reason, startSec, f0 }) => ({ reason, startSec, f0 })),
      candidates: r.candidates,
      attempts: r.attempts,
      ms: performance.now() - t0,
    });
  } catch (fehler) {
    self.postMessage({ id, error: String(fehler?.message ?? fehler) });
  }
};
