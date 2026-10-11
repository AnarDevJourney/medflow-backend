import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import type { Response } from 'express';
import { GatewayConfigService } from '../config/gateway-config.service';
import { SERVICES } from '../proxy/service-registry';

// GET /docs (dev only) — one page linking every service's Swagger UI
@Controller('docs')
export class DocsController {
  constructor(private readonly config: GatewayConfigService) {}

  @Get()
  index(@Res() res: Response) {
    if (this.config.isProduction) throw new NotFoundException();

    const links = SERVICES.map((s) => {
      const url = `${this.config.serviceUrl(s)}/docs`;
      return `<li><a href="${url}">${s.name}</a> <code>${s.prefixes.join(', ')}</code></li>`;
    }).join('\n');

    res.type('html').send(`<!doctype html>
<html><head><meta charset="utf-8"><title>MedFlow API docs</title>
<style>body{font-family:system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px}li{margin:8px 0}code{color:#555}</style>
</head><body><h1>MedFlow API docs</h1><ul>${links}</ul></body></html>`);
  }
}
