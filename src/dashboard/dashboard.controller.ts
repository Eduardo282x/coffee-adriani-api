import { Controller, Post, Body, Res, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardExcel, DTODateRangeFilter } from 'src/dto/base.dto';
import { FastifyReply } from 'fastify';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  @Post()
  async getDashboardData(@Body() dateRange: DTODateRangeFilter) {
    return await this.dashboardService.getDashboardData(dateRange);
  }

  @Get('/clients-demand')
  async getClientsDemandReport() {
    return await this.dashboardService.getClientsDemandReport();
  }

  @Post('/export')
  async downloadExcel(@Body() filter: DashboardExcel, @Res({ passthrough: true }) res: FastifyReply) {
    const buffer = await this.dashboardService.generateInventoryAndInvoicesExcel(filter);
    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', 'attachment; filename=reporte.xlsx');
    return buffer;
  }

  @Post('/export/v2')
  async downloadExcelV2(@Body() filter: DashboardExcel, @Res({ passthrough: true }) res: FastifyReply) {
    const buffer = await this.dashboardService.generateInventoryAndInvoicesExcelV2(filter);

    res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.header('Content-Disposition', 'attachment; filename=reporte.xlsx');

    // En Fastify con passthrough: true, simplemente retornamos el buffer
    return buffer;
  }
}
