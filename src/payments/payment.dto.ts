import { IsNumber, IsPositive, IsString } from "class-validator";

export class PaymentDTO {
    @IsString()
    currency: string;
    @IsString()
    reference: string;
    @IsString()
    bank: string;
    @IsNumber()
    @IsPositive()
    amount: number;
    @IsNumber() 
    methodId: number;
}

export class PaymentUpdateDTO {
    @IsNumber()
    @IsPositive()
    invoiceId: number;
    @IsNumber()
    @IsPositive()
    amount: number;
    @IsNumber() 
    methodId: number;
}
