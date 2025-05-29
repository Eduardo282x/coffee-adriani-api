import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parseExcelToJson } from 'src/common/utils.excel-parset';
import { ExcelService } from './excel.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransform, ExcelTransformV2, PaymentParseExcel } from './excel.interfaces';

@Controller('excel')
export class ExcelController {

    constructor(private excelService: ExcelService) {
    }

    @Post('upload/invoices')
    @UseInterceptors(FileInterceptor('file'))
    async uploadInvoicesExcel(@UploadedFile() file: Express.Multer.File) {
        try {
            const invoiceData = parseExcelToJson(file.buffer, 0);
            const parseData: ExcelTransform[] = invoiceData as ExcelTransform[];

            const parseDataToInvoice: ExcelTransformV2[] = parseData
                .filter(item => item.controlNumber != null)
                .map(item => {
                    return {
                        ...item,
                        consignment: item.consignment === 'Si'
                    }
                })

            return await this.excelService.sendInvoices(parseDataToInvoice);
        } catch (err) {
            return err.message
        }
    }

    @Post('upload/detInvoices')
    @UseInterceptors(FileInterceptor('file'))
    async uploadDetInvoicesExcel(@UploadedFile() file: Express.Multer.File) {
        try {
            const detInvoiceData: DetInvoiceDataExcel[] = parseExcelToJson(file.buffer, 1);
            const parseDataToDetInvoice: DetInvoiceDataExcel[] = detInvoiceData.filter(item => item.invoice != null || item.product != null)
            return await this.excelService.sendDetInvoices(parseDataToDetInvoice);
        } catch (err) {
            return err.message
        }
    }

    @Post('upload/payments')
    @UseInterceptors(FileInterceptor('file'))
    async uploadPaymentsExcel(@UploadedFile() file: Express.Multer.File) {
        try {
            const paymentData: PaymentParseExcel[] = parseExcelToJson(file.buffer, 0);
            const filterPayments: PaymentParseExcel[] = paymentData.filter(pay => pay.total != null);
            return await this.excelService.sendPayments(filterPayments);
        } catch (err) {
            return err.message
        }
    }

    @Post('upload/payments/associate')
    @UseInterceptors(FileInterceptor('file'))
    async uploadPaymentsAssociateExcel(@UploadedFile() file: Express.Multer.File) {
        try {
            const paymentData: PaymentParseExcel[] = parseExcelToJson(file.buffer, 0);
            const filterPayments: PaymentParseExcel[] = paymentData.filter(pay => pay.total != null);
            return await this.excelService.sendPaymentsAssociate(filterPayments);
        } catch (err) {
            return err.message
        }
    }

    @Post('upload/clients')
    @UseInterceptors(FileInterceptor('file'))
    async uploadClientsExcel(@UploadedFile() file: Express.Multer.File) {
        try {
            const clientData: ClientExcel[] = parseExcelToJson(file.buffer, 0);
            const parseDataToClient: ClientExcel[] = clientData.filter(item => item.address != null);
            return await this.excelService.sendClients(parseDataToClient);
        } catch (err) {
            return err.message
        }
    }
}

export const parseAnyExcelDate = (input: any): Date | null => {
    if (!input) return null;

    // Si ya es un Date válido
    if (input instanceof Date && !isNaN(input.getTime())) {
        return input;
    }

    // Si es un número (Excel serial date)
    if (!isNaN(input) && typeof input === 'number') {
        // Excel serial number to JS date (Excel starts on Jan 1, 1900)
        const excelEpoch = new Date(1899, 11, 30); // Ajuste correcto
        const result = new Date(excelEpoch.getTime() + input * 86400000);
        return isNaN(result.getTime()) ? null : result;
    }

    // Si es string tipo "dd/mm/yyyy"
    if (typeof input === 'string' && input.includes('/')) {
        const parts = input.split('/');
        if (parts.length !== 3) return null;

        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);

        if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

        const result = new Date(year, month, day);
        return isNaN(result.getTime()) ? null : result;
    }

    return null;
};
