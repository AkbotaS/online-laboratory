import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const scrypt = promisify(scryptCallback);
const EVENT_TYPES = new Set([
  'lab_started', 'lab_resumed', 'lab_completed', 'equipment_selected', 'equipment_saved',
  'step_selected', 'step_reordered', 'safety_checked', 'quiz_started', 'answer_submitted',
  'error_detected', 'hint_shown', 'error_resolved', 'stage_started', 'stage_completed',
  'microscope_analysis', 'microscope_control', 'score_calculated', 'result_changed'
]);
const EVENT_FIELDS = new Set([
  'itemId', 'itemName', 'selected', 'correct', 'order', 'selectedCount', 'correctCount', 'incorrectCount',
  'errorCategory', 'errorType', 'issueId', 'hintLevel', 'source', 'resolvedAfterHint', 'durationMs', 'stage',
  'objective', 'light', 'focus', 'photoId', 'photoName', 'totalCriteria', 'correctCriteria', 'questionId',
  'questionType', 'answerCorrect', 'attemptNo', 'totalHints', 'independence', 'sessionDurationMs', 'quizId',
  'quizTitle', 'errorCount', 'score', 'scoreTotal', 'rubricScores', 'rubricMax', 'completionState', 'itemsSelected',
  'stepsInCorrectOrder', 'labVersion'
]);
const MAX_EVENTS_IN_MEMORY = 250_000;
const USERNAME_RE = /^[a-zA-Z0-9._-]{3,40}$/;
const GROUP_RE = /^[\p{L}\p{N} ._-]{1,60}$/u;
const DEFAULT_RUBRIC = { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 };
const DEFAULT_SAFETY = [{ id: 'safety-coat', text: 'Халат пен қолғап кию' }, { id: 'safety-reagents', text: 'Реактивтерді нұсқаулыққа сай пайдалану' }, { id: 'safety-workplace', text: 'Жұмыс орнын таза ұстау' }];
const DEFAULT_MICROSCOPE = [{ id: 'micro-form', label: 'Пішіні', answers: ['кокк', 'таяқша', 'иілген'] }, { id: 'micro-arrangement', label: 'Орналасуы', answers: ['жеке', 'жұп', 'тізбек', 'шоғыр'] }, { id: 'micro-staining', label: 'Боялуы', answers: ['көк', 'күлгін', 'қызғылт'] }];
const DEFAULT_QUIZ_KEY = { 'q-magnification': 1, 'q-immersion': 0, 'q-focus': 1, 'q-focus-open': ['фокустау', 'фокусировка', 'фокусқа келтіру'], 'q-immersion-open': ['иммерсиялық май', 'иммерсия майы', 'иммерсионное масло'] };

function clean(value, limit = 180) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, limit); }
function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, groupId: user.groupId || '', active: user.active !== false, mustChangePassword: Boolean(user.mustChangePassword), createdAt: user.createdAt };
}
function iso(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
function clampNumber(value, min = 0, max = 100) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.max(min, Math.min(max, num)) : 0;
}
function cleanData(data) {
  const out = {};
  if (!data || typeof data !== 'object' || Array.isArray(data)) return out;
  for (const [key, value] of Object.entries(data)) {
    if (!EVENT_FIELDS.has(key)) continue;
    if ((key === 'rubricScores' || key === 'rubricMax') && value && typeof value === 'object') {
      out[key] = {};
      for (const [rubric, points] of Object.entries(value).slice(0, 8)) out[key][clean(rubric, 50)] = clampNumber(points, 0, 100);
    } else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number') out[key] = clampNumber(value, 0, 1_000_000);
    else if (Array.isArray(value)) out[key] = value.slice(0, 40).map(item => clean(item, 100));
    else if (value !== null && value !== undefined) out[key] = clean(value, 180);
  }
  return out;
}
function mean(values) { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null; }
function round(value, digits = 1) { return value === null ? null : Number(value.toFixed(digits)); }
function weekKey(isoDate) {
  const date = new Date(isoDate);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
function normalizeAnswer(value) { return String(value ?? '').normalize('NFC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim(); }
function matchesAnswer(value, choices = []) { const selected = normalizeAnswer(value); return Boolean(selected) && choices.some(answer => { const expected = normalizeAnswer(answer); return expected && (selected === expected || selected.includes(expected)); }); }

export class LearningAnalyticsStore {
  constructor(projectRoot, dataDirectory = '') {
    this.directory = dataDirectory ? join(dataDirectory, 'learning-analytics') : join(projectRoot, 'data', 'learning-analytics');
    this.usersFile = join(this.directory, 'users.json');
    this.settingsFile = join(this.directory, 'settings.json');
    this.curriculumFile = join(this.directory, 'curriculum.json');
    this.eventsFile = join(this.directory, 'events.ndjson');
    this.measuresFile = join(this.directory, 'measures.ndjson');
    this.users = [];
    this.events = [];
    this.measures = [];
    this.settings = { rubricWeights: { ...DEFAULT_RUBRIC } };
    this.curriculum = { revision: 0, updatedAt: '', labs: [], quizzes: [], assistantConfig: null };
    this.eventIds = new Set();
    this.writeQueue = Promise.resolve();
    this.ready = this.initialize();
  }

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    try {
      const loaded = JSON.parse(await readFile(this.usersFile, 'utf8'));
      if (Array.isArray(loaded)) this.users = loaded;
    } catch { this.users = []; }
    try {
      const loaded = JSON.parse(await readFile(this.settingsFile, 'utf8'));
      const weights = loaded?.rubricWeights;
      if (weights && Object.keys(DEFAULT_RUBRIC).every(key => Number.isInteger(Number(weights[key])) && Number(weights[key]) >= 0 && Number(weights[key]) <= 100) && Object.keys(DEFAULT_RUBRIC).reduce((sum, key) => sum + Number(weights[key]), 0) === 100) this.settings = { rubricWeights: Object.fromEntries(Object.keys(DEFAULT_RUBRIC).map(key => [key, Number(weights[key])])) };
    } catch { /* first run uses the documented 100-point rubric */ }
    try {
      const loaded = JSON.parse(await readFile(this.curriculumFile, 'utf8'));
      if (Array.isArray(loaded?.labs) && Array.isArray(loaded?.quizzes)) this.curriculum = { revision: Number(loaded.revision) || 1, updatedAt: loaded.updatedAt || '', labs: loaded.labs, quizzes: loaded.quizzes, assistantConfig: loaded.assistantConfig || null };
    } catch { /* first run uses the browser's local project data until an admin syncs it */ }
    for (const [file, target] of [[this.eventsFile, this.events], [this.measuresFile, this.measures]]) {
      try {
        const contents = await readFile(file, 'utf8');
        for (const line of contents.split(/\r?\n/)) {
          if (!line) continue;
          try {
            const event = JSON.parse(line);
            if (event?.id && event?.studentId && event?.type) {
              this.eventIds.add(event.id);
              if (target.length < MAX_EVENTS_IN_MEMORY) target.push(event);
            }
          } catch { /* keep valid historical rows and ignore an incomplete final line */ }
        }
      } catch { /* first run */ }
    }
  }

  async ensureAdmin(username, password) {
    await this.ready;
    const safeUsername = clean(username, 40);
    if (!USERNAME_RE.test(safeUsername) || String(password || '').length < 12) return false;
    return this.withUserLock(async () => {
      const old = this.users.find(user => user.role === 'admin' && user.username === safeUsername);
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(String(password), salt, 64)).toString('hex');
      if (old) { old.passwordSalt = salt; old.passwordHash = hash; old.active = true; }
      else this.users.push({ id: randomUUID(), username: safeUsername, displayName: 'Преподаватель', role: 'admin', groupId: '', active: true, passwordSalt: salt, passwordHash: hash, createdAt: new Date().toISOString() });
      await this.persistUsers();
      return true;
    });
  }

  async authenticate(username, password) {
    await this.ready;
    const safeUsername = clean(username, 40);
    const user = this.users.find(item => item.username.toLocaleLowerCase() === safeUsername.toLocaleLowerCase() && item.active !== false);
    if (!user) { await scrypt(String(password || '').slice(0, 200), '00000000000000000000000000000000', 64); return null; }
    const actual = await scrypt(String(password || '').slice(0, 200), user.passwordSalt, 64);
    const expected = Buffer.from(user.passwordHash, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    return publicUser(user);
  }

  getUser(id) {
    const user = this.users.find(item => item.id === id && item.active !== false);
    return user ? publicUser(user) : null;
  }

  hasAdmin() {
    return this.users.some(user => user.role === 'admin' && user.active !== false);
  }

  getSettings() { return JSON.parse(JSON.stringify(this.settings)); }

  getCurriculum(user) {
    const curriculum = JSON.parse(JSON.stringify(this.curriculum));
    if (user?.role === 'admin') return curriculum;
    curriculum.labs = curriculum.labs.map(lab => ({
      ...lab,
      _answerKeyHidden: true,
      equipment: (lab.equipment || []).map(({ correct, ...item }) => item),
      steps: (lab.steps || []).map(({ correct, order, ...item }) => item),
      microscopeCriteria: (lab.microscopeCriteria || []).map(({ answers, ...item }) => item),
      aiGuidance: '', errorVariants: [], scoreRules: undefined
    }));
    curriculum.quizzes = curriculum.quizzes.map(quiz => ({
      ...quiz,
      _answerKeyHidden: true,
      questions: (quiz.questions || []).map(({ correct, answers, ...question }) => question)
    }));
    const settings = curriculum.assistantConfig || {};
    curriculum.assistantConfig = { enabled: settings.enabled !== false, name: settings.name || 'ЖИ-көмекші', greeting: settings.greeting || '', fallback: settings.fallback || '', faqs: [] };
    return curriculum;
  }
  getCurriculumMeta() { return { revision: this.curriculum.revision, updatedAt: this.curriculum.updatedAt }; }

  gradeQuiz(user, input) {
    if (user.role !== 'student') throw Object.assign(new Error('Тапсырманы тек студент аккаунты тапсыра алады.'), { status: 403 });
    const quiz = this.curriculum.quizzes.find(item => item.id === clean(input.quizId, 100));
    if (!quiz) throw Object.assign(new Error('Тапсырма табылмады.'), { status: 404 });
    const responses = input.answers && typeof input.answers === 'object' ? input.answers : {};
    const review = (quiz.questions || []).map(question => {
      const selected = responses[question.id];
      const isText = question.type === 'text';
      if (selected === undefined || selected === null || String(selected).trim() === '') throw Object.assign(new Error('Барлық сұраққа жауап беріңіз.'), { status: 400 });
      const isCorrect = isText ? matchesAnswer(selected, question.answers || []) : Number(selected) === Number(question.correct);
      return { type: isText ? 'text' : 'choice', prompt: clean(question.prompt, 600), options: isText ? [] : (question.options || []).map(value => clean(value, 240)), selected: isText ? String(selected || '').slice(0, 1200) : Number.isFinite(Number(selected)) ? Number(selected) : -1, isCorrect: Boolean(isCorrect) };
    });
    if (!review.length) throw Object.assign(new Error('Тапсырмада сұрақ жоқ.'), { status: 400 });
    return { quizId: quiz.id, score: review.filter(item => item.isCorrect).length, total: review.length, review, submittedAt: new Date().toISOString() };
  }

  gradeLab(user, input) {
    if (user.role !== 'student') throw Object.assign(new Error('Зертханалық жұмысты тек студент аккаунты тапсыра алады.'), { status: 403 });
    const lab = this.curriculum.labs.find(item => item.id === clean(input.labId, 100));
    if (!lab) throw Object.assign(new Error('Зертханалық жұмыс табылмады.'), { status: 404 });
    const attempt = input.attempt && typeof input.attempt === 'object' ? input.attempt : {};
    const equipment = Array.isArray(lab.equipment) ? lab.equipment : [], steps = Array.isArray(lab.steps) ? lab.steps : [];
    const selectedEquipment = new Set(Array.isArray(attempt.equipment) ? attempt.equipment.map(value => clean(value, 100)) : []);
    const correctEquipment = equipment.filter(item => item.correct);
    const equipmentCorrect = equipment.filter(item => item.correct && selectedEquipment.has(item.id)).length;
    const missingEquipmentCount = correctEquipment.filter(item => !selectedEquipment.has(item.id)).length;
    const extraEquipmentCount = equipment.filter(item => !item.correct && selectedEquipment.has(item.id)).length;
    const correctSteps = steps.filter(item => item.correct).sort((a, b) => Number(a.order) - Number(b.order));
    const selectedStepIds = Array.isArray(attempt.stepOrder) ? attempt.stepOrder.map(value => clean(value, 100)).filter(id => steps.some(item => item.id === id)) : [];
    const selectedStepItems = selectedStepIds.map(id => steps.find(item => item.id === id)).filter(Boolean);
    const selectedCorrect = selectedStepItems.filter(item => item.correct);
    const expectedSelected = correctSteps.filter(item => selectedStepIds.includes(item.id)).map(item => item.id);
    const selectedCorrectIds = selectedCorrect.map(item => item.id);
    const stepsInPlace = selectedCorrectIds.reduce((count, id, index) => count + (id === expectedSelected[index] ? 1 : 0), 0);
    const missingStepsCount = correctSteps.filter(item => !selectedStepIds.includes(item.id)).length;
    const extraStepsCount = selectedStepItems.filter(item => !item.correct).length;
    const wrongOrder = selectedCorrectIds.some((id, index) => id !== expectedSelected[index]);
    const safety = Array.isArray(lab.safetyCriteria) && lab.safetyCriteria.length ? lab.safetyCriteria : DEFAULT_SAFETY;
    const safetyDone = new Set(Object.entries(attempt.safety || {}).filter(([, value]) => Boolean(value)).map(([id]) => id));
    const safetyCorrect = safety.filter(item => safetyDone.has(item.id)).length;
    const microscope = Array.isArray(lab.microscopeCriteria) && lab.microscopeCriteria.length ? lab.microscopeCriteria : DEFAULT_MICROSCOPE;
    const answers = attempt.microscopeAnswers && typeof attempt.microscopeAnswers === 'object' ? attempt.microscopeAnswers : {};
    const microscopeReview = microscope.map(item => ({ criterionId: item.id, label: clean(item.label, 120), correct: matchesAnswer(answers[item.id], item.answers || []) }));
    const quizResponses = input.quizResponses && typeof input.quizResponses === 'object' ? input.quizResponses : {};
    const linked = this.curriculum.quizzes.filter(quiz => quiz.labId === lab.id);
    let questionCount = 0, questionCorrect = 0;
    for (const quiz of linked) for (const question of quiz.questions || []) {
      questionCount++;
      const response = quizResponses[quiz.id]?.[question.id];
      if (question.type === 'text' ? matchesAnswer(response, question.answers || []) : Number(response) === Number(question.correct)) questionCorrect++;
    }
    const stats = attempt.mentorStats && typeof attempt.mentorStats === 'object' ? attempt.mentorStats : {};
    const hintByCategory = stats.hintsByCategory && typeof stats.hintsByCategory === 'object' ? stats.hintsByCategory : {};
    const repeatByCategory = stats.repeatMistakesByCategory && typeof stats.repeatMistakesByCategory === 'object' ? stats.repeatMistakesByCategory : {};
    const weights = this.settings.rubricWeights;
    const errorCounts = { equipment: missingEquipmentCount + extraEquipmentCount, steps: missingStepsCount + extraStepsCount + (wrongOrder ? 1 : 0), safety: safety.length - safetyCorrect, microscope: microscopeReview.filter(item => !item.correct).length, questions: Math.max(0, questionCount - questionCorrect) };
    const base = {
      equipment: correctEquipment.length ? weights.equipment * equipmentCorrect / correctEquipment.length : 0,
      steps: correctSteps.length ? weights.steps * stepsInPlace / correctSteps.length : 0,
      safety: safety.length ? weights.safety * safetyCorrect / safety.length : 0,
      microscope: microscope.length ? weights.microscope * microscopeReview.filter(item => item.correct).length / microscope.length : 0,
      questions: questionCount ? weights.questions * questionCorrect / questionCount : 0
    };
    const hintPenalty = Math.max(0, Math.min(10, Number(lab.scoreRules?.hintPenalty ?? 0.5)));
    const errorPenalty = Math.max(0, Math.min(10, Number(lab.scoreRules?.errorPenalty ?? 1)));
    const rubricScores = {};
    for (const category of Object.keys(weights)) {
      const errors = errorCounts[category], hints = Math.max(0, Math.min(50, Number(hintByCategory[category]) || 0)), repeats = Math.max(0, Math.min(50, Number(repeatByCategory[category]) || 0));
      rubricScores[category] = { points: Math.max(0, Math.min(weights[category], base[category] - errors * errorPenalty - hints * hintPenalty - repeats * errorPenalty)), max: weights[category], errors, hints };
    }
    const score = Math.max(0, Math.min(100, Math.round(Object.values(rubricScores).reduce((sum, value) => sum + value.points, 0))));
    const hiddenCounts = Object.fromEntries(Object.entries(errorCounts).map(([category, count]) => [category, count]));
    return {
      serverVerified: true, score, total: 100, rubricScores, errorCounts: hiddenCounts,
      totalErrors: Object.values(errorCounts).reduce((sum, value) => sum + value, 0) + Math.max(0, Number(stats.mistakes) || 0),
      hintsUsed: Math.max(0, Math.min(100, Number(stats.hints) || 0)), independence: Math.max(0, Math.round(100 * (1 - Math.min(5, Number(stats.hints) || 0) / 5))),
      equipmentCorrect, equipmentTotal: correctEquipment.length, extraEquipmentCount, missingEquipmentCount,
      stepsInPlace, stepsTotal: correctSteps.length, extraStepsCount, missingStepsCount, wrongOrder,
      safetyTotal: safety.length, safetyCorrect, microscopeReview,
      quizLinked: linked.length, questionCorrect, questionTotal: questionCount, checkedAt: new Date().toISOString()
    };
  }

  async saveCurriculum(user, input) {
    await this.ready;
    if (user.role !== 'admin') throw Object.assign(new Error('Әкімші құқығы қажет.'), { status: 403 });
    if (!Array.isArray(input?.labs) || !Array.isArray(input?.quizzes) || input.labs.length > 100 || input.quizzes.length > 100) throw Object.assign(new Error('Зертханалық жұмыстар мен тапсырмалар тізімін тексеріңіз.'), { status: 400 });
    return this.withEventLock(async () => {
      let quizzes = input.quizzes;
      if (this.curriculum.revision === 0) quizzes = quizzes.map(quiz => quiz.id === 'quiz-microscope-basics' ? { ...quiz, questions: (quiz.questions || []).map(question => {
        const key = DEFAULT_QUIZ_KEY[question.id];
        if (key === undefined) return question;
        return Array.isArray(key) ? { ...question, type: 'text', answers: question.answers?.length ? question.answers : key } : { ...question, correct: question.correct ?? key };
      }) } : quiz);
      const next = { revision: this.curriculum.revision + 1, updatedAt: new Date().toISOString(), labs: input.labs, quizzes, assistantConfig: input.assistantConfig && typeof input.assistantConfig === 'object' ? input.assistantConfig : null };
      if (Buffer.byteLength(JSON.stringify(next), 'utf8') > 24 * 1024 * 1024) throw Object.assign(new Error('Зертханалық жұмыс файлдарының жалпы көлемі 24 МБ-тан аспауы керек.'), { status: 413 });
      const temp = this.curriculumFile + '.tmp';
      await writeFile(temp, JSON.stringify(next), { encoding: 'utf8', mode: 0o600 });
      await rename(temp, this.curriculumFile);
      this.curriculum = next;
      return { revision: next.revision, updatedAt: next.updatedAt };
    });
  }

  async setRubricWeights(user, input) {
    await this.ready;
    if (user.role !== 'admin') throw Object.assign(new Error('Әкімші құқығы қажет.'), { status: 403 });
    const values = input?.rubricWeights;
    if (!values || !Object.keys(DEFAULT_RUBRIC).every(key => Number.isInteger(Number(values[key])) && Number(values[key]) >= 0 && Number(values[key]) <= 100)) throw Object.assign(new Error('Әр рубрика ұпайын 0–100 аралығында бүтін санмен енгізіңіз.'), { status: 400 });
    const normalized = Object.fromEntries(Object.keys(DEFAULT_RUBRIC).map(key => [key, Number(values[key])]));
    if (Object.values(normalized).reduce((sum, value) => sum + value, 0) !== 100) throw Object.assign(new Error('Рубрика салмақтарының қосындысы 100 болуы керек.'), { status: 400 });
    this.settings = { rubricWeights: normalized };
    const temp = this.settingsFile + '.tmp';
    await writeFile(temp, JSON.stringify(this.settings, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.settingsFile);
    return this.getSettings();
  }

  async createStudent(input) {
    await this.ready;
    return this.withUserLock(async () => {
      const username = clean(input.username, 40);
      const displayName = clean(input.displayName, 120);
      const groupId = clean(input.groupId, 60);
      const password = String(input.password || '');
      if (!USERNAME_RE.test(username)) throw Object.assign(new Error('Логин: латинские буквы, цифры, точка, дефис или подчёркивание; 3–40 символов.'), { status: 400 });
      if (!displayName) throw Object.assign(new Error('Укажите имя студента.'), { status: 400 });
      if (!GROUP_RE.test(groupId)) throw Object.assign(new Error('Укажите группу (1–60 символов).'), { status: 400 });
      if (password.length < 10 || password.length > 200) throw Object.assign(new Error('Временный пароль должен содержать не менее 10 символов.'), { status: 400 });
      if (this.users.some(item => item.username.toLocaleLowerCase() === username.toLocaleLowerCase())) throw Object.assign(new Error('Такой логин уже существует.'), { status: 409 });
      const salt = randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      const user = { id: randomUUID(), username, displayName, role: 'student', groupId, active: true, mustChangePassword: true, passwordSalt: salt, passwordHash: hash, createdAt: new Date().toISOString() };
      this.users.push(user);
      await this.persistUsers();
      return publicUser(user);
    });
  }

  async updateStudent(id, changes) {
    await this.ready;
    return this.withUserLock(async () => {
      const user = this.users.find(item => item.id === id && item.role === 'student');
      if (!user) throw Object.assign(new Error('Студент не найден.'), { status: 404 });
      if (changes.username !== undefined) {
        const value = clean(changes.username, 40);
        if (!USERNAME_RE.test(value)) throw Object.assign(new Error('Логин: латинские буквы, цифры, точка, дефис или подчёркивание; 3–40 символов.'), { status: 400 });
        if (this.users.some(item => item.id !== id && item.username.toLocaleLowerCase() === value.toLocaleLowerCase())) throw Object.assign(new Error('Такой логин уже существует.'), { status: 409 });
        user.username = value;
      }
      if (changes.displayName !== undefined) {
        const value = clean(changes.displayName, 120);
        if (!value) throw Object.assign(new Error('Имя не может быть пустым.'), { status: 400 });
        user.displayName = value;
      }
      if (changes.groupId !== undefined) {
        const value = clean(changes.groupId, 60);
        if (!GROUP_RE.test(value)) throw Object.assign(new Error('Укажите группу (1–60 символов).'), { status: 400 });
        user.groupId = value;
      }
      if (changes.active !== undefined) user.active = Boolean(changes.active);
      if (changes.password !== undefined) {
        const password = String(changes.password || '');
        if (password.length < 10 || password.length > 200) throw Object.assign(new Error('Пароль должен содержать не менее 10 символов.'), { status: 400 });
        user.passwordSalt = randomBytes(16).toString('hex');
        user.passwordHash = (await scrypt(password, user.passwordSalt, 64)).toString('hex');
        user.passwordChangedAt = new Date().toISOString();
        user.mustChangePassword = changes.mustChangePassword !== false;
      }
      await this.persistUsers();
      return publicUser(user);
    });
  }

  listStudents() {
    return this.users.filter(user => user.role === 'student').map(publicUser).sort((a, b) => a.groupId.localeCompare(b.groupId) || a.displayName.localeCompare(b.displayName));
  }

  async createStudentsBatch(rows) {
    await this.ready;
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 200) throw Object.assign(new Error('Импортта 1–200 студент болуы керек.'), { status: 400 });
    return this.withUserLock(async () => {
      const created = [], rejected = [], seen = new Set(this.users.map(user => user.username.toLocaleLowerCase()));
      for (let index = 0; index < rows.length; index++) {
        const input = rows[index] || {}, row = index + 1;
        const username = clean(input.username, 40), displayName = clean(input.displayName, 120), groupId = clean(input.groupId, 60), password = String(input.password || '');
        let error = '';
        if (!USERNAME_RE.test(username)) error = 'Логин: латинские буквы, цифры, точка, дефис или подчёркивание; 3–40 символов.';
        else if (!displayName) error = 'Укажите ФИО студента.';
        else if (!GROUP_RE.test(groupId)) error = 'Укажите учебную группу.';
        else if (password.length < 10 || password.length > 200) error = 'Пароль должен содержать от 10 до 200 символов.';
        else if (seen.has(username.toLocaleLowerCase())) error = 'Логин уже существует или повторяется в файле.';
        if (error) { rejected.push({ row, username, error }); continue; }
        seen.add(username.toLocaleLowerCase());
        const salt = randomBytes(16).toString('hex'), hash = (await scrypt(password, salt, 64)).toString('hex');
        const user = { id: randomUUID(), username, displayName, role: 'student', groupId, active: true, mustChangePassword: true, passwordSalt: salt, passwordHash: hash, createdAt: new Date().toISOString() };
        this.users.push(user); created.push(publicUser(user));
      }
      if (created.length) await this.persistUsers();
      return { created, rejected };
    });
  }

  async changeOwnPassword(id, password) {
    await this.ready;
    const value = String(password || '');
    if (value.length < 10 || value.length > 200) throw Object.assign(new Error('Новый пароль должен содержать от 10 до 200 символов.'), { status: 400 });
    return this.withUserLock(async () => {
      const user = this.users.find(item => item.id === id && item.role === 'student' && item.active !== false);
      if (!user) throw Object.assign(new Error('Аккаунт студента не найден.'), { status: 404 });
      const candidate = await scrypt(value, user.passwordSalt, 64), current = Buffer.from(user.passwordHash, 'hex');
      if (candidate.length === current.length && timingSafeEqual(candidate, current)) throw Object.assign(new Error('Новый пароль должен отличаться от временного.'), { status: 400 });
      user.passwordSalt = randomBytes(16).toString('hex');
      user.passwordHash = (await scrypt(value, user.passwordSalt, 64)).toString('hex');
      user.passwordChangedAt = new Date().toISOString();
      user.mustChangePassword = false;
      await this.persistUsers();
      return publicUser(user);
    });
  }

  async deleteStudent(id) {
    await this.ready;
    return this.withUserLock(async () => {
      const index = this.users.findIndex(item => item.id === id && item.role === 'student');
      if (index < 0) throw Object.assign(new Error('Студент не найден.'), { status: 404 });
      const deleted = this.users[index], nextUsers = this.users.filter((_, row) => row !== index);
      const rewriteWithoutStudent = async path => {
        let contents = '';
        try { contents = await readFile(path, 'utf8'); } catch {}
        const remaining = contents.split(/\r?\n/).filter(line => {
          if (!line) return false;
          try { return JSON.parse(line).studentId !== id; } catch { return true; }
        });
        const temp = path + '.tmp';
        await writeFile(temp, remaining.join('\n') + (remaining.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
        return { temp, path };
      };
      const replacements = await Promise.all([rewriteWithoutStudent(this.eventsFile), rewriteWithoutStudent(this.measuresFile)]);
      const usersTemp = this.usersFile + '.tmp';
      await writeFile(usersTemp, JSON.stringify(nextUsers, null, 2), { encoding: 'utf8', mode: 0o600 });
      for (const item of replacements) await rename(item.temp, item.path);
      await rename(usersTemp, this.usersFile);
      this.users = nextUsers;
      this.events = this.events.filter(event => event.studentId !== id); this.measures = this.measures.filter(event => event.studentId !== id);
      this.eventIds = new Set([...this.events, ...this.measures].map(event => event.id));
      // Preserve the de-duplication index for historical rows that are beyond the in-memory analytics cap.
      for (const [path] of [[this.eventsFile], [this.measuresFile]]) {
        try { for (const line of (await readFile(path, 'utf8')).split(/\r?\n/)) { if (!line) continue; try { const event = JSON.parse(line); if (event.id) this.eventIds.add(event.id); } catch {} } } catch {}
      }
      return publicUser(deleted);
    });
  }

  async appendEvent(user, input) {
    await this.ready;
    if (user.role !== 'student') throw Object.assign(new Error('События учебной работы принимаются только для аккаунта студента.'), { status: 403 });
    const eventId = clean(input.eventId, 80);
    const type = clean(input.type, 40);
    if (!eventId || !/^[a-zA-Z0-9_-]{12,80}$/.test(eventId)) throw Object.assign(new Error('ID события некорректен.'), { status: 400 });
    if (!EVENT_TYPES.has(type)) throw Object.assign(new Error('Тип события не поддерживается.'), { status: 400 });
    if (this.eventIds.has(eventId)) return { accepted: false, duplicate: true };
    const labId = clean(input.labId, 100);
    const sessionId = clean(input.sessionId, 80);
    if (!labId || !sessionId) throw Object.assign(new Error('Событию нужны ID лабораторной работы и сессии.'), { status: 400 });
    const occurredAt = iso(input.clientAt);
    const event = {
      id: eventId,
      type,
      studentId: user.id,
      groupId: user.groupId,
      labId,
      labTitle: clean(input.labTitle, 160),
      sessionId,
      stage: clean(input.stage, 50),
      clientAt: occurredAt,
      receivedAt: new Date().toISOString(),
      source: type === 'score_calculated' ? 'browser-rule-engine-client-reported' : 'client-event',
      data: cleanData(input.data)
    };
    const line = JSON.stringify(event) + '\n';
    return this.withEventLock(async () => {
      if (this.eventIds.has(eventId)) return { accepted: false, duplicate: true };
      const measuresEvent = type === 'score_calculated';
      await appendFile(measuresEvent ? this.measuresFile : this.eventsFile, line, { encoding: 'utf8', flag: 'a' });
      this.eventIds.add(eventId);
      const target = measuresEvent ? this.measures : this.events;
      if (target.length < MAX_EVENTS_IN_MEMORY) target.push(event);
      return { accepted: true, duplicate: false };
    });
  }

  queryAnalytics(user, filters = {}) {
    const isAdmin = user.role === 'admin';
    const studentId = isAdmin ? clean(filters.studentId, 80) : user.id;
    const groupId = isAdmin ? clean(filters.groupId, 60) : '';
    const labId = clean(filters.labId, 100);
    const from = filters.from ? new Date(filters.from + 'T00:00:00.000Z').getTime() : 0;
    const to = filters.to ? new Date(filters.to + 'T23:59:59.999Z').getTime() : Infinity;
    const requestedLimit = Number(filters.limit);
    const eventLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(250_000, Math.floor(requestedLimit))) : 5_000;
    const matches = event => {
      if (studentId && event.studentId !== studentId) return false;
      if (groupId && event.groupId !== groupId) return false;
      if (labId && event.labId !== labId) return false;
      const time = Date.parse(event.receivedAt);
      return time >= from && time <= to;
    };
    const selectedRaw = this.events.filter(matches);
    const selectedMeasures = this.measures.filter(matches);
    const mapForViewer = event => {
      const row = { ...event };
      if (isAdmin) {
        const student = this.users.find(item => item.id === event.studentId);
        row.studentName = student?.displayName || 'Аккаунт неактивен';
        row.username = student?.username || '';
      } else {
        delete row.studentId;
        delete row.groupId;
      }
      return row;
    };
    const mappedRaw = selectedRaw.map(mapForViewer).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const mappedMeasures = selectedMeasures.map(mapForViewer).sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const allMapped = [...mappedRaw, ...mappedMeasures].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
    const allKnown = [...this.events, ...this.measures];
    return {
      // Keep an internal student key while computing one-person aggregates, then
      // omit that key from every student-facing response below.
      summary: this.summarize(isAdmin ? allMapped : allMapped.map(event => ({ ...event, studentId: user.id })), isAdmin),
      events: mappedRaw.slice(-eventLimit),
      filters: { ...(isAdmin ? { studentId, groupId } : {}), labId, from: filters.from || '', to: filters.to || '' },
      options: isAdmin ? {
        students: this.listStudents(),
        groups: [...new Set([...allKnown.map(event => event.groupId), ...this.listStudents().map(student => student.groupId)].filter(Boolean))].sort(),
        labs: [...new Map(allKnown.map(event => [event.labId, { id: event.labId, title: event.labTitle }])).values()].sort((a, b) => a.title.localeCompare(b.title))
      } : { students: [], groups: [], labs: [...new Map(allMapped.map(event => [event.labId, { id: event.labId, title: event.labTitle }])).values()] }
    };
  }

  summarize(events, isAdmin = false) {
    const scores = events.filter(event => event.type === 'score_calculated' && Number.isFinite(event.data.score));
    const latest = new Map();
    for (const event of scores) {
      const key = event.studentId + ':' + event.labId;
      const old = latest.get(key);
      if (!old || Date.parse(old.receivedAt) <= Date.parse(event.receivedAt)) latest.set(key, event);
    }
    const latestScores = [...latest.values()].map(event => event.data.score);
    const bands = [
      { label: '0–59', min: 0, max: 59 }, { label: '60–69', min: 60, max: 69 },
      { label: '70–79', min: 70, max: 79 }, { label: '80–89', min: 80, max: 89 }, { label: '90–100', min: 90, max: 100 }
    ].map(band => ({ label: band.label, count: latestScores.filter(score => score >= band.min && score <= band.max).length }));
    const errors = new Map();
    for (const event of events.filter(item => item.type === 'error_detected')) {
      const key = event.data.errorCategory || event.data.errorType || 'Қате түрі белгісіз';
      errors.set(key, (errors.get(key) || 0) + Math.max(1, Number(event.data.errorCount) || 1));
    }
    const issueHints = new Set(events.filter(event => event.type === 'hint_shown' && event.data.source === 'openai').map(event => event.data.issueId).filter(Boolean));
    const aiResolved = new Set(events.filter(event => event.type === 'error_resolved' && event.data.resolvedAfterHint === true && event.data.source === 'openai').map(event => event.data.issueId).filter(Boolean));
    const bySession = new Map();
    for (const event of events) {
      if (event.type === 'hint_shown' && event.data.source === 'openai') {
        const key = event.studentId + ':' + event.sessionId;
        bySession.set(key, { ...(bySession.get(key) || {}), ai: true });
      }
      if (event.type === 'score_calculated') {
        const key = event.studentId + ':' + event.sessionId;
        bySession.set(key, { ...(bySession.get(key) || {}), score: event.data.score });
      }
    }
    const supported = [], unsupported = [];
    for (const item of bySession.values()) if (Number.isFinite(item.score)) (item.ai ? supported : unsupported).push(item.score);
    const trend = new Map();
    for (const event of scores) {
      const key = weekKey(event.receivedAt);
      const list = trend.get(key) || []; list.push(event.data.score); trend.set(key, list);
    }
    const stageDurations = new Map();
    for (const event of events.filter(item => item.type === 'stage_completed' && Number.isFinite(item.data.durationMs))) {
      const stage = event.data.stage || event.stage || 'unknown';
      const values = stageDurations.get(stage) || []; values.push(event.data.durationMs); stageDurations.set(stage, values);
    }
    const categoryTotals = Object.entries(this.settings.rubricWeights);
    const categoryPerformance = categoryTotals.map(([category, max]) => {
      const records = scores.map(event => ({ points: Number(event.data.rubricScores?.[category]), max: Number(event.data.rubricMax?.[category] ?? max) })).filter(item => Number.isFinite(item.points) && Number.isFinite(item.max));
      const normalized = records.map(item => item.max > 0 ? 100 * item.points / item.max : 0);
      return { category, average: round(mean(normalized)), max: 100, configuredMax: max, n: records.length };
    });
    const aiHintCount = events.filter(event => event.type === 'hint_shown' && event.data.source === 'openai').length;
    const fallbackHintCount = events.filter(event => event.type === 'hint_shown' && event.data.source === 'fallback').length;
    return {
      sampleSize: latestScores.length,
      studentCount: new Set([...latest.values()].map(event => event.studentId)).size,
      completionCount: events.filter(event => event.type === 'lab_completed').length,
      averageScore: round(mean(latestScores)),
      scoreDistribution: bands,
      frequentErrors: [...errors.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count).slice(0, 12),
      categoryPerformance,
      progress: [...trend.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, values]) => ({ week, average: round(mean(values)), n: values.length })),
      stageDurations: [...stageDurations.entries()].map(([stage, values]) => ({ stage, averageMs: round(mean(values)), totalMs: values.reduce((sum, value) => sum + value, 0), n: values.length })).sort((a, b) => a.stage.localeCompare(b.stage)),
      ai: {
        aiHintCount, fallbackHintCount, hintedIssues: issueHints.size,
        independentlyResolvedIssues: aiResolved.size,
        correctionRate: issueHints.size ? round(100 * aiResolved.size / issueHints.size) : null,
        supportComparison: {
          withAI: { n: supported.length, averageScore: round(mean(supported)) },
          withoutAI: { n: unsupported.length, averageScore: round(mean(unsupported)) }
        }
      },
      latestScores: [...latest.values()].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)).map(event => ({
        ...(isAdmin ? { studentId: event.studentId, studentName: event.studentName || '', username: event.username || '', groupId: event.groupId } : {}),
        labId: event.labId, labTitle: event.labTitle, at: event.receivedAt, score: event.data.score,
        rubricScores: event.data.rubricScores || {}, rubricMax: event.data.rubricMax || {}, hints: event.data.totalHints || 0,
        independence: event.data.independence ?? null, errors: event.data.errorCount || 0
      }))
    };
  }

  withUserLock(operation) {
    const next = this.writeQueue.then(operation);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  withEventLock(operation) {
    const next = this.writeQueue.then(operation);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }
  async persistUsers() {
    const temp = this.usersFile + '.tmp';
    await writeFile(temp, JSON.stringify(this.users, null, 2), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, this.usersFile);
  }
}

export function hashSessionToken(token) { return createHash('sha256').update(token).digest('hex'); }
export function createSessionToken() { return randomBytes(32).toString('base64url'); }
