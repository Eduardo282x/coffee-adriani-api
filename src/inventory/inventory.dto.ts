import { Transform } from "class-transformer";
import { IsDate, IsNumber, IsOptional, IsPositive, IsString } from "class-validator";

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

    @IsDate()
    @Transform(({ value }) => new Date(value))
    @IsOptional()
    date?: Date;


}