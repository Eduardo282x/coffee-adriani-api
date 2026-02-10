import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { DTOInvoice } from './invoice.dto';
import { DTODateRangeFilter } from 'src/dto/base.dto';
import { Response } from 'express';
import { ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { InvoicesService } from './invoices.service';

@Controller('invoices')
export class InvoicesController {

    constructor(private readonly invoicesService: InvoicesService) { }

    @Get()
    @ApiBearerAuth('JWT-auth')
    async getInvoices() {
        return await this.invoicesService.getInvoices();
    }
    @Get('/paginated')
    @ApiBearerAuth('JWT-auth')
    @ApiQuery({ name: 'page', type: Number, required: true, description: 'Número de página' })
    @ApiQuery({ name: 'limit', type: Number, required: true, description: 'Límite de elementos por página' })
    @ApiQuery({ name: 'type', type: Number, required: true, description: 'Tipo de producto' })
    @ApiQuery({ name: 'startDate', type: String, required: false, description: 'Fecha de inicio (opcional)' })
    @ApiQuery({ name: 'endDate', type: String, required: false, description: 'Fecha de fin (opcional)' })
    @ApiQuery({ name: 'search', type: String, required: false, description: 'Término de búsqueda (opcional)' })
    @ApiQuery({ name: 'blockId', type: String, required: false, description: 'ID del bloque (opcional)' })
    @ApiQuery({ name: 'status', type: String, required: false, description: 'Estado (opcional)' })
    async getInvoicesPaginated(
        @Query('page', ParseIntPipe) page: number,
        @Query('limit', ParseIntPipe) limit: number,
        @Query('type') type: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('search') search?: string,
        @Query('blockId') blockId?: string,
        @Query('status') status?: string,
    ) {
        return await this.invoicesService.getInvoicesPaginated(page, limit, type, startDate, endDate, search, blockId, status);
    }
    @Get('/statistics')
    @ApiBearerAuth('JWT-auth')
    @ApiQuery({ name: 'startDate', type: String, required: false, description: 'Fecha de inicio (opcional)' })
    @ApiQuery({ name: 'endDate', type: String, required: false, description: 'Fecha de fin (opcional)' })
    @ApiQuery({ name: 'search', type: String, required: false, description: 'Término de búsqueda (opcional)' })
    @ApiQuery({ name: 'blockId', type: String, required: false, description: 'ID del bloque (opcional)' })
    @ApiQuery({ name: 'status', type: String, required: false, description: 'Estado (opcional)' })
    async getInvoiceStatistics(
        @Query('type') type: string,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Query('search') search?: string,
        @Query('blockId') blockId?: string,
        @Query('status') status?: string,
    ) {
        return await this.invoicesService.getInvoiceStatistics(type, startDate, endDate, search, blockId, status);
    }
    @Get('/details/:id')
    async getInvoiceDetails(@Param('id', ParseIntPipe) invoiceId: number) {
        return await this.invoicesService.getInvoiceDetails(invoiceId);
    }

    @Get('/expired')
    async getInvoicesExpired() {
        return await this.invoicesService.getInvoicesExpired();
    }

    @Get('/unordered')
    async getInvoiceWithDetails() {
        return await this.invoicesService.getInvoiceWithDetails();
    }

    @Get('/validate')
    async findInvoiceWithoutDetails() {
        return await this.invoicesService.findInvoiceWithoutDetails();
    }

    @Get('/validate/total')
    async InvoiceValidateTotal() {
        return await this.invoicesService.InvoiceValidateTotal();
    }

    @Post('/check')
    async checkInvoice() {
        return await this.invoicesService.checkInvoice();
    }
    @Post('/check-client-inactivity')
    async generateInactivityNotifications() {
        return await this.invoicesService.generateInactivityNotifications();
    }

    @Post('/check-invoice/:id')
    async checkInvoicePayments(@Param('id', ParseIntPipe) id: number) {
        return await this.invoicesService.checkInvoicePayments(id);
    }

    @Post('/filter')
    async getInvoicesFilter(@Body() invoice: DTODateRangeFilter) {
        return await this.invoicesService.getInvoicesFilter(invoice);
    }

    @Post('/export')
    async exportInvoicesExcel(@Res() res: Response, @Body() query: DTODateRangeFilter) {
        const buffer = await this.invoicesService.exportInvoicesToExcelWithExcelJS(query);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=facturas.xlsx');
        res.send(buffer);
    }

    @Post()
    async createInvoice(@Body() newInvoice: DTOInvoice) {
        return await this.invoicesService.createInvoice(newInvoice);
    }

    @Put('/details')
    async updateInvoiceDet() {
        return await this.invoicesService.updateInvoiceDet();
    }

    @Put('/pay/:id')
    async markPayed(@Param('id', ParseIntPipe) id: number) {
        return await this.invoicesService.markPayed(id);
    }
    @Put('/pending/:id')
    async markPending(@Param('id', ParseIntPipe) id: number) {
        return await this.invoicesService.markPending(id);
    }
    @Put('/clean/:id')
    async markClean(@Param('id', ParseIntPipe) id: number) {
        return await this.invoicesService.markClean(id);
    }

    @Put('/:id')
    async updateInvoice(@Param('id', ParseIntPipe) id: number, @Body() updatedInvoice: DTOInvoice) {
        return await this.invoicesService.updateInvoice(id, updatedInvoice);
    }

    @Delete('/:id')
    async deleteInvoice(@Param('id') id: string) {
        return await this.invoicesService.deleteInvoice(Number(id));
    }

}
