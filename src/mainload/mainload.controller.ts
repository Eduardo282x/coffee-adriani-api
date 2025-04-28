import { Controller, Get } from '@nestjs/common';
import { MainloadService } from './mainload.service';

@Controller('mainload')
export class MainloadController {

    constructor(private readonly mainloadService: MainloadService) {
        
    }

    @Get()
    async mainLoad() {
        return await this.mainloadService.mainLoad();
    }
}
