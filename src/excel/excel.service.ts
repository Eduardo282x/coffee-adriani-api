import { Injectable } from '@nestjs/common';
import { InvoicesService } from 'src/invoices/invoices.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransformV2, PaymentParseExcel } from './excel.interfaces';
import { badResponse } from 'src/dto/base.dto';
import { PaymentsService } from 'src/payments/payments.service';

@Injectable()
export class ExcelService {

    constructor(
        private readonly invoiceService: InvoicesService,
        private readonly paymentService: PaymentsService) {
    }

    async sendInvoices(invoice: ExcelTransformV2[]) {
        try {
            return await this.invoiceService.syncInvoiceExcel(invoice);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async sendDetInvoices(detInvoice: DetInvoiceDataExcel[]) {
        try {
            return await this.invoiceService.syncDetInvoiceExcel(detInvoice);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async sendPayments(payments: PaymentParseExcel[]) {
        try {
            return await this.paymentService.saveDataExcelPaymentsNew(payments);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async sendPaymentsAssociate(payments: PaymentParseExcel[]) {
        try {
            return await this.paymentService.saveDataExcelPaymentsAssociate(payments);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async sendClients(client: ClientExcel[]) {
        try {
            return await this.invoiceService.syncClientExcelLocal(client);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
