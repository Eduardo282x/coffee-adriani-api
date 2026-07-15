import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOLogin, DTOLoginResponse } from './auth.dto';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly configService: ConfigService
    ) { }

    private getErrorMessage(err: unknown): string {
        return err instanceof Error ? err.message : 'Error interno del servidor';
    }

    async login(credentials: DTOLogin): Promise<DTOLoginResponse | DTOBaseResponse> {
        try {
            const findUser = await this.prismaService.users.findFirst({
                where: {
                    username: credentials.username,
                },
                include: { roles: true }
            })

            if (!findUser) {
                badResponse.message = 'Usuario o contraseña no encontrados.';
                return badResponse;
            }

            const isPasswordValid = await bcrypt.compare(credentials.password, findUser.password);
            if (!isPasswordValid) {
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

            const secretKey = process.env.JWT_SECRET;
            if (!secretKey) {
                badResponse.message = 'JWT_SECRET no esta configurado en las variables de entorno.';
                return badResponse;
            }
            const token = jwt.sign(payload, secretKey, { expiresIn: '7d' });

            const responseLogin: DTOLoginResponse = {
                ...baseResponse,
                token
            }

            return responseLogin;
        } catch (err) {
            const errorMessage = this.getErrorMessage(err);
            await this.prismaService.errorMessages.create({
                data: { message: errorMessage, from: 'AuthService' }
            })
            badResponse.message = errorMessage;
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

            const hashedPassword = await bcrypt.hash(credentials.password, 12);
            const updateUser = await this.prismaService.users.update({
                where: { id: findUser.id },
                data: { password: hashedPassword },
                include: { roles: true }
            })

            baseResponse.message = `Contraseña Recuperada.`;

            return baseResponse;
        } catch (err) {
            const errorMessage = this.getErrorMessage(err);
            await this.prismaService.errorMessages.create({
                data: { message: errorMessage, from: 'AuthService' }
            })
            badResponse.message = errorMessage;
            return badResponse;
        }
    }

    async migratePasswords(): Promise<DTOBaseResponse> {
        try {
            const users = await this.prismaService.users.findMany();
            let migratedCount = 0;

            for (const user of users) {
                const isAlreadyHashed = user.password.startsWith('$2b$');
                if (!isAlreadyHashed) {
                    const hashedPassword = await bcrypt.hash(user.password, 12);
                    await this.prismaService.users.update({
                        where: { id: user.id },
                        data: { password: hashedPassword }
                    });
                    migratedCount++;
                }
            }

            baseResponse.message = `${migratedCount} contraseñas migradas exitosamente.`;
            return baseResponse;
        } catch (err) {
            const errorMessage = this.getErrorMessage(err);
            await this.prismaService.errorMessages.create({
                data: { message: errorMessage, from: 'AuthService' }
            })
            badResponse.message = errorMessage;
            return badResponse;
        }
    }
}
