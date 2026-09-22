"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scan a collector's QR into a code field, and optionally submit it.
 *
 * Detection is the platform `BarcodeDetector` where the browser has one
 * (Chrome, Android WebView) and the `barcode-detector` ponyfill everywhere
 * else. That fallback is what makes scanning work on an iPhone at all: Safari
 * and Firefox ship no detector, and before it this button simply did not
 * appear for them. The ponyfill is the same API over a WebAssembly build of
 * ZXing, loaded on first use only, so browsers with a native detector never
 * download it.
 *
 * The code lands in the form's own input (`targetInputId`) and, with
 * `autoSubmit`, the form is submitted through `requestSubmit()`. That runs the
 * form's own Server Action exactly as tapping its button would, so scanning is
 * not a second redemption path to keep correct, only a faster way to fill the
 * one field. Typing the code printed under the QR always still works.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

/** The native detector if it reads QR codes, else the ponyfill. */
async function loadDetector(): Promise<BarcodeDetectorLike> {
  const native = (window as unknown as {
    BarcodeDetector?: BarcodeDetectorCtor & { getSupportedFormats?: () => Promise<string[]> };
  }).BarcodeDetector;

  if (typeof native === "function") {
    const formats = (await native.getSupportedFormats?.().catch(() => [])) ?? [];
    if (formats.includes("qr_code")) return new native({ formats: ["qr_code"] });
  }

  const { BarcodeDetector } = await import("barcode-detector/ponyfill");
  return new BarcodeDetector({ formats: ["qr_code"] }) as unknown as BarcodeDetectorLike;
}

export function ScanButton({
  targetInputId = "redemptionCode",
  autoSubmit = false,
  label = "Scan the collector’s QR",
  primary = false,
}: {
  targetInputId?: string;
  autoSubmit?: boolean;
  label?: string;
  primary?: boolean;
}) {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  // A camera is the only requirement now that detection has a fallback. Read
  // in an effect, not during render: `navigator` does not exist while this is
  // server-rendered, and reading it there would mismatch on hydration.
  useEffect(() => {
    setSupported(typeof navigator.mediaDevices?.getUserMedia === "function");
  }, []);

  /**
   * Release the camera.
   *
   * Idempotent and called from everywhere: the success path, the error path,
   * the cancel button and unmount. A camera left running is a recording light
   * that stays on after the user thinks they are done, which is the one bug
   * this component absolutely must not have.
   */
  function stop() {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScanning(false);
  }

  useEffect(() => stop, []);

  function deliver(code: string) {
    const input = document.getElementById(targetInputId) as HTMLInputElement | null;
    if (!input) return;

    input.value = code.toUpperCase();
    // Dispatched so React (and any validation listening on the form) sees the
    // change; setting `.value` alone fires nothing.
    input.dispatchEvent(new Event("input", { bubbles: true }));

    if (autoSubmit && input.form) {
      input.form.requestSubmit();
    } else {
      input.focus();
    }
  }

  async function start() {
    setError(null);
    setScanning(true);

    try {
      const [detector, stream] = await Promise.all([
        loadDetector(),
        navigator.mediaDevices.getUserMedia({
          // The rear camera by default: nobody scans a code with the selfie
          // camera. `ideal` rather than `exact` so a laptop with one camera
          // still works instead of throwing.
          video: { facingMode: { ideal: "environment" } },
        }),
      ]);
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stop();
        return;
      }
      video.srcObject = stream;
      // iOS refuses to play an inline video without this pair set before play().
      video.setAttribute("playsinline", "true");
      video.muted = true;
      await video.play();

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;

        try {
          const results = await detector.detect(videoRef.current);
          const code = results[0]?.rawValue?.trim();
          if (code) {
            stop();
            deliver(code);
            return;
          }
        } catch {
          // A frame that will not decode is the normal case, not an error:
          // most frames are blur. Keep scanning.
        }

        frameRef.current = requestAnimationFrame(() => void tick());
      };

      frameRef.current = requestAnimationFrame(() => void tick());
    } catch (err) {
      stop();
      setError(
        (err as Error)?.name === "NotAllowedError"
          ? "Camera access was declined. Type the code printed under the QR instead."
          : "Could not start the scanner. Type the code printed under the QR instead.",
      );
    }
  }

  if (!supported) return null;

  return (
    <div className="rq-scan">
      {/* Always mounted so the ref exists before the stream arrives; hidden
          until there is something to show. */}
      <div className="rq-scan-view" hidden={!scanning}>
        <video ref={videoRef} className="rq-scan-video" />
        <span className="rq-scan-frame" aria-hidden="true" />
      </div>
      {scanning ? (
        <button className="rq-btn" type="button" onClick={stop}>
          Cancel scan
        </button>
      ) : (
        <button
          className="rq-btn"
          data-variant={primary ? "primary" : undefined}
          type="button"
          onClick={() => void start()}
        >
          {label}
        </button>
      )}
      {error ? <p className="rq-scan-error">{error}</p> : null}
    </div>
  );
}
