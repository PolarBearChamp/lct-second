import { ApiProperty } from '@nestjs/swagger';

export class MeUserDto {
  id!: string;
  email!: string;
  @ApiProperty({ enum: ['CANDIDATE', 'EMPLOYER'] })
  role!: 'CANDIDATE' | 'EMPLOYER';
  emailVerified!: boolean;
  /** Демонстрационный аккаунт из seed. */
  isDemo!: boolean;
}

export class OnboardingStepDto {
  @ApiProperty({ enum: ['EMAIL', 'PROFILE', 'SURVEY', 'ASSESSMENT', 'PUBLICATION'] })
  key!: 'EMAIL' | 'PROFILE' | 'SURVEY' | 'ASSESSMENT' | 'PUBLICATION';
  title!: string;
  done!: boolean;
}

export class DiscoverabilityIssueDto {
  @ApiProperty({
    enum: [
      'EMAIL_NOT_VERIFIED',
      'PROFILE_INCOMPLETE',
      'NO_CONTACT_CHANNEL',
      'NO_PUBLICATION_CONSENT',
      'NOT_DISCOVERABLE',
      'PAUSED',
      'NO_CONFIRMED_QUALIFICATION',
      'UNDERAGE',
      'GUARDIAN_CONSENT_REQUIRED',
    ],
  })
  code!: string;
  message!: string;
  @ApiProperty({ required: false, type: [String] })
  missingFields?: string[];
}

export class CandidateMeStateDto {
  profileId!: string;
  /** Системный псевдоним для обезличенной карточки. */
  alias!: string;
  @ApiProperty({ nullable: true, type: String })
  activeSpecialization!: string | null;
  @ApiProperty({ nullable: true, enum: ['JUNIOR', 'MIDDLE', 'SENIOR'] })
  declaredGrade!: string | null;
  /** Грейд по результатам тестирования по активной специализации. */
  @ApiProperty({ nullable: true, enum: ['JUNIOR', 'MIDDLE', 'SENIOR'] })
  confirmedGrade!: string | null;
  @ApiProperty({ type: [OnboardingStepDto] })
  onboarding!: OnboardingStepDto[];
  @ApiProperty({ nullable: true, enum: ['EMAIL', 'PROFILE', 'SURVEY', 'ASSESSMENT', 'PUBLICATION'] })
  nextStep!: string | null;
  discoverable!: boolean;
  @ApiProperty({ type: [DiscoverabilityIssueDto] })
  discoverabilityIssues!: DiscoverabilityIssueDto[];
  newInvitations!: number;
  pendingDirectTasks!: number;
}

export class EmployerMeStateDto {
  @ApiProperty({ nullable: true, type: String })
  companyId!: string | null;
  @ApiProperty({ nullable: true, type: String })
  companyName!: string | null;
  companyComplete!: boolean;
  activeNeeds!: number;
  newApplications!: number;
  pendingTaskReviews!: number;
}

export class MeResponseDto {
  user!: MeUserDto;
  @ApiProperty({ nullable: true, type: CandidateMeStateDto })
  candidate!: CandidateMeStateDto | null;
  @ApiProperty({ nullable: true, type: EmployerMeStateDto })
  employer!: EmployerMeStateDto | null;
}
