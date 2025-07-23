import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsDate, IsNotEmpty, IsNumber, IsString, ValidateNested } from "class-validator";
import { DTOInventory } from "src/inventory/inventory.dto";
import { InvoiceStatus } from "@prisma/client";

export class DTOInvoice {
    @IsNumber()
    @IsNotEmpty({ message: 'El cliente es requerido' })
    clientId: number;
    @IsString()
    @IsNotEmpty({ message: 'El numero de factura es requerido' })
    controlNumber: string;
    @IsBoolean()
    consignment: boolean;
    @IsBoolean()
    priceUSD: boolean;

    @IsDate()
    @Transform(({ value }) => new Date(value))
    dispatchDate: Date;

    @IsDate()
    @Transform(({ value }) => new Date(value))
    dueDate: Date;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DTOInventory)
    details: DTOInventory[]
}

export interface IInvoice {
    id: number;
    clientId: number;
    dispatchDate: Date;
    dueDate: Date;
    controlNumber: string;
    exchangeRate: null;
    totalAmount: number | any;
    consignment: boolean;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    payments: Payments[];
}
export interface IInvoiceWithDetails extends IInvoice {
    invoiceItems: DTOInventory[];
}

export interface Payments {
    id: number;
    invoiceId: number;
    amount: number | null;
    methodId: number;
    exchangeRate: null;
    paymentDate: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}

export interface DetProducts {
    productId: number;
    product: Product;
    totalQuantity: number;
    paidQuantity: number;
    total: number;
}

export interface Product {
    id: number;
    name: string;
    presentation: string;
    purchasePrice: string;
    price: string;
    priceUSD: string;
    amount: number;
    createdAt: Date;
    updatedAt: Date;
}


export interface OptionalFilterInvoices {
    status: InvoiceStatus
}

export interface ResponseInvoice {
    invoices: ResponseInvoiceInvoice[];
    package: any;
    detPackage: any;
    payments: any;
}


export interface ResponseInvoiceInvoice {
    client: Client;
    invoices: InvoiceInvoice[];
}

export interface Client {
    id: number;
    name: string;
    rif: string;
    address: string;
    phone: string;
    zone: string;
    blockId: number;
    active: boolean;
    createdAt: Date;
    updatedAt: Date;
    block: Block;
}

export interface Block {
    id: number;
    name: string;
    address: string;
}

export interface InvoiceInvoice {
    id: number;
    clientId: number;
    dispatchDate: Date;
    dueDate: Date;
    controlNumber: string;
    exchangeRate: null;
    sellerId: null;
    totalAmount: string;
    remaining: string;
    consignment: boolean;
    status: InvoiceStatus;
    createdAt: Date;
    updatedAt: Date;
    deleted: boolean;
    invoiceItems: InvoiceItem[];
    totalAmountBs: string;
}

export interface InvoiceItem {
    id: number;
    invoiceId: number;
    productId: number;
    quantity: number;
    unitPriceUSD: string;
    unitPrice: string;
    subtotal: string;
    product: Product;
}

