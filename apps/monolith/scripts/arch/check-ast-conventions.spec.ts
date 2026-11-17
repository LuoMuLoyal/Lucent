import { describe, expect, it } from 'vitest';
import {
  AUTH_POSTURE_DECORATORS,
  checkEndpointAuthPosture,
  getDecoratorName,
  getDecorators,
  HTTP_METHOD_DECORATORS,
  parseSourceFile,
  RULE_ENDPOINT_AUTH_POSTURE,
} from './check-ast-conventions.ts';
import ts from 'typescript';

const CONTROLLER_FILE = 'src/modules/sample/sample.controller.ts';

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
