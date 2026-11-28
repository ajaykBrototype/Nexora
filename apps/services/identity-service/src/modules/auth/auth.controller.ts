
import { Body, Controller, Post } from '@nestjs/common';
import { RegisterDto } from './dto/register.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { ResendOtpDto } from './dto/resend-otp.dto.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Post('verify-email')
  verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
  return this.authService.verifyEmail(
    verifyEmailDto.email,
    verifyEmailDto.otp,
  );
}

@Post('resend-otp')
resendOtp(@Body() resendOtpDto: ResendOtpDto) {
  return this.authService.resendOtp(resendOtpDto.email);
}
}
