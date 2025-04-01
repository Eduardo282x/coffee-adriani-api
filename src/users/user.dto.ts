import { IsNumber, IsString } from "class-validator";

export class DTOUser {
    @IsString()
    username: string;
    @IsString()
    name: string;
    @IsString()
    lastName: string;
    @IsNumber()
    rolId: number;
}