import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prismaService: PrismaService) {}

  async getNotifications() {
    return await this.prismaService.notification.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        Client: true,
      },
    });
  }

  async createNotification(type: string, message: string, clientId: number) {
    try {
      await this.prismaService.notification.create({
        data: {
          type,
          message,
          clientId,
        },
      });
      baseResponse.message = 'Notificación creada';
      return baseResponse;
    } catch (error) {
      badResponse.message = 'Error al crear la notificación' + error;
      return badResponse;
    }
  }

  async markAsSeen(id: number) {
    try {
      await this.prismaService.notification.update({
        where: { id },
        data: { seen: true },
      });
      baseResponse.message = 'Notificación marcada como vista';
      return baseResponse;
    } catch (error) {
      badResponse.message =
        'Error al marcar la notificación como vista' + error;
      return badResponse;
    }
  }
}
