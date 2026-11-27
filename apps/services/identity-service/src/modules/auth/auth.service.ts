import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { randomInt, createHash , timingSafeEqual} from 'node:crypto';
import { PrismaService } from '../../database/prisma.service.js';
import { RegisterDto } from './dto/register.dto.js';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}


  private generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

private hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}


async register(registerDto: RegisterDto) {
  const { firstName, lastName, email, password, accountType } = registerDto;

  try {
    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new ConflictException('Email is already registered');
    }

    const passwordHash = await argon2.hash(password);

    const user = await this.prisma.user.create({
      data: {
        firstName,
        lastName,
        email,
        passwordHash,
        accountType,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        accountType: true,
        isVerified: true,
        createdAt: true,
      },
    });


    const otp = this.generateOtp();

    const codeHash = this.hashOtp(otp);

    await this.prisma.emailVerification.create({
      data: {
        userId: user.id,
        codeHash,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    return {
      message: 'Registration successful. OTP generated.',
      user,
    };
  } catch (error) {
    if (error instanceof ConflictException) {
      throw error;
    }

    throw new InternalServerErrorException(
      'Unable to complete registration',
    );
  }
}


async verifyEmail(email: string, otp: string) {
  const user = await this.prisma.user.findUnique({
    where: { email },
    select: { id: true, isVerified: true },
  });

  if (!user) {
    throw new NotFoundException('User not found');
  }

  if (user.isVerified) {
    throw new BadRequestException('Email is already verified');
  }

  const verification = await this.prisma.emailVerification.findFirst({
    where: {
      userId: user.id,
      consumedAt: null,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!verification) {
    throw new BadRequestException('No active OTP found');
  }

  if (verification.attempts >= 5) {
    throw new HttpException(
  '              Maximum OTP attempts exceeded. Request a new OTP.',
        HttpStatus.TOO_MANY_REQUESTS,
);
  }

  if (verification.expiresAt.getTime() < Date.now()) {
    throw new BadRequestException('OTP has expired');
  }

  const submittedHash = Buffer.from(this.hashOtp(otp), 'hex');
  const storedHash = Buffer.from(verification.codeHash, 'hex');

  if (!timingSafeEqual(submittedHash, storedHash)) {
    await this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { attempts: { increment: 1 } },
    });

    throw new UnauthorizedException('Invalid OTP');
  }

  await this.prisma.$transaction([
    this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() },
    }),
    this.prisma.user.update({
      where: { id: user.id },
      data: { isVerified: true },
    }),
  ]);

  return {
    message: 'Email verified successfully',
  };
}


}
