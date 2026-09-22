"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CreditRate, HubDirectoryEntry, Material } from "@/lib/api";
import { formatNaira, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";
import { currentDefaultRates } from "@/lib/rates";

const STEP_KG = 0.5;

function formatKgLocal(value: number): string {
  return value.toFixed(1);
}

interface RequestFormProps {
  hubs: HubDirectoryEntry[];
  materials: Material[];
  rates: CreditRate[];
  /** The `requestPickup` Server Action from page.tsx, passed straight through as a form action. */
  requestPickup: (formData: FormData) => Promise<void>;
}

/**
 * Client component (not a Server Component) specifically because the
 * per-material weight steppers need live client-side state — an estimated
 * credit total that updates on every +/- click, before anything is
 * submitted. State lives here as a plain `{ [materialCode]: weightKg }` map;
 * one hidden input per material mirrors that state into the form so the
 * server action (passed in as `requestPickup`, still a real Server Action)
 * receives it as ordinary form data. Only the visible submit button actually
 * submits — every stepper button is `type="button"`.
 */
export function RequestForm({ hubs, materials, rates, requestPickup }: RequestFormProps) {
  const searchParams = useSearchParams();
  const error = searchParams.get("error");

  const [weights, setWeights] = useState<Record<string, number>>(() =>
    Object.fromEntries(materials.map((m) => [m.code, 0])),
  );

  /**
   * The pickup pin, if the requester chooses to share it.
   *
   * Opt-in behind a button rather than requested on mount: a permission prompt
   * that appears before the person has said what they want reads as a demand,
   * and most people dismiss it permanently. Asking after they have decided to
   * book a pickup is when the reason for it is obvious.
   *
   * Never required. A typed address is how every pickup worked before this
   * existed, and a refusal here must cost nothing.
   */
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState<string | null>(null);

  function shareLocation() {
    if (!("geolocation" in navigator)) {
      setLocationNote("This browser cannot share a location. Your typed address will be used.");
      return;
    }

    setLocating(true);
    setLocationNote(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({
          // Six decimals is ~11 cm — finer than any phone fix, and the column's
          // precision. Trimming here keeps the value the backend stores identical
          // to the one shown back.
          latitude: Number(position.coords.latitude.toFixed(6)),
          longitude: Number(position.coords.longitude.toFixed(6)),
        });
        setLocating(false);
        setLocationNote(null);
      },
      (error) => {
        setLocating(false);
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? "Location not shared. Your collector will use the address above."
            : "Could not get a location fix. Your collector will use the address above.",
        );
      },
      // A doorstep pin is worth waiting a few seconds for, but not worth
      // hanging the form on; a cached fix from the last minute is fine.
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  // The rate in effect now for each material, global default only: a quick
  // estimate, not a locked-in quote. Picking by date matters: the API lists
  // every rate ever set, newest first, so taking whichever came last in the
  // list quoted the oldest rate.
  const rateByMaterial = useMemo(
    () => new Map(currentDefaultRates(rates).map((r) => [r.materialCode, Number(r.creditsPerKg)])),
    [rates],
  );

  function adjust(code: string, delta: number) {
    setWeights((prev) => {
      const next = Math.max(0, Math.round(((prev[code] ?? 0) + delta) * 10) / 10);
      return { ...prev, [code]: next };
    });
  }

  const totalKg = Object.values(weights).reduce((sum, w) => sum + w, 0);
  const totalCredits = materials.reduce((sum, m) => {
    const weight = weights[m.code] ?? 0;
    const rate = rateByMaterial.get(m.code);
    return sum + (weight > 0 && rate !== undefined ? weight * rate : 0);
  }, 0);
  const hasAnyWeight = totalKg > 0;

  return (
    <>
      <header style={{ padding: "1.5rem 0 1rem" }}>
        <p className="rq-eyebrow">Request a pickup</p>
        <h1 style={{ margin: 0, fontSize: "1.75rem", fontWeight: 800, lineHeight: 1.15 }}>
          Weigh out what you have
        </h1>
      </header>

      {error ? <p className="rq-error">{decodeURIComponent(error)}</p> : null}

      <form action={requestPickup}>
        <section className="rq-section" style={{ paddingTop: 0 }}>
          {materials.map((m) => {
            const weight = weights[m.code] ?? 0;
            const rate = rateByMaterial.get(m.code);
            const lineCredits = rate !== undefined ? weight * rate : 0;

            return (
              <div key={m.code} className="rq-card">
                <div className="rq-row">
                  <div>
                    <p style={{ margin: 0, fontWeight: 700 }}>
                      <Emoji>{materialEmoji(m.code)}</Emoji> {m.name}
                    </p>
                    {m.description ? (
                      <p style={{ margin: "0.25rem 0 0", fontSize: "0.8125rem", color: "var(--rq-text-soft)" }}>
                        {m.description}
                      </p>
                    ) : null}
                    <p style={{ margin: "0.25rem 0 0", fontSize: "0.75rem", color: "var(--rq-text-faint)" }}>
                      {rate !== undefined ? `${rate.toLocaleString()} credits/kg` : "No published rate"}
                    </p>
                  </div>
                  <div className="rq-stepper">
                    <button
                      type="button"
                      aria-label={`Decrease ${m.name} weight`}
                      onClick={() => adjust(m.code, -STEP_KG)}
                    >
                      −
                    </button>
                    <output>{formatKgLocal(weight)} kg</output>
                    <button
                      type="button"
                      aria-label={`Increase ${m.name} weight`}
                      onClick={() => adjust(m.code, STEP_KG)}
                    >
                      +
                    </button>
                  </div>
                </div>
                {weight > 0 ? (
                  <p
                    style={{
                      margin: "0.5rem 0 0",
                      fontWeight: 700,
                      fontVariantNumeric: "tabular-nums",
                      color: "var(--rq-accent-700)",
                    }}
                  >
                    ≈ {rate !== undefined ? `${lineCredits.toLocaleString()} credits (${formatNaira(lineCredits)})` : "—"}
                  </p>
                ) : null}
                <input type="hidden" name={`material-${m.code}`} value={weight} />
              </div>
            );
          })}
        </section>

        <div className="rq-card" style={{ textAlign: "center" }}>
          <p className="rq-eyebrow" style={{ margin: 0 }}>
            Estimated total
          </p>
          <p
            style={{
              margin: "0.25rem 0 0",
              fontWeight: 800,
              fontSize: "2rem",
              lineHeight: 1,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {formatKgLocal(totalKg)} kg
          </p>
          <p style={{ margin: "0.375rem 0 0", fontVariantNumeric: "tabular-nums" }}>
            estimated {totalCredits.toLocaleString()} credits ({formatNaira(totalCredits)})
          </p>
        </div>

        <section className="rq-section">
          <label className="rq-field" htmlFor="hubId">
            Hub
            <select id="hubId" name="hubId" required defaultValue="">
              <option value="" disabled>
                Select a hub
              </option>
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.code})
                </option>
              ))}
            </select>
          </label>
          <label className="rq-field" htmlFor="address">
            Address (optional, where the material can be picked up from)
            <input id="address" name="address" maxLength={500} placeholder="Street and landmark" />
          </label>
          <div className="rq-field">
            <span>Pickup location (optional)</span>
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.8125rem", color: "var(--rq-text-soft)" }}>
              {coords
                ? `Pin shared. Your collector will get directions straight to you.`
                : "Share a pin so your collector can navigate to you instead of hunting for the address."}
            </p>
            <button
              className="rq-btn"
              type="button"
              onClick={shareLocation}
              disabled={locating}
              style={{ justifyContent: "center" }}
            >
              {locating ? "Getting location…" : coords ? "Update my location" : "Use my current location"}
            </button>
            {locationNote ? (
              <p style={{ margin: "0.5rem 0 0", fontSize: "0.8125rem", color: "var(--rq-text-soft)" }}>
                {locationNote}
              </p>
            ) : null}
            {coords ? (
              <>
                <input type="hidden" name="latitude" value={coords.latitude} />
                <input type="hidden" name="longitude" value={coords.longitude} />
              </>
            ) : null}
          </div>
          <label className="rq-field" htmlFor="notes">
            Notes (optional)
            <textarea id="notes" name="notes" maxLength={1000} />
          </label>
        </section>

        <button
          className="rq-btn"
          data-variant="primary"
          type="submit"
          disabled={!hasAnyWeight}
          style={{ justifyContent: "center" }}
        >
          Request pickup
        </button>
      </form>
    </>
  );
}
