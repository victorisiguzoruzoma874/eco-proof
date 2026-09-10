import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { colors, font, radius, space, type } from "../theme";
import { enrolDevice, fetchCollectors, fetchHubs, getBackendUrl, operatorLogin, setBackendUrl } from "../lib/api";
import { saveDeviceMeta, type DeviceIdentity, type DeviceMeta } from "../lib/identity";
import { appStore, secureStore } from "../lib/native";

interface Props {
  identity: DeviceIdentity;
  onEnrolled: (meta: DeviceMeta) => void;
}

/**
 * One-time provisioning.
 *
 * An operator signs in here to bind this phone's public key to a collector. The
 * operator token is used for that single call and never stored: a shared field
 * phone must not carry standing credentials. After this, capture needs no login
 * at all — the device signature is the credential, which is precisely what lets
 * a collector work all day with no connection.
 */
export function EnrolScreen({ identity, onEnrolled }: Props) {
  const [backend, setBackend] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);

  const [collectors, setCollectors] = useState<{ id: string; name: string }[]>([]);
  const [hubs, setHubs] = useState<
    { id: string; code: string; name: string; minWeightKg: number; maxWeightKg: number }[]
  >([]);
  const [token, setToken] = useState<string | null>(null);
  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [hubId, setHubId] = useState<string | null>(null);

  // Shows the URL that will actually be used, not a placeholder that looks like
  // one. The default (10.0.2.2, the Android emulator's host loopback) is invisible
  // text otherwise, and silently wrong on a real phone -- the field must show it
  // as a real value so a collector or operator sees it and can correct it.
  useEffect(() => {
    void getBackendUrl(appStore).then(setBackend);
  }, []);

  const signIn = useCallback(async () => {
    // An empty email or password reaches the server as a blank credential and
    // is rejected exactly like a wrong one -- "operator sign-in failed" either
    // way. Catching it here instead names the actual problem, since the
    // placeholder text in an untouched field is easy to mistake for a value
    // already filled in.
    if (!email.trim() || !password) {
      Alert.alert("Sign-in failed", "Enter both operator email and password.");
      return;
    }

    setBusy(true);
    try {
      if (backend.trim()) await setBackendUrl(appStore, backend);
      const url = await getBackendUrl(appStore);

      const accessToken = await operatorLogin(url, email.trim(), password);
      const [people, sites] = await Promise.all([
        fetchCollectors(url, accessToken),
        fetchHubs(url, accessToken),
      ]);

      setToken(accessToken);
      setCollectors(people);
      setHubs(sites);
      setCollectorId(people[0]?.id ?? null);
      setHubId(sites[0]?.id ?? null);
    } catch (error) {
      Alert.alert("Sign-in failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [backend, email, password]);

  const enrol = useCallback(async () => {
    if (!token || !collectorId || !hubId) return;

    setBusy(true);
    try {
      const url = await getBackendUrl(appStore);
      const { deviceId } = await enrolDevice(url, token, {
        collectorId,
        label: label.trim() || "field phone",
        publicKeyBase64: identity.publicKeyBase64,
      });

      const collector = collectors.find((c) => c.id === collectorId);
      const hub = hubs.find((h) => h.id === hubId);
      if (!hub) throw new Error("hub not found");

      const meta: DeviceMeta = {
        deviceId,
        collectorId,
        collectorName: collector?.name ?? "collector",
        hubId,
        hubName: hub.name,
        // Recorded now because this is the only moment the phone holds an
        // operator token; capture itself has no credential to fetch them with.
        minWeightKg: hub.minWeightKg,
        maxWeightKg: hub.maxWeightKg,
      };

      await saveDeviceMeta(secureStore, meta);
      onEnrolled(meta);
    } catch (error) {
      Alert.alert("Enrolment failed", (error as Error).message);
    } finally {
      setBusy(false);
    }
  }, [collectorId, collectors, hubId, hubs, identity.publicKeyBase64, label, onEnrolled, token]);

  return (
    <ScrollView contentContainerStyle={styles.root} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Enrol this phone</Text>
      <Text style={styles.body}>
        An operator signs in once to register this phone's signing key. The key was
        generated here and never leaves the device.
      </Text>

      {!token ? (
        <>
          <Field label="BACKEND URL" value={backend} onChange={setBackend} placeholder="http://10.0.2.2:3000" autoCapitalize="none" />
          {/* 10.0.2.2 only resolves inside the Android emulator's virtual NAT; on a
              real phone it is just an address nothing answers on, and the fetch
              hangs until the client's own timeout cancels it. That failure mode
              reads as a generic "canceled" fetch with no hint of the real cause,
              so it is called out here explicitly rather than left to be inferred. */}
          {backend.includes("10.0.2.2") ? (
            <Text style={styles.warning}>
              10.0.2.2 only works from the Android emulator. On a real phone, use
              this computer's own network address instead, e.g. http://192.168.x.x:3000
              (find it with ipconfig on Windows, or ifconfig/ip addr on Mac/Linux).
            </Text>
          ) : null}
          <Field label="OPERATOR EMAIL" value={email} onChange={setEmail} placeholder="operator@proofchain.local" autoCapitalize="none" keyboardType="email-address" />
          <Field label="PASSWORD" value={password} onChange={setPassword} secure autoCapitalize="none" />

          <Pressable style={[styles.primary, busy && styles.disabled]} onPress={signIn} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryLabel}>Sign in</Text>}
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.label}>COLLECTOR</Text>
          <Options items={collectors.map((c) => ({ id: c.id, text: c.name }))} selected={collectorId} onSelect={setCollectorId} />

          <Text style={styles.label}>HUB</Text>
          <Options items={hubs.map((h) => ({ id: h.id, text: `${h.code} — ${h.name}` }))} selected={hubId} onSelect={setHubId} />

          <Field label="PHONE LABEL" value={label} onChange={setLabel} placeholder="field phone 1" />

          <Pressable style={[styles.primary, busy && styles.disabled]} onPress={enrol} disabled={busy}>
            {busy ? <ActivityIndicator color={colors.onAccent} /> : <Text style={styles.primaryLabel}>Enrol device</Text>}
          </Pressable>

          <Text style={styles.keyLabel}>PUBLIC KEY</Text>
          <Text style={styles.key}>{identity.publicKeyBase64}</Text>
        </>
      )}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  autoCapitalize,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  secure?: boolean;
  autoCapitalize?: "none" | "sentences";
  keyboardType?: "email-address" | "default";
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        secureTextEntry={secure}
        autoCapitalize={autoCapitalize ?? "sentences"}
        keyboardType={keyboardType ?? "default"}
      />
    </View>
  );
}

function Options({
  items,
  selected,
  onSelect,
}: {
  items: { id: string; text: string }[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={styles.options}>
      {items.map((item) => {
        const active = item.id === selected;
        return (
          <Pressable
            key={item.id}
            style={[styles.option, active && styles.optionActive]}
            onPress={() => onSelect(item.id)}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>{item.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: space.md, gap: space.sm, paddingBottom: space.xl },
  title: { ...type.title, color: colors.text },
  body: { color: colors.textMuted, fontSize: 15, lineHeight: 22, marginBottom: space.md },

  field: { marginTop: space.sm },
  label: { ...type.label, color: colors.textMuted, marginTop: space.sm },
  warning: { color: colors.queued, fontSize: 13, lineHeight: 18, marginTop: space.xs },
  input: {
    marginTop: space.xs,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    color: colors.text,
    fontSize: 16,
  },

  options: { gap: space.sm, marginTop: space.xs },
  option: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.md,
  },
  optionActive: { borderColor: colors.accent, backgroundColor: colors.surfaceRaised },
  optionText: { color: colors.textMuted, fontSize: 15, fontFamily: font.semibold },
  optionTextActive: { color: colors.text },

  primary: {
    marginTop: space.lg,
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: space.md + 2,
    alignItems: "center",
  },
  disabled: { opacity: 0.5 },
  primaryLabel: { color: colors.onAccent, fontSize: 17, fontFamily: font.bold },

  keyLabel: { ...type.label, color: colors.textFaint, marginTop: space.lg },
  /* The device public key — a machine string, so it takes the product's mono
     rather than whatever the handset calls "monospace". */
  key: { color: colors.textFaint, fontSize: 12, fontFamily: font.mono, marginTop: space.xs },
});
