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

    @Post('/filter')
    async getInvoicesFilter(@Body() invoice: DTODateRangeFilter) {
        return await this.invoicesService.getInvoicesFilter(invoice);
    }

    @Post()
    async createInvoice(@Body() newInvoice: DTOInvoice) {
        return await this.invoicesService.createInvoice(newInvoice);
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
