import { IsNumber, IsOptional, IsPhoneNumber, IsString } from "class-validator";

export class DTOClients {
    @IsString()
    name: string;
    @IsString()
    rif: string;
    @IsString()
    address: string;
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