/**
 * ICDS 4th Edition Conference Registration Website
 * Frontend Application Logic (Connected to Libyan Spider Cloud DB & Local API)
 */

(function () {
  'use strict';

  const CLOUD_API_BASE = 'https://api.kurofangs.id.ly/icds';
  const IS_LOCAL_EXPRESS =
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') &&
    window.location.port === '3400';
  const API_BASE = IS_LOCAL_EXPRESS ? '' : CLOUD_API_BASE;

  // Application State
  const state = {
    currentView: 'register',
    days: [],
    selectedDayId: null,
    selectedDayName: 'الأحد',
    selectedCategory: 'student',
    studentFee: 30,
    doctorFee: 60,
    currencyShort: 'د.ل',
    receiptFile: null,
    receiptPreviewUrl: null,
    adminToken: sessionStorage.getItem('icds_admin_token') || '',
    adminUser: null,
    supervisors: [],
    adminDays: [],
    participants: [],
    pendingImportBatchId: null
  };

  // Helper: API Request
  async function apiFetch(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const headers = Object.assign({}, options.headers || {});

    if (state.adminToken) {
      headers['x-admin-token'] = state.adminToken;
    }

    if (!(options.body instanceof FormData) && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(url, Object.assign({}, options, { headers }));
    let data = null;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await res.json();
    } else {
      const text = await res.text();
      data = { error: text };
    }

    if (!res.ok) {
      const err = new Error((data && data.error) || 'حدث خطأ في الاتصال بالخادم.');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  // DOM Elements
  const els = {
    navButtons: document.querySelectorAll('[data-nav]'),
    mobileMenuBtn: document.getElementById('mobile-menu-btn'),
    mobileNavDrawer: document.getElementById('mobile-nav-drawer'),
    brandLogoBtn: document.getElementById('brand-logo-btn'),

    viewRegister: document.getElementById('view-register'),
    viewHome: document.getElementById('view-home'),
    viewAdmin: document.getElementById('view-admin'),

    dayButtonsContainer: document.getElementById('day-buttons-container'),
    supervisorSelect: document.getElementById('reg-supervisor-select'),
    nameArInput: document.getElementById('reg-name-ar'),
    nameEnInput: document.getElementById('reg-name-en'),
    catBtnStudent: document.getElementById('cat-btn-student'),
    catBtnDoctor: document.getElementById('cat-btn-doctor'),
    academicYearBlock: document.getElementById('academic-year-block'),
    academicYearSelect: document.getElementById('reg-academic-year'),
    feeDisplay: document.getElementById('reg-fee-display'),

    receiptInput: document.getElementById('reg-receipt-input'),
    receiptTriggerBtn: document.getElementById('receipt-trigger-btn'),
    receiptBtnLabel: document.getElementById('receipt-btn-label'),
    receiptPreviewBar: document.getElementById('receipt-preview-bar'),
    receiptThumbImg: document.getElementById('receipt-thumb-img'),
    receiptFileName: document.getElementById('receipt-file-name'),
    receiptViewFullBtn: document.getElementById('receipt-view-full-btn'),
    receiptCameraBtn: document.getElementById('receipt-camera-btn'),
    receiptClearBtn: document.getElementById('receipt-clear-btn'),

    regForm: document.getElementById('registration-form'),
    regFeedbackBox: document.getElementById('reg-feedback-box'),
    regSubmitBtn: document.getElementById('reg-submit-btn'),
    regSubmitText: document.getElementById('reg-submit-text'),

    homeGoRegisterBtn: document.getElementById('home-go-register-btn'),
    homeGoAdminBtn: document.getElementById('home-go-admin-btn'),

    adminLoginCard: document.getElementById('admin-login-card'),
    adminLoginForm: document.getElementById('admin-login-form'),
    adminUsernameInput: document.getElementById('admin-username'),
    adminPasswordInput: document.getElementById('admin-password'),
    adminLoginError: document.getElementById('admin-login-error'),
    adminWorkspace: document.getElementById('admin-panel-workspace'),
    adminLogoutBtn: document.getElementById('admin-logout-btn'),
    adminTabBtns: document.querySelectorAll('[data-admin-tab]'),

    lightboxModal: document.getElementById('lightbox-modal'),
    lightboxImg: document.getElementById('lightbox-img'),
    lightboxTitle: document.getElementById('lightbox-title'),
    lightboxCloseBtn: document.getElementById('lightbox-close-btn'),

    editModal: document.getElementById('edit-participant-modal'),
    editModalCloseBtn: document.getElementById('edit-modal-close-btn'),
    editForm: document.getElementById('edit-participant-form')
  };

  // ==========================================================================
  // 1. NAVIGATION & VIEW SWITCHING
  // ==========================================================================

  function switchView(viewName) {
    state.currentView = viewName;

    els.viewRegister.classList.toggle('hidden', viewName !== 'register');
    els.viewHome.classList.toggle('hidden', viewName !== 'home');
    els.viewAdmin.classList.toggle('hidden', viewName !== 'admin');

    els.navButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-nav') === viewName);
    });

    if (els.mobileNavDrawer) {
      els.mobileNavDrawer.classList.add('hidden');
      els.mobileMenuBtn.setAttribute('aria-expanded', 'false');
    }

    if (viewName === 'admin') {
      initAdminView();
    } else if (viewName === 'register') {
      loadPublicOverview();
    }
  }

  // ==========================================================================
  // 2. LOAD OVERVIEW & REGISTRATION DAY / SUPERVISOR LOGIC
  // ==========================================================================

  async function loadPublicOverview() {
    try {
      const data = await apiFetch('/api/public/overview');
      if (data.conference) {
        state.studentFee = Number(data.conference.student_fee || 30);
        state.doctorFee = Number(data.conference.doctor_fee || 60);
        state.currencyShort = data.conference.currency_short || 'د.ل';
      }

      if (Array.isArray(data.days) && data.days.length > 0) {
        state.days = data.days;
        if (!state.selectedDayId) {
          state.selectedDayId = data.days[0].id;
          state.selectedDayName = data.days[0].day_name;
        }
      }

      renderDayButtons();
      populateSupervisorDropdown();
      updateCategoryUI();
    } catch (err) {
      console.error('Overview load error:', err);
    }
  }

  function renderDayButtons() {
    if (!els.dayButtonsContainer) return;

    if (!state.days || state.days.length === 0) {
      const fallbackDays = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس'];
      els.dayButtonsContainer.innerHTML = fallbackDays
        .map(
          (dName) => `
          <button type="button" class="day-btn ${state.selectedDayName === dName ? 'active' : ''}" data-day-name="${dName}">
            ${dName}
          </button>
        `
        )
        .join('');
    } else {
      els.dayButtonsContainer.innerHTML = state.days
        .map((day) => {
          const isSelected = Number(day.id) === Number(state.selectedDayId);
          return `
            <button type="button" class="day-btn ${isSelected ? 'active' : ''}" data-day-id="${day.id}" data-day-name="${day.day_name}">
              ${day.day_name}
            </button>
          `;
        })
        .join('');
    }

    els.dayButtonsContainer.querySelectorAll('.day-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const dayId = btn.getAttribute('data-day-id');
        const dayName = btn.getAttribute('data-day-name');
        if (dayId) state.selectedDayId = Number(dayId);
        if (dayName) state.selectedDayName = dayName;

        els.dayButtonsContainer.querySelectorAll('.day-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');

        populateSupervisorDropdown();
      });
    });
  }

  function populateSupervisorDropdown() {
    if (!els.supervisorSelect) return;

    const currentVal = els.supervisorSelect.value;
    const selectedDay = state.days.find(
      (d) => Number(d.id) === Number(state.selectedDayId) || d.day_name === state.selectedDayName
    );

    const supervisors = (selectedDay && Array.isArray(selectedDay.supervisors)) ? selectedDay.supervisors : [];

    let optionsHtml = '<option value="">اختر اسم المشرف</option>';
    supervisors.forEach((sup) => {
      optionsHtml += `<option value="${sup.id}">${sup.name}</option>`;
    });

    els.supervisorSelect.innerHTML = optionsHtml;

    if (currentVal && supervisors.some((s) => String(s.id) === String(currentVal))) {
      els.supervisorSelect.value = currentVal;
    }
  }

  // ==========================================================================
  // 3. PARTICIPANT CATEGORY, ACADEMIC YEAR & FEE CALCULATION
  // ==========================================================================

  function updateCategoryUI() {
    const isStudent = state.selectedCategory === 'student';

    els.catBtnStudent.classList.toggle('active', isStudent);
    els.catBtnDoctor.classList.toggle('active', !isStudent);

    if (els.academicYearBlock) {
      els.academicYearBlock.classList.toggle('hidden', !isStudent);
    }

    const fee = isStudent ? state.studentFee : state.doctorFee;
    if (els.feeDisplay) {
      els.feeDisplay.textContent = `${fee} ${state.currencyShort}`;
    }
  }

  // ==========================================================================
  // 4. PAYMENT RECEIPT UPLOAD & CAMERA CAPTURE
  // ==========================================================================

  function handleReceiptFileSelected(file) {
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      showRegistrationFeedback('يرجى اختيار ملف صورة صالح لإيصال الدفع (JPG أو PNG أو WEBP).', 'error');
      return;
    }

    state.receiptFile = file;
    if (state.receiptPreviewUrl) {
      URL.revokeObjectURL(state.receiptPreviewUrl);
    }
    state.receiptPreviewUrl = URL.createObjectURL(file);

    els.receiptThumbImg.src = state.receiptPreviewUrl;
    els.receiptFileName.textContent = file.name;
    els.receiptBtnLabel.textContent = 'تم إرفاق إيصال الدفع (تغيير الصورة)';
    els.receiptPreviewBar.classList.remove('hidden');
    hideRegistrationFeedback();
  }

  function clearReceiptSelection() {
    state.receiptFile = null;
    if (state.receiptPreviewUrl) {
      URL.revokeObjectURL(state.receiptPreviewUrl);
      state.receiptPreviewUrl = null;
    }
    els.receiptInput.value = '';
    els.receiptInput.removeAttribute('capture');
    els.receiptBtnLabel.textContent = 'إرفاق إيصال الدفع';
    els.receiptPreviewBar.classList.add('hidden');
  }

  // ==========================================================================
  // 5. FORM SUBMISSION & DUPLICATE HANDLING
  // ==========================================================================

  function showRegistrationFeedback(message, type = 'error') {
    if (!els.regFeedbackBox) return;
    els.regFeedbackBox.textContent = message;
    els.regFeedbackBox.className = `reg-feedback ${type}`;
    els.regFeedbackBox.classList.remove('hidden');
  }

  function hideRegistrationFeedback() {
    if (!els.regFeedbackBox) return;
    els.regFeedbackBox.classList.add('hidden');
  }

  async function submitParticipantRegistration(confirmDuplicate = false) {
    hideRegistrationFeedback();

    const dayId = state.selectedDayId;
    const supervisorId = els.supervisorSelect.value;
    const nameAr = els.nameArInput.value.trim();
    const nameEn = els.nameEnInput.value.trim();
    const category = state.selectedCategory;
    const academicYear = els.academicYearSelect.value;

    if (!dayId) {
      showRegistrationFeedback('يرجى اختيار يوم التسجيل أولاً.', 'error');
      return;
    }
    if (!supervisorId) {
      showRegistrationFeedback('يرجى اختيار المشرف المخصص لهذا اليوم.', 'error');
      els.supervisorSelect.focus();
      return;
    }
    if (!nameAr || nameAr.length < 3) {
      showRegistrationFeedback('يرجى إدخال الاسم الكامل بالعربي.', 'error');
      els.nameArInput.focus();
      return;
    }
    if (!nameEn || nameEn.length < 3) {
      showRegistrationFeedback('يرجى إدخال الاسم الكامل بالإنجليزي.', 'error');
      els.nameEnInput.focus();
      return;
    }
    if (category === 'student' && !academicYear) {
      showRegistrationFeedback('يرجى اختيار السنة الدراسية للطالب.', 'error');
      els.academicYearSelect.focus();
      return;
    }
    if (!state.receiptFile) {
      showRegistrationFeedback('يرجى إرفاق صورة إيصال الدفع قبل تسجيل المشارك.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('day_id', String(dayId));
    formData.append('supervisor_id', String(supervisorId));
    formData.append('name_ar', nameAr);
    formData.append('name_en', nameEn);
    formData.append('category', category);
    if (category === 'student') {
      formData.append('academic_year', academicYear);
    }
    if (confirmDuplicate) {
      formData.append('confirm_duplicate', 'true');
    }
    formData.append('receipt_image', state.receiptFile);

    els.regSubmitBtn.disabled = true;
    els.regSubmitText.textContent = 'جاري حفظ التسجيل...';

    try {
      const result = await apiFetch('/api/registration/submit', {
        method: 'POST',
        body: formData
      });

      const regNum = result.participant ? result.participant.registration_number : '';
      showRegistrationFeedback(
        `تم تسجيل المشارك بنجاح (${nameAr})${regNum ? ` - رقم التسجيل: ${regNum}` : ''}.`,
        'success'
      );

      // Reset participant fields for next entry while keeping selected Day & Supervisor
      els.nameArInput.value = '';
      els.nameEnInput.value = '';
      els.academicYearSelect.value = '';
      clearReceiptSelection();
    } catch (err) {
      if (err.status === 409 && err.data && err.data.is_duplicate_warning) {
        const dupList = (err.data.duplicates || [])
          .map((d) => `${d.name_ar} (${d.registration_number || ''})`)
          .join(' ، ');
        const proceed = window.confirm(
          `تنبيه: يوجد مشارك مسجل باسم مشابه (${dupList}).\nهل ترغب في تأكيد تسجيل هذا المشارك على أي حال؟`
        );
        if (proceed) {
          els.regSubmitBtn.disabled = false;
          els.regSubmitText.textContent = 'تسجيل المشارك';
          return submitParticipantRegistration(true);
        }
      } else {
        showRegistrationFeedback(err.message || 'تعذر حفظ التسجيل. يرجى المحاولة مرة أخرى.', 'error');
      }
    } finally {
      els.regSubmitBtn.disabled = false;
      els.regSubmitText.textContent = 'تسجيل المشارك';
    }
  }

  // ==========================================================================
  // 6. ADMIN PANEL (5 CLEAN SECTIONS)
  // ==========================================================================

  async function initAdminView() {
    if (!state.adminToken) {
      els.adminLoginCard.classList.remove('hidden');
      els.adminWorkspace.classList.add('hidden');
      return;
    }

    try {
      await loadAdminSupervisorsAndDays();
      els.adminLoginCard.classList.add('hidden');
      els.adminWorkspace.classList.remove('hidden');
    } catch (err) {
      state.adminToken = '';
      sessionStorage.removeItem('icds_admin_token');
      els.adminLoginCard.classList.remove('hidden');
      els.adminWorkspace.classList.add('hidden');
    }
  }

  function switchAdminTab(tabName) {
    els.adminTabBtns.forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-admin-tab') === tabName);
    });

    const panes = ['supervisors', 'registrations', 'receipts', 'reports', 'import'];
    panes.forEach((p) => {
      const el = document.getElementById(`admin-tab-${p}`);
      if (el) el.classList.toggle('hidden', p !== tabName);
    });

    if (tabName === 'supervisors') loadAdminSupervisorsAndDays();
    if (tabName === 'registrations') loadAdminRegistrations();
    if (tabName === 'receipts') loadAdminReceipts();
    if (tabName === 'reports') loadAdminReports();
  }

  // 6.1 Supervisors & Days Management
  async function loadAdminSupervisorsAndDays() {
    const [supData, dayData] = await Promise.all([
      apiFetch('/api/admin/supervisors'),
      apiFetch('/api/admin/days')
    ]);

    state.supervisors = supData.supervisors || [];
    state.adminDays = dayData.days || [];

    renderAdminSupervisorsTable();
    renderAdminDaysAssignment();
    populateAdminFilterDropdowns();
  }

  function renderAdminSupervisorsTable() {
    const tbody = document.getElementById('admin-supervisors-tbody');
    if (!tbody) return;

    if (state.supervisors.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">لا يوجد مشرفون مضافون حالياً.</td></tr>';
      return;
    }

    tbody.innerHTML = state.supervisors
      .map(
        (s) => `
      <tr>
        <td><strong>${s.name}</strong></td>
        <td>${s.is_active ? 'نشط' : 'معطل'}</td>
        <td>${s.registrations_count || 0}</td>
        <td>
          <button type="button" class="table-mini-btn" data-edit-sup="${s.id}" data-name="${s.name}">تعديل</button>
          <button type="button" class="table-mini-btn" data-toggle-sup="${s.id}" data-active="${s.is_active}">${s.is_active ? 'تعطيل' : 'تفعيل'}</button>
          <button type="button" class="table-mini-btn danger" data-del-sup="${s.id}">حذف</button>
        </td>
      </tr>
    `
      )
      .join('');

    tbody.querySelectorAll('[data-edit-sup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-edit-sup');
        const oldName = btn.getAttribute('data-name');
        const newName = window.prompt('تعديل اسم المشرف:', oldName);
        if (newName && newName.trim() && newName.trim() !== oldName) {
          await apiFetch(`/api/admin/supervisors/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ name: newName.trim() })
          });
          await loadAdminSupervisorsAndDays();
          await loadPublicOverview();
        }
      });
    });

    tbody.querySelectorAll('[data-toggle-sup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-toggle-sup');
        const isActive = Number(btn.getAttribute('data-active')) === 1;
        await apiFetch(`/api/admin/supervisors/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: !isActive })
        });
        await loadAdminSupervisorsAndDays();
        await loadPublicOverview();
      });
    });

    tbody.querySelectorAll('[data-del-sup]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-del-sup');
        if (!window.confirm('هل أنت متأكد من حذف هذا المشرف؟')) return;
        try {
          await apiFetch(`/api/admin/supervisors/${id}`, { method: 'DELETE' });
          await loadAdminSupervisorsAndDays();
          await loadPublicOverview();
        } catch (err) {
          window.alert(err.message);
        }
      });
    });
  }

  function renderAdminDaysAssignment() {
    const container = document.getElementById('admin-days-assignment-list');
    if (!container) return;

    const activeSups = state.supervisors.filter((s) => s.is_active);

    container.innerHTML = state.adminDays
      .map((day) => {
        const sup1Id = day.supervisor_1 ? day.supervisor_1.id : '';
        const sup2Id = day.supervisor_2 ? day.supervisor_2.id : '';

        const buildOptions = (selectedId) => {
          let html = '<option value="">-- اختر المشرف --</option>';
          activeSups.forEach((s) => {
            const sel = Number(s.id) === Number(selectedId) ? 'selected' : '';
            html += `<option value="${s.id}" ${sel}>${s.name}</option>`;
          });
          return html;
        };

        return `
        <div class="day-assign-card" data-day-card="${day.id}">
          <div class="day-assign-header">
            <span>يوم ${day.day_name}</span>
            <button type="button" class="table-mini-btn" data-rename-day="${day.id}" data-day-name="${day.day_name}">تعديل اسم اليوم</button>
          </div>
          <div class="day-assign-selects">
            <select class="form-select sup-slot-1" aria-label="المشرف الأول">${buildOptions(sup1Id)}</select>
            <select class="form-select sup-slot-2" aria-label="المشرف الثاني">${buildOptions(sup2Id)}</select>
            <button type="button" class="teal-action-btn" data-save-day-assign="${day.id}">حفظ</button>
          </div>
        </div>
      `;
      })
      .join('');

    container.querySelectorAll('[data-save-day-assign]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dayId = btn.getAttribute('data-save-day-assign');
        const card = container.querySelector(`[data-day-card="${dayId}"]`);
        const sup1 = card.querySelector('.sup-slot-1').value || null;
        const sup2 = card.querySelector('.sup-slot-2').value || null;

        try {
          btn.textContent = 'جاري الحفظ...';
          await apiFetch(`/api/admin/days/${dayId}/assign`, {
            method: 'PUT',
            body: JSON.stringify({ supervisor_1_id: sup1, supervisor_2_id: sup2 })
          });
          btn.textContent = 'تم الحفظ ✓';
          await loadPublicOverview();
          setTimeout(() => {
            btn.textContent = 'حفظ';
          }, 1200);
        } catch (err) {
          btn.textContent = 'حفظ';
          window.alert(err.message);
        }
      });
    });

    container.querySelectorAll('[data-rename-day]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const dayId = btn.getAttribute('data-rename-day');
        const currentName = btn.getAttribute('data-day-name');
        const newName = window.prompt('اسم يوم التسجيل:', currentName);
        if (newName && newName.trim() && newName.trim() !== currentName) {
          await apiFetch(`/api/admin/days/${dayId}`, {
            method: 'PUT',
            body: JSON.stringify({ day_name: newName.trim() })
          });
          await loadAdminSupervisorsAndDays();
          await loadPublicOverview();
        }
      });
    });
  }

  function populateAdminFilterDropdowns() {
    const filterDay = document.getElementById('filter-day');
    const filterSup = document.getElementById('filter-supervisor');

    if (filterDay) {
      filterDay.innerHTML =
        '<option value="">كل الأيام</option>' +
        state.adminDays.map((d) => `<option value="${d.id}">${d.day_name}</option>`).join('');
    }
    if (filterSup) {
      filterSup.innerHTML =
        '<option value="">كل المشرفين</option>' +
        state.supervisors.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    }
  }

  // 6.2 Registrations Management
  async function loadAdminRegistrations() {
    const search = (document.getElementById('filter-search')?.value || '').trim();
    const dayId = document.getElementById('filter-day')?.value || '';
    const supId = document.getElementById('filter-supervisor')?.value || '';
    const category = document.getElementById('filter-category')?.value || '';
    const year = document.getElementById('filter-year')?.value || '';

    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (dayId) params.set('day_id', dayId);
    if (supId) params.set('supervisor_id', supId);
    if (category) params.set('category', category);
    if (year) params.set('academic_year', year);

    const data = await apiFetch(`/api/admin/participants?${params.toString()}`);
    state.participants = data.participants || [];
    renderAdminRegistrationsTable();
  }

  function renderAdminRegistrationsTable() {
    const tbody = document.getElementById('admin-registrations-tbody');
    if (!tbody) return;

    if (state.participants.length === 0) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-cell">لا توجد تسجيلات مطابقة.</td></tr>';
      return;
    }

    tbody.innerHTML = state.participants
      .map((p) => {
        const receiptUrl = `${API_BASE}/api/receipts/${p.id}/image?admin_token=${encodeURIComponent(state.adminToken)}`;
        return `
        <tr>
          <td><strong>${p.registration_number || p.id}</strong></td>
          <td>${p.name_ar}</td>
          <td dir="ltr">${p.name_en}</td>
          <td>${p.category_label || (p.category === 'student' ? 'طالب' : 'دكتور')}</td>
          <td>${p.academic_year || '—'}</td>
          <td>${p.fee_amount} د.ل</td>
          <td>${p.registration_day_name || '—'}</td>
          <td>${p.supervisor_name || '—'}</td>
          <td dir="ltr">${p.registration_date || ''} ${p.registration_time || ''}</td>
          <td>
            ${
              p.has_receipt
                ? `<button type="button" class="table-mini-btn" data-view-receipt="${receiptUrl}" data-title="${p.name_ar}">عرض الإيصال</button>`
                : '—'
            }
          </td>
          <td>
            <button type="button" class="table-mini-btn" data-edit-p="${p.id}">تعديل</button>
            <button type="button" class="table-mini-btn danger" data-del-p="${p.id}">حذف</button>
          </td>
        </tr>
      `;
      })
      .join('');

    tbody.querySelectorAll('[data-view-receipt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        openLightbox(btn.getAttribute('data-view-receipt'), `إيصال الدفع – ${btn.getAttribute('data-title')}`);
      });
    });

    tbody.querySelectorAll('[data-edit-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = Number(btn.getAttribute('data-edit-p'));
        const p = state.participants.find((item) => Number(item.id) === pId);
        if (!p) return;
        document.getElementById('edit-p-id').value = p.id;
        document.getElementById('edit-p-name-ar').value = p.name_ar;
        document.getElementById('edit-p-name-en').value = p.name_en;
        document.getElementById('edit-p-category').value = p.category;
        document.getElementById('edit-p-year').value = p.academic_year || '';
        document.getElementById('edit-p-year-wrap').classList.toggle('hidden', p.category !== 'student');
        els.editModal.classList.remove('hidden');
      });
    });

    tbody.querySelectorAll('[data-del-p]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const pId = btn.getAttribute('data-del-p');
        if (!window.confirm('هل أنت متأكد من حذف هذا التسجيل؟')) return;
        await apiFetch(`/api/admin/participants/${pId}`, { method: 'DELETE' });
        await loadAdminRegistrations();
      });
    });
  }

  // 6.3 Receipts Grid
  async function loadAdminReceipts() {
    const data = await apiFetch('/api/admin/participants');
    const list = (data.participants || []).filter((p) => p.has_receipt);
    const grid = document.getElementById('admin-receipts-grid');
    if (!grid) return;

    if (list.length === 0) {
      grid.innerHTML = '<div class="empty-cell">لا توجد إيصالات مرفوعة حالياً.</div>';
      return;
    }

    grid.innerHTML = list
      .map((p) => {
        const imgUrl = `${API_BASE}/api/receipts/${p.id}/image?admin_token=${encodeURIComponent(state.adminToken)}`;
        return `
        <div class="receipt-item-card">
          <img src="${imgUrl}" alt="إيصال ${p.name_ar}" data-full-url="${imgUrl}" data-name="${p.name_ar}" />
          <div><strong>${p.name_ar}</strong></div>
          <div style="font-size:12.5px;color:#5a6b7c;">${p.category_label} • ${p.fee_amount} د.ل • ${p.registration_day_name}</div>
          <div style="font-size:12px;color:#5a6b7c;">المشرف: ${p.supervisor_name}</div>
        </div>
      `;
      })
      .join('');

    grid.querySelectorAll('img[data-full-url]').forEach((img) => {
      img.addEventListener('click', () => {
        openLightbox(img.getAttribute('data-full-url'), `إيصال الدفع – ${img.getAttribute('data-name')}`);
      });
    });
  }

  // 6.4 Reports
  async function loadAdminReports() {
    const data = await apiFetch('/api/admin/dashboard');
    const summary = data.summary || {};

    document.getElementById('rep-total-reg').textContent = summary.total_registrations || 0;
    document.getElementById('rep-total-stu').textContent = summary.total_students || 0;
    document.getElementById('rep-total-doc').textContent = summary.total_doctors || 0;
    document.getElementById('rep-total-amount').textContent = `${summary.total_registered_amount || 0} د.ل`;

    const dayTbody = document.getElementById('report-by-day-tbody');
    const byDays = data.by_days || [];
    if (dayTbody) {
      dayTbody.innerHTML =
        byDays.length === 0
          ? '<tr><td colspan="5" class="empty-cell">لا توجد بيانات.</td></tr>'
          : byDays
              .map(
                (d) => `
          <tr>
            <td><strong>${d.day_name}</strong></td>
            <td>${d.total_count || 0}</td>
            <td>${d.students_count || 0}</td>
            <td>${d.doctors_count || 0}</td>
            <td>${d.total_amount || 0} د.ل</td>
          </tr>
        `
              )
              .join('');
    }

    const supTbody = document.getElementById('report-by-sup-tbody');
    const bySups = data.by_supervisors || [];
    if (supTbody) {
      supTbody.innerHTML =
        bySups.length === 0
          ? '<tr><td colspan="5" class="empty-cell">لا توجد بيانات.</td></tr>'
          : bySups
              .map(
                (s) => `
          <tr>
            <td><strong>${s.name}</strong></td>
            <td>${s.total_count || 0}</td>
            <td>${s.students_count || 0}</td>
            <td>${s.doctors_count || 0}</td>
            <td>${s.total_amount || 0} د.ل</td>
          </tr>
        `
              )
              .join('');
    }
  }

  // 6.5 Future Data Import (Excel / CSV)
  async function handleImportFilePreview(file) {
    if (!file) return;
    const previewArea = document.getElementById('import-preview-area');
    const confirmBtn = document.getElementById('import-confirm-btn');

    const fd = new FormData();
    fd.append('import_file', file);

    try {
      const data = await apiFetch('/api/admin/import/preview', {
        method: 'POST',
        body: fd
      });

      state.pendingImportBatchId = data.batch_id;
      previewArea.classList.remove('hidden');
      confirmBtn.classList.remove('hidden');

      previewArea.innerHTML = `
        <div class="reg-feedback success" style="margin-bottom:10px;">
          تمت قراءة الملف (${data.file_name}): إجمالي الصفوف ${data.total_rows} | جاهز للاستيراد: ${data.valid_rows_count} | مكرر: ${data.duplicate_rows_count}
        </div>
      `;
    } catch (err) {
      window.alert(err.message);
    }
  }

  async function confirmDataImport() {
    if (!state.pendingImportBatchId) return;
    try {
      const res = await apiFetch('/api/admin/import/confirm', {
        method: 'POST',
        body: JSON.stringify({ batch_id: state.pendingImportBatchId, skip_duplicates: true })
      });
      window.alert(res.message || 'تم استيراد البيانات بنجاح.');
      document.getElementById('import-confirm-btn').classList.add('hidden');
      document.getElementById('import-preview-area').classList.add('hidden');
      state.pendingImportBatchId = null;
    } catch (err) {
      window.alert(err.message);
    }
  }

  // ==========================================================================
  // 7. LIGHTBOX & EVENT LISTENERS
  // ==========================================================================

  function openLightbox(imgSrc, title) {
    els.lightboxImg.src = imgSrc;
    els.lightboxTitle.textContent = title || 'معاينة إيصال الدفع';
    els.lightboxModal.classList.remove('hidden');
  }

  function bindEvents() {
    // Header Navigation
    els.navButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        switchView(btn.getAttribute('data-nav'));
      });
    });

    if (els.brandLogoBtn) {
      els.brandLogoBtn.addEventListener('click', () => switchView('register'));
    }

    if (els.mobileMenuBtn) {
      els.mobileMenuBtn.addEventListener('click', () => {
        const isHidden = els.mobileNavDrawer.classList.toggle('hidden');
        els.mobileMenuBtn.setAttribute('aria-expanded', String(!isHidden));
      });
    }

    if (els.homeGoRegisterBtn) {
      els.homeGoRegisterBtn.addEventListener('click', () => switchView('register'));
    }
    if (els.homeGoAdminBtn) {
      els.homeGoAdminBtn.addEventListener('click', () => switchView('admin'));
    }

    // Category Toggle
    els.catBtnStudent.addEventListener('click', () => {
      state.selectedCategory = 'student';
      updateCategoryUI();
    });

    els.catBtnDoctor.addEventListener('click', () => {
      state.selectedCategory = 'doctor';
      updateCategoryUI();
    });

    // Receipt Upload
    els.receiptTriggerBtn.addEventListener('click', () => {
      els.receiptInput.removeAttribute('capture');
      els.receiptInput.click();
    });

    els.receiptInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) handleReceiptFileSelected(file);
    });

    els.receiptViewFullBtn.addEventListener('click', () => {
      if (state.receiptPreviewUrl) {
        openLightbox(state.receiptPreviewUrl, 'معاينة إيصال الدفع المرفق');
      }
    });

    els.receiptCameraBtn.addEventListener('click', () => {
      els.receiptInput.setAttribute('capture', 'environment');
      els.receiptInput.click();
    });

    els.receiptClearBtn.addEventListener('click', clearReceiptSelection);

    // Registration Submit
    els.regForm.addEventListener('submit', (e) => {
      e.preventDefault();
      submitParticipantRegistration(false);
    });

    // Lightbox Close
    els.lightboxCloseBtn.addEventListener('click', () => {
      els.lightboxModal.classList.add('hidden');
    });
    els.lightboxModal.addEventListener('click', (e) => {
      if (e.target === els.lightboxModal) els.lightboxModal.classList.add('hidden');
    });

    // Admin Login
    els.adminLoginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      els.adminLoginError.classList.add('hidden');
      try {
        const res = await apiFetch('/api/auth/admin/login', {
          method: 'POST',
          body: JSON.stringify({
            username: els.adminUsernameInput.value.trim(),
            password: els.adminPasswordInput.value
          })
        });
        state.adminToken = res.token;
        sessionStorage.setItem('icds_admin_token', res.token);
        await initAdminView();
      } catch (err) {
        els.adminLoginError.textContent = err.message;
        els.adminLoginError.classList.remove('hidden');
      }
    });

    els.adminLogoutBtn.addEventListener('click', () => {
      state.adminToken = '';
      sessionStorage.removeItem('icds_admin_token');
      initAdminView();
    });

    els.adminTabBtns.forEach((btn) => {
      btn.addEventListener('click', () => {
        switchAdminTab(btn.getAttribute('data-admin-tab'));
      });
    });

    // Add Supervisor Form
    const addSupForm = document.getElementById('add-supervisor-form');
    if (addSupForm) {
      addSupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const input = document.getElementById('new-sup-name');
        const name = input.value.trim();
        if (!name) return;
        try {
          await apiFetch('/api/admin/supervisors', {
            method: 'POST',
            body: JSON.stringify({ name })
          });
          input.value = '';
          await loadAdminSupervisorsAndDays();
          await loadPublicOverview();
        } catch (err) {
          window.alert(err.message);
        }
      });
    }

    // Filters in Admin Registrations
    ['filter-search', 'filter-day', 'filter-supervisor', 'filter-category', 'filter-year'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => loadAdminRegistrations());
        el.addEventListener('change', () => loadAdminRegistrations());
      }
    });

    // Export Excel
    const exportBtn = document.getElementById('export-excel-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        window.open(`${API_BASE}/api/admin/export?format=xlsx&admin_token=${encodeURIComponent(state.adminToken)}`, '_blank');
      });
    }

    // Edit Participant Modal
    els.editModalCloseBtn.addEventListener('click', () => els.editModal.classList.add('hidden'));
    document.getElementById('edit-p-category').addEventListener('change', (e) => {
      document.getElementById('edit-p-year-wrap').classList.toggle('hidden', e.target.value !== 'student');
    });

    els.editForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('edit-p-id').value;
      const category = document.getElementById('edit-p-category').value;
      await apiFetch(`/api/admin/participants/${id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name_ar: document.getElementById('edit-p-name-ar').value.trim(),
          name_en: document.getElementById('edit-p-name-en').value.trim(),
          category,
          academic_year: category === 'student' ? document.getElementById('edit-p-year').value : ''
        })
      });
      els.editModal.classList.add('hidden');
      await loadAdminRegistrations();
    });

    // Import File Controls
    const importChooseBtn = document.getElementById('import-choose-btn');
    const importFileInput = document.getElementById('import-file-input');
    const importConfirmBtn = document.getElementById('import-confirm-btn');

    if (importChooseBtn && importFileInput) {
      importChooseBtn.addEventListener('click', () => importFileInput.click());
      importFileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (file) handleImportFilePreview(file);
      });
    }
    if (importConfirmBtn) {
      importConfirmBtn.addEventListener('click', confirmDataImport);
    }
  }

  // Initialize App
  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadPublicOverview();
  });
})();
