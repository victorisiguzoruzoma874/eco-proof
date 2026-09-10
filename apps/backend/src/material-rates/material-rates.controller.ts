import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { MaterialRatesService } from "./material-rates.service";
import { Roles } from "../auth/auth.module";
import { CreateMaterialRateDto } from "../common/dto";

@ApiTags("material-rates")
@Controller("material-rates")
export class MaterialRatesController {
  constructor(private readonly rates: MaterialRatesService) {}

  @Roles("admin", "operator")
  @Get()
  list(@Query("materialCode") materialCode?: string, @Query("hubId") hubId?: string) {
    return this.rates.list({ materialCode, hubId });
  }

  @Roles("admin")
  @Post()
  create(@Body() dto: CreateMaterialRateDto) {
    return this.rates.create(dto);
  }
}
