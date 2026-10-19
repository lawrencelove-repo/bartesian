/**
 * Bartesian capsule lid barcode scanner (non-standard Code 128 C).
 *
 * Spec: https://github.com/romkal/bartesian_barcode/blob/main/BARCODES.md
 * Ported from romkal's Code128.kt + Code128Analyzer.kt.
 *
 * - No start symbol
 * - Stop = single bar of width 2
 * - Always 68 units: 5 data symbols (6 modules each) + checksum + stop
 */
(function (global) {
  const LEGAL_CODES_128 = [
    212222, 222122, 222221, 121223, 121322, 131222, 122213, 122312, 132212, 221213,
    221312, 231212, 112232, 122132, 122231, 113222, 123122, 123221, 223211, 221132,
    221231, 213212, 223112, 312131, 311222, 321122, 321221, 312212, 322112, 322211,
    212123, 212321, 232121, 111323, 131123, 131321, 112313, 132113, 132311, 211313,
    231113, 231311, 112133, 112331, 132131, 113123, 113321, 133121, 313121, 211331,
    231131, 213113, 213311, 213131, 311123, 311321, 331121, 312113, 312311, 332111,
    314111, 221411, 431111, 111224, 111422, 121124, 121421, 141122, 141221, 112214,
    112412, 122114, 122411, 142112, 142211, 241211, 221114, 413111, 241112, 134111,
    111242, 121142, 121241, 114212, 124112, 124211, 411212, 421112, 421211, 212141,
    214121, 412121, 111143, 111341, 131141, 114113, 114311, 411113, 411311, 113141,
    114131, 311141, 411131, 211412, 211214, 211232,
  ];

  const CODE_TO_VALUE = Object.create(null);
  LEGAL_CODES_128.forEach((code, idx) => {
    CODE_TO_VALUE[code] = idx;
  });

  const BUCKET_BITS = 5;

  /** Parse normalized module widths → numeric payload (or null). */
  function tryParse(segments) {
    // 6 symbols × 6 modules (+ optional trailing stop bar of width 2)
    if (!segments || segments.length < 36) return null;
    const values = [];
    for (let i = 0; i < 6; i++) {
      let packed = 0;
      for (let j = 0; j < 6; j++) {
        packed = packed * 10 + segments[i * 6 + j];
      }
      const v = CODE_TO_VALUE[packed];
      if (v == null) return null;
      values.push(v);
    }
    const checkSum = values[5];
    const data = values.slice(0, 5);
    let calculated = 2;
    for (let idx = 0; idx < data.length; idx++) {
      calculated += (idx + 1) * data[idx];
    }
    calculated = calculated % 103;
    if (calculated !== checkSum) return null;
    let code = 0;
    for (let i = 0; i < data.length; i++) {
      code = code * 100 + data[i];
    }
    return code;
  }

  function isValid(segments) {
    if (!segments.length) return false;
    if (segments[segments.length - 1] !== 2) return false;
    let sum = 0;
    for (let i = 0; i < segments.length; i++) {
      if (segments[i] > 4) return false;
      sum += segments[i];
    }
    return sum === 68;
  }

  function normalizeSegments(segments) {
    if (!segments.length) return null;
    const sorted = segments.slice().sort((a, b) => b - a);
    const secondBiggest = sorted[1];
    if (secondBiggest == null) return null;

    let start = 0;
    while (start < segments.length && segments[start] < secondBiggest) start++;
    let end = segments.length - 1;
    while (end >= start && segments[end] < secondBiggest) end--;
    // drop the flanking quiet-zone edges that matched secondBiggest
    start += 1;
    end -= 1;
    if (end < start) return null;

    const onlyShort = segments.slice(start, end + 1);
    let shortest = Infinity;
    for (let i = 0; i < onlyShort.length; i++) {
      if (onlyShort[i] < shortest) shortest = onlyShort[i];
    }
    if (!Number.isFinite(shortest) || shortest <= 0) return null;
    return onlyShort.map((w) => Math.round(w / shortest));
  }

  function findThreshold(samples) {
    const buckets = new Int32Array(1 << BUCKET_BITS);
    for (let i = 0; i < samples.length; i++) {
      const bucketIdx = samples[i] >>> (8 - BUCKET_BITS);
      buckets[bucketIdx]++;
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

  /**
   * Sample one horizontal line of luminance values (0–255).
   * @param {Uint8ClampedArray} data RGBA
   * @param {number} width
   * @param {number} y
   * @param {number} x0
   * @param {number} x1
   */
  function sampleLine(data, width, y, x0, x1) {
    const samples = new Uint8Array(x1 - x0);
    const row = y * width * 4;
    for (let x = x0, i = 0; x < x1; x++, i++) {
      const off = row + x * 4;
      // Rec. 601 luma
      samples[i] = (data[off] * 77 + data[off + 1] * 150 + data[off + 2] * 29) >> 8;
    }
    return samples;
  }

  function runsFromSamples(samples) {
    if (!samples.length) return [];
    const threshold = findThreshold(samples);
    const segments = [];
    let count = 0;
    let last = true; // start as "light" like romkal
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

  /** Try to decode a Bartesian capsule code from one scanline. */
  function decodeLine(samples) {
    const segments = runsFromSamples(samples);
    const normalized = normalizeSegments(segments);
    if (!normalized || !isValid(normalized)) return null;
    return tryParse(normalized);
  }

  /**
   * Scan an ImageData / canvas pixel buffer for a Bartesian capsule barcode.
   * Tries a few horizontal crops (full / center) like aiming the guide band.
   * @returns {number|null} numeric payload
   */
  function scanImageData(imageData) {
    const { data, width, height } = imageData;
    if (width < 80 || height < 40) return null;

    const portrait = height > width;
    const margin = portrait ? 0.4 : 0.3; // match romkal start 4/10 vs 3/10
    const y0 = Math.floor(height * margin);
    const y1 = Math.floor(height * (1 - margin));
    const step = Math.max(1, Math.floor((y1 - y0) / 56));

    const crops = [
      [Math.floor(width * 0.05), Math.floor(width * 0.95)],
      [Math.floor(width / 4), Math.floor(width / 2 + width / 4)],
      [Math.floor(width * 0.15), Math.floor(width * 0.85)],
    ];

    for (let c = 0; c < crops.length; c++) {
      const x0 = crops[c][0];
      const x1 = crops[c][1];
      for (let y = y0; y < y1; y += step) {
        const samples = sampleLine(data, width, y, x0, x1);
        const code = decodeLine(samples);
        if (code != null) return code;
      }
    }
    return null;
  }

  global.BartesianCode128 = {
    tryParse,
    isValid,
    normalizeSegments,
    decodeLine,
    scanImageData,
    LEGAL_CODES_128,
  };
})(window);
