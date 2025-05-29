
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