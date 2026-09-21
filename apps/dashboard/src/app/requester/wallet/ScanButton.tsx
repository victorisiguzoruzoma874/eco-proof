"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Scan the collector's QR straight into the redemption field.
 *
 * Built on `BarcodeDetector`, which is native in Chrome and Android WebView —
 * the browsers this actually ships to — rather than pulling in a WASM decoder.
 * Where it is missing (Safari, Firefox) this component renders nothing at all
 * and the typed-code path is simply what the requester uses, which is exactly
 * how it worked before. The 8-character code printed under every QR exists for
 * this reason, so the fallback is a real one, not a dead end.
 *
 * Writes into the existing `#redemptionCode` input and leaves submission to
 * the form's own Server Action: a scanner that also submitted would be a
 * second, subtly different redemption path to keep correct.
 */

interface DetectedBarcode {
  rawValue: string;
}

interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function detectorCtor(): BarcodeDetectorCtor | null {
  const ctor = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
  return typeof ctor === "function" ? ctor : null;
}

export function ScanButton() {
  const [supported, setSupported] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);

  // Feature detection runs in an effect, not during render: `window` does not
  // exist while this is server-rendered, and reading it there would mean the
  // markup React hydrates into disagrees with what the server sent.
  useEffect(() => {
    setSupported(detectorCtor() !== null && typeof navigator.mediaDevices?.getUserMedia === "function");
  }, []);

  /**
   * Release the camera.
   *
   * Idempotent and called from everywhere — the success path, the error path,
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

  async function start() {
    const Detector = detectorCtor();
    if (!Detector) return;

    setError(null);
    setScanning(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The rear camera by default — nobody scans a code with the selfie
        // camera, and `ideal` rather than `exact` so a laptop with only one
        // camera still works instead of throwing.
        video: { facingMode: { ideal: "environment" } },
      });
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

      const detector = new Detector({ formats: ["qr_code"] });

      const tick = async () => {
        if (!streamRef.current || !videoRef.current) return;

        try {
          const results = await detector.detect(videoRef.current);
          const code = results[0]?.rawValue?.trim();
          if (code) {
            const input = document.getElementById("redemptionCode") as HTMLInputElement | null;
            if (input) {
              input.value = code.toUpperCase();
              // Dispatched so React (and any validation listening on the form)
              // sees the change — setting `.value` alone fires nothing.
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.focus();
            }
            stop();
            return;
          }
        } catch {
          // A frame that will not decode is the normal case, not an error —
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
          : "Could not open the camera. Type the code printed under the QR instead.",
      );
    }
  }

  if (!supported) return null;

  return (
    <div style={{ marginBottom: "0.75rem" }}>
      {scanning ? (
        <div>
          <video
            ref={videoRef}
            style={{
              width: "100%",
              maxWidth: "320px",
              borderRadius: "8px",
              background: "#000",
              display: "block",
            }}
          />
          <button
            className="rq-btn"
            type="button"
            onClick={stop}
            style={{ marginTop: "0.5rem", justifyContent: "center" }}
          >
            Cancel scan
          </button>
        </div>
      ) : (
        <button className="rq-btn" type="button" onClick={() => void start()} style={{ justifyContent: "center" }}>
          Scan the collector&rsquo;s QR
        </button>
      )}
      {error ? (
        <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--rq-text-soft)" }}>{error}</p>
      ) : null}
    </div>
  );
}
