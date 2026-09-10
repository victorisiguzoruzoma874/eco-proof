import { Suspense } from "react";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  api,
  requesterApi,
  ApiError,
  type CreditRate,
  type HubDirectoryEntry,
  type Material,
} from "@/lib/api";
import { RequestForm } from "./RequestForm";

export const dynamic = "force-dynamic";

/**
 * The dedicated "request a pickup" screen — richer than the old inline form
 * that used to sit at the bottom of `/requester/dashboard` (now relocated
 * and upgraded here, see that page's doc comment). A requester weighs out
 * however many materials they have ready, each with its own live-updating
 * stepper, and submits them all in one visit.
 *
 * The backend's `POST /requests` (`CreateCollectionRequestDto`, in
 * `apps/backend/src/common/dto.ts`) and `requesterApi.createRequest` both
 * take exactly one `material` + one `estimatedWeightKg` per call — there is
 * no array-of-materials shape on this endpoint. So a submission with several
 * materials weighed in becomes several sequential `createRequest` calls
 * below, one per material with a nonzero weight, rather than one call
 * carrying a list.
 */

async function requestPickup(formData: FormData) {
  "use server";

  const hubId = String(formData.get("hubId") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const notes = String(formData.get("notes") ?? "").trim();

  const weighed: { code: string; weightKg: number }[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("material-")) continue;
    const weightKg = Number(value);
    if (Number.isFinite(weightKg) && weightKg > 0) {
      weighed.push({ code: key.slice("material-".length), weightKg });
    }
  }

  if (!hubId || weighed.length === 0) {
    redirect(
      `/requester/request?error=${encodeURIComponent(
        "Select a hub and weigh out at least one material.",
      )}`,
    );
  }

  try {
    // Sequential, not Promise.all: each call is a real write against the
    // requester's own request list, and running them one after another keeps
    // the error (if one material fails, e.g. an unknown code) attributable
    // to that specific material rather than racing several writes at once.
    for (const { code, weightKg } of weighed) {
      await requesterApi.createRequest({
        hubId,
        material: code,
        estimatedWeightKg: weightKg,
        ...(address ? { address } : {}),
        ...(notes ? { notes } : {}),
      });
    }
  } catch (error) {
    redirect(`/requester/request?error=${encodeURIComponent(messageOf(error))}`);
  }

  revalidatePath("/requester/dashboard");
  redirect("/requester/dashboard?requested=true");
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) {
    return error.detail ?? `Request failed (${error.status}).`;
  }
  return "Could not reach the backend.";
}

export default async function RequesterRequestPage() {
  try {
    await requesterApi.me();
  } catch (err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      redirect("/requester/login");
    }
    return (
      <div className="rq-card">
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  let hubs: HubDirectoryEntry[];
  let materials: Material[];
  let rates: CreditRate[];
  try {
    [hubs, materials, rates] = await Promise.all([
      api.hubDirectory(),
      api.materials(),
      api.listCreditRates(),
    ]);
  } catch {
    return (
      <div className="rq-card">
        <p className="rq-error">Could not reach the backend.</p>
      </div>
    );
  }

  const offeredMaterials = materials.filter((m) => m.active);

  return (
    // RequestForm reads `?error=` via useSearchParams (it's a client
    // component so that's available) — Suspense here is what Next.js
    // requires around that hook so the rest of the page isn't forced out of
    // static analysis by it, even though this route is already
    // force-dynamic end to end.
    <Suspense fallback={null}>
      <RequestForm
        hubs={hubs}
        materials={offeredMaterials}
        rates={rates}
        requestPickup={requestPickup}
      />
    </Suspense>
  );
}
