import { Body, Controller, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
import { EntryPaymentsService } from './entry-payments.service';
import { AssociatePaymentDTO, CreatePaymentForEntryDTO, DisassociatePaymentDTO } from './entry-payments.dto';

@Controller('entry-payments')
export class EntryPaymentsController {

    constructor(private readonly entryPaymentsService: EntryPaymentsService) { }

    @Post('/associate')
    async associatePayment(@Body() data: AssociatePaymentDTO) {
        return await this.entryPaymentsService.associatePaymentToEntry(data);
    }

    @Put('/disassociate')
    async disassociatePayment(@Body() data: DisassociatePaymentDTO) {
        return await this.entryPaymentsService.disassociatePaymentFromEntry(data);
    }

    @Post()
    async createPaymentForEntry(@Body() data: CreatePaymentForEntryDTO) {
        return await this.entryPaymentsService.createPaymentForEntry(data);
    }

    @Get('/entry/:entryId')
    async getPaymentsByEntry(@Param('entryId', ParseIntPipe) entryId: number) {
        return await this.entryPaymentsService.getPaymentsByEntry(entryId);
    }
}
