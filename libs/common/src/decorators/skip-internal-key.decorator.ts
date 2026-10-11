import { SetMetadata } from '@nestjs/common';

export const SKIP_INTERNAL_KEY = 'skipInternalKey';

// For routes that must answer without the gateway, e.g. /health for Docker
export const SkipInternalKey = () => SetMetadata(SKIP_INTERNAL_KEY, true);
