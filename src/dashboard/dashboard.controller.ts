import { Controller, Post, Body, Res } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DTODateRangeFilter } from 'src/dto/base.dto';
import { Response } from 'express';


@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) { }

  @Post()
  async getDashboardData(@Body() dateRange: DTODateRangeFilter) {
    return await this.dashboardService.getDashboardData(dateRange);
  }

  @Post('/export')
  async downloadExcel(@Body() filter: DTODateRangeFilter, @Res() res: Response) {
    const buffer = await this.dashboardService.generateInventoryAndInvoicesExcel(filter);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=reporte.xlsx');
    res.send(buffer);
  }
}
