import { Injectable } from '@nestjs/common';
import { InvoicesService } from 'src/invoices/invoices.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransformV2, PaymentParseExcel } from './excel.controller';
import { badResponse } from 'src/dto/base.dto';
import { PaymentsService } from 'src/payments/payments.service';

@Injectable()
export class ExcelService {

    constructor(
        private readonly invoiceService: InvoicesService, 
        private readonly paymentService: PaymentsService) {
    }

    async sendInvoices(
        invoice: ExcelTransformV2[], 
        detInvoice: DetInvoiceDataExcel[], 
        client: ClientExcel[],
        payments: PaymentParseExcel[]
    ) {
        try {
            // return await this.invoiceService.syncClientExcelLocal(client);
            // return await this.invoiceService.syncInvoiceExcel(invoice);
            // return await this.invoiceService.syncDetInvoiceExcel(detInvoice);
            return await this.paymentService.saveDataExcelPayments(payments);
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
