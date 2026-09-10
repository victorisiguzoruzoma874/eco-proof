import { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space, statusColor, type } from "../theme";
import { counts, recent, unsyncedWeightKg, type QueuedWeighIn } from "../lib/queue";
import { computeEventPayloadHash } from "../lib/identity";
import { appStore } from "../lib/native";
import { useAutoSync } from "../lib/useAutoSync";

interface Proof {
  lookupCode: string;
  weightKg: number;
}

/**
 * What this phone still owes the hub.
 *
 * The headline number is unsynced weight, not record count, because that is what
 * the collector is paid for. Rejected records stay visible with their reason —
 * they are refused work, and a collector who learns why can often fix it.
 */
export function QueueScreen({ refreshKey, proof }: { refreshKey: number; proof?: Proof | null }) {
  const [records, setRecords] = useState<QueuedWeighIn[]>([]);
  const [tally, setTally] = useState({ queued: 0, syncing: 0, synced: 0, rejected: 0 });
  const [owedKg, setOwedKg] = useState(0);

  const load = useCallback(async () => {
    setRecords(await recent(appStore));
    setTally(await counts(appStore));
    setOwedKg(await unsyncedWeightKg(appStore));
  }, []);

  // Background passes and the button below share one in-flight guard, so tapping
  // "Sync now" during an automatic pass cannot post the same records twice.
  const { syncNow, syncing, lastOutcome } = useAutoSync(load);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const note = lastOutcome
    ? lastOutcome.attempted === 0
      ? "Nothing to sync, or no connection right now."
      : `${lastOutcome.synced} accepted · ${lastOutcome.rejected} rejected · ${lastOutcome.failed} still waiting`
    : null;

  const sync = useCallback(async () => {
    await syncNow();
    await load();
  }, [load, syncNow]);

  return (
    <View style={styles.root}>
      {proof ? <ProofBanner proof={proof} /> : null}

      <View style={styles.summary}>
        <Text style={styles.summaryLabel}>NOT YET SYNCED</Text>
        <Text style={styles.summaryValue}>
          {owedKg.toFixed(2)}
          <Text style={styles.summaryUnit}> kg</Text>
        </Text>
        <View style={styles.tallyRow}>
          <Tally label="Queued" value={tally.queued} tone={colors.queued} />
          <Tally label="Synced" value={tally.synced} tone={colors.synced} />
          <Tally label="Rejected" value={tally.rejected} tone={colors.rejected} />
        </View>
      </View>

      <Pressable style={[styles.sync, syncing && styles.syncBusy]} onPress={sync} disabled={syncing}>
        <Text style={styles.syncLabel}>{syncing ? "Syncing…" : "Sync now"}</Text>
      </Pressable>
      {note ? <Text style={styles.note}>{note}</Text> : null}

      <FlatList
        data={records}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={false} onRefresh={load} tintColor={colors.textMuted} />
        }
        ListEmptyComponent={<Text style={styles.empty}>No weigh-ins recorded on this phone yet.</Text>}
        renderItem={({ item }) => <Row record={item} />}
      />
    </View>
  );
}

/**
 * "Weigh-in queued" plus its lookup code, for the record just captured.
 *
 * Shown here rather than on the capture screen itself: this is where the
 * collector lands right after capturing (`onCaptured` switches tabs), and the
 * code stays reachable afterwards in each row below rather than living only in
 * a toast that is gone by the time anyone needs it.
 */
function ProofBanner({ proof }: { proof: Proof }) {
  return (
    <View style={styles.proof}>
      <Text style={styles.proofLabel}>WEIGH-IN QUEUED · {proof.weightKg.toFixed(2)} KG</Text>
      <Text style={styles.proofCode} selectable>
        {proof.lookupCode}
      </Text>
      <Text style={styles.proofHint}>
        Lookup code for this weigh-in. The full printable proof is on the
        dashboard — give this code to whoever verifies the drop-off.
      </Text>
    </View>
  );
}

function Tally({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <View style={styles.tally}>
      <View style={[styles.dot, { backgroundColor: tone }]} />
      <Text style={styles.tallyValue}>{value}</Text>
      <Text style={styles.tallyLabel}>{label}</Text>
    </View>
  );
}

function Row({ record }: { record: QueuedWeighIn }) {
  const tone = statusColor[record.status] ?? colors.textMuted;
  const at = new Date(record.payload.capturedAt);

  return (
    <View style={styles.row}>
      <View style={[styles.rowBar, { backgroundColor: tone }]} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.rowWeight}>
            {record.payload.weightKg.toFixed(2)} kg
            <Text style={styles.rowMaterial}> · {record.payload.material}</Text>
          </Text>
          {/* Status is labelled, not just coloured. */}
          <Text style={[styles.rowStatus, { color: tone }]}>{record.status.toUpperCase()}</Text>
        </View>
        <Text style={styles.rowMeta}>
          {at.toLocaleString()}
        </Text>
        {/* Computed from the stored payload, not a persisted field — correct
            for any record, however old, with no queue schema change. */}
        <Text style={styles.rowCode} selectable>
          {computeEventPayloadHash(record.payload).slice(0, 10)}
        </Text>
        {record.lastError ? <Text style={styles.rowError}>{record.lastError}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: space.md },

  // Louder than a row in the list below: this is the one thing a collector may
  // need to copy down or read aloud, so it gets the accent border the rest of
  // the screen deliberately withholds.
  proof: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.accent,
    padding: space.md,
    marginBottom: space.md,
    gap: space.xs,
  },
  proofLabel: { ...type.label, color: colors.accent },
  proofCode: {
    ...type.mono,
    color: colors.text,
    fontSize: 28,
    fontFamily: font.bold,
    letterSpacing: 1.2,
  },
  proofHint: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },

  summary: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  summaryLabel: { ...type.label, color: colors.textMuted },
  summaryValue: { color: colors.text, fontSize: 44, fontFamily: font.bold, marginTop: space.xs },
  summaryUnit: { fontSize: 20, color: colors.textMuted, fontFamily: font.semibold },
  tallyRow: { flexDirection: "row", gap: space.lg, marginTop: space.md },
  tally: { flexDirection: "row", alignItems: "center", gap: space.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tallyValue: { color: colors.text, fontFamily: font.bold, fontSize: 15 },
  tallyLabel: { color: colors.textMuted, fontSize: 13 },

  sync: {
    marginTop: space.md,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: space.md,
    alignItems: "center",
  },
  syncBusy: { opacity: 0.6 },
  syncLabel: { color: colors.onAccent, fontSize: 16, fontFamily: font.bold },
  note: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: space.sm },

  list: { paddingTop: space.md, gap: space.sm },
  empty: { color: colors.textFaint, textAlign: "center", marginTop: space.xl },

  row: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
  },
  rowBar: { width: 4 },
  rowBody: { flex: 1, padding: space.md, gap: space.xs },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  rowWeight: { color: colors.text, fontSize: 17, fontFamily: font.bold },
  rowMaterial: { color: colors.textMuted, fontSize: 14, fontFamily: font.medium },
  rowStatus: { fontSize: 11, fontFamily: font.bold, letterSpacing: 0.6 },
  rowMeta: { color: colors.textFaint, fontSize: 12 },
  rowCode: { ...type.mono, color: colors.textMuted, letterSpacing: 0.6, marginTop: 2 },
  rowError: { color: colors.rejected, fontSize: 12, marginTop: space.xs },
});
