import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DTOLogin } from './auth.dto';

@Controller('auth')
export class AuthController {

    constructor(private authService: AuthService) {

    }

    @Post()
    async authLogin(@Body() credentials: DTOLogin) {
        return await this.authService.login(credentials);
    }
}
