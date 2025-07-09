import { IsString } from "class-validator";

export class WhatsAppDTO {
    @IsString()
    phone: string;
    @IsString()
    message: string;
}