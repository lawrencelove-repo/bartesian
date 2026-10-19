/**
 * Live camera barcode capture for Bartesian inventory.
 *
 * 1) Custom Bartesian Code128 C line scan (capsule lids)
 * 2) Optional BarcodeDetector for retail UPC/EAN (cases / packs)
 */
(function (global) {
  function createScanner(options) {
    const opts = options || {};
    const onCode = opts.onCode || function () {};
    const onStatus = opts.onStatus || function () {};
    const onError = opts.onError || function () {};

    let video = null;
    let canvas = null;
    let ctx = null;
    let stream = null;
    let raf = 0;
    let running = false;
    let detector = null;
    let lastCandidate = "";
    let lastCount = 0;
    let lastEmit = 0;

    async function initDetector() {
      if (!("BarcodeDetector" in global)) return null;
      try {
        const formats = await global.BarcodeDetector.getSupportedFormats();
        const wanted = ["upc_a", "upc_e", "ean_13", "ean_8", "code_128"].filter((f) =>
          formats.includes(f)
        );
        if (!wanted.length) return null;
        return new global.BarcodeDetector({ formats: wanted });
      } catch (_) {
        return null;
      }
    }

    function stop() {
      running = false;
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
      }
      if (video) {
        video.srcObject = null;
      }
    }

    function emitStable(code) {
      const now = Date.now();
      if (code === lastCandidate) {
        lastCount += 1;
      } else {
        lastCandidate = code;
        lastCount = 1;
      }
      // Require a few consistent reads; debounce emits
      if (lastCount < 3) return;
      if (now - lastEmit < 1500) return;
      lastEmit = now;
      lastCount = 0;
      onCode(String(code));
    }

    async function tick() {
      if (!running || !video || !ctx || !canvas) return;
      if (video.readyState >= 2) {
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w;
            canvas.height = h;
          }
          ctx.drawImage(video, 0, 0, w, h);
          const imageData = ctx.getImageData(0, 0, w, h);

          // 1) Bartesian capsule (custom Code128)
          if (global.BartesianCode128) {
            const capsule = global.BartesianCode128.scanImageData(imageData);
            if (capsule != null) {
              onStatus("Capsule code " + capsule);
              emitStable(capsule);
              raf = requestAnimationFrame(tick);
              return;
            }
          }

          // 2) Retail barcodes (case / pack) via BarcodeDetector
          if (detector) {
            try {
              const codes = await detector.detect(canvas);
              if (codes && codes.length) {
                const raw = String(codes[0].rawValue || "").replace(/\s+/g, "");
                if (raw) {
                  onStatus("Retail barcode " + raw);
                  emitStable(raw);
                }
              }
            } catch (_) {
              /* ignore frame errors */
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    }

    async function start(videoEl, canvasEl) {
      stop();
      video = videoEl;
      canvas = canvasEl;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      detector = await initDetector();

      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Camera not available in this browser.");
      }

      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();
      running = true;
      lastCandidate = "";
      lastCount = 0;
      onStatus(
        detector
          ? "Point at a capsule lid or case barcode…"
          : "Point at a capsule lid (retail detector unavailable)…"
      );
      raf = requestAnimationFrame(tick);
    }

    return { start, stop, isRunning: () => running };
  }

  global.BartesianCameraScan = { createScanner };
})(window);
