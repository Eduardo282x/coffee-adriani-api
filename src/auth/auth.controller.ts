import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DTOLogin } from './auth.dto';

@Controller('auth')
export class AuthController {

    constructor(private readonly authService: AuthService) {

    }

    @Post()
    async authLogin(@Body() credentials: DTOLogin) {
        return await this.authService.login(credentials);
    }
    @Post('/recover')
    async authRecover(@Body() credentials: DTOLogin) {
        return await this.authService.recover(credentials);
    }
}
