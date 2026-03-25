import { Transform, Type } from "class-transformer";
import { IsArray, IsDate, IsNumber, IsOptional, IsPositive, IsString, ValidateNested } from "class-validator";

export class DTOInventory {
    @IsString()
    controlNumber: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DTOInventoryHistory)
    details: DTOInventoryHistory[];

    @IsDate()
    @Transform(({ value }) => new Date(value))
    date: Date;
}

export class DTOInventoryHistory {
    @IsNumber()
    @IsPositive()
    productId: number;

    @IsNumber()
    @IsPositive()
    quantity: number;
}

export class DTOInventorySimple extends DTOInventoryHistory{
    @IsString()
    @IsOptional()
    description?: string;
}
