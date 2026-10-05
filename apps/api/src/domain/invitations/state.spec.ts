import { canTransition, compareInvitationEvents, isActiveInvitation, type InvitationStatusCode } from './state';

const ALL: InvitationStatusCode[] = ['SENT', 'VIEWED', 'ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'];

describe('статусы приглашений', () => {
  it('допустимые переходы совпадают со спецификацией', () => {
    const allowed: Array<[InvitationStatusCode, InvitationStatusCode]> = [
      ['SENT', 'VIEWED'],
      ['SENT', 'ACCEPTED'],
      ['SENT', 'DECLINED'],
      ['SENT', 'WITHDRAWN'],
      ['SENT', 'EXPIRED'],
      ['VIEWED', 'ACCEPTED'],
      ['VIEWED', 'DECLINED'],
      ['VIEWED', 'WITHDRAWN'],
      ['VIEWED', 'EXPIRED'],
    ];
    for (const from of ALL) {
      for (const to of ALL) {
        expect(canTransition(from, to)).toBe(allowed.some(([a, b]) => a === from && b === to));
      }
    }
  });

  it('финальные статусы не переходят друг в друга и не возвращаются к SENT/VIEWED', () => {
    for (const final of ['ACCEPTED', 'DECLINED', 'WITHDRAWN', 'EXPIRED'] as const) {
      for (const to of ALL) expect(canTransition(final, to)).toBe(false);
    }
  });

  it('VIEWED не возвращается в SENT', () => {
    expect(canTransition('VIEWED', 'SENT')).toBe(false);
  });

  it('активные — только SENT и VIEWED', () => {
    expect(ALL.filter(isActiveInvitation)).toEqual(['SENT', 'VIEWED']);
  });

  it('история упорядочена по времени, а при равных метках — по ходу жизненного цикла', () => {
    const at = (iso: string, toStatus: InvitationStatusCode) => ({ occurredAt: new Date(iso), toStatus });
    const same = '2026-10-05T09:00:00.000Z';
    const shuffled = [at(same, 'DECLINED'), at(same, 'SENT'), at(same, 'VIEWED')];
    expect(shuffled.sort(compareInvitationEvents).map((e) => e.toStatus)).toEqual(['SENT', 'VIEWED', 'DECLINED']);

    const mixed = [at('2026-10-06T09:00:00.000Z', 'VIEWED'), at('2026-10-05T09:00:00.000Z', 'SENT'), at('2026-10-20T09:00:00.000Z', 'EXPIRED')];
    expect(mixed.sort(compareInvitationEvents).map((e) => e.toStatus)).toEqual(['SENT', 'VIEWED', 'EXPIRED']);
  });
});
