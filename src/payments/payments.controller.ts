import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentDTO } from './payment.dto';

@Controller('payments')
export class PaymentsController {

    constructor(private readonly paymentService: PaymentsService) {
        
    }

    @Get()
    async getPayments() {
        return await this.paymentService.getPayments()
    }

    @Get('/methods')
    async getPaymentsMethod() {
        return await this.paymentService.getPaymentsMethod()
    }

    @Post()
    async savePayment(@Body() payment: PaymentDTO) {
        return await this.paymentService.savePayment(payment);
    }

    @Put(':/id')
    async updatePayment(@Param('id') id: string) {
        return await this.paymentService.updatePayment(Number(id));
    }
}
