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

export class DTOUpdateHistoryInventory {
    @IsString()
    controlNumberOld: string;
    @IsString()
    controlNumber: string;
    @IsDate()
    @Transform(({ value }) => new Date(value))
    date: Date;
}

export class CreateInventoryEntryDTO {
    @IsString()
    controlNumber: string;

    @IsString()
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsDate()
    @Transform(({ value }) => new Date(value))
    date: Date;

    @IsNumber()
    @IsOptional()
    supplierId?: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InventoryEntryDetailDTO)
    details: InventoryEntryDetailDTO[];
}

export class InventoryEntryDetailDTO {
    @IsNumber()
    @IsPositive()
    productId: number;

    @IsNumber()
    @IsPositive()
    quantity: number;

    @IsNumber()
    unitPrice: number;

    @IsNumber()
    @IsOptional()
    unitPriceUSD?: number;
}

export class InventoryEntryFilterDTO {
    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    page?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    limit?: number;

    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate?: Date | string;

    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate?: Date | string;

    @IsString()
    @IsOptional()
    typeMovement?: string;

    @IsString()
    @IsOptional()
    typeProduct?: string;

    @IsString()
    @IsOptional()
    controlNumber?: string;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    supplierId?: number;
}
