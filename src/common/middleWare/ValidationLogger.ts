import { Injectable, NestMiddleware } from '@nestjs/common';

//Remove after
@Injectable()
export class ValidationLoggerMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    console.log('Validating DTO:', req.body);
    next();
  }
}
