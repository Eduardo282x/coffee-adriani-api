import { Transform } from "class-transformer";
import { IsDate, IsDecimal, IsNumber, IsPositive, IsString, Min } from "class-validator";

export class DTOProducts {
    @IsString()
    name: string;
    @IsString()
    presentation: string;
    @IsString()
    type: string;
    @IsNumber()
    @IsPositive()
    @Min(0)
    price: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    purchasePrice: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    purchasePriceUSD: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    priceUSD: number;
    @IsNumber()
    @IsPositive()
    @Min(0)
    amount: number;
}

export class DTODolar {
    @IsNumber()
    dolar: number;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    date: Date;
}