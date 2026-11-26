import { redirect } from "next/navigation";
import { api, ApiError, type CurrentUser } from "@/lib/api";
import { signOut } from "../(operator)/sign-out";

export const dynamic = "force-dynamic";

/**
 * Where a collector lands after signing in. Shows whose account this is;
 * weigh-ins are still recorded through the collector's paired phone at the
 * hub, not here.
 */
export default async function CollectorHomePage() {
  let me: CurrentUser;
  try {
    me = await api.me();
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      redirect("/login");
    }
    throw error;
  }
  // Staff who wander here belong on the staff dashboard.
  if (me.role !== "collector") redirect("/");

  return (
    <div className="rq-card" style={{ marginTop: "2.5rem" }}>
      <p className="rq-eyebrow">Collector account</p>
      <h1 style={{ margin: "0 0 1.25rem", fontSize: "1.5rem" }}>
        Welcome{me.collector ? `, ${me.collector.name.split(/\s+/)[0]}` : ""}
      </h1>

      <dl
        style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.5rem 1rem", margin: 0 }}
      >
        {me.collector ? (
          <>
            <dt>Name</dt>
            <dd style={{ margin: 0 }}>{me.collector.name}</dd>
            <dt>Phone</dt>
            <dd style={{ margin: 0 }}>{me.collector.phone}</dd>
          </>
        ) : null}
        <dt>Email</dt>
        <dd style={{ margin: 0, overflowWrap: "anywhere" }}>{me.email}</dd>
      </dl>

      <p style={{ marginTop: "1.25rem" }}>
        Your weigh-ins are recorded through your paired phone at the hub.
      </p>

      <form action={signOut} style={{ marginTop: "1.25rem" }}>
        <button className="rq-btn" type="submit">
          Sign out
        </button>
      </form>
    </div>
  );
}
