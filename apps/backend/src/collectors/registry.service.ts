import { ConflictException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { DataSource, QueryFailedError, Repository } from "typeorm";
import { publicKeyFromBase64 } from "@proofchain/shared";
import {
  CollectionEventEntity,
  CollectionRequestEntity,
  CollectorEntity,
  DeviceEntity,
  HubEntity,
  PayoutEntity,
  SignupRequestEntity,
  UserEntity,
} from "../database/entities";
import type { CreateCollectorDto, CreateHubDto, EnrolDeviceDto } from "../common/dto";

/** What a capture device is told about a hub. */
export interface HubDirectoryEntry {
  id: string;
  code: string;
  name: string;
  /** Sanity bounds for a single weigh-in here, so the device can pre-check. */
  minWeightKg: number;
  maxWeightKg: number;
}

/** Collectors, their devices, and the hubs they work at. */
@Injectable()
export class RegistryService {
  private readonly logger = new Logger(RegistryService.name);

  constructor(
    @InjectRepository(CollectorEntity) private readonly collectors: Repository<CollectorEntity>,
    @InjectRepository(DeviceEntity) private readonly devices: Repository<DeviceEntity>,
    @InjectRepository(HubEntity) private readonly hubs: Repository<HubEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  listCollectors() {
    return this.collectors.find({ order: { createdAt: "DESC" } });
  }

  async createCollector(dto: CreateCollectorDto) {
    const existing = await this.collectors.findOne({ where: { phone: dto.phone } });
    if (existing) throw new ConflictException(`a collector with phone ${dto.phone} already exists`);

    return this.collectors.save(
      this.collectors.create({
        name: dto.name,
        phone: dto.phone,
        cooperativeId: dto.cooperativeId ?? null,
        kycLevel: dto.kycLevel ?? "none",
        active: true,
      }),
    );
  }

  /**
   * Permanently delete a collector, with their devices and their login.
   *
   * Only a collector with no history can go. Weigh-ins and payouts are the
   * verified record that batches, reports and payouts are built on, and a
   * collection request names who was sent; deleting the collector behind any
   * of them would leave that record pointing at nobody. Such a collector is
   * refused with a 409 that says what they have.
   *
   * The collector row is locked first. Postgres makes an insert that
   * references a locked row wait, so a weigh-in arriving mid-delete either
   * lands before the counts below (and is counted) or fails its foreign key
   * after the delete commits. The foreign keys are RESTRICT regardless, which
   * the catch below turns into the same 409.
   */
  async deleteCollector(id: string): Promise<{ id: string; name: string }> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const collector = await manager.findOne(CollectorEntity, {
          where: { id },
          lock: { mode: "pessimistic_write" },
        });
        if (!collector) throw new NotFoundException(`collector ${id} not found`);

        const weighIns = await manager.count(CollectionEventEntity, { where: { collectorId: id } });
        const payouts = await manager.count(PayoutEntity, { where: { collectorId: id } });
        const requests = await manager.count(CollectionRequestEntity, {
          where: { assignedCollectorId: id },
        });
        const history = [
          plural(weighIns, "weigh-in"),
          plural(payouts, "payout"),
          plural(requests, "assigned collection request"),
        ].filter((part): part is string => part !== null);
        if (history.length > 0) {
          throw new ConflictException(
            `${collector.name} has ${joinList(history)} and cannot be deleted: ` +
              "those records must keep pointing at the collector who made them.",
          );
        }

        // The approved sign-up stays, as a record of the decision; it just no
        // longer names a collector, or a login, that exists.
        const login = await manager.findOne(UserEntity, { where: { collectorId: id } });
        await manager.update(
          SignupRequestEntity,
          { createdCollectorId: id },
          { createdCollectorId: null },
        );
        if (login) {
          await manager.update(
            SignupRequestEntity,
            { createdUserId: login.id },
            { createdUserId: null },
          );
          await manager.delete(UserEntity, { id: login.id });
        }
        await manager.delete(DeviceEntity, { collectorId: id });
        await manager.delete(CollectorEntity, { id });

        this.logger.log(`deleted collector ${id} (${collector.name})`);
        return { id, name: collector.name };
      });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          "This collector now has records that refer to them and cannot be deleted.",
        );
      }
      throw error;
    }
  }

  async enrolDevice(dto: EnrolDeviceDto) {
    const collector = await this.collectors.findOne({ where: { id: dto.collectorId } });
    if (!collector) throw new NotFoundException(`collector ${dto.collectorId} not found`);

    // Reject a key we cannot actually verify signatures with, at enrolment time
    // rather than silently failing every weigh-in later.
    try {
      publicKeyFromBase64(dto.publicKeyBase64);
    } catch (error) {
      throw new ConflictException(`invalid ed25519 public key: ${(error as Error).message}`);
    }

    const clash = await this.devices.findOne({ where: { publicKeyBase64: dto.publicKeyBase64 } });
    if (clash) throw new ConflictException("this device key is already enrolled");

    return this.devices.save(
      this.devices.create({
        collectorId: dto.collectorId,
        label: dto.label,
        publicKeyBase64: dto.publicKeyBase64,
        revokedAt: null,
      }),
    );
  }

  async revokeDevice(id: string) {
    const device = await this.devices.findOne({ where: { id } });
    if (!device) throw new NotFoundException(`device ${id} not found`);
    if (device.revokedAt) return device;

    device.revokedAt = new Date();
    return this.devices.save(device);
  }

  /**
   * Devices, optionally narrowed to a collector or to one public key.
   *
   * The key filter is how a phone that has lost its local pairing finds out it
   * is still enrolled: the key is unique forever, so re-enrolling it can only
   * 409. Revoked devices are returned too — the phone needs to know its key is
   * dead so it can rotate to a fresh one rather than retry it.
   */
  listDevices(collectorId?: string, publicKeyBase64?: string) {
    return this.devices.find({
      where: {
        ...(collectorId ? { collectorId } : {}),
        ...(publicKeyBase64 ? { publicKeyBase64 } : {}),
      },
      order: { enrolledAt: "DESC" },
    });
  }

  listHubs() {
    return this.hubs.find({ order: { code: "ASC" } });
  }

  /**
   * The hub list a capture device needs, and nothing more.
   *
   * Separate from listHubs() because it is public: a field phone holds no
   * credentials — the device signature is its only one — but it still has to
   * name the hub it is capturing for. Same reasoning as the material catalogue.
   *
   * Trimmed deliberately, but the weight bounds are part of it. They were held
   * back as operational configuration once, and that cost collectors weigh-ins:
   * a device that does not know the ceiling cannot stop a collector signing a
   * weight the hub will refuse, so the refusal arrived at sync time with the
   * material long gone. Withholding them never protected anything either — the
   * ingest response already tells an unauthenticated device the exact figure
   * ("300 kg above hub maximum 200 kg"). Publishing them up front turns a
   * rejection into a correction the collector can still make.
   */
  async hubDirectory(): Promise<HubDirectoryEntry[]> {
    const hubs = await this.hubs.find({ order: { code: "ASC" } });

    // The entity's numeric transformer has already narrowed these; Number() is
    // belt and braces for the one thing this endpoint must never emit — a
    // string where a field phone expects something it can compare and format.
    return hubs.map((hub) => ({
      id: hub.id,
      code: hub.code,
      name: hub.name,
      minWeightKg: Number(hub.minWeightKg),
      maxWeightKg: Number(hub.maxWeightKg),
    }));
  }

  async createHub(dto: CreateHubDto) {
    const existing = await this.hubs.findOne({ where: { code: dto.code } });
    if (existing) throw new ConflictException(`hub ${dto.code} already exists`);

    const hub = this.hubs.create({
      code: dto.code,
      name: dto.name,
      minWeightKg: dto.minWeightKg ?? 0.1,
      maxWeightKg: dto.maxWeightKg ?? 10_000,
    });

    return this.hubs.save(hub);
  }

}

function plural(count: number, noun: string): string | null {
  if (count === 0) return null;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function joinList(parts: string[]): string {
  return parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

function isForeignKeyViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string } | undefined)?.code === "23503"
  );
}
