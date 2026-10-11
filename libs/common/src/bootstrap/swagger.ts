import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { HEADERS } from '../constants/headers';

// Per-service Swagger UI at /docs (dev only). Calling a service directly
// needs the internal key, plus x-user-* headers to act as a user.
export function setupSwagger(app: INestApplication, appName: string): void {
  const config = new DocumentBuilder()
    .setTitle(`MedFlow — ${appName}`)
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: HEADERS.INTERNAL_KEY },
      'internal-key',
    )
    .addSecurityRequirements('internal-key')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document);
}
