import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { DTODateRangeFilter } from 'src/dto/base.dto';

@Controller('payments')
export class PaymentsController {

    constructor(private readonly paymentService: PaymentsService) {
        
    }

    @Get()
    async getPayments() {
        return await this.paymentService.getPayments()
    }
    @Get('/banks')
    async getBanks() {
        return await this.paymentService.getBanks()
    }

    @Post('/filter')
    async getPaymentsFilter(@Body() filter: DTODateRangeFilter) {
        return await this.paymentService.getPaymentsFilter(filter)
    }

    @Get('/methods')
    async getPaymentsMethod() {
        return await this.paymentService.getPaymentsMethod()
    }

    @Post()
    async registerPayment(@Body() payment: PaymentDTO) {
        return await this.paymentService.registerPayment(payment);
    }

    @Post('/associate')
    async payInvoice(@Body() payment: PayInvoiceDTO) {
        return await this.paymentService.payInvoice(payment);
    }

    @Put('/zelle/:id')
    async updatePaymentZelle(@Param('id') id: string) {
        return await this.paymentService.updatePaymentZelle(Number(id));
    }
}
