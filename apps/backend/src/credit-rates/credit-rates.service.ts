import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { CreditRateEntity, HubEntity } from "../database/entities";
import { MaterialsService } from "../materials/materials.service";
import type { CreateCreditRateDto } from "../common/dto";

/**
 * The fixed credits-per-kg rate table `WalletService.redeem` resolves
 * against — structurally identical to `MaterialRatesService`, just a
 * different currency for a different beneficiary (consumer credits, not
 * collector cash). See `CreditRateEntity`'s doc comment for the resolution
 * rule this mirrors.
 */
@Injectable()
export class CreditRatesService {
  constructor(
    @InjectRepository(CreditRateEntity)
    private readonly rates: Repository<CreditRateEntity>,
    @InjectRepository(HubEntity)
    private readonly hubs: Repository<HubEntity>,
    private readonly materials: MaterialsService,
  ) {}

  async list(filter: { materialCode?: string; hubId?: string }): Promise<CreditRateEntity[]> {
    return this.rates.find({
      where: {
        ...(filter.materialCode ? { materialCode: filter.materialCode.toUpperCase() } : {}),
        ...(filter.hubId ? { hubId: filter.hubId } : {}),
      },
      order: { materialCode: "ASC", effectiveFrom: "DESC" },
    });
  }

  async create(dto: CreateCreditRateDto): Promise<CreditRateEntity> {
    const materialCode = dto.materialCode.trim().toUpperCase();
    await this.materials.assertKnown(materialCode);

    if (dto.hubId) {
      const hub = await this.hubs.findOne({ where: { id: dto.hubId } });
      if (!hub) throw new BadRequestException(`hub ${dto.hubId} not found`);
    }

    return this.rates.save(
      this.rates.create({
        materialCode,
        hubId: dto.hubId ?? null,
        creditsPerKg: dto.creditsPerKg,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      }),
    );
  }
}
