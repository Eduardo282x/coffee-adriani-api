import { Controller, Post, Body, Res, Get } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardExcel, DTODateRangeFilter } from 'src/dto/base.dto';
import { Response } from 'express';


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
  async downloadExcel(@Body() filter: DashboardExcel, @Res() res: Response) {
    const buffer = await this.dashboardService.generateInventoryAndInvoicesExcel(filter);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte.xlsx');
    res.send(buffer);
  }

  @Post('/export/v2')
  async downloadExcelV2(@Body() filter: DashboardExcel, @Res() res: Response) {
    const buffer = await this.dashboardService.generateInventoryAndInvoicesExcelV2(filter);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte.xlsx');
    res.send(buffer);
  }
}
