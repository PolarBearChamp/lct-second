import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { assessableSkills } from '../../domain/assessment/bank/registry';
import {
  COMPETENCY_GROUPS,
  GRADE_CODES,
  GRADE_TITLES,
  INDUSTRIES,
  isSpecializationCode,
  SKILLS,
  SOFT_SKILLS,
  SPECIALIZATIONS,
  SPECIALIZATION_CODES,
  TEAM_ROLES,
  TIMEZONES,
} from '../../domain/catalog/catalog';
import { SURVEY_QUESTIONS, SURVEY_VERSION } from '../../domain/catalog/survey';
import { unprocessable } from '../../common/errors';
import { Public } from '../auth/decorators';
import { ReferenceDto, SkillDto, SpecializationDto, SurveyDto } from './dto/catalog.dto';

@ApiTags('catalogs')
@Public()
@Controller('catalogs')
export class CatalogsController {
  @Get('specializations')
  @ApiOperation({ summary: 'Специализации и группы компетенций' })
  specializations(): SpecializationDto[] {
    return SPECIALIZATIONS.map((spec) => ({
      code: spec.code,
      title: spec.title,
      description: spec.description,
      groups: COMPETENCY_GROUPS.filter((g) => g.specialization === spec.code)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((g) => ({ code: g.code, title: g.title })),
    }));
  }

  @Get('skills')
  @ApiOperation({
    summary: 'Справочник навыков',
    description: 'assessableIn — специализации, в тестах которых навык реально проверяется заданиями банка.',
  })
  @ApiQuery({ name: 'specialization', required: false, enum: SPECIALIZATION_CODES })
  skills(@Query('specialization') specialization?: string): SkillDto[] {
    if (specialization !== undefined && !isSpecializationCode(specialization)) {
      throw unprocessable('UNKNOWN_SPECIALIZATION', 'Неизвестная специализация');
    }
    const assessable = new Map(SPECIALIZATION_CODES.map((code) => [code, assessableSkills(code)]));
    return SKILLS.filter((skill) => !specialization || skill.specializations.includes(specialization as never))
      .map((skill) => ({
        code: skill.code,
        title: skill.title,
        category: skill.category,
        specializations: skill.specializations,
        assessableIn: SPECIALIZATION_CODES.filter((code) => assessable.get(code)?.has(skill.code)),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  @Get('reference')
  @ApiOperation({ summary: 'Прочие справочники: отрасли, роли, soft skills, часовые пояса, форматы работы, грейды' })
  reference(): ReferenceDto {
    return {
      industries: INDUSTRIES,
      teamRoles: TEAM_ROLES,
      softSkills: SOFT_SKILLS,
      timezones: TIMEZONES,
      workFormats: [
        { code: 'REMOTE', title: 'Удалённо' },
        { code: 'HYBRID', title: 'Гибрид' },
        { code: 'OFFICE', title: 'Офис' },
      ],
      grades: GRADE_CODES.map((code) => ({ code, title: GRADE_TITLES[code] })),
    };
  }

  @Get('survey')
  @ApiOperation({ summary: 'Онбординговый опрос кандидата' })
  survey(): SurveyDto {
    return { version: SURVEY_VERSION, questions: SURVEY_QUESTIONS };
  }
}
