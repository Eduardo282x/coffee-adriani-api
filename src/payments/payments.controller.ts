import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AccountsDTO, PayInvoiceDTO, PaymentDTO } from './payment.dto';
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
    @Get('/accounts')
    async getAccountsPayments() {
        return await this.paymentService.getAccountsPayments()
    }

    @Post('/filter')
    async getPaymentsFilter(@Body() filter: DTODateRangeFilter) {
        return await this.paymentService.getPaymentsFilter(filter)
    }

    @Get('/methods')
    async getPaymentsMethod() {
        return await this.paymentService.getPaymentsMethod()
    }
    @Get('/validate')
    async validateAssociatedPaymentsInvoices() {
        return await this.paymentService.validateAssociatedPaymentsInvoices()
    }

    @Post()
    async registerPayment(@Body() payment: PaymentDTO) {
        return await this.paymentService.registerPayment(payment);
    }
    @Put('/:id')
    async updatePayments(@Param('id') id: string, @Body() payment: PaymentDTO) {
        return await this.paymentService.updatePayment(Number(id), payment);
    }

    @Post('/accounts')
    async postAccountsPayments(@Body() account: AccountsDTO) {
        return await this.paymentService.createAccountPayment(account)
    }

    @Post('/associate')
    async payInvoice(@Body() payment: PayInvoiceDTO) {
        return await this.paymentService.payInvoice(payment);
    }

    @Put('/zelle/:id')
    async updatePaymentZelle(@Param('id') id: string) {
        return await this.paymentService.updatePaymentZelle(Number(id));
    }

    @Put('/accounts/:id')
    async putAccountsPayments(@Param('id') id: string, @Body() account: AccountsDTO) {
        return await this.paymentService.updateAccountPayment(Number(id), account)
    }

    @Delete('/accounts/:id')
    async deleteAccountsPayments(@Param('id') id: string) {
        return await this.paymentService.deleteAccountsPayments(Number(id))
    }
    @Delete('/:id')
    async deletePayment(@Param('id') id: string) {
        return await this.paymentService.deletePayment(Number(id))
    }
}
