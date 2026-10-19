/**
 * Custom retail barcode line scanner (UPC-A / EAN-13).
 * Used when BarcodeDetector is unavailable (typical on iPadOS Safari).
 */
(function (global) {
  // Left (odd) digit patterns: 4 run widths totaling 7 modules (space-bar-space-bar)
  const L = {
    "3211": 0,
    "2221": 1,
    "2122": 2,
    "1411": 3,
    "1132": 4,
    "1231": 5,
    "1114": 6,
    "1312": 7,
    "1213": 8,
    "3112": 9,
  };
  // Left (even / G) patterns for EAN-13
  const G = {
    "1123": 0,
    "1222": 1,
    "2212": 2,
    "1141": 3,
    "2311": 4,
    "1321": 5,
    "4111": 6,
    "2131": 7,
    "3121": 8,
    "2113": 9,
  };
  // Right digit patterns: bar-space-bar-space (same width keys as L)
  const R = L;

  // EAN-13 first-digit parity for the six left digits (L=odd, G=even)
  const EAN13_PARITY = {
    LLLLLL: 0,
    LLGLGG: 1,
    LLGGLG: 2,
    LLGGGL: 3,
    LGLLGG: 4,
    LGGLLG: 5,
    LGGGLL: 6,
    LGLGLG: 7,
    LGLGGL: 8,
    LGGLGL: 9,
  };

  const BUCKET_BITS = 5;

  function findThreshold(samples) {
    const buckets = new Int32Array(1 << BUCKET_BITS);
    for (let i = 0; i < samples.length; i++) {
      buckets[samples[i] >>> (8 - BUCKET_BITS)]++;
    }
    let maxIdx = 0;
    let maxVal = -1;
    for (let i = 0; i < buckets.length; i++) {
      if (buckets[i] > maxVal) {
        maxVal = buckets[i];
        maxIdx = i;
      }
    }
    let nextIdx = 0;
    let nextVal = -1;
    for (let i = 0; i < buckets.length; i++) {
      if (Math.abs(i - maxIdx) <= 4) continue;
      if (buckets[i] > nextVal) {
        nextVal = buckets[i];
        nextIdx = i;
      }
    }
    const lo = Math.min(maxIdx, nextIdx);
    const hi = Math.max(maxIdx, nextIdx);
    let valleyIdx = lo;
    let valleyVal = Infinity;
    for (let i = lo; i <= hi; i++) {
      if (buckets[i] < valleyVal) {
        valleyVal = buckets[i];
        valleyIdx = i;
      }
    }
    return (valleyIdx << (8 - BUCKET_BITS)) + (1 << (7 - BUCKET_BITS));
  }

  function sampleLine(data, width, y, x0, x1) {
    const samples = new Uint8Array(x1 - x0);
    const row = y * width * 4;
    for (let x = x0, i = 0; x < x1; x++, i++) {
      const off = row + x * 4;
      samples[i] = (data[off] * 77 + data[off + 1] * 150 + data[off + 2] * 29) >> 8;
    }
    return samples;
  }

  /** Run lengths; index 0 is leading quiet (light). Dark runs are odd indices. */
  function runsFromSamples(samples) {
    if (!samples.length) return [];
    const threshold = findThreshold(samples);
    const segments = [];
    let count = 0;
    let last = true;
    for (let i = 0; i < samples.length; i++) {
      const isLight = samples[i] > threshold;
      if (last !== isLight) {
        segments.push(count);
        count = 0;
        last = isLight;
      }
      count++;
    }
    segments.push(count);
    return segments;
  }

  function normalizeDigit(w0, w1, w2, w3) {
    const sum = w0 + w1 + w2 + w3;
    if (sum < 4) return null;
    const raw = [w0, w1, w2, w3].map((w) => (w * 7) / sum);
    const rounded = raw.map((w) => Math.max(1, Math.min(4, Math.round(w))));
    let total = rounded[0] + rounded[1] + rounded[2] + rounded[3];
    while (total > 7) {
      let best = -1;
      let bestExcess = -1;
      for (let i = 0; i < 4; i++) {
        if (rounded[i] <= 1) continue;
        const excess = raw[i] - (rounded[i] - 0.5);
        if (excess > bestExcess) {
          bestExcess = excess;
          best = i;
        }
      }
      if (best < 0) break;
      rounded[best]--;
      total--;
    }
    while (total < 7) {
      let best = -1;
      let bestNeed = -1;
      for (let i = 0; i < 4; i++) {
        if (rounded[i] >= 4) continue;
        const need = rounded[i] + 0.5 - raw[i];
        if (need > bestNeed) {
          bestNeed = need;
          best = i;
        }
      }
      if (best < 0) break;
      rounded[best]++;
      total++;
    }
    return rounded.join("");
  }

  function upcChecksumOk(digits) {
    if (digits.length !== 12 && digits.length !== 13) return false;
    const d = digits.length === 13 ? digits.slice(1) : digits;
    let sum = 0;
    for (let i = 0; i < 11; i++) {
      sum += d[i] * (i % 2 === 0 ? 3 : 1);
    }
    const check = (10 - (sum % 10)) % 10;
    return check === d[11];
  }

  function ean13ChecksumOk(digits) {
    if (digits.length !== 13) return false;
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += digits[i] * (i % 2 === 0 ? 1 : 3);
    }
    const check = (10 - (sum % 10)) % 10;
    return check === digits[12];
  }

  /**
   * Decode UPC-A (12) or EAN-13 (13) from alternating run widths.
   * `runs` must start at the start-guard's first bar (dark).
   */
  function tryParseFromGuard(runs) {
    // Need: 3 start + 6*4 left + 5 mid + 6*4 right + 3 end = 59 runs
    if (!runs || runs.length < 59) return null;

    const unit =
      (runs[0] + runs[1] + runs[2]) / 3 ||
      1;
    if (unit < 1) return null;

    // Start guard ~1-1-1
    if (
      Math.abs(runs[0] / unit - 1) > 0.7 ||
      Math.abs(runs[1] / unit - 1) > 0.7 ||
      Math.abs(runs[2] / unit - 1) > 0.7
    ) {
      return null;
    }

    const leftDigits = [];
    const leftParity = [];
    let idx = 3;
    for (let d = 0; d < 6; d++) {
      const key = normalizeDigit(runs[idx], runs[idx + 1], runs[idx + 2], runs[idx + 3]);
      idx += 4;
      if (!key) return null;
      if (L[key] != null) {
        leftDigits.push(L[key]);
        leftParity.push("L");
      } else if (G[key] != null) {
        leftDigits.push(G[key]);
        leftParity.push("G");
      } else {
        return null;
      }
    }

    // Middle 01010 → light-dark-light-dark-light (5 runs) when previous ended on bar
    // After left digit (ends with bar), next is light — yes mid starts with space.
    if (idx + 5 > runs.length) return null;
    const midUnit =
      (runs[idx] + runs[idx + 1] + runs[idx + 2] + runs[idx + 3] + runs[idx + 4]) / 5;
    for (let i = 0; i < 5; i++) {
      if (Math.abs(runs[idx + i] / midUnit - 1) > 0.85) return null;
    }
    idx += 5;

    const rightDigits = [];
    for (let d = 0; d < 6; d++) {
      const key = normalizeDigit(runs[idx], runs[idx + 1], runs[idx + 2], runs[idx + 3]);
      idx += 4;
      if (!key || R[key] == null) return null;
      rightDigits.push(R[key]);
    }

    // End guard
    if (idx + 3 > runs.length) return null;

    const parityKey = leftParity.join("");
    if (parityKey === "LLLLLL") {
      const digits = leftDigits.concat(rightDigits);
      if (!upcChecksumOk(digits)) return null;
      return digits.join("");
    }

    const first = EAN13_PARITY[parityKey];
    if (first == null) return null;
    const digits = [first].concat(leftDigits, rightDigits);
    if (!ean13ChecksumOk(digits)) return null;
    return digits.join("");
  }

  function decodeLine(samples) {
    const runs = runsFromSamples(samples);
    if (runs.length < 60) return null;

    // runs[0] is quiet zone (light). Bars are at odd indices: 1,3,5…
    // Try each dark run as a possible start guard.
    for (let start = 1; start < runs.length - 58; start += 2) {
      const slice = runs.slice(start);
      const code = tryParseFromGuard(slice);
      if (code) return code;
    }

    // Also try inverted polarity (dark quiet / light bars) by flipping interpretation:
    // rebuild runs as if threshold inverted — covered by trying even start indices
    for (let start = 2; start < runs.length - 58; start += 2) {
      const slice = runs.slice(start);
      const code = tryParseFromGuard(slice);
      if (code) return code;
    }
    return null;
  }

  function scanImageData(imageData) {
    const { data, width, height } = imageData;
    if (width < 100 || height < 30) return null;

    const y0 = Math.floor(height * 0.2);
    const y1 = Math.floor(height * 0.8);
    const step = Math.max(1, Math.floor((y1 - y0) / 48));
    const crops = [
      [Math.floor(width * 0.02), Math.floor(width * 0.98)],
      [Math.floor(width * 0.1), Math.floor(width * 0.9)],
      [Math.floor(width * 0.05), Math.floor(width * 0.95)],
    ];

    for (let c = 0; c < crops.length; c++) {
      const x0 = crops[c][0];
      const x1 = crops[c][1];
      for (let y = y0; y < y1; y += step) {
        const samples = sampleLine(data, width, y, x0, x1);
        const code = decodeLine(samples);
        if (code) return code;
        // reverse scan (barcode upside-down)
        const rev = new Uint8Array(samples.length);
        for (let i = 0; i < samples.length; i++) rev[i] = samples[samples.length - 1 - i];
        const codeRev = decodeLine(rev);
        if (codeRev) return codeRev;
      }
    }
    return null;
  }

  global.BartesianRetailBarcode = {
    decodeLine,
    scanImageData,
    upcChecksumOk,
  };
})(window);
