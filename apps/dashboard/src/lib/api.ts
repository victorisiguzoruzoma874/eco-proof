import { cookies } from "next/headers";

/**
 * Server-side backend client.
 *
 * All reads happen in server components so the operator's token stays in an
 * httpOnly cookie and never reaches client JavaScript. The dashboard shows
 * evidence about saleable credits; a token in localStorage would put that
 * behind any XSS on the page.
 */

export const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3000";
export const TOKEN_COOKIE = "proofchain_token";
/**
 * A requester (self-registering consumer) is a different trust boundary from
 * an operator — its own JWT (`kind: "requester"`, see `RequesterAuthGuard`),
 * so it lives in its own cookie. Never read/write this alongside
 * `TOKEN_COOKIE` in the same request — see `requesterRequest` below.
 */
export const REQUESTER_TOKEN_COOKIE = "proofchain_requester_token";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** The backend's own explanation, when it sent one worth showing a person. */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * Nest's exception filter sends `{ message }`, sometimes as an array of
 * validation failures. Anything unreadable yields undefined rather than dumping
 * a stringified body onto the page.
 */
async function detailOf(res: Response): Promise<string | undefined> {
  try {
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) return undefined;

    const message = (body as { message?: unknown }).message;
    if (typeof message === "string") return message;
    if (Array.isArray(message)) return message.filter((m) => typeof m === "string").join("; ");
    return undefined;
  } catch {
    return undefined;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(TOKEN_COOKIE)?.value;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    // Evidence must never be served stale: a report page showing a stale
    // reweigh/payout state after either changed would undermine the point.
    cache: "no-store",
  });

  if (!res.ok) {
    // Carry the backend's own message through. Several of these are the only
    // useful thing on screen — "material PS is used by 240 event(s) … retire it
    // instead" tells an operator what to do, whereas "DELETE /materials/PS
    // failed" tells them to guess.
    throw new ApiError(`${init.method ?? "GET"} ${path} failed`, res.status, await detailOf(res));
  }
  return (await res.json()) as T;
}

/**
 * Parallel client for the requester trust boundary — reads
 * `REQUESTER_TOKEN_COOKIE` instead of `TOKEN_COOKIE`, everything else
 * identical to `request<T>()`. Kept as a separate function rather than a
 * parameterised one so a page can never accidentally pass the wrong cookie
 * name for a call site — the plan is explicit that operator and requester
 * auth must never be confused, and two small functions make that mistake
 * impossible to typo into existence.
 */
async function requesterRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = (await cookies()).get(REQUESTER_TOKEN_COOKIE)?.value;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new ApiError(`${init.method ?? "GET"} ${path} failed`, res.status, await detailOf(res));
  }
  return (await res.json()) as T;
}

export interface Batch {
  id: string;
  hubId: string;
  material: string;
  status: "open" | "sealed" | "processed" | "sold";
  totalWeightKg: string | number;
  eventCount: number;
  merkleRoot: string | null;
  sealedAt: string | null;
  createdAt: string;
}

export interface CollectionEvent {
  id: string;
  collectorId: string;
  hubId: string;
  deviceId: string;
  batchId: string | null;
  weightKg: string | number;
  material: string;
  capturedAt: string;
  receivedAt: string;
  photoHash: string;
  payloadHash: string;
  quarantined: boolean;
  integrity: {
    outcome: "pass" | "warn" | "fail";
    findings: { check: string; outcome: string; detail?: string }[];
  };
}

export interface AuditReport {
  reportVersion: string;
  generatedAt: string;
  batch: {
    id: string;
    status: string;
    material: string;
    totalWeightKg: number;
    totalWeightTonnes: number;
    eventCount: number;
    sealedAt: string | null;
    createdAt: string;
  };
  hub: {
    id: string;
    code: string;
    name: string;
    /** OSM-derived place name; descriptive only, never part of the proof. */
  };
  collectors: {
    id: string;
    name: string;
    kycLevel: string;
    eventCount: number;
    weightKg: number;
  }[];
  chainOfCustody: {
    id: string;
    fromParty: string;
    toParty: string;
    weightInKg: number;
    weightOutKg: number;
    varianceKg: number;
    variancePct: number | null;
    reason: string | null;
    transferredAt: string;
  }[];
  reconciliation: {
    collectedKg: number;
    finalWeightOutKg: number | null;
    gapKg: number | null;
    gapPct: number | null;
    explained: boolean;
  };
  proof: {
    merkleRoot: string | null;
    recomputedRoot: string | null;
    rootMatchesSealedValue: boolean;
    allProofsValid: boolean;
    leafHashAlgorithm: string;
    nodeHashAlgorithm: string;
    ordering: string;
  };
  events: {
    eventId: string;
    collectorName: string;
    weightKg: number;
    material: string;
    capturedAt: string;
    photoHash: string;
    photoAvailable: boolean;
    /** Relative to the backend origin; null until the bytes are uploaded. */
    photoUrl: string | null;
    payloadHash: string;
    leaf: string;
    integrityOutcome: string;
  }[];
  /**
   * The hub re-weigh against each event's claimed weight, where one has been
   * recorded. An event with no reweigh yet simply has no entry here.
   */
  reweighs: {
    eventId: string;
    claimedWeightKg: number;
    verifiedWeightKg: number;
    variancePct: number;
    status: string;
  }[];
  /** Payment runs covering one or more of this batch's reweighs. */
  payouts: {
    id: string;
    collectorId: string;
    amount: number;
    currency: string;
    method: string;
    status: string;
    paidAt: string | null;
  }[];
  attestationNotes: string[];
}

export interface EventReweigh {
  id: string;
  eventId: string;
  claimedWeightKg: string | number;
  verifiedWeightKg: string | number;
  varianceKg: string | number;
  variancePct: string | number;
  status: "verified" | "flagged" | "rejected";
  /** Required whenever status is flagged/rejected — the audit trail for why it diverged. */
  notes: string | null;
  verifiedByUserId: string;
  verifiedAt: string;
  createdAt: string;
}

export interface Payout {
  id: string;
  collectorId: string;
  amount: string | number;
  currency: string;
  /** e.g. "cash" | "mobile_money" | "bank" — free text, not an enforced enum. */
  method: string;
  payoutRef: string | null;
  status: "pending" | "paid" | "failed";
  paidByUserId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface MaterialRate {
  id: string;
  materialCode: string;
  /** Null = global default rate; set = an override scoped to one hub. */
  hubId: string | null;
  ratePerKg: string | number;
  effectiveFrom: string;
  createdAt: string;
}

export interface Material {
  code: string;
  name: string;
  description: string | null;
  /** Products a collector would recognise this material as. Never null. */
  examples: string[];
  active: boolean;
  sortOrder: number;
}

export interface CurrentUser {
  id: string;
  email: string;
  role: "admin" | "operator" | "auditor";
}

/** A capture device's own hub list — trimmed, and public (`GET /hubs/directory`). */
export interface HubDirectoryEntry {
  id: string;
  code: string;
  name: string;
  minWeightKg: number;
  maxWeightKg: number;
}

/** A requester's own profile, as `GET /requesters/me` returns it — never a passwordHash. */
export interface Requester {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  active: boolean;
  createdAt: string;
}

/**
 * A household/business pickup request. `status` walks
 * `requested -> assigned (optional) -> collected (redemption code issued) ->
 * redeemed`, plus `cancelled` from `requested`/`assigned` — see
 * `CollectionRequestEntity`'s doc comment in the backend.
 */
export interface CollectionRequest {
  id: string;
  requesterId: string;
  hubId: string;
  material: string;
  estimatedWeightKg: string | number | null;
  address: string | null;
  notes: string | null;
  latitude: string | number | null;
  longitude: string | number | null;
  status: "requested" | "assigned" | "collected" | "redeemed" | "cancelled";
  assignedCollectorId: string | null;
  eventId: string | null;
  /** Set once fulfilled; render it as a QR code (see `qrcode`'s `toDataURL`). */
  redemptionCode: string | null;
  redeemedAt: string | null;
  /** The weight the credit was computed from — the hub's, or the collector's at the door. */
  creditedWeightKg: string | number | null;
  /** Set once a doorstep credit has been settled against the hub's re-weigh. */
  reconciledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  walletId: string;
  type: "credit" | "debit";
  amountCredits: string | number;
  collectionRequestId: string | null;
  eventId: string | null;
  description: string | null;
  createdAt: string;
}

/**
 * A requester's cash-out request against their wallet — mirrors `Payout`'s
 * `pending -> paid` shape exactly, see `WithdrawalRequestEntity`'s doc
 * comment in the backend. `"rejected"` releases the hold with no debit ever
 * written.
 */
export interface WithdrawalRequest {
  id: string;
  requesterId: string;
  amountCredits: string | number;
  status: "pending" | "paid" | "rejected";
  payoutRef: string | null;
  paidByUserId: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface WalletView {
  walletId: string;
  balanceCredits: number;
  transactions: WalletTransaction[];
  /** The requester's own not-yet-paid withdrawals — money "on hold". */
  pendingWithdrawals: WithdrawalRequest[];
}

/**
 * A listing in the redemption catalog an admin maintains — a requester
 * exchanges wallet credits for a listed item instead of, or alongside,
 * cashing out via `WithdrawalRequest`. `stock: null` means unlimited.
 */
export interface CatalogItem {
  id: string;
  name: string;
  description: string | null;
  /** Free text, e.g. "airtime" | "goods" | "discount" — not an enforced enum. */
  category: string;
  costCredits: string | number;
  stock: number | null;
  active: boolean;
  createdAt: string;
}

/**
 * One requester's redemption of a catalog item — debits the wallet
 * immediately (unlike `WithdrawalRequest`), then walks
 * `"pending_fulfillment" -> "fulfilled"` as the operational hand-over.
 */
export interface CatalogRedemption {
  id: string;
  requesterId: string;
  itemId: string;
  /** Copied from the item at redemption time — a later price change never rewrites this. */
  costCredits: string | number;
  status: "pending_fulfillment" | "fulfilled";
  fulfilledByUserId: string | null;
  fulfilledAt: string | null;
  createdAt: string;
}

/** Waste-credit equivalent of `MaterialRate` — same resolution rule, different beneficiary. */
export interface CreditRate {
  id: string;
  materialCode: string;
  hubId: string | null;
  creditsPerKg: string | number;
  effectiveFrom: string;
  createdAt: string;
}

export const api = {
  me: () => request<CurrentUser>("/auth/me"),
  materials: () => request<Material[]>("/materials"),
  createMaterial: (body: {
    code: string;
    name: string;
    description?: string;
    examples?: string[];
    sortOrder?: number;
  }) => request<Material>("/materials", { method: "POST", body: JSON.stringify(body) }),
  updateMaterial: (
    code: string,
    body: {
      name?: string;
      description?: string;
      examples?: string[];
      active?: boolean;
      sortOrder?: number;
    },
  ) => request<Material>(`/materials/${code}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteMaterial: (code: string) =>
    request<{ code: string; deleted: true }>(`/materials/${code}`, { method: "DELETE" }),
  listBatches: (status?: string) =>
    request<Batch[]>(`/batches${status ? `?status=${status}` : ""}`),
  getBatch: (id: string) => request<Batch>(`/batches/${id}`),
  batchEvents: (id: string) => request<CollectionEvent[]>(`/batches/${id}/events`),
  listEvents: (query: string) => request<CollectionEvent[]>(`/events?${query}`),
  getEvent: (id: string) => request<CollectionEvent>(`/events/${id}`),
  getEventByLookupCode: (code: string) =>
    request<CollectionEvent>(`/events/by-code/${encodeURIComponent(code)}`),
  report: (id: string) => request<AuditReport>(`/batches/${id}/report`),
  hubs: () => request<{ id: string; code: string; name: string }[]>("/hubs"),
  collectors: () => request<{ id: string; name: string }[]>("/collectors"),
  recordReweigh: (eventId: string, body: { verifiedWeightKg: number; notes?: string }) =>
    request<EventReweigh>(`/events/${eventId}/reweigh`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getReweigh: (eventId: string) => request<EventReweigh[]>(`/events/${eventId}/reweigh`),
  createPayout: (body: { collectorId: string; eventReweighIds: string[]; method: string }) =>
    request<Payout>("/payouts", { method: "POST", body: JSON.stringify(body) }),
  markPayoutPaid: (id: string, body?: { payoutRef?: string }) =>
    request<Payout>(`/payouts/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  listPayouts: (collectorId?: string) =>
    request<Payout[]>(`/payouts${collectorId ? `?collectorId=${collectorId}` : ""}`),
  getPayout: (id: string) => request<Payout>(`/payouts/${id}`),
  createMaterialRate: (body: {
    materialCode: string;
    hubId?: string;
    ratePerKg: number;
    effectiveFrom?: string;
  }) => request<MaterialRate>("/material-rates", { method: "POST", body: JSON.stringify(body) }),
  listMaterialRates: (query?: { materialCode?: string; hubId?: string }) => {
    const params = new URLSearchParams();
    if (query?.materialCode) params.set("materialCode", query.materialCode);
    if (query?.hubId) params.set("hubId", query.hubId);
    const qs = params.toString();
    return request<MaterialRate[]>(`/material-rates${qs ? `?${qs}` : ""}`);
  },
  /** Public — the trimmed hub list capture devices (and the requester dashboard) can read without a login. */
  hubDirectory: () => request<HubDirectoryEntry[]>("/hubs/directory"),
  // ---- Requester pickup requests, operator side (operator-authenticated, `@Roles admin,operator`). ----
  listRequests: (query?: { status?: string; hubId?: string }) => {
    const params = new URLSearchParams();
    if (query?.status) params.set("status", query.status);
    if (query?.hubId) params.set("hubId", query.hubId);
    const qs = params.toString();
    return request<CollectionRequest[]>(`/requests${qs ? `?${qs}` : ""}`);
  },
  assignRequest: (id: string, collectorId: string) =>
    request<CollectionRequest>(`/requests/${id}/assign`, {
      method: "POST",
      body: JSON.stringify({ collectorId }),
    }),
  fulfillRequest: (id: string, eventId: string) =>
    request<CollectionRequest>(`/requests/${id}/fulfill`, {
      method: "POST",
      body: JSON.stringify({ eventId }),
    }),
  cancelRequest: (id: string) =>
    request<CollectionRequest>(`/requests/${id}/cancel`, { method: "POST" }),
  // ---- Waste-credit rate table, mirrors createMaterialRate/listMaterialRates exactly. ----
  createCreditRate: (body: {
    materialCode: string;
    hubId?: string;
    creditsPerKg: number;
    effectiveFrom?: string;
  }) => request<CreditRate>("/credit-rates", { method: "POST", body: JSON.stringify(body) }),
  listCreditRates: (query?: { materialCode?: string; hubId?: string }) => {
    const params = new URLSearchParams();
    if (query?.materialCode) params.set("materialCode", query.materialCode);
    if (query?.hubId) params.set("hubId", query.hubId);
    const qs = params.toString();
    return request<CreditRate[]>(`/credit-rates${qs ? `?${qs}` : ""}`);
  },
  // ---- Withdrawal (cash-out) queue, operator side — mirrors listPayouts/markPayoutPaid. ----
  listWithdrawals: (status?: string) =>
    request<WithdrawalRequest[]>(`/wallet/withdrawals${status ? `?status=${status}` : ""}`),
  markWithdrawalPaid: (id: string, body?: { payoutRef?: string }) =>
    request<WithdrawalRequest>(`/wallet/withdrawals/${id}/mark-paid`, {
      method: "POST",
      body: JSON.stringify(body ?? {}),
    }),
  rejectWithdrawal: (id: string) =>
    request<WithdrawalRequest>(`/wallet/withdrawals/${id}/reject`, { method: "POST" }),
  /** Public — a requester browses the catalogue before deciding whether to redeem, same as `materials()`. */
  catalogItems: () => request<CatalogItem[]>("/catalog-items"),
  createCatalogItem: (body: {
    name: string;
    description?: string;
    category: string;
    costCredits: number;
    stock?: number;
  }) => request<CatalogItem>("/catalog-items", { method: "POST", body: JSON.stringify(body) }),
  // ---- Catalog-redemption fulfillment queue, operator side. ----
  fulfillCatalogRedemption: (id: string) =>
    request<CatalogRedemption>(`/catalog-redemptions/${id}/fulfill`, { method: "POST" }),
  listCatalogRedemptions: (status?: string) =>
    request<CatalogRedemption[]>(`/catalog-redemptions${status ? `?status=${status}` : ""}`),
};

/**
 * The requester-facing client — a household/business asking for a pickup,
 * self-registered, a different trust boundary from the operator `api` above
 * (see `REQUESTER_TOKEN_COOKIE`'s doc comment). Every call here goes through
 * `requesterRequest`, never `request`, so an operator page can never
 * accidentally read requester data with the wrong cookie or vice versa.
 */
export const requesterApi = {
  register: (body: { name: string; email: string; password: string; phone?: string }) =>
    requesterRequest<{ accessToken: string; requester: Requester }>("/requesters/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  login: (body: { email: string; password: string }) =>
    requesterRequest<{ accessToken: string; requester: Requester }>("/requesters/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  me: () => requesterRequest<Requester>("/requesters/me"),
  createRequest: (body: {
    hubId: string;
    material: string;
    estimatedWeightKg?: number;
    address?: string;
    notes?: string;
    /** Sent only as a complete pair; the backend rejects one without the other. */
    latitude?: number;
    longitude?: number;
  }) => requesterRequest<CollectionRequest>("/requests", { method: "POST", body: JSON.stringify(body) }),
  myRequests: () => requesterRequest<CollectionRequest[]>("/requests/mine"),
  getWallet: () => requesterRequest<WalletView>("/wallet"),
  redeemCode: (redemptionCode: string) =>
    requesterRequest<{ transaction: WalletTransaction; balanceCredits: number }>("/wallet/redeem", {
      method: "POST",
      body: JSON.stringify({ redemptionCode }),
    }),
  withdraw: (amountCredits: number) =>
    requesterRequest<WithdrawalRequest>("/wallet/withdraw", {
      method: "POST",
      body: JSON.stringify({ amountCredits }),
    }),
  redeemCatalogItem: (itemId: string) =>
    requesterRequest<{ redemption: CatalogRedemption; balanceCredits: number }>(
      "/wallet/redeem-catalog-item",
      { method: "POST", body: JSON.stringify({ itemId }) },
    ),
};

export function kg(value: string | number): number {
  return Number(value);
}
