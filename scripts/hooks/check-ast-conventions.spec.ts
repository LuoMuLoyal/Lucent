import { describe, expect, it } from 'vitest';
import {
  AUTH_POSTURE_DECORATORS,
  checkDtoValidatorExplicitness,
  checkEndpointAuthPosture,
  getDecoratorName,
  getDecorators,
  HTTP_METHOD_DECORATORS,
  parseSourceFile,
  RULE_DTO_VALIDATOR_MISSING,
  RULE_ENDPOINT_AUTH_POSTURE,
} from './check-ast-conventions.ts';
import ts from 'typescript';

const DTO_FILE = 'src/modules/sample/dto/sample.dto.ts';
const CONTROLLER_FILE = 'src/modules/sample/sample.controller.ts';

const DTO_MISSING = `\
import { ApiProperty } from '@nestjs/swagger';

export class SampleDto {
  @ApiProperty()
  title!: string;
}
`;

const DTO_VALID = `\
import { IsString, MaxLength } from 'class-validator';

export class SampleDto {
  @IsString()
  @MaxLength(80)
  title!: string;
}
`;

describe('checkDtoValidatorExplicitness', () => {
  it('flags a DTO property with no @Is* decorator', () => {
    const warnings = checkDtoValidatorExplicitness(DTO_FILE, DTO_MISSING);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      file: DTO_FILE,
      line: 5,
      rule: RULE_DTO_VALIDATOR_MISSING,
    });
    expect(warnings[0].message).toContain('title');
  });

  it('does not flag a property carrying @Is* decorators', () => {
    expect(checkDtoValidatorExplicitness(DTO_FILE, DTO_VALID)).toEqual([]);
  });

  it('accepts repo composite validators named with the Is prefix', () => {
    const source = `\
import { IsStrongPassword } from '../../../common/validators/auth.decorators';

export class PasswordDto {
  @IsStrongPassword()
  password!: string;
}
`;
    expect(checkDtoValidatorExplicitness(DTO_FILE, source)).toEqual([]);
  });

  it('excludes private readonly injection members (modifier-based)', () => {
    const source = `\
export class SampleDto {
  private readonly client: HttpClient;
}
`;
    expect(checkDtoValidatorExplicitness(DTO_FILE, source)).toEqual([]);
  });

  it('excludes static members', () => {
    const source = `\
export class SampleDto {
  static readonly KIND = 'sample';

  title!: string;
}
`;
    const warnings = checkDtoValidatorExplicitness(DTO_FILE, source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain('title');
    expect(warnings[0].line).toBe(4);
  });

  it('checks every class in the file', () => {
    const source = `\
export class FirstDto {
  title!: string;
}

export class SecondDto {
  name!: string;
}
`;
    const warnings = checkDtoValidatorExplicitness(DTO_FILE, source);
    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.line)).toEqual([2, 6]);
  });
});

const CONTROLLER_MISSING = `\
import { Get } from '@nestjs/common';

export class SampleController {
  @Get()
  list() {
    return [];
  }
}
`;

describe('checkEndpointAuthPosture', () => {
  it('flags an endpoint with no auth posture marker', () => {
    const warnings = checkEndpointAuthPosture(
      CONTROLLER_FILE,
      CONTROLLER_MISSING,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      file: CONTROLLER_FILE,
      line: 5,
      rule: RULE_ENDPOINT_AUTH_POSTURE,
    });
    expect(warnings[0].message).toContain('list');
  });

  it('exempts a method-level @UseGuards endpoint', () => {
    const source = `\
import { Get, UseGuards } from '@nestjs/common';

export class SampleController {
  @Get()
  @UseGuards(SomeGuard)
  list() {
    return [];
  }
}
`;
    expect(checkEndpointAuthPosture(CONTROLLER_FILE, source)).toEqual([]);
  });

  it('exempts a method-level @Public endpoint', () => {
    const source = `\
import { Get } from '@nestjs/common';

export class SampleController {
  @Public()
  @Get()
  list() {
    return [];
  }
}
`;
    expect(checkEndpointAuthPosture(CONTROLLER_FILE, source)).toEqual([]);
  });

  it('exempts endpoints of a class guarded by class-level @UseGuards', () => {
    const source = `\
import { Get, UseGuards } from '@nestjs/common';

@UseGuards(SomeGuard)
export class SampleController {
  @Get()
  list() {
    return [];
  }
}
`;
    expect(checkEndpointAuthPosture(CONTROLLER_FILE, source)).toEqual([]);
  });

  it('exempts endpoints of a @Public class', () => {
    const source = `\
import { Get } from '@nestjs/common';

@Public()
export class SampleController {
  @Get()
  list() {
    return [];
  }
}
`;
    expect(checkEndpointAuthPosture(CONTROLLER_FILE, source)).toEqual([]);
  });

  it('does not treat @Throttle as an auth posture', () => {
    const source = `\
import { Get } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

export class SampleController {
  @Get()
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  list() {
    return [];
  }
}
`;
    const warnings = checkEndpointAuthPosture(CONTROLLER_FILE, source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe(RULE_ENDPOINT_AUTH_POSTURE);
  });

  it('ignores methods without an HTTP method decorator', () => {
    const source = `\
export class SampleController {
  @ApiOperation({ summary: 'not an endpoint' })
  helper() {
    return 1;
  }
}
`;
    expect(checkEndpointAuthPosture(CONTROLLER_FILE, source)).toEqual([]);
  });

  it('treats @Sse as an endpoint', () => {
    const source = `\
import { Sse } from '@nestjs/common';

export class SampleController {
  @Sse('stream')
  stream() {
    return of({});
  }
}
`;
    const warnings = checkEndpointAuthPosture(CONTROLLER_FILE, source);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].line).toBe(5);
    expect(warnings[0].message).toContain('stream');
  });
});

describe('decorator tables', () => {
  it('covers the HTTP surface used by the repo and the posture set', () => {
    for (const name of ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Sse']) {
      expect(HTTP_METHOD_DECORATORS).toContain(name);
    }
    expect(AUTH_POSTURE_DECORATORS).toEqual(['Public', 'UseGuards']);
  });

  it('resolves bare, called, and member-access decorator names', () => {
    const source = `\
class A {
  @Public() a: string;
  @UseGuards(G) b: string;
  @Ns.Foo('x') c: string;
}
`;
    const statement = parseSourceFile(source).statements.find(
      ts.isClassDeclaration,
    );
    if (!statement) throw new Error('class not parsed');
    const names = statement.members.map((member) =>
      getDecorators(member).map((decorator) => getDecoratorName(decorator)),
    );
    expect(names).toEqual([['Public'], ['UseGuards'], ['Foo']]);
  });
});
