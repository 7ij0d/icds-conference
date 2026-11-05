/* ==========================================================================
   ICDS 4th Edition – Frontend Application Controller (public/app.js)
   ========================================================================== */

const CLOUD_API_BASE = 'https://api.kurofangs.id.ly/icds';

const AppState = {
  currentView: 'home', // 'home' | 'supervisor' | 'admin'
  currentAdminTab: 'overview',
  overviewData: null,
  adminToken: localStorage.getItem('icds_admin_token') || '',
  supToken: localStorage.getItem('icds_sup_token') || '',
  adminSession: null,
  supSession: null,

  // Supervisor Step Selection
  selectedDayId: null,
  selectedSupervisorId: null,

  // Participant Registration Form State
  selectedCategory: 'student',
  selectedYear: '',
  selectedReceiptFile: null,
  currentIdempotencyKey: '',
  isSubmittingReg: false,

  // Admin Cached Data
  supervisorsList: [],
  daysList: [],
  participantsList: [],
  currentParticipantDetail: null,
  receiptFilterStatus: '',

  // Import Engine State
  importFileData: null,
  importRawRows: [],
  importAnalyzedRows: [],
  importMapping: {}
};

// ============================================================================
// UTILITY & API HELPERS
// ============================================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(amount) {
  const num = Number(amount || 0);
  const currency = AppState.overviewData?.conference?.currency_short || 'د.ل';
  return `${num.toLocaleString('en-US', { minimumFractionDigits: num % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })} ${currency}`;
}

function generateIdempotencyKey() {
  return `reg_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  toast.innerHTML = `
    <span class="toast-message">${escapeHtml(message)}</span>
    <button type="button" class="btn btn-ghost btn-sm" style="min-height:26px;padding:2px 6px;">✕</button>
  `;
  toast.querySelector('button').addEventListener('click', () => toast.remove());
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 4500);
}

async function apiFetch(url, options = {}) {
  const fullUrl = url.startsWith('/api/') ? `${CLOUD_API_BASE}${url}` : url;
  const headers = { ...(options.headers || {}) };
  if (AppState.adminToken) {
    headers['x-admin-token'] = AppState.adminToken;
  }
  if (AppState.supToken) {
    headers['x-supervisor-token'] = AppState.supToken;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(fullUrl, {
    ...options,
    headers
  });

  let data = null;
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    data = await response.json();
  } else {
    const text = await response.text();
    data = { message: text };
  }

  if (!response.ok) {
    const err = new Error(data?.error || 'حدث خطأ غير متوقع في الاتصال بالخادم.');
    err.status = response.status;
    err.data = data;
    throw err;
  }
  return data;
}

function getReceiptImageUrl(participantId) {
  const params = new URLSearchParams();
  if (AppState.adminToken) params.set('admin_token', AppState.adminToken);
  if (AppState.supToken) params.set('sup_token', AppState.supToken);
  params.set('t', Date.now());
  return `${CLOUD_API_BASE}/api/receipts/${participantId}/image?${params.toString()}`;
}

// ============================================================================
// REAL-TIME LIBYA CLOCK & THEME TOGGLE
// ============================================================================

function startLibyaClock() {
  const clockEl = document.getElementById('libya-clock-display');
  const updateClock = () => {
    try {
      const now = new Date();
      const fmt = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Tripoli',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      if (clockEl) clockEl.textContent = fmt.format(now);
    } catch {
      if (clockEl) clockEl.textContent = new Date().toLocaleTimeString();
    }
  };
  updateClock();
  setInterval(updateClock, 1000);
}

function initThemeToggle() {
  const savedTheme = localStorage.getItem('icds_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  const label = document.getElementById('theme-toggle-label');
  if (label) {
    label.textContent = savedTheme === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن';
  }

  document.getElementById('btn-theme-toggle')?.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('icds_theme', next);
    if (label) {
      label.textContent = next === 'dark' ? 'المظهر الفاتح' : 'المظهر الداكن';
    }
  });
}

// ============================================================================
// NAVIGATION & PUBLIC OVERVIEW SYNC
// ============================================================================

async function loadPublicOverview() {
  try {
    const data = await apiFetch('/api/public/overview');
    AppState.overviewData = data;

    if (data.session?.admin) {
      AppState.adminSession = data.session.admin;
    }
    if (data.session?.supervisor) {
      AppState.supSession = data.session.supervisor;
    }

    renderPublicHeaderAndHome(data);
    renderSupervisorStep1Days(data);
    updateCategoryFeeUI();
  } catch (err) {
    console.error('Failed to load overview:', err);
  }
}

function renderPublicHeaderAndHome(data) {
  const { conference, stats, days } = data;

  document.getElementById('header-conf-title').textContent = conference.title;
  document.getElementById('header-conf-edition').textContent = conference.edition;
  document.getElementById('header-conf-subtitle').textContent = conference.subtitle;

  const statusBadge = document.getElementById('home-reg-status-badge');
  if (statusBadge) {
    if (conference.registration_open) {
      statusBadge.className = 'status-pill pill-success';
      statusBadge.textContent = 'التسجيل متاح للمشرفين';
    } else {
      statusBadge.className = 'status-pill pill-danger';
      statusBadge.textContent = 'التسجيل مغلق حالياً';
    }
  }

  // Real-time stats on Home Page (0 when database is empty)
  document.getElementById('home-stat-total').textContent = stats.total_registrations;
  document.getElementById('home-stat-students').textContent = stats.total_students;
  document.getElementById('home-stat-doctors').textContent = stats.total_doctors;
  document.getElementById('home-stat-days').textContent = days.length;

  document.getElementById('home-fee-student').textContent = `${conference.student_fee} ${conference.currency_short}`;
  document.getElementById('home-fee-doctor').textContent = `${conference.doctor_fee} ${conference.currency_short}`;

  // Render Schedule Overview on Home Page
  const homeGrid = document.getElementById('home-days-overview-grid');
  if (homeGrid) {
    if (!days || days.length === 0) {
      homeGrid.innerHTML = `<div class="empty-state-box"><div class="empty-state-title">لا توجد أيام تسجيل مفعلة حالياً</div></div>`;
    } else {
      homeGrid.innerHTML = days.map((d) => {
        const supNames = d.supervisors && d.supervisors.length > 0
          ? d.supervisors.map((s) => `<span class="status-pill pill-info" style="margin-block-top:4px;">${escapeHtml(s.name)}</span>`).join(' ')
          : `<span class="text-muted" style="font-size:0.78rem;">لم يتم تعيين المشرفين بعد من لوحة الأدمن</span>`;
        return `
          <div class="day-select-card" data-jump-day="${d.id}">
            <div class="day-card-title">${escapeHtml(d.day_name)}</div>
            <div class="day-card-meta">المشرفون المخصصون (${d.supervisors.length}/2):</div>
            <div style="display:flex;flex-wrap:wrap;gap:4px;">${supNames}</div>
          </div>
        `;
      }).join('');

      homeGrid.querySelectorAll('[data-jump-day]').forEach((card) => {
        card.addEventListener('click', () => {
          const dayId = Number(card.getAttribute('data-jump-day'));
          switchMainView('supervisor');
          selectSupervisorDay(dayId);
        });
      });
    }
  }
}

function switchMainView(viewName) {
  AppState.currentView = viewName;
  const views = ['home', 'supervisor', 'admin'];
  for (const v of views) {
    const el = document.getElementById(`view-${v}`);
    if (el) {
      el.classList.toggle('is-hidden', v !== viewName);
    }
  }

  if (viewName === 'home') {
    loadPublicOverview();
  } else if (viewName === 'supervisor') {
    loadPublicOverview();
    if (AppState.supSession) {
      showSupervisorRegistrationForm();
    }
  } else if (viewName === 'admin') {
    checkAndRenderAdminView();
  }
}

// ============================================================================
// VIEW 2: SUPERVISOR REGISTRATION WORKFLOW
// ============================================================================

function renderSupervisorStep1Days(data) {
  const grid = document.getElementById('sup-days-grid');
  if (!grid) return;

  const days = data?.days || [];
  if (days.length === 0) {
    grid.innerHTML = `
      <div class="empty-state-box" style="grid-column: 1 / -1;">
        <div class="empty-state-title">لا توجد أيام تسجيل مفعلة حالياً</div>
        <div class="empty-state-desc">يرجى من الأدمن تفعيل أيام التسجيل من لوحة التحكم.</div>
      </div>
    `;
    return;
  }

  grid.innerHTML = days.map((d) => {
    const isSelected = Number(AppState.selectedDayId) === Number(d.id);
    const countSups = d.supervisors?.length || 0;
    return `
      <button type="button" class="day-select-card ${isSelected ? 'is-selected' : ''}" data-day-id="${d.id}">
        <span class="day-card-title">${escapeHtml(d.day_name)}</span>
        <span class="day-card-meta">${countSups === 2 ? 'مشرفان مخصصان (2/2)' : countSups === 1 ? 'مشرف واحد مخصص (1/2)' : 'بانتظار توزيع المشرفين (0/2)'}</span>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('[data-day-id]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dayId = Number(btn.getAttribute('data-day-id'));
      selectSupervisorDay(dayId);
    });
  });

  if (AppState.selectedDayId) {
    renderSupervisorStep2Slots(AppState.selectedDayId);
  }
}

function selectSupervisorDay(dayId) {
  AppState.selectedDayId = dayId;
  AppState.selectedSupervisorId = null;

  document.querySelectorAll('#sup-days-grid .day-select-card').forEach((btn) => {
    btn.classList.toggle('is-selected', Number(btn.getAttribute('data-day-id')) === Number(dayId));
  });

  document.getElementById('step-indicator-1')?.classList.add('is-completed');
  document.getElementById('step-indicator-2')?.classList.add('is-active');

  renderSupervisorStep2Slots(dayId);
}

function renderSupervisorStep2Slots(dayId) {
  const step2Container = document.getElementById('sup-step2-container');
  const slotsContainer = document.getElementById('sup-two-slots-container');
  const dayLabel = document.getElementById('selected-day-label');
  const confirmBtn = document.getElementById('btn-confirm-supervisor-step');

  if (!step2Container || !slotsContainer) return;

  const days = AppState.overviewData?.days || [];
  const dayObj = days.find((d) => Number(d.id) === Number(dayId));
  if (!dayObj) {
    step2Container.classList.add('is-hidden');
    return;
  }

  step2Container.classList.remove('is-hidden');
  if (dayLabel) dayLabel.textContent = dayObj.day_name;

  const sups = dayObj.supervisors || [];
  if (sups.length === 0) {
    slotsContainer.innerHTML = `
      <div class="empty-state-box" style="background: var(--surface-subtle); border-radius: var(--radius-card); border: 1px dashed var(--border-strong); margin-block-top: 0.75rem;">
        <div class="empty-state-title">لم يتم تعيين مشرفين ليوم ${escapeHtml(dayObj.day_name)} حتى الآن</div>
        <div class="empty-state-desc">
          يرجى الدخول إلى <strong>لوحة تحكم الأدمن &larr; إدارة المشرفين / إدارة أيام التسجيل</strong> لإضافة المشرفين وتخصيص مشرفين اثنين لهذا اليوم.
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="btn-empty-goto-admin" style="margin-block-top: 0.5rem;">
          الانتقال إلى لوحة الأدمن لإضافة المشرفين
        </button>
      </div>
    `;
    slotsContainer.querySelector('#btn-empty-goto-admin')?.addEventListener('click', () => {
      switchMainView('admin');
    });
    if (confirmBtn) confirmBtn.disabled = true;
    return;
  }

  slotsContainer.innerHTML = `
    <div class="supervisors-two-grid">
      ${sups.map((s) => {
        const isSelected = Number(AppState.selectedSupervisorId) === Number(s.supervisor_id);
        return `
          <button type="button" class="supervisor-select-card ${isSelected ? 'is-selected' : ''}" data-sup-id="${s.supervisor_id}" data-has-pin="${s.has_pin ? '1' : '0'}">
            <div class="sup-card-info">
              <span class="sup-slot-badge">المشرف ${s.slot_number === 1 ? 'الأول' : 'الثاني'} – يوم ${escapeHtml(dayObj.day_name)}</span>
              <span class="sup-card-name">${escapeHtml(s.name)}</span>
            </div>
            <span class="status-pill pill-info">اختيار</span>
          </button>
        `;
      }).join('')}
    </div>
  `;

  slotsContainer.querySelectorAll('[data-sup-id]').forEach((card) => {
    card.addEventListener('click', () => {
      AppState.selectedSupervisorId = Number(card.getAttribute('data-sup-id'));
      const hasPin = card.getAttribute('data-has-pin') === '1';

      slotsContainer.querySelectorAll('.supervisor-select-card').forEach((c) => {
        c.classList.toggle('is-selected', Number(c.getAttribute('data-sup-id')) === AppState.selectedSupervisorId);
      });

      // Check if extra security fields are required
      const conf = AppState.overviewData?.conference || {};
      const extraWrap = document.getElementById('sup-auth-extra-fields');
      const portalGroup = document.getElementById('sup-portal-code-group');
      const pinGroup = document.getElementById('sup-personal-pin-group');

      const needPortal = Boolean(conf.has_portal_code);
      const needPin = Boolean(conf.require_supervisor_pin && hasPin);

      if (extraWrap) extraWrap.classList.toggle('is-hidden', !needPortal && !needPin);
      if (portalGroup) portalGroup.classList.toggle('is-hidden', !needPortal);
      if (pinGroup) pinGroup.classList.toggle('is-hidden', !needPin);

      if (confirmBtn) confirmBtn.disabled = false;
    });
  });

  if (confirmBtn) {
    confirmBtn.disabled = !AppState.selectedSupervisorId;
  }
}

async function handleConfirmSupervisorSelection() {
  if (!AppState.selectedDayId || !AppState.selectedSupervisorId) {
    showToast('يرجى اختيار يوم التسجيل واسم المشرف أولاً.', 'warning');
    return;
  }

  const portalCode = document.getElementById('sup-portal-code-input')?.value || '';
  const pin = document.getElementById('sup-personal-pin-input')?.value || '';

  try {
    const res = await apiFetch('/api/auth/supervisor/select', {
      method: 'POST',
      body: JSON.stringify({
        day_id: AppState.selectedDayId,
        supervisor_id: AppState.selectedSupervisorId,
        portal_code: portalCode,
        pin
      })
    });

    AppState.supToken = res.token;
    AppState.supSession = res.supervisor;
    localStorage.setItem('icds_sup_token', res.token);

    showSupervisorRegistrationForm();
    showToast(`مرحباً ${res.supervisor.supervisor_name} — يمكنك الآن تسجيل المشاركين ليوم ${res.supervisor.day_name}`, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function showSupervisorRegistrationForm() {
  if (!AppState.supSession) return;

  document.getElementById('sup-selection-panel')?.classList.add('is-hidden');
  document.getElementById('sup-registration-panel')?.classList.remove('is-hidden');

  document.getElementById('step-indicator-1')?.classList.add('is-completed');
  document.getElementById('step-indicator-1')?.classList.remove('is-active');
  document.getElementById('step-indicator-2')?.classList.add('is-completed');
  document.getElementById('step-indicator-2')?.classList.remove('is-active');
  document.getElementById('step-indicator-3')?.classList.add('is-active');

  document.getElementById('active-context-day').textContent = AppState.supSession.day_name;
  document.getElementById('active-context-supervisor').textContent = AppState.supSession.supervisor_name;

  if (!AppState.currentIdempotencyKey) {
    AppState.currentIdempotencyKey = generateIdempotencyKey();
  }

  updateCategoryFeeUI();
  loadSupervisorOwnRegistrations();
}

function resetSupervisorSelectionStep() {
  AppState.supSession = null;
  AppState.supToken = '';
  localStorage.removeItem('icds_sup_token');

  document.getElementById('sup-selection-panel')?.classList.remove('is-hidden');
  document.getElementById('sup-registration-panel')?.classList.add('is-hidden');

  document.getElementById('step-indicator-1')?.classList.add('is-active');
  document.getElementById('step-indicator-1')?.classList.remove('is-completed');
  document.getElementById('step-indicator-2')?.classList.remove('is-active', 'is-completed');
  document.getElementById('step-indicator-3')?.classList.remove('is-active', 'is-completed');
}

function updateCategoryFeeUI() {
  const conf = AppState.overviewData?.conference || { student_fee: 30, doctor_fee: 60, currency_short: 'د.ل' };
  const studentFeeStr = `${conf.student_fee} ${conf.currency_short}`;
  const doctorFeeStr = `${conf.doctor_fee} ${conf.currency_short}`;

  const stDisplay = document.getElementById('form-student-fee-display');
  const drDisplay = document.getElementById('form-doctor-fee-display');
  if (stDisplay) stDisplay.textContent = studentFeeStr;
  if (drDisplay) drDisplay.textContent = doctorFeeStr;

  const isStudent = AppState.selectedCategory === 'student';
  document.getElementById('cat-card-student')?.classList.toggle('is-selected', isStudent);
  document.getElementById('cat-card-doctor')?.classList.toggle('is-selected', !isStudent);

  const yearSection = document.getElementById('academic-year-section');
  if (yearSection) {
    yearSection.classList.toggle('is-hidden', !isStudent);
  }

  const feeBannerVal = document.getElementById('fee-banner-value');
  const feeBannerDesc = document.getElementById('fee-banner-desc');
  if (feeBannerVal) {
    feeBannerVal.textContent = isStudent ? studentFeeStr : doctorFeeStr;
  }
  if (feeBannerDesc) {
    feeBannerDesc.textContent = isStudent
      ? `فئة الطالب (${AppState.selectedYear || 'اختر السنة الدراسية'}) — تُحسب تلقائياً ولا تقبل التعديل اليدوي`
      : 'فئة الدكتور (الأطباء الدكاترة والخريجين) — تُحسب تلقائياً ولا تقبل التعديل اليدوي';
  }
}

function handleReceiptFileSelected(file) {
  if (!file) return;
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes(file.type)) {
    showToast('صيغة الصورة غير مدعومة. يرجى اختيار صورة بصيغة JPG أو PNG أو WEBP.', 'error');
    return;
  }

  AppState.selectedReceiptFile = file;
  const dropZone = document.getElementById('receipt-drop-zone');
  const previewContainer = document.getElementById('receipt-preview-container');
  const previewImg = document.getElementById('receipt-preview-image');
  const infoBadge = document.getElementById('receipt-file-info-badge');

  if (dropZone) dropZone.classList.add('has-file');
  if (previewContainer) previewContainer.classList.remove('is-hidden');

  const sizeKB = Math.round(file.size / 1024);
  if (infoBadge) {
    infoBadge.textContent = `${file.name} (${sizeKB} KB)`;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    if (previewImg) previewImg.src = e.target.result;
  };
  reader.readAsDataURL(file);
}

function clearReceiptFile() {
  AppState.selectedReceiptFile = null;
  const camInput = document.getElementById('receipt-camera-input');
  const galInput = document.getElementById('receipt-gallery-input');
  if (camInput) camInput.value = '';
  if (galInput) galInput.value = '';

  document.getElementById('receipt-drop-zone')?.classList.remove('has-file');
  document.getElementById('receipt-preview-container')?.classList.add('is-hidden');
  const previewImg = document.getElementById('receipt-preview-image');
  if (previewImg) previewImg.src = '';
}

function showFormValidationError(msg, fieldId = null) {
  const errBox = document.getElementById('reg-form-error-box');
  if (errBox) {
    errBox.textContent = msg;
    errBox.classList.remove('is-hidden');
  }
  document.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
  if (fieldId) {
    const input = document.getElementById(fieldId);
    if (input) {
      input.classList.add('has-error');
      input.focus();
    }
  }
}

function hideFormValidationError() {
  const errBox = document.getElementById('reg-form-error-box');
  if (errBox) {
    errBox.textContent = '';
    errBox.classList.add('is-hidden');
  }
  document.querySelectorAll('.has-error').forEach((el) => el.classList.remove('has-error'));
}

async function submitParticipantRegistration(confirmDuplicateOverride = false) {
  if (AppState.isSubmittingReg) return;
  hideFormValidationError();

  if (!AppState.supSession) {
    showFormValidationError('يرجى اختيار يوم التسجيل واسم المشرف أولاً.');
    return;
  }

  const nameAr = document.getElementById('reg-name-ar')?.value.trim() || '';
  const nameEn = document.getElementById('reg-name-en')?.value.trim() || '';

  if (!nameAr || nameAr.length < 3) {
    showFormValidationError('يرجى إدخال الاسم الكامل للمشارك باللغة العربية.', 'reg-name-ar');
    return;
  }

  if (!nameEn || nameEn.length < 3) {
    showFormValidationError('يرجى إدخال الاسم الكامل للمشارك باللغة الإنجليزية.', 'reg-name-en');
    return;
  }

  if (AppState.selectedCategory === 'student' && !AppState.selectedYear) {
    showFormValidationError('يرجى اختيار السنة الدراسية للطالب.');
    return;
  }

  if (!AppState.selectedReceiptFile) {
    showFormValidationError('رفع صورة إيصال الدفع إلزامي لإتمام التسجيل.');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-registration');
  const submitBtnText = document.getElementById('btn-submit-reg-text');
  AppState.isSubmittingReg = true;
  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = 'جاري التحقق وحفظ التسجيل...';

  try {
    const formData = new FormData();
    formData.append('day_id', AppState.supSession.day_id);
    formData.append('supervisor_id', AppState.supSession.supervisor_id);
    formData.append('name_ar', nameAr);
    formData.append('name_en', nameEn);
    formData.append('category', AppState.selectedCategory);
    formData.append('academic_year', AppState.selectedCategory === 'student' ? AppState.selectedYear : '');
    formData.append('receipt_image', AppState.selectedReceiptFile);
    formData.append('confirm_duplicate', confirmDuplicateOverride ? 'true' : 'false');
    formData.append('idempotency_key', AppState.currentIdempotencyKey);

    const res = await apiFetch('/api/registration/submit', {
      method: 'POST',
      body: formData
    });

    // Close duplicate modal if open
    document.getElementById('modal-duplicate-warning')?.classList.add('is-hidden');

    // Show Success Banner with Unique Registration Number
    const p = res.participant;
    const successAlert = document.getElementById('reg-success-alert');
    const regNumEl = document.getElementById('success-reg-number');
    const regSumEl = document.getElementById('success-reg-summary');

    if (regNumEl) regNumEl.textContent = p.registration_number;
    if (regSumEl) {
      regSumEl.textContent = `المشارك: ${p.name_ar} (${p.name_en}) | الفئة: ${p.category_label} ${p.academic_year ? `- ${p.academic_year}` : ''} | الرسوم: ${formatMoney(p.fee_amount)} | التوقيت: ${p.registration_date} الساعة ${p.registration_time}`;
    }
    if (successAlert) {
      successAlert.classList.remove('is-hidden');
      successAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    showToast(`تم تسجيل المشارك بنجاح برقم (${p.registration_number})`, 'success');

    // Reset form for the next participant without reloading the page
    document.getElementById('reg-name-ar').value = '';
    document.getElementById('reg-name-en').value = '';
    AppState.selectedCategory = 'student';
    AppState.selectedYear = '';
    document.querySelectorAll('#academic-years-grid .year-pill-btn').forEach((b) => b.classList.remove('is-selected'));
    clearReceiptFile();
    updateCategoryFeeUI();
    AppState.currentIdempotencyKey = generateIdempotencyKey();

    // Refresh counters & supervisor table
    loadSupervisorOwnRegistrations();
    loadPublicOverview();
  } catch (err) {
    if (err.status === 409 && err.data?.is_duplicate_warning) {
      openDuplicateWarningModal(err.data.duplicates || []);
    } else {
      showFormValidationError(err.message);
      showToast(err.message, 'error');
    }
  } finally {
    AppState.isSubmittingReg = false;
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) submitBtnText.textContent = 'تسجيل المشارك';
  }
}

function openDuplicateWarningModal(duplicates) {
  const modal = document.getElementById('modal-duplicate-warning');
  const tableWrap = document.getElementById('dup-modal-matches-table');
  if (!modal || !tableWrap) return;

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>رقم التسجيل</th>
          <th>الاسم بالعربية</th>
          <th>الاسم بالإنجليزية</th>
          <th>الفئة</th>
          <th>سبب التنبيه</th>
          <th>المشرف واليوم</th>
          <th>التاريخ والوقت</th>
        </tr>
      </thead>
      <tbody>
        ${duplicates.map((d) => `
          <tr>
            <td class="metric-num text-accent">${escapeHtml(d.registration_number)}</td>
            <td><strong>${escapeHtml(d.name_ar)}</strong></td>
            <td class="font-en">${escapeHtml(d.name_en)}</td>
            <td>${escapeHtml(d.category_label)} ${d.academic_year ? `(${escapeHtml(d.academic_year)})` : ''}</td>
            <td><span class="status-pill pill-warning">${escapeHtml(d.match_reason)}</span></td>
            <td>${escapeHtml(d.supervisor_name)} — ${escapeHtml(d.registration_day_name)}</td>
            <td class="metric-num">${escapeHtml(d.registration_date)} ${escapeHtml(d.registration_time)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  modal.classList.remove('is-hidden');
}

async function loadSupervisorOwnRegistrations() {
  if (!AppState.supSession) return;
  try {
    const data = await apiFetch(
      `/api/supervisor/my-registrations?day_id=${AppState.supSession.day_id}&supervisor_id=${AppState.supSession.supervisor_id}`
    );

    const dayCounter = document.getElementById('active-context-count');
    const totalBadge = document.getElementById('my-total-reg-badge');
    if (dayCounter) dayCounter.textContent = data.day_count || 0;
    if (totalBadge) totalBadge.textContent = data.total_by_supervisor || 0;

    const wrap = document.getElementById('sup-my-registrations-table-wrap');
    if (!wrap) return;

    const rows = data.registrations || [];
    if (rows.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لا توجد تسجيلات مدخلة بواسطتك حتى الآن</div>
          <div class="empty-state-desc">عند تسجيل أي مشارك سيظهر هنا فوراً مع رقمه وتوقيت تسجيله.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>رقم التسجيل</th>
            <th>الاسم بالعربية</th>
            <th>الاسم بالإنجليزية</th>
            <th>التصنيف</th>
            <th>السنة الدراسية</th>
            <th>الرسوم</th>
            <th>اليوم</th>
            <th>التاريخ والوقت</th>
            <th>الإيصال</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => `
            <tr>
              <td class="metric-num text-accent">${escapeHtml(r.registration_number)}</td>
              <td><strong>${escapeHtml(r.name_ar)}</strong></td>
              <td class="font-en">${escapeHtml(r.name_en)}</td>
              <td><span class="status-pill ${r.category === 'doctor' ? 'pill-gold' : 'pill-info'}">${escapeHtml(r.category_label)}</span></td>
              <td>${escapeHtml(r.academic_year || '—')}</td>
              <td class="metric-num">${formatMoney(r.fee_amount)}</td>
              <td>${escapeHtml(r.registration_day_name)}</td>
              <td class="metric-num">${escapeHtml(r.registration_date)} ${escapeHtml(r.registration_time)}</td>
              <td>
                ${r.has_receipt
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-view-receipt="${r.id}" data-receipt-name="${escapeHtml(r.name_ar)}">عرض الإيصال</button>`
                  : '<span class="text-muted">—</span>'}
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-view-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openReceiptViewerModal(Number(btn.getAttribute('data-view-receipt')), btn.getAttribute('data-receipt-name'), false);
      });
    });
  } catch (err) {
    console.error('Error loading supervisor registrations:', err);
  }
}

// ============================================================================
// VIEW 3: ADMIN AUTHENTICATION & DASHBOARD SECTIONS
// ============================================================================

async function checkAndRenderAdminView() {
  const loginWrap = document.getElementById('admin-login-wrapper');
  const workspace = document.getElementById('admin-dashboard-workspace');

  if (!AppState.adminToken && !AppState.adminSession) {
    loginWrap?.classList.remove('is-hidden');
    workspace?.classList.add('is-hidden');
    return;
  }

  try {
    await loadAdminDashboardOverview();
    loginWrap?.classList.add('is-hidden');
    workspace?.classList.remove('is-hidden');
    switchAdminTab(AppState.currentAdminTab || 'overview');
  } catch (err) {
    if (err.status === 401) {
      AppState.adminToken = '';
      AppState.adminSession = null;
      localStorage.removeItem('icds_admin_token');
      loginWrap?.classList.remove('is-hidden');
      workspace?.classList.add('is-hidden');
    }
  }
}

async function handleAdminLogin(e) {
  e.preventDefault();
  const username = document.getElementById('admin-username-input')?.value.trim() || '';
  const password = document.getElementById('admin-password-input')?.value || '';
  const errBox = document.getElementById('admin-login-error');

  if (errBox) errBox.classList.add('is-hidden');

  try {
    const res = await apiFetch('/api/auth/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    AppState.adminToken = res.token;
    AppState.adminSession = res.admin;
    localStorage.setItem('icds_admin_token', res.token);

    document.getElementById('admin-active-name').textContent = res.admin.display_name;
    document.getElementById('admin-password-input').value = '';

    showToast(`مرحباً بك ${res.admin.display_name}`, 'success');
    await checkAndRenderAdminView();
  } catch (err) {
    if (errBox) {
      errBox.textContent = err.message;
      errBox.classList.remove('is-hidden');
    }
  }
}

async function handleAdminLogout() {
  try {
    await apiFetch('/api/auth/admin/logout', { method: 'POST' });
  } catch {}
  AppState.adminToken = '';
  AppState.adminSession = null;
  localStorage.removeItem('icds_admin_token');
  showToast('تم تسجيل الخروج من لوحة الأدمن.', 'info');
  checkAndRenderAdminView();
}

function switchAdminTab(tabName) {
  AppState.currentAdminTab = tabName;

  document.querySelectorAll('#admin-nav-tabs .admin-nav-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.getAttribute('data-tab') === tabName);
  });

  const allTabs = ['overview', 'supervisors', 'days', 'participants', 'receipts', 'finance', 'import', 'settings'];
  for (const t of allTabs) {
    document.getElementById(`admin-tab-${t}`)?.classList.toggle('is-hidden', t !== tabName);
  }

  if (tabName === 'overview') loadAdminDashboardOverview();
  else if (tabName === 'supervisors') loadAdminSupervisors();
  else if (tabName === 'days') loadAdminDaysAndDistribution();
  else if (tabName === 'participants') loadAdminParticipants();
  else if (tabName === 'receipts') loadAdminReceiptsCenter();
  else if (tabName === 'finance') loadAdminFinanceReport();
  else if (tabName === 'import') loadAdminImportHistory();
  else if (tabName === 'settings') loadAdminSettingsAndLogs();
}

// ----------------------------------------------------------------------------
// ADMIN TAB 1: OVERVIEW & REAL-TIME METRICS
// ----------------------------------------------------------------------------

async function loadAdminDashboardOverview() {
  const data = await apiFetch('/api/admin/dashboard');
  const s = data.summary;

  // Update sidebar badges
  document.getElementById('nav-badge-supervisors').textContent = s.supervisors_count;
  document.getElementById('nav-badge-participants').textContent = s.total_registrations;
  document.getElementById('nav-badge-receipts').textContent = s.pending_receipts_count;

  // Render KPI Cards (All start at 0 when DB is empty)
  const kpiWrap = document.getElementById('admin-overview-kpis');
  if (kpiWrap) {
    kpiWrap.innerHTML = `
      <div class="kpi-card highlight-primary">
        <span class="kpi-title">إجمالي التسجيلات</span>
        <span class="kpi-value metric-num">${s.total_registrations}</span>
        <span class="kpi-meta">جديد: ${s.new_registrations_count} | مستورد: ${s.imported_registrations_count}</span>
      </div>
      <div class="kpi-card highlight-primary">
        <span class="kpi-title">إجمالي الطلبة</span>
        <span class="kpi-value metric-num text-accent">${s.total_students}</span>
        <span class="kpi-meta">فئة الطالب (السنوات 1–4 والامتياز)</span>
      </div>
      <div class="kpi-card highlight-gold">
        <span class="kpi-title">إجمالي الدكاترة</span>
        <span class="kpi-value metric-num text-warning">${s.total_doctors}</span>
        <span class="kpi-meta">الأطباء الدكاترة والخريجون</span>
      </div>
      <div class="kpi-card highlight-primary">
        <span class="kpi-title">إجمالي المبالغ المسجلة</span>
        <span class="kpi-value metric-num">${formatMoney(s.total_registered_amount)}</span>
        <span class="kpi-meta">إجمالي رسوم جميع التسجيلات</span>
      </div>
      <div class="kpi-card highlight-success">
        <span class="kpi-title">المبالغ المؤكد تحصيلها</span>
        <span class="kpi-value metric-num text-success">${formatMoney(s.total_confirmed_amount)}</span>
        <span class="kpi-meta">إيصالات مؤكدة: ${s.confirmed_receipts_count}</span>
      </div>
      <div class="kpi-card highlight-warning">
        <span class="kpi-title">المبالغ قيد المراجعة</span>
        <span class="kpi-value metric-num text-warning">${formatMoney(s.total_pending_amount)}</span>
        <span class="kpi-meta">إيصالات بانتظار الاعتماد: ${s.pending_receipts_count}</span>
      </div>
    `;
  }

  // Table 1: Registrations per Day
  const daysWrap = document.getElementById('overview-days-table');
  if (daysWrap) {
    daysWrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>اليوم</th>
            <th>المشرفان المخصصان</th>
            <th>إجمالي التسجيلات</th>
            <th>طلبة / دكاترة</th>
            <th>المبالغ المسجلة</th>
            <th>المؤكد تحصيله</th>
          </tr>
        </thead>
        <tbody>
          ${data.registrations_by_day.map((d) => `
            <tr>
              <td><strong>${escapeHtml(d.day_name)}</strong></td>
              <td style="font-size:0.8rem;">${escapeHtml(d.supervisor_1)} ، ${escapeHtml(d.supervisor_2)}</td>
              <td class="metric-num"><strong>${d.total_count}</strong></td>
              <td class="metric-num">${d.students_count} ط / ${d.doctors_count} د</td>
              <td class="metric-num">${formatMoney(d.registered_amount)}</td>
              <td class="metric-num text-success">${formatMoney(d.confirmed_amount)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  // Table 2: Registrations per Supervisor
  const supsWrap = document.getElementById('overview-supervisors-table');
  if (supsWrap) {
    if (data.registrations_by_supervisor.length === 0) {
      supsWrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لم تتم إضافة مشرفين بعد</div>
          <div class="empty-state-desc">انتقل إلى قسم "إدارة المشرفين" لإضافة المشرفين وتوزيعهم على الأيام.</div>
        </div>
      `;
    } else {
      supsWrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>اسم المشرف</th>
              <th>إجمالي التسجيلات</th>
              <th>طلبة / دكاترة</th>
              <th>المبالغ المسجلة</th>
              <th>المؤكد تحصيله</th>
            </tr>
          </thead>
          <tbody>
            ${data.registrations_by_supervisor.map((sup) => `
              <tr>
                <td><strong>${escapeHtml(sup.supervisor_name)}</strong></td>
                <td class="metric-num"><strong>${sup.total_count}</strong></td>
                <td class="metric-num">${sup.students_count} ط / ${sup.doctors_count} د</td>
                <td class="metric-num">${formatMoney(sup.registered_amount)}</td>
                <td class="metric-num text-success">${formatMoney(sup.confirmed_amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }
  }

  // Table 3: Recent Registrations
  const recentWrap = document.getElementById('overview-recent-table');
  if (recentWrap) {
    if (data.recent_registrations.length === 0) {
      recentWrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لا توجد أي تسجيلات في قاعدة البيانات حالياً (0)</div>
          <div class="empty-state-desc">ستظهر التسجيلات هنا تلقائياً فور بدء التسجيل الفعلي من قِبل المشرفين.</div>
        </div>
      `;
    } else {
      recentWrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>رقم التسجيل</th>
              <th>الاسم بالعربية</th>
              <th>الاسم بالإنجليزية</th>
              <th>التصنيف</th>
              <th>الرسوم</th>
              <th>حالة التحصيل</th>
              <th>المشرف واليوم</th>
              <th>التاريخ والوقت</th>
              <th>التفاصيل</th>
            </tr>
          </thead>
          <tbody>
            ${data.recent_registrations.map((r) => `
              <tr>
                <td class="metric-num text-accent">${escapeHtml(r.registration_number)}</td>
                <td><strong>${escapeHtml(r.name_ar)}</strong></td>
                <td class="font-en">${escapeHtml(r.name_en)}</td>
                <td>${escapeHtml(r.category_label)} ${r.academic_year ? `(${escapeHtml(r.academic_year)})` : ''}</td>
                <td class="metric-num">${formatMoney(r.fee_amount)}</td>
                <td>${renderPaymentStatusBadge(r.payment_status)}</td>
                <td>${escapeHtml(r.supervisor_name)} — ${escapeHtml(r.registration_day_name)}</td>
                <td class="metric-num">${escapeHtml(r.registration_date)} ${escapeHtml(r.registration_time)}</td>
                <td>
                  <button type="button" class="btn btn-secondary btn-sm" data-open-participant="${r.id}">عرض / تعديل</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
      recentWrap.querySelectorAll('[data-open-participant]').forEach((btn) => {
        btn.addEventListener('click', () => openParticipantDetailsModal(Number(btn.getAttribute('data-open-participant'))));
      });
    }
  }
}

function renderPaymentStatusBadge(status) {
  if (status === 'confirmed') {
    return `<span class="status-pill pill-success">مؤكد التحصيل</span>`;
  }
  if (status === 'flagged') {
    return `<span class="status-pill pill-danger">مرفوض / ملاحظة</span>`;
  }
  return `<span class="status-pill pill-warning">قيد المراجعة</span>`;
}

// ----------------------------------------------------------------------------
// ADMIN TAB 2: SUPERVISORS MANAGEMENT
// ----------------------------------------------------------------------------

async function loadAdminSupervisors() {
  try {
    const data = await apiFetch('/api/admin/supervisors');
    AppState.supervisorsList = data.supervisors || [];
    document.getElementById('nav-badge-supervisors').textContent = AppState.supervisorsList.length;

    const wrap = document.getElementById('admin-supervisors-table-wrap');
    if (!wrap) return;

    if (AppState.supervisorsList.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">قائمة المشرفين فارغة حالياً</div>
          <div class="empty-state-desc">اضغط على زر "+ إضافة مشرف جديد" لإضافة مشرفي التسجيل ثم توزيعهم على أيام الأسبوع.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>اسم المشرف</th>
            <th>رقم الهاتف</th>
            <th>رمز المشرف</th>
            <th>الأيام الموزع عليها حالياً</th>
            <th>الحالة</th>
            <th>إجمالي تسجيلاته</th>
            <th>إجمالي المبالغ</th>
            <th>إجراءات الإدارة</th>
          </tr>
        </thead>
        <tbody>
          ${AppState.supervisorsList.map((s, idx) => {
            const daysBadges = s.assigned_days && s.assigned_days.length > 0
              ? s.assigned_days.map((d) => `<span class="status-pill pill-info">${escapeHtml(d.day_name)} (مشرف ${d.slot_number})</span>`).join(' ')
              : '<span class="text-muted">غير موزع حالياً</span>';
            return `
              <tr>
                <td class="metric-num">${idx + 1}</td>
                <td><strong>${escapeHtml(s.name)}</strong></td>
                <td class="font-en">${escapeHtml(s.phone || '—')}</td>
                <td class="font-en">${s.access_pin ? '••••' : 'بدون رمز'}</td>
                <td>${daysBadges}</td>
                <td>
                  ${s.is_active
                    ? '<span class="status-pill pill-success">نشط</span>'
                    : '<span class="status-pill pill-danger">معطل مؤقتاً</span>'}
                </td>
                <td class="metric-num"><strong>${s.registrations_count || 0}</strong></td>
                <td class="metric-num">${formatMoney(s.total_amount || 0)}</td>
                <td>
                  <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                    <button type="button" class="btn btn-secondary btn-sm" data-edit-sup="${s.id}">تعديل</button>
                    <button type="button" class="btn ${s.is_active ? 'btn-warning' : 'btn-success'} btn-sm" data-toggle-sup="${s.id}">
                      ${s.is_active ? 'تعطيل مؤقت' : 'تفعيل'}
                    </button>
                    <button type="button" class="btn btn-danger btn-sm" data-delete-sup="${s.id}">حذف</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-edit-sup]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sup = AppState.supervisorsList.find((x) => x.id === Number(btn.getAttribute('data-edit-sup')));
        if (sup) openSupervisorModal(sup);
      });
    });

    wrap.querySelectorAll('[data-toggle-sup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sup = AppState.supervisorsList.find((x) => x.id === Number(btn.getAttribute('data-toggle-sup')));
        if (!sup) return;
        try {
          await apiFetch(`/api/admin/supervisors/${sup.id}`, {
            method: 'PUT',
            body: JSON.stringify({ is_active: !sup.is_active })
          });
          showToast(`تم ${!sup.is_active ? 'تفعيل' : 'تعطيل'} المشرف "${sup.name}" بنجاح.`, 'success');
          loadAdminSupervisors();
          loadPublicOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });

    wrap.querySelectorAll('[data-delete-sup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const sup = AppState.supervisorsList.find((x) => x.id === Number(btn.getAttribute('data-delete-sup')));
        if (!sup) return;
        if (!confirm(`هل أنت متأكد من حذف المشرف "${sup.name}"؟ (لن تتأثر التسجيلات السابقة المسجلة باسمه)`)) return;
        try {
          const res = await apiFetch(`/api/admin/supervisors/${sup.id}`, { method: 'DELETE' });
          showToast(res.message, 'success');
          loadAdminSupervisors();
          loadPublicOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openSupervisorModal(sup = null) {
  const modal = document.getElementById('modal-supervisor-form');
  const title = document.getElementById('sup-modal-title');
  if (!modal) return;

  document.getElementById('sup-form-id').value = sup ? sup.id : '';
  document.getElementById('sup-form-name').value = sup ? sup.name : '';
  document.getElementById('sup-form-phone').value = sup ? (sup.phone || '') : '';
  document.getElementById('sup-form-pin').value = sup ? (sup.access_pin || '') : '';
  document.getElementById('sup-form-notes').value = sup ? (sup.notes || '') : '';
  document.getElementById('sup-form-active').checked = sup ? Boolean(sup.is_active) : true;

  if (title) title.textContent = sup ? `تعديل بيانات المشرف: ${sup.name}` : 'إضافة مشرف جديد';
  modal.classList.remove('is-hidden');
  document.getElementById('sup-form-name').focus();
}

async function handleSaveSupervisorForm(e) {
  e.preventDefault();
  const id = document.getElementById('sup-form-id').value;
  const payload = {
    name: document.getElementById('sup-form-name').value.trim(),
    phone: document.getElementById('sup-form-phone').value.trim(),
    access_pin: document.getElementById('sup-form-pin').value.trim(),
    notes: document.getElementById('sup-form-notes').value.trim(),
    is_active: document.getElementById('sup-form-active').checked
  };

  try {
    if (id) {
      const res = await apiFetch(`/api/admin/supervisors/${id}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      showToast(res.message, 'success');
    } else {
      const res = await apiFetch('/api/admin/supervisors', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      showToast(res.message, 'success');
    }

    document.getElementById('modal-supervisor-form')?.classList.add('is-hidden');
    loadAdminSupervisors();
    loadPublicOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// ADMIN TAB 3: REGISTRATION DAYS & 2-SUPERVISOR DISTRIBUTION
// ----------------------------------------------------------------------------

async function loadAdminDaysAndDistribution() {
  try {
    const [daysRes, supsRes] = await Promise.all([
      apiFetch('/api/admin/days'),
      apiFetch('/api/admin/supervisors')
    ]);

    AppState.daysList = daysRes.days || [];
    AppState.supervisorsList = supsRes.supervisors || [];

    const wrap = document.getElementById('admin-days-distribution-wrap');
    if (!wrap) return;

    const buildSupOptions = (selectedId) => {
      let html = `<option value="">-- غير محدد (فارغ) --</option>`;
      for (const s of AppState.supervisorsList) {
        const sel = Number(selectedId) === Number(s.id) ? 'selected' : '';
        const statusSuffix = s.is_active ? '' : ' (معطل مؤقتاً)';
        html += `<option value="${s.id}" ${sel}>${escapeHtml(s.name)}${statusSuffix}</option>`;
      }
      return html;
    };

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>ترتيب</th>
            <th>اسم يوم التسجيل</th>
            <th>حالة اليوم</th>
            <th>المشرف الأول (المقعد 1)</th>
            <th>المشرف الثاني (المقعد 2)</th>
            <th>عدد المسجلين في اليوم</th>
            <th>إجراءات سريعة</th>
          </tr>
        </thead>
        <tbody>
          ${AppState.daysList.map((d) => `
            <tr data-day-row="${d.id}">
              <td class="metric-num">${d.display_order}</td>
              <td>
                <input type="text" class="form-input day-name-edit-input" data-day-name-id="${d.id}" value="${escapeHtml(d.day_name)}" style="min-height:38px;max-width:160px;" />
              </td>
              <td>
                <label style="display:inline-flex;align-items:center;gap:0.4rem;cursor:pointer;">
                  <input type="checkbox" class="day-active-checkbox" data-day-active-id="${d.id}" ${d.is_active ? 'checked' : ''} />
                  <span>${d.is_active ? 'مفعل' : 'معطل'}</span>
                </label>
              </td>
              <td>
                <select class="form-select day-slot1-select" data-day-id="${d.id}" style="min-height:40px;">
                  ${buildSupOptions(d.slot_1?.supervisor_id)}
                </select>
              </td>
              <td>
                <select class="form-select day-slot2-select" data-day-id="${d.id}" style="min-height:40px;">
                  ${buildSupOptions(d.slot_2?.supervisor_id)}
                </select>
              </td>
              <td class="metric-num"><strong>${d.registrations_count || 0}</strong></td>
              <td>
                <button type="button" class="btn btn-primary btn-sm" data-save-single-day="${d.id}">
                  حفظ هذا اليوم
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-save-single-day]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dayId = Number(btn.getAttribute('data-save-single-day'));
        const row = wrap.querySelector(`tr[data-day-row="${dayId}"]`);
        if (!row) return;

        const dayName = row.querySelector('.day-name-edit-input')?.value.trim() || '';
        const isActive = row.querySelector('.day-active-checkbox')?.checked ?? true;
        const sup1 = row.querySelector('.day-slot1-select')?.value || null;
        const sup2 = row.querySelector('.day-slot2-select')?.value || null;

        try {
          await apiFetch(`/api/admin/days/${dayId}`, {
            method: 'PUT',
            body: JSON.stringify({ day_name: dayName, is_active: isActive })
          });
          const res = await apiFetch(`/api/admin/days/${dayId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({ supervisor_1_id: sup1, supervisor_2_id: sup2 })
          });
          showToast(res.message, 'success');
          loadAdminDaysAndDistribution();
          loadPublicOverview();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveAllDayAssignments() {
  const wrap = document.getElementById('admin-days-distribution-wrap');
  if (!wrap) return;

  const rows = wrap.querySelectorAll('tr[data-day-row]');
  const assignments = [];

  for (const row of rows) {
    const dayId = Number(row.getAttribute('data-day-row'));
    const dayName = row.querySelector('.day-name-edit-input')?.value.trim() || '';
    const isActive = row.querySelector('.day-active-checkbox')?.checked ?? true;
    const sup1 = row.querySelector('.day-slot1-select')?.value || null;
    const sup2 = row.querySelector('.day-slot2-select')?.value || null;

    await apiFetch(`/api/admin/days/${dayId}`, {
      method: 'PUT',
      body: JSON.stringify({ day_name: dayName, is_active: isActive })
    });

    assignments.push({
      day_id: dayId,
      supervisor_1_id: sup1,
      supervisor_2_id: sup2
    });
  }

  try {
    const res = await apiFetch('/api/admin/days/bulk-assign', {
      method: 'POST',
      body: JSON.stringify({ assignments })
    });
    showToast(res.message, 'success');
    loadAdminDaysAndDistribution();
    loadPublicOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// ADMIN TAB 4: PARTICIPANTS MANAGEMENT (TABLE, SEARCH, FILTER, DETAILS/EDIT)
// ----------------------------------------------------------------------------

async function loadAdminParticipants() {
  try {
    const params = new URLSearchParams();
    const search = document.getElementById('filter-search')?.value.trim() || '';
    const day = document.getElementById('filter-day')?.value || '';
    const supervisor = document.getElementById('filter-supervisor')?.value || '';
    const category = document.getElementById('filter-category')?.value || '';
    const year = document.getElementById('filter-year')?.value || '';
    const payment = document.getElementById('filter-payment')?.value || '';
    const source = document.getElementById('filter-source')?.value || '';
    const sort = document.getElementById('filter-sort')?.value || 'newest';
    const dupsOnly = document.getElementById('filter-duplicates-only')?.checked ? '1' : '';

    if (search) params.set('search', search);
    if (day) params.set('day', day);
    if (supervisor) params.set('supervisor', supervisor);
    if (category) params.set('category', category);
    if (year) params.set('academic_year', year);
    if (payment) params.set('payment_status', payment);
    if (source) params.set('source', source);
    if (sort) params.set('sort', sort);
    if (dupsOnly) params.set('duplicates_only', '1');

    const data = await apiFetch(`/api/admin/participants?${params.toString()}`);
    AppState.participantsList = data.participants || [];

    // Populate dynamic day & supervisor filter dropdowns
    populateParticipantFilterDropdowns(data.filter_options);

    document.getElementById('participants-filtered-count').textContent = data.total || 0;
    document.getElementById('participants-filtered-amount').textContent = formatMoney(data.total_amount || 0);

    const wrap = document.getElementById('admin-participants-table-wrap');
    if (!wrap) return;

    if (AppState.participantsList.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لا توجد تسجيلات مطابقة للبحث أو قاعدة البيانات فارغة</div>
          <div class="empty-state-desc">عند تسجيل المشاركين ستظهر جميع بياناتهم وإيصالاتهم هنا.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>رقم التسجيل</th>
            <th>الاسم العربي</th>
            <th>الاسم الإنجليزي</th>
            <th>التصنيف</th>
            <th>السنة الدراسية</th>
            <th>رسوم التسجيل</th>
            <th>حالة التحصيل</th>
            <th>اسم المشرف</th>
            <th>يوم التسجيل</th>
            <th>تاريخ التسجيل</th>
            <th>وقت التسجيل</th>
            <th>الإيصال</th>
            <th>التفاصيل</th>
          </tr>
        </thead>
        <tbody>
          ${AppState.participantsList.map((p) => `
            <tr>
              <td class="metric-num text-accent">
                <strong>${escapeHtml(p.registration_number)}</strong>
                ${p.is_duplicate_override ? '<div style="margin-top:2px;"><span class="status-pill pill-warning" style="font-size:0.66rem;">تنبيه تكرار</span></div>' : ''}
              </td>
              <td><strong>${escapeHtml(p.name_ar)}</strong></td>
              <td class="font-en">${escapeHtml(p.name_en)}</td>
              <td><span class="status-pill ${p.category === 'doctor' ? 'pill-gold' : 'pill-info'}">${escapeHtml(p.category_label)}</span></td>
              <td>${escapeHtml(p.academic_year || '—')}</td>
              <td class="metric-num"><strong>${formatMoney(p.fee_amount)}</strong></td>
              <td>${renderPaymentStatusBadge(p.payment_status)}</td>
              <td>${escapeHtml(p.supervisor_name)}</td>
              <td>${escapeHtml(p.registration_day_name)}</td>
              <td class="metric-num">${escapeHtml(p.registration_date)}</td>
              <td class="metric-num">${escapeHtml(p.registration_time)}</td>
              <td>
                ${p.has_receipt_image
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-view-receipt="${p.id}" data-receipt-name="${escapeHtml(p.name_ar)}">معاينة الإيصال</button>`
                  : p.external_receipt_ref
                    ? `<span class="status-pill pill-info" title="${escapeHtml(p.external_receipt_ref)}">مرجع مستورد</span>`
                    : '<span class="text-muted">بدون صورة</span>'}
              </td>
              <td>
                <button type="button" class="btn btn-primary btn-sm" data-open-participant="${p.id}">
                  التفاصيل / تعديل
                </button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-view-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openReceiptViewerModal(Number(btn.getAttribute('data-view-receipt')), btn.getAttribute('data-receipt-name'), true);
      });
    });

    wrap.querySelectorAll('[data-open-participant]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openParticipantDetailsModal(Number(btn.getAttribute('data-open-participant')));
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function populateParticipantFilterDropdowns(filterOptions) {
  if (!filterOptions) return;
  const daySel = document.getElementById('filter-day');
  const supSel = document.getElementById('filter-supervisor');

  if (daySel) {
    const currentDay = daySel.value;
    const days = filterOptions.days || [];
    daySel.innerHTML = `<option value="">جميع الأيام</option>` +
      days.map((d) => `<option value="${escapeHtml(d)}" ${currentDay === d ? 'selected' : ''}>${escapeHtml(d)}</option>`).join('');
  }

  if (supSel) {
    const currentSup = supSel.value;
    const sups = filterOptions.supervisors || [];
    supSel.innerHTML = `<option value="">جميع المشرفين</option>` +
      sups.map((s) => `<option value="${escapeHtml(s)}" ${currentSup === s ? 'selected' : ''}>${escapeHtml(s)}</option>`).join('');
  }
}

async function openParticipantDetailsModal(participantId) {
  try {
    const data = await apiFetch(`/api/admin/participants/${participantId}`);
    const p = data.participant;
    const similar = data.similar_records || [];
    AppState.currentParticipantDetail = p;

    const modal = document.getElementById('modal-participant-details');
    const regNumEl = document.getElementById('detail-modal-reg-num');
    const bodyEl = document.getElementById('participant-modal-body');

    if (regNumEl) regNumEl.textContent = p.registration_number;

    const years = ['السنة الأولى', 'السنة الثانية', 'السنة الثالثة', 'السنة الرابعة', 'سنة الامتياز'];

    bodyEl.innerHTML = `
      <div class="form-grid-2">
        <div>
          <div class="form-group">
            <label class="form-label">الاسم الكامل باللغة العربية</label>
            <input type="text" id="edit-p-name-ar" class="form-input" value="${escapeHtml(p.name_ar)}" />
          </div>
          <div class="form-group">
            <label class="form-label">الاسم الكامل باللغة الإنجليزية</label>
            <input type="text" id="edit-p-name-en" class="form-input input-ltr" value="${escapeHtml(p.name_en)}" />
          </div>
          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">تصنيف المشارك</label>
              <select id="edit-p-category" class="form-select">
                <option value="student" ${p.category === 'student' ? 'selected' : ''}>طالب</option>
                <option value="doctor" ${p.category === 'doctor' ? 'selected' : ''}>دكتور</option>
              </select>
            </div>
            <div class="form-group" id="edit-p-year-wrap" class="${p.category === 'doctor' ? 'is-hidden' : ''}">
              <label class="form-label">السنة الدراسية</label>
              <select id="edit-p-year" class="form-select">
                ${years.map((y) => `<option value="${y}" ${p.academic_year === y ? 'selected' : ''}>${y}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="form-grid-2">
            <div class="form-group">
              <label class="form-label">رسوم التسجيل (د.ل)</label>
              <input type="number" step="0.5" id="edit-p-fee" class="form-input input-ltr" value="${p.fee_amount}" />
            </div>
            <div class="form-group">
              <label class="form-label">حالة التحصيل المالي</label>
              <select id="edit-p-payment-status" class="form-select">
                <option value="pending" ${p.payment_status === 'pending' ? 'selected' : ''}>قيد المراجعة</option>
                <option value="confirmed" ${p.payment_status === 'confirmed' ? 'selected' : ''}>مؤكد التحصيل</option>
                <option value="flagged" ${p.payment_status === 'flagged' ? 'selected' : ''}>مرفوض / يحتاج مراجعة</option>
              </select>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">ملاحظات مراجعة الدفع / الإدارة</label>
            <input type="text" id="edit-p-payment-notes" class="form-input" value="${escapeHtml(p.payment_notes || '')}" placeholder="أضف ملاحظة حول التحصيل أو المراجعة..." />
          </div>

          <div style="padding:0.85rem;background:var(--surface-subtle);border-radius:var(--radius-control);font-size:0.82rem;display:flex;flex-direction:column;gap:0.3rem;">
            <div><strong>المشرف المسجل:</strong> ${escapeHtml(p.supervisor_name)}</div>
            <div><strong>يوم التسجيل:</strong> ${escapeHtml(p.registration_day_name)}</div>
            <div><strong>تاريخ ووقت التسجيل (توقيت ليبيا):</strong> <span class="metric-num">${escapeHtml(p.registration_date)} — ${escapeHtml(p.registration_time)}</span></div>
            <div><strong>مصدر التسجيل:</strong> <span class="status-pill pill-info">${escapeHtml(p.source)}</span></div>
            ${p.payment_confirmed_by ? `<div><strong>تم تأكيد التحصيل بواسطة:</strong> ${escapeHtml(p.payment_confirmed_by)} (${escapeHtml(p.payment_confirmed_at)})</div>` : ''}
          </div>
        </div>

        <!-- Receipt Image Preview Column -->
        <div style="display:flex;flex-direction:column;gap:0.85rem;">
          <label class="form-label">صورة إيصال الدفع المرفق</label>
          ${p.has_receipt_image
            ? `
              <div style="background:#05070B;border:1px solid var(--border-strong);border-radius:var(--radius-card);padding:0.75rem;text-align:center;">
                <img src="${getReceiptImageUrl(p.id)}" alt="إيصال الدفع" style="max-width:100%;max-height:340px;object-fit:contain;border-radius:6px;" />
              </div>
            `
            : p.external_receipt_ref
              ? `<div class="empty-state-box" style="background:var(--surface-subtle);border-radius:var(--radius-card);">
                   <div class="empty-state-title">مرجع إيصال مستورد</div>
                   <div class="empty-state-desc font-en">${escapeHtml(p.external_receipt_ref)}</div>
                 </div>`
              : `<div class="empty-state-box" style="background:var(--surface-subtle);border-radius:var(--radius-card);">
                   <div class="empty-state-title">لا توجد صورة إيصال</div>
                 </div>`
          }

          ${similar.length > 0 ? `
            <div style="padding:0.85rem;background:var(--status-warning-soft);border:1px solid var(--status-warning-border);border-radius:var(--radius-control);">
              <div style="font-weight:700;color:var(--status-warning);font-size:0.85rem;margin-bottom:0.4rem;">
                سجلات مشابهة محتملة في قاعدة البيانات (${similar.length}):
              </div>
              ${similar.map((sim) => `
                <div style="font-size:0.8rem;margin-bottom:0.25rem;">
                  • <strong>${escapeHtml(sim.registration_number)}</strong>: ${escapeHtml(sim.name_ar)} (${escapeHtml(sim.match_reason)})
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;

    const catSel = document.getElementById('edit-p-category');
    const yearWrap = document.getElementById('edit-p-year-wrap');
    catSel?.addEventListener('change', () => {
      yearWrap?.classList.toggle('is-hidden', catSel.value === 'doctor');
    });

    modal?.classList.remove('is-hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveParticipantModal() {
  const p = AppState.currentParticipantDetail;
  if (!p) return;

  const payload = {
    name_ar: document.getElementById('edit-p-name-ar')?.value.trim(),
    name_en: document.getElementById('edit-p-name-en')?.value.trim(),
    category: document.getElementById('edit-p-category')?.value,
    academic_year: document.getElementById('edit-p-year')?.value,
    fee_amount: Number(document.getElementById('edit-p-fee')?.value || 0),
    payment_status: document.getElementById('edit-p-payment-status')?.value,
    payment_notes: document.getElementById('edit-p-payment-notes')?.value.trim(),
    duplicate_reviewed: true
  };

  try {
    const res = await apiFetch(`/api/admin/participants/${p.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast(res.message, 'success');
    document.getElementById('modal-participant-details')?.classList.add('is-hidden');
    loadAdminParticipants();
    loadAdminDashboardOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleDeleteParticipantModal() {
  const p = AppState.currentParticipantDetail;
  if (!p) return;
  if (!confirm(`هل أنت متأكد من حذف تسجيل المشارك "${p.name_ar}" (${p.registration_number}) نهائياً؟`)) return;

  try {
    const res = await apiFetch(`/api/admin/participants/${p.id}`, { method: 'DELETE' });
    showToast(res.message, 'success');
    document.getElementById('modal-participant-details')?.classList.add('is-hidden');
    loadAdminParticipants();
    loadAdminDashboardOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// ADMIN TAB 5: RECEIPTS VERIFICATION CENTER
// ----------------------------------------------------------------------------

async function loadAdminReceiptsCenter() {
  try {
    const params = new URLSearchParams();
    if (AppState.receiptFilterStatus) {
      params.set('payment_status', AppState.receiptFilterStatus);
    }
    const data = await apiFetch(`/api/admin/participants?${params.toString()}`);
    const list = data.participants || [];

    const wrap = document.getElementById('admin-receipts-table-wrap');
    if (!wrap) return;

    if (list.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لا توجد إيصالات في هذه القائمة حالياً</div>
          <div class="empty-state-desc">جميع الإيصالات المرفوعة من المشرفين ستظهر هنا لمراجعتها وتأكيد تحصيل مبالغها.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>رقم التسجيل</th>
            <th>اسم المشارك</th>
            <th>الفئة</th>
            <th>المبلغ</th>
            <th>المشرف واليوم</th>
            <th>حالة التحصيل الحالية</th>
            <th>صورة الإيصال</th>
            <th>اعتماد التحصيل المالي</th>
          </tr>
        </thead>
        <tbody>
          ${list.map((p) => `
            <tr>
              <td class="metric-num text-accent"><strong>${escapeHtml(p.registration_number)}</strong></td>
              <td>
                <div><strong>${escapeHtml(p.name_ar)}</strong></div>
                <div class="font-en text-muted" style="font-size:0.78rem;">${escapeHtml(p.name_en)}</div>
              </td>
              <td>${escapeHtml(p.category_label)} ${p.academic_year ? `(${escapeHtml(p.academic_year)})` : ''}</td>
              <td class="metric-num"><strong>${formatMoney(p.fee_amount)}</strong></td>
              <td>${escapeHtml(p.supervisor_name)} — ${escapeHtml(p.registration_day_name)}</td>
              <td>${renderPaymentStatusBadge(p.payment_status)}</td>
              <td>
                ${p.has_receipt_image
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-view-receipt="${p.id}" data-receipt-name="${escapeHtml(p.name_ar)}">فتح ومعاينة الإيصال</button>`
                  : '<span class="text-muted">لا توجد صورة</span>'}
              </td>
              <td>
                <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
                  <button type="button" class="btn btn-success btn-sm" data-quick-verify="${p.id}" data-status="confirmed" ${p.payment_status === 'confirmed' ? 'disabled' : ''}>
                    تأكيد التحصيل
                  </button>
                  <button type="button" class="btn btn-warning btn-sm" data-quick-verify="${p.id}" data-status="pending" ${p.payment_status === 'pending' ? 'disabled' : ''}>
                    قيد المراجعة
                  </button>
                  <button type="button" class="btn btn-danger btn-sm" data-quick-verify="${p.id}" data-status="flagged" ${p.payment_status === 'flagged' ? 'disabled' : ''}>
                    رفض / ملاحظة
                  </button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;

    wrap.querySelectorAll('[data-view-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openReceiptViewerModal(Number(btn.getAttribute('data-view-receipt')), btn.getAttribute('data-receipt-name'), true);
      });
    });

    wrap.querySelectorAll('[data-quick-verify]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.getAttribute('data-quick-verify'));
        const status = btn.getAttribute('data-status');
        await verifyParticipantPayment(id, status);
        loadAdminReceiptsCenter();
        loadAdminDashboardOverview();
      });
    });
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function verifyParticipantPayment(participantId, status) {
  try {
    const res = await apiFetch(`/api/admin/participants/${participantId}/verify-payment`, {
      method: 'PUT',
      body: JSON.stringify({ payment_status: status })
    });
    showToast(res.message, 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openReceiptViewerModal(participantId, participantName, isAdmin = false) {
  const modal = document.getElementById('modal-receipt-viewer');
  const title = document.getElementById('receipt-viewer-title');
  const img = document.getElementById('receipt-viewer-img');
  const actions = document.getElementById('receipt-viewer-actions');

  if (!modal || !img) return;
  if (title) title.textContent = `معاينة إيصال الدفع: ${participantName || ''}`;
  img.src = getReceiptImageUrl(participantId);

  if (actions) {
    if (isAdmin) {
      actions.innerHTML = `
        <button type="button" class="btn btn-success" id="viewer-btn-confirm">تأكيد تحصيل هذا الإيصال</button>
        <button type="button" class="btn btn-danger" id="viewer-btn-flag">تسجيل ملاحظة / رفض</button>
        <button type="button" class="btn btn-secondary" id="viewer-btn-close">إغلاق</button>
      `;
      actions.querySelector('#viewer-btn-confirm')?.addEventListener('click', async () => {
        await verifyParticipantPayment(participantId, 'confirmed');
        modal.classList.add('is-hidden');
        if (AppState.currentAdminTab === 'receipts') loadAdminReceiptsCenter();
        if (AppState.currentAdminTab === 'participants') loadAdminParticipants();
        loadAdminDashboardOverview();
      });
      actions.querySelector('#viewer-btn-flag')?.addEventListener('click', async () => {
        await verifyParticipantPayment(participantId, 'flagged');
        modal.classList.add('is-hidden');
        if (AppState.currentAdminTab === 'receipts') loadAdminReceiptsCenter();
        if (AppState.currentAdminTab === 'participants') loadAdminParticipants();
        loadAdminDashboardOverview();
      });
      actions.querySelector('#viewer-btn-close')?.addEventListener('click', () => modal.classList.add('is-hidden'));
    } else {
      actions.innerHTML = `<button type="button" class="btn btn-secondary" id="viewer-btn-close">إغلاق المعاينة</button>`;
      actions.querySelector('#viewer-btn-close')?.addEventListener('click', () => modal.classList.add('is-hidden'));
    }
  }

  modal.classList.remove('is-hidden');
}

// ----------------------------------------------------------------------------
// ADMIN TAB 6: FINANCIAL REPORTS
// ----------------------------------------------------------------------------

async function loadAdminFinanceReport() {
  try {
    const data = await apiFetch('/api/admin/finance/report');
    const o = data.overall;

    const kpis = document.getElementById('finance-summary-kpis');
    if (kpis) {
      kpis.innerHTML = `
        <div class="kpi-card highlight-primary">
          <span class="kpi-title">إجمالي عدد التسجيلات</span>
          <span class="kpi-value metric-num">${o.total_registrations}</span>
          <span class="kpi-meta">${o.students_count} طالب | ${o.doctors_count} دكتور</span>
        </div>
        <div class="kpi-card highlight-primary">
          <span class="kpi-title">إجمالي المبالغ المسجلة</span>
          <span class="kpi-value metric-num">${formatMoney(o.total_registered_amount)}</span>
          <span class="kpi-meta">إجمالي قيَم التسجيلات في النظام</span>
        </div>
        <div class="kpi-card highlight-success">
          <span class="kpi-title">إجمالي المبالغ المؤكد تحصيلها</span>
          <span class="kpi-value metric-num text-success">${formatMoney(o.total_confirmed_amount)}</span>
          <span class="kpi-meta">تمت مراجعة إيصالاتها واعتمادها</span>
        </div>
        <div class="kpi-card highlight-warning">
          <span class="kpi-title">مبالغ قيد المراجعة والتحصيل</span>
          <span class="kpi-value metric-num text-warning">${formatMoney(o.total_pending_amount)}</span>
          <span class="kpi-meta">بانتظار مراجعة الإيصال</span>
        </div>
        <div class="kpi-card highlight-primary">
          <span class="kpi-title">إجمالي رسوم الطلبة</span>
          <span class="kpi-value metric-num text-accent">${formatMoney(o.students_registered_amount)}</span>
          <span class="kpi-meta">المؤكد منها: ${formatMoney(o.students_confirmed_amount)}</span>
        </div>
        <div class="kpi-card highlight-gold">
          <span class="kpi-title">إجمالي رسوم الدكاترة</span>
          <span class="kpi-value metric-num text-warning">${formatMoney(o.doctors_registered_amount)}</span>
          <span class="kpi-meta">المؤكد منها: ${formatMoney(o.doctors_confirmed_amount)}</span>
        </div>
      `;
    }

    // Supervisor Financial Table
    const supWrap = document.getElementById('finance-by-supervisor-table');
    if (supWrap) {
      if (data.by_supervisor.length === 0) {
        supWrap.innerHTML = `<div class="empty-state-box"><div class="empty-state-title">لا توجد بيانات مشرفين حتى الآن</div></div>`;
      } else {
        supWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>اسم المشرف</th>
                <th>عدد التسجيلات</th>
                <th>طلبة / دكاترة</th>
                <th>المبلغ المسجل</th>
                <th>المبلغ المؤكد تحصيله</th>
                <th>قيد المراجعة</th>
              </tr>
            </thead>
            <tbody>
              ${data.by_supervisor.map((s) => `
                <tr>
                  <td><strong>${escapeHtml(s.supervisor_name)}</strong></td>
                  <td class="metric-num"><strong>${s.registrations_count}</strong></td>
                  <td class="metric-num">${s.students_count} ط / ${s.doctors_count} د</td>
                  <td class="metric-num"><strong>${formatMoney(s.registered_amount)}</strong></td>
                  <td class="metric-num text-success"><strong>${formatMoney(s.confirmed_amount)}</strong></td>
                  <td class="metric-num text-warning">${formatMoney(s.pending_amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }

    // Day Financial Table
    const dayWrap = document.getElementById('finance-by-day-table');
    if (dayWrap) {
      dayWrap.innerHTML = `
        <table class="data-table">
          <thead>
            <tr>
              <th>يوم التسجيل</th>
              <th>عدد التسجيلات</th>
              <th>طلبة / دكاترة</th>
              <th>المبلغ المسجل</th>
              <th>المبلغ المؤكد تحصيله</th>
              <th>قيد المراجعة</th>
            </tr>
          </thead>
          <tbody>
            ${data.by_day.map((d) => `
              <tr>
                <td><strong>${escapeHtml(d.day_name)}</strong></td>
                <td class="metric-num"><strong>${d.registrations_count}</strong></td>
                <td class="metric-num">${d.students_count} ط / ${d.doctors_count} د</td>
                <td class="metric-num"><strong>${formatMoney(d.registered_amount)}</strong></td>
                <td class="metric-num text-success"><strong>${formatMoney(d.confirmed_amount)}</strong></td>
                <td class="metric-num text-warning">${formatMoney(d.pending_amount)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    // Year Financial Table
    const yearWrap = document.getElementById('finance-by-year-table');
    if (yearWrap) {
      if (data.by_year.length === 0) {
        yearWrap.innerHTML = `<div class="empty-state-box"><div class="empty-state-title">لا توجد تسجيلات بعد (0)</div></div>`;
      } else {
        yearWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>الفئة / السنة الدراسية</th>
                <th>عدد المسجلين</th>
                <th>المبلغ المسجل</th>
                <th>المبلغ المؤكد تحصيله</th>
              </tr>
            </thead>
            <tbody>
              ${data.by_year.map((y) => `
                <tr>
                  <td><strong>${escapeHtml(y.group_label)}</strong></td>
                  <td class="metric-num">${y.registrations_count}</td>
                  <td class="metric-num">${formatMoney(y.registered_amount)}</td>
                  <td class="metric-num text-success">${formatMoney(y.confirmed_amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }

    // Source Financial Table
    const srcWrap = document.getElementById('finance-by-source-table');
    if (srcWrap) {
      if (data.by_source.length === 0) {
        srcWrap.innerHTML = `<div class="empty-state-box"><div class="empty-state-title">لا توجد تسجيلات بعد (0)</div></div>`;
      } else {
        srcWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>مصدر التسجيل</th>
                <th>عدد التسجيلات</th>
                <th>المبلغ المسجل</th>
                <th>المبلغ المؤكد تحصيله</th>
              </tr>
            </thead>
            <tbody>
              ${data.by_source.map((src) => `
                <tr>
                  <td><span class="status-pill pill-info">${escapeHtml(src.source)}</span></td>
                  <td class="metric-num">${src.registrations_count}</td>
                  <td class="metric-num">${formatMoney(src.registered_amount)}</td>
                  <td class="metric-num text-success">${formatMoney(src.confirmed_amount)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// ADMIN TAB 7: FUTURE DATA IMPORT SYSTEM (EXCEL XLSX / CSV)
// ----------------------------------------------------------------------------

async function loadAdminImportHistory() {
  try {
    const data = await apiFetch('/api/admin/import/history');
    const batches = data.batches || [];
    const wrap = document.getElementById('import-history-table-wrap');
    if (!wrap) return;

    if (batches.length === 0) {
      wrap.innerHTML = `
        <div class="empty-state-box">
          <div class="empty-state-title">لم يتم تنفيذ أي عملية استيراد بيانات سابقة حتى الآن</div>
          <div class="empty-state-desc">النظام يبدأ بقاعدة بيانات نظيفة وفارغة تماماً، ومجهز لاستقبال ملف Excel أو CSV عند رفعه مستقبلاً.</div>
        </div>
      `;
      return;
    }

    wrap.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>اسم الملف</th>
            <th>الصيغة</th>
            <th>إجمالي الصفوف</th>
            <th>تم استيرادها</th>
            <th>تم تخطيها</th>
            <th>إجمالي المبالغ المستوردة</th>
            <th>بواسطة</th>
            <th>تاريخ ووقت الاستيراد</th>
          </tr>
        </thead>
        <tbody>
          ${batches.map((b) => `
            <tr>
              <td class="metric-num">${b.id}</td>
              <td><strong>${escapeHtml(b.file_name)}</strong></td>
              <td class="font-en">${escapeHtml(b.file_type)}</td>
              <td class="metric-num">${b.total_rows}</td>
              <td class="metric-num text-success"><strong>${b.imported_rows}</strong></td>
              <td class="metric-num text-muted">${b.skipped_rows}</td>
              <td class="metric-num">${formatMoney(b.total_imported_amount)}</td>
              <td>${escapeHtml(b.imported_by)}</td>
              <td class="metric-num">${escapeHtml(b.created_at)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error('Import history error:', err);
  }
}

async function handleImportFileSelected(file) {
  if (!file) return;

  try {
    const formData = new FormData();
    formData.append('import_file', file);

    showToast('جاري قراءة الملف وتحليل الأعمدة والبيانات...', 'info');
    const res = await apiFetch('/api/admin/import/parse', {
      method: 'POST',
      body: formData
    });

    AppState.importFileData = {
      file_name: res.file_name,
      file_type: res.file_type,
      headers: res.headers
    };
    AppState.importRawRows = res.raw_rows || [];
    AppState.importMapping = res.suggested_mapping || {};
    AppState.importAnalyzedRows = (res.analyzed_rows || []).map((r) => ({
      ...r,
      selected: Boolean(r.default_selected)
    }));

    document.getElementById('import-filename-label').textContent = `${res.file_name} (${res.raw_rows.length} صف)`;
    document.getElementById('import-preview-workspace')?.classList.remove('is-hidden');

    renderImportColumnMapping(res.headers, AppState.importMapping);
    renderImportPreviewAndSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderImportColumnMapping(headers, mapping) {
  const grid = document.getElementById('import-column-mapping-grid');
  if (!grid) return;

  const fields = [
    { key: 'name_ar', label: 'الاسم بالعربية' },
    { key: 'name_en', label: 'الاسم بالإنجليزية' },
    { key: 'category', label: 'التصنيف (طالب/دكتور)' },
    { key: 'academic_year', label: 'السنة الدراسية' },
    { key: 'fee_amount', label: 'المبلغ المالي السابق' },
    { key: 'supervisor_name', label: 'اسم المشرف السابق' },
    { key: 'registration_day_name', label: 'يوم التسجيل' },
    { key: 'registration_date', label: 'تاريخ التسجيل' },
    { key: 'registration_number', label: 'رقم التسجيل السابق' },
    { key: 'external_receipt_ref', label: 'مرجع / رابط الإيصال' }
  ];

  grid.innerHTML = fields.map((f) => `
    <div>
      <label class="form-label">${f.label}</label>
      <select class="form-select import-map-select" data-map-field="${f.key}">
        <option value="">-- غير مربوط --</option>
        ${headers.map((h) => `<option value="${escapeHtml(h)}" ${mapping[f.key] === h ? 'selected' : ''}>${escapeHtml(h)}</option>`).join('')}
      </select>
    </div>
  `).join('');

  grid.querySelectorAll('.import-map-select').forEach((sel) => {
    sel.addEventListener('change', () => {
      const field = sel.getAttribute('data-map-field');
      AppState.importMapping[field] = sel.value;
    });
  });
}

async function handleReanalyzeMapping() {
  try {
    const res = await apiFetch('/api/admin/import/reanalyze', {
      method: 'POST',
      body: JSON.stringify({
        raw_rows: AppState.importRawRows,
        mapping: AppState.importMapping
      })
    });

    AppState.importAnalyzedRows = (res.analyzed_rows || []).map((r) => ({
      ...r,
      selected: Boolean(r.default_selected)
    }));

    renderImportPreviewAndSummary();
    showToast('تم تحديث معاينة البيانات وفق ربط الأعمدة المحدد.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderImportPreviewAndSummary() {
  const rows = AppState.importAnalyzedRows;
  const selectedRows = rows.filter((r) => r.selected);
  const duplicateRows = rows.filter((r) => r.is_duplicate);
  const missingRows = rows.filter((r) => r.has_missing);
  const totalSelectedAmount = selectedRows.reduce((acc, r) => acc + Number(r.fee_amount || 0), 0);

  const metricsEl = document.getElementById('import-summary-metrics');
  if (metricsEl) {
    metricsEl.innerHTML = `
      <div class="kpi-card highlight-primary">
        <span class="kpi-title">إجمالي الصفوف في الملف</span>
        <span class="kpi-value metric-num">${rows.length}</span>
      </div>
      <div class="kpi-card highlight-success">
        <span class="kpi-title">التسجيلات المحددة للاستيراد</span>
        <span class="kpi-value metric-num text-success">${selectedRows.length}</span>
        <span class="kpi-meta">إجمالي مبالغها السابقة: ${formatMoney(totalSelectedAmount)}</span>
      </div>
      <div class="kpi-card highlight-warning">
        <span class="kpi-title">تسجيلات مكررة مكتشفة</span>
        <span class="kpi-value metric-num text-warning">${duplicateRows.length}</span>
        <span class="kpi-meta">يمكنك مراجعتها أو استثناؤها</span>
      </div>
      <div class="kpi-card highlight-gold">
        <span class="kpi-title">صفوف بها بيانات ناقصة</span>
        <span class="kpi-value metric-num">${missingRows.length}</span>
      </div>
    `;
  }

  const countBtn = document.getElementById('import-selected-count-btn');
  if (countBtn) countBtn.textContent = selectedRows.length;

  const wrap = document.getElementById('import-preview-table-wrap');
  if (!wrap) return;

  wrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>
            <input type="checkbox" id="import-select-all-checkbox" ${selectedRows.length === rows.length && rows.length > 0 ? 'checked' : ''} />
          </th>
          <th>#</th>
          <th>رقم التسجيل</th>
          <th>الاسم العربي</th>
          <th>الاسم الإنجليزي</th>
          <th>الفئة / السنة</th>
          <th>المبلغ السابق</th>
          <th>المشرف السابق</th>
          <th>التاريخ</th>
          <th>حالة الفحص والتحقق</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r, i) => `
          <tr>
            <td>
              <input type="checkbox" class="import-row-checkbox" data-row-idx="${i}" ${r.selected ? 'checked' : ''} />
            </td>
            <td class="metric-num">${r.row_index}</td>
            <td class="metric-num">${escapeHtml(r.registration_number || 'تلقائي')}</td>
            <td><strong>${escapeHtml(r.name_ar || '—')}</strong></td>
            <td class="font-en">${escapeHtml(r.name_en || '—')}</td>
            <td>${escapeHtml(r.category_label)} ${r.academic_year ? `(${escapeHtml(r.academic_year)})` : ''}</td>
            <td class="metric-num"><strong>${r.fee_amount !== null ? formatMoney(r.fee_amount) : '0 د.ل'}</strong></td>
            <td>${escapeHtml(r.supervisor_name)}</td>
            <td class="metric-num">${escapeHtml(r.registration_date || '—')}</td>
            <td>
              ${r.is_duplicate
                ? `<span class="status-pill pill-warning" title="${escapeHtml(r.duplicate_reasons.join(' | '))}">مكرر: ${escapeHtml(r.duplicate_reasons[0])}</span>`
                : r.has_missing
                  ? `<span class="status-pill pill-danger">${escapeHtml(r.missing_fields.join('، '))}</span>`
                  : `<span class="status-pill pill-success">جاهز للاستيراد</span>`}
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  wrap.querySelector('#import-select-all-checkbox')?.addEventListener('change', (e) => {
    const checked = e.target.checked;
    AppState.importAnalyzedRows.forEach((r) => { r.selected = checked; });
    renderImportPreviewAndSummary();
  });

  wrap.querySelectorAll('.import-row-checkbox').forEach((cb) => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.getAttribute('data-row-idx'));
      if (AppState.importAnalyzedRows[idx]) {
        AppState.importAnalyzedRows[idx].selected = cb.checked;
        renderImportPreviewAndSummary();
      }
    });
  });
}

async function handleCommitImport() {
  const selectedRows = AppState.importAnalyzedRows.filter((r) => r.selected);
  if (selectedRows.length === 0) {
    showToast('يرجى تحديد صف واحد على الأقل لاستيراده.', 'warning');
    return;
  }

  try {
    const res = await apiFetch('/api/admin/import/commit', {
      method: 'POST',
      body: JSON.stringify({
        file_name: AppState.importFileData?.file_name || 'imported.xlsx',
        file_type: AppState.importFileData?.file_type || 'XLSX',
        rows: AppState.importAnalyzedRows
      })
    });

    showToast(res.message, 'success');
    document.getElementById('import-preview-workspace')?.classList.add('is-hidden');
    document.getElementById('import-file-input').value = '';
    loadAdminImportHistory();
    loadAdminDashboardOverview();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ----------------------------------------------------------------------------
// ADMIN TAB 8: SITE SETTINGS & AUDIT LOGS
// ----------------------------------------------------------------------------

async function loadAdminSettingsAndLogs() {
  try {
    const data = await apiFetch('/api/admin/settings');
    const s = data.settings || {};

    document.getElementById('set-conf-title').value = s.conference_title || '';
    document.getElementById('set-conf-edition').value = s.conference_edition || '';
    document.getElementById('set-reg-prefix').value = s.reg_number_prefix || 'ICDS4';
    document.getElementById('set-conf-subtitle').value = s.conference_subtitle || '';
    document.getElementById('set-student-fee').value = s.student_fee || 30;
    document.getElementById('set-doctor-fee').value = s.doctor_fee || 60;
    document.getElementById('set-portal-code').value = s.supervisor_portal_code || '';
    document.getElementById('set-reg-open').checked = s.registration_open === '1';
    document.getElementById('set-require-pin').checked = s.require_supervisor_pin === '1';

    if (AppState.adminSession) {
      document.getElementById('cred-display-name').value = AppState.adminSession.display_name || '';
      document.getElementById('cred-username').value = AppState.adminSession.username || 'admin';
    }

    const logsWrap = document.getElementById('admin-audit-logs-wrap');
    if (logsWrap) {
      const logs = data.audit_logs || [];
      if (logs.length === 0) {
        logsWrap.innerHTML = `<div class="empty-state-box"><div class="empty-state-title">سجل العمليات فارغ حالياً</div></div>`;
      } else {
        logsWrap.innerHTML = `
          <table class="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>التاريخ والوقت (ليبيا)</th>
                <th>المنفذ</th>
                <th>الصلاحية</th>
                <th>نوع العملية</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map((l) => `
                <tr>
                  <td class="metric-num">${l.id}</td>
                  <td class="metric-num">${escapeHtml(l.created_at)}</td>
                  <td><strong>${escapeHtml(l.actor_name)}</strong></td>
                  <td><span class="status-pill ${l.actor_role === 'admin' ? 'pill-gold' : 'pill-info'}">${l.actor_role === 'admin' ? 'أدمن' : 'مشرف'}</span></td>
                  <td class="font-en" style="font-size:0.78rem;">${escapeHtml(l.action_type)}</td>
                  <td>${escapeHtml(l.description)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        `;
      }
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveSettingsForm(e) {
  e.preventDefault();
  const payload = {
    conference_title: document.getElementById('set-conf-title').value.trim(),
    conference_edition: document.getElementById('set-conf-edition').value.trim(),
    reg_number_prefix: document.getElementById('set-reg-prefix').value.trim(),
    conference_subtitle: document.getElementById('set-conf-subtitle').value.trim(),
    student_fee: Number(document.getElementById('set-student-fee').value),
    doctor_fee: Number(document.getElementById('set-doctor-fee').value),
    supervisor_portal_code: document.getElementById('set-portal-code').value.trim(),
    registration_open: document.getElementById('set-reg-open').checked,
    require_supervisor_pin: document.getElementById('set-require-pin').checked
  };

  try {
    const res = await apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast(res.message, 'success');
    loadPublicOverview();
    loadAdminSettingsAndLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleSaveAdminCredentials(e) {
  e.preventDefault();
  const payload = {
    display_name: document.getElementById('cred-display-name').value.trim(),
    new_username: document.getElementById('cred-username').value.trim(),
    current_password: document.getElementById('cred-current-password').value,
    new_password: document.getElementById('cred-new-password').value
  };

  try {
    const res = await apiFetch('/api/admin/settings/password', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    showToast(res.message, 'success');
    document.getElementById('cred-current-password').value = '';
    document.getElementById('cred-new-password').value = '';
    loadAdminSettingsAndLogs();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// INITIALIZE EVENT LISTENERS
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  startLibyaClock();
  initThemeToggle();
  loadPublicOverview();

  // Top Navigation & Hero CTA Buttons
  document.getElementById('nav-brand-home')?.addEventListener('click', () => switchMainView('home'));
  document.getElementById('nav-btn-home')?.addEventListener('click', () => switchMainView('home'));
  document.getElementById('nav-btn-supervisor')?.addEventListener('click', () => switchMainView('supervisor'));
  document.getElementById('nav-btn-admin')?.addEventListener('click', () => switchMainView('admin'));

  document.getElementById('hero-btn-start-reg')?.addEventListener('click', () => switchMainView('supervisor'));
  document.getElementById('hero-btn-open-admin')?.addEventListener('click', () => switchMainView('admin'));
  document.getElementById('home-schedule-go-reg')?.addEventListener('click', () => switchMainView('supervisor'));

  // Supervisor Portal Step Events
  document.getElementById('btn-confirm-supervisor-step')?.addEventListener('click', handleConfirmSupervisorSelection);
  document.getElementById('btn-change-supervisor')?.addEventListener('click', resetSupervisorSelectionStep);

  document.getElementById('btn-toggle-my-registrations')?.addEventListener('click', () => {
    const panel = document.getElementById('sup-my-registrations-panel');
    if (panel) {
      panel.classList.toggle('is-hidden');
      if (!panel.classList.contains('is-hidden')) {
        panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  });

  document.getElementById('btn-dismiss-success')?.addEventListener('click', () => {
    document.getElementById('reg-success-alert')?.classList.add('is-hidden');
  });

  // Category Selection (Student vs Doctor)
  document.getElementById('cat-card-student')?.addEventListener('click', () => {
    AppState.selectedCategory = 'student';
    updateCategoryFeeUI();
  });
  document.getElementById('cat-card-doctor')?.addEventListener('click', () => {
    AppState.selectedCategory = 'doctor';
    updateCategoryFeeUI();
  });

  // Academic Year Pills
  document.querySelectorAll('#academic-years-grid .year-pill-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      AppState.selectedYear = btn.getAttribute('data-year');
      document.querySelectorAll('#academic-years-grid .year-pill-btn').forEach((b) => {
        b.classList.toggle('is-selected', b === btn);
      });
      updateCategoryFeeUI();
    });
  });

  // Receipt Upload (Camera & Gallery)
  const camInput = document.getElementById('receipt-camera-input');
  const galInput = document.getElementById('receipt-gallery-input');

  document.getElementById('btn-trigger-camera')?.addEventListener('click', () => camInput?.click());
  document.getElementById('btn-trigger-gallery')?.addEventListener('click', () => galInput?.click());

  camInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleReceiptFileSelected(e.target.files[0]);
  });
  galInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleReceiptFileSelected(e.target.files[0]);
  });

  document.getElementById('btn-clear-receipt')?.addEventListener('click', clearReceiptFile);

  // Participant Registration Submit
  document.getElementById('participant-reg-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    submitParticipantRegistration(false);
  });

  // Duplicate Warning Modal Actions
  document.getElementById('btn-close-dup-modal')?.addEventListener('click', () => {
    document.getElementById('modal-duplicate-warning')?.classList.add('is-hidden');
  });
  document.getElementById('btn-cancel-dup-submit')?.addEventListener('click', () => {
    document.getElementById('modal-duplicate-warning')?.classList.add('is-hidden');
  });
  document.getElementById('btn-confirm-dup-submit')?.addEventListener('click', () => {
    submitParticipantRegistration(true);
  });

  // Admin Login / Logout / Tabs
  document.getElementById('admin-login-form')?.addEventListener('submit', handleAdminLogin);
  document.getElementById('btn-admin-logout')?.addEventListener('click', handleAdminLogout);

  document.querySelectorAll('#admin-nav-tabs .admin-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      switchAdminTab(btn.getAttribute('data-tab'));
    });
  });

  document.getElementById('btn-refresh-dashboard')?.addEventListener('click', loadAdminDashboardOverview);
  document.getElementById('btn-overview-see-all-participants')?.addEventListener('click', () => switchAdminTab('participants'));

  // Admin Supervisors Modal
  document.getElementById('btn-open-add-supervisor')?.addEventListener('click', () => openSupervisorModal(null));
  document.getElementById('btn-close-sup-modal')?.addEventListener('click', () => {
    document.getElementById('modal-supervisor-form')?.classList.add('is-hidden');
  });
  document.getElementById('btn-cancel-sup-modal')?.addEventListener('click', () => {
    document.getElementById('modal-supervisor-form')?.classList.add('is-hidden');
  });
  document.getElementById('supervisor-modal-form')?.addEventListener('submit', handleSaveSupervisorForm);

  // Admin Days & Distribution
  document.getElementById('btn-save-all-day-assignments')?.addEventListener('click', handleSaveAllDayAssignments);
  document.getElementById('btn-open-add-day')?.addEventListener('click', async () => {
    const dayName = prompt('أدخل اسم يوم التسجيل الإضافي (مثال: السبت):');
    if (!dayName || !dayName.trim()) return;
    try {
      const res = await apiFetch('/api/admin/days', {
        method: 'POST',
        body: JSON.stringify({ day_name: dayName.trim(), display_order: AppState.daysList.length + 1 })
      });
      showToast(res.message, 'success');
      loadAdminDaysAndDistribution();
      loadPublicOverview();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Admin Participants Search & Filters
  const filterIds = ['filter-search', 'filter-day', 'filter-supervisor', 'filter-category', 'filter-year', 'filter-payment', 'filter-source', 'filter-sort', 'filter-duplicates-only'];
  filterIds.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = el.tagName === 'INPUT' && el.type === 'text' ? 'input' : 'change';
    el.addEventListener(evt, () => loadAdminParticipants());
  });

  document.getElementById('btn-reset-filters')?.addEventListener('click', () => {
    ['filter-search', 'filter-day', 'filter-supervisor', 'filter-category', 'filter-year', 'filter-payment', 'filter-source'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    const sortEl = document.getElementById('filter-sort');
    if (sortEl) sortEl.value = 'newest';
    const dupEl = document.getElementById('filter-duplicates-only');
    if (dupEl) dupEl.checked = false;
    loadAdminParticipants();
  });

  // Participant Details Modal
  document.getElementById('btn-close-participant-modal')?.addEventListener('click', () => {
    document.getElementById('modal-participant-details')?.classList.add('is-hidden');
  });
  document.getElementById('btn-cancel-participant-modal')?.addEventListener('click', () => {
    document.getElementById('modal-participant-details')?.classList.add('is-hidden');
  });
  document.getElementById('btn-save-participant-modal')?.addEventListener('click', handleSaveParticipantModal);
  document.getElementById('btn-delete-participant-modal')?.addEventListener('click', handleDeleteParticipantModal);

  // Receipts Verification Center Filter Buttons
  document.querySelectorAll('.receipt-filter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      AppState.receiptFilterStatus = btn.getAttribute('data-status') || '';
      document.querySelectorAll('.receipt-filter-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      loadAdminReceiptsCenter();
    });
  });

  document.getElementById('btn-close-receipt-viewer')?.addEventListener('click', () => {
    document.getElementById('modal-receipt-viewer')?.classList.add('is-hidden');
  });

  // Finance Report Refresh
  document.getElementById('btn-refresh-finance')?.addEventListener('click', loadAdminFinanceReport);

  // Future Data Import Events
  const importInput = document.getElementById('import-file-input');
  document.getElementById('btn-choose-import-file')?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', (e) => {
    if (e.target.files?.[0]) handleImportFileSelected(e.target.files[0]);
  });
  document.getElementById('btn-cancel-import-preview')?.addEventListener('click', () => {
    document.getElementById('import-preview-workspace')?.classList.add('is-hidden');
    if (importInput) importInput.value = '';
  });
  document.getElementById('btn-reanalyze-mapping')?.addEventListener('click', handleReanalyzeMapping);
  document.getElementById('btn-commit-import')?.addEventListener('click', handleCommitImport);

  // Settings & Credentials Forms
  document.getElementById('admin-settings-form')?.addEventListener('submit', handleSaveSettingsForm);
  document.getElementById('admin-credentials-form')?.addEventListener('submit', handleSaveAdminCredentials);

  // Export Excel & CSV with Admin Token on Libyan Spider Cloud API
  document.getElementById('btn-export-xlsx')?.addEventListener('click', () => {
    window.open(`${CLOUD_API_BASE}/api/admin/participants-export?format=xlsx&admin_token=${encodeURIComponent(AppState.adminToken)}`, '_blank');
  });
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    window.open(`${CLOUD_API_BASE}/api/admin/participants-export?format=csv&admin_token=${encodeURIComponent(AppState.adminToken)}`, '_blank');
  });
});
