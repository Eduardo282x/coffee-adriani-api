import { Transform, Type } from "class-transformer";
import { IsBoolean, IsDate, IsEmail, IsNumber, IsOptional, IsString } from "class-validator";

export class CreateSupplierDTO {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    rif?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    rubro?: string;
}

export class UpdateSupplierDTO {
    @IsString()
    name: string;

    @IsString()
    @IsOptional()
    rif?: string;

    @IsString()
    @IsOptional()
    phone?: string;

    @IsString()
    @IsOptional()
    address?: string;

    @IsString()
    @IsOptional()
    email?: string;

    @IsString()
    @IsOptional()
    rubro?: string;
}

export class SupplierFilterDTO {
    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    page?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    limit?: number;

    @IsString()
    @IsOptional()
    search?: string;

    @IsBoolean()
    @IsOptional()
    @Transform(({ value }) => {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
    })
    active?: boolean;
}

export class SupplierPaymentFilterDTO {
    @IsNumber()
    @Type(() => Number)
    supplierId: number;

    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    startDate?: Date | string;

    @IsOptional()
    @IsDate()
    @Transform(({ value }) => new Date(value))
    endDate?: Date | string;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    page?: number;

    @IsNumber()
    @IsOptional()
    @Type(() => Number)
    limit?: number;
}
