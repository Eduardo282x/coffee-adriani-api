import { IsNotEmpty, IsString } from "class-validator";

export class SellersDto {
    @IsString()
    @IsNotEmpty({ message: 'El nombre es requerido' })
    name: string;
    @IsString()
    phone: string;
}