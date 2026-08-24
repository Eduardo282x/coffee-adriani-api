import { Module } from '@nestjs/common';
import { TestCronController } from './test-cron.controller';

@Module({
  controllers: [TestCronController],
})
export class TestCronModule {}
