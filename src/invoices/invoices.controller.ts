import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Res } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { DTOInvoice } from './invoice.dto';
import { DTODateRangeFilter } from 'src/dto/base.dto';
import { Response } from 'express';
import { InvoiceStatus } from '@prisma/client';

@Controller('invoices')
export class InvoicesController {

    constructor(private readonly invoicesService: InvoicesService) { }

    @Get()
    async getInvoices() {
        return await this.invoicesService.getInvoices();
    }
    @Get('/paginated')
    async getInvoicesPaginated(
        @Query('page', ParseIntPipe) page: number,
        @Query('limit', ParseIntPipe) limit: number,
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Query('search') search?: string,
        @Query('blockId') blockId?: string,
        @Query('status') status?: string,
    ) {
        return await this.invoicesService.getInvoicesPaginated(page, limit, startDate, endDate, search, blockId, status);
    }
    @Get('/statistics')
    async getInvoiceStatistics(
        @Query('startDate') startDate: string,
        @Query('endDate') endDate: string,
        @Query('search') search?: string,
        @Query('blockId') blockId?: string,
        @Query('status') status?: string,
    ) {
        return await this.invoicesService.getInvoiceStatistics(startDate, endDate, search, blockId, status);
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
