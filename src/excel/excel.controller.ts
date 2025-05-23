import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parseExcelToJson } from 'src/common/utils.excel-parset';
import { ExcelService } from './excel.service';

@Controller('excel')
export class ExcelController {

    constructor(private excelService: ExcelService) {

    }

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    async uploadExcel(@UploadedFile() file: Express.Multer.File) {

        return {
            message: 'Este servicio no esta disponible.'
        }

        try {
            const invoiceData = parseExcelToJson(file.buffer, 0);
            const detInvoiceData: DetInvoiceDataExcel[] = parseExcelToJson(file.buffer, 1);
            // const clientPhoneData: ClientPhoneExcel[] = parseExcelToJson(file.buffer, 2);
            const clientData: ClientExcel[] = parseExcelToJson(file.buffer, 2);
            const paymentData: PaymentParseExcel[] = parseExcelToJson(file.buffer, 0);
            const parseData: ExcelTransform[] = invoiceData as ExcelTransform[];

            const parseDataToInvoice: ExcelTransformV2[] = parseData
                .filter(item => item.controlNumber != null)
                .map(item => {
                    return {
                        ...item,
                        consignment: item.consignment === 'Si'
                    }
                })
            const parseDataToDetInvoice: DetInvoiceDataExcel[] = detInvoiceData.filter(item => item.invoice != null || item.product != null)
            const parseDataToClient: ClientExcel[] = clientData.filter(item => item.address != null);
            const filterPayments: PaymentParseExcel[] = paymentData.filter(pay => pay.amount != null);
            return await this.excelService.sendInvoices(parseDataToInvoice, parseDataToDetInvoice, parseDataToClient, filterPayments);
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

export interface ExcelTransform {
    controlNumber: number;
    client: string;
    totalAmount: number;
    consignment: string;
    status: string;
    dispatchDate: number;
    dueDate: number;
}

export interface ExcelTransformV2 {
    controlNumber: number;
    client: string;
    totalAmount: number;
    consignment: boolean;
    status: string;
    dispatchDate: number;
    dueDate: number;
}

export interface DetInvoiceDataExcel {
    invoice: number;
    product: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}

export interface DetInvoiceDataExcelParse {
    controlNumber: string;
    product: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
}

export interface ClientPhoneExcel {
    client: string;
    phone: number;
}
export interface ClientPhoneExcelParse {
    client: string;
    phone: string;
}

export interface ClientExcel {
    name: string;
    rif: string;
    address: string;
    phone: number;
    zone: string;
    blockId: number;
    active: string;
}

export interface PaymentExcel {
    date: number;
    controlNumber: number;
    client: string;
    bank: string;
    reference: string;
    amount: number;
    dolar: number;
    total: number;
}
export interface PaymentParseExcel {
    date: Date;
    controlNumber: number;
    client: string;
    bank: string;
    reference: string;
    amount: number;
    dolar: number;
    total: number;
}