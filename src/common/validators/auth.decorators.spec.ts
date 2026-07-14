import { validate } from 'class-validator';
import {
  IsStrongPassword,
  IsVerificationCode,
  IsEmailAddress,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_PATTERN,
  VERIFICATION_CODE_LENGTH,
} from './auth.decorators';

class PasswordTestDto {
  @IsStrongPassword()
  password!: string;
}

class OptionalPasswordTestDto {
  @IsStrongPassword({ optional: true })
  password?: string;
}

class CustomPrefixPasswordTestDto {
  @IsStrongPassword({ messagePrefix: '新密码' })
  password!: string;
}

class VerificationCodeTestDto {
  @IsVerificationCode()
  code!: string;
}

class OptionalVerificationCodeTestDto {
  @IsVerificationCode({ optional: true })
  code?: string;
}

class NoExactLengthCodeTestDto {
  @IsVerificationCode({ exactLength: false })
  code!: string;
}

class EmailTestDto {
  @IsEmailAddress()
  email!: string;
}

class OptionalEmailTestDto {
  @IsEmailAddress({ optional: true })
  email?: string;
}

async function validateDto(dto: object): Promise<string[]> {
  const errors = await validate(dto as never);
  return errors.flatMap((e) => Object.values(e.constraints ?? {}));
}

describe('auth decorators constants', () => {
  it('exports correct password length limits', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(32);
  });

  it('exports correct verification code length', () => {
    expect(VERIFICATION_CODE_LENGTH).toBe(6);
  });

  it('exports password pattern requiring upper, lower, and digit', () => {
    expect(PASSWORD_PATTERN.test('Abc12345')).toBe(true);
    expect(PASSWORD_PATTERN.test('abc12345')).toBe(false);
    expect(PASSWORD_PATTERN.test('ABC12345')).toBe(false);
    expect(PASSWORD_PATTERN.test('Abcdefgh')).toBe(false);
  });
});

describe('IsStrongPassword', () => {
  it('passes for a valid password', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'ValidPass123';
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails for password shorter than minimum length', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'Ab1';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password exceeding maximum length', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'Aa1' + 'x'.repeat(PASSWORD_MAX_LENGTH);
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password without uppercase letter', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'validpass123';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password without lowercase letter', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'VALIDPASS123';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for password without digit', async () => {
    const dto = new PasswordTestDto();
    dto.password = 'ValidPassword';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for empty password', async () => {
    const dto = new PasswordTestDto();
    dto.password = '';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows undefined when optional', async () => {
    const dto = new OptionalPasswordTestDto();
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('uses custom message prefix in error messages', async () => {
    const dto = new CustomPrefixPasswordTestDto();
    dto.password = 'short';
    const errors = await validateDto(dto);
    expect(errors.some((m) => m.includes('新密码'))).toBe(true);
  });
});

describe('IsVerificationCode', () => {
  it('passes for a 6-digit code', async () => {
    const dto = new VerificationCodeTestDto();
    dto.code = '123456';
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails for code shorter than 6 digits', async () => {
    const dto = new VerificationCodeTestDto();
    dto.code = '12345';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for code longer than 6 digits', async () => {
    const dto = new VerificationCodeTestDto();
    dto.code = '1234567';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for empty code', async () => {
    const dto = new VerificationCodeTestDto();
    dto.code = '';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows undefined when optional', async () => {
    const dto = new OptionalVerificationCodeTestDto();
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts any non-empty string when exactLength is false', async () => {
    const dto = new NoExactLengthCodeTestDto();
    dto.code = 'abc';
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects empty string when exactLength is false', async () => {
    const dto = new NoExactLengthCodeTestDto();
    dto.code = '';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('IsEmailAddress', () => {
  it('passes for a valid email', async () => {
    const dto = new EmailTestDto();
    dto.email = 'user@example.com';
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });

  it('fails for invalid email format', async () => {
    const dto = new EmailTestDto();
    dto.email = 'not-an-email';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('fails for empty email', async () => {
    const dto = new EmailTestDto();
    dto.email = '';
    const errors = await validateDto(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('allows undefined when optional', async () => {
    const dto = new OptionalEmailTestDto();
    const errors = await validateDto(dto);
    expect(errors).toHaveLength(0);
  });
});
