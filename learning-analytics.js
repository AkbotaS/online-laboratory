(() => {
  const outboxKey = 'online-lab-learning-outbox-v1';
  const statePrefix = 'online-lab-learning-state-v1:';
  const originalRender = render;
  let user = null;
  let authReady = false;
  let health = { adminConfigured: false, aiConfigured: false };
  let outbox = [];
  let sessionStates = {};
  let filters = { studentId: '', groupId: '', labId: '', from: '', to: '' };
  let lastPayload = null;
  let demoMode = false;
  let loading = false;
  let dashboardError = '';
  let noticeTimer = null;
  let locale = /^ru/i.test(navigator.language || '') ? 'ru' : 'kk';
  let curriculumRevision = 0;
  let curriculumSyncQueue = Promise.resolve();
  let applyingCurriculum = false;
  let managedStudents = [];
  let managedStudentsLoaded = false;
  let studentSearch = '';
  let editingStudent = null;
  let importReport = [];

  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const uuid = () => globalThis.crypto?.randomUUID?.() || 'evt_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12);
  const safeNumber = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
  const pointsLabel = value => value === null || value === undefined ? '—' : Math.round(value * 10) / 10;
  let categoryNames = { equipment: 'Құрал-жабдықтар', steps: 'Жұмыс барысы', safety: 'Қауіпсіздік', microscope: 'Микроскопиялық талдау', questions: 'Бақылау сұрақтары' };
  let eventNames = {
    lab_started: 'Зертханалық жұмыс басталды', lab_resumed: 'Зертханалық жұмыс жалғасты', lab_completed: 'Зертханалық жұмыс аяқталды',
    equipment_selected: 'Құрал таңдалды', equipment_saved: 'Құрал таңдауы сақталды', step_selected: 'Жұмыс кезеңі таңдалды', step_reordered: 'Кезең реті өзгертілді',
    safety_checked: 'Қауіпсіздік талабы белгіленді', quiz_started: 'Тапсырма басталды', answer_submitted: 'Жауап тексерілді', error_detected: 'Қате тіркелді',
    hint_shown: 'Көмекші кеңесі көрсетілді', error_resolved: 'Қате түзетілді', stage_started: 'Кезең басталды', stage_completed: 'Кезең аяқталды',
    microscope_analysis: 'Микроскопиялық талдау жіберілді', microscope_control: 'Микроскоп бапталды', score_calculated: 'Баға есептелді', result_changed: 'Нәтиже өзгертілді'
  };
  const ruText = {
    'Жүйеге кіру': 'Вход в лабораторию', 'Оқу нәтижелерін көру үшін оқытушы берген аккаунтпен кіріңіз.': 'Войдите с аккаунтом, который выдал преподаватель, чтобы увидеть учебные результаты.', 'Логин': 'Логин', 'Құпиясөз': 'Пароль', 'Кіру →': 'Войти →',
    'Бірінші іске қосу: серверде ADMIN_USERNAME және ADMIN_PASSWORD орнатыңыз. Қауіпсіздік үшін дайын құпиясөз кодқа енгізілмейді.': 'Первый запуск: задайте ADMIN_USERNAME и ADMIN_PASSWORD на сервере. Пароль не хранится в коде.',
    'Аккаунтты оқытушы береді. Егер кіру деректеріңіз болмаса, оқытушыға хабарласыңыз.': 'Данные для входа выдаёт преподаватель. Если аккаунта нет, обратитесь к преподавателю.',
    'Оқу аналитикасы': 'Учебная аналитика', 'Менің оқу нәтижелерім': 'Мои результаты', 'Зертханалық жұмыстағы тіркелген әрекеттер мен нәтижелер.': 'Записанные действия и результаты лабораторных работ.', 'Тек сіздің аккаунтыңызға тіркелген оқу оқиғалары мен нәтижелер.': 'Здесь только события и результаты, записанные для вашего аккаунта.',
    'Демоны жабу': 'Закрыть демо', 'Деморежим': 'Демо режим', 'CSV жүктеу': 'Скачать CSV', 'Excel жүктеу': 'Скачать Excel', 'ДЕМО-РЕЖИМ · Төмендегі синтетикалық сандар тек интерфейс көрсетуге арналған. Олар оқиғалар журналына жазылмайды және нақты студент нәтижесі емес.': 'ДЕМО РЕЖИМ · Синтетические числа ниже показывают интерфейс. Они не записываются в журнал и не являются результатами студентов.',
    'Студент': 'Студент', 'Топ': 'Группа', 'Барлық студент': 'Все студенты', 'Барлық топ': 'Все группы', 'Зертханалық жұмыс': 'Лабораторная работа', 'Барлық жұмыстар': 'Все работы', 'Басталу күні': 'С даты', 'Аяқталу күні': 'По дату', 'Қолдану': 'Применить', 'Тазарту': 'Сбросить',
    'Орташа балл': 'Средний балл', 'Аяқталған жұмыс': 'Завершено работ', 'Сіздің аккаунтыңыз': 'Ваш аккаунт', 'Студенттер': 'Студенты', 'OpenAI кеңестері': 'Подсказки OpenAI', 'Түзету үлесі': 'Доля исправлений', 'соңғы нәтиже': 'последних результатов', 'Тіркелген аяқтау оқиғалары': 'Записанные завершения', 'Сүзгіге сай студенттер': 'Студенты по фильтру', 'Жалпы кеңес:': 'Общие подсказки:','кеңестелген қате': 'ошибок с подсказками',
    'Уақыт бойынша балл динамикасы': 'Динамика баллов', 'Апталық орташа; әр нүкте нақты нәтижелердің санымен есептеледі.': 'Средний балл за неделю; каждая точка рассчитана по указанному числу результатов.', 'Нәтижелер сақталғаннан кейін динамика көрінеді': 'Динамика появится после сохранения результатов', 'Деректер нүктелерінің саны:': 'Число результатов на графике:',
    'Бағалардың бөлінуі': 'Распределение оценок', 'Әр студент пен зертханалық жұмыс үшін тек соңғы баға есепке алынады.': 'Для каждой пары «студент — лабораторная» учитывается последняя оценка.', 'Бағалау критерийлері': 'Критерии оценивания', 'Жалпы рубрика: құрал 15, кезең реті 30, қауіпсіздік 15, микроскоп 20, сұрақтар 20 балл.': 'Рубрика: оборудование — 15, порядок этапов — 30, безопасность — 15, микроскоп — 20, вопросы — 20 баллов.', 'Жиі кездескен қателер': 'Частые ошибки', 'Қате оқиғаларының жинақталған саны; бір студент қайталап жіберген қатесі де есептеледі.': 'Суммарное число событий с ошибками, включая повторные ошибки студента.',
    'ИИ кеңесінің нәтижелілігі': 'Результативность подсказок ИИ', 'OpenAI кеңесінен кейін студенттің қатені өздігінен түзеткен үлесі.': 'Доля ошибок, которые студент самостоятельно исправил после подсказки OpenAI.', 'ИИ кеңесі': 'С подсказкой ИИ', 'Кеңессіз': 'Без подсказки', 'Сипаттамалық салыстыру; ол себеп-салдарды дәлелдемейді.': 'Описательное сравнение; оно не доказывает причинно-следственную связь.', 'Кеңесті түзету пайызы = кеңестен кейін өздігінен түзетілген бірегей қателер / OpenAI кеңесі көрсетілген бірегей қателер × 100.': 'Доля исправлений = уникальные ошибки, исправленные после подсказки / уникальные ошибки с подсказкой OpenAI × 100.',
    'Қателер мен кеңестер': 'Ошибки и подсказки', 'Сүзгіге сай соңғы оқиғалар.': 'Последние события по выбранным фильтрам.', 'Соңғы студент нәтижелері': 'Последние результаты студентов', 'Менің нәтижелерім': 'Мои результаты', 'Нәтижелер серверде тіркелген; экспорттағы студент белгілері әдепкіде псевдонимделеді.': 'Результаты записываются на сервер; при экспорте студенты по умолчанию обозначены псевдонимами.',
    'Есептеу қағидасы: әр балл сайттағы оқытушы критерийлеріне сай бағдарламалық бағалаудан алынған. ИИ тек қатені түсіндіреді және кеңес береді; баға қоймайды. Шикі оқиғалар серверде қосымша жазылады, қорытынды көрсеткіштер сұрау кезінде есептеледі. Дереккөзі: оқиғалар журналы; көрсетілген кезең — серверге түскен күн.': 'Расчёт: оценки получены программной проверкой сайта по критериям преподавателя. ИИ объясняет ошибки и подсказывает, но не выставляет баллы. Исходные события дописываются в журнал, сводные показатели вычисляются при запросе. Период фильтруется по времени получения события сервером.',
    'Тіркелген аяқтау оқиғалары': 'Записанные завершения', 'Сүзгіге сай студенттер': 'Студенты по фильтру', 'Сіздің аккаунтыңыз': 'Ваш аккаунт', 'Жеке нәтижелер': 'Личные результаты', 'Жалпы кеңес:': 'Общие подсказки:', 'кеңестелген қате': 'ошибок с подсказками', 'Соңғы студент нәтижелері': 'Последние результаты студентов', 'Апталық орташа; әр нүкте нақты нәтижелердің санымен есептеледі.': 'Средний балл за неделю; каждая точка рассчитана по указанному числу результатов.', 'Нәтижелер серверде тіркелген; экспорттағы студент белгілері әдепкіде псевдонимделеді.': 'Результаты записываются на сервер; при экспорте студенты по умолчанию обозначены псевдонимами.', 'Құпиясөз кемінде 10 таңбадан тұруы керек; пароль хэштеліп сақталады.': 'Пароль должен содержать не менее 10 символов; сервер хранит только его хэш.',
    'Студент аккаунттары': 'Аккаунты студентов', 'Логин мен уақытша құпиясөзді оқытушы береді. Белсенді емес аккаунтқа кіруге болмайды.': 'Логин и временный пароль выдаёт преподаватель. В отключённый аккаунт войти нельзя.', 'Студенттің аты': 'Имя студента', 'Уақытша құпиясөз': 'Временный пароль', 'Аккаунт жасау': 'Создать аккаунт', '＋ Аккаунт жасау': '＋ Создать аккаунт', 'Құпиясөз кемінде 10 таңбадан тұруы керек; пароль хэштеліп сақталады.': 'Пароль должен содержать не менее 10 символов; сервер хранит только его хэш.', 'Аккаунттар әзірге жасалмаған.': 'Аккаунтов пока нет.', 'Нәтиже': 'Результаты', 'Құпиясөзді ауыстыру': 'Сменить пароль', 'Өшіру': 'Отключить', 'Қосу': 'Включить', 'өшіру': 'отключён',
    'Студент профилі ·': 'Профиль студента ·', 'Ағымдағы сүзгідегі жеке нәтижелер, қателер тарихы және кеңес қолдану деректері.': 'Личные результаты, история ошибок и подсказок по текущим фильтрам.', 'Ұсыныстар': 'Рекомендации', 'Күшті жақтары': 'Сильные стороны', 'Қате және кеңес тарихы': 'История ошибок и подсказок', 'Соңғы баға:': 'Последняя оценка:',
    'Бағалау салмақтары': 'Веса оценивания', 'Әр студент жұмысы үшін рубрикадағы ұпайлардың қосындысы 100 болуы керек. Өзгеріс серверде сақталады және кейінгі бағалауға қолданылады.': 'Сумма баллов рубрики должна быть равна 100. Изменение сохраняется на сервере и применяется к последующим оценкам.', 'Салмақтарды сақтау': 'Сохранить веса', 'Кезеңдер бойынша уақыт': 'Время по этапам', 'Әр кезеңге кеткен орташа уақыт; тек тіркелген кезең аяқтаулары есептеледі.': 'Среднее время на этап; учитываются только записанные завершения этапов.',
    'Әзірге дерек жоқ': 'Данных пока нет', 'Қате немесе кеңес тіркелген жоқ.': 'Ошибки или подсказки ещё не записаны.', 'Аяқталған жұмыс жоқ. Алдымен зертханалық жұмысты орындаңыз.': 'Завершённых работ пока нет. Сначала выполните лабораторную работу.', 'После первой завершённой лабораторной работы здесь появятся рекомендации по результатам.': 'Рекомендации появятся после первой завершённой лабораторной работы.', 'Деректерді жүктеу мүмкін болмады': 'Не удалось загрузить данные', 'Қайталау': 'Повторить', 'Демо-деректер экспортталмайды. Нақты тіркелген аналитиканы таңдаңыз.': 'Демо данные не экспортируются. Выберите реальные записанные данные.',
    'Жаңа уақытша құпиясөзді енгізіңіз (кемінде 10 таңба):': 'Введите новый временный пароль (не менее 10 символов):', 'Студент аккаунты жасалды. Логин мен құпиясөзді студентке қауіпсіз жеткізіңіз.': 'Аккаунт создан. Передайте студенту логин и пароль безопасным способом.', 'Құпиясөз жаңартылды.': 'Пароль изменён.', 'Аккаунт күйі жаңартылды.': 'Статус аккаунта изменён.', 'Қазақша': 'Казахский', 'Орысша': 'Русский',
    'Студенттер / Студенты': 'Студенты', 'Жаңа студент қосу': 'Добавить студента', 'Массовое создание': 'Массовое создание', 'Импортировать CSV': 'Импортировать CSV', 'Скачать шаблон': 'Скачать шаблон', 'Аккаунт ещё не созданы.': 'Аккаунты ещё не созданы.', 'Обновить список': 'Обновить список', 'Список студентов': 'Список студентов', 'Поиск по ФИО, логину или группе.': 'Поиск по ФИО, логину или группе.', 'Студенты не найдены по запросу.': 'По запросу студенты не найдены.', 'Изменить данные студента': 'Изменить данные студента', 'Сохранить изменения': 'Сохранить изменения', 'Отмена': 'Отмена', 'Временный пароль студент сменит при первом входе.': 'Студент сменит временный пароль при первом входе.', 'Загрузите CSV: ФИО, Группа, Логин, Временный пароль. Файл можно подготовить или сохранить в Excel как CSV UTF-8.': 'Загрузите CSV с колонками: ФИО, группа, логин и временный пароль. Таблицу можно сохранить из Excel в формате CSV UTF-8.', 'Активен': 'Активен', 'Заблокирован': 'Заблокирован', 'Заблокировать': 'Заблокировать', 'Разблокировать': 'Разблокировать', 'Сбросить пароль': 'Сбросить пароль', 'Удалить': 'Удалить', 'Файл CSV': 'Файл CSV', 'ФИО студента': 'ФИО студента', 'Учебная группа': 'Учебная группа', 'Временный пароль': 'Временный пароль', 'Сохранить аккаунт': 'Сохранить аккаунт', 'Импорт завершён': 'Импорт завершён'
  };
  const categoryNamesRu = { equipment: 'Оборудование', steps: 'Последовательность действий', safety: 'Безопасность', microscope: 'Анализ микроскопа', questions: 'Контрольные вопросы' };
  const eventNamesRu = { lab_started: 'Лабораторная работа начата', lab_resumed: 'Лабораторная работа продолжена', lab_completed: 'Лабораторная работа завершена', equipment_selected: 'Выбрано оборудование', equipment_saved: 'Выбор оборудования сохранён', step_selected: 'Выбран этап работы', step_reordered: 'Изменён порядок этапов', safety_checked: 'Отмечено правило безопасности', quiz_started: 'Задание начато', answer_submitted: 'Ответ проверен', error_detected: 'Зафиксирована ошибка', hint_shown: 'Показана подсказка', error_resolved: 'Ошибка исправлена', stage_started: 'Этап начат', stage_completed: 'Этап завершён', microscope_analysis: 'Отправлен анализ микроскопа', microscope_control: 'Настроен микроскоп', score_calculated: 'Баллы рассчитаны', result_changed: 'Результат изменён' };
  function setLocale(next) {
    locale = next === 'ru' ? 'ru' : 'kk'; categoryNames = locale === 'ru' ? categoryNamesRu : { equipment: 'Құрал-жабдықтар', steps: 'Жұмыс барысы', safety: 'Қауіпсіздік', microscope: 'Микроскопиялық талдау', questions: 'Бақылау сұрақтары' };
    eventNames = locale === 'ru' ? eventNamesRu : { lab_started: 'Зертханалық жұмыс басталды', lab_resumed: 'Зертханалық жұмыс жалғасты', lab_completed: 'Зертханалық жұмыс аяқталды', equipment_selected: 'Құрал таңдалды', equipment_saved: 'Құрал таңдауы сақталды', step_selected: 'Жұмыс кезеңі таңдалды', step_reordered: 'Кезең реті өзгертілді', safety_checked: 'Қауіпсіздік талабы белгіленді', quiz_started: 'Тапсырма басталды', answer_submitted: 'Жауап тексерілді', error_detected: 'Қате тіркелді', hint_shown: 'Көмекші кеңесі көрсетілді', error_resolved: 'Қате түзетілді', stage_started: 'Кезең басталды', stage_completed: 'Кезең аяқталды', microscope_analysis: 'Микроскопиялық талдау жіберілді', microscope_control: 'Микроскоп бапталды', score_calculated: 'Баға есептелді', result_changed: 'Нәтиже өзгертілді' };
    if (user) try { localStorage.setItem('online-lab-analytics-language:' + user.id, locale); } catch {}
  }
  function localize(root) {
    if (locale !== 'ru' || !root) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node;
    while ((node = walker.nextNode())) { const text = node.nodeValue, value = text.trim(), translated = ruText[value]; if (translated) node.nodeValue = text.replace(value, translated); }
    for (const element of root.querySelectorAll('[placeholder],[aria-label],[title]')) for (const attr of ['placeholder', 'aria-label', 'title']) if (element.hasAttribute(attr) && ruText[element.getAttribute(attr)]) element.setAttribute(attr, ruText[element.getAttribute(attr)]);
  }

  function persistOutbox() { try { localStorage.setItem(outboxKey, JSON.stringify(outbox.slice(-4000))); } catch {} }
  function persistSessionStates() { if (!user) return; try { localStorage.setItem(statePrefix + user.id, JSON.stringify(sessionStates)); } catch {} }
  function setNotice(text, bad = false) {
    let node = document.getElementById('laNotice');
    if (!node) { node = document.createElement('div'); node.id = 'laNotice'; node.className = 'la-notice'; document.body.appendChild(node); }
    node.textContent = text;
    node.className = 'la-notice ' + (bad ? 'bad' : '');
    node.classList.add('show');
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => node.classList.remove('show'), 3600);
  }
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(payload.error || 'Сервер сұрауды орындай алмады.'); error.status = response.status; throw error; }
    return payload;
  }
  function makeGate(message = '') {
    document.body.classList.remove('auth-ready');
    let gate = document.getElementById('authGate');
    if (!gate) {
      gate = document.createElement('section'); gate.id = 'authGate'; gate.className = 'auth-gate';
      gate.innerHTML = '<div class="auth-card"><div class="auth-brand"><svg class="auth-brand-mark" viewBox="0 0 48 52" fill="none"><path d="M16 4h16v4h-3v13.5l13 21.2A3.7 3.7 0 0 1 38.8 48H9.2a3.7 3.7 0 0 1-3.2-5.3l13-21.2V8h-3V4Z" stroke="currentColor" stroke-width="3"/><path d="M15 35h18l6 9H9l6-9Z" fill="#40c4ec"/></svg><span>Online Laboratory</span></div><h1>Жүйеге кіру</h1><p>Оқу нәтижелерін көру үшін оқытушы берген аккаунтпен кіріңіз.</p><form class="auth-form" id="authForm"><label>Логин<input name="username" autocomplete="username" required maxlength="40"></label><label>Құпиясөз<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><div class="auth-error" id="authError" role="alert">'+escape(message)+'</div><button class="primary-btn" type="submit">Кіру →</button></form><div class="auth-note" id="authSetupNote">Егер бұл бірінші іске қосу болса, серверде ADMIN_USERNAME және ADMIN_PASSWORD орнатыңыз. Оқытушы студент аккаунттарын жүйеге кіргеннен кейін жасайды.</div></div>';
      document.body.appendChild(gate);
      gate.querySelector('#authForm').addEventListener('submit', async event => {
        event.preventDefault(); const form = new FormData(event.currentTarget), errorNode = gate.querySelector('#authError'), button = event.currentTarget.querySelector('button');
        button.disabled = true; errorNode.textContent = '';
        try { const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); await activateUser(result.user); }
        catch (error) { errorNode.textContent = error.message + (error.status === 0 ? ' Серверге қосылуды тексеріңіз.' : ''); }
        finally { button.disabled = false; }
      });
    }
    gate.querySelector('#authError').textContent = message;
    gate.querySelector('#authSetupNote').textContent = health.adminConfigured ? 'Аккаунтты оқытушы береді. Егер кіру деректеріңіз болмаса, оқытушыға хабарласыңыз.' : 'Бірінші іске қосу: серверде ADMIN_USERNAME және ADMIN_PASSWORD орнатыңыз. Қауіпсіздік үшін дайын құпиясөз кодқа енгізілмейді.';
    localize(gate);
    return gate;
  }
  function makePasswordGate(message = '') {
    document.body.classList.remove('auth-ready');
    let gate = document.getElementById('authGate');
    if (!gate) { gate = document.createElement('section'); gate.id = 'authGate'; gate.className = 'auth-gate'; document.body.appendChild(gate); }
    gate.innerHTML = '<div class="auth-card"><div class="auth-brand"><span class="auth-brand-mark">🔐</span><span>Online Laboratory</span></div><h1>Уақытша құпиясөзді ауыстырыңыз</h1><p>Алғашқы кіруді аяқтау үшін жеке тұрақты құпиясөз орнатыңыз.</p><form class="auth-form" id="changePasswordForm"><label>Жаңа құпиясөз<input name="password" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><label>Құпиясөзді қайталаңыз<input name="passwordAgain" type="password" autocomplete="new-password" minlength="10" maxlength="200" required></label><div class="auth-error" id="authError" role="alert">' + escape(message) + '</div><button type="submit" class="primary-btn">Құпиясөзді сақтау</button></form><div class="auth-note">Кемінде 10 таңба. Құпиясөз серверде тек scrypt хэші түрінде сақталады.</div></div>';
    localize(gate);
    gate.querySelector('#changePasswordForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), password = String(form.get('password') || ''), again = String(form.get('passwordAgain') || ''), errorNode = gate.querySelector('#authError'), button = event.currentTarget.querySelector('button');
      if (password !== again) { errorNode.textContent = locale === 'ru' ? 'Пароли не совпадают.' : 'Құпиясөздер сәйкес емес.'; return; }
      button.disabled = true; errorNode.textContent = '';
      try { const result = await api('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ password }) }); await activateUser(result.user); }
      catch (error) { errorNode.textContent = error.message; }
      finally { button.disabled = false; }
    });
    return gate;
  }
  function installIdentity() {
    document.querySelector('.session-identity')?.remove();
    const actions = document.querySelector('.top-actions'); if (!actions || !user) return;
    const identity = document.createElement('div'); identity.className = 'session-identity';
    const label = document.createElement('span'); label.textContent = user.role === 'admin' ? 'Оқытушы · ' + user.displayName : user.displayName + (user.groupId ? ' · ' + user.groupId : '');
    const logout = document.createElement('button'); logout.type = 'button'; logout.textContent = 'Шығу'; logout.addEventListener('click', logoutUser);
    identity.append(label, logout); actions.prepend(identity);
  }
  function readUserStores(nextUser) {
    user = nextUser;
    try { const savedLocale = localStorage.getItem('online-lab-analytics-language:' + user.id); if (savedLocale) locale = savedLocale; } catch {}
    setLocale(locale);
    role = user.role;
    attempts = user.role === 'student' ? loadJson(attemptKey + ':' + user.id, {}) : {};
    quizAttempts = user.role === 'student' ? loadJson(quizAttemptKey + ':' + user.id, {}) : {};
    if (!attempts || typeof attempts !== 'object' || Array.isArray(attempts)) attempts = {};
    if (!quizAttempts || typeof quizAttempts !== 'object' || Array.isArray(quizAttempts)) quizAttempts = {};
    filters = { studentId: '', groupId: '', labId: '', from: '', to: '' }; demoMode = false; curriculumRevision = 0;
    try { outbox = JSON.parse(localStorage.getItem(outboxKey) || '[]').filter(event => event && typeof event.localOwnerId === 'string'); } catch { outbox = []; }
    try { sessionStates = JSON.parse(localStorage.getItem(statePrefix + user.id) || '{}') || {}; } catch { sessionStates = {}; }
    if (user.role === 'admin') page = 'admin'; else page = 'home';
  }
  function applySharedCurriculum(shared) {
    if (!shared || !Array.isArray(shared.labs) || !Array.isArray(shared.quizzes) || Number(shared.revision) < curriculumRevision) return;
    applyingCurriculum = true;
    try {
      curriculumRevision = Number(shared.revision) || 0;
      labs = shared.labs; quizzes = shared.quizzes;
      try { localStorage.setItem(storageKey, JSON.stringify(labs)); localStorage.setItem(quizStorageKey, JSON.stringify(quizzes)); } catch {}
      if (shared.assistantConfig && typeof shared.assistantConfig === 'object') {
        assistantConfig = { ...defaultAssistantConfig, ...shared.assistantConfig, faqs: Array.isArray(shared.assistantConfig.faqs) ? shared.assistantConfig.faqs : defaultAssistantConfig.faqs };
        try { localStorage.setItem(assistantStoreKey, JSON.stringify(assistantConfig)); } catch {}
      }
      scrubStudentCaches();
    } finally { applyingCurriculum = false; }
    if (authReady && page !== 'analytics') { render(); if (assignmentModal.classList.contains('open') && activeLabId) renderLabDetail(); }
  }
  function stripLocalAnswerKeys() {
    labs = (Array.isArray(labs) ? labs : []).map(lab => ({
      ...lab, _answerKeyHidden: true,
      equipment: (lab.equipment || []).map(({ correct, ...item }) => item),
      steps: (lab.steps || []).map(({ correct, order, ...item }) => item),
      microscopeCriteria: (lab.microscopeCriteria || []).map(({ answers, ...item }) => item),
      aiGuidance: '', errorVariants: [], scoreRules: undefined
    }));
    quizzes = (Array.isArray(quizzes) ? quizzes : []).map(quiz => ({
      ...quiz, _answerKeyHidden: true,
      questions: (quiz.questions || []).map(({ correct, answers, ...question }) => question)
    }));
    assistantConfig = { ...defaultAssistantConfig, enabled: assistantConfig.enabled !== false, name: assistantConfig.name || 'ЖИ-көмекші', greeting: assistantConfig.greeting || '', fallback: assistantConfig.fallback || '', faqs: [] };
    try { localStorage.setItem(storageKey, JSON.stringify(labs)); localStorage.setItem(quizStorageKey, JSON.stringify(quizzes)); localStorage.setItem(assistantStoreKey, JSON.stringify(assistantConfig)); } catch {}
  }
  function scrubStudentCaches() {
    if (user?.role !== 'student') return;
    let attemptsChanged = false, quizzesChanged = false;
    for (const attempt of Object.values(attempts || {})) {
      if (attempt?.result && attempt.result.serverVerified !== true) { attempt.result = null; delete attempt.microscopeReview; attemptsChanged = true; }
    }
    for (const [quizId, attempt] of Object.entries(quizAttempts || {})) {
      if (attempt && attempt.serverVerified !== true) { delete quizAttempts[quizId]; quizzesChanged = true; }
    }
    if (attemptsChanged) saveState();
    if (quizzesChanged) try { localStorage.setItem(quizAttemptKey + ':' + user.id, JSON.stringify(quizAttempts)); } catch {}
  }
  function syncCurriculum(nextLabs = labs, nextQuizzes = quizzes, nextAssistant = assistantConfig) {
    if (!user || user.role !== 'admin' || applyingCurriculum) return Promise.resolve(false);
    const snapshot = { labs: nextLabs, quizzes: nextQuizzes, assistantConfig: nextAssistant };
    const job = curriculumSyncQueue.then(async () => {
      if (!user || user.role !== 'admin') return false;
      const result = await api('/api/curriculum', { method: 'PUT', body: JSON.stringify(snapshot) });
      curriculumRevision = Math.max(curriculumRevision, Number(result.revision) || 0); return true;
    });
    curriculumSyncQueue = job.catch(() => false);
    return job.catch(error => { setNotice('Ортақ мазмұн серверге сақталмады: ' + error.message, true); return false; });
  }
  async function loadSharedCurriculum() {
    try {
      const shared = await api('/api/curriculum');
        if (Number(shared.revision) > 0 || user?.role === 'student') applySharedCurriculum(shared);
      else if (user?.role === 'admin') await syncCurriculum(labs, quizzes, assistantConfig);
      curriculumRevision = Math.max(curriculumRevision, Number(shared.revision) || 0);
    } catch (error) {
      if (user?.role === 'student') { stripLocalAnswerKeys(); scrubStudentCaches(); }
      setNotice('Ортақ зертханалық жұмыстарды жүктеу мүмкін болмады: ' + error.message, true);
    }
  }
  setInterval(async () => {
    if (!user || !authReady) return;
    try { const meta = await api('/api/curriculum/meta'); if (Number(meta.revision) > curriculumRevision) applySharedCurriculum(await api('/api/curriculum')); } catch {}
  }, 30_000);
  async function activateUser(nextUser) {
    if (nextUser.mustChangePassword) { user = nextUser; role = nextUser.role; makePasswordGate(); return; }
    readUserStores(nextUser);
    await loadSharedCurriculum();
    try { const settings = await api('/api/learning/settings'); window.onlineLabScoring?.setWeights(settings.rubricWeights); } catch {}
    authReady = true;
    document.getElementById('authGate')?.remove(); document.body.classList.add('auth-ready'); installIdentity();
    render(); flushOutbox();
  }
  async function logoutUser() {
    if (user?.role === 'student') await flushOutbox();
    await api('/api/auth/logout', { method: 'POST', body: '{}' }).catch(() => {});
    user = null; authReady = false; role = 'student'; attempts = {}; quizAttempts = {}; sessionStates = {}; lastPayload = null;
    installIdentity(); makeGate();
  }
  async function initializeAuth() {
    try { health = await api('/api/health'); } catch { health = { adminConfigured: false, aiConfigured: false }; }
    try { const result = await api('/api/auth/me'); await activateUser(result.user); }
    catch (error) { makeGate(error.status === 401 ? '' : 'Оқу аналитикасы серверіне қосылу мүмкін болмады. Сайтты node --env-file=.env server.mjs арқылы іске қосыңыз.'); }
  }

  function findLab(id) { return (Array.isArray(labs) ? labs : []).find(lab => lab.id === id); }
  function newSession(labId, title) {
    const now = new Date().toISOString();
    return sessionStates[labId] = { labId, title: title || findLab(labId)?.title || 'Зертханалық жұмыс', sessionId: uuid(), startedAt: now, activeStage: '', stageStartedAt: 0, stageDurations: {}, errors: 0, hints: 0, selfCorrections: 0, completed: false };
  }
  function sessionFor(labId, title, forceNew = false) {
    let current = sessionStates[labId];
    if (forceNew || !current) current = newSession(labId, title);
    if (title) current.title = title;
    return current;
  }
  function rawRecord(type, labId, data = {}, title = '', stage = '') {
    if (!user || user.role !== 'student' || demoMode || !labId) return null;
    const session = sessionFor(labId, title);
    const event = { eventId: uuid(), type, labId: String(labId), labTitle: session.title || title || '', sessionId: session.sessionId, stage: stage || session.activeStage || '', clientAt: new Date().toISOString(), data, localOwnerId: user.id };
    outbox.push(event); persistOutbox();
    if (outbox.length >= 1) flushOutbox();
    return event;
  }
  async function flushOutbox() {
    if (!user || user.role !== 'student' || !outbox.length || flushOutbox.busy) return;
    flushOutbox.busy = true;
    try {
      while (outbox.length && user?.role === 'student') {
        const indices = outbox.map((item, index) => item.localOwnerId === user.id ? index : -1).filter(index => index >= 0).slice(0, 50); if (!indices.length) break;
        const events = indices.map(index => { const { localOwnerId, ...event } = outbox[index]; return event; });
        try {
          const result = await api('/api/learning/events', { method: 'POST', body: JSON.stringify({ events }) });
          const completed = new Set((result.results || []).map(item => item.eventId));
          for (const index of indices.reverse()) if (completed.has(outbox[index]?.eventId)) outbox.splice(index, 1);
          persistOutbox();
          if (!completed.size) break;
        }
        catch (error) { if (error.status === 400 || error.status === 403) { for (const index of indices.reverse()) outbox.splice(index, 1); persistOutbox(); continue; } break; }
      }
    } finally { flushOutbox.busy = false; }
  }
  function record(type, labId, data = {}, title = '', stage = '') { return rawRecord(type, labId, data, title, stage); }
  function finishStage(labId, stageName = '') {
    const session = sessionStates[labId]; if (!session?.activeStage) return;
    const now = Date.now(), elapsed = Math.max(0, Math.min(3_600_000, now - (session.stageStartedAt || now)));
    session.stageDurations[session.activeStage] = (session.stageDurations[session.activeStage] || 0) + elapsed;
    session.lastStage = session.activeStage;
    rawRecord('stage_completed', labId, { stage: session.activeStage, durationMs: elapsed }, session.title, session.activeStage);
    session.activeStage = ''; session.stageStartedAt = 0; persistSessionStates();
  }
  function startStage(labId, stage, title = '') {
    if (!user || user.role !== 'student' || demoMode) return;
    const session = sessionFor(labId, title);
    if (session.activeStage === stage) return;
    if (session.activeStage) finishStage(labId);
    session.activeStage = stage; session.lastStage = stage; session.stageStartedAt = Date.now();
    rawRecord('stage_started', labId, { stage }, session.title, stage); persistSessionStates();
  }
  function beginLab(labId) {
    const lab = findLab(labId); if (!lab) return;
    const old = sessionStates[labId], session = sessionFor(labId, lab.title, Boolean(old?.completed));
    rawRecord(old && !old.completed ? 'lab_resumed' : 'lab_started', lab.id, { attemptNo: Math.max(1, Number(session.attemptNo) || 1) }, lab.title, 'equipment');
    session.attemptNo = Math.max(1, Number(session.attemptNo) || 0) + (old?.completed ? 1 : 0);
    session.startedAt = session.startedAt || new Date().toISOString();
    persistSessionStates(); startStage(lab.id, 'equipment', lab.title);
  }
  function scoreEvent(labId, changed = false) {
    const lab = findLab(labId), attempt = attempts[labId]; if (!lab || !attempt?.result) return;
    const result = attempt.result, rubric = {};
    for (const [key, value] of Object.entries(result.rubricScores || {})) rubric[key] = Number(value?.points ?? value) || 0;
    const errorCount = Number(result.totalErrors) || Object.values(result.errorCounts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    const session = sessionFor(labId, lab.title);
    session.errors = errorCount; session.hints = Number(result.hintsUsed) || Number(attempt.mentorStats?.hints) || 0;
    session.selfCorrections = Number(session.selfCorrections) || 0;
    finishStage(labId);
    const duration = Math.max(0, Date.now() - Date.parse(session.startedAt || Date.now()));
    if (changed) rawRecord('result_changed', labId, { completionState: 'updated', sessionDurationMs: duration }, lab.title, 'result');
    else rawRecord('lab_completed', labId, { completionState: 'complete', sessionDurationMs: duration }, lab.title, 'result');
    rawRecord('score_calculated', labId, {
      score: Number(result.score) || 0, scoreTotal: Number(result.total) || 100,
      rubricScores: rubric, rubricMax: Object.fromEntries(Object.entries(result.rubricScores || {}).map(([key, value]) => [key, Number(value?.max) || 0])), errorCount, totalHints: session.hints,
      independence: Number(result.independence) || 0,
      equipment: Number(result.rubricScores?.equipment?.points) || 0,
      steps: Number(result.rubricScores?.steps?.points) || 0,
      safety: Number(result.rubricScores?.safety?.points) || 0,
      microscope: Number(result.rubricScores?.microscope?.points) || 0,
      questions: Number(result.rubricScores?.questions?.points) || 0
    }, lab.title, 'result');
    session.completed = true;
    persistSessionStates();
  }
  function selectedData(lab, id, selected, kind) {
    const item = kind === 'equipment' ? (lab.equipment || []).find(row => row.id === id) : (lab.steps || []).find(row => row.id === id);
    return { itemId: id, itemName: item?.name || item?.text || '', selected: Boolean(selected) };
  }
  function queueAfter(callback) { setTimeout(() => { try { callback(); } catch {} }, 0); }
  function onChange(event) {
    if (!user || user.role !== 'student') return;
    const target = event.target;
    if (target.matches('[data-eq-choice]')) {
      const lab = findLab(activeLabId); if (!lab) return;
      startStage(lab.id, 'equipment', lab.title);
      const oldCount = (attempts[lab.id]?.equipment || []).length;
      rawRecord('equipment_selected', lab.id, { ...selectedData(lab, target.dataset.eqChoice, target.checked, 'equipment'), selectedCount: Math.max(0, oldCount + (target.checked ? 1 : -1)) }, lab.title, 'equipment');
    } else if (target.matches('[data-step-choice]')) {
      const lab = findLab(activeLabId); if (!lab) return;
      startStage(lab.id, 'steps', lab.title);
      rawRecord('step_selected', lab.id, { ...selectedData(lab, target.dataset.stepChoice, target.checked, 'steps'), selectedCount: (attempts[lab.id]?.steps || []).length + (target.checked ? 1 : -1) }, lab.title, 'steps');
    } else if (target.matches('[data-safety-check]')) {
      const lab = findLab(activeLabId); if (!lab) return;
      startStage(lab.id, 'safety', lab.title);
      queueAfter(() => rawRecord('safety_checked', lab.id, { itemId: target.dataset.safetyCheck, selected: target.checked, correct: target.checked }, lab.title, 'safety'));
    }
  }
  function onClick(event) {
    if (!user || user.role !== 'student') return;
    const element = event.target.closest('button,[data-open-lab],[data-start-quiz],[data-start-linked-quiz],[data-objective],[data-microscope-slide]'); if (!element) return;
    if (element.dataset.openLab) { beginLab(element.dataset.openLab); return; }
    if (element.id === 'saveEquipmentSelection') {
      const lab = findLab(activeLabId); if (!lab) return;
      queueAfter(() => {
        const result = lab._answerKeyHidden ? null : (attempts[lab.id]?.result || evaluateLab(lab, attempts[lab.id] || {}));
        const selected = attempts[lab.id]?.equipment || [];
        const correct = selected.filter(id => lab.equipment?.find(item => item.id === id)?.correct).length;
        rawRecord('equipment_saved', lab.id, { selectedCount: selected.length, ...(result ? { correctCount: correct, incorrectCount: Math.max(0, selected.length - correct) } : {}) }, lab.title, 'equipment');
        finishStage(lab.id); startStage(lab.id, 'steps', lab.title);
        if (result && (result.extraEquipment?.length || result.missingEquipment?.length)) sessionFor(lab.id).errors += result.extraEquipment.length + result.missingEquipment.length;
      }); return;
    }
    if (element.dataset.stepMove) {
      const lab = findLab(activeLabId); if (!lab) return;
      startStage(lab.id, 'steps', lab.title);
      queueAfter(() => rawRecord('step_reordered', lab.id, { order: [...(attempts[lab.id]?.stepOrder || [])], selectedCount: (attempts[lab.id]?.stepOrder || []).length }, lab.title, 'steps')); return;
    }
    if (element.id === 'checkLab') {
      const labId = activeLabId; queueAfter(() => scoreEvent(labId)); return;
    }
    if (element.dataset.startQuiz || element.dataset.startLinkedQuiz) {
      const quizId = element.dataset.startQuiz || element.dataset.startLinkedQuiz;
      const quiz = quizzes.find(item => item.id === quizId); if (!quiz) return;
      const linked = findLab(quiz.labId), targetId = linked?.id || 'quiz-' + quiz.id;
      if (linked) startStage(linked.id, 'questions', linked.title);
      else { sessionFor(targetId, quiz.title, Boolean(sessionStates[targetId]?.completed)); startStage(targetId, 'questions', quiz.title); }
      rawRecord('quiz_started', targetId, { quizId, quizTitle: quiz.title }, linked?.title || quiz.title, 'questions'); return;
    }
    if (element.id === 'submitQuiz') {
      const quizId = activeQuizId;
      queueAfter(() => {
        const quiz = quizzes.find(item => item.id === quizId), result = quizAttempts[quizId]; if (!quiz || !result) return;
        const lab = findLab(quiz.labId), targetId = lab?.id || 'quiz-' + quiz.id, title = lab?.title || quiz.title;
        (result.review || []).forEach((answer, index) => rawRecord('answer_submitted', targetId, { questionId: quiz.questions[index]?.id || 'question-' + index, questionType: answer.type === 'text' ? 'text' : 'choice', answerCorrect: Boolean(answer.isCorrect), correct: Boolean(answer.isCorrect) }, title, 'questions'));
        if (lab && attempts[lab.id]?.result) scoreEvent(lab.id);
        else {
          finishStage(targetId);
          rawRecord('lab_completed', targetId, { completionState: 'quiz_submitted' }, title, 'questions');
          const weights = window.onlineLabScoring?.getWeights?.() || { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 }, ratio = (Number(result.score) || 0) / Math.max(1, Number(result.total) || 1);
          rawRecord('score_calculated', targetId, { score: Math.round(100 * ratio), scoreTotal: 100, rubricScores: { questions: weights.questions * ratio }, rubricMax: { questions: weights.questions }, totalHints: 0, independence: 100, errorCount: Math.max(0, Number(result.total) - Number(result.score)) }, title, 'result');
          sessionStates[targetId].completed = true; persistSessionStates();
        }
      }); return;
    }
    if (element.dataset.objective || element.dataset.microscopeSlide !== undefined || element.hasAttribute('data-light-toggle') || element.dataset.focusStep || element.dataset.stageMove || element.hasAttribute('data-oil-toggle')) {
      const lab = findLab(activeMicroscopeLabId); if (!lab) return;
      startStage(lab.id, 'microscope', lab.title);
      queueAfter(() => {
        const state = microscopeStateFor(lab);
        rawRecord('microscope_control', lab.id, { objective: state?.objective || '', light: state?.light ? 1 : 0, focus: state?.focus || 0, photoId: lab.micrographs?.[state?.photoIndex]?.id || '' }, lab.title, 'microscope');
      });
      return;
    }
    if (element.id === 'submitMicroAnalysis') {
      const lab = findLab(activeLabId); if (!lab) return;
      queueAfter(() => {
        const review = attempts[lab.id]?.microscopeReview || [], correct = review.filter(item => item.correct).length;
        rawRecord('microscope_analysis', lab.id, { totalCriteria: review.length, correctCriteria: correct, incorrectCount: Math.max(0, review.length - correct) }, lab.title, 'microscope');
      });
    }
  }
  document.addEventListener('change', onChange, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('pointerup', event => {
    if (!user || user.role !== 'student' || !event.target.closest('#microscopeEyepiece')) return;
    const lab = findLab(activeMicroscopeLabId); if (!lab) return;
    queueAfter(() => { const state = microscopeStateFor(lab); rawRecord('microscope_control', lab.id, { objective: state?.objective || '', light: state?.light ? 1 : 0, focus: state?.focus || 0, source: 'stage_drag' }, lab.title, 'microscope'); });
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (!user || user.role !== 'student') return;
    if (document.hidden) {
      for (const session of Object.values(sessionStates)) if (session?.activeStage) finishStage(session.labId);
      return;
    }
    if (assignmentModal.classList.contains('open') && activeLabId) {
      const lab = findLab(activeLabId), session = sessionStates[activeLabId]; if (lab) startStage(lab.id, session?.lastStage || 'equipment', lab.title);
    } else if (page === 'microscope' && activeMicroscopeLabId) {
      const lab = findLab(activeMicroscopeLabId); if (lab) startStage(lab.id, 'microscope', lab.title);
    } else if (page === 'quiz-do' && activeQuizId) {
      const quiz = quizzes.find(item => item.id === activeQuizId), lab = findLab(quiz?.labId);
      if (quiz) startStage(lab?.id || 'quiz-' + quiz.id, 'questions', lab?.title || quiz.title);
    }
  });

  function issueAnalytics(type, lab, category, data = {}) {
    if (!lab || !user || user.role !== 'student') return;
    record(type, lab.id, { errorCategory: category, ...data }, lab.title, category);
  }
  window.learningAnalytics = {
    get user() { return user; },
    get demoMode() { return demoMode; },
    record, startStage,
    issueDetected(lab, category, errorType, issueId, errorCount) { const state = sessionFor(lab.id, lab.title); state.errors = (state.errors || 0) + Math.max(1, Number(errorCount) || 1); persistSessionStates(); issueAnalytics('error_detected', lab, category, { errorType, issueId, errorCount: Math.max(1, Number(errorCount) || 1) }); },
    hintShown(lab, category, issueId, source, hintLevel) { if (source === 'openai') sessionFor(lab.id, lab.title).hints++; issueAnalytics('hint_shown', lab, category, { issueId, source, hintLevel }); persistSessionStates(); },
    issueResolved(lab, category, issueId, source, resolvedAfterHint) { if (resolvedAfterHint) { const session = sessionFor(lab.id, lab.title); session.selfCorrections++; persistSessionStates(); } issueAnalytics('error_resolved', lab, category, { issueId, source, resolvedAfterHint: Boolean(resolvedAfterHint) }); },
    scoreUpdated(labId) { scoreEvent(labId, true); },
    async assessLab(labId, attempt) {
      if (!user || user.role !== 'student') throw new Error('Студент аккаунты қажет.');
      const lab = findLab(labId); if (!lab) throw new Error('Зертханалық жұмыс табылмады.');
      const quizResponses = {};
      for (const quiz of quizzes.filter(item => item.labId === labId)) quizResponses[quiz.id] = quizAttempts[quiz.id]?.submittedAnswers || {};
      const response = await api('/api/learning/grade', { method: 'POST', body: JSON.stringify({ labId, attempt, quizResponses }) });
      return response.result;
    },
    async gradeLab(labId, attempt) {
      const hadResult = Boolean(attempt.result);
      const result = await this.assessLab(labId, attempt);
      const lab = findLab(labId);
      if (!lab) throw new Error('Зертханалық жұмыс табылмады.');
      
      attempt.result = result; attempts[labId] = attempt; saveState(); scoreEvent(labId, hadResult);
      return result;
    },
    async gradeQuiz(quizId, answers) {
      const response = await api('/api/learning/quiz-grade', { method: 'POST', body: JSON.stringify({ quizId, answers }) });
      return { ...response.result, serverVerified: true, submittedAnswers: { ...answers } };
    },
    syncCurriculum,
    flush: flushOutbox
  };
  setInterval(flushOutbox, 12000);
  window.addEventListener('online', flushOutbox);

  function dateText(value) { try { return new Date(value).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return value || '—'; } }
  function scoresFor(payload) { return payload?.summary?.latestScores || []; }
  function computeRecommendations(summary) {
    const ranked = (summary?.categoryPerformance || []).filter(item => Number.isFinite(item.average)).sort((a, b) => a.average - b.average);
    if (!ranked.length) return [locale === 'ru' ? 'После первой завершённой лабораторной работы здесь появятся рекомендации по результатам.' : 'Алғашқы зертханалық жұмыс аяқталғаннан кейін мұнда ұсыныстар көрсетіледі.'];
    const weakest = ranked[0];
    const names = { equipment: 'проверяйте назначение каждого инструмента перед сохранением выбора', steps: 'сверяйте порядок этапов до отправки результата', safety: 'отмечайте правила безопасности по мере их выполнения', microscope: 'описывайте форму, расположение и окраску отдельно', questions: 'перечитывайте вопрос и проверяйте ответ перед отправкой' };
    const result = locale === 'ru'
      ? ['Больше внимания уделите разделу «' + (categoryNames[weakest.category] || weakest.category) + '»: средний результат ' + pointsLabel(weakest.average) + ' из ' + weakest.max + ' по ' + weakest.n + ' попыткам.']
      : ['Көбірек назарды «' + (categoryNames[weakest.category] || weakest.category) + '» бөліміне аударыңыз: орташа ұпай ' + pointsLabel(weakest.average) + '/' + weakest.max + ', дерек саны ' + weakest.n + '.'];
    result.push(locale === 'ru' ? 'Следующий шаг: ' + ({ equipment: 'проверьте назначение каждого инструмента перед сохранением выбора', steps: 'сверьте порядок этапов перед отправкой результата', safety: 'отмечайте правила безопасности по мере выполнения', microscope: 'опишите форму, расположение и окраску отдельно', questions: 'перечитайте вопрос и проверьте ответ перед отправкой' }[weakest.category] || 'повторите этот раздел лабораторной работы') + '.' : 'Келесі қадам: ' + (names[weakest.category] || 'осы бөлімді қайталаңыз') + '.');
    return result;
  }
  function demoPayload() {
    const names = ['Демо студент 01', 'Демо студент 02', 'Демо студент 03', 'Демо студент 04', 'Демо студент 05'];
    const labsList = (Array.isArray(labs) ? labs : []).slice(0, 3);
    const fallbackLabs = labsList.length ? labsList : [{ id: 'demo-lab-1', title: 'Демонстрациялық жұмыс' }];
    const values = [56, 68, 74, 82, 91, 63, 78, 86, 72, 95, 67, 84, 59, 88, 76];
    const records = values.map((score, index) => {
      const lab = fallbackLabs[index % fallbackLabs.length], studentIndex = index % names.length;
      return { studentId: 'demo-' + studentIndex, studentName: names[studentIndex], username: '', groupId: 'DEMO', labId: lab.id, labTitle: lab.title, at: new Date(Date.now() - (14 - index) * 86400000).toISOString(), score, rubricScores: { equipment: score * .15, steps: score * .3, safety: score * .15, microscope: score * .2, questions: score * .2 }, hints: index % 4, independence: Math.max(0, 100 - (index % 4) * 20), errors: index % 3 };
    });
    const average = safeNumber(values.reduce((sum, value) => sum + value, 0) / values.length);
    const bands = [{ label: '0–59', count: values.filter(value => value < 60).length }, { label: '60–69', count: values.filter(value => value >= 60 && value < 70).length }, { label: '70–79', count: values.filter(value => value >= 70 && value < 80).length }, { label: '80–89', count: values.filter(value => value >= 80 && value < 90).length }, { label: '90–100', count: values.filter(value => value >= 90).length }];
    const weeks = new Map(); records.forEach(row => { const key = row.at.slice(0, 10); const values = weeks.get(key) || []; values.push(row.score); weeks.set(key, values); });
    const progress = [...weeks].map(([week, entries]) => ({ week, average: safeNumber(entries.reduce((a,b)=>a+b,0)/entries.length), n: entries.length }));
    const events = records.slice().reverse().map((row, index) => ({ id: 'demo-event-' + index, type: index % 3 ? 'error_detected' : 'hint_shown', studentId: row.studentId, studentName: row.studentName, groupId: row.groupId, labId: row.labId, labTitle: row.labTitle, receivedAt: row.at, data: { errorCategory: ['equipment', 'steps', 'safety'][index % 3], issueId: 'demo-issue-' + index, source: index % 2 ? 'openai' : 'fallback', resolvedAfterHint: index % 2 === 0 } }));
    return { summary: { sampleSize: records.length, studentCount: names.length, completionCount: records.length, averageScore: average, scoreDistribution: bands, frequentErrors: [{ category: 'steps', count: 8 }, { category: 'equipment', count: 6 }, { category: 'safety', count: 4 }], categoryPerformance: [{ category: 'equipment', average: 80, max: 100, n: records.length }, { category: 'steps', average: 73.3, max: 100, n: records.length }, { category: 'safety', average: 80, max: 100, n: records.length }, { category: 'microscope', average: 80, max: 100, n: records.length }, { category: 'questions', average: 75, max: 100, n: records.length }], stageDurations: [{ stage: 'equipment', averageMs: 200000, n: 15 }, { stage: 'steps', averageMs: 410000, n: 15 }, { stage: 'safety', averageMs: 90000, n: 8 }, { stage: 'microscope', averageMs: 380000, n: 10 }, { stage: 'questions', averageMs: 280000, n: 12 }], progress, ai: { aiHintCount: 19, fallbackHintCount: 7, hintedIssues: 14, independentlyResolvedIssues: 9, correctionRate: 64.3, supportComparison: { withAI: { n: 10, averageScore: 79.4 }, withoutAI: { n: 5, averageScore: 73.2 } } }, latestScores: records }, events, options: { students: names.map((name, index) => ({ id: 'demo-' + index, displayName: name, username: '', groupId: 'DEMO', active: true })), groups: ['DEMO'], labs: fallbackLabs } };
  }
  function filterQuery() {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value);
    return params.toString();
  }
  async function loadAnalytics() {
    if (!user || page !== 'analytics' || loading) return;
    if (demoMode) { lastPayload = demoPayload(); dashboardError = ''; drawAnalytics(); return; }
    loading = true; dashboardError = '';
    try {
      const path = user.role === 'admin' ? '/api/learning/admin' : '/api/learning/me';
      lastPayload = await api(path + (filterQuery() ? '?' + filterQuery() : ''));
      drawAnalytics();
    } catch (error) { dashboardError = error.message; drawAnalytics(); }
    finally { loading = false; }
  }
  function selectOptions(items, selected, placeholder, getValue = item => item.id, getLabel = item => item.displayName || item.title || item.name) {
    return '<option value="">' + escape(placeholder) + '</option>' + (items || []).map(item => '<option value="' + escape(getValue(item)) + '" ' + (String(getValue(item)) === String(selected) ? 'selected' : '') + '>' + escape(getLabel(item)) + '</option>').join('');
  }
  function heading(payload) {
    return '<div class="analytics-heading"><div><span class="eyebrow">LEARNING ANALYTICS</span><h1>' + (user.role === 'admin' ? 'Оқу аналитикасы' : 'Менің оқу нәтижелерім') + '</h1><p>' + (user.role === 'admin' ? 'Зертханалық жұмыстағы тіркелген әрекеттер мен нәтижелер.' : 'Тек сіздің аккаунтыңызға тіркелген оқу оқиғалары мен нәтижелер.') + '</p></div><div class="analytics-actions"><button type="button" class="lang-button" data-la-language="kk">ҚАЗ</button><button type="button" class="lang-button" data-la-language="ru">RU</button><button type="button" class="secondary-btn" data-la-demo>' + (demoMode ? 'Демоны жабу' : 'Деморежим') + '</button><button type="button" class="secondary-btn" data-la-csv>CSV жүктеу</button><button type="button" class="primary-btn" data-la-xlsx>Excel жүктеу</button></div></div>';
  }
  function filtersMarkup(options) {
    const groups = options?.groups || [], labsList = options?.labs || [], students = options?.students || [];
    return '<form class="analytics-filters" id="laFilters">' +
      (user.role === 'admin' ? '<label class="la-form">Студент<select name="studentId">' + selectOptions(students, filters.studentId, 'Барлық студент') + '</select></label><label class="la-form">Топ<select name="groupId">' + selectOptions(groups, filters.groupId, 'Барлық топ', item => item, item => item) + '</select></label>' : '') +
      '<label class="la-form">Зертханалық жұмыс<select name="labId">' + selectOptions(labsList, filters.labId, 'Барлық жұмыстар') + '</select></label><label class="la-form">Басталу күні<input type="date" name="from" value="' + escape(filters.from) + '"></label><label class="la-form">Аяқталу күні<input type="date" name="to" value="' + escape(filters.to) + '"></label><button class="primary-btn" type="submit">Қолдану</button><button class="secondary-btn" type="button" data-la-reset>Тазарту</button></form>';
  }
  function metric(label, value, detail = '') { return '<article class="analytics-card"><span>' + escape(label) + '</span><strong>' + escape(value) + '</strong><small>' + escape(detail) + '</small></article>'; }
  function bars(items, labelKey, valueKey, maxValue) {
    if (!items?.length) return '<div class="analytics-empty">Әзірге дерек жоқ</div>';
    const max = Math.max(1, maxValue || Math.max(...items.map(item => Number(item[valueKey]) || 0)));
    return '<div class="analytics-bars">' + items.map(item => { const value = Number(item[valueKey]) || 0; return '<div class="analytics-bar-row"><span>' + escape(item[labelKey]) + '</span><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + Math.max(0, Math.min(100, 100 * value / max)) + '%"></div></div><b>' + escape(pointsLabel(value)) + '</b></div>'; }).join('') + '</div>';
  }
  function graph() {
    return '<canvas class="analytics-chart" id="laProgressChart" aria-label="Уақыт бойынша орташа балл"></canvas>';
  }
  function drawGraph(points) {
    const canvas = document.getElementById('laProgressChart'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), dpr = Math.max(1, window.devicePixelRatio || 1), width = Math.max(280, rect.width), height = Math.max(160, rect.height);
    canvas.width = width * dpr; canvas.height = height * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, width, height);
    const pad = { left: 35, right: 12, top: 12, bottom: 29 }, plotW = width - pad.left - pad.right, plotH = height - pad.top - pad.bottom;
    ctx.font = '10px system-ui'; ctx.fillStyle = '#8295a8'; ctx.strokeStyle = '#e9f0f5'; ctx.lineWidth = 1;
    [0, 25, 50, 75, 100].forEach(value => { const y = pad.top + plotH - plotH * value / 100; ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke(); ctx.fillText(String(value), 4, y + 3); });
    if (!points.length) { ctx.fillStyle = '#8295a8'; ctx.fillText('Нәтижелер сақталғаннан кейін динамика көрінеді', pad.left + 8, pad.top + plotH / 2); return; }
    const series = points.slice(-12), coordinates = series.map((point, index) => ({ x: pad.left + (series.length < 2 ? plotW / 2 : plotW * index / (series.length - 1)), y: pad.top + plotH - plotH * Math.max(0, Math.min(100, Number(point.average) || 0)) / 100, label: point.week }));
    ctx.strokeStyle = '#1597d1'; ctx.lineWidth = 3; ctx.beginPath(); coordinates.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    coordinates.forEach(point => { ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.strokeStyle = '#1597d1'; ctx.lineWidth = 2; ctx.arc(point.x, point.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    coordinates.filter((_, index) => index === 0 || index === coordinates.length - 1 || index % Math.ceil(coordinates.length / 5) === 0).forEach(point => { ctx.fillStyle = '#8295a8'; ctx.fillText(point.label.slice(5), Math.max(0, point.x - 14), height - 8); });
    canvas.onpointermove = event => {
      const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, index = Math.max(0, Math.min(series.length - 1, Math.round((x - pad.left) / Math.max(1, plotW) * Math.max(0, series.length - 1))));
      const point = series[index]; if (point) canvas.title = point.week + ' · ' + pointsLabel(point.average) + '/100 · n=' + (point.n || 0);
    };
    canvas.onclick = event => {
      const box = canvas.getBoundingClientRect(), x = event.clientX - box.left, index = Math.max(0, Math.min(series.length - 1, Math.round((x - pad.left) / Math.max(1, plotW) * Math.max(0, series.length - 1))));
      const point = series[index]; if (!point) return;
      const end = new Date(point.week + 'T00:00:00Z'); end.setUTCDate(end.getUTCDate() + 6);
      filters.from = point.week; filters.to = end.toISOString().slice(0, 10); loadAnalytics();
    };
  }
  function scoreTable(scores) {
    if (!scores.length) return '<div class="analytics-empty">Аяқталған жұмыс жоқ. Алдымен зертханалық жұмысты орындаңыз.</div>';
    const rows = scores.slice().reverse().slice(0, 80).map((row, index) => '<tr><td>' + (user.role === 'admin' ? '<strong>' + escape(row.studentName || 'Студент ' + (index + 1)) + '</strong><br><span class="la-small">' + escape(row.groupId || '') + '</span>' : '<strong>Менің нәтижем</strong>') + '</td><td>' + escape(row.labTitle || '—') + '</td><td><strong>' + escape(row.score) + '/100</strong></td><td>' + escape(row.hints ?? 0) + '</td><td>' + escape(row.independence === null || row.independence === undefined ? '—' : row.independence + '%') + '</td><td>' + escape(dateText(row.at)) + '</td></tr>').join('');
    return '<div class="analytics-table-wrap"><table class="analytics-table"><thead><tr><th>' + (user.role === 'admin' ? 'Студент' : 'Жұмыс') + '</th><th>Зертханалық жұмыс</th><th>Ұпай</th><th>Кеңестер</th><th>Өздігінен</th><th>Күні</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
  }
  function activityMarkup(events) {
    const filtered = (events || []).filter(event => ['error_detected', 'hint_shown', 'error_resolved', 'answer_submitted', 'stage_completed'].includes(event.type)).slice().reverse().slice(0, 24);
    if (!filtered.length) return '<div class="analytics-empty">Қате немесе кеңес тіркелген жоқ.</div>';
    return '<div class="la-activity-list">' + filtered.map(event => {
      const category = categoryNames[event.data?.errorCategory] || event.data?.errorCategory || '';
      const detail = event.type === 'hint_shown' ? (event.data?.source === 'openai' ? (locale === 'ru' ? 'Подсказка OpenAI' : 'OpenAI кеңесі') : (locale === 'ru' ? 'Общая локальная подсказка' : 'Жалпы жергілікті кеңес')) : event.type === 'error_detected' ? category + (event.data?.errorType ? ' · ' + event.data.errorType : '') : event.type === 'error_resolved' ? category + (event.data?.resolvedAfterHint ? (locale === 'ru' ? ' · исправлено после подсказки' : ' · кеңестен кейін түзетілді') : (locale === 'ru' ? ' · исправлено самостоятельно' : ' · өздігінен түзетілді')) : event.type === 'stage_completed' ? (categoryNames[event.data?.stage || event.stage] || event.data?.stage || event.stage || '') + ' · ' + pointsLabel((Number(event.data?.durationMs) || 0) / 60000) + ' мин' : (event.data?.answerCorrect ? (locale === 'ru' ? 'Правильный ответ' : 'Дұрыс жауап') : (locale === 'ru' ? 'Неправильный ответ' : 'Қате жауап'));
      return '<div class="la-activity"><i></i><span><b>' + escape(eventNames[event.type] || event.type) + '</b> · ' + escape(detail) + '<br><span class="la-small">' + escape(event.labTitle || '') + '</span></span><small>' + escape(dateText(event.receivedAt)) + '</small></div>';
    }).join('') + '</div>';
  }
  function comparisonMarkup(ai) {
    const withAI = ai?.supportComparison?.withAI || { n: 0, averageScore: null }, without = ai?.supportComparison?.withoutAI || { n: 0, averageScore: null };
    return '<div class="analytics-bars"><div class="analytics-bar-row"><span>' + (locale === 'ru' ? 'С подсказкой OpenAI' : 'OpenAI кеңесі') + '</span><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + Math.max(0, Math.min(100, Number(withAI.averageScore) || 0)) + '%"></div></div><b>' + escape(withAI.averageScore === null ? '—' : pointsLabel(withAI.averageScore)) + '</b></div><div class="analytics-bar-row"><span>' + (locale === 'ru' ? 'Без подсказки OpenAI' : 'OpenAI кеңесінсіз') + '</span><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + Math.max(0, Math.min(100, Number(without.averageScore) || 0)) + '%"></div></div><b>' + escape(without.averageScore === null ? '—' : pointsLabel(without.averageScore)) + '</b></div></div><p class="la-small" style="margin-top:11px">' + (locale === 'ru' ? 'Выборка: с подсказкой OpenAI n=' + escape(withAI.n || 0) + ' попыток, без подсказки OpenAI n=' + escape(without.n || 0) + ' попыток. Сравнение описательное и не доказывает причинно-следственную связь.' : 'Үлгі: OpenAI кеңесімен n=' + escape(withAI.n || 0) + ' әрекет, OpenAI кеңесінсіз n=' + escape(without.n || 0) + ' әрекет. Сипаттамалық салыстыру; ол себеп-салдарды дәлелдемейді.') + '</p>';
  }
  function stageTimeMarkup(items) {
    if (!items?.length) return '<div class="analytics-empty">' + (locale === 'ru' ? 'Длительность этапов пока не записана.' : 'Кезең ұзақтығы әлі тіркелмеген.') + '</div>';
    const max = Math.max(1, ...items.map(item => Number(item.averageMs) || 0));
    return '<div class="analytics-bars">' + items.map(item => '<div class="analytics-bar-row"><span>' + escape(categoryNames[item.stage] || item.stage) + '</span><div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:' + Math.max(0, Math.min(100, 100 * (Number(item.averageMs) || 0) / max)) + '%"></div></div><b>' + escape(pointsLabel((Number(item.averageMs) || 0) / 60000)) + ' мин</b><small class="la-small">n=' + escape(item.n) + '</small></div>').join('') + '</div>';
  }
  function csvRows(text) {
    const source = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = source.split(/\r?\n/, 1)[0] || '';
    const delimiter = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = []; let row = [], field = '', quoted = false;
    for (let i = 0; i < source.length; i++) {
      const char = source[i];
      if (quoted && char === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = !quoted;
      else if (!quoted && char === delimiter) { row.push(field); field = ''; }
      else if (!quoted && (char === '\n' || char === '\r')) { if (char === '\r' && source[i + 1] === '\n') i++; row.push(field); if (row.some(cell => cell.trim())) rows.push(row); row = []; field = ''; }
      else field += char;
    }
    row.push(field); if (row.some(cell => cell.trim())) rows.push(row);
    if (rows.length < 2) throw new Error('CSV должен содержать строку заголовков и хотя бы одну запись.');
    const normalize = value => String(value || '').toLocaleLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]/gu, '');
    const headers = rows[0].map(normalize);
    const find = names => headers.findIndex(header => names.includes(header));
    const columns = {
      displayName: find(['фио', 'фиостудента', 'имя', 'фамилияимя', 'атыжөні', 'атыжони', 'студенттинаты', 'displayname', 'name']),
      groupId: find(['группа', 'учебнаягруппа', 'топ', 'group', 'groupid']),
      username: find(['логин', 'username', 'login']),
      password: find(['временныйпароль', 'пароль', 'құпиясөз', 'уақытшақұпиясөз', 'password', 'temporarypassword'])
    };
    if (Object.values(columns).some(index => index < 0)) throw new Error('Нужны столбцы: ФИО, Группа, Логин, Временный пароль.');
    return rows.slice(1).map(values => Object.fromEntries(Object.entries(columns).map(([key, index]) => [key, String(values[index] || '').trim()]))).filter(item => Object.values(item).some(Boolean));
  }
  function studentTableRows() {
    const query = studentSearch.trim().toLocaleLowerCase();
    const rows = managedStudents.filter(item => !query || [item.displayName, item.username, item.groupId].some(value => String(value || '').toLocaleLowerCase().includes(query)));
    return rows.length ? '<div class="analytics-table-wrap"><table class="analytics-table student-table"><thead><tr><th>ФИО студента</th><th>Учебная группа</th><th>Логин</th><th>Статус</th><th>Действия</th></tr></thead><tbody>' + rows.map(item => '<tr><td><strong>' + escape(item.displayName) + '</strong></td><td>' + escape(item.groupId) + '</td><td>' + escape(item.username) + '</td><td><span class="student-status ' + (item.active ? 'active' : 'blocked') + '">' + (item.active ? 'Активен' : 'Заблокирован') + '</span>' + (item.mustChangePassword ? '<small class="la-small"> · смена пароля при входе</small>' : '') + '</td><td><div class="student-actions"><button type="button" class="secondary-btn" data-la-edit-student="' + escape(item.id) + '">Изменить</button><button type="button" class="secondary-btn" data-la-password="' + escape(item.id) + '">Сбросить пароль</button><button type="button" class="secondary-btn" data-la-active="' + escape(item.id) + '" data-active="' + (!item.active) + '">' + (item.active ? 'Заблокировать' : 'Разблокировать') + '</button><button type="button" class="secondary-btn danger" data-la-delete-student="' + escape(item.id) + '">Удалить</button></div></td></tr>').join('') + '</tbody></table></div>' : '<div class="analytics-empty">' + (query ? 'По этому запросу студенты не найдены.' : 'Аккаунты ещё не созданы.') + '</div>';
  }
  function studentsPage() {
    const edit = editingStudent ? '<section class="analytics-panel student-edit-panel"><h2>Изменить данные студента</h2><form class="student-form-grid" id="laEditStudent"><label class="la-form">ФИО<input name="displayName" maxlength="120" required value="' + escape(editingStudent.displayName) + '"></label><label class="la-form">Учебная группа<input name="groupId" maxlength="60" required value="' + escape(editingStudent.groupId) + '"></label><label class="la-form">Логин<input name="username" pattern="[A-Za-z0-9._-]{3,40}" minlength="3" maxlength="40" required value="' + escape(editingStudent.username) + '"></label><div class="student-actions"><button type="submit" class="primary-btn">Сохранить изменения</button><button type="button" class="secondary-btn" data-la-cancel-edit>Отмена</button></div></form></section>' : '';
    const imported = importReport.length ? '<div class="student-import-report"><strong>Импорт завершён: добавлено ' + importReport.filter(item => item.ok).length + ', ошибок ' + importReport.filter(item => !item.ok).length + '.</strong>' + importReport.filter(item => !item.ok).slice(0, 20).map(item => '<div>Строка ' + escape(item.row) + ' (' + escape(item.username) + '): ' + escape(item.error) + '</div>').join('') + '</div>' : '';
    return '<div class="students-page"><div class="page-title-row"><div><span class="eyebrow">ӘКІМШІ ПАНЕЛІ</span><h1>Студенттер / Студенты</h1><p>Создавайте аккаунты, обновляйте данные и управляйте доступом студентов.</p></div><button type="button" class="secondary-btn" data-la-refresh-students>Обновить список</button></div>' +
      '<div class="analytics-grid student-management-grid"><section class="analytics-panel"><h2>Жаңа студент қосу</h2><p>Временный пароль студент сменит при первом входе.</p><form class="student-form-grid" id="laCreateStudent"><label class="la-form">ФИО студента<input name="displayName" maxlength="120" autocomplete="off" required></label><label class="la-form">Учебная группа<input name="groupId" maxlength="60" required></label><label class="la-form">Логин<input name="username" pattern="[A-Za-z0-9._-]{3,40}" minlength="3" maxlength="40" autocomplete="off" required></label><label class="la-form">Временный пароль<input name="password" type="password" minlength="10" maxlength="200" autocomplete="new-password" required></label><div class="student-actions"><button type="submit" class="primary-btn">Сохранить аккаунт</button></div><small class="la-small">Пароль от 10 символов. Сервер сохраняет только защищённый хэш.</small></form></section><section class="analytics-panel"><h2>Массовое создание</h2><p>Загрузите CSV: ФИО, Группа, Логин, Временный пароль. Файл можно подготовить или сохранить в Excel как CSV UTF-8.</p><form id="laStudentImport" class="student-import-form"><label class="la-form">Файл CSV<input type="file" name="file" accept=".csv,text/csv" required></label><div class="student-actions"><button type="submit" class="primary-btn">Импортировать CSV</button><button type="button" class="secondary-btn" data-la-template>Скачать шаблон</button></div></form>' + imported + '</section></div>' + edit +
      '<section class="analytics-panel"><div class="student-list-heading"><div><h2>Список студентов <span class="la-small">(' + managedStudents.length + ')</span></h2><p>Поиск по ФИО, логину или группе.</p></div><label class="la-form">Поиск<input id="studentSearch" type="search" value="' + escape(studentSearch) + '" placeholder="ФИО, логин или группа"></label></div>' + (managedStudentsLoaded ? studentTableRows() : '<div class="analytics-empty">Загружаю аккаунты…</div>') + '</section></div>';
  }
  function drawStudents() { drawNav(); content.innerHTML = studentsPage(); localize(content); }
  async function loadManagedStudents() {
    if (!user || user.role !== 'admin') return;
    try { const result = await api('/api/admin/students'); managedStudents = result.students || []; managedStudentsLoaded = true; if (page === 'students') drawStudents(); }
    catch (error) { setNotice(error.message, true); }
  }
  function rubricSettingsPanel() {
    const weights = window.onlineLabScoring?.getWeights?.() || { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 };
    const items = Object.keys(weights).map(key => [key, categoryNames[key] || key]);
    return '<section class="analytics-panel"><h2>Бағалау салмақтары</h2><p>Әр студент жұмысы үшін рубрикадағы ұпайлардың қосындысы 100 болуы керек. Өзгеріс серверде сақталады және кейінгі бағалауға қолданылады.</p><form class="la-form" id="laWeights"><div class="la-weight-grid">' + items.map(([key, label]) => '<label>' + escape(label) + '<input type="number" name="' + key + '" min="0" max="100" step="1" value="' + escape(weights[key]) + '" required></label>').join('') + '</div><div class="la-weight-total" id="laWeightTotal">' + (locale === 'ru' ? 'Сумма: 100 / 100' : 'Жиыны: 100 / 100') + '</div><button type="submit" class="primary-btn">' + (locale === 'ru' ? 'Сохранить веса' : 'Салмақтарды сақтау') + '</button></form></section>';
  }
  function individualCard(scores, summary) {
    if (user.role !== 'admin' || !filters.studentId) return '';
    const student = lastPayload?.options?.students?.find(item => item.id === filters.studentId);
    const result = scores[scores.length - 1];
    const recommendation = computeRecommendations(summary);
    return '<section class="analytics-panel la-detail"><div><h2>Студент профилі · ' + escape(student?.displayName || result?.studentName || 'Студент') + '</h2><p>Ағымдағы сүзгідегі жеке нәтижелер, қателер тарихы және кеңес қолдану деректері.</p></div><div class="analytics-grid"><div><h2>Ұсыныстар</h2>' + recommendation.map(text => '<div class="la-tip">' + escape(text) + '</div>').join('') + '</div><div><h2>Күшті жақтары</h2>' + bars((summary.categoryPerformance || []).slice().sort((a, b) => (b.average || 0) - (a.average || 0)).slice(0, 2).map(item => ({ label: categoryNames[item.category] || item.category, value: item.average || 0 })), 'label', 'value', 100) + '</div></div><h2>Қате және кеңес тарихы</h2>' + activityMarkup(lastPayload?.events || []) + (result ? '<p class="la-small">Соңғы баға: ' + escape(result.score) + '/100 · ' + escape(dateText(result.at)) + '</p>' : '') + '</section>';
  }
  function drawAnalytics() {
    if (page !== 'analytics' || !user) return;
    drawNav();
    if (dashboardError) {
      content.innerHTML = '<div class="analytics-wrap">' + heading(lastPayload || {}) + '<div class="analytics-empty"><b>Деректерді жүктеу мүмкін болмады</b><br>' + escape(dashboardError) + '<br><button class="secondary-btn" data-la-refresh style="margin-top:12px">Қайталау</button></div></div>';
      return;
    }
    const payload = lastPayload || { summary: {}, events: [], options: {} }, summary = payload.summary || {}, scores = scoresFor(payload), ai = summary.ai || {};
    const avg = summary.averageScore === null || summary.averageScore === undefined ? '—' : pointsLabel(summary.averageScore) + '/100';
    const correction = ai.correctionRate === null || ai.correctionRate === undefined ? '—' : pointsLabel(ai.correctionRate) + '%';
    const cards = '<div class="analytics-cards">' + metric('Орташа балл', avg, (summary.sampleSize || 0) + ' соңғы нәтиже') + metric('Аяқталған жұмыс', summary.completionCount || 0, 'Тіркелген аяқтау оқиғалары') + metric(user.role === 'admin' ? 'Студенттер' : 'Сіздің аккаунтыңыз', user.role === 'admin' ? (summary.studentCount || 0) : '1', user.role === 'admin' ? 'Сүзгіге сай студенттер' : user.groupId || 'Жеке нәтижелер') + metric('OpenAI кеңестері', ai.aiHintCount || 0, (locale === 'ru' ? 'Общие подсказки: ' : 'Жалпы кеңес: ') + (ai.fallbackHintCount || 0)) + metric('Түзету үлесі', correction, (ai.independentlyResolvedIssues || 0) + ' / ' + (ai.hintedIssues || 0) + (locale === 'ru' ? ' ошибок с подсказками' : ' кеңестелген қате')) + '</div>';
    const distribution = bars(summary.scoreDistribution || [], 'label', 'count', Math.max(1, summary.sampleSize || 0));
    const categoryMax = Math.max(1, ...(summary.categoryPerformance || []).map(item => Number(item.max) || 0));
    const categoryBars = bars((summary.categoryPerformance || []).map(item => ({ label: categoryNames[item.category] || item.category, value: item.average || 0, max: item.max })), 'label', 'value', categoryMax);
    const rubric = window.onlineLabScoring?.getWeights?.() || { equipment: 15, steps: 30, safety: 15, microscope: 20, questions: 20 };
    const notices = '<div class="analytics-note">' + (locale === 'ru' ? 'Формула: оценки рассчитывает программная проверка сайта по критериям преподавателя. Текущие веса: оборудование — ' + rubric.equipment + ', порядок этапов — ' + rubric.steps + ', безопасность — ' + rubric.safety + ', микроскоп — ' + rubric.microscope + ', вопросы — ' + rubric.questions + '. ИИ объясняет ошибки и подсказывает, но не выставляет баллы. Исходные действия и рассчитанные оценки хранятся отдельно; сводки вычисляются при запросе. События фильтруются по времени получения сервером.' : 'Есептеу қағидасы: әр балл сайттағы оқытушы критерийлеріне сай бағдарламалық бағалаудан алынған. Қазіргі салмақтар: құрал-жабдық — ' + rubric.equipment + ', жұмыс барысы — ' + rubric.steps + ', қауіпсіздік — ' + rubric.safety + ', микроскоп — ' + rubric.microscope + ', сұрақтар — ' + rubric.questions + '. ИИ тек қатені түсіндіреді және кеңес береді; баға қоймайды. Шикі оқиғалар мен есептелген бағалар бөлек сақталады, қорытынды көрсеткіштер сұрау кезінде есептеледі. Кезең сүзгісі серверге түскен уақытты қолданады.') + '</div>';
    const recentLabel = user.role === 'admin' ? 'Соңғы студент нәтижелері' : 'Менің нәтижелерім';
    content.innerHTML = '<div class="analytics-wrap">' + heading(payload) + (demoMode ? '<div class="analytics-banner">ДЕМО-РЕЖИМ · Төмендегі синтетикалық сандар тек интерфейс көрсетуге арналған. Олар оқиғалар журналына жазылмайды және нақты студент нәтижесі емес.</div>' : '') + filtersMarkup(payload.options) + cards +
      '<div class="analytics-grid"><section class="analytics-panel"><h2>Уақыт бойынша балл динамикасы</h2><p>Апталық орташа; әр нүкте нақты нәтижелердің санымен есептеледі.</p>' + graph() + '<div class="la-small">Деректер нүктелерінің саны: ' + escape((summary.progress || []).reduce((sum, item) => sum + Number(item.n || 0), 0)) + '</div></section><section class="analytics-panel"><h2>Бағалардың бөлінуі</h2><p>Әр студент пен зертханалық жұмыс үшін тек соңғы баға есепке алынады.</p>' + distribution + '</section></div>' +
      '<div class="analytics-grid"><section class="analytics-panel"><h2>Бағалау критерийлері</h2><p>' + (locale === 'ru' ? 'Средний процент выполнения каждой категории; значения нормированы по весу, действовавшему при расчёте результата.' : 'Әр санаттың орташа орындалу пайызы; көрсеткіш сол нәтиже есептелген кездегі салмақ бойынша нормалданады.') + '</p>' + categoryBars + '</section><section class="analytics-panel"><h2>Жиі кездескен қателер</h2><p>Қате оқиғаларының жинақталған саны; бір студент қайталап жіберген қатесі де есептеледі.</p>' + bars((summary.frequentErrors || []).map(item => ({ label: categoryNames[item.category] || item.category, value: item.count })), 'label', 'value') + '</section></div>' +
      '<section class="analytics-panel"><h2>' + (locale === 'ru' ? 'Время по этапам' : 'Кезеңдер бойынша уақыт') + '</h2><p>' + (locale === 'ru' ? 'Среднее время на этап по записанным завершениям; число наблюдений n указано рядом.' : 'Тіркелген аяқталған кезеңдер бойынша орташа уақыт; бақылаулар саны n жанында көрсетілген.') + '</p>' + stageTimeMarkup(summary.stageDurations || []) + '</section>' +
      '<div class="analytics-grid"><section class="analytics-panel"><h2>ИИ кеңесінің нәтижелілігі</h2><p>OpenAI кеңесінен кейін студенттің қатені өздігінен түзеткен үлесі.</p>' + comparisonMarkup(ai) + '<div class="la-small" style="margin-top:10px">Кеңесті түзету пайызы = кеңестен кейін өздігінен түзетілген бірегей қателер / OpenAI кеңесі көрсетілген бірегей қателер × 100.</div></section><section class="analytics-panel"><h2>Қателер мен кеңестер</h2><p>Сүзгіге сай соңғы оқиғалар.</p>' + activityMarkup(payload.events || []) + '</section></div>' +
      individualCard(scores, summary) + '<section class="analytics-panel"><h2>' + recentLabel + '</h2><p>Нәтижелер серверде тіркелген; экспорттағы студент белгілері әдепкіде псевдонимделеді.</p>' + scoreTable(scores) + '</section>' + notices + (user.role === 'admin' && !demoMode ? rubricSettingsPanel() : '') + '</div>';
    localize(content);
    requestAnimationFrame(() => drawGraph(summary.progress || []));
  }

  function filtersFromForm(form) {
    const data = new FormData(form);
    filters = { studentId: String(data.get('studentId') || ''), groupId: String(data.get('groupId') || ''), labId: String(data.get('labId') || ''), from: String(data.get('from') || ''), to: String(data.get('to') || '') };
  }
  async function refreshAccounts() { if (user?.role !== 'admin') return; try { const result = await api('/api/admin/students'); lastPayload ||= { summary: {}, events: [], options: {} }; lastPayload.options ||= {}; lastPayload.options.students = result.students; drawAnalytics(); } catch (error) { setNotice(error.message, true); } }
  async function createStudent(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    try { await api('/api/admin/students', { method: 'POST', body: JSON.stringify(data) }); form.reset(); setNotice('Аккаунт создан. Передайте студенту логин и временный пароль; при первом входе он должен будет сменить пароль.'); await loadManagedStudents(); }
    catch (error) { setNotice(error.message, true); }
  }
  async function saveRubric(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    const rubricWeights = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)]));
    const sum = Object.values(rubricWeights).reduce((total, value) => total + value, 0);
    if (sum !== 100) { setNotice('Рубрика салмақтарының қосындысы 100 болуы керек. Қазір: ' + sum + '.', true); return; }
    try {
      const settings = await api('/api/learning/settings', { method: 'PATCH', body: JSON.stringify({ rubricWeights }) });
      if (!window.onlineLabScoring?.setWeights(settings.rubricWeights)) throw new Error('Бұл бағалау рубрикасын жаңарту мүмкін болмады.');
      setNotice('Бағалау салмақтары сақталды.'); await loadAnalytics();
    } catch (error) { setNotice(error.message, true); }
  }
  async function updateStudent(id, changes) {
    try { await api('/api/admin/students/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(changes) }); setNotice(changes.password ? 'Пароль сброшен. При следующем входе студент должен будет сменить его.' : changes.active === false ? 'Аккаунт заблокирован.' : changes.active === true ? 'Аккаунт разблокирован.' : 'Данные студента сохранены.'); await loadManagedStudents(); if (page === 'analytics') await loadAnalytics(); return true; }
    catch (error) { setNotice(error.message, true); return false; }
  }
  async function deleteStudent(id) {
    const student = managedStudents.find(item => item.id === id);
    if (!student || !confirm('Удалить аккаунт «' + student.displayName + '» и связанные с ним учебные результаты? Это действие нельзя отменить.')) return;
    try { await api('/api/admin/students/' + encodeURIComponent(id), { method: 'DELETE' }); setNotice('Аккаунт и связанные результаты удалены.'); await loadManagedStudents(); }
    catch (error) { setNotice(error.message, true); }
  }
  async function importStudents(form) {
    const file = new FormData(form).get('file'); if (!(file instanceof File)) return;
    try {
      const students = csvRows(await file.text());
      if (students.length > 200) throw new Error('За один раз можно импортировать не более 200 записей.');
      const result = await api('/api/admin/students/import', { method: 'POST', body: JSON.stringify({ students }) });
      importReport = (result.created || []).map(item => ({ ok: true, username: item.username, row: '' })).concat((result.rejected || []).map(item => ({ ok: false, username: item.username, row: item.row + 1, error: item.error })));
      form.reset(); setNotice('Импорт завершён: создано ' + (result.created || []).length + ', ошибок ' + (result.rejected || []).length + '.'); await loadManagedStudents();
    } catch (error) { setNotice(error.message, true); }
  }
  function downloadStudentTemplate() {
    const rows = [['ФИО', 'Группа', 'Логин', 'Временный пароль'], ['Иванова Анна Сергеевна', 'БИО-101', 'student01', 'TempPass2026']];
    const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(';')).join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'online-laboratory-students-template.csv');
  }

  function csvCell(value) {
    let text = value === null || value === undefined ? '' : String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }
  function exportRows(payload) {
    const scores = scoresFor(payload), events = payload?.events || [];
    const studentIds = [...new Set([...scores.map(row => row.studentId), ...events.map(row => row.studentId)].filter(Boolean))].sort();
    const groupIds = [...new Set([...scores.map(row => row.groupId), ...events.map(row => row.groupId)].filter(Boolean))].sort();
    const pseudonym = (prefix, id) => prefix + '-' + String(id).replace(/[^a-fA-F0-9]/g, '').slice(-8).toUpperCase();
    const studentLabels = new Map(studentIds.map(id => [id, pseudonym('Студент', id)]));
    const groupLabels = new Map(groupIds.map(id => [id, pseudonym('Топ', id)]));
    const scoreRows = [[locale === 'ru' ? 'Студент (псевдоним)' : 'Студент (псевдоним)', locale === 'ru' ? 'Группа (псевдоним)' : 'Топ (псевдоним)', locale === 'ru' ? 'Лабораторная работа' : 'Зертханалық жұмыс', 'UTC', 'Балл / 100', locale === 'ru' ? 'Оборудование (баллы / макс.)' : 'Құрал-жабдық (ұпай / макс.)', locale === 'ru' ? 'Этапы (баллы / макс.)' : 'Кезеңдер (ұпай / макс.)', locale === 'ru' ? 'Безопасность (баллы / макс.)' : 'Қауіпсіздік (ұпай / макс.)', locale === 'ru' ? 'Микроскоп (баллы / макс.)' : 'Микроскоп (ұпай / макс.)', locale === 'ru' ? 'Вопросы (баллы / макс.)' : 'Сұрақтар (ұпай / макс.)', locale === 'ru' ? 'Число ошибок' : 'Қате саны', locale === 'ru' ? 'Подсказки' : 'Кеңестер', locale === 'ru' ? 'Самостоятельность %' : 'Өздігінен орындау %']];
    scores.forEach((row, index) => {
      const name = user.role === 'student' ? 'Менің нәтижем' : (studentLabels.get(row.studentId) || 'Студент ' + String(index + 1).padStart(2, '0'));
      const group = user.role === 'student' ? '' : groupLabels.get(row.groupId) || '';
      const rubric = row.rubricScores || {};
      const maximum = row.rubricMax || {};
      scoreRows.push([name, group, row.labTitle, row.at, row.score, (rubric.equipment ?? '') + ' / ' + (maximum.equipment ?? ''), (rubric.steps ?? '') + ' / ' + (maximum.steps ?? ''), (rubric.safety ?? '') + ' / ' + (maximum.safety ?? ''), (rubric.microscope ?? '') + ' / ' + (maximum.microscope ?? ''), (rubric.questions ?? '') + ' / ' + (maximum.questions ?? ''), row.errors ?? '', row.hints ?? '', row.independence ?? '']);
    });
    const eventRows = [['Оқиға түрі', 'Уақыты серверде UTC', 'Студент (псевдоним)', 'Топ (псевдоним)', 'Зертханалық жұмыс', 'Кезең', 'Санат', 'Оқиға деректері (алдын ала сүзілген)']];
    events.forEach((event, index) => {
      const student = user.role === 'student' ? 'Менің аккаунтым' : studentLabels.get(event.studentId) || 'Студент ' + String(index + 1).padStart(2, '0');
      const group = user.role === 'student' ? '' : groupLabels.get(event.groupId) || '';
      eventRows.push([eventNames[event.type] || event.type, event.receivedAt, student, group, event.labTitle, event.stage, categoryNames[event.data?.errorCategory] || event.data?.errorCategory || '', JSON.stringify(event.data || {})]);
    });
    return { scoreRows, eventRows };
  }
  function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function exportCsv() {
    if (!lastPayload || demoMode) return setNotice('Демо-деректер экспортталмайды. Нақты тіркелген аналитиканы таңдаңыз.', true);
    return fetchExportPayload().then(payload => { const { eventRows } = exportRows(payload), csv = '\ufeff' + eventRows.map(row => row.map(csvCell).join(',')).join('\r\n'); downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'online-laboratory-events.csv'); }).catch(error => setNotice(error.message, true));
  }
  function xml(value) { return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;'); }
  function columnName(index) { let name = ''; for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name; return name; }
  function sheetXml(rows) {
    const body = rows.map((row, rowIndex) => '<row r="' + (rowIndex + 1) + '">' + row.map((value, colIndex) => {
      const reference = columnName(colIndex) + (rowIndex + 1);
      if (typeof value === 'number' && Number.isFinite(value)) return '<c r="' + reference + '"><v>' + value + '</v></c>';
      return '<c r="' + reference + '" t="inlineStr"><is><t xml:space="preserve">' + xml(value) + '</t></is></c>';
    }).join('') + '</row>').join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + body + '</sheetData></worksheet>';
  }
  function crc32(bytes) { let crc = -1; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ -1) >>> 0; }
  function zipStore(files) {
    const encoder = new TextEncoder(), local = [], central = []; let offset = 0;
    const u16 = (view, at, value) => view.setUint16(at, value, true), u32 = (view, at, value) => view.setUint32(at, value >>> 0, true);
    for (const [name, content] of files) {
      const fileName = encoder.encode(name), data = encoder.encode(content), checksum = crc32(data);
      const header = new Uint8Array(30 + fileName.length), h = new DataView(header.buffer);
      u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 8, 0); u16(h, 10, 0); u16(h, 12, 0x5021); u32(h, 14, checksum); u32(h, 18, data.length); u32(h, 22, data.length); u16(h, 26, fileName.length); u16(h, 28, 0); header.set(fileName, 30);
      local.push(header, data);
      const directory = new Uint8Array(46 + fileName.length), d = new DataView(directory.buffer);
      u32(d, 0, 0x02014b50); u16(d, 4, 20); u16(d, 6, 20); u16(d, 8, 0x0800); u16(d, 10, 0); u16(d, 12, 0); u16(d, 14, 0x5021); u32(d, 16, checksum); u32(d, 20, data.length); u32(d, 24, data.length); u16(d, 28, fileName.length); u16(d, 30, 0); u16(d, 32, 0); u16(d, 34, 0); u16(d, 36, 0); u32(d, 38, 0); u32(d, 42, offset); directory.set(fileName, 46); central.push(directory); offset += header.length + data.length;
    }
    const centralSize = central.reduce((sum, entry) => sum + entry.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
    u32(e, 0, 0x06054b50); u16(e, 4, 0); u16(e, 6, 0); u16(e, 8, files.length); u16(e, 10, files.length); u32(e, 12, centralSize); u32(e, 16, offset); u16(e, 20, 0);
    return new Blob([...local, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  async function fetchExportPayload() {
    const params = new URLSearchParams(filterQuery()); params.set('limit', '250000');
    const endpoint = user.role === 'admin' ? '/api/learning/admin' : '/api/learning/me';
    return api(endpoint + '?' + params.toString());
  }
  function exportXlsx() {
    if (!lastPayload || demoMode) return setNotice('Демо-деректер экспортталмайды. Нақты тіркелген аналитиканы таңдаңыз.', true);
    return fetchExportPayload().then(payload => {
    const { scoreRows, eventRows } = exportRows(payload), files = [
      ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Результаты" sheetId="1" r:id="rId1"/><sheet name="Оқиғалар" sheetId="2" r:id="rId2"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml', sheetXml(scoreRows)], ['xl/worksheets/sheet2.xml', sheetXml(eventRows)]
    ];
    downloadBlob(zipStore(files), 'online-laboratory-learning-analytics.xlsx');
    }).catch(error => setNotice(error.message, true));
  }

  content.addEventListener('submit', event => {
    if (event.target.id !== 'laFilters') return;
    event.preventDefault(); filtersFromForm(event.target); loadAnalytics();
  });
  content.addEventListener('submit', event => {
    if (event.target.id === 'laCreateStudent') { event.preventDefault(); createStudent(event.target); }
    else if (event.target.id === 'laStudentImport') { event.preventDefault(); importStudents(event.target); }
    else if (event.target.id === 'laEditStudent') { event.preventDefault(); const data = Object.fromEntries(new FormData(event.target).entries()); updateStudent(editingStudent.id, data).then(ok => { if (ok) { editingStudent = null; drawStudents(); } }); }
  });
  content.addEventListener('submit', event => { if (event.target.id === 'laWeights') { event.preventDefault(); saveRubric(event.target); } });
  content.addEventListener('input', event => {
    if (!event.target.closest('#laWeights')) return;
    const total = [...content.querySelectorAll('#laWeights input')].reduce((sum, input) => sum + (Number(input.value) || 0), 0);
    const node = content.querySelector('#laWeightTotal'); if (node) node.textContent = (locale === 'ru' ? 'Сумма: ' : 'Жиыны: ') + total + ' / 100';
    node?.classList.toggle('invalid', total !== 100);
  });
  content.addEventListener('click', event => {
    const button = event.target.closest('[data-la-demo],[data-la-csv],[data-la-xlsx],[data-la-refresh],[data-la-reset],[data-la-active],[data-la-password],[data-la-profile],[data-la-language],[data-la-refresh-students],[data-la-edit-student],[data-la-cancel-edit],[data-la-delete-student],[data-la-template]'); if (!button) return;
    if (button.hasAttribute('data-la-demo')) { demoMode = !demoMode; if (demoMode) { lastPayload = demoPayload(); dashboardError = ''; drawAnalytics(); } else loadAnalytics(); }
    else if (button.hasAttribute('data-la-language')) { setLocale(button.dataset.laLanguage); drawAnalytics(); }
    else if (button.hasAttribute('data-la-csv')) exportCsv();
    else if (button.hasAttribute('data-la-xlsx')) exportXlsx();
    else if (button.hasAttribute('data-la-refresh')) loadAnalytics();
    else if (button.hasAttribute('data-la-reset')) { filters = { studentId: '', groupId: '', labId: '', from: '', to: '' }; loadAnalytics(); }
    else if (button.hasAttribute('data-la-active')) updateStudent(button.dataset.laActive, { active: button.dataset.active === 'true' });
    else if (button.hasAttribute('data-la-password')) { const password = prompt('Жаңа уақытша құпиясөзді енгізіңіз (кемінде 10 таңба):'); if (password !== null) updateStudent(button.dataset.laPassword, { password }); }
    else if (button.hasAttribute('data-la-profile')) { filters.studentId = button.dataset.laProfile; filters.groupId = ''; demoMode = false; loadAnalytics(); }
    else if (button.hasAttribute('data-la-refresh-students')) loadManagedStudents();
    else if (button.hasAttribute('data-la-edit-student')) { editingStudent = managedStudents.find(item => item.id === button.dataset.laEditStudent) || null; drawStudents(); }
    else if (button.hasAttribute('data-la-cancel-edit')) { editingStudent = null; drawStudents(); }
    else if (button.hasAttribute('data-la-delete-student')) deleteStudent(button.dataset.laDeleteStudent);
    else if (button.hasAttribute('data-la-template')) downloadStudentTemplate();
  });
  content.addEventListener('input', event => { if (event.target.id === 'studentSearch') { studentSearch = event.target.value; const start = event.target.selectionStart; drawStudents(); const input = content.querySelector('#studentSearch'); input?.focus(); input?.setSelectionRange(start, start); } });

  render = function () {
    if (!authReady) return;
    if (page === 'analytics') { drawAnalytics(); if (!lastPayload || (!demoMode && !loading)) loadAnalytics(); return; }
    if (page === 'students' && user?.role === 'admin') { drawStudents(); if (!managedStudentsLoaded) loadManagedStudents(); return; }
    originalRender();
  };
  initializeAuth();
})();
