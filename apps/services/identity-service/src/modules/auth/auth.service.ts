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
import { EmailService } from '../email/email.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}


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
    await this.emailService.sendVerificationOtp(email, otp);

    return {
      message: 'Registration successful. Verification email sent.',
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

async resendOtp(email: string) {
  const user = await this.prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isVerified: true,
    },
  });

  // Avoid revealing whether an email is registered.
  if (!user || user.isVerified) {
    return {
      message: 'If the account is eligible, a verification email will be sent.',
    };
  }

  const now = new Date();
  const cooldownMs = 60 * 1000;
  const rateLimitWindowMs = 15 * 60 * 1000;
  const rateLimit = 3;

  const latestVerification =
    await this.prisma.emailVerification.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });

  if (
    latestVerification &&
    now.getTime() - latestVerification.createdAt.getTime() < cooldownMs
  ) {
    throw new HttpException(
      'Please wait 60 seconds before requesting another OTP.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  const recentRequests = await this.prisma.emailVerification.count({
    where: {
      userId: user.id,
      createdAt: {
        gte: new Date(now.getTime() - rateLimitWindowMs),
      },
    },
  });

  if (recentRequests >= rateLimit) {
    throw new HttpException(
      'OTP request limit reached. Please try again later.',
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  const otp = this.generateOtp();
  const codeHash = this.hashOtp(otp);

  await this.prisma.emailVerification.updateMany({
    where: {
      userId: user.id,
      consumedAt: null,
    },
    data: {
      consumedAt: now,
    },
  });

  const verification = await this.prisma.emailVerification.create({
    data: {
      userId: user.id,
      codeHash,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    },
  });

  try {
    await this.emailService.sendVerificationOtp(email, otp);
  } catch (error) {
    // Keep the failed request record for rate limiting,
    // but make its OTP unusable.
    await this.prisma.emailVerification.update({
      where: { id: verification.id },
      data: { consumedAt: new Date() },
    });

    throw error;
  }

  return {
    message: 'If the account is eligible, a verification email will be sent.',
  };
}


}
