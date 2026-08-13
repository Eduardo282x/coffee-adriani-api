import { IsNotEmpty, IsString } from 'class-validator';

export class WhatsAppDTO {
  @IsString()
  @IsNotEmpty({ message: 'El numero de teléfono es requerido' })
  phone: string;
  @IsString()
  @IsNotEmpty({ message: 'El mensaje es requerido' })
  message: string;
}
