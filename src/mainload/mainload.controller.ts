import { Controller, Get } from '@nestjs/common';
import { MainloadService } from './mainload.service';
import { Public } from 'src/decorators/public.decorator';

@Controller('mainload')
export class MainloadController {
  constructor(private readonly mainloadService: MainloadService) {}

  @Public()
  @Get()
  async mainLoad() {
    return await this.mainloadService.mainLoad();
  }
}
