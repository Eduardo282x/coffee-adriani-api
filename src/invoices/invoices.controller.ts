import { Body, Controller, Get, Post } from '@nestjs/common';
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

    @Post('/filter')
    async getInvoicesFilter(@Body() invoice: DTODateRangeFilter) {
        return await this.invoicesService.getInvoicesFilter(invoice);
    }

    @Post()
    async createInvoice(@Body() newInvoice: DTOInvoice) {
        return await this.invoicesService.createInvoice(newInvoice);
    }

}
