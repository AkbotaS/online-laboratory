(() => {
  const notice = document.createElement('aside');
  notice.id = 'autoMentorNotice';
  notice.className = 'mentor-notice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.innerHTML = '<button type="button" class="mentor-close" aria-label="Закрыть">×</button><h3></h3><p class="mentor-explanation"></p><p class="mentor-question"></p><p class="mentor-hint"></p><small></small>';
  document.body.appendChild(notice);
  notice.querySelector('.mentor-close').addEventListener('click', () => notice.classList.remove('open'));

  const defaultSafety = [
    { id: 'safety-coat', text: 'Халат пен қолғап кию' },
    { id: 'safety-reagents', text: 'Реактивтерді нұсқаулыққа сай пайдалану' },
    { id: 'safety-workplace', text: 'Жұмыс орнын таза ұстау' }
  ];
  const defaultMicro = [
    { id: 'micro-form', label: 'Пішіні', answers: [] },
    { id: 'micro-arrangement', label: 'Орналасуы', answers: [] },
    { id: 'micro-staining', label: 'Боялуы', answers: [] }
  ];
  const categoryLabels = { equipment: 'Құрал-жабдықтар', steps: 'Жұмыс барысы', safety: 'Қауіпсіздік', microscope: 'Микроскопиялық талдау', questions: 'Бақылау сұрақтары' };
  const weights = { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 };
  const pendingEvents = new Map();
  const lastSent = new Map();
  const observationsSent = new Set();
  const originalEvaluateLab = evaluateLab;
  const originalResultHtml = resultHtml;
  const originalRenderLabDetail = renderLabDetail;
  const originalRender = render;
  const originalMicroscopePage = microscopePage;
  const originalQuizEditorPage = quizEditorPage;

  function language() { return /^ru/i.test(navigator.language || '') ? 'ru' : 'kk'; }
  function escape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function labSafety(lab) { return Array.isArray(lab?.safetyCriteria) && lab.safetyCriteria.length ? lab.safetyCriteria : defaultSafety; }
  function labMicroscopeCriteria(lab) { return Array.isArray(lab?.microscopeCriteria) && lab.microscopeCriteria.length ? lab.microscopeCriteria : defaultMicro; }
  function labQuizzes(lab) { return quizzes.filter(quiz => quiz.labId === lab?.id); }
  function quizTotals(lab) {
    const linked = labQuizzes(lab);
    let total = 0, correct = 0;
    linked.forEach(quiz => {
      const expected = (quiz.questions || []).length;
      const attempt = quizAttempts[quiz.id];
      total += expected;
      correct += Math.min(expected, Math.max(0, Number(attempt?.score) || 0));
    });
    return { total, correct, errors: Math.max(0, total - correct), linked: linked.length };
  }
  function criteriaMatch(response, criterion) {
    const value = normalizeQuizAnswer(response);
    if (!value) return false;
    return (criterion.answers || []).some(answer => {
      const expected = normalizeQuizAnswer(answer);
      return expected && (value === expected || value.includes(expected));
    });
  }
  function microscopeTotals(lab, attempt) {
    if (lab?._answerKeyHidden) {
      const review = attempt.result?.microscopeReview || attempt.microscopeReview || [];
      return { total: labMicroscopeCriteria(lab).length, correct: review.filter(item => item.correct).length, errors: Math.max(0, labMicroscopeCriteria(lab).length - review.filter(item => item.correct).length), review: review.map(item => ({ criterion: { id: item.criterionId || item.criterion?.id, label: item.label || item.criterion?.label || '' }, answer: '', correct: Boolean(item.correct) })) };
    }
    const criteria = labMicroscopeCriteria(lab);
    const answers = attempt.microscopeAnswers || {};
    const review = criteria.map(criterion => ({ criterion, answer: String(answers[criterion.id] || ''), correct: criteriaMatch(answers[criterion.id], criterion) }));
    return { total: criteria.length, correct: review.filter(item => item.correct).length, errors: review.filter(item => !item.correct).length, review };
  }
  function ensureStats(attempt) {
    attempt.mentorStats ||= { hints: 0, hintsByCategory: {}, mistakes: 0, mistakesByCategory: {}, repeatMistakes: 0, activeErrors: {} };
    attempt.mentorStats.hintsByCategory ||= {};
    attempt.mentorStats.mistakesByCategory ||= {};
    attempt.mentorStats.repeatMistakesByCategory ||= {};
    attempt.mentorStats.activeErrors ||= {};
    attempt.mentorStats.activeIssueIds ||= {};
    attempt.mentorStats.hintSourcesByIssue ||= {};
    return attempt.mentorStats;
  }
  function countErrors(lab, attempt, basic) {
    const safety = labSafety(lab);
    const safetyDone = new Set(Object.keys(attempt.safety || {}).filter(id => attempt.safety[id]));
    const micro = microscopeTotals(lab, attempt);
    const quiz = quizTotals(lab);
    return {
      equipment: (basic.extraEquipment || []).length + (basic.missingEquipment || []).length,
      steps: (basic.extraSteps || []).length + (basic.missingSteps || []).length + (basic.wrongOrder ? 1 : 0),
      safety: safety.filter(item => !safetyDone.has(item.id)).length,
      microscope: micro.errors,
      questions: quiz.errors
    };
  }
  function evaluateWithRubric(lab, attempt) {
    if (lab?._answerKeyHidden && attempt.result?.serverVerified) return attempt.result;
    const basic = originalEvaluateLab(lab, attempt);
    const safety = labSafety(lab);
    const safetyDone = new Set(Object.keys(attempt.safety || {}).filter(id => attempt.safety[id]));
    const micro = microscopeTotals(lab, attempt);
    const quiz = quizTotals(lab);
    const errors = countErrors(lab, attempt, basic);
    const stats = ensureStats(attempt);
    const hintPenalty = Number(lab.scoreRules?.hintPenalty ?? 0.5);
    const errorPenalty = Number(lab.scoreRules?.errorPenalty ?? 1);
    const categoryBase = {
      equipment: basic.equipmentTotal ? weights.equipment * basic.equipmentCorrect / Math.max(1, basic.equipmentTotal + (basic.extraEquipment || []).length) : 0,
      steps: basic.stepsTotal ? weights.steps * basic.stepsInPlace / Math.max(1, basic.stepsTotal + (basic.extraSteps || []).length) : 0,
      safety: safety.length ? weights.safety * safety.filter(item => safetyDone.has(item.id)).length / safety.length : 0,
      microscope: micro.total ? weights.microscope * micro.correct / micro.total : 0,
      questions: quiz.total ? weights.questions * quiz.correct / quiz.total : 0
    };
    const rubricScores = {};
    Object.keys(weights).forEach(category => {
      const repeated = Number(stats.repeatMistakesByCategory[category]) || 0;
      const deduction = errors[category] * errorPenalty + (Number(stats.hintsByCategory[category]) || 0) * hintPenalty + repeated * errorPenalty;
      rubricScores[category] = { points: Math.max(0, Math.min(weights[category], categoryBase[category] - deduction)), max: weights[category], errors: errors[category], hints: Number(stats.hintsByCategory[category]) || 0 };
    });
    const rawScore = Object.values(rubricScores).reduce((sum, item) => sum + item.points, 0);
    const score = Math.max(0, Math.min(100, Math.round(rawScore)));
    const totalHints = Number(stats.hints) || 0;
    const independence = Math.max(0, Math.round(100 * (1 - Math.min(5, totalHints) / 5)));
    return { ...basic, score, total: 100, rubricScores, errorCounts: errors, totalErrors: Object.values(errors).reduce((sum, value) => sum + value, 0) + (Number(stats.mistakes) || 0), hintsUsed: totalHints, independence, microscopeReview: micro.review, quizLinked: quiz.linked, checkedAt: new Date().toISOString() };
  }
  evaluateLab = evaluateWithRubric;
  function refreshLabGrade(lab, attempt) {
    if (!attempt?.result) return;
    if (lab?._answerKeyHidden) window.learningAnalytics?.gradeLab(lab.id, attempt).then(() => { if (activeLabId === lab.id && assignmentModal.classList.contains('open')) renderLabDetail(); if (activeMicroscopeLabId === lab.id && page === 'microscope') render(); }).catch(() => {});
    else { attempt.result = evaluateLab(lab, attempt); window.learningAnalytics?.scoreUpdated(lab.id); }
  }

  function reportMarkup(lab, result) {
    if (!result?.rubricScores) return '';
    const scoreCards = Object.entries(result.rubricScores).map(([key, item]) => '<div class="mentor-rubric-card"><b>' + categoryLabels[key] + '</b><span>' + item.points.toFixed(item.points % 1 ? 1 : 0) + ' / ' + item.max + '</span></div>').join('');
    const strengths = Object.entries(result.rubricScores).filter(([, item]) => item.points >= item.max * 0.8).map(([key]) => categoryLabels[key]);
    const recommendations = Object.entries(result.rubricScores).filter(([, item]) => item.points < item.max * 0.7).map(([key]) => categoryLabels[key]);
    const errors = Object.entries(result.errorCounts || {}).filter(([, count]) => count > 0).map(([key, count]) => categoryLabels[key] + ': ' + count);
    const independenceLabel = result.independence >= 80 ? 'жоғары' : result.independence >= 50 ? 'орташа' : 'қосымша қолдау қажет';
    const notes = '<b>Қателер:</b> ' + (errors.length ? errors.map(escape).join(' · ') : 'Қате тіркелмеді') + '<br><b>Күшті жақтары:</b> ' + (strengths.length ? strengths.map(escape).join(', ') : 'Әзірге тұрақты күшті санат жоқ') + '<br><b>Ұсыныстар:</b> ' + (recommendations.length ? recommendations.map(escape).join(', ') : 'Осы деңгейіңізді сақтаңыз') + '<br><b>Өз бетінше орындау:</b> ' + result.independence + '% (' + independenceLabel + '), кеңес қолданылды: ' + result.hintsUsed + ' рет.';
    const microReviews = (result.microscopeReview || []).map(item => '<li>' + escape(item.criterion.label) + ': ' + (item.correct ? 'дұрыс' : 'қайта қарау керек') + '</li>').join('');
    const linkedNote = result.quizLinked ? '' : '<p class="mentor-muted">Бұл жұмысқа бақылау тапсырмасы әлі байланыстырылмаған, сондықтан сұрақтар санаты қазір 0/20.</p>';
    return '<section class="lab-section-card mentor-rubric"><h3>Жұмыс есебі · ' + result.score + '/100</h3><div class="mentor-rubric-grid">' + scoreCards + '</div><div class="mentor-report-notes">' + notes + '</div>' + (microReviews ? '<p class="mentor-muted" style="margin-top:10px"><b>Микроскоп талдауы:</b></p><ul class="mentor-muted">' + microReviews + '</ul>' : '') + linkedNote + '</section>';
  }
  resultHtml = function (lab, result) { return originalResultHtml(lab, result).replace(/<div class="assignment-details"[^>]*>[\s\S]*?<\/div>$/, '<div class="assignment-details" style="margin-top:10px"><b>Бағдарлама бойынша есептелген қорытынды:</b> ' + result.score + '/100 ұпай</div>') + reportMarkup(lab, result); };

  function categorySection(lab, attempt) {
    const safety = labSafety(lab);
    const safetyHtml = safety.map(item => '<label class="mentor-check"><input type="checkbox" data-safety-check="' + escape(item.id) + '" ' + (attempt.safety?.[item.id] ? 'checked' : '') + '><span>' + escape(item.text) + '</span></label>').join('');
    const linked = labQuizzes(lab);
    const quizHtml = linked.length
      ? linked.map(quiz => '<button class="secondary-btn" type="button" data-start-linked-quiz="' + escape(quiz.id) + '">«' + escape(quiz.title) + '» бақылау сұрақтарын орындау</button>').join(' ')
      : '<p class="mentor-muted">Бақылау сұрақтарын баптау үшін әкімші тапсырмалар бөлімінде осы лабораторияны таңдасын.</p>';
    return '<section class="lab-section-card" data-mentor-section="true"><h3>Қауіпсіздік ережелері</h3><p>Орындалған талаптарды белгілеңіз.</p><div class="mentor-safety-list">' + safetyHtml + '</div></section><section class="lab-section-card" data-mentor-section="true"><h3>Бақылау сұрақтары</h3><p>Жауаптарды осы лабораторияға байланыстырылған тапсырмалардан орындаңыз.</p><div class="mentor-safety-list">' + quizHtml + '</div></section>';
  }
  function addLabSections() {
    const lab = labs.find(item => item.id === activeLabId);
    if (!lab || role !== 'student') return;
    const host = assignmentBody.querySelector('#labResultOutput')?.closest('.lab-section-card');
    if (!host || assignmentBody.querySelector('[data-mentor-section]')) return;
    host.insertAdjacentHTML('beforebegin', categorySection(lab, getAttempt(lab.id)));
  }
  renderLabDetail = function () {
    const lab = labs.find(item => item.id === activeLabId), attempt = lab && getAttempt(lab.id);
    if (lab && attempt?.result && !attempt.result.rubricScores) { attempt.result = evaluateLab(lab, attempt); attempts[lab.id] = attempt; saveState(); }
    originalRenderLabDetail();
    addLabSections();
  };

  function injectQuizLinkSelector() {
    if (role !== 'admin' || page !== 'quiz-editor' || !quizDraft || content.querySelector('#quizLabLink')) return;
    const title = content.querySelector('[data-quiz-title]');
    if (!title) return;
    const row = document.createElement('label');
    row.className = 'field';
    row.innerHTML = '<span>Зертханалық жұмысқа байланыстыру</span><select id="quizLabLink"><option value="">Жалпы тапсырма</option>' + labs.map(lab => '<option value="' + escape(lab.id) + '">' + escape(lab.title) + '</option>').join('') + '</select>';
    title.closest('.field')?.insertAdjacentElement('afterend', row);
    const select = row.querySelector('select');
    select.value = quizDraft.labId || '';
    select.addEventListener('change', () => { quizDraft.labId = select.value || ''; });
  }

  function microscopeAnalysisMarkup(lab) {
    const attempt = getAttempt(lab.id);
    const criteria = labMicroscopeCriteria(lab);
    const controls = criteria.map(item => '<label class="field"><span>' + escape(item.label) + '</span><input type="text" data-micro-answer="' + escape(item.id) + '" value="' + escape(attempt.microscopeAnswers?.[item.id] || '') + '" maxlength="240" placeholder="Бақылауыңызды сипаттаңыз"></label>').join('');
    const feedback = attempt.microscopeReview?.length ? '<div class="mentor-score-note">' + attempt.microscopeReview.map(item => '<b>' + escape(item.criterion.label) + ':</b> ' + (item.correct ? 'дұрыс бақылау' : 'қайта тексеріңіз')).join('<br>') + '</div>' : '';
    const photoReady = Boolean(attempt.result && lab.micrographs?.length);
    return '<section class="panel mentor-micro-analysis"><div class="panel-head"><div><h3>Микроскопиялық талдау</h3><span class="muted">Пішінін, орналасуын және боялуын сипаттаңыз. Жауаптар мұғалім критерийлерімен бағдарламалық тексеріледі.</span></div></div>' + (photoReady ? '<div class="mentor-observation-list">' + controls + '</div><div class="quiz-submit-row"><button class="primary-btn" type="button" id="submitMicroAnalysis">Талдауды тексеру</button></div>' : '<p class="mentor-muted">Алдымен осы лабораториялық жұмысты орындап, нәтижесін сақтаңыз. Микроскоп фотосы содан кейін ашылады.</p>') + feedback + (attempt.result ? '<div class="mentor-score-note" style="margin-top:12px">Ағымдағы бағдарлама есебі: <b>' + (attempt.result.score || 0) + '/100</b></div>' : '') + '</section>';
  }
  function addMicroscopeAnalysis() {
    if (role !== 'student' || page !== 'microscope') return;
    const lab = labs.find(item => item.id === activeMicroscopeLabId);
    const layout = content.querySelector('.microscope-layout');
    if (!lab || !layout || content.querySelector('.mentor-micro-analysis')) return;
    layout.insertAdjacentHTML('afterend', microscopeAnalysisMarkup(lab));
  }
  render = function () { originalRender(); injectQuizLinkSelector(); addMicroscopeAnalysis(); };
  microscopePage = function () { return originalMicroscopePage(); };
  quizEditorPage = function () { return originalQuizEditorPage(); };

  function showNotice(feedback, category) {
    notice.querySelector('h3').textContent = feedback.title || 'ЖИ-наставшы';
    notice.querySelector('.mentor-explanation').textContent = feedback.explanation || '';
    notice.querySelector('.mentor-question').textContent = feedback.guidingQuestion ? 'Сұрақ: ' + feedback.guidingQuestion : '';
    notice.querySelector('.mentor-hint').textContent = feedback.hint ? 'Ишара: ' + feedback.hint : '';
    notice.querySelector('small').textContent = categoryLabels[category] || '';
    notice.classList.add('open');
    clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => notice.classList.remove('open'), 16_000);
  }
  function localFallback(category, errorType, repeated) {
    const level = Math.min(3, repeated);
    const contentByCategory = {
      equipment: ['Қай құралдың қызметі осы тәжірибенің мақсатына сай екенін қайта ойлаңыз.', 'Заттардың қасиетін жұмыс нәтижесімен байланыстырып, артық құралды алып тастаңыз.', 'Әр құралға «осы қадамда не істейді?» деп сұрап, таңдауыңызды сол негізде қайта тексеріңіз.'],
      steps: ['Кезеңдердің себебі мен нәтижесін ойша байланыстырып көріңіз.', 'Алдымен қауіпсіздік пен дайындықты, содан кейін тәжірибе мен бақылауды салыстырыңыз.', 'Әр қадамнан кейін не дайын болуы керегін белгілеңіз де, тізімді қайта реттеңіз.'],
      safety: ['Қорғаныш пен тазалық талаптарын қайта қарап шығыңыз.', 'Қолданылатын реактивтерге қатысты нұсқаулық пен жеке қорғаныс құралдарын тексеріңіз.', 'Жұмысты бастамай тұрып, орындалмаған қауіпсіздік тармақтарын бір-бірден тексеріңіз.'],
      microscope: ['Суреттен өзіңіз байқаған пішін мен орналасуды сипаттап көріңіз.', 'Жасушалардың пішінін, бір-біріне қатысты орналасуын және боялуын бөлек қараңыз.', 'Кескіннің анықтығын фокуста тексеріп, пішін, топтасу және түс қарқындылығы бойынша жеке бақылау жазыңыз.'],
      questions: ['Сұрақтағы негізгі ұғымды тауып, өз жауабыңызды нұсқаулықпен салыстырыңыз.', 'Жауапты есіңізден емес, осы қадамның мақсатына сүйеніп тексеріңіз.', 'Қате жауапты өзгертерден бұрын, қандай дәлел оны растайтынын өзіңізден сұраңыз.']
    };
    const ru = language() === 'ru';
    const map = ru ? {
      equipment: ['Подумайте, функция какого инструмента соответствует цели опыта.', 'Свяжите свойства предметов с результатом работы и уберите лишнее.', 'Для каждого предмета спросите себя: «Что он делает на этом этапе?» и перепроверьте выбор.'],
      steps: ['Свяжите причину и результат каждого этапа.', 'Сравните подготовку и безопасность с последующим опытом и наблюдением.', 'Отметьте, что должно быть готово после каждого действия, и перестройте список.'],
      safety: ['Перепроверьте требования к защите и чистоте.', 'Проверьте инструкцию к реактивам и средства индивидуальной защиты.', 'Перед продолжением проверьте каждый незакрытый пункт безопасности.'],
      microscope: ['Опишите форму и расположение, которые вы сами замечаете на изображении.', 'Рассмотрите отдельно форму клеток, их взаимное расположение и окраску.', 'Проверьте фокус, затем отдельно запишите наблюдения о форме, расположении и интенсивности окраски.'],
      questions: ['Найдите ключевое понятие и сверьте ответ с инструкцией.', 'Проверьте ответ по цели этого этапа, а не наугад.', 'Перед исправлением спросите себя, какое наблюдение подтверждает ответ.']
    } : contentByCategory;
    return { title: ru ? 'Подсказка наставника' : 'ЖИ-наставшының ишарасы', explanation: ru ? 'Похоже, здесь стоит ещё раз проверить ход работы.' : 'Бұл жерде жұмыс барысын тағы бір тексеріп көрген жөн.', guidingQuestion: ru ? 'Какой признак поможет вам проверить свой выбор?' : 'Таңдауыңызды қандай белгі арқылы тексеруге болады?', hint: map[category]?.[level - 1] || (errorType === 'wrong_order' ? map.steps[0] : map.questions[0]) };
  }
  async function compactImage(source) {
    if (!source || !source.startsWith('data:image/')) return '';
    try {
      const image = new Image();
      image.src = source;
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
      const scale = Math.min(1, 700 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.52);
    } catch { return ''; }
  }
  function endpoint() { return location.protocol === 'file:' ? 'http://127.0.0.1:4173/api/mentor-event' : '/api/mentor-event'; }
  function incrementError(labId, category, count = 1) {
    const attempt = getAttempt(labId);
    const stats = ensureStats(attempt);
    const previous = Number(stats.mistakesByCategory[category]) || 0;
    stats.mistakesByCategory[category] = Math.min(50, previous + count);
    stats.mistakes = Math.min(100, (Number(stats.mistakes) || 0) + count);
    if (previous > 0) {
      stats.repeatMistakes = Math.min(50, (Number(stats.repeatMistakes) || 0) + count);
      stats.repeatMistakesByCategory[category] = Math.min(50, (Number(stats.repeatMistakesByCategory[category]) || 0) + count);
    }
    attempts[labId] = attempt;
    saveState();
    return stats.mistakesByCategory[category];
  }
  async function requestMentor(lab, category, errorType, summary, options = {}) {
    if (!assistantConfig.enabled || role !== 'student') return;
    const key = lab.id + ':' + category + ':' + errorType + (options.photoKey || '');
    const now = Date.now();
    if (now - (lastSent.get(key) || 0) < (options.cooldown || 8000)) return;
    lastSent.set(key, now);
    const repeated = options.informational ? (Number(getAttempt(lab.id).mentorStats?.mistakesByCategory?.[category]) || 0) : incrementError(lab.id, category, Math.max(1, options.errorCount || 1));
    const attempt = getAttempt(lab.id), stats = ensureStats(attempt);
    let issueId = '';
    if (!options.informational) {
      if (!stats.activeErrors[category]) {
        issueId = 'issue-' + (globalThis.crypto?.randomUUID?.() || Date.now().toString(36) + Math.random().toString(36).slice(2, 9));
        stats.activeIssueIds[category] = issueId;
        stats.hintSourcesByIssue[issueId] = [];
        window.learningAnalytics?.issueDetected(lab, category, errorType, issueId, Math.max(1, options.errorCount || 1));
      } else issueId = stats.activeIssueIds[category] || '';
      stats.activeErrors[category] = true;
    }
    const recordHint = source => {
      if (options.informational || !issueId) return;
      stats.hintSourcesByIssue[issueId] ||= [];
      stats.hintSourcesByIssue[issueId].push(source);
      window.learningAnalytics?.hintShown(lab, category, issueId, source, options.informational ? 1 : Math.max(1, Math.min(3, 1 + Math.floor((repeated - 1) / 2))));
    };
    attempts[lab.id] = attempt;
    saveState();
    const languageCode = language();
    const image = options.image ? await compactImage(options.image) : '';
    const event = { category, errorType, labTitle: lab.title, summary: String(summary || '').slice(0, 260), errorCount: repeated, hintLevel: options.informational ? 1 : Math.max(1, Math.min(3, 1 + Math.floor((repeated - 1) / 2))), language: languageCode, teacherGuidance: [lab.aiGuidance || '', ...(lab.errorVariants || []), assistantConfig.instructions || ''].filter(Boolean).join('\n').slice(0, 900), ...(image ? { image } : {}) };
    showNotice(localFallback(category, errorType, event.hintLevel), category);
    try {
      const response = await fetch(endpoint(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.explanation) {
        if (!options.informational) {
          stats.hints = Math.min(100, (Number(stats.hints) || 0) + 1);
          stats.hintsByCategory[category] = Math.min(50, (Number(stats.hintsByCategory[category]) || 0) + 1);
          recordHint('fallback');
          if (attempt.result) refreshLabGrade(lab, attempt);
          attempts[lab.id] = attempt; saveState();
        }
        notice.querySelector('small').textContent = (categoryLabels[category] || '') + ' · ' + (languageCode === 'ru' ? 'общая подсказка; ИИ API не подключён' : 'жалпы ишара; ЖИ API қосылмаған');
        return;
      }
      if (!options.informational) {
        stats.hints = Math.min(100, (Number(stats.hints) || 0) + 1);
        stats.hintsByCategory[category] = Math.min(50, (Number(stats.hintsByCategory[category]) || 0) + 1);
        recordHint('openai');
      }
      attempts[lab.id] = attempt;
      if (attempt.result) refreshLabGrade(lab, attempt);
      saveState();
      showNotice(data, category);
      if (activeLabId === lab.id && assignmentModal.classList.contains('open')) renderLabDetail();
      if (activeMicroscopeLabId === lab.id && page === 'microscope') render();
    } catch {
      if (!options.informational) {
        stats.hints = Math.min(100, (Number(stats.hints) || 0) + 1);
        stats.hintsByCategory[category] = Math.min(50, (Number(stats.hintsByCategory[category]) || 0) + 1);
        recordHint('fallback');
        if (attempt.result) refreshLabGrade(lab, attempt);
        attempts[lab.id] = attempt; saveState();
      }
      notice.querySelector('small').textContent = (categoryLabels[category] || '') + ' · ' + (languageCode === 'ru' ? 'общая подсказка; соединение с ИИ недоступно' : 'жалпы ишара; ЖИ серверіне қосылу мүмкін болмады');
    }
  }
  function setActiveIssue(labId, category, present) {
    const attempt = getAttempt(labId), stats = ensureStats(attempt);
    const wasActive = Boolean(stats.activeErrors[category]);
    stats.activeErrors[category] = Boolean(present);
    if (wasActive && !present) {
      const issueId = stats.activeIssueIds[category] || '';
      const usedOpenAI = Boolean(issueId && stats.hintSourcesByIssue[issueId]?.includes('openai'));
      const sources = issueId ? (stats.hintSourcesByIssue[issueId] || []) : [];
      const source = usedOpenAI ? 'openai' : sources.includes('fallback') ? 'fallback' : 'none';
      window.learningAnalytics?.issueResolved(labs.find(item => item.id === labId), category, issueId, source, usedOpenAI);
      delete stats.activeIssueIds[category];
      saveState();
      const ru = language() === 'ru';
      showNotice({ title: ru ? 'Ошибка исправлена' : 'Қате түзетілді', explanation: ru ? 'Хорошо. Вы самостоятельно пересмотрели действие.' : 'Жақсы. Әрекетті өзіңіз қайта тексеріп түзеттіңіз.', guidingQuestion: '', hint: '' }, category);
    } else saveState();
  }
  function equipmentIssue(lab, attempt) { if (lab?._answerKeyHidden) return false; const result = originalEvaluateLab(lab, attempt); return result.extraEquipment.length + result.missingEquipment.length > 0; }
  function stepIssue(lab, attempt) { if (lab?._answerKeyHidden) return false; const result = originalEvaluateLab(lab, attempt); return result.extraSteps.length > 0 || result.wrongOrder; }
  function selectedPhoto(lab) {
    const state = microscopeStateFor(lab);
    const complete = Boolean(attempts[lab.id]?.result);
    return complete ? lab.micrographs?.[state.photoIndex] : null;
  }
  function sendMicroscopeCoach(lab, reason, force = false) {
    const state = microscopeStateFor(lab), photo = selectedPhoto(lab);
    if (!photo?.src || (!force && state.objective !== '40x' && state.objective !== '100x')) return;
    const key = lab.id + ':' + state.photoIndex;
    if (!force && observationsSent.has(key)) return;
    if (!force) observationsSent.add(key);
    requestMentor(lab, 'microscope', 'observation_prompt', reason, { photoKey: (force ? ':analysis-error:' : ':image:') + state.photoIndex, cooldown: force ? 8_000 : 60_000, image: photo.src, informational: !force });
  }
  function sendMicroscopeControlCoach(lab, action) {
    const state = microscopeStateFor(lab), photo = selectedPhoto(lab);
    if (!photo?.src || (state.objective !== '40x' && state.objective !== '100x')) return;
    requestMentor(lab, 'microscope', 'observation_prompt', action + '. Кескінге назар аудар да, енді қандай морфологиялық ерекшеліктер байқағаныңды өзің сипатта.', { photoKey: ':controls', cooldown: 30_000, image: photo.src, informational: true });
  }
  async function storeMicroscopeAnswers() {
    const lab = labs.find(item => item.id === activeMicroscopeLabId);
    if (!lab) return;
    const attempt = getAttempt(lab.id), criteria = labMicroscopeCriteria(lab), answers = {};
    criteria.forEach(item => { answers[item.id] = content.querySelector('[data-micro-answer="' + CSS.escape(item.id) + '"]')?.value.trim() || ''; });
    if (criteria.some(item => !answers[item.id])) return showToast(language() === 'ru' ? 'Заполните все поля наблюдения.' : 'Барлық бақылау өрісін толтырыңыз.');
    attempt.microscopeAnswers = answers;
    if (lab._answerKeyHidden) {
      try {
        const result = await window.learningAnalytics.assessLab(lab.id, attempt);
        attempt.microscopeReview = result.microscopeReview || [];
        if (attempt.result) { attempt.result = await window.learningAnalytics.gradeLab(lab.id, attempt); }
        attempts[lab.id] = attempt; saveState(); render();
        const incorrect = (attempt.microscopeReview || []).filter(item => !item.correct).length;
        if (incorrect) sendMicroscopeCoach(lab, 'Микроскопиялық сипаттамада ' + incorrect + ' тармақты қайта бақылау қажет. Суретке мұқият қарап, өз сипаттамаңызды тексеріңіз.', true);
        else showNotice(language() === 'ru' ? { title: 'Наблюдение записано', explanation: 'Преподавательские критерии проверены сервером.', guidingQuestion: 'Какой признак помог вам сделать вывод?', hint: '' } : { title: 'Бақылау тіркелді', explanation: 'Оқытушы критерийлері серверде тексерілді.', guidingQuestion: 'Қорытынды жасауға қай белгі көмектесті?', hint: '' }, 'microscope');
      } catch (error) { showToast(error.message || 'Талдауды тексеру мүмкін болмады'); }
      return;
    }
    const review = microscopeTotals(lab, attempt);
    attempt.microscopeReview = review.review.map(item => ({ criterionId: item.criterion.id, label: item.criterion.label, correct: item.correct }));
    if (attempt.result) refreshLabGrade(lab, attempt);
    attempts[lab.id] = attempt;
    saveState();
    render();
    const incorrect = review.errors;
    if (incorrect) sendMicroscopeCoach(lab, 'Микроскопиялық сипаттамада ' + incorrect + ' тармақты қайта бақылау қажет. Суретке мұқият қарап, өз сипаттамаңызды тексеріңіз.', true);
    else showNotice(language() === 'ru' ? { title: 'Хорошее наблюдение', explanation: 'Все описания совпали с критериями преподавателя.', guidingQuestion: 'Какой признак помог вам сделать вывод?', hint: '' } : { title: 'Бақылауыңыз жақсы', explanation: 'Сипаттамалар оқытушы критерийлеріне сәйкес келді.', guidingQuestion: 'Қорытынды жасауға қай белгі көмектесті?', hint: '' }, 'microscope');
  }
  async function finalizeLabCoach(lab) {
    if (lab?._answerKeyHidden) {
      const attempt = getAttempt(lab.id); let result;
      try { result = await window.learningAnalytics?.assessLab(lab.id, attempt); } catch { return; }
      if (!result) return;
      if (result.errorCounts.equipment) requestMentor(lab, result.extraEquipmentCount ? 'equipment' : 'equipment', result.extraEquipmentCount ? 'wrong_selection' : 'missing_item', 'Құрал-жабдық таңдауыңыздың толықтығы мен сәйкестігін қайта тексеріңіз.', { errorCount: result.errorCounts.equipment });
      if (result.errorCounts.steps) requestMentor(lab, 'steps', result.wrongOrder ? 'wrong_order' : 'missing_item', 'Жұмыс кезеңдерінің толықтығы мен ретін қайта қарап шығыңыз.', { errorCount: result.errorCounts.steps });
      if (result.errorCounts.safety) requestMentor(lab, 'safety', 'unsafe_action', 'Қауіпсіздік талаптарының орындалуын қайта қарап шығыңыз.', { errorCount: result.errorCounts.safety });
      if (result.errorCounts.questions) requestMentor(lab, 'questions', 'incorrect_answer', 'Бақылау сұрақтарындағы таңдауларыңызды нұсқаулыққа сүйеніп қайта қараңыз.', { errorCount: result.errorCounts.questions });
      return;
    }
    const attempt = getAttempt(lab.id), result = originalEvaluateLab(lab, attempt);
    if (result.extraEquipment.length || result.missingEquipment.length) requestMentor(lab, 'equipment', result.extraEquipment.length ? 'wrong_selection' : 'missing_item', 'Құрал-жабдық таңдауын мұғалім критерийлерімен қайта салыстыр.', { errorCount: Math.max(1, result.extraEquipment.length + result.missingEquipment.length) });
    if (result.extraSteps.length || result.missingSteps.length || result.wrongOrder) requestMentor(lab, 'steps', result.wrongOrder ? 'wrong_order' : 'missing_item', 'Жұмыс кезеңдерінің толықтығы мен ретін қайта қарап шық.', { errorCount: Math.max(1, result.extraSteps.length + result.missingSteps.length + (result.wrongOrder ? 1 : 0)) });
    const incompleteSafety = labSafety(lab).filter(item => !attempt.safety?.[item.id]);
    if (incompleteSafety.length) requestMentor(lab, 'safety', 'unsafe_action', 'Қауіпсіздік талабын аяқтамай тұрып келесі қадамға өттіңіз. Орындаған талаптарды белгілеңіз.', { errorCount: incompleteSafety.length });
    const linked = labQuizzes(lab), quiz = quizTotals(lab);
    if (linked.length && quiz.total && quiz.errors) requestMentor(lab, 'questions', 'incorrect_answer', 'Бақылау сұрақтарының кейбір жауаптарын жұмыстың мақсатына сүйеніп қайта тексер.', { errorCount: quiz.errors });
  }

  document.addEventListener('change', event => {
    const target = event.target;
    if (target.id === 'quizLabLink' && quizDraft) { quizDraft.labId = target.value || ''; return; }
    if (target.matches('[data-safety-check]')) {
      const lab = labs.find(item => item.id === activeLabId);
      if (!lab) return;
      const attempt = getAttempt(lab.id);
      attempt.safety ||= {};
      attempt.safety[target.dataset.safetyCheck] = target.checked;
      if (attempt.result) refreshLabGrade(lab, attempt);
      attempts[lab.id] = attempt; saveState();
      if (target.checked && labSafety(lab).every(item => attempt.safety[item.id])) setActiveIssue(lab.id, 'safety', false);
      renderLabDetail();
      return;
    }
    if (target.matches('[data-eq-choice]')) {
      const lab = labs.find(item => item.id === activeLabId); if (!lab) return;
      if (lab._answerKeyHidden) return;
      clearTimeout(pendingEvents.get('equipment'));
      const current = originalEvaluateLab(lab, getAttempt(lab.id));
      if (target.checked && current.extraEquipment.length) setTimeout(() => requestMentor(lab, 'equipment', 'wrong_selection', 'Осы таңдау жұмыс мақсатына сәйкес келетінін тексеріп көр.'), 900);
      else if (!current.extraEquipment.length) setActiveIssue(lab.id, 'equipment', false);
      return;
    }
    if (target.matches('[data-step-choice]')) {
      const lab = labs.find(item => item.id === activeLabId); if (!lab) return;
      if (lab._answerKeyHidden) return;
      if (stepIssue(lab, getAttempt(lab.id))) requestMentor(lab, 'steps', 'wrong_selection', 'Таңдалған кезең осы тәжірибеге қажет екенін қайта ойла.');
      else setActiveIssue(lab.id, 'steps', false);
    }
  });

  document.addEventListener('click', event => {
    const el = event.target.closest('button,[data-objective],[data-microscope-slide]');
    if (!el) return;
    if (el.id === 'saveEquipmentSelection') {
      const lab = labs.find(item => item.id === activeLabId); if (!lab) return;
      if (lab._answerKeyHidden) {
        const attempt = getAttempt(lab.id);
        window.learningAnalytics?.assessLab(lab.id, attempt).then(result => {
          const count = Number(result.errorCounts?.equipment) || 0;
          setActiveIssue(lab.id, 'equipment', count > 0);
          if (count) requestMentor(lab, 'equipment', result.extraEquipmentCount ? 'wrong_selection' : 'missing_item', 'Құрал-жабдық таңдауыңызды сақтадыңыз. Өз таңдауыңызды және тәжірибе мақсатын қайта салыстырыңыз.', { errorCount: count });
        }).catch(() => {});
        return;
      }
      const result = originalEvaluateLab(lab, getAttempt(lab.id));
      const hasIssue = result.extraEquipment.length + result.missingEquipment.length > 0;
      setActiveIssue(lab.id, 'equipment', hasIssue);
      if (hasIssue) requestMentor(lab, 'equipment', result.extraEquipment.length ? 'wrong_selection' : 'missing_item', 'Құрал-жабдық таңдауыңызды сақтадыңыз. Эталондық критерий бойынша тағы бір рет қарап шығыңыз.', { errorCount: Math.max(1, result.extraEquipment.length + result.missingEquipment.length) });
    }
    if (el.id === 'checkLab') {
      const lab = labs.find(item => item.id === activeLabId); if (lab) finalizeLabCoach(lab);
    }
    if (el.dataset.stepMove) {
      const lab = labs.find(item => item.id === activeLabId);
      if (lab && stepIssue(lab, getAttempt(lab.id))) requestMentor(lab, 'steps', 'wrong_order', 'Тізбектегі әр кезеңнің алдындағы және кейінгі қадаммен байланысын тексер.', { cooldown: 8000 });
      else if (lab) setActiveIssue(lab.id, 'steps', false);
    }
    if (el.hasAttribute('data-light-toggle')) { const lab = labs.find(item => item.id === activeMicroscopeLabId); if (lab) sendMicroscopeControlCoach(lab, 'Жарық баптауын өзгерттің'); }
    if (el.dataset.focusStep) { const lab = labs.find(item => item.id === activeMicroscopeLabId); if (lab) sendMicroscopeControlCoach(lab, 'Фокусты реттедің'); }
    if (el.dataset.stageMove) { const lab = labs.find(item => item.id === activeMicroscopeLabId); if (lab) sendMicroscopeControlCoach(lab, 'Заттық үстелді жылжыттың'); }
    if (el.dataset.startLinkedQuiz) {
      const quiz = quizzes.find(item => item.id === el.dataset.startLinkedQuiz);
      if (quiz) { closeAssignment(); activeQuizId = quiz.id; quizResponses = {}; page = 'quiz-do'; render(); }
    }
    if (el.id === 'submitMicroAnalysis') storeMicroscopeAnswers();
    if (el.dataset.objective === '40x' || el.dataset.objective === '100x') {
      const lab = labs.find(item => item.id === activeMicroscopeLabId); if (lab) setTimeout(() => sendMicroscopeCoach(lab, 'Микрофотосуретті жоғары үлкейтуде талдап, көріністің сапасына назар аудар.'), 250);
    }
    if (el.dataset.microscopeSlide !== undefined) {
      const lab = labs.find(item => item.id === activeMicroscopeLabId); if (lab) setTimeout(() => sendMicroscopeCoach(lab, 'Жаңа препаратты қарағанда бактериялардың пішіні, орналасуы және боялуы туралы өз бақылауыңды жаз.'), 250);
    }
    if (el.id === 'submitQuiz') {
      const quizId = activeQuizId;
      setTimeout(() => {
        const quiz = quizzes.find(item => item.id === quizId), attempt = quizAttempts[quizId], lab = labs.find(item => item.id === quiz?.labId);
        if (!quiz || !attempt || !lab) return;
        const labAttempt = getAttempt(lab.id);
        if (labAttempt.result) refreshLabGrade(lab, labAttempt);
        attempts[lab.id] = labAttempt; saveState();
        const wrong = Math.max(0, Number(attempt.total) - Number(attempt.score));
        if (wrong) requestMentor(lab, 'questions', 'incorrect_answer', 'Бақылау сұрақтарының кейбір жауабын жұмыстың мақсаты мен нұсқаулығына сүйеніп қайта қарап шық.', { errorCount: wrong });
      }, 0);
    }
  });

  document.addEventListener('submit', event => {
    if (event.target.id === 'labForm') {
      const safety = document.getElementById('labSafetyCriteria');
      const micro = document.getElementById('labMicroscopeCriteria');
      if (safety && !safety.value.trim()) safety.value = defaultSafety.map(item => item.text).join('\n');
      if (micro && !micro.value.trim()) micro.value = defaultMicro.map(item => item.label + ' | ' + item.answers.join('; ')).join('\n');
    }
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('#submitMicroAnalysis');
    if (button) event.preventDefault();
  }, true);

  document.addEventListener('input', event => {
    if (event.target.matches('[data-micro-answer]')) {
      const lab = labs.find(item => item.id === activeMicroscopeLabId), attempt = lab && getAttempt(lab.id);
      if (lab && attempt.microscopeAnswers) attempt.microscopeAnswers[event.target.dataset.microAnswer] = event.target.value;
    }
  });
  document.addEventListener('change', event => {
    if (!event.target.matches('[data-microscope-control]')) return;
    const lab = labs.find(item => item.id === activeMicroscopeLabId);
    if (lab) sendMicroscopeControlCoach(lab, 'Микроскоп баптауын өзгерттің');
  });
  document.addEventListener('pointerup', event => {
    if (!event.target.closest?.('#microscopeEyepiece')) return;
    const lab = labs.find(item => item.id === activeMicroscopeLabId);
    if (lab) sendMicroscopeControlCoach(lab, 'Заттық үстелді жылжыттың');
  });

  window.onlineLabScoring = {
    getWeights() { return { ...weights }; },
    setWeights(next) {
      const keys = Object.keys(weights);
      if (!next || keys.some(key => !Number.isInteger(Number(next[key])) || Number(next[key]) < 0 || Number(next[key]) > 100) || keys.reduce((sum, key) => sum + Number(next[key]), 0) !== 100) return false;
      keys.forEach(key => { weights[key] = Number(next[key]); });
      return true;
    }
  };

  window.addEventListener('storage', () => {
    if (role === 'student' && page === 'microscope') setTimeout(addMicroscopeAnalysis, 0);
  });
})();
