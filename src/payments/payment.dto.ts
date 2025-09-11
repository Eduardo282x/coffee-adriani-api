import { Transform, Type } from "class-transformer";
import { IsArray, IsDate, IsNotEmpty, IsOptional, IsNumber, IsPositive, IsString, ValidateNested } from "class-validator";

export class PaymentDTO {
    @IsString()
    reference: string;
    @IsString()
    @IsOptional()
    description?: string;
    @IsNumber()
    @IsPositive()
    amount: number;
    @IsNumber()
    accountId: number;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    paymentDate: Date;
}

export class PayInvoiceDTO {
    @IsNumber()
    paymentId: number;
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PayInvoiceDetailsDTO)
    details: PayInvoiceDetailsDTO[];
}

export class PayInvoiceDetailsDTO {
    @IsNumber()
    @IsNotEmpty({ message: 'La numero de factura debe ser numero' })
    invoiceId: number;
    @IsNumber()
    @IsNotEmpty({ message: 'La cantidad debe ser numero' })
    amount: number;
}

export class PayDisassociateDTO {
    @IsNumber()
    paymentId: number;
    @IsNumber()
    invoiceId: number;
    @IsNumber()
    id: number;
}

export class AccountsDTO {
    @IsString()
    name: string;
    @IsString()
    bank: string;
    @IsNumber()
    methodId: number;
}