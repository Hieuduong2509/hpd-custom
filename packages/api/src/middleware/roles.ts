import type { NextFunction, Request, Response } from 'express';

export function requireRole(...allowed: Array<'admin' | 'owner' | 'dev'>) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = req.user?.role;
    if (!role || !allowed.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
