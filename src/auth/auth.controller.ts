import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { DTOLogin } from './auth.dto';
import { Public } from 'src/decorators/public.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post()
  async authLogin(@Body() credentials: DTOLogin) {
    return await this.authService.login(credentials);
  }
  @Public()
  @Post('/recover')
  async authRecover(@Body() credentials: DTOLogin) {
    return await this.authService.recover(credentials);
  }
  @Public()
  @Post('/migrate-passwords')
  async migratePasswords() {
    return await this.authService.migratePasswords();
  }
}
