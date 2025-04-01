import { IsString } from "class-validator";
import { DTOBaseResponse } from "src/dto/base.dto";

export class DTOLogin {
    @IsString()
    username: string;
    @IsString()
    password: string;
}

export class DTOLoginResponse extends DTOBaseResponse {
    token: string;
}