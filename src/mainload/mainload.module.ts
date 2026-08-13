import { Module } from '@nestjs/common';
import { MainloadController } from './mainload.controller';
import { MainloadService } from './mainload.service';

@Module({
  controllers: [MainloadController],
  providers: [MainloadService],
})
export class MainloadModule {}
