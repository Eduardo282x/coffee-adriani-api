import { Body, Controller, Get, Post } from '@nestjs/common';
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

    @Post()
    async savePayment(@Body() payment: PaymentDTO) {
        return await this.paymentService.savePayment(payment);
    }
}
