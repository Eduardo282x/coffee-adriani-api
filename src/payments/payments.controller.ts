import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { AccountsDTO, PayDisassociateDTO, PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { DTODateRangeFilter } from 'src/dto/base.dto';

@Controller('payments')
export class PaymentsController {

    constructor(private readonly paymentService: PaymentsService) { }

    @Get()
    async getPayments() {
        return await this.paymentService.getPayments()
    }

    // NUEVOS ENDPOINTS OPTIMIZADOS
    @Get('/paginated')
    async getPaymentsPaginated(
        @Query('page') page?: string,
        @Query('limit') limit?: string,
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('accountId') accountId?: string,
        @Query('methodId') methodId?: string,
        @Query('associated') associated?: string,
        @Query('type') type?: string,
        @Query('credit') credit?: 'credit' | 'noCredit'
    ) {
        return await this.paymentService.getPaymentsPaginated({
            page: page ? parseInt(page) : 1,
            limit: limit ? parseInt(limit) : 50,
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            accountId: accountId ? parseInt(accountId) : undefined,
            methodId: methodId ? parseInt(methodId) : undefined,
            associated: associated === 'true' ? true : associated === 'false' ? false : undefined,
            type: type as string,
            credit: credit as 'credit' | 'noCredit',
        });
    }

    @Get('/statistics')
    async getPaymentsStatistics(
        @Query('startDate') startDate?: string,
        @Query('endDate') endDate?: string,
        @Query('accountId') accountId?: string,
        @Query('methodId') methodId?: string,
        @Query('associated') associated?: string,
        @Query('credit') credit?: 'credit' | 'noCredit',
        @Query('type') type?: string
    ) {
        return await this.paymentService.getPaymentsStatistics({
            startDate: startDate ? new Date(startDate) : undefined,
            endDate: endDate ? new Date(endDate) : undefined,
            accountId: accountId ? parseInt(accountId) : undefined,
            methodId: methodId ? parseInt(methodId) : undefined,
            associated: associated === 'true' ? true : associated === 'false' ? false : undefined,
            type: type as string,
            credit: credit as 'credit' | 'noCredit',
        });
    }

    @Get('/details/:id')
    async getPaymentDetails(@Param('id') id: string) {
        return await this.paymentService.getPaymentDetails(parseInt(id));
    }

    // ENDPOINTS EXISTENTES
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

    @Post('/accounts')
    async postAccountsPayments(@Body() account: AccountsDTO) {
        return await this.paymentService.createAccountPayment(account)
    }

    @Post('/associate')
    async payInvoice(@Body() payment: PayInvoiceDTO) {
        return await this.paymentService.payInvoice(payment);
    }

    @Put('/disassociate')
    async payDisassociate(@Body() payment: PayDisassociateDTO) {
        return await this.paymentService.payDisassociate(payment);
    }

    @Put('/zelle/:id')
    async updatePaymentZelle(@Param('id') id: string) {
        return await this.paymentService.updatePaymentZelle(Number(id));
    }

    @Put('/accounts/:id')
    async putAccountsPayments(@Param('id') id: string, @Body() account: AccountsDTO) {
        return await this.paymentService.updateAccountPayment(Number(id), account)
    }

    @Put('/:id')
    async updatePayments(@Param('id') id: string, @Body() payment: PaymentDTO) {
        return await this.paymentService.updatePayment(Number(id), payment);
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