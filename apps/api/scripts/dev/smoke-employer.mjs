// Отладочный сквозной прогон: кандидат → тест → публикация; работодатель → потребность → подборка → приглашение → принятие.
import { writeFileSync } from 'node:fs';
import { Actor, check, passAssessment, registerVerified } from './smoke-lib.mjs';

const stamp = Date.now();
const cand = new Actor('candidate');
await registerVerified(cand, `smoke.cand.${stamp}@example.com`, 'CANDIDATE');
await cand.ok('PATCH', '/candidate/profile', {
  fullName: 'Иванова Смоук Тестовна',
  city: 'Москва',
  timezone: 'Europe/Moscow',
  workFormats: ['REMOTE', 'HYBRID'],
  experienceMonths: 40,
  skills: [{ code: 'postgresql', months: 30 }, { code: 'kafka' }, { code: 'nestjs', months: 20 }],
  contactEmail: `ivanova.${stamp}@example.com`,
  phone: '+7 900 111-22-33',
  messenger: '@ivanova_smoke',
  disclosureChannels: ['EMAIL', 'MESSENGER'],
  salaryFrom: 200000,
  salaryTo: 300000,
});
await cand.ok('PUT', '/candidate/survey', { answers: { industries: ['FINTECH'], focus: 'SERVER', recentTasks: ['API', 'DB'], experience: 'Y3_PLUS', autonomy: 'LEADING' } });
await cand.ok('PATCH', '/candidate/profile', { activeSpecialization: 'BACKEND', declaredGrade: 'SENIOR' });
const result = await passAssessment(cand, 'BACKEND', 'SENIOR');
check(result.status === 'PASSED', `кандидат прошёл тест BACKEND/SENIOR (балл ${result.overallScore})`);
await cand.ok('PUT', '/candidate/consents', { profilePublication: true });
await cand.ok('PATCH', '/candidate/profile', { isDiscoverable: true });
const fsp = await cand.ok('POST', '/candidate/fsp-link', { fspId: 'FSP-DEMO-1001', code: '731905' });
check(fsp.state === 'LINKED_WITH_HISTORY', `ФСП привязан: ${fsp.state}, достижений ${fsp.achievements.length}`);
const me = await cand.ok('GET', '/auth/me');
check(me.candidate.discoverable, 'кандидат виден в поиске');
const candidateId = me.candidate.profileId;

const emp = new Actor('employer');
await registerVerified(emp, `smoke.emp.${stamp}@example.com`, 'EMPLOYER');
const noCompany = await emp.raw('POST', '/employer/needs', {});
check(noCompany.status === 409 || noCompany.status === 422, `без компании нельзя создать потребность (${noCompany.status} ${noCompany.json.code})`);
await emp.ok('PUT', '/employer/company', { name: 'Смоук Финтех', description: 'Платёжный сервис', industry: 'FINTECH', website: 'https://example.com', contactPersonName: 'Анна HR', contactChannelType: 'EMAIL', contactValue: 'hr@example.com' });
const badNeed = await emp.raw('POST', '/employer/needs', {
  title: 'Backend', description: 'Описание команды платежей', specialization: 'BACKEND', allowedGrades: ['SENIOR'],
  requiredSkills: ['nestjs'], preferredSkills: [], workFormat: 'REMOTE', salaryFrom: 250000, salaryTo: 350000, salaryType: 'GROSS',
});
check(badNeed.status === 422, `непроверяемый обязательный навык отклонён: ${badNeed.json.details?.fields?.requiredSkills?.[0]}`);
const need = await emp.ok('POST', '/employer/needs', {
  title: 'Senior backend в команду платежей',
  description: 'API приёма платежей, идемпотентность, PostgreSQL, очереди.',
  specialization: 'BACKEND',
  allowedGrades: ['MIDDLE', 'SENIOR'],
  requiredSkills: ['sql', 'postgresql'],
  preferredSkills: [{ skill: 'kafka', mode: 'SELF_REPORTED_ALLOWED' }, { skill: 'nestjs', mode: 'VERIFIED_ONLY' }, { skill: 'transactions', mode: 'VERIFIED_ONLY' }],
  workFormat: 'REMOTE',
  salaryFrom: 250000,
  salaryTo: 350000,
  salaryType: 'GROSS',
});
const preview = await emp.ok('POST', `/employer/needs/${need.id}/assessment-preview`, { grade: 'SENIOR' });
const cov = preview.grades[0].blueprint.coverage.map((c) => `${c.skill}:${c.status}`).join(' ');
check(!JSON.stringify(preview).includes('correct'), `предпросмотр без ключей; покрытие: ${cov}`);
const selection = await emp.ok('POST', `/employer/needs/${need.id}/selections`, {});
const mine = selection.items.find((i) => !i.unavailable && i.candidate.candidateId === candidateId);
check(Boolean(mine), `кандидат в подборке (всего ${selection.totalMatched} из ${selection.totalConsidered})`);
if (mine) {
  console.log('  score:', mine.score, '| почему:', mine.explanation.why.slice(0, 3).join(' | '));
  console.log('  не подтверждено:', mine.explanation.notVerified.join(' | '));
}
const leakSel = ['Иванова', 'ivanova', '+7 900', '@ivanova'].filter((s) => JSON.stringify(selection).includes(s));
check(leakSel.length === 0, `подборка без контактов (${leakSel})`);
const card = await emp.ok('GET', `/employer/candidates/${candidateId}?needId=${need.id}`);
const leakCard = ['Иванова', 'ivanova', '+7 900', '@ivanova', 'FSP-DEMO'].filter((s) => JSON.stringify(card).includes(s));
check(card.profile.mode === 'EMPLOYER_REDACTED' && leakCard.length === 0, `карточка обезличена (${card.profile.mode}, утечек: ${leakCard.length})`);
const pdfRedacted = await emp.raw('GET', `/employer/candidates/${candidateId}/pdf`);
check(pdfRedacted.status === 200 && pdfRedacted.buffer.length > 1000, `PDF обезличенный: ${pdfRedacted.headers.get('content-disposition')} ${pdfRedacted.headers.get('cache-control')}`);
writeFileSync(`${process.env.TEMP ?? '.'}/smoke-redacted.pdf`, pdfRedacted.buffer);
await emp.ok('POST', `/employer/bookmarks/${candidateId}`);
const bookmarks = await emp.ok('GET', '/employer/bookmarks');
check(bookmarks.length === 1 && !bookmarks[0].unavailable, 'закладка добавлена');
const bank = await emp.ok('GET', '/employer/candidates?specialization=BACKEND&grades=SENIOR&skills=postgresql&skillSource=VERIFIED');
check(bank.items.some((i) => i.candidateId === candidateId), `банк: найдено ${bank.total}`);

const inviteBody = {
  candidateId, needId: need.id, title: 'Senior backend, платежи', description: 'Команда 6 человек, релизы раз в неделю, удалённо.',
  salaryFrom: 280000, salaryTo: 330000, salaryType: 'GROSS', workFormat: 'REMOTE', employerContactType: 'EMAIL', employerContact: 'hr@example.com',
};
const inv = await emp.ok('POST', '/employer/invitations', inviteBody, { 'Idempotency-Key': `inv-${stamp}` });
const invAgain = await emp.raw('POST', '/employer/invitations', inviteBody, { 'Idempotency-Key': `inv-${stamp}` });
check(invAgain.status === 200 && invAgain.json.id === inv.id, 'повтор с тем же Idempotency-Key возвращает то же приглашение');
const dup = await emp.raw('POST', '/employer/invitations', inviteBody);
check(dup.status === 409 && dup.json.code === 'ACTIVE_INVITATION_EXISTS', 'второе активное приглашение → 409');

const candList = await cand.ok('GET', '/candidate/invitations');
check(candList.items[0].status === 'SENT', `кандидат видит приглашение со статусом SENT и зарплатой ${candList.items[0].salaryFrom}–${candList.items[0].salaryTo}`);
const candInv = await cand.ok('GET', `/candidate/invitations/${inv.id}`);
check(candInv.status === 'SENT', 'чтение не меняет статус на VIEWED');
check(candInv.disclosure.channels.length === 2, `будет раскрыто: ${candInv.disclosure.channels.map((c) => c.channel).join(', ')}`);
const viewed = await cand.ok('POST', `/candidate/invitations/${inv.id}/view`);
check(viewed.status === 'VIEWED', 'явная отметка VIEWED');
const accepted = await cand.ok('POST', `/candidate/invitations/${inv.id}/accept`, { confirmDisclosure: true });
check(accepted.status === 'ACCEPTED' && accepted.contactAccess.active, 'принято, доступ выдан');
const acceptAgain = await cand.ok('POST', `/candidate/invitations/${inv.id}/accept`, { confirmDisclosure: true });
check(acceptAgain.status === 'ACCEPTED', 'повторное принятие идемпотентно');
const withdrawAfter = await emp.raw('POST', `/employer/invitations/${inv.id}/withdraw`);
check(withdrawAfter.status === 409, `отзыв после принятия → ${withdrawAfter.status}`);
const granted = await emp.ok('GET', `/employer/candidates/${candidateId}`);
check(granted.profile.mode === 'EMPLOYER_GRANTED', `компания видит контакты: ${granted.profile.contacts.map((c) => `${c.channel}=${c.value}`).join(', ')}`);
check(!granted.profile.contacts.some((c) => c.channel === 'PHONE'), 'телефон не раскрыт (не выбран кандидатом)');

const emp2 = new Actor('employer2');
await registerVerified(emp2, `smoke.emp2.${stamp}@example.com`, 'EMPLOYER');
await emp2.ok('PUT', '/employer/company', { name: 'Другая компания', contactChannelType: 'EMAIL', contactValue: 'jobs@example.org' });
const other = await emp2.ok('GET', `/employer/candidates/${candidateId}`);
check(other.profile.mode === 'EMPLOYER_REDACTED' && !JSON.stringify(other).includes('ivanova'), 'другая компания контактов не видит');
const otherInv = await emp2.raw('GET', `/employer/invitations/${inv.id}`);
check(otherInv.status === 404, 'чужое приглашение недоступно (404)');
const otherNeed = await emp2.raw('GET', `/employer/needs/${need.id}`);
check(otherNeed.status === 404, 'чужая потребность недоступна (404)');

await cand.ok('DELETE', `/candidate/contact-access/${granted.profile.grant ? (await emp.ok('GET', '/employer/company')).company.id : ''}`);
const afterRevoke = await emp.ok('GET', `/employer/candidates/${candidateId}`);
check(afterRevoke.profile.mode === 'EMPLOYER_REDACTED', 'после отзыва доступа контакты скрыты');
const reAccept = await cand.ok('POST', `/candidate/invitations/${inv.id}/accept`, { confirmDisclosure: true });
check(reAccept.contactAccess && !reAccept.contactAccess.active, 'повторный accept старого приглашения не восстанавливает доступ');

await cand.ok('PATCH', '/candidate/profile', { isDiscoverable: false });
const oldSel = await emp.ok('GET', `/employer/selections/${selection.id}`);
const mineOld = oldSel.items.find((i) => i.rank === mine?.rank);
check(mineOld?.unavailable === true && !JSON.stringify(oldSel).includes(candidateId), 'скрытый кандидат недоступен в старой подборке без деталей');
const bmAfter = await emp.ok('GET', '/employer/bookmarks');
check(bmAfter[0].unavailable === true && !bmAfter[0].candidate, 'закладка показывает кандидата недоступным');
const cardHidden = await emp.raw('GET', `/employer/candidates/${candidateId}`);
check(cardHidden.status === 404, 'карточка скрытого кандидата без доступа → 404');
const pdfOwner = await cand.raw('GET', '/candidate/profile/pdf');
check(pdfOwner.status === 200, `PDF владельца: ${pdfOwner.headers.get('content-disposition')}`);
writeFileSync(`${process.env.TEMP ?? '.'}/smoke-owner.pdf`, pdfOwner.buffer);
console.log('\nготово');
