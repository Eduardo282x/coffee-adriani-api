import { Transform, Type } from "class-transformer";
import { IsArray, IsBoolean, IsDate, isNumber, IsNumber, IsString, ValidateNested } from "class-validator";
import { DTOInventory } from "src/inventory/inventory.dto";

export class DTOInvoice {
    @IsNumber()
    clientId: number;
    @IsString()
    controlNumber: string;
    @IsBoolean()
    consignment: boolean;
    @IsBoolean()
    priceUSD: boolean;

    @IsDate()
    @Transform(({ value }) => new Date(value))
    dueDate: Date;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DTOInventory)
    details: DTOInventory[]
}

export class DTOInvoiceFilter {
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate: Date;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate: Date;
}

export interface IInvoice {
    id: number;
    clientId: number;
    dispatchDate: Date;
    dueDate: Date;
    controlNumber: string;
    exchangeRate: null;
    totalAmount: number;
    consignment: boolean;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    payments: Payments[];
}

export interface Payments {
    id: number;
    invoiceId: number;
    amount: number;
    methodId: number;
    exchangeRate: null;
    paymentDate: Date;
    status: string;
    createdAt: Date;
    updatedAt: Date;
}