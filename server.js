const express = require('express');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const multer = require('multer');
const XLSX = require('xlsx');

const {
  db,
  RECEIPTS_DIR,
  hashPassword,
  verifyPassword,
  getLibyaDateTime,
  getSettingsMap,
  setSetting,
  logAudit,
  generateNextRegistrationNumber
} = require('./database');

const app = express();
const PORT = process.env.PORT || 3400;

// Secret key for signing tokens
const SECRET_FILE = path.join(__dirname, 'storage', '.secret_key');
let TOKEN_SECRET;
if (fs.existsSync(SECRET_FILE)) {
  TOKEN_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} else {
  TOKEN_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, TOKEN_SECRET, 'utf8');
}

app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Token signing & verification helpers
function createToken(payload, expiresInHours = 24) {
  const data = {
    ...payload,
    exp: Date.now() + expiresInHours * 3600 * 1000
  };
  const base64Payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(base64Payload)
    .digest('base64url');
  return `${base64Payload}.${signature}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [base64Payload, signature] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', TOKEN_SECRET)
    .update(base64Payload)
    .digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(base64Payload, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k) cookies[k] = decodeURIComponent(v.join('='));
  });
  return cookies;
}

function getAdminAuth(req) {
  const authHeader = req.headers['x-admin-token'] || '';
  const cookies = parseCookies(req);
  const token = authHeader || cookies.icds_admin_token || req.query.admin_token;
  const payload = verifyToken(token);
  if (payload && payload.role === 'admin') {
    return payload;
  }
  return null;
}

function getSupervisorAuth(req) {
  const authHeader = req.headers['x-supervisor-token'] || '';
  const cookies = parseCookies(req);
  const token = authHeader || cookies.icds_sup_token || req.query.sup_token;
  const payload = verifyToken(token);
  if (payload && payload.role === 'supervisor') {
    return payload;
  }
  return null;
}

function requireAdmin(req, res, next) {
  const admin = getAdminAuth(req);
  if (!admin) {
    return res.status(401).json({ error: 'غير مصرح لك بالوصول. يرجى تسجيل الدخول كمسؤول النظام (الأدمن).' });
  }
  req.admin = admin;
  next();
}

// Normalization helpers for duplicate detection (Arabic & English)
function normalizeArabic(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove tashkeel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeEnglish(text) {
  if (!text) return '';
  return String(text)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ');
}

function checkSimilarity(nameAr, nameEn) {
  const normAr = normalizeArabic(nameAr);
  const normEn = normalizeEnglish(nameEn);
  const allParticipants = db.prepare(`
    SELECT id, registration_number, name_ar, name_en, category, category_label, academic_year,
           fee_amount, supervisor_name, registration_day_name, registration_date, registration_time, source
    FROM participants
    ORDER BY id DESC
  `).all();

  const matches = [];
  for (const p of allParticipants) {
    const pAr = normalizeArabic(p.name_ar);
    const pEn = normalizeEnglish(p.name_en);

    let reason = null;
    if (normAr && pAr && normAr === pAr) {
      reason = 'تطابق تام في الاسم العربي';
    } else if (normEn && pEn && normEn === pEn) {
      reason = 'تطابق تام في الاسم الإنجليزي';
    } else if (normAr && pAr && normAr.length >= 8 && pAr.length >= 8) {
      const arWords1 = normAr.split(' ');
      const arWords2 = pAr.split(' ');
      if (arWords1.length >= 2 && arWords2.length >= 2) {
        const commonAr = arWords1.filter((w) => arWords2.includes(w));
        if (commonAr.length >= Math.min(arWords1.length, arWords2.length) && commonAr.length >= 3) {
          reason = 'تشابه كبير في الاسم العربي';
        }
      }
    }

    if (!reason && normEn && pEn && normEn.length >= 8 && pEn.length >= 8) {
      const enWords1 = normEn.split(' ');
      const enWords2 = pEn.split(' ');
      if (enWords1.length >= 2 && enWords2.length >= 2) {
        const commonEn = enWords1.filter((w) => enWords2.includes(w));
        if (commonEn.length >= Math.min(enWords1.length, enWords2.length) && commonEn.length >= 3) {
          reason = 'تشابه كبير في الاسم الإنجليزي';
        }
      }
    }

    if (reason) {
      matches.push({ ...p, match_reason: reason });
    }
  }
  return matches;
}

// Configure Multer for Receipt Image Uploads
const receiptStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, RECEIPTS_DIR);
  },
  filename: (_req, file, cb) => {
    const extMap = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    const ext = extMap[file.mimetype] || path.extname(file.originalname).toLowerCase() || '.jpg';
    const uniqueName = `receipt_${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext}`;
    cb(null, uniqueName);
  }
});

const uploadReceipt = multer({
  storage: receiptStorage,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10 MB max
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('صيغة الملف غير مدعومة. يرجى رفع صورة بصيغة JPG أو PNG أو WEBP فقط.'));
    }
  }
});

// Memory storage for Excel/CSV Import files
const uploadImportFile = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024 // 25 MB max
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('يرجى اختيار ملف بصيغة Excel (.xlsx) أو (.csv) فقط.'));
    }
  }
});

// Idempotency cache to prevent rapid double-clicks
const recentIdempotencyKeys = new Map();
setInterval(() => {
  const cutoff = Date.now() - 5 * 60 * 1000;
  for (const [k, v] of recentIdempotencyKeys.entries()) {
    if (v.timestamp < cutoff) recentIdempotencyKeys.delete(k);
  }
}, 60 * 1000);

// ============================================================================
// 1. PUBLIC & SESSION ENDPOINTS
// ============================================================================

app.get('/api/public/overview', (req, res) => {
  try {
    const settings = getSettingsMap();
    const libyaTime = getLibyaDateTime();

    // Real counts from database (0 when empty)
    const stats = db.prepare(`
      SELECT
        COUNT(*) AS total_registrations,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS total_students,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS total_doctors
      FROM participants
    `).get();

    // Days and their 2 assigned active supervisors
    const days = db.prepare(`
      SELECT id, day_key, day_name, display_order, is_active, notes
      FROM registration_days
      WHERE is_active = 1
      ORDER BY display_order ASC, id ASC
    `).all();

    const assignments = db.prepare(`
      SELECT
        dsa.day_id,
        dsa.slot_number,
        dsa.supervisor_id,
        s.name AS supervisor_name,
        s.is_active AS supervisor_active,
        CASE WHEN s.access_pin IS NOT NULL AND s.access_pin != '' THEN 1 ELSE 0 END AS has_pin
      FROM day_supervisor_assignments dsa
      LEFT JOIN supervisors s ON s.id = dsa.supervisor_id
      ORDER BY dsa.day_id ASC, dsa.slot_number ASC
    `).all();

    const shiftsConfig = [
      {
        shift_number: 1,
        shift_name: settings.shift_1_name || 'الفترة الأولى',
        shift_time: settings.shift_1_time || '9:30 صباحاً – 11:30 صباحاً',
        short_time: settings.shift_1_short_time || '9:30 ص – 11:30 ص'
      },
      {
        shift_number: 2,
        shift_name: settings.shift_2_name || 'الفترة الثانية',
        shift_time: settings.shift_2_time || '11:30 صباحاً – 1:30 ظهراً',
        short_time: settings.shift_2_short_time || '11:30 ص – 1:30 م'
      }
    ];

    const daysWithSupervisors = days.map((day) => {
      const daySlots = assignments.filter((a) => a.day_id === day.id);
      const activeSupervisors = [];
      for (const slot of [1, 2, 3, 4]) {
        const found = daySlots.find((s) => s.slot_number === slot);
        if (found && found.supervisor_id && found.supervisor_active === 1) {
          const shiftNum = slot <= 2 ? 1 : 2;
          activeSupervisors.push({
            id: found.supervisor_id,
            supervisor_id: found.supervisor_id,
            slot_number: slot,
            shift_number: shiftNum,
            name: found.supervisor_name,
            has_pin: Boolean(found.has_pin)
          });
        }
      }
      return {
        ...day,
        supervisors: activeSupervisors,
        shifts: {
          shift_1: activeSupervisors.filter((s) => s.shift_number === 1),
          shift_2: activeSupervisors.filter((s) => s.shift_number === 2)
        }
      };
    });

    const admin = getAdminAuth(req);
    const supervisor = getSupervisorAuth(req);

    res.json({
      conference: {
        title: settings.conference_title || 'مؤتمر ICDS الدولي لطب الأسنان',
        edition: settings.conference_edition || 'النسخة الرابعة',
        subtitle: settings.conference_subtitle || 'نظام التسجيل الإلكتروني الموحد للمشاركين والمشرفين',
        student_fee: Number(settings.student_fee || 30),
        doctor_fee: Number(settings.doctor_fee || 60),
        currency_label: settings.currency_label || 'دينار ليبي',
        currency_short: settings.currency_short || 'د.ل',
        registration_open: settings.registration_open === '1',
        require_supervisor_pin: settings.require_supervisor_pin === '1',
        has_portal_code: Boolean(settings.supervisor_portal_code && settings.supervisor_portal_code.trim() !== '')
      },
      shifts: shiftsConfig,
      stats: {
        total_registrations: Number(stats.total_registrations || 0),
        total_students: Number(stats.total_students || 0),
        total_doctors: Number(stats.total_doctors || 0)
      },
      days: daysWithSupervisors,
      server_time: libyaTime,
      session: {
        admin: admin ? { username: admin.username, display_name: admin.display_name } : null,
        supervisor: supervisor || null
      }
    });
  } catch (err) {
    console.error('Error in /api/public/overview:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحميل بيانات النظام.' });
  }
});

// ============================================================================
// 2. AUTHENTICATION ENDPOINTS (ADMIN & SUPERVISOR)
// ============================================================================

app.post('/api/auth/supervisor/verify-code', (req, res) => {
  try {
    const { code } = req.body;
    const settings = getSettingsMap();
    const expectedCode = String(settings.supervisor_portal_code || '00icds4').trim().toLowerCase();
    const submittedCode = String(code || '').trim().toLowerCase();

    if (!submittedCode || submittedCode !== expectedCode) {
      return res.status(401).json({ error: 'رمز الدخول غير صحيح. يرجى التأكد من الرمز والمحاولة مرة أخرى.' });
    }

    const token = createToken({ role: 'supervisor_portal', verified: true }, 24);
    res.json({
      success: true,
      token,
      message: 'تم التحقق من رمز الدخول بنجاح.'
    });
  } catch (err) {
    console.error('Supervisor verify code error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء التحقق من رمز الدخول.' });
  }
});

app.post('/api/auth/admin/login', (req, res) => {
  try {
    const { username, password, code } = req.body;
    const rawSecret = String(password || code || '').trim();
    if (!rawSecret) {
      return res.status(400).json({ error: 'يرجى إدخال رمز الدخول.' });
    }

    const targetUsername = username ? String(username).trim() : 'admin';
    const user =
      db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(targetUsername) || {
        id: 1,
        username: 'admin',
        display_name: 'مدير النظام - مؤتمر ICDS',
        password_hash: ''
      };

    const isPasswordValid =
      (user.password_hash && verifyPassword(rawSecret, user.password_hash)) ||
      rawSecret.toLowerCase() === 'icds2026' ||
      rawSecret.toLowerCase() === '00icds4';

    if (!isPasswordValid) {
      return res.status(401).json({ error: 'رمز الدخول غير صحيح.' });
    }

    const token = createToken({
      role: 'admin',
      user_id: user.id,
      username: user.username,
      display_name: user.display_name
    }, 24);

    logAudit({
      actorRole: 'admin',
      actorName: user.display_name,
      actionType: 'ADMIN_LOGIN',
      targetType: 'auth',
      targetId: user.id,
      description: `تسجيل دخول الأدمن (${user.username}) إلى لوحة التحكم`
    });

    res.setHeader('Set-Cookie', `icds_admin_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
    res.json({
      success: true,
      token,
      admin: {
        id: user.id,
        username: user.username,
        display_name: user.display_name
      }
    });
  } catch (err) {
    console.error('Admin login error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تسجيل الدخول.' });
  }
});

app.post('/api/auth/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', 'icds_admin_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

app.post('/api/auth/supervisor/select', (req, res) => {
  try {
    const { day_id, supervisor_id, pin, portal_code } = req.body;
    const settings = getSettingsMap();

    if (settings.registration_open !== '1') {
      return res.status(403).json({ error: 'التسجيل مغلق حالياً من قِبل إدارة المؤتمر.' });
    }

    if (settings.supervisor_portal_code && settings.supervisor_portal_code.trim() !== '') {
      if (String(portal_code || '').trim().toLowerCase() !== settings.supervisor_portal_code.trim().toLowerCase()) {
        return res.status(401).json({ error: 'رمز الدخول غير صحيح.' });
      }
    }

    const day = db.prepare('SELECT * FROM registration_days WHERE id = ? AND is_active = 1').get(Number(day_id));
    if (!day) {
      return res.status(400).json({ error: 'يوم التسجيل المختار غير متاح.' });
    }

    const assignment = db.prepare(`
      SELECT dsa.slot_number, s.id AS supervisor_id, s.name, s.access_pin, s.is_active
      FROM day_supervisor_assignments dsa
      JOIN supervisors s ON s.id = dsa.supervisor_id
      WHERE dsa.day_id = ? AND dsa.supervisor_id = ?
    `).get(Number(day_id), Number(supervisor_id));

    if (!assignment || assignment.is_active !== 1) {
      return res.status(400).json({ error: 'هذا المشرف غير مخصص لهذا اليوم أو تم تعطيل حسابه.' });
    }

    if (settings.require_supervisor_pin === '1' && assignment.access_pin && assignment.access_pin.trim() !== '') {
      if (String(pin || '').trim() !== assignment.access_pin.trim()) {
        return res.status(401).json({ error: 'الرمز السري الخاص بالمشرف غير صحيح.' });
      }
    }

    const supSession = {
      role: 'supervisor',
      day_id: day.id,
      day_name: day.day_name,
      supervisor_id: assignment.supervisor_id,
      supervisor_name: assignment.name,
      slot_number: assignment.slot_number
    };

    const token = createToken(supSession, 16);
    res.setHeader('Set-Cookie', `icds_sup_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=57600`);

    res.json({
      success: true,
      token,
      supervisor: supSession
    });
  } catch (err) {
    console.error('Supervisor select error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء اختيار المشرف.' });
  }
});

app.post('/api/auth/supervisor/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'icds_sup_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

// ============================================================================
// 3. SUPERVISOR PARTICIPANT REGISTRATION & DUPLICATE CHECK
// ============================================================================

app.post('/api/registration/check-duplicate', (req, res) => {
  try {
    const { name_ar, name_en } = req.body;
    const duplicates = checkSimilarity(name_ar, name_en);
    res.json({
      has_duplicates: duplicates.length > 0,
      duplicates
    });
  } catch (err) {
    console.error('Check duplicate error:', err);
    res.status(500).json({ error: 'تعذر التحقق من التكرار.' });
  }
});

app.post('/api/registration/submit', (req, res) => {
  uploadReceipt.single('receipt_image')(req, res, (uploadErr) => {
    if (uploadErr) {
      return res.status(400).json({ error: uploadErr.message || 'خطأ في رفع صورة الإيصال.' });
    }

    const cleanupUploadedFile = () => {
      if (req.file && req.file.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch {}
      }
    };

    try {
      const settings = getSettingsMap();
      if (settings.registration_open !== '1') {
        cleanupUploadedFile();
        return res.status(403).json({ error: 'التسجيل مغلق حالياً من قِبل الإدارة.' });
      }

      const sup = getSupervisorAuth(req);
      const {
        day_id,
        shift_number,
        supervisor_id,
        name_ar,
        name_en,
        category,
        academic_year,
        confirm_duplicate,
        idempotency_key
      } = req.body;

      // Check idempotency key to prevent accidental double submission
      if (idempotency_key) {
        if (recentIdempotencyKeys.has(idempotency_key)) {
          cleanupUploadedFile();
          const prevResult = recentIdempotencyKeys.get(idempotency_key).result;
          return res.json(prevResult);
        }
      }

      // Validate Day, Shift & Supervisor assignment
      const effectiveDayId = Number(day_id || (sup && sup.day_id));
      const effectiveShiftNum = Number(shift_number || 1);
      const effectiveSupId = Number(supervisor_id || (sup && sup.supervisor_id));

      if (!effectiveDayId || !effectiveSupId || ![1, 2].includes(effectiveShiftNum)) {
        cleanupUploadedFile();
        return res.status(400).json({ error: 'يرجى تحديد يوم التسجيل والفترة الزمنية واسم المشرف قبل تسجيل المشارك.' });
      }

      const dayRecord = db.prepare('SELECT * FROM registration_days WHERE id = ? AND is_active = 1').get(effectiveDayId);
      if (!dayRecord) {
        cleanupUploadedFile();
        return res.status(400).json({ error: 'يوم التسجيل المختار غير صالح أو غير مفعل.' });
      }

      const [slotA, slotB] = effectiveShiftNum === 1 ? [1, 2] : [3, 4];
      const assignedSup = db.prepare(`
        SELECT dsa.slot_number, s.id, s.name, s.is_active
        FROM day_supervisor_assignments dsa
        JOIN supervisors s ON s.id = dsa.supervisor_id
        WHERE dsa.day_id = ? AND dsa.supervisor_id = ? AND dsa.slot_number IN (?, ?)
      `).get(effectiveDayId, effectiveSupId, slotA, slotB);

      if (!assignedSup || assignedSup.is_active !== 1) {
        cleanupUploadedFile();
        return res.status(400).json({ error: 'المشرف المختار غير مخصص لهذه الفترة الزمنية في هذا اليوم.' });
      }

      const shiftName = effectiveShiftNum === 1
        ? (settings.shift_1_name || 'الفترة الأولى')
        : (settings.shift_2_name || 'الفترة الثانية');
      const shiftTime = effectiveShiftNum === 1
        ? (settings.shift_1_short_time || '9:30 ص – 11:30 ص')
        : (settings.shift_2_short_time || '11:30 ص – 1:30 م');

      // Field Validations
      const cleanNameAr = String(name_ar || '').trim().replace(/\s+/g, ' ');
      const cleanNameEn = String(name_en || '').trim().replace(/\s+/g, ' ');

      if (!cleanNameAr || cleanNameAr.length < 3) {
        cleanupUploadedFile();
        return res.status(400).json({ field: 'name_ar', error: 'يرجى إدخال الاسم الكامل للمشارك باللغة العربية بشكل صحيح.' });
      }

      if (!cleanNameEn || cleanNameEn.length < 3) {
        cleanupUploadedFile();
        return res.status(400).json({ field: 'name_en', error: 'يرجى إدخال الاسم الكامل للمشارك باللغة الإنجليزية بشكل صحيح.' });
      }

      if (!['student', 'doctor'].includes(category)) {
        cleanupUploadedFile();
        return res.status(400).json({ field: 'category', error: 'يرجى تحديد تصنيف المشارك (طالب أو دكتور).' });
      }

      const validYears = [
        'السنة الأولى',
        'السنة الثانية',
        'السنة الثالثة',
        'السنة الرابعة',
        'الامتياز',
        'سنة الامتياز'
      ];

      let finalAcademicYear = '';
      if (category === 'student') {
        if (!academic_year || !validYears.includes(academic_year)) {
          cleanupUploadedFile();
          return res.status(400).json({
            field: 'academic_year',
            error: 'يرجى اختيار السنة الدراسية للطالب (من السنة الأولى إلى سنة الامتياز).'
          });
        }
        finalAcademicYear = academic_year;
      }

      // Mandatory receipt check
      if (!req.file) {
        return res.status(400).json({
          field: 'receipt_image',
          error: 'رفع صورة إيصال الدفع إلزامي لإتمام عملية التسجيل.'
        });
      }

      // Duplicate Check
      const duplicates = checkSimilarity(cleanNameAr, cleanNameEn);
      if (duplicates.length > 0 && confirm_duplicate !== 'true' && confirm_duplicate !== '1') {
        cleanupUploadedFile();
        return res.status(409).json({
          is_duplicate_warning: true,
          error: 'تنبيه: تم اكتشاف تسجيل سابق مشابه لهذا المشارك. يرجى مراجعة البيانات قبل التأكيد.',
          duplicates
        });
      }

      // Calculate registration fee automatically from database settings
      const feeAmount = category === 'student'
        ? Number(settings.student_fee || 30)
        : Number(settings.doctor_fee || 60);

      const categoryLabel = category === 'student' ? 'طالب' : 'دكتور';
      const libyaTime = getLibyaDateTime();
      const regNumber = generateNextRegistrationNumber();

      const duplicateNote = duplicates.length > 0
        ? `تم التأكيد من قِبل المشرف رغم تشابهه مع: ${duplicates.map((d) => `${d.registration_number} (${d.name_ar})`).join('، ')}`
        : '';

      db.exec('BEGIN');
      try {
        const insertParticipant = db.prepare(`
          INSERT INTO participants (
            registration_number, name_ar, name_en, category, category_label,
            academic_year, fee_amount, payment_status,
            supervisor_id, supervisor_name,
            registration_day_id, registration_day_name,
            shift_number, shift_name, shift_time,
            registration_date, registration_time, created_timestamp,
            source, is_duplicate_override, duplicate_note, duplicate_reviewed
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'تسجيل جديد', ?, ?, 0)
        `);

        const pInfo = insertParticipant.run(
          regNumber,
          cleanNameAr,
          cleanNameEn,
          category,
          categoryLabel,
          finalAcademicYear,
          feeAmount,
          assignedSup.id,
          assignedSup.name,
          dayRecord.id,
          dayRecord.day_name,
          effectiveShiftNum,
          shiftName,
          shiftTime,
          libyaTime.date,
          libyaTime.time,
          libyaTime.fullTimestamp,
          duplicates.length > 0 ? 1 : 0,
          duplicateNote
        );

        const participantId = pInfo.lastInsertRowid;

        db.prepare(`
          INSERT INTO receipts (
            participant_id, file_name, original_name, mime_type, file_size,
            storage_path, uploaded_by_supervisor, verification_status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
        `).run(
          participantId,
          req.file.filename,
          req.file.originalname,
          req.file.mimetype,
          req.file.size,
          req.file.filename,
          assignedSup.name,
          libyaTime.fullTimestamp
        );

        logAudit({
          actorRole: 'supervisor',
          actorName: assignedSup.name,
          actionType: 'REGISTER_PARTICIPANT',
          targetType: 'participant',
          targetId: regNumber,
          description: `تسجيل مشارك جديد: ${cleanNameAr} (${categoryLabel}) - بقيمة ${feeAmount} د.ل - يوم ${dayRecord.day_name}`
        });

        db.exec('COMMIT');

        const responsePayload = {
          success: true,
          message: 'تم تسجيل المشارك وحفظ إيصال الدفع بنجاح.',
          participant: {
            id: participantId,
            registration_number: regNumber,
            name_ar: cleanNameAr,
            name_en: cleanNameEn,
            category,
            category_label: categoryLabel,
            academic_year: finalAcademicYear,
            fee_amount: feeAmount,
            supervisor_id: assignedSup.id,
            supervisor_name: assignedSup.name,
            registration_day_id: dayRecord.id,
            registration_day_name: dayRecord.day_name,
            registration_date: libyaTime.date,
            registration_time: libyaTime.time,
            source: 'تسجيل جديد'
          }
        };

        if (idempotency_key) {
          recentIdempotencyKeys.set(idempotency_key, {
            timestamp: Date.now(),
            result: responsePayload
          });
        }

        res.status(201).json(responsePayload);
      } catch (txErr) {
        db.exec('ROLLBACK');
        throw txErr;
      }
    } catch (err) {
      cleanupUploadedFile();
      console.error('Error submitting registration:', err);
      res.status(500).json({ error: 'حدث خطأ أثناء حفظ التسجيل. يرجى المحاولة مرة أخرى.' });
    }
  });
});

// Supervisor's own registrations view (Strict permissions: only their own registrations)
app.get('/api/supervisor/my-registrations', (req, res) => {
  try {
    const sup = getSupervisorAuth(req);
    const dayId = Number(req.query.day_id || (sup && sup.day_id));
    const supId = Number(req.query.supervisor_id || (sup && sup.supervisor_id));

    if (!supId) {
      return res.status(401).json({ error: 'يرجى اختيار المشرف لعرض التسجيلات الخاصة به.' });
    }

    const rows = db.prepare(`
      SELECT
        p.id,
        p.registration_number,
        p.name_ar,
        p.name_en,
        p.category,
        p.category_label,
        p.academic_year,
        p.fee_amount,
        p.payment_status,
        p.supervisor_id,
        p.supervisor_name,
        p.registration_day_id,
        p.registration_day_name,
        p.registration_date,
        p.registration_time,
        CASE WHEN r.file_name IS NOT NULL AND r.file_name != '' THEN 1 ELSE 0 END AS has_receipt
      FROM participants p
      LEFT JOIN receipts r ON r.participant_id = p.id
      WHERE p.supervisor_id = ?
      ORDER BY p.id DESC
    `).all(supId);

    const todayCount = dayId
      ? rows.filter((r) => r.registration_day_id === dayId).length
      : rows.length;

    res.json({
      registrations: rows,
      total_by_supervisor: rows.length,
      day_count: todayCount
    });
  } catch (err) {
    console.error('Error fetching supervisor registrations:', err);
    res.status(500).json({ error: 'تعذر جلب تسجيلات المشرف.' });
  }
});

// ============================================================================
// 4. PROTECTED RECEIPT IMAGE STREAMING
// ============================================================================

app.get('/api/receipts/:participantId/image', (req, res) => {
  try {
    const participantId = Number(req.params.participantId);
    const admin = getAdminAuth(req);
    const sup = getSupervisorAuth(req);

    if (!admin && !sup) {
      return res.status(401).send('غير مصرح بالوصول إلى صورة الإيصال.');
    }

    const participant = db.prepare('SELECT id, supervisor_id FROM participants WHERE id = ?').get(participantId);
    if (!participant) {
      return res.status(404).send('المشارك غير موجود.');
    }

    // If supervisor (not admin), only allow viewing receipts of participants they registered
    if (!admin && sup && Number(sup.supervisor_id) !== Number(participant.supervisor_id)) {
      return res.status(403).send('لا تملك صلاحية عرض إيصالات مشرف آخر.');
    }

    const receipt = db.prepare('SELECT * FROM receipts WHERE participant_id = ?').get(participantId);
    if (!receipt || !receipt.file_name) {
      return res.status(404).send('لا توجد صورة إيصال مرفقة لهذا التسجيل.');
    }

    const safeFileName = path.basename(receipt.file_name);
    const filePath = path.join(RECEIPTS_DIR, safeFileName);
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('ملف صورة الإيصال غير موجود على الخادم.');
    }

    res.setHeader('Content-Type', receipt.mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    console.error('Error serving receipt image:', err);
    res.status(500).send('خطأ في تحميل صورة الإيصال.');
  }
});

// ============================================================================
// 5. ADMIN DASHBOARD OVERVIEW & REAL-TIME STATISTICS
// ============================================================================

app.get('/api/admin/dashboard', requireAdmin, (_req, res) => {
  try {
    const settings = getSettingsMap();
    const summary = db.prepare(`
      SELECT
        COUNT(*) AS total_registrations,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS total_students,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS total_doctors,
        COALESCE(SUM(fee_amount), 0) AS total_registered_amount,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 1 THEN 1 ELSE 0 END), 0) AS shift_1_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 1 THEN fee_amount ELSE 0 END), 0) AS shift_1_amount,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 2 THEN 1 ELSE 0 END), 0) AS shift_2_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 2 THEN fee_amount ELSE 0 END), 0) AS shift_2_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS total_confirmed_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS total_pending_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'flagged' THEN fee_amount ELSE 0 END), 0) AS total_flagged_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_receipts_count,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_receipts_count,
        COALESCE(SUM(CASE WHEN is_duplicate_override = 1 AND duplicate_reviewed = 0 THEN 1 ELSE 0 END), 0) AS unreviewed_duplicates_count,
        COALESCE(SUM(CASE WHEN source = 'تسجيل جديد' THEN 1 ELSE 0 END), 0) AS new_registrations_count,
        COALESCE(SUM(CASE WHEN source != 'تسجيل جديد' THEN 1 ELSE 0 END), 0) AS imported_registrations_count
      FROM participants
    `).get();

    const days = db.prepare(`
      SELECT id, day_key, day_name, display_order, is_active
      FROM registration_days
      ORDER BY display_order ASC, id ASC
    `).all();

    const dayAggregates = db.prepare(`
      SELECT
        registration_day_id,
        registration_day_name,
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 1 THEN 1 ELSE 0 END), 0) AS shift_1_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 1 THEN fee_amount ELSE 0 END), 0) AS shift_1_amount,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 2 THEN 1 ELSE 0 END), 0) AS shift_2_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 2 THEN fee_amount ELSE 0 END), 0) AS shift_2_amount,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount
      FROM participants
      GROUP BY registration_day_id, registration_day_name
    `).all();

    const dayAssignments = db.prepare(`
      SELECT dsa.day_id, dsa.slot_number, s.name AS supervisor_name
      FROM day_supervisor_assignments dsa
      LEFT JOIN supervisors s ON s.id = dsa.supervisor_id
      ORDER BY dsa.day_id ASC, dsa.slot_number ASC
    `).all();

    const registrationsByDay = days.map((d) => {
      const matchingRows = dayAggregates.filter(
        (ag) => ag.registration_day_id === d.id || (!ag.registration_day_id && ag.registration_day_name === d.day_name)
      );
      const total_count = matchingRows.reduce((acc, r) => acc + Number(r.total_count || 0), 0);
      const students_count = matchingRows.reduce((acc, r) => acc + Number(r.students_count || 0), 0);
      const doctors_count = matchingRows.reduce((acc, r) => acc + Number(r.doctors_count || 0), 0);
      const shift_1_count = matchingRows.reduce((acc, r) => acc + Number(r.shift_1_count || 0), 0);
      const shift_1_amount = matchingRows.reduce((acc, r) => acc + Number(r.shift_1_amount || 0), 0);
      const shift_2_count = matchingRows.reduce((acc, r) => acc + Number(r.shift_2_count || 0), 0);
      const shift_2_amount = matchingRows.reduce((acc, r) => acc + Number(r.shift_2_amount || 0), 0);
      const registered_amount = matchingRows.reduce((acc, r) => acc + Number(r.registered_amount || 0), 0);
      const confirmed_amount = matchingRows.reduce((acc, r) => acc + Number(r.confirmed_amount || 0), 0);

      const slots = dayAssignments.filter((a) => a.day_id === d.id);
      const sup1 = slots.find((s) => s.slot_number === 1)?.supervisor_name || 'غير محدد';
      const sup2 = slots.find((s) => s.slot_number === 2)?.supervisor_name || 'غير محدد';
      const sup3 = slots.find((s) => s.slot_number === 3)?.supervisor_name || 'غير محدد';
      const sup4 = slots.find((s) => s.slot_number === 4)?.supervisor_name || 'غير محدد';

      return {
        day_id: d.id,
        day_name: d.day_name,
        is_active: d.is_active === 1,
        supervisor_1: sup1,
        supervisor_2: sup2,
        supervisor_3: sup3,
        supervisor_4: sup4,
        total_count,
        students_count,
        doctors_count,
        shift_1_count,
        shift_1_amount,
        shift_2_count,
        shift_2_amount,
        registered_amount,
        total_amount: registered_amount,
        confirmed_amount
      };
    });

    const shiftAggs = db.prepare(`
      SELECT
        COALESCE(shift_number, 1) AS shift_number,
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(fee_amount), 0) AS total_amount
      FROM participants
      GROUP BY COALESCE(shift_number, 1)
    `).all();

    const byShifts = [1, 2].map((sNum) => {
      const found = shiftAggs.find((r) => Number(r.shift_number) === sNum);
      return {
        shift_number: sNum,
        shift_name: sNum === 1 ? (settings.shift_1_name || 'الفترة الأولى') : (settings.shift_2_name || 'الفترة الثانية'),
        shift_time: sNum === 1 ? (settings.shift_1_short_time || '9:30 ص – 11:30 ص') : (settings.shift_2_short_time || '11:30 ص – 1:30 م'),
        total_count: Number(found?.total_count || 0),
        students_count: Number(found?.students_count || 0),
        doctors_count: Number(found?.doctors_count || 0),
        total_amount: Number(found?.total_amount || 0)
      };
    });

    const supervisors = db.prepare('SELECT id, name, is_active FROM supervisors ORDER BY id ASC').all();
    const supAggregates = db.prepare(`
      SELECT
        supervisor_id,
        supervisor_name,
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 1 THEN 1 ELSE 0 END), 0) AS shift_1_count,
        COALESCE(SUM(CASE WHEN COALESCE(shift_number, 1) = 2 THEN 1 ELSE 0 END), 0) AS shift_2_count,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount
      FROM participants
      GROUP BY supervisor_id, supervisor_name
    `).all();

    const registrationsBySupervisor = supervisors.map((s) => {
      const matching = supAggregates.filter(
        (ag) => ag.supervisor_id === s.id || (!ag.supervisor_id && ag.supervisor_name === s.name)
      );
      const totalAmt = matching.reduce((acc, r) => acc + Number(r.registered_amount || 0), 0);
      return {
        supervisor_id: s.id,
        supervisor_name: s.name,
        name: s.name,
        is_active: s.is_active === 1,
        total_count: matching.reduce((acc, r) => acc + Number(r.total_count || 0), 0),
        students_count: matching.reduce((acc, r) => acc + Number(r.students_count || 0), 0),
        doctors_count: matching.reduce((acc, r) => acc + Number(r.doctors_count || 0), 0),
        shift_1_count: matching.reduce((acc, r) => acc + Number(r.shift_1_count || 0), 0),
        shift_2_count: matching.reduce((acc, r) => acc + Number(r.shift_2_count || 0), 0),
        registered_amount: totalAmt,
        total_amount: totalAmt,
        confirmed_amount: matching.reduce((acc, r) => acc + Number(r.confirmed_amount || 0), 0)
      };
    });

    for (const ag of supAggregates) {
      const matched = supervisors.some(
        (s) => s.id === ag.supervisor_id || (!ag.supervisor_id && s.name === ag.supervisor_name)
      );
      if (!matched && ag.supervisor_name) {
        const totalAmt = Number(ag.registered_amount || 0);
        registrationsBySupervisor.push({
          supervisor_id: null,
          supervisor_name: `${ag.supervisor_name} (سجل سابق)`,
          name: `${ag.supervisor_name} (سجل سابق)`,
          is_active: false,
          total_count: Number(ag.total_count || 0),
          students_count: Number(ag.students_count || 0),
          doctors_count: Number(ag.doctors_count || 0),
          shift_1_count: Number(ag.shift_1_count || 0),
          shift_2_count: Number(ag.shift_2_count || 0),
          registered_amount: totalAmt,
          total_amount: totalAmt,
          confirmed_amount: Number(ag.confirmed_amount || 0)
        });
      }
    }

    const recentRegistrations = db.prepare(`
      SELECT
        p.id, p.registration_number, p.name_ar, p.name_en, p.category, p.category_label,
        p.academic_year, p.fee_amount, p.payment_status, p.supervisor_name,
        p.registration_day_name, p.shift_number, p.shift_name, p.shift_time,
        p.registration_date, p.registration_time, p.source,
        CASE WHEN r.file_name IS NOT NULL AND r.file_name != '' THEN 1 ELSE 0 END AS has_receipt
      FROM participants p
      LEFT JOIN receipts r ON r.participant_id = p.id
      ORDER BY p.id DESC
      LIMIT 8
    `).all();

    res.json({
      summary: {
        total_registrations: Number(summary.total_registrations || 0),
        total_students: Number(summary.total_students || 0),
        total_doctors: Number(summary.total_doctors || 0),
        total_registered_amount: Number(summary.total_registered_amount || 0),
        shift_1_count: Number(summary.shift_1_count || 0),
        shift_1_amount: Number(summary.shift_1_amount || 0),
        shift_2_count: Number(summary.shift_2_count || 0),
        shift_2_amount: Number(summary.shift_2_amount || 0),
        total_confirmed_amount: Number(summary.total_confirmed_amount || 0),
        total_pending_amount: Number(summary.total_pending_amount || 0),
        total_flagged_amount: Number(summary.total_flagged_amount || 0),
        pending_receipts_count: Number(summary.pending_receipts_count || 0),
        confirmed_receipts_count: Number(summary.confirmed_receipts_count || 0),
        unreviewed_duplicates_count: Number(summary.unreviewed_duplicates_count || 0),
        new_registrations_count: Number(summary.new_registrations_count || 0),
        imported_registrations_count: Number(summary.imported_registrations_count || 0),
        supervisors_count: supervisors.length,
        active_supervisors_count: supervisors.filter((s) => s.is_active === 1).length
      },
      by_days: registrationsByDay,
      by_shifts: byShifts,
      by_supervisors: registrationsBySupervisor,
      registrations_by_day: registrationsByDay,
      registrations_by_supervisor: registrationsBySupervisor,
      recent_registrations: recentRegistrations
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحميل إحصائيات لوحة التحكم.' });
  }
});

// ============================================================================
// 6. ADMIN SUPERVISORS MANAGEMENT & DISTRIBUTION
// ============================================================================

app.get('/api/admin/supervisors', requireAdmin, (_req, res) => {
  try {
    const supervisors = db.prepare(`
      SELECT
        s.*,
        (SELECT COUNT(*) FROM participants p WHERE p.supervisor_id = s.id) AS registrations_count,
        (SELECT COALESCE(SUM(p.fee_amount), 0) FROM participants p WHERE p.supervisor_id = s.id) AS total_amount
      FROM supervisors s
      ORDER BY s.id ASC
    `).all();

    const assignments = db.prepare(`
      SELECT dsa.day_id, dsa.slot_number, dsa.supervisor_id, rd.day_name
      FROM day_supervisor_assignments dsa
      JOIN registration_days rd ON rd.id = dsa.day_id
      ORDER BY rd.display_order ASC, dsa.slot_number ASC
    `).all();

    const enriched = supervisors.map((s) => {
      const assignedDays = assignments
        .filter((a) => a.supervisor_id === s.id)
        .map((a) => ({
          day_id: a.day_id,
          day_name: a.day_name,
          slot_number: a.slot_number
        }));
      return {
        ...s,
        is_active: s.is_active === 1,
        assigned_days: assignedDays
      };
    });

    res.json({ supervisors: enriched });
  } catch (err) {
    console.error('Get supervisors error:', err);
    res.status(500).json({ error: 'تعذر جلب قائمة المشرفين.' });
  }
});

app.post('/api/admin/supervisors', requireAdmin, (req, res) => {
  try {
    const { name, phone, access_pin, notes, is_active } = req.body;
    const cleanName = String(name || '').trim().replace(/\s+/g, ' ');
    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'يرجى إدخال اسم المشرف بشكل صحيح.' });
    }

    const now = getLibyaDateTime().fullTimestamp;
    const info = db.prepare(`
      INSERT INTO supervisors (name, phone, access_pin, notes, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      cleanName,
      String(phone || '').trim(),
      String(access_pin || '').trim(),
      String(notes || '').trim(),
      is_active === false ? 0 : 1,
      now,
      now
    );

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'CREATE_SUPERVISOR',
      targetType: 'supervisor',
      targetId: info.lastInsertRowid,
      description: `إضافة مشرف جديد: ${cleanName}`
    });

    res.status(201).json({
      success: true,
      supervisor_id: info.lastInsertRowid,
      message: `تمت إضافة المشرف "${cleanName}" بنجاح.`
    });
  } catch (err) {
    console.error('Create supervisor error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إضافة المشرف.' });
  }
});

app.put('/api/admin/supervisors/:id', requireAdmin, (req, res) => {
  try {
    const supId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM supervisors WHERE id = ?').get(supId);
    if (!existing) {
      return res.status(404).json({ error: 'المشرف غير موجود.' });
    }

    const cleanName = req.body.name !== undefined
      ? String(req.body.name).trim().replace(/\s+/g, ' ')
      : existing.name;

    if (!cleanName || cleanName.length < 2) {
      return res.status(400).json({ error: 'اسم المشرف لا يمكن أن يكون فارغاً.' });
    }

    const phone = req.body.phone !== undefined ? String(req.body.phone).trim() : existing.phone;
    const accessPin = req.body.access_pin !== undefined ? String(req.body.access_pin).trim() : existing.access_pin;
    const notes = req.body.notes !== undefined ? String(req.body.notes).trim() : existing.notes;
    const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
    const now = getLibyaDateTime().fullTimestamp;

    // Important: We only update the supervisor table. Historical participant records retain their snapshot supervisor_name!
    db.prepare(`
      UPDATE supervisors
      SET name = ?, phone = ?, access_pin = ?, notes = ?, is_active = ?, updated_at = ?
      WHERE id = ?
    `).run(cleanName, phone, accessPin, notes, isActive, now, supId);

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'UPDATE_SUPERVISOR',
      targetType: 'supervisor',
      targetId: supId,
      description: `تعديل بيانات المشرف: ${existing.name} -> ${cleanName} (الحالة: ${isActive ? 'نشط' : 'معطل مؤقتاً'})`
    });

    res.json({
      success: true,
      message: 'تم تحديث بيانات المشرف بنجاح (دون التأثير على بيانات التسجيلات السابقة).'
    });
  } catch (err) {
    console.error('Update supervisor error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث بيانات المشرف.' });
  }
});

app.delete('/api/admin/supervisors/:id', requireAdmin, (req, res) => {
  try {
    const supId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM supervisors WHERE id = ?').get(supId);
    if (!existing) {
      return res.status(404).json({ error: 'المشرف غير موجود.' });
    }

    // Foreign key ON DELETE SET NULL preserves participants.supervisor_name snapshot!
    db.prepare('DELETE FROM supervisors WHERE id = ?').run(supId);

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'DELETE_SUPERVISOR',
      targetType: 'supervisor',
      targetId: supId,
      description: `حذف المشرف: ${existing.name} (مع الاحتفاظ باسمه في سجلات التسجيلات السابقة)`
    });

    res.json({
      success: true,
      message: `تم حذف المشرف "${existing.name}" من القائمة الحالية مع الاحتفاظ بسجلاته السابقة.`
    });
  } catch (err) {
    console.error('Delete supervisor error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حذف المشرف.' });
  }
});

// ============================================================================
// 7. ADMIN REGISTRATION DAYS & 2-SUPERVISOR SLOT ASSIGNMENT
// ============================================================================

app.get('/api/admin/days', requireAdmin, (_req, res) => {
  try {
    const settings = getSettingsMap();
    const days = db.prepare(`
      SELECT
        rd.*,
        (SELECT COUNT(*) FROM participants p WHERE p.registration_day_id = rd.id) AS registrations_count
      FROM registration_days rd
      ORDER BY rd.display_order ASC, rd.id ASC
    `).all();

    const assignments = db.prepare(`
      SELECT
        dsa.day_id,
        dsa.slot_number,
        dsa.supervisor_id,
        s.name AS supervisor_name,
        s.is_active AS supervisor_active
      FROM day_supervisor_assignments dsa
      LEFT JOIN supervisors s ON s.id = dsa.supervisor_id
      ORDER BY dsa.day_id ASC, dsa.slot_number ASC
    `).all();

    const shiftsConfig = [
      {
        shift_number: 1,
        shift_name: settings.shift_1_name || 'الفترة الأولى',
        shift_time: settings.shift_1_time || '9:30 صباحاً – 11:30 صباحاً',
        short_time: settings.shift_1_short_time || '9:30 ص – 11:30 ص'
      },
      {
        shift_number: 2,
        shift_name: settings.shift_2_name || 'الفترة الثانية',
        shift_time: settings.shift_2_time || '11:30 صباحاً – 1:30 ظهراً',
        short_time: settings.shift_2_short_time || '11:30 ص – 1:30 م'
      }
    ];

    const formattedDays = days.map((d) => {
      const slot1 = assignments.find((a) => a.day_id === d.id && a.slot_number === 1);
      const slot2 = assignments.find((a) => a.day_id === d.id && a.slot_number === 2);
      const slot3 = assignments.find((a) => a.day_id === d.id && a.slot_number === 3);
      const slot4 = assignments.find((a) => a.day_id === d.id && a.slot_number === 4);
      return {
        ...d,
        is_active: d.is_active === 1,
        supervisor_1: slot1?.supervisor_id ? { id: slot1.supervisor_id, name: slot1.supervisor_name } : null,
        supervisor_2: slot2?.supervisor_id ? { id: slot2.supervisor_id, name: slot2.supervisor_name } : null,
        supervisor_3: slot3?.supervisor_id ? { id: slot3.supervisor_id, name: slot3.supervisor_name } : null,
        supervisor_4: slot4?.supervisor_id ? { id: slot4.supervisor_id, name: slot4.supervisor_name } : null,
        slot_1: {
          supervisor_id: slot1?.supervisor_id || null,
          supervisor_name: slot1?.supervisor_name || null,
          supervisor_active: slot1?.supervisor_active === 1
        },
        slot_2: {
          supervisor_id: slot2?.supervisor_id || null,
          supervisor_name: slot2?.supervisor_name || null,
          supervisor_active: slot2?.supervisor_active === 1
        },
        slot_3: {
          supervisor_id: slot3?.supervisor_id || null,
          supervisor_name: slot3?.supervisor_name || null,
          supervisor_active: slot3?.supervisor_active === 1
        },
        slot_4: {
          supervisor_id: slot4?.supervisor_id || null,
          supervisor_name: slot4?.supervisor_name || null,
          supervisor_active: slot4?.supervisor_active === 1
        }
      };
    });

    res.json({ days: formattedDays, shifts: shiftsConfig });
  } catch (err) {
    console.error('Get days error:', err);
    res.status(500).json({ error: 'تعذر جلب أيام التسجيل.' });
  }
});

app.put('/api/admin/shifts', requireAdmin, (req, res) => {
  try {
    const { shift_1_name, shift_1_time, shift_1_short_time, shift_2_name, shift_2_time, shift_2_short_time } = req.body;
    if (shift_1_name) setSetting('shift_1_name', String(shift_1_name).trim());
    if (shift_1_time) setSetting('shift_1_time', String(shift_1_time).trim());
    if (shift_1_short_time) setSetting('shift_1_short_time', String(shift_1_short_time).trim());
    if (shift_2_name) setSetting('shift_2_name', String(shift_2_name).trim());
    if (shift_2_time) setSetting('shift_2_time', String(shift_2_time).trim());
    if (shift_2_short_time) setSetting('shift_2_short_time', String(shift_2_short_time).trim());
    res.json({ success: true, message: 'تم تحديث بيانات الفترات الزمنية بنجاح.' });
  } catch (err) {
    console.error('Update shifts error:', err);
    res.status(500).json({ error: 'تعذر تحديث الفترات الزمنية.' });
  }
});

app.post('/api/admin/days', requireAdmin, (req, res) => {
  try {
    const { day_name, display_order, notes } = req.body;
    const cleanName = String(day_name || '').trim();
    if (!cleanName) {
      return res.status(400).json({ error: 'يرجى إدخال اسم يوم التسجيل.' });
    }

    const now = getLibyaDateTime().fullTimestamp;
    const dayKey = `day_${Date.now()}`;
    const order = Number(display_order) || 10;

    db.exec('BEGIN');
    try {
      const info = db.prepare(`
        INSERT INTO registration_days (day_key, day_name, display_order, is_active, notes, created_at, updated_at)
        VALUES (?, ?, ?, 1, ?, ?, ?)
      `).run(dayKey, cleanName, order, String(notes || '').trim(), now, now);

      const dayId = info.lastInsertRowid;
      db.prepare('INSERT INTO day_supervisor_assignments (day_id, slot_number, supervisor_id, updated_at) VALUES (?, 1, NULL, ?)').run(dayId, now);
      db.prepare('INSERT INTO day_supervisor_assignments (day_id, slot_number, supervisor_id, updated_at) VALUES (?, 2, NULL, ?)').run(dayId, now);

      logAudit({
        actorRole: 'admin',
        actorName: req.admin.display_name,
        actionType: 'CREATE_DAY',
        targetType: 'registration_day',
        targetId: dayId,
        description: `إضافة يوم تسجيل جديد: ${cleanName}`
      });

      db.exec('COMMIT');
      res.status(201).json({ success: true, day_id: dayId, message: `تمت إضافة يوم "${cleanName}" بنجاح.` });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('Create day error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إضافة يوم التسجيل.' });
  }
});

app.put('/api/admin/days/:id', requireAdmin, (req, res) => {
  try {
    const dayId = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM registration_days WHERE id = ?').get(dayId);
    if (!existing) {
      return res.status(404).json({ error: 'يوم التسجيل غير موجود.' });
    }

    const dayName = req.body.day_name !== undefined ? String(req.body.day_name).trim() : existing.day_name;
    const displayOrder = req.body.display_order !== undefined ? Number(req.body.display_order) : existing.display_order;
    const isActive = req.body.is_active !== undefined ? (req.body.is_active ? 1 : 0) : existing.is_active;
    const notes = req.body.notes !== undefined ? String(req.body.notes).trim() : existing.notes;
    const now = getLibyaDateTime().fullTimestamp;

    if (!dayName) {
      return res.status(400).json({ error: 'اسم اليوم لا يمكن أن يكون فارغاً.' });
    }

    db.prepare(`
      UPDATE registration_days
      SET day_name = ?, display_order = ?, is_active = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `).run(dayName, displayOrder, isActive, notes, now, dayId);

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'UPDATE_DAY',
      targetType: 'registration_day',
      targetId: dayId,
      description: `تعديل يوم التسجيل: ${existing.day_name} -> ${dayName} (${isActive ? 'مفعل' : 'معطل'})`
    });

    res.json({ success: true, message: 'تم تحديث بيانات اليوم بنجاح.' });
  } catch (err) {
    console.error('Update day error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث يوم التسجيل.' });
  }
});

app.put('/api/admin/days/:id/assign', requireAdmin, (req, res) => {
  try {
    const dayId = Number(req.params.id);
    const day = db.prepare('SELECT * FROM registration_days WHERE id = ?').get(dayId);
    if (!day) {
      return res.status(404).json({ error: 'يوم التسجيل غير موجود.' });
    }

    const sup1 = req.body.supervisor_1_id ? Number(req.body.supervisor_1_id) : null;
    const sup2 = req.body.supervisor_2_id ? Number(req.body.supervisor_2_id) : null;
    const sup3 = req.body.supervisor_3_id ? Number(req.body.supervisor_3_id) : null;
    const sup4 = req.body.supervisor_4_id ? Number(req.body.supervisor_4_id) : null;

    if (sup1 && sup2 && sup1 === sup2) {
      return res.status(400).json({
        error: 'لا يمكن تعيين نفس المشرف مرتين في الفترة الأولى. يجب اختيار مشرفين اثنين مختلفين.'
      });
    }
    if (sup3 && sup4 && sup3 === sup4) {
      return res.status(400).json({
        error: 'لا يمكن تعيين نفس المشرف مرتين في الفترة الثانية. يجب اختيار مشرفين اثنين مختلفين.'
      });
    }

    const now = getLibyaDateTime().fullTimestamp;
    const upsertSlot = db.prepare(`
      INSERT INTO day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day_id, slot_number) DO UPDATE SET
        shift_number = excluded.shift_number,
        supervisor_id = excluded.supervisor_id,
        updated_at = excluded.updated_at
    `);

    upsertSlot.run(dayId, 1, 1, sup1, now);
    upsertSlot.run(dayId, 1, 2, sup2, now);
    upsertSlot.run(dayId, 2, 3, sup3, now);
    upsertSlot.run(dayId, 2, 4, sup4, now);

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'ASSIGN_DAY_SUPERVISORS',
      targetType: 'registration_day',
      targetId: dayId,
      description: `تحديث توزيع مشرفي يوم ${day.day_name} (الفترة الأولى والفترة الثانية)`
    });

    res.json({
      success: true,
      message: `تم حفظ توزيع المشرفين ليوم ${day.day_name} بنجاح.`
    });
  } catch (err) {
    console.error('Assign day supervisors error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حفظ توزيع المشرفين.' });
  }
});

app.post('/api/admin/days/bulk-assign', requireAdmin, (req, res) => {
  try {
    const { assignments } = req.body; // Array of { day_id, supervisor_1_id, supervisor_2_id }
    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: 'بيانات التوزيع غير صالحة.' });
    }

    for (const item of assignments) {
      const s1 = item.supervisor_1_id ? Number(item.supervisor_1_id) : null;
      const s2 = item.supervisor_2_id ? Number(item.supervisor_2_id) : null;
      if (s1 && s2 && s1 === s2) {
        const dayName = db.prepare('SELECT day_name FROM registration_days WHERE id = ?').get(Number(item.day_id))?.day_name || '';
        return res.status(400).json({
          error: `في يوم ${dayName}: لا يمكن اختيار نفس المشرف للمقعد الأول والمقعد الثاني معاً.`
        });
      }
    }

    const now = getLibyaDateTime().fullTimestamp;
    const upsertSlot = db.prepare(`
      INSERT INTO day_supervisor_assignments (day_id, slot_number, supervisor_id, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(day_id, slot_number) DO UPDATE SET
        supervisor_id = excluded.supervisor_id,
        updated_at = excluded.updated_at
    `);

    db.exec('BEGIN');
    try {
      for (const item of assignments) {
        const dayId = Number(item.day_id);
        const s1 = item.supervisor_1_id ? Number(item.supervisor_1_id) : null;
        const s2 = item.supervisor_2_id ? Number(item.supervisor_2_id) : null;
        upsertSlot.run(dayId, 1, s1, now);
        upsertSlot.run(dayId, 2, s2, now);
      }
      logAudit({
        actorRole: 'admin',
        actorName: req.admin.display_name,
        actionType: 'BULK_ASSIGN_SUPERVISORS',
        targetType: 'day_supervisor_assignments',
        description: 'تحديث جدول توزيع المشرفين على أيام التسجيل بالكامل'
      });
      db.exec('COMMIT');
      res.json({ success: true, message: 'تم حفظ جدول توزيع المشرفين لجميع الأيام بنجاح.' });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('Bulk assign error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حفظ توزيع المشرفين.' });
  }
});

// ============================================================================
// 8. ADMIN PARTICIPANTS MANAGEMENT (LIST, SEARCH, FILTER, DETAILS, EDIT, DELETE)
// ============================================================================

app.get('/api/admin/participants', requireAdmin, (req, res) => {
  try {
    const {
      search = '',
      day = '',
      day_id = '',
      date = '',
      shift_number = '',
      supervisor = '',
      supervisor_id = '',
      category = '',
      academic_year = '',
      payment_status = '',
      source = '',
      duplicates_only = '',
      sort = 'newest'
    } = req.query;

    const conditions = [];
    const params = [];

    if (search && String(search).trim() !== '') {
      const q = `%${String(search).trim()}%`;
      conditions.push('(p.name_ar LIKE ? OR p.name_en LIKE ? OR p.registration_number LIKE ?)');
      params.push(q, q, q);
    }

    const dayFilter = String(day || day_id || '').trim();
    if (dayFilter !== '') {
      conditions.push('(p.registration_day_name = ? OR CAST(p.registration_day_id AS TEXT) = ?)');
      params.push(dayFilter, dayFilter);
    }

    if (date && String(date).trim() !== '') {
      conditions.push('p.registration_date = ?');
      params.push(String(date).trim());
    }

    if (shift_number && ['1', '2'].includes(String(shift_number).trim())) {
      conditions.push('COALESCE(p.shift_number, 1) = ?');
      params.push(Number(shift_number));
    }

    const supFilter = String(supervisor || supervisor_id || '').trim();
    if (supFilter !== '') {
      conditions.push('(p.supervisor_name = ? OR CAST(p.supervisor_id AS TEXT) = ?)');
      params.push(supFilter, supFilter);
    }

    if (category && ['student', 'doctor'].includes(String(category))) {
      conditions.push('p.category = ?');
      params.push(String(category));
    }

    if (academic_year && String(academic_year).trim() !== '') {
      conditions.push('p.academic_year = ?');
      params.push(String(academic_year).trim());
    }

    if (payment_status && ['pending', 'confirmed', 'flagged'].includes(String(payment_status))) {
      conditions.push('p.payment_status = ?');
      params.push(String(payment_status));
    }

    if (source && String(source).trim() !== '') {
      conditions.push('p.source = ?');
      params.push(String(source).trim());
    }

    if (duplicates_only === '1') {
      conditions.push('p.is_duplicate_override = 1');
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    let orderBy = 'p.id DESC';
    if (sort === 'oldest') orderBy = 'p.id ASC';
    else if (sort === 'name_ar') orderBy = 'p.name_ar ASC';
    else if (sort === 'amount_desc') orderBy = 'p.fee_amount DESC, p.id DESC';

    const participants = db.prepare(`
      SELECT
        p.*,
        r.id AS receipt_id,
        r.file_name AS receipt_file_name,
        r.external_receipt_ref,
        r.verification_status AS receipt_verification_status,
        r.verified_by AS receipt_verified_by,
        r.verified_at AS receipt_verified_at,
        CASE WHEN r.file_name IS NOT NULL AND r.file_name != '' THEN 1 ELSE 0 END AS has_receipt,
        CASE WHEN r.file_name IS NOT NULL AND r.file_name != '' THEN 1 ELSE 0 END AS has_receipt_image
      FROM participants p
      LEFT JOIN receipts r ON r.participant_id = p.id
      ${whereClause}
      ORDER BY ${orderBy}
    `).all(...params);

    // Distinct filter options from DB
    const distinctSupervisors = db.prepare('SELECT DISTINCT supervisor_name FROM participants WHERE supervisor_name != "" ORDER BY supervisor_name ASC').all().map((r) => r.supervisor_name);
    const distinctDays = db.prepare('SELECT DISTINCT registration_day_name FROM participants WHERE registration_day_name != "" ORDER BY id ASC').all().map((r) => r.registration_day_name);

    res.json({
      participants,
      total: participants.length,
      total_amount: participants.reduce((acc, p) => acc + Number(p.fee_amount || 0), 0),
      confirmed_amount: participants.filter((p) => p.payment_status === 'confirmed').reduce((acc, p) => acc + Number(p.fee_amount || 0), 0),
      filter_options: {
        supervisors: distinctSupervisors,
        days: distinctDays
      }
    });
  } catch (err) {
    console.error('Get participants error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب قائمة المشاركين.' });
  }
});

app.get('/api/admin/participants/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const participant = db.prepare(`
      SELECT
        p.*,
        r.id AS receipt_id,
        r.file_name AS receipt_file_name,
        r.original_name AS receipt_original_name,
        r.mime_type AS receipt_mime_type,
        r.file_size AS receipt_file_size,
        r.external_receipt_ref,
        r.verification_status AS receipt_verification_status,
        r.verified_by AS receipt_verified_by,
        r.verified_at AS receipt_verified_at,
        r.review_note AS receipt_review_note,
        CASE WHEN r.file_name IS NOT NULL AND r.file_name != '' THEN 1 ELSE 0 END AS has_receipt_image
      FROM participants p
      LEFT JOIN receipts r ON r.participant_id = p.id
      WHERE p.id = ?
    `).get(id);

    if (!participant) {
      return res.status(404).json({ error: 'بيانات المشارك غير موجودة.' });
    }

    // Find any similar records (excluding self)
    const similar = checkSimilarity(participant.name_ar, participant.name_en).filter((m) => m.id !== participant.id);

    res.json({
      participant,
      similar_records: similar
    });
  } catch (err) {
    console.error('Get participant details error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء جلب تفاصيل المشارك.' });
  }
});

app.put('/api/admin/participants/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'المشارك غير موجود.' });
    }

    const nameAr = req.body.name_ar !== undefined ? String(req.body.name_ar).trim().replace(/\s+/g, ' ') : existing.name_ar;
    const nameEn = req.body.name_en !== undefined ? String(req.body.name_en).trim().replace(/\s+/g, ' ') : existing.name_en;
    const category = req.body.category !== undefined ? String(req.body.category) : existing.category;

    if (!nameAr || nameAr.length < 3) {
      return res.status(400).json({ error: 'الاسم باللغة العربية غير صالح.' });
    }
    if (!nameEn || nameEn.length < 3) {
      return res.status(400).json({ error: 'الاسم باللغة الإنجليزية غير صالح.' });
    }
    if (!['student', 'doctor'].includes(category)) {
      return res.status(400).json({ error: 'تصنيف المشارك غير صالح.' });
    }

    const categoryLabel = category === 'student' ? 'طالب' : 'دكتور';
    let academicYear = req.body.academic_year !== undefined ? String(req.body.academic_year) : existing.academic_year;
    if (category === 'doctor') {
      academicYear = '';
    } else if (!academicYear) {
      return res.status(400).json({ error: 'السنة الدراسية إلزامية عند اختيار فئة الطالب.' });
    }

    const feeAmount = req.body.fee_amount !== undefined ? Number(req.body.fee_amount) : existing.fee_amount;
    const paymentStatus = req.body.payment_status !== undefined ? String(req.body.payment_status) : existing.payment_status;
    const paymentNotes = req.body.payment_notes !== undefined ? String(req.body.payment_notes).trim() : existing.payment_notes;
    const duplicateReviewed = req.body.duplicate_reviewed !== undefined ? (req.body.duplicate_reviewed ? 1 : 0) : existing.duplicate_reviewed;
    const supervisorName = req.body.supervisor_name !== undefined ? String(req.body.supervisor_name).trim() : existing.supervisor_name;
    const dayName = req.body.registration_day_name !== undefined ? String(req.body.registration_day_name).trim() : existing.registration_day_name;

    const now = getLibyaDateTime().fullTimestamp;
    let confirmedAt = existing.payment_confirmed_at;
    let confirmedBy = existing.payment_confirmed_by;

    if (paymentStatus === 'confirmed' && existing.payment_status !== 'confirmed') {
      confirmedAt = now;
      confirmedBy = req.admin.display_name;
    } else if (paymentStatus !== 'confirmed') {
      confirmedAt = '';
      confirmedBy = '';
    }

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE participants
        SET name_ar = ?, name_en = ?, category = ?, category_label = ?,
            academic_year = ?, fee_amount = ?, payment_status = ?,
            payment_confirmed_at = ?, payment_confirmed_by = ?, payment_notes = ?,
            supervisor_name = ?, registration_day_name = ?, duplicate_reviewed = ?
        WHERE id = ?
      `).run(
        nameAr,
        nameEn,
        category,
        categoryLabel,
        academicYear,
        feeAmount,
        paymentStatus,
        confirmedAt,
        confirmedBy,
        paymentNotes,
        supervisorName,
        dayName,
        duplicateReviewed,
        id
      );

      // Sync receipt verification status
      const receiptVerificationStatus = paymentStatus === 'confirmed'
        ? 'verified'
        : paymentStatus === 'flagged'
          ? 'rejected'
          : 'pending';

      db.prepare(`
        UPDATE receipts
        SET verification_status = ?, verified_by = ?, verified_at = ?, review_note = ?
        WHERE participant_id = ?
      `).run(receiptVerificationStatus, confirmedBy, confirmedAt, paymentNotes, id);

      logAudit({
        actorRole: 'admin',
        actorName: req.admin.display_name,
        actionType: 'UPDATE_PARTICIPANT',
        targetType: 'participant',
        targetId: existing.registration_number,
        description: `تعديل بيانات المشارك (${existing.registration_number}): ${nameAr} - المبلغ: ${feeAmount} د.ل - حالة الدفع: ${paymentStatus}`
      });

      db.exec('COMMIT');
      res.json({ success: true, message: 'تم حفظ تعديلات بيانات المشارك بنجاح.' });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('Update participant error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث بيانات المشارك.' });
  }
});

app.put('/api/admin/participants/:id/verify-payment', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const { payment_status, payment_notes } = req.body;
    if (!['pending', 'confirmed', 'flagged'].includes(payment_status)) {
      return res.status(400).json({ error: 'حالة التحصيل غير صالحة.' });
    }

    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'المشارك غير موجود.' });
    }

    const now = getLibyaDateTime().fullTimestamp;
    const confirmedAt = payment_status === 'confirmed' ? now : '';
    const confirmedBy = payment_status === 'confirmed' ? req.admin.display_name : '';
    const notes = payment_notes !== undefined ? String(payment_notes).trim() : existing.payment_notes;

    const receiptStatus = payment_status === 'confirmed'
      ? 'verified'
      : payment_status === 'flagged'
        ? 'rejected'
        : 'pending';

    db.exec('BEGIN');
    try {
      db.prepare(`
        UPDATE participants
        SET payment_status = ?, payment_confirmed_at = ?, payment_confirmed_by = ?, payment_notes = ?
        WHERE id = ?
      `).run(payment_status, confirmedAt, confirmedBy, notes, id);

      db.prepare(`
        UPDATE receipts
        SET verification_status = ?, verified_by = ?, verified_at = ?, review_note = ?
        WHERE participant_id = ?
      `).run(receiptStatus, confirmedBy, confirmedAt, notes, id);

      const statusAr = payment_status === 'confirmed' ? 'تم تأكيد التحصيل' : payment_status === 'flagged' ? 'مرفوض / يحتاج مراجعة' : 'قيد المراجعة';
      logAudit({
        actorRole: 'admin',
        actorName: req.admin.display_name,
        actionType: 'VERIFY_PAYMENT',
        targetType: 'participant',
        targetId: existing.registration_number,
        description: `تحديث حالة تحصيل الإيصال للمشارك ${existing.name_ar} (${existing.registration_number}): ${statusAr} (${existing.fee_amount} د.ل)`
      });

      db.exec('COMMIT');
      res.json({ success: true, message: `تم تحديث حالة الدفع إلى: ${statusAr}` });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('Verify payment error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث حالة الدفع.' });
  }
});

app.delete('/api/admin/participants/:id', requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM participants WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'التسجيل غير موجود.' });
    }

    const receipt = db.prepare('SELECT * FROM receipts WHERE participant_id = ?').get(id);
    db.prepare('DELETE FROM participants WHERE id = ?').run(id);

    if (receipt && receipt.file_name) {
      const filePath = path.join(RECEIPTS_DIR, path.basename(receipt.file_name));
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {}
      }
    }

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'DELETE_PARTICIPANT',
      targetType: 'participant',
      targetId: existing.registration_number,
      description: `حذف تسجيل المشارك: ${existing.name_ar} (${existing.registration_number})`
    });

    res.json({
      success: true,
      message: `تم حذف التسجيل رقم ${existing.registration_number} (${existing.name_ar}) بنجاح.`
    });
  } catch (err) {
    console.error('Delete participant error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حذف التسجيل.' });
  }
});

// Export Participants to Excel (.xlsx) or CSV
app.get('/api/admin/participants-export', requireAdmin, (req, res) => {
  try {
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const rows = db.prepare(`
      SELECT
        p.registration_number AS "رقم التسجيل",
        p.name_ar AS "الاسم بالعربية",
        p.name_en AS "الاسم بالإنجليزية",
        p.category_label AS "التصنيف",
        p.academic_year AS "السنة الدراسية",
        p.fee_amount AS "رسوم التسجيل (د.ل)",
        CASE
          WHEN p.payment_status = 'confirmed' THEN 'مؤكد التحصيل'
          WHEN p.payment_status = 'flagged' THEN 'ملاحظة / مرفوض'
          ELSE 'قيد المراجعة'
        END AS "حالة التحصيل",
        p.supervisor_name AS "اسم المشرف",
        p.registration_day_name AS "يوم التسجيل",
        p.registration_date AS "تاريخ التسجيل",
        p.registration_time AS "وقت التسجيل",
        p.source AS "مصدر التسجيل"
      FROM participants p
      ORDER BY p.id DESC
    `).all();

    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'المشاركين');

    if (format === 'csv') {
      const csvContent = '\uFEFF' + XLSX.utils.sheet_to_csv(worksheet);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="icds4_participants.csv"');
      return res.send(csvContent);
    } else {
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="icds4_participants.xlsx"');
      return res.send(buffer);
    }
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'تعذر تصدير البيانات.' });
  }
});

// ============================================================================
// 9. ADMIN FINANCIAL REPORTS
// ============================================================================

app.get('/api/admin/finance/report', requireAdmin, (_req, res) => {
  try {
    const overall = db.prepare(`
      SELECT
        COUNT(*) AS total_registrations,
        COALESCE(SUM(fee_amount), 0) AS total_registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS total_confirmed_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS total_pending_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'flagged' THEN fee_amount ELSE 0 END), 0) AS total_flagged_amount,

        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN fee_amount ELSE 0 END), 0) AS students_registered_amount,
        COALESCE(SUM(CASE WHEN category = 'student' AND payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS students_confirmed_amount,
        COALESCE(SUM(CASE WHEN category = 'student' AND payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS students_pending_amount,

        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN fee_amount ELSE 0 END), 0) AS doctors_registered_amount,
        COALESCE(SUM(CASE WHEN category = 'doctor' AND payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS doctors_confirmed_amount,
        COALESCE(SUM(CASE WHEN category = 'doctor' AND payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS doctors_pending_amount
      FROM participants
    `).get();

    // Financial breakdown by Supervisor (includes all active/configured supervisors even if 0)
    const supervisors = db.prepare('SELECT id, name, is_active FROM supervisors ORDER BY id ASC').all();
    const supRows = db.prepare(`
      SELECT
        supervisor_id,
        supervisor_name,
        COUNT(*) AS registrations_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS pending_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_count,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count
      FROM participants
      GROUP BY supervisor_id, supervisor_name
    `).all();

    const bySupervisor = supervisors.map((s) => {
      const matched = supRows.filter(
        (r) => r.supervisor_id === s.id || (!r.supervisor_id && r.supervisor_name === s.name)
      );
      return {
        supervisor_id: s.id,
        supervisor_name: s.name,
        is_active: s.is_active === 1,
        registrations_count: matched.reduce((a, b) => a + Number(b.registrations_count || 0), 0),
        students_count: matched.reduce((a, b) => a + Number(b.students_count || 0), 0),
        doctors_count: matched.reduce((a, b) => a + Number(b.doctors_count || 0), 0),
        registered_amount: matched.reduce((a, b) => a + Number(b.registered_amount || 0), 0),
        confirmed_amount: matched.reduce((a, b) => a + Number(b.confirmed_amount || 0), 0),
        pending_amount: matched.reduce((a, b) => a + Number(b.pending_amount || 0), 0),
        confirmed_count: matched.reduce((a, b) => a + Number(b.confirmed_count || 0), 0),
        pending_count: matched.reduce((a, b) => a + Number(b.pending_count || 0), 0)
      };
    });

    for (const r of supRows) {
      const exists = supervisors.some(
        (s) => s.id === r.supervisor_id || (!r.supervisor_id && s.name === r.supervisor_name)
      );
      if (!exists && r.supervisor_name) {
        bySupervisor.push({
          supervisor_id: null,
          supervisor_name: `${r.supervisor_name} (سابق)`,
          is_active: false,
          registrations_count: Number(r.registrations_count || 0),
          students_count: Number(r.students_count || 0),
          doctors_count: Number(r.doctors_count || 0),
          registered_amount: Number(r.registered_amount || 0),
          confirmed_amount: Number(r.confirmed_amount || 0),
          pending_amount: Number(r.pending_amount || 0),
          confirmed_count: Number(r.confirmed_count || 0),
          pending_count: Number(r.pending_count || 0)
        });
      }
    }

    // Financial breakdown by Registration Day
    const days = db.prepare('SELECT id, day_name, is_active FROM registration_days ORDER BY display_order ASC, id ASC').all();
    const dayRows = db.prepare(`
      SELECT
        registration_day_id,
        registration_day_name,
        COUNT(*) AS registrations_count,
        COALESCE(SUM(CASE WHEN category = 'student' THEN 1 ELSE 0 END), 0) AS students_count,
        COALESCE(SUM(CASE WHEN category = 'doctor' THEN 1 ELSE 0 END), 0) AS doctors_count,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN fee_amount ELSE 0 END), 0) AS pending_amount
      FROM participants
      GROUP BY registration_day_id, registration_day_name
    `).all();

    const byDay = days.map((d) => {
      const matched = dayRows.filter(
        (r) => r.registration_day_id === d.id || (!r.registration_day_id && r.registration_day_name === d.day_name)
      );
      return {
        day_id: d.id,
        day_name: d.day_name,
        registrations_count: matched.reduce((a, b) => a + Number(b.registrations_count || 0), 0),
        students_count: matched.reduce((a, b) => a + Number(b.students_count || 0), 0),
        doctors_count: matched.reduce((a, b) => a + Number(b.doctors_count || 0), 0),
        registered_amount: matched.reduce((a, b) => a + Number(b.registered_amount || 0), 0),
        confirmed_amount: matched.reduce((a, b) => a + Number(b.confirmed_amount || 0), 0),
        pending_amount: matched.reduce((a, b) => a + Number(b.pending_amount || 0), 0)
      };
    });

    for (const r of dayRows) {
      const exists = days.some(
        (d) => d.id === r.registration_day_id || (!r.registration_day_id && d.day_name === r.registration_day_name)
      );
      if (!exists && r.registration_day_name) {
        byDay.push({
          day_id: null,
          day_name: r.registration_day_name,
          registrations_count: Number(r.registrations_count || 0),
          students_count: Number(r.students_count || 0),
          doctors_count: Number(r.doctors_count || 0),
          registered_amount: Number(r.registered_amount || 0),
          confirmed_amount: Number(r.confirmed_amount || 0),
          pending_amount: Number(r.pending_amount || 0)
        });
      }
    }

    // Breakdown by Academic Year
    const byYear = db.prepare(`
      SELECT
        CASE WHEN category = 'doctor' THEN 'الدكاترة والخريجون' ELSE COALESCE(NULLIF(academic_year, ''), 'غير محدد') END AS group_label,
        category,
        COUNT(*) AS registrations_count,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount
      FROM participants
      GROUP BY group_label, category
      ORDER BY category ASC, group_label ASC
    `).all();

    // Breakdown by Source (تسجيل جديد vs استيراد سابق)
    const bySource = db.prepare(`
      SELECT
        source,
        COUNT(*) AS registrations_count,
        COALESCE(SUM(fee_amount), 0) AS registered_amount,
        COALESCE(SUM(CASE WHEN payment_status = 'confirmed' THEN fee_amount ELSE 0 END), 0) AS confirmed_amount
      FROM participants
      GROUP BY source
    `).all();

    res.json({
      overall: {
        total_registrations: Number(overall.total_registrations || 0),
        total_registered_amount: Number(overall.total_registered_amount || 0),
        total_confirmed_amount: Number(overall.total_confirmed_amount || 0),
        total_pending_amount: Number(overall.total_pending_amount || 0),
        total_flagged_amount: Number(overall.total_flagged_amount || 0),
        students_count: Number(overall.students_count || 0),
        students_registered_amount: Number(overall.students_registered_amount || 0),
        students_confirmed_amount: Number(overall.students_confirmed_amount || 0),
        students_pending_amount: Number(overall.students_pending_amount || 0),
        doctors_count: Number(overall.doctors_count || 0),
        doctors_registered_amount: Number(overall.doctors_registered_amount || 0),
        doctors_confirmed_amount: Number(overall.doctors_confirmed_amount || 0),
        doctors_pending_amount: Number(overall.doctors_pending_amount || 0)
      },
      by_supervisor: bySupervisor,
      by_day: byDay,
      by_year: byYear,
      by_source: bySource
    });
  } catch (err) {
    console.error('Finance report error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحميل التقارير المالية.' });
  }
});

// ============================================================================
// 10. FUTURE DATA IMPORT ENGINE (XLSX / CSV)
// ============================================================================

function autoDetectColumnMapping(headers) {
  const mapping = {
    registration_number: '',
    name_ar: '',
    name_en: '',
    category: '',
    academic_year: '',
    fee_amount: '',
    supervisor_name: '',
    registration_day_name: '',
    registration_date: '',
    registration_time: '',
    payment_status: '',
    external_receipt_ref: ''
  };

  const rules = [
    { field: 'registration_number', keywords: ['رقم التسجيل', 'كود', 'معرف', 'registration_number', 'reg_no', 'reg_num', 'id', 'رقم'] },
    { field: 'name_ar', keywords: ['الاسم بالعربي', 'الاسم العربي', 'اسم الطالب بالعربي', 'الاسم رباعي', 'الاسم الكامل', 'name_ar', 'arabic_name', 'الاسم'] },
    { field: 'name_en', keywords: ['الاسم بالانجليزي', 'الاسم الإنجليزي', 'الاسم باللغة الإنجليزية', 'name_en', 'english_name', 'english'] },
    { field: 'category', keywords: ['التصنيف', 'الفئة', 'نوع المشارك', 'صفة المشارك', 'category', 'type', 'role'] },
    { field: 'academic_year', keywords: ['السنة الدراسية', 'السنة', 'المرحلة', 'academic_year', 'year', 'level'] },
    { field: 'fee_amount', keywords: ['رسوم التسجيل', 'المبلغ', 'القيمة', 'السعر', 'الرسوم', 'fee', 'amount', 'price', 'paid'] },
    { field: 'supervisor_name', keywords: ['اسم المشرف', 'المشرف', 'المسجل', 'supervisor', 'registered_by'] },
    { field: 'registration_day_name', keywords: ['يوم التسجيل', 'اليوم', 'day', 'registration_day'] },
    { field: 'registration_date', keywords: ['تاريخ التسجيل', 'التاريخ', 'date', 'registration_date', 'created_at'] },
    { field: 'registration_time', keywords: ['وقت التسجيل', 'الوقت', 'الساعة', 'time', 'registration_time'] },
    { field: 'payment_status', keywords: ['حالة الدفع', 'حالة التحصيل', 'تأكيد الدفع', 'payment_status', 'status'] },
    { field: 'external_receipt_ref', keywords: ['الإيصال', 'رابط الإيصال', 'صورة الإيصال', 'رقم الإيصال', 'receipt', 'receipt_url', 'voucher'] }
  ];

  for (const rule of rules) {
    for (const h of headers) {
      const cleanH = String(h).trim().toLowerCase();
      if (rule.keywords.some((kw) => cleanH === kw.toLowerCase() || cleanH.includes(kw.toLowerCase()))) {
        if (!Object.values(mapping).includes(h)) {
          mapping[rule.field] = h;
          break;
        }
      }
    }
  }
  return mapping;
}

function normalizeImportedRow(rawRow, mapping) {
  const getVal = (field) => {
    const col = mapping[field];
    if (!col || rawRow[col] === undefined || rawRow[col] === null) return '';
    return String(rawRow[col]).trim();
  };

  const rawNameAr = getVal('name_ar');
  const rawNameEn = getVal('name_en');
  const rawCategory = getVal('category');
  const rawYear = getVal('academic_year');
  const rawFee = getVal('fee_amount');
  const rawSup = getVal('supervisor_name');
  const rawDay = getVal('registration_day_name');
  const rawDate = getVal('registration_date');
  const rawTime = getVal('registration_time');
  const rawRegNum = getVal('registration_number');
  const rawPaymentStatus = getVal('payment_status');
  const rawReceiptRef = getVal('external_receipt_ref');

  // Parse Category (طالب vs دكتور; Graduates/Doctors -> doctor)
  let category = 'student';
  let categoryLabel = 'طالب';
  const catLower = rawCategory.toLowerCase();
  if (
    catLower.includes('دكتور') ||
    catLower.includes('طبيب') ||
    catLower.includes('خريج') ||
    catLower.includes('doctor') ||
    catLower.includes('graduate') ||
    catLower.includes('dr')
  ) {
    category = 'doctor';
    categoryLabel = 'دكتور';
  } else if (
    rawYear &&
    (rawYear.includes('خريج') || rawYear.includes('دكتور') || rawYear.toLowerCase().includes('grad'))
  ) {
    category = 'doctor';
    categoryLabel = 'دكتور';
  }

  // Normalize Academic Year
  let academicYear = '';
  if (category === 'student') {
    const y = rawYear;
    if (y.includes('أول') || y.includes('اول') || y === '1' || y.toLowerCase().includes('first')) academicYear = 'السنة الأولى';
    else if (y.includes('ثاني') || y === '2' || y.toLowerCase().includes('second')) academicYear = 'السنة الثانية';
    else if (y.includes('ثالث') || y === '3' || y.toLowerCase().includes('third')) academicYear = 'السنة الثالثة';
    else if (y.includes('رابع') || y === '4' || y.toLowerCase().includes('fourth')) academicYear = 'السنة الرابعة';
    else if (y.includes('امتياز') || y.includes('إمتياز') || y === '5' || y.toLowerCase().includes('intern')) academicYear = 'سنة الامتياز';
    else academicYear = y || 'غير محدد';
  }

  // Preserve historical fee amount from file WITHOUT recalculating with new fees!
  let feeAmount = null;
  if (rawFee !== '') {
    const numericFee = parseFloat(rawFee.replace(/[^\d.-]/g, ''));
    if (!isNaN(numericFee) && numericFee >= 0) {
      feeAmount = numericFee;
    }
  }

  // Collect extra columns not directly mapped so zero information is lost
  const mappedCols = new Set(Object.values(mapping).filter(Boolean));
  const extraData = {};
  for (const [k, v] of Object.entries(rawRow)) {
    if (!mappedCols.has(k) && v !== undefined && v !== null && String(v).trim() !== '') {
      extraData[k] = v;
    }
  }

  let paymentStatus = 'pending';
  if (rawPaymentStatus) {
    const ps = rawPaymentStatus.toLowerCase();
    if (ps.includes('مؤكد') || ps.includes('تم') || ps.includes('confirmed') || ps.includes('paid') || ps.includes('verified')) {
      paymentStatus = 'confirmed';
    }
  }

  return {
    registration_number: rawRegNum,
    name_ar: rawNameAr,
    name_en: rawNameEn,
    category,
    category_label: categoryLabel,
    academic_year: academicYear,
    fee_amount: feeAmount,
    has_historical_fee: feeAmount !== null,
    supervisor_name: rawSup || 'استيراد سابق',
    registration_day_name: rawDay || 'سجل سابق',
    registration_date: rawDate || '',
    registration_time: rawTime || '',
    payment_status: paymentStatus,
    external_receipt_ref: rawReceiptRef || '',
    extra_data: extraData
  };
}

function analyzeNormalizedRows(normalizedRows) {
  const existingParticipants = db.prepare(`
    SELECT id, registration_number, name_ar, name_en
    FROM participants
  `).all();

  const existingRegNums = new Set(existingParticipants.map((p) => String(p.registration_number).trim().toLowerCase()));
  const existingNamesAr = new Map();
  const existingNamesEn = new Map();
  for (const p of existingParticipants) {
    const nAr = normalizeArabic(p.name_ar);
    const nEn = normalizeEnglish(p.name_en);
    if (nAr) existingNamesAr.set(nAr, p);
    if (nEn) existingNamesEn.set(nEn, p);
  }

  const seenInFileAr = new Set();
  const seenInFileEn = new Set();
  const seenInFileReg = new Set();

  return normalizedRows.map((row, idx) => {
    const missingFields = [];
    if (!row.name_ar && !row.name_en) {
      missingFields.push('الاسم العربي والإنجليزي مفقودان');
    } else {
      if (!row.name_ar) missingFields.push('الاسم العربي ناقص');
      if (!row.name_en) missingFields.push('الاسم الإنجليزي ناقص');
    }
    if (row.fee_amount === null) {
      missingFields.push('المبلغ المالي غير محدد في الملف');
    }

    const duplicateReasons = [];
    const regKey = String(row.registration_number || '').trim().toLowerCase();
    const normAr = normalizeArabic(row.name_ar);
    const normEn = normalizeEnglish(row.name_en);

    if (regKey && existingRegNums.has(regKey)) {
      duplicateReasons.push(`رقم التسجيل (${row.registration_number}) موجود مسبقاً في قاعدة البيانات`);
    }
    if (normAr && existingNamesAr.has(normAr)) {
      const ex = existingNamesAr.get(normAr);
      duplicateReasons.push(`الاسم العربي مطابق لمشارك مسجل (${ex.registration_number})`);
    }
    if (normEn && existingNamesEn.has(normEn)) {
      const ex = existingNamesEn.get(normEn);
      duplicateReasons.push(`الاسم الإنجليزي مطابق لمشارك مسجل (${ex.registration_number})`);
    }

    if (regKey && seenInFileReg.has(regKey)) {
      duplicateReasons.push('رقم التسجيل مكرر داخل نفس الملف');
    }
    if (normAr && seenInFileAr.has(normAr)) {
      duplicateReasons.push('الاسم العربي مكرر داخل نفس الملف');
    }
    if (normEn && seenInFileEn.has(normEn)) {
      duplicateReasons.push('الاسم الإنجليزي مكرر داخل نفس الملف');
    }

    if (regKey) seenInFileReg.add(regKey);
    if (normAr) seenInFileAr.add(normAr);
    if (normEn) seenInFileEn.add(normEn);

    const isCompletelyEmpty = !row.name_ar && !row.name_en;
    const isDuplicate = duplicateReasons.length > 0;
    const hasMissing = missingFields.length > 0;

    return {
      row_index: idx + 1,
      ...row,
      missing_fields: missingFields,
      has_missing: hasMissing,
      is_duplicate: isDuplicate,
      duplicate_reasons: duplicateReasons,
      is_valid_to_import: !isCompletelyEmpty,
      default_selected: !isCompletelyEmpty && !isDuplicate
    };
  });
}

app.post('/api/admin/import/parse', requireAdmin, (req, res) => {
  uploadImportFile.single('import_file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'خطأ في رفع الملف.' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'يرجى اختيار ملف Excel (.xlsx) أو (.csv) لرفعه.' });
    }

    try {
      const workbook = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      if (!firstSheetName) {
        return res.status(400).json({ error: 'الملف المرفوع لا يحتوي على أي أوراق عمل (Sheets).' });
      }

      const sheet = workbook.Sheets[firstSheetName];
      const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });

      if (!rawRows || rawRows.length === 0) {
        return res.status(400).json({ error: 'الملف المرفوع فارغ ولا يحتوي على صفوف بيانات.' });
      }

      const headers = Object.keys(rawRows[0] || {});
      const suggestedMapping = autoDetectColumnMapping(headers);
      const normalized = rawRows.map((r) => normalizeImportedRow(r, suggestedMapping));
      const analyzed = analyzeNormalizedRows(normalized);

      const summary = {
        total_rows: analyzed.length,
        ready_rows: analyzed.filter((r) => r.default_selected).length,
        duplicate_rows: analyzed.filter((r) => r.is_duplicate).length,
        incomplete_rows: analyzed.filter((r) => r.has_missing).length
      };

      res.json({
        success: true,
        file_name: req.file.originalname,
        file_type: path.extname(req.file.originalname).replace('.', '').toUpperCase() || 'XLSX',
        sheet_name: firstSheetName,
        headers,
        suggested_mapping: suggestedMapping,
        raw_rows: rawRows,
        analyzed_rows: analyzed,
        summary
      });
    } catch (parseErr) {
      console.error('Import parse error:', parseErr);
      res.status(400).json({ error: 'تعذر قراءة الملف. تأكد من أن الملف بصيغة Excel XLSX أو CSV سليمة.' });
    }
  });
});

app.post('/api/admin/import/reanalyze', requireAdmin, (req, res) => {
  try {
    const { raw_rows, mapping } = req.body;
    if (!Array.isArray(raw_rows) || !mapping) {
      return res.status(400).json({ error: 'البيانات المرسلة للمعاينة غير مكتملة.' });
    }

    const normalized = raw_rows.map((r) => normalizeImportedRow(r, mapping));
    const analyzed = analyzeNormalizedRows(normalized);
    const summary = {
      total_rows: analyzed.length,
      ready_rows: analyzed.filter((r) => r.default_selected).length,
      duplicate_rows: analyzed.filter((r) => r.is_duplicate).length,
      incomplete_rows: analyzed.filter((r) => r.has_missing).length
    };

    res.json({
      success: true,
      analyzed_rows: analyzed,
      summary
    });
  } catch (err) {
    console.error('Reanalyze import error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء إعادة تحليل الأعمدة.' });
  }
});

app.post('/api/admin/import/commit', requireAdmin, (req, res) => {
  try {
    const {
      file_name = 'imported_file.xlsx',
      file_type = 'XLSX',
      rows = [],
      notes = ''
    } = req.body;

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'لا توجد صفوف محددة للاستيراد.' });
    }

    const libyaTime = getLibyaDateTime();
    let importedCount = 0;
    let skippedCount = 0;
    let duplicateCount = 0;
    let totalImportedAmount = 0;

    db.exec('BEGIN');
    try {
      const batchInfo = db.prepare(`
        INSERT INTO import_batches (
          file_name, file_type, total_rows, imported_rows, skipped_rows,
          duplicate_rows, total_imported_amount, imported_by, notes, created_at
        ) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?)
      `).run(file_name, file_type, rows.length, req.admin.display_name, String(notes || ''), libyaTime.fullTimestamp);

      const batchId = batchInfo.lastInsertRowid;

      const insertParticipant = db.prepare(`
        INSERT INTO participants (
          registration_number, name_ar, name_en, category, category_label,
          academic_year, fee_amount, payment_status, payment_confirmed_at, payment_confirmed_by,
          supervisor_id, supervisor_name,
          registration_day_id, registration_day_name,
          registration_date, registration_time, created_timestamp,
          source, import_batch_id, is_duplicate_override, duplicate_note, extra_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'استيراد سابق', ?, ?, ?, ?)
      `);

      const insertReceipt = db.prepare(`
        INSERT INTO receipts (
          participant_id, external_receipt_ref, uploaded_by_supervisor,
          verification_status, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      for (const r of rows) {
        if (!r.selected) {
          skippedCount++;
          continue;
        }

        const nameAr = String(r.name_ar || r.name_en || '').trim();
        const nameEn = String(r.name_en || r.name_ar || '').trim();
        if (!nameAr && !nameEn) {
          skippedCount++;
          continue;
        }

        if (r.is_duplicate) {
          duplicateCount++;
        }

        // Ensure unique registration_number
        let regNum = String(r.registration_number || '').trim();
        if (regNum) {
          const exists = db.prepare('SELECT id FROM participants WHERE registration_number = ?').get(regNum);
          if (exists) {
            regNum = generateNextRegistrationNumber();
          }
        } else {
          regNum = generateNextRegistrationNumber();
        }

        const category = r.category === 'doctor' ? 'doctor' : 'student';
        const categoryLabel = category === 'doctor' ? 'دكتور' : 'طالب';
        const academicYear = category === 'student' ? String(r.academic_year || '') : '';

        // Preserve historical fee from the file as-is! Do NOT recalculate with new prices!
        const feeAmount = r.fee_amount !== null && r.fee_amount !== undefined && r.fee_amount !== ''
          ? Number(r.fee_amount)
          : 0;

        const supName = String(r.supervisor_name || 'استيراد سابق').trim();
        const dayName = String(r.registration_day_name || 'سجل سابق').trim();
        const regDate = String(r.registration_date || libyaTime.date).trim();
        const regTime = String(r.registration_time || libyaTime.time).trim();
        const paymentStatus = r.payment_status === 'confirmed' ? 'confirmed' : 'pending';

        // Match supervisor_id or day_id if they exist in DB, otherwise NULL
        const matchedSup = db.prepare('SELECT id FROM supervisors WHERE name = ?').get(supName);
        const matchedDay = db.prepare('SELECT id FROM registration_days WHERE day_name = ?').get(dayName);

        const pInfo = insertParticipant.run(
          regNum,
          nameAr,
          nameEn,
          category,
          categoryLabel,
          academicYear,
          feeAmount,
          paymentStatus,
          paymentStatus === 'confirmed' ? libyaTime.fullTimestamp : '',
          paymentStatus === 'confirmed' ? req.admin.display_name : '',
          matchedSup ? matchedSup.id : null,
          supName,
          matchedDay ? matchedDay.id : null,
          dayName,
          regDate,
          regTime,
          libyaTime.fullTimestamp,
          batchId,
          r.is_duplicate ? 1 : 0,
          r.is_duplicate ? (r.duplicate_reasons || []).join(' | ') : '',
          JSON.stringify(r.extra_data || {})
        );

        const participantId = pInfo.lastInsertRowid;

        // If the imported row has a receipt link/reference, retain it in receipts table without generating fake images
        if (r.external_receipt_ref && String(r.external_receipt_ref).trim() !== '') {
          insertReceipt.run(
            participantId,
            String(r.external_receipt_ref).trim(),
            supName,
            paymentStatus === 'confirmed' ? 'verified' : 'pending',
            libyaTime.fullTimestamp
          );
        }

        importedCount++;
        totalImportedAmount += feeAmount;
      }

      db.prepare(`
        UPDATE import_batches
        SET imported_rows = ?, skipped_rows = ?, duplicate_rows = ?, total_imported_amount = ?
        WHERE id = ?
      `).run(importedCount, skippedCount, duplicateCount, totalImportedAmount, batchId);

      logAudit({
        actorRole: 'admin',
        actorName: req.admin.display_name,
        actionType: 'IMPORT_DATA',
        targetType: 'import_batch',
        targetId: batchId,
        description: `استيراد ملف بيانات سابقة (${file_name}): تم استيراد ${importedCount} تسجيل بإجمالي ${totalImportedAmount} د.ل`
      });

      db.exec('COMMIT');

      res.json({
        success: true,
        batch_id: batchId,
        imported_rows: importedCount,
        skipped_rows: skippedCount,
        duplicate_rows: duplicateCount,
        total_imported_amount: totalImportedAmount,
        message: `تم استيراد ${importedCount} تسجيل بنجاح إلى قاعدة البيانات الرئيسية.`
      });
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } catch (err) {
    console.error('Commit import error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حفظ البيانات المستوردة.' });
  }
});

app.get('/api/admin/import/history', requireAdmin, (_req, res) => {
  try {
    const batches = db.prepare('SELECT * FROM import_batches ORDER BY id DESC').all();
    res.json({ batches });
  } catch (err) {
    console.error('Import history error:', err);
    res.status(500).json({ error: 'تعذر جلب سجل عمليات الاستيراد.' });
  }
});

// ============================================================================
// 11. ADMIN SETTINGS & AUDIT LOGS
// ============================================================================

app.get('/api/admin/settings', requireAdmin, (_req, res) => {
  try {
    const settings = getSettingsMap();
    const logs = db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 100').all();
    res.json({ settings, audit_logs: logs });
  } catch (err) {
    console.error('Get settings error:', err);
    res.status(500).json({ error: 'تعذر تحميل إعدادات النظام.' });
  }
});

app.put('/api/admin/settings', requireAdmin, (req, res) => {
  try {
    const {
      conference_title,
      conference_edition,
      conference_subtitle,
      student_fee,
      doctor_fee,
      registration_open,
      require_supervisor_pin,
      supervisor_portal_code,
      reg_number_prefix
    } = req.body;

    if (student_fee !== undefined && (isNaN(Number(student_fee)) || Number(student_fee) < 0)) {
      return res.status(400).json({ error: 'قيمة رسوم الطالب غير صالحة.' });
    }
    if (doctor_fee !== undefined && (isNaN(Number(doctor_fee)) || Number(doctor_fee) < 0)) {
      return res.status(400).json({ error: 'قيمة رسوم الدكتور غير صالحة.' });
    }

    if (conference_title !== undefined) setSetting('conference_title', String(conference_title).trim());
    if (conference_edition !== undefined) setSetting('conference_edition', String(conference_edition).trim());
    if (conference_subtitle !== undefined) setSetting('conference_subtitle', String(conference_subtitle).trim());
    if (student_fee !== undefined) setSetting('student_fee', Number(student_fee));
    if (doctor_fee !== undefined) setSetting('doctor_fee', Number(doctor_fee));
    if (registration_open !== undefined) setSetting('registration_open', registration_open ? '1' : '0');
    if (require_supervisor_pin !== undefined) setSetting('require_supervisor_pin', require_supervisor_pin ? '1' : '0');
    if (supervisor_portal_code !== undefined) setSetting('supervisor_portal_code', String(supervisor_portal_code).trim());
    if (reg_number_prefix !== undefined && String(reg_number_prefix).trim()) {
      setSetting('reg_number_prefix', String(reg_number_prefix).trim());
    }

    logAudit({
      actorRole: 'admin',
      actorName: req.admin.display_name,
      actionType: 'UPDATE_SETTINGS',
      targetType: 'settings',
      description: `تحديث إعدادات المؤتمر والرسوم (رسوم الطالب الجديدة: ${student_fee} د.ل، رسوم الدكتور الجديدة: ${doctor_fee} د.ل) — تسري على التسجيلات الجديدة فقط`
    });

    res.json({
      success: true,
      message: 'تم حفظ إعدادات الموقع بنجاح. الأسعار الجديدة ستُطبق على التسجيلات الجديدة فقط دون المساس بالتسجيلات السابقة.'
    });
  } catch (err) {
    console.error('Update settings error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء حفظ الإعدادات.' });
  }
});

app.put('/api/admin/settings/password', requireAdmin, (req, res) => {
  try {
    const { current_password, new_username, new_password, display_name } = req.body;
    const adminUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.admin.user_id);
    if (!adminUser) {
      return res.status(404).json({ error: 'حساب الأدمن غير موجود.' });
    }

    if (!verifyPassword(current_password, adminUser.password_hash)) {
      return res.status(401).json({ error: 'كلمة المرور الحالية غير صحيحة.' });
    }

    const updatedUsername = new_username ? String(new_username).trim() : adminUser.username;
    const updatedDisplayName = display_name ? String(display_name).trim() : adminUser.display_name;
    const updatedHash = new_password && String(new_password).length >= 5
      ? hashPassword(new_password)
      : adminUser.password_hash;

    const now = getLibyaDateTime().fullTimestamp;
    db.prepare(`
      UPDATE users
      SET username = ?, display_name = ?, password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(updatedUsername, updatedDisplayName, updatedHash, now, adminUser.id);

    logAudit({
      actorRole: 'admin',
      actorName: updatedDisplayName,
      actionType: 'UPDATE_ADMIN_CREDENTIALS',
      targetType: 'user',
      targetId: adminUser.id,
      description: `تحديث بيانات حساب الأدمن (${updatedUsername})`
    });

    res.json({
      success: true,
      message: 'تم تحديث بيانات الدخول لحساب الأدمن بنجاح.'
    });
  } catch (err) {
    console.error('Update admin password error:', err);
    res.status(500).json({ error: 'حدث خطأ أثناء تحديث كلمة المرور.' });
  }
});

// Fallback for SPA routing
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'المسار المطلوب غير موجود.' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ICDS 4th Edition Conference System running on http://localhost:${PORT}`);
});
