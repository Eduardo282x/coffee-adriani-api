import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  DTOLogin,
  DTOLoginResponse,
  DTORecover,
  DTORefreshToken,
} from './auth.dto';
import { Public } from 'src/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';
import { Roles } from 'src/guards/roles/roles.decorator';
import { CurrentUser } from 'src/decorators/current-user.decorator';
import { DTOBaseResponse } from 'src/dto/base.dto';

interface RequestWithMeta {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  user?: { id: number; username: string; rol: string };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  private meta(req: RequestWithMeta) {
    const userAgent = req.headers['user-agent'];
    return {
      userAgent: Array.isArray(userAgent) ? userAgent[0] : userAgent,
      ip: req.ip,
    };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  async authLogin(@Body() credentials: DTOLogin, @Req() req: RequestWithMeta) {
    return (await this.authService.login(credentials, this.meta(req))) as
      DTOLoginResponse | DTOBaseResponse;
  }

  /**
   * Rota el refresh token. Publico por naturaleza: la credencial viaja en el
   * cuerpo, no en el header Authorization.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('/refresh')
  async authRefresh(
    @Body() body: DTORefreshToken,
    @Req() req: RequestWithMeta,
  ) {
    return (await this.authService.refresh(
      body.refreshToken,
      this.meta(req),
    )) as DTOLoginResponse | DTOBaseResponse;
  }

  @Public()
  @HttpCode(200)
  @Post('/logout')
  async authLogout(@Body() body: DTORefreshToken) {
    return await this.authService.logout(body.refreshToken);
  }

  /** Cierra todas las sesiones del usuario autenticado. */
  @Post('/logout-all')
  @HttpCode(200)
  async authLogoutAll(@CurrentUser() user: { id: number }) {
    return await this.authService.logoutAll(user.id);
  }

  @Roles('Administrador')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('/recover')
  async authRecover(
    @Body() credentials: DTORecover,
    @CurrentUser() user: { id: number; username: string },
  ) {
    return await this.authService.recover(credentials, user);
  }
}
