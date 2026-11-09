import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  AppException,
  ErrorCode,
  HEADERS,
  requestContext,
} from '@medflow/common';
import { AuthConfigService } from '../../config/auth-config.service';

interface DepartmentRef {
  id: string;
  isActive: boolean;
}

// staff-service internal API. Used by the invite: the admin needs the
// answer now ("this department is inactive"), so it is a sync call; the
// profile itself is still created from the user.invited event.
@Injectable()
export class StaffClient {
  private readonly logger = new Logger(StaffClient.name);

  constructor(private readonly config: AuthConfigService) {}

  // 422 when the department is unknown or inactive, 503 when staff-service
  // cannot answer (the invite is not sent then)
  async assertAssignableDepartment(id: string): Promise<void> {
    const department = await this.fetchDepartment(id);
    if (!department) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'Department not found',
        { field: 'departmentId' },
      );
    }
    if (!department.isActive) {
      throw new AppException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        ErrorCode.BUSINESS_RULE,
        'This department is inactive',
        { field: 'departmentId' },
      );
    }
  }

  private async fetchDepartment(id: string): Promise<DepartmentRef | null> {
    const url = `${this.config.staffServiceUrl}/internal/departments/${encodeURIComponent(id)}`;
    const requestId = requestContext.get().requestId;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          [HEADERS.INTERNAL_KEY]: this.config.internalApiKey,
          ...(requestId ? { [HEADERS.REQUEST_ID]: requestId } : {}),
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch (error) {
      this.logger.warn(
        `staff-service unreachable: ${(error as Error).message}`,
      );
      throw this.unavailable();
    }
    if (res.status === 404) return null;
    if (!res.ok) {
      this.logger.warn(
        `staff-service answered ${res.status} for department ${id}`,
      );
      throw this.unavailable();
    }
    const body = (await res.json()) as { data: DepartmentRef };
    return body.data;
  }

  private unavailable() {
    return new AppException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.SERVICE_UNAVAILABLE,
      'Staff service is unavailable, please try again',
    );
  }
}
