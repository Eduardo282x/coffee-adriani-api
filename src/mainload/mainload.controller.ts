import { Controller, Get } from '@nestjs/common';
import { MainloadService } from './mainload.service';
import { Public } from 'src/decorators/public.decorator';
import { Throttle } from '@nestjs/throttler';

@Controller('mainload')
export class MainloadController {
  constructor(private readonly mainloadService: MainloadService) {}

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @Get()
  async mainLoad() {
    return await this.mainloadService.mainLoad();
  }
}
