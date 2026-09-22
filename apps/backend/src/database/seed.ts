import "reflect-metadata";
import { loadEnvironment } from "../config/load-env";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DataSource, IsNull } from "typeorm";
import { generateDeviceKeypair, privateKeyToPem, publicKeyToBase64 } from "@proofchain/shared";
import {
  CatalogItemEntity,
  CollectorEntity,
  CreditRateEntity,
  DeviceEntity,
  HubEntity,
  MaterialEntity,
  MaterialRateEntity,
  RequesterEntity,
  UserEntity,
  WasteWalletEntity,
} from "./entities";
import { AuthService } from "../auth/auth.module";

loadEnvironment();

type DeviceSecret = Record<string, string>;

/**
 * Device private keys written by a previous seed run, keyed by device id.
 *
 * A missing file is the normal first-run case, and a corrupt one is treated the
 * same way: "we hold no keys". Neither is fatal, because the device loop below
 * already knows how to handle an enrolled device whose key it cannot find — it
 * enrols a replacement. Throwing here would turn a scratch file into a hard
 * blocker on a development seed.
 */
function readExistingSecrets(path: string): Map<string, DeviceSecret> {
  const known = new Map<string, DeviceSecret>();

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`could not read ${path}; treating it as empty:`, error);
    }
    return known;
  }

  try {
    const parsed = JSON.parse(raw) as { devices?: DeviceSecret[] };
    for (const entry of parsed.devices ?? []) {
      // Both halves are required: an entry without a private key is no more
      // useful than a missing entry, and would suppress the replacement path.
      if (entry?.deviceId && entry.privateKeyPem) {
        known.set(entry.deviceId, entry);
      }
    }
  } catch (error) {
    console.warn(`${path} is not valid JSON; treating it as empty:`, error);
  }

  return known;
}

/**
 * Development seed: one hub, two collectors, one enrolled device each, and
 * operator/auditor logins. The device PRIVATE keys are written to
 * `var/seed-devices.json` so the capture app and the demo script can sign as a
 * real enrolled device. Development only — never run against production.
 *
 * Takes a `DataSource` rather than reaching for `AppDataSource` itself, so the
 * same seed logic runs against either a real Postgres (the `seed()` CLI
 * wrapper below) or the in-memory database `--in-memory` boots
 * (`main.ts` calls this directly against whatever `app.get(DataSource)`
 * returns, real or pg-mem).
 */
export async function seedDevelopmentData(dataSource: DataSource): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("refusing to seed a production database");
  }

  // `var/` is gitignored, so on a fresh clone it does not exist. Created here,
  // before any database write, rather than at the point of use at the end: a
  // seed that half-populates the database and *then* dies on ENOENT leaves
  // devices enrolled whose private keys were never written down, and those keys
  // cannot be recovered by re-running (see the device loop below).
  const outPath = resolve(__dirname, "../../var/seed-devices.json");
  mkdirSync(dirname(outPath), { recursive: true });

  // Keys already on disk are carried forward, so re-running the seed does not
  // orphan the devices an earlier run enrolled.
  const knownSecrets = readExistingSecrets(outPath);

  const hubs = dataSource.getRepository(HubEntity);
  const collectors = dataSource.getRepository(CollectorEntity);
  const devices = dataSource.getRepository(DeviceEntity);
  const users = dataSource.getRepository(UserEntity);
  const materials = dataSource.getRepository(MaterialEntity);
  const materialRates = dataSource.getRepository(MaterialRateEntity);
  const creditRates = dataSource.getRepository(CreditRateEntity);
  const requesters = dataSource.getRepository(RequesterEntity);
  const wasteWallets = dataSource.getRepository(WasteWalletEntity);
  const catalogItems = dataSource.getRepository(CatalogItemEntity);

  // Hub locations across Nigeria's higher waste-volume states — Lagos leads
  // (the state's own count puts Lagos generating roughly 13,000 tonnes of
  // solid waste a day), with Rivers, Ogun, Kano and FCT next as the other
  // industrial/population centres, plus Kaduna as the original pilot site.
  // `HubEntity` carries no state/country column (see migration
  // `1786800000000-RemoveLocation.ts` for why precise geolocation was
  // deliberately dropped) — the state lives in `name`, same as `code`
  // already encoded a site rather than a coordinate.
  const NIGERIA_HUBS = [
    { code: "LOS-01", name: "Lagos Pilot Hub (Lagos State)", minWeightKg: 0.5, maxWeightKg: 10_000 },
    { code: "KAD-01", name: "Kaduna Pilot Hub (Kaduna State)", minWeightKg: 0.5, maxWeightKg: 10_000 },
    { code: "PHC-01", name: "Port Harcourt Pilot Hub (Rivers State)", minWeightKg: 0.5, maxWeightKg: 10_000 },
    { code: "OGN-01", name: "Abeokuta Pilot Hub (Ogun State)", minWeightKg: 0.5, maxWeightKg: 10_000 },
    { code: "ABV-01", name: "Abuja Pilot Hub (FCT)", minWeightKg: 0.5, maxWeightKg: 10_000 },
    { code: "KAN-01", name: "Kano Pilot Hub (Kano State)", minWeightKg: 0.5, maxWeightKg: 10_000 },
  ] as const;

  // The PRIMARY hub is the one seeded collectors' devices get enrolled at —
  // everything below that references "the" hub (device secrets, the demo
  // script's weigh-ins) means this one. Overridable without editing this
  // file, same as before:
  //   HUB_CODE=LOS-01 HUB_NAME="Lagos Pilot Hub" npm run seed
  const primaryHubCode = process.env.HUB_CODE ?? NIGERIA_HUBS[0].code;
  const primaryHubName = process.env.HUB_NAME ?? NIGERIA_HUBS[0].name;

  const hubSpecs =
    // An explicit override means "seed just this one hub" (the pre-existing
    // single-hub behaviour), not "seed the whole list plus a duplicate."
    process.env.HUB_CODE || process.env.HUB_NAME
      ? [{ code: primaryHubCode, name: primaryHubName, minWeightKg: 0.5, maxWeightKg: 10_000 }]
      : NIGERIA_HUBS;

  let hubsSeeded = 0;
  for (const spec of hubSpecs) {
    const existing = await hubs.findOne({ where: { code: spec.code } });
    if (existing) continue;
    await hubs.save(hubs.create(spec));
    hubsSeeded += 1;
  }
  if (hubsSeeded > 0) {
    console.log(`hubs: seeded ${hubsSeeded} location(s) — ${hubSpecs.map((h) => h.code).join(", ")}`);
  }

  const hub = await hubs.findOneOrFail({ where: { code: primaryHubCode } });

  // A global default rate per active material, so a payout has something to
  // resolve against in dev/demo (`payouts.service.ts` throws a clear error
  // otherwise). Real pricing goes in via `POST /material-rates` once known —
  // this flat figure is a placeholder, not a claim about actual market value.
  const DEFAULT_RATE_PER_KG = 50;
  const activeMaterials = await materials.find({ where: { active: true } });
  let ratesSeeded = 0;
  for (const material of activeMaterials) {
    const existingRate = await materialRates.findOne({
      where: { materialCode: material.code, hubId: IsNull() },
    });
    if (existingRate) continue;
    await materialRates.save(
      materialRates.create({
        materialCode: material.code,
        hubId: null,
        ratePerKg: DEFAULT_RATE_PER_KG,
        effectiveFrom: new Date(),
      }),
    );
    ratesSeeded += 1;
  }
  if (ratesSeeded > 0) {
    console.log(`material rates: seeded a default ${DEFAULT_RATE_PER_KG}/kg rate for ${ratesSeeded} material(s)`);
  }

  // Same idea as material rates above, a different currency: waste credits
  // into a requester's wallet rather than cash to a collector. Credits are
  // pegged 1:1 to Naira and are directly cashable via POST /wallet/withdraw
  // (see the "credit value and spending" addendum), so this is a real
  // financial commitment, not a points system — 15/kg is a placeholder for
  // real money, deliberately priced below the 50/kg cash rate collectors get:
  // the requester didn't do the collection labour, so the same "reward the
  // person who did the work more" precedent from the collector-payout side
  // still applies. Set actual pricing via POST /credit-rates.
  const DEFAULT_CREDITS_PER_KG = 15;
  let creditRatesSeeded = 0;
  for (const material of activeMaterials) {
    const existingRate = await creditRates.findOne({
      where: { materialCode: material.code, hubId: IsNull() },
    });
    if (existingRate) continue;
    await creditRates.save(
      creditRates.create({
        materialCode: material.code,
        hubId: null,
        creditsPerKg: DEFAULT_CREDITS_PER_KG,
        effectiveFrom: new Date(),
      }),
    );
    creditRatesSeeded += 1;
  }
  if (creditRatesSeeded > 0) {
    console.log(
      `credit rates: seeded a default ${DEFAULT_CREDITS_PER_KG}/kg rate for ${creditRatesSeeded} material(s)`,
    );
  }

  const seedCollectors = [
    { name: "Amina Wanjiru", phone: "+254700000001" },
    { name: "Joseph Otieno", phone: "+254700000002" },
  ];

  const deviceSecrets: DeviceSecret[] = [];

  for (const spec of seedCollectors) {
    let collector = await collectors.findOne({ where: { phone: spec.phone } });
    if (!collector) {
      collector = await collectors.save(
        collectors.create({
          name: spec.name,
          phone: spec.phone,
          cooperativeId: "coop-nairobi-1",
          kycLevel: "basic",
          active: true,
        }),
      );
    }

    const existingDevice = await devices.findOne({ where: { collectorId: collector.id } });
    if (existingDevice) {
      const heldKey = knownSecrets.get(existingDevice.id);
      if (heldKey) {
        // Normal re-run: the device is enrolled and we still hold its key.
        deviceSecrets.push({ ...heldKey, hubId: hub.id });
        console.log(`device already enrolled for ${collector.name}; key retained`);
        continue;
      }

      // The device row exists but its private key is nowhere on disk — it was
      // generated by a run that failed before writing the file. The key is
      // unrecoverable (only the public half is stored), so the collector is
      // given a NEW device rather than being left permanently unable to sign.
      // The orphaned row stays: it is the enrolment history, and revoking it
      // here would rewrite an audit record to paper over a local mishap.
      console.warn(
        `device ${existingDevice.id} for ${collector.name} has no private key on disk; ` +
          `enrolling a replacement device`,
      );
    }

    const keypair = generateDeviceKeypair();
    const device = await devices.save(
      devices.create({
        collectorId: collector.id,
        label: `${spec.name.split(" ")[0]}'s phone`,
        publicKeyBase64: publicKeyToBase64(keypair.publicKey),
        revokedAt: null,
      }),
    );

    deviceSecrets.push({
      collectorId: collector.id,
      collectorName: collector.name,
      deviceId: device.id,
      hubId: hub.id,
      publicKeyBase64: device.publicKeyBase64,
      privateKeyPem: privateKeyToPem(keypair.privateKey),
    });
  }

  const seedUsers: Array<{ email: string; password: string; role: UserEntity["role"] }> = [
    { email: "operator@proofchain.local", password: "operator-dev-password", role: "operator" },
    { email: "auditor@proofchain.local", password: "auditor-dev-password", role: "auditor" },
    { email: "admin@proofchain.local", password: "admin-dev-password", role: "admin" },
  ];

  for (const u of seedUsers) {
    const existing = await users.findOne({ where: { email: u.email } });
    if (existing) continue;
    await users.save(
      users.create({
        email: u.email,
        passwordHash: await AuthService.hashPassword(u.password),
        role: u.role,
        active: true,
      }),
    );
  }

  if (deviceSecrets.length > 0) {
    writeFileSync(outPath, JSON.stringify({ hubId: hub.id, devices: deviceSecrets }, null, 2));
    console.log(`wrote device keys -> ${outPath}`);
  }

  // One demo requester with its wallet, purely so the requester -> QR ->
  // wallet flow can be exercised end-to-end without a separate signup step.
  // Same "seed it if missing, skip if present" idempotency as everything
  // else in this file — a re-run must not fail on a duplicate email.
  const demoRequesterEmail = "requester@proofchain.local";
  const demoRequesterPassword = "requester-dev-password";
  let demoRequester = await requesters.findOne({ where: { email: demoRequesterEmail } });
  if (!demoRequester) {
    demoRequester = await requesters.save(
      requesters.create({
        name: "Demo Requester",
        email: demoRequesterEmail,
        passwordHash: await AuthService.hashPassword(demoRequesterPassword),
        phone: null,
        active: true,
      }),
    );
  }
  const existingWallet = await wasteWallets.findOne({ where: { requesterId: demoRequester.id } });
  if (!existingWallet) {
    await wasteWallets.save(wasteWallets.create({ requesterId: demoRequester.id }));
  }

  // A small starter catalogue so the redemption path has something to
  // redeem against in dev/demo. Names carry no price: both screens that
  // render an item already print its cost beside it, and a price baked into
  // a name is a second copy that nothing keeps in step with `costCredits`.
  // Plausible placeholders, priced in whole
  // credits (= whole Naira, given the 1:1 peg) — real items/pricing go in
  // via POST /catalog-items, same "idempotent, seed it if missing" pattern
  // as everything else in this file.
  const SEED_CATALOG_ITEMS: Array<{
    name: string;
    description: string;
    category: string;
    costCredits: number;
    stock: number | null;
  }> = [
    {
      name: "Airtime Top-up",
      description: "Airtime credit for any major Nigerian network, sent to the requester's phone.",
      category: "airtime",
      costCredits: 100,
      stock: null,
    },
    {
      name: "Reusable Shopping Tote",
      description: "A durable, branded tote bag — a small nudge back toward less single-use plastic.",
      category: "goods",
      costCredits: 60,
      stock: 50,
    },
    {
      name: "10% Off Next Pickup Partner Discount",
      description: "A discount code for a partner eco-store, redeemable at checkout.",
      category: "discount",
      costCredits: 40,
      stock: null,
    },
  ];

  let catalogItemsSeeded = 0;
  for (const spec of SEED_CATALOG_ITEMS) {
    const existing = await catalogItems.findOne({ where: { name: spec.name } });
    if (existing) continue;
    await catalogItems.save(
      catalogItems.create({
        name: spec.name,
        description: spec.description,
        category: spec.category,
        costCredits: spec.costCredits,
        stock: spec.stock,
        active: true,
      }),
    );
    catalogItemsSeeded += 1;
  }
  if (catalogItemsSeeded > 0) {
    console.log(`catalog: seeded ${catalogItemsSeeded} item(s)`);
  }

  console.log(`hub: ${hub.code} (${hub.id})`);
  console.log("logins: operator@proofchain.local / operator-dev-password (and auditor, admin)");
  console.log(`requester login: ${demoRequesterEmail} / ${demoRequesterPassword}`);
}

/**
 * `npm run seed` CLI entrypoint: owns connecting to and closing `AppDataSource`.
 *
 * Imports `./data-source` lazily, here, rather than at module top level: that
 * module resolves `DATABASE_URL` as a side effect of being imported at all
 * (see `resolvePostgresConnection`), and `seedDevelopmentData` above must stay
 * usable — e.g. from `main.ts`'s `--in-memory` boot path — without a real
 * Postgres connection string ever being required.
 */
async function seed(): Promise<void> {
  const { AppDataSource } = await import("./data-source.js");
  await AppDataSource.initialize();
  await seedDevelopmentData(AppDataSource);
  await AppDataSource.destroy();
}

if (require.main === module) {
  seed().catch((error) => {
    console.error("seed failed:", error);
    process.exit(1);
  });
}
