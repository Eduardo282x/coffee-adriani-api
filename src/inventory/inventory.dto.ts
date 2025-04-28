import { IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

export class DTOInventory {
    @IsNumber()
    @IsPositive()
    productId: number;
    @IsNumber()
    @IsPositive()
    quantity: number;

    @IsString()
    @IsOptional()
    description?: string;
}