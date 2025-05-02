import { IsNotEmpty, IsNumber, IsString } from "class-validator";

export class DTOUser {
    @IsString()
    @IsNotEmpty({ message: 'El nombre de usuario es obligatorio' })
    username: string;
    @IsString()
    @IsNotEmpty({ message: 'El nombre es obligatorio' })
    name: string;
    @IsString()
    @IsNotEmpty({ message: 'El apellido es obligatorio' })
    lastName: string;
    @IsNumber()
    rolId: number;
}