import { Transform, Type } from "class-transformer";
import { IsDate, IsNumber, IsPositive, IsString } from "class-validator";

export class AssociatePaymentDTO {
    @IsNumber()
    inventoryEntryId: number;

    @IsNumber()
    paymentId: number;

    @IsNumber()
    @IsPositive()
    amount: number;
}

export class DisassociatePaymentDTO {
    @IsNumber()
    inventoryEntryId: number;

    @IsNumber()
    paymentId: number;
}

export class CreatePaymentForEntryDTO {
    @IsNumber()
    @IsPositive()
    amount: number;

    @IsNumber()
    accountId: number;

    @IsString()
    reference: string;

    @IsString()
    description?: string;

    @IsDate()
    @Transform(({ value }) => new Date(value))
    paymentDate: Date;

    @IsNumber()
    inventoryEntryId: number;

    @IsNumber()
    @IsPositive()
    entryAmount: number;

    @IsNumber()
    dolarId: number;
}
