"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CreditRate, HubDirectoryEntry, Material } from "@/lib/api";
import { formatNaira, materialEmoji } from "@/lib/format";
import { Emoji } from "@/app/Emoji";

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

  // Global default rates only (hubId: null) — same simplification as the
  // "Today's rates" table on /requester/dashboard: a hub-specific override
  // may exist, but this is meant as a quick estimate, not a locked-in quote.
  const rateByMaterial = useMemo(() => {
    const map = new Map<string, number>();
    for (const rate of rates) {
      if (rate.hubId === null) map.set(rate.materialCode, Number(rate.creditsPerKg));
    }
    return map;
  }, [rates]);

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
                      {rate !== undefined ? `${rate.toLocaleString()} credits/kg` : "— no published rate"}
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
            Address (optional) — where the material can be picked up from
            <input id="address" name="address" maxLength={500} placeholder="Street and landmark" />
          </label>
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
