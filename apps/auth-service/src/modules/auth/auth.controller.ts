import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  AUTH_COOKIES,
  CurrentUser,
  readCookie,
  Role,
  Roles,
} from '@medflow/common';
import type { CurrentUserData } from '@medflow/common';
import { getRequestMeta } from '../../common/request-meta';
import { AuthConfigService } from '../../config/auth-config.service';
import { clearAuthCookies, setAuthCookies } from '../sessions/auth-cookies';
import { AuthService } from './auth.service';
import {
  AcceptInviteDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
} from './dto/auth.dto';

const ALL_ROLES = Object.values(Role);

// Public routes (login, refresh, logout, invitations, password reset) are
// let through by the gateway without a JWT. Tokens only travel in cookies.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AuthConfigService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto, getRequestMeta(req));
    setAuthCookies(res, tokens, this.config);
    return { user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { user, tokens } = await this.auth.refresh(
        readCookie(req.headers.cookie, AUTH_COOKIES.REFRESH),
        getRequestMeta(req),
      );
      setAuthCookies(res, tokens, this.config);
      return { user };
    } catch (error) {
      clearAuthCookies(res, this.config); // dead session → drop the cookies
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(
      readCookie(req.headers.cookie, AUTH_COOKIES.ACCESS),
      readCookie(req.headers.cookie, AUTH_COOKIES.REFRESH),
    );
    clearAuthCookies(res, this.config);
    return { message: 'Logged out' };
  }

  @Get('me')
  @Roles(...ALL_ROLES)
  me(@CurrentUser() user: CurrentUserData) {
    return this.auth.me(user.id);
  }

  @Get('invitations/:token')
  previewInvitation(@Param('token') token: string) {
    return this.auth.previewInvitation(token);
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.acceptInvite(
      dto,
      getRequestMeta(req),
    );
    setAuthCookies(res, tokens, this.config);
    return { user };
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto);
    return {
      message:
        'If an account with this email exists, a password reset link has been sent',
    };
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.auth.resetPassword(dto);
    clearAuthCookies(res, this.config);
    return { message: 'Password has been reset, please log in' };
  }
}
