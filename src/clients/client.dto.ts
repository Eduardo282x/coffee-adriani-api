import { Type } from "class-transformer";
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsPhoneNumber, IsString } from "class-validator";

export class DTOClients {
    @IsString()
    name: string;
    @IsString()
    rif: string;
    @IsString()
    address: string;
    @IsString()
    @IsOptional()
    addressSecondary: string;
    @IsOptional()
    @IsString()
    // @IsPhoneNumber('VE')
    phone: string;
    @IsString()
    zone: string;
    @IsNumber()
    blockId: number;
}

export class DTOBlocks {
    @IsString()
    name: string;
    @IsString()
    address: string;
}

export type StatusPay = 'clean' | 'pending' | 'all';
export class DTOReportClients {
    @IsString()
    @IsOptional()
    zone: string;
    @IsNumber()
    @IsOptional()
    blockId: number;
    @IsString()
    @IsNotEmpty({ message: 'El estatus es requerido' })
    @Type(() => String)
    status: StatusPay;
}