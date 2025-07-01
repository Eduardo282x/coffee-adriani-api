import { IsBoolean, IsNotEmpty, IsNumber, IsString } from "class-validator";

export class MessageDTO {
    @IsString()
    @IsNotEmpty({message: 'Este campo es necesario'})
    title: string;
    @IsString()
    @IsNotEmpty({message: 'Este campo es necesario'})
    content: string;
}
export class CollectionDTO {
    @IsNumber()
    @IsNotEmpty({message: 'Este campo es necesario'})
    messageId: number;
    @IsBoolean()
    @IsNotEmpty({message: 'Este campo es necesario'})
    send: boolean;
}