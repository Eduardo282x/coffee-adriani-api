import { IsNumber, IsPositive, IsString, Min } from "class-validator";

export class DTOProducts {
    @IsString()
    name: string;
    @IsString()
    presentation: string;
    @IsNumber()
    @IsPositive()
    @Min(0)
    price: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    priceUSD: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    amount: number;
}