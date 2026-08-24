import { Controller, Get } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';

@Controller('test-cron')
export class TestCronController {
  constructor(private schedulerRegistry: SchedulerRegistry) {}

  @Get('status')
  getCronStatus() {
    const jobs = this.schedulerRegistry.getCronJobs();
    const cronDetails: Record<string, any> = {};

    jobs.forEach((value, key) => {
      let nextDates: string[] = [];
      try {
        nextDates = value.nextDates(3).map((d) => d.toISO());
      } catch {
        nextDates = ['Error al calcular las próximas ejecuciones'];
      }

      cronDetails[key] = {
        running: value.isActive,
        lastDate: value.lastDate() ? value.lastDate() : 'Aún no ejecutado',
        nextDates: nextDates,
      };
    });

    return {
      serverTimeISO: new Date().toISOString(),
      serverTimeLocal: new Date().toLocaleString('es-VE', {
        timeZone: 'America/Caracas',
      }),
      systemTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      processEnvTZ: process.env.TZ || 'No configurada (UTC por defecto)',
      activeCronJobs: cronDetails,
    };
  }
}
