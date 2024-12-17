import { ArgumentMetadata, Injectable, ValidationPipe } from '@nestjs/common';

//Remove after
@Injectable()
export class DebugValidationPipe extends ValidationPipe {
  constructor() {
    super();
  }

  async transform(value: any, metadata: ArgumentMetadata) {
    console.log('DTO being validated:', metadata.metatype.name);
    console.log('DTO data:', value);
    return super.transform(value, metadata);
  }
}
