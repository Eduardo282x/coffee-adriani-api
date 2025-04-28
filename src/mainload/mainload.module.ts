import { Module } from '@nestjs/common';
import { MainloadController } from './mainload.controller';
import { MainloadService } from './mainload.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [MainloadController],
  providers: [MainloadService, PrismaService]
})
export class MainloadModule {}
