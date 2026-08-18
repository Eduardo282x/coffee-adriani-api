import {
  Controller,
  Post,
  Body,
  Res,
  Get,
  Query,
  Param,
  NotFoundException,
} from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardExcel } from 'src/dto/base.dto';
import { FastifyReply } from 'fastify';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Post()
  async getDashboardData(@Body() dateRange: DashboardExcel) {
    try {
      return await this.dashboardService.getDashboardData(dateRange);
    } catch (error) {
      console.error('Error al obtener los datos del dashboard:', error);
      throw new Error(`Error al obtener los datos del dashboard: ${error}`);
    }
  }

  @Get('/clients-demand')
  async getClientsDemandReport(
    @Query('type') type: string,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
  ) {
    return await this.dashboardService.getClientsDemandReport({
      startDate,
      endDate,
      type,
    });
  }

  // @Post('/export')
  // async downloadExcel(@Body() filter: DashboardExcel, @Res({ passthrough: true }) res: FastifyReply) {
  //   const buffer = await this.dashboardService.generateInventoryAndInvoicesExcel(filter);
  //   res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  //   res.header('Content-Disposition', 'attachment; filename=reporte.xlsx');
  //   return buffer;
  // }

  @Post('/export/v2')
  async downloadExcelV2(
    @Body() filter: DashboardExcel,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const buffer =
      await this.dashboardService.generateInventoryAndInvoicesExcelV2(filter);

    res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header('Content-Disposition', 'attachment; filename=reporte.xlsx');

    // En Fastify con passthrough: true, simplemente retornamos el buffer
    return buffer;
  }

  @Get('/snapshots')
  async getSnapshots(
    @Query('type') type?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    return this.dashboardService.getSnapshots(type, startDate, endDate);
  }

  @Get('/snapshots/:id/download')
  async downloadSnapshot(
    @Param('id') id: string,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const snapshot = await this.dashboardService.getSnapshotById(Number(id));

    if (!snapshot) {
      throw new NotFoundException('Snapshot no encontrado');
    }

    res.header(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.header(
      'Content-Disposition',
      `attachment; filename="${snapshot.fileName}"`,
    );

    return Buffer.from(snapshot.file);
  }

  @Get('/snapshots/execute')
  async generateWeeklySnapshots() {
    return await this.dashboardService.generateWeeklySnapshots();
  }
}
