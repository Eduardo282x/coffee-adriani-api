import { IsNumber, IsPositive } from "class-validator";

export class PaymentDTO {
    @IsNumber()
    @IsPositive()
    invoiceId: number;
    @IsNumber()
    @IsPositive()
    amount: number;
    @IsNumber() 
    methodId: number;
}
