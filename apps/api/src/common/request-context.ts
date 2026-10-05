import type { Request } from 'express';
import type { Role } from '../generated/prisma/client';

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: Role;
  emailVerified: boolean;
  isDemo: boolean;
}

export interface AppRequest extends Request {
  requestId: string;
  auth?: AuthContext;
}
