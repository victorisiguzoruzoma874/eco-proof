import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { HubEntity, MaterialRateEntity } from "../database/entities";
import { MaterialsService } from "../materials/materials.service";
import type { CreateMaterialRateDto } from "../common/dto";

/**
 * The fixed rate table a payout resolves against. Deliberately minimal: this
 * exists so a rate can be set per material (optionally overridden per hub)
 * before `POST /payouts` has anything to compute against.
 */
@Injectable()
export class MaterialRatesService {
  constructor(
    @InjectRepository(MaterialRateEntity)
    private readonly rates: Repository<MaterialRateEntity>,
    @InjectRepository(HubEntity)
    private readonly hubs: Repository<HubEntity>,
    private readonly materials: MaterialsService,
  ) {}

  async list(filter: { materialCode?: string; hubId?: string }): Promise<MaterialRateEntity[]> {
    return this.rates.find({
      where: {
        ...(filter.materialCode ? { materialCode: filter.materialCode.toUpperCase() } : {}),
        ...(filter.hubId ? { hubId: filter.hubId } : {}),
      },
      order: { materialCode: "ASC", effectiveFrom: "DESC" },
    });
  }

  async create(dto: CreateMaterialRateDto): Promise<MaterialRateEntity> {
    const materialCode = dto.materialCode.trim().toUpperCase();
    // Existence only, not activity: a rate can be pre-configured for a
    // material an operator is about to reactivate, and this table is not the
    // place that decides whether a material is currently selectable.
    await this.materials.assertKnown(materialCode);

    if (dto.hubId) {
      const hub = await this.hubs.findOne({ where: { id: dto.hubId } });
      if (!hub) throw new BadRequestException(`hub ${dto.hubId} not found`);
    }

    return this.rates.save(
      this.rates.create({
        materialCode,
        hubId: dto.hubId ?? null,
        ratePerKg: dto.ratePerKg,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date(),
      }),
    );
  }
}
