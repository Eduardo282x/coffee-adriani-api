import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AccessTokenPayload } from '../auth/refresh-token.service';

export interface AuthenticatedUser {
  id: number;
  username: string;
  name: string;
  lastName: string;
  rol: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest();
    const payload = request.user as AccessTokenPayload | undefined;

    if (!payload) {
      return undefined as unknown as AuthenticatedUser;
    }

    return {
      id: payload.sub,
      username: payload.username,
      name: payload.name,
      lastName: payload.lastName,
      rol: payload.rol,
    };
  },
);
