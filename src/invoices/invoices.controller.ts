import { Body, Controller, Get, Post } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { DTOInvoice, DTOInvoiceFilter } from './invoice.dto';

@Controller('invoices')
export class InvoicesController {

    constructor(private readonly invoicesService: InvoicesService) { }
    
    @Get()
    async getInvoices() {
        return await this.invoicesService.getInvoices();
    }

    @Post('/filter')
    async getInvoicesFilter(@Body() invoice: DTOInvoiceFilter) {
        return await this.invoicesService.getInvoicesFilter(invoice);
    }

    @Post()
    async createInvoice(@Body() newInvoice: DTOInvoice) {
        return await this.invoicesService.createInvoice(newInvoice);
    }

}
