import { ThrottlerGuard } from '@nestjs/throttler'
import { Injectable } from '@nestjs/common'

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, any>): Promise<string> {
    const user = (req as unknown as Record<string, unknown>).user as { sub: number };
    console.log('UserThrottlerGuard.getTracker', user);
    if (user?.sub) {
        return Promise.resolve(`user-${user.sub}`);
    } else {
        return Promise.resolve(req.ip as string);
    }
  }
}