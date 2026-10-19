import { bootstrapService } from '@medflow/common';
import { AppModule } from './app.module';

void bootstrapService(AppModule, 'configurations-service');
