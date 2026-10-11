// Local test-only auth fixture. Never deployed or imported by the application.
import { createServer } from 'node:http';
createServer((req, res) => {
  if (req.url !== '/api/v1/auth/me') { res.writeHead(404).end(); return; }
  const employer = (req.headers.cookie ?? '').includes('fsp_session=employer');
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    user: { id: 'test-user', email: 'ui@example.test', role: employer ? 'EMPLOYER' : 'CANDIDATE', emailVerified: true, isDemo: false },
    candidate: employer ? null : { profileId: 'profile', alias: 'Кандидат', activeSpecialization: 'FRONTEND', declaredGrade: 'MIDDLE', confirmedGrade: null, onboarding: [], nextStep: null, discoverable: false, discoverabilityIssues: [], newInvitations: 2, pendingDirectTasks: 0 },
    employer: employer ? { companyId: 'company', companyName: 'Компания', companyComplete: true, activeNeeds: 3, newApplications: 0, pendingTaskReviews: 0 } : null,
  }));
}).listen(3101, '127.0.0.1');
