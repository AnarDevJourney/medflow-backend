import { Injectable, Logger } from '@nestjs/common';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import type { NextFunction, Request, Response } from 'express';
import { createProxyMiddleware, RequestHandler } from 'http-proxy-middleware';
import { API_PREFIX, ErrorCode, HEADERS } from '@medflow/common';
import { GatewayConfigService } from '../config/gateway-config.service';
import {
  SERVICES,
  ServiceRoute,
  SOCKET_IO_PATH,
  SOCKET_IO_SERVICE,
} from './service-registry';

interface ProxyRoute {
  service: ServiceRoute;
  prefixes: string[];
  handler: RequestHandler;
}

// Forwards /api/v1/<prefix>/* to the owning service unchanged (services use
// the same /api/v1 prefix) and the /socket.io upgrade to notification-history.
// Request bodies are streamed, never parsed here.
@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private readonly routes: ProxyRoute[];
  private readonly socketProxy: RequestHandler;

  constructor(private readonly config: GatewayConfigService) {
    this.routes = SERVICES.map((service) => ({
      service,
      prefixes: service.prefixes.map((p) => `/${API_PREFIX}${p}`),
      handler: this.createProxy(service, false),
    }));

    const socketService = SERVICES.find((s) => s.name === SOCKET_IO_SERVICE)!;
    this.socketProxy = this.createProxy(socketService, true);
  }

  // Express middleware — registered in main.ts before Nest's own routes
  readonly middleware = (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith(SOCKET_IO_PATH)) {
      void this.socketProxy(req, res, next);
      return;
    }

    const route = this.routes.find((r) =>
      r.prefixes.some((p) => req.path === p || req.path.startsWith(`${p}/`)),
    );
    if (!route) return next();

    void route.handler(req, res, next);
  };

  // WebSocket upgrades bypass Express, so they are wired on the HTTP server
  readonly upgrade = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    if (req.url?.startsWith(SOCKET_IO_PATH)) {
      this.socketProxy.upgrade(req, socket, head);
    } else {
      socket.destroy();
    }
  };

  private createProxy(service: ServiceRoute, ws: boolean): RequestHandler {
    return createProxyMiddleware({
      target: this.config.serviceUrl(service),
      changeOrigin: true,
      xfwd: true,
      ws,
      proxyTimeout: 30_000,
      on: {
        proxyReq: (proxyReq, req) => this.prepareHeaders(proxyReq, req),
        proxyReqWs: (proxyReq, req) => this.prepareHeaders(proxyReq, req),
        error: (err, req, res) => this.handleError(service, err, req, res),
      },
    });
  }

  // Never trust identity headers coming from the browser: drop them and set
  // our own. The JWT-derived x-user-* headers are added here in phase 2.
  private prepareHeaders(proxyReq: ClientRequest, req: IncomingMessage) {
    for (const name of proxyReq.getHeaderNames()) {
      if (name.startsWith('x-user-')) proxyReq.removeHeader(name);
    }
    proxyReq.setHeader(HEADERS.INTERNAL_KEY, this.config.internalApiKey);

    const requestId = req.headers[HEADERS.REQUEST_ID];
    if (requestId) proxyReq.setHeader(HEADERS.REQUEST_ID, requestId);
  }

  private handleError(
    service: ServiceRoute,
    err: Error,
    req: IncomingMessage,
    res: ServerResponse | Socket,
  ) {
    this.logger.warn(`${service.name} unreachable: ${err.message}`);

    if (!(res instanceof ServerResponse)) {
      res.destroy();
      return;
    }
    if (res.headersSent) {
      res.end();
      return;
    }

    const label = service.name.replace(/-/g, ' ');
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        success: false,
        error: {
          statusCode: 503,
          code: ErrorCode.SERVICE_UNAVAILABLE,
          message: `${label.charAt(0).toUpperCase()}${label.slice(1)} is unavailable, please try again`,
          path: req.url,
          requestId: req.headers[HEADERS.REQUEST_ID] ?? null,
          details: null,
        },
      }),
    );
  }
}
