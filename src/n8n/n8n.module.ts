import { Module } from '@nestjs/common';
import { N8nService } from './n8n.service';
import { ConfigService } from '@nestjs/config';

@Module({
    providers: [N8nService, ConfigService],
    exports: [N8nService],
})
export class N8nModule {}
