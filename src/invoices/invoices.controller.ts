import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { DTOInvoice } from './invoice.dto';
import { DTODateRangeFilter } from 'src/dto/base.dto';

@Controller('invoices')
export class InvoicesController {

    constructor(private readonly invoicesService: InvoicesService) { }

    @Get()
    async getInvoices() {
        return await this.invoicesService.getInvoices();
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

    @Post('/filter')
    async getInvoicesFilter(@Body() invoice: DTODateRangeFilter) {
        return await this.invoicesService.getInvoicesFilter(invoice);
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

    @Put('/:id')
    async updateInvoice(@Param('id', ParseIntPipe) id: number, @Body() updatedInvoice: DTOInvoice) {
        return await this.invoicesService.updateInvoice(id, updatedInvoice);
    }

    @Delete('/:id')
    async deleteInvoice(@Param('id') id: string) {
        return await this.invoicesService.deleteInvoice(Number(id));
    }

}
