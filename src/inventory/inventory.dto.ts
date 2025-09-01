import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class DTOInventory {
    @IsNumber()
    @IsPositive()
    productId: number;
    @IsNumber()
    @IsPositive()
    price: number;
    @IsNumber()
    @IsPositive()
    priceUSD: number;
    @IsNumber()
    @IsPositive()
    quantity: number;

    @IsString()
    @IsOptional()
    description?: string;
}