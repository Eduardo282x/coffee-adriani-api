import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOLogin, DTOLoginResponse } from './auth.dto';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class AuthService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly configService: ConfigService
    ) { }

    async login(credentials: DTOLogin): Promise<DTOLoginResponse | DTOBaseResponse> {
        try {
            const findUser = await this.prismaService.users.findFirst({
                where: {
                    username: credentials.username,
                    password: credentials.password
                },
                include: { roles: true }
            })

            if (!findUser) {
                badResponse.message = 'Usuario o contraseña no encontrados.';
                return badResponse;
            }

            baseResponse.message = `Bienvenido ${findUser.name} ${findUser.lastName}`;

            const payload = {
                id: findUser.id,
                name: findUser.name,
                lastName: findUser.lastName,
                username: findUser.username,
                rol: findUser.roles.rol,
            };

            const secretKey = this.configService.get<string>('JWT_SECRET');
            const token = jwt.sign(payload, secretKey, { expiresIn: '7d' });

            const responseLogin: DTOLoginResponse = {
                ...baseResponse,
                token
            }

            return responseLogin;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'AuthService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async recover(credentials: DTOLogin): Promise<DTOBaseResponse> {
        try {
            const findUser = await this.prismaService.users.findFirst({
                where: {
                    username: credentials.username,
                }
            })

            if (!findUser) {
                badResponse.message = 'Usuario no encontrados.';
                return badResponse;
            }

            const updateUser = await this.prismaService.users.update({
                where: { id: findUser.id },
                data: { password: credentials.password },
                include: { roles: true }
            })

            baseResponse.message = `Contraseña Recuperada.`;

            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'AuthService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
