import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LearningAnalyticsStore } from '../learning-analytics-store.mjs';

test('student account lifecycle, isolation, answer-key filtering, and persistence', async t => {
  const dataRoot = await mkdtemp(join(tmpdir(), 'online-lab-students-'));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));

  const firstRun = new LearningAnalyticsStore(process.cwd(), dataRoot);
  await firstRun.ready;
  assert.equal(await firstRun.ensureAdmin('testteacher', 'TestAdminPass2026!'), true);
  const admin = await firstRun.authenticate('testteacher', 'TestAdminPass2026!');
  assert.equal(admin.role, 'admin');

  const student = await firstRun.createStudent({
    displayName: 'Тестовая Анна Сергеевна',
    groupId: 'BIO-10A',
    username: 'anna_test01',
    password: 'TempStudent2026!'
  });
  assert.equal(student.mustChangePassword, true);
  assert.equal('passwordHash' in student, false);
  assert.equal((await firstRun.authenticate('anna_test01', 'TempStudent2026!')).mustChangePassword, true);
  await assert.rejects(firstRun.changeOwnPassword(student.id, 'TempStudent2026!'), /отличаться/);
  const changed = await firstRun.changeOwnPassword(student.id, 'NewStudentPassword2026!');
  assert.equal(changed.mustChangePassword, false);
  assert.equal((await firstRun.authenticate('anna_test01', 'TempStudent2026!')), null);
  assert.equal((await firstRun.authenticate('anna_test01', 'NewStudentPassword2026!')).id, student.id);

  const second = await firstRun.createStudent({ displayName: 'Тестовый Иван', groupId: 'BIO-10B', username: 'ivan_test01', password: 'TempStudent2026!' });
  await firstRun.saveCurriculum(admin, {
    labs: [{
      id: 'lab-test', title: 'Тестовая лабораторная',
      equipment: [{ id: 'scope', name: 'Микроскоп', correct: true }, { id: 'spare', name: 'Лишний предмет', correct: false }],
      steps: [{ id: 'one', text: 'Первый этап', correct: true, order: 1 }],
      safetyCriteria: [{ id: 'coat', text: 'Халат' }],
      microscopeCriteria: [{ id: 'shape', label: 'Форма', answers: ['кокк'] }]
    }],
    quizzes: [{ id: 'quiz-test', labId: 'lab-test', title: 'Проверка', questions: [{ id: 'question-1', prompt: 'Проверочный вопрос?', options: ['Нет', 'Да'], correct: 1 }] }],
    assistantConfig: { enabled: true, instructions: 'teacher-only-guidance', faqs: [{ question: 'private?', answer: 'private' }] }
  });

  const studentView = firstRun.getCurriculum(student);
  const studentJson = JSON.stringify(studentView);
  assert.equal(studentJson.includes('teacher-only-guidance'), false);
  assert.equal(studentJson.includes('"correct"'), false);
  assert.equal(studentJson.includes('"answers"'), false);
  const quizGrade = firstRun.gradeQuiz(student, { quizId: 'quiz-test', answers: { 'question-1': 1 } });
  assert.equal(quizGrade.review[0].isCorrect, true);
  assert.equal('correct' in quizGrade.review[0], false);
  assert.equal('answers' in quizGrade.review[0], false);
  const labGrade = firstRun.gradeLab(student, {
    labId: 'lab-test',
    attempt: { equipment: ['scope'], stepOrder: ['one'], safety: { coat: true }, microscopeAnswers: { shape: 'кокк' } },
    quizResponses: { 'quiz-test': { 'question-1': 1 } }
  });
  assert.equal(labGrade.serverVerified, true);
  assert.equal(labGrade.score, 100);
  assert.equal(labGrade.microscopeReview[0].correct, true);
  assert.equal(JSON.stringify(labGrade).includes('"answers"'), false);

  const inputEvent = {
    eventId: 'evt_student_0001', type: 'score_calculated', labId: 'lab-test',
    labTitle: 'Тестовая лабораторная', sessionId: 'session_student_01', stage: 'result',
    data: { score: labGrade.score, scoreTotal: 100, rubricScores: Object.fromEntries(Object.entries(labGrade.rubricScores).map(([key, value]) => [key, value.points])), rubricMax: Object.fromEntries(Object.entries(labGrade.rubricScores).map(([key, value]) => [key, value.max])) }
  };
  assert.equal((await firstRun.appendEvent(student, inputEvent)).accepted, true);
  assert.equal((await firstRun.appendEvent(second, { ...inputEvent, eventId: 'evt_student_0002' })).accepted, true);
  assert.equal(firstRun.queryAnalytics(student).summary.sampleSize, 1);
  assert.equal(firstRun.queryAnalytics(student).summary.latestScores[0].score, 100);

  const usersFile = join(dataRoot, 'learning-analytics', 'users.json');
  const persistedUsers = JSON.parse(await readFile(usersFile, 'utf8'));
  const persistedStudent = persistedUsers.find(item => item.id === student.id);
  assert.equal(persistedStudent.passwordHash.includes('NewStudentPassword2026!'), false);
  assert.match(persistedStudent.passwordHash, /^[a-f0-9]{128}$/);
  assert.match(persistedStudent.passwordSalt, /^[a-f0-9]{32}$/);

  const afterRestart = new LearningAnalyticsStore(process.cwd(), dataRoot);
  await afterRestart.ready;
  const loggedInAgain = await afterRestart.authenticate('anna_test01', 'NewStudentPassword2026!');
  assert.equal(loggedInAgain.id, student.id);
  assert.equal(loggedInAgain.mustChangePassword, false);
  assert.equal(afterRestart.queryAnalytics(loggedInAgain).summary.latestScores[0].score, 100);
  assert.equal(afterRestart.queryAnalytics(loggedInAgain).summary.sampleSize, 1);
  assert.equal(afterRestart.queryAnalytics(admin).summary.sampleSize, 2);

  await afterRestart.updateStudent(second.id, { active: false });
  assert.equal(await afterRestart.authenticate('ivan_test01', 'TempStudent2026!'), null);
  await afterRestart.updateStudent(second.id, { active: true, password: 'ResetStudentPassword2026!' });
  assert.equal((await afterRestart.authenticate('ivan_test01', 'ResetStudentPassword2026!')).mustChangePassword, true);
  await afterRestart.deleteStudent(second.id);
  assert.equal(afterRestart.queryAnalytics(admin).summary.sampleSize, 1);

  const serverSource = await readFile(new URL('../server.mjs', import.meta.url), 'utf8');
  assert.match(serverSource, /async function requireUser\(request, response, adminOnly = false\)[\s\S]*?if \(user\.mustChangePassword\)[\s\S]*?if \(adminOnly && user\.role !== 'admin'\)/);
  for (const path of ['/api/admin/students', '/api/admin/students/import', '/api/learning/admin']) {
    const routeStart = serverSource.indexOf("url.pathname === '" + path + "'");
    assert.notEqual(routeStart, -1, 'missing protected route: ' + path);
    const route = serverSource.slice(routeStart, routeStart + 400);
    assert.match(route, /requireUser\(request, response, true\)/, 'route must require administrator: ' + path);
  }

  const importResult = await afterRestart.createStudentsBatch([
    { displayName: 'CSV Student One', groupId: 'BIO-11', username: 'csv_test01', password: 'ImportPassword2026!' },
    { displayName: 'Duplicate Login', groupId: 'BIO-11', username: 'csv_test01', password: 'ImportPassword2026!' }
  ]);
  assert.equal(importResult.created.length, 1);
  assert.equal(importResult.rejected.length, 1);
});
