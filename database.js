const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DATA_DIR = path.join(__dirname, 'storage');
const RECEIPTS_DIR = path.join(DATA_DIR, 'receipts');
const DB_PATH = path.join(DATA_DIR, 'icds4.sqlite');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);

// Enable WAL and foreign keys for reliability and high concurrency
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

function hashPassword(password, salt = null) {
  const actualSalt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(String(password), actualSalt, 10000, 64, 'sha512').toString('hex');
  return `${actualSalt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const candidate = hashPassword(password, salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(storedHash));
  } catch {
    return false;
  }
}

// Helper for Libya Timezone (Africa/Tripoli)
function getLibyaDateTime() {
  const now = new Date();
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Tripoli',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tripoli',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const shortTimeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Tripoli',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const dateStr = dateFormatter.format(now); // YYYY-MM-DD
  const timeFullStr = timeFormatter.format(now); // HH:MM:SS
  const timeShortStr = shortTimeFormatter.format(now); // HH:MM
  return {
    date: dateStr,
    time: timeShortStr,
    fullTimestamp: `${dateStr} ${timeFullStr}`,
    iso: now.toISOString()
  };
}

function initDatabase() {
  db.exec(`
    -- 1. جدول المستخدمين (الأدمن والحسابات الإدارية)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 2. جدول إعدادات المؤتمر والنظام
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 3. جدول المشرفين (يبدأ فارغاً بالكامل بدون أي أسماء وهمية)
    CREATE TABLE IF NOT EXISTS supervisors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      access_pin TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 4. جدول أيام التسجيل
    CREATE TABLE IF NOT EXISTS registration_days (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL UNIQUE,
      day_name TEXT NOT NULL,
      display_order INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 5. جدول توزيع المشرفين على الأيام (4 مشرفين لكل يوم موزعين على فترتين)
    CREATE TABLE IF NOT EXISTS day_supervisor_assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_id INTEGER NOT NULL,
      shift_number INTEGER NOT NULL DEFAULT 1,
      slot_number INTEGER NOT NULL CHECK (slot_number IN (1, 2, 3, 4)),
      supervisor_id INTEGER,
      updated_at TEXT NOT NULL,
      UNIQUE(day_id, slot_number),
      FOREIGN KEY (day_id) REFERENCES registration_days(id) ON DELETE CASCADE,
      FOREIGN KEY (supervisor_id) REFERENCES supervisors(id) ON DELETE SET NULL
    );

    -- 6. جدول المشاركين والتسجيلات (يبدأ فارغاً تماماً)
    CREATE TABLE IF NOT EXISTS participants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      registration_number TEXT NOT NULL UNIQUE,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      category TEXT NOT NULL CHECK (category IN ('student', 'doctor')),
      category_label TEXT NOT NULL,
      academic_year TEXT DEFAULT '',
      fee_amount REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending' CHECK (payment_status IN ('pending', 'confirmed', 'flagged')),
      payment_confirmed_at TEXT DEFAULT '',
      payment_confirmed_by TEXT DEFAULT '',
      payment_notes TEXT DEFAULT '',
      supervisor_id INTEGER,
      supervisor_name TEXT NOT NULL,
      registration_day_id INTEGER,
      registration_day_name TEXT NOT NULL,
      shift_number INTEGER NOT NULL DEFAULT 1,
      shift_name TEXT NOT NULL DEFAULT 'الفترة الأولى',
      shift_time TEXT NOT NULL DEFAULT '9:30 ص – 11:30 ص',
      registration_date TEXT NOT NULL,
      registration_time TEXT NOT NULL,
      created_timestamp TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'تسجيل جديد',
      import_batch_id INTEGER,
      is_duplicate_override INTEGER NOT NULL DEFAULT 0,
      duplicate_note TEXT DEFAULT '',
      duplicate_reviewed INTEGER NOT NULL DEFAULT 0,
      extra_data TEXT DEFAULT '{}',
      FOREIGN KEY (supervisor_id) REFERENCES supervisors(id) ON DELETE SET NULL,
      FOREIGN KEY (registration_day_id) REFERENCES registration_days(id) ON DELETE SET NULL
    );

    -- 7. جدول إيصالات الدفع
    CREATE TABLE IF NOT EXISTS receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      participant_id INTEGER NOT NULL UNIQUE,
      file_name TEXT DEFAULT '',
      original_name TEXT DEFAULT '',
      mime_type TEXT DEFAULT '',
      file_size INTEGER DEFAULT 0,
      storage_path TEXT DEFAULT '',
      external_receipt_ref TEXT DEFAULT '',
      uploaded_by_supervisor TEXT DEFAULT '',
      verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
      verified_by TEXT DEFAULT '',
      verified_at TEXT DEFAULT '',
      review_note TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (participant_id) REFERENCES participants(id) ON DELETE CASCADE
    );

    -- 8. جدول عمليات الاستيراد المستقبلية
    CREATE TABLE IF NOT EXISTS import_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      total_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0,
      skipped_rows INTEGER NOT NULL DEFAULT 0,
      duplicate_rows INTEGER NOT NULL DEFAULT 0,
      total_imported_amount REAL NOT NULL DEFAULT 0,
      imported_by TEXT NOT NULL,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    -- 9. جدول سجل العمليات الإدارية (Audit Logs)
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_role TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action_type TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT DEFAULT '',
      description TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_participants_name_ar ON participants(name_ar);
    CREATE INDEX IF NOT EXISTS idx_participants_name_en ON participants(name_en);
    CREATE INDEX IF NOT EXISTS idx_participants_reg_num ON participants(registration_number);
    CREATE INDEX IF NOT EXISTS idx_participants_day ON participants(registration_day_id);
    CREATE INDEX IF NOT EXISTS idx_participants_sup ON participants(supervisor_id);
    CREATE INDEX IF NOT EXISTS idx_participants_cat ON participants(category);
  `);

  const now = getLibyaDateTime().fullTimestamp;

  // Initialize default Admin account if none exists
  const adminCount = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  if (adminCount === 0) {
    db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, is_active, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', 1, ?, ?)
    `).run('admin', 'مدير النظام - مؤتمر ICDS', hashPassword('icds2026'), now, now);
  }

  // Initialize Conference Settings (No fake data, only functional parameters)
  const defaultSettings = {
    conference_title: 'مؤتمر ICDS الدولي لطب الأسنان',
    conference_edition: 'النسخة الرابعة',
    conference_subtitle: 'نظام التسجيل الإلكتروني الموحد للمشاركين والمشرفين',
    student_fee: '30',
    doctor_fee: '60',
    currency_label: 'دينار ليبي',
    currency_short: 'د.ل',
    registration_open: '1',
    require_supervisor_pin: '0',
    supervisor_portal_code: '00icds4',
    reg_number_prefix: 'ICDS4',
    shift_1_name: 'الفترة الأولى',
    shift_1_time: '9:30 صباحاً – 11:30 صباحاً',
    shift_1_short_time: '9:30 ص – 11:30 ص',
    shift_2_name: 'الفترة الثانية',
    shift_2_time: '11:30 صباحاً – 1:30 ظهراً',
    shift_2_short_time: '11:30 ص – 1:30 م'
  };

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  for (const [k, v] of Object.entries(defaultSettings)) {
    insertSetting.run(k, v, now);
  }
  db.prepare(`UPDATE settings SET value = '00icds4', updated_at = ? WHERE key = 'supervisor_portal_code' AND (value IS NULL OR value = '')`).run(now);

  // Migrate day_supervisor_assignments if it had old CHECK(slot_number IN (1,2))
  try {
    const tableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='day_supervisor_assignments'").get()?.sql || '';
    if (tableSql.includes('slot_number IN (1, 2)')) {
      db.exec(`
        ALTER TABLE day_supervisor_assignments RENAME TO day_supervisor_assignments_old;
        CREATE TABLE day_supervisor_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          day_id INTEGER NOT NULL,
          shift_number INTEGER NOT NULL DEFAULT 1,
          slot_number INTEGER NOT NULL CHECK (slot_number IN (1, 2, 3, 4)),
          supervisor_id INTEGER,
          updated_at TEXT NOT NULL,
          UNIQUE(day_id, slot_number),
          FOREIGN KEY (day_id) REFERENCES registration_days(id) ON DELETE CASCADE,
          FOREIGN KEY (supervisor_id) REFERENCES supervisors(id) ON DELETE SET NULL
        );
        INSERT INTO day_supervisor_assignments (id, day_id, shift_number, slot_number, supervisor_id, updated_at)
        SELECT id, day_id, CASE WHEN slot_number <= 2 THEN 1 ELSE 2 END, slot_number, supervisor_id, updated_at FROM day_supervisor_assignments_old;
        DROP TABLE day_supervisor_assignments_old;
      `);
    }
  } catch {}

  try { db.exec("ALTER TABLE participants ADD COLUMN shift_number INTEGER NOT NULL DEFAULT 1;"); } catch {}
  try { db.exec("ALTER TABLE participants ADD COLUMN shift_name TEXT NOT NULL DEFAULT 'الفترة الأولى';"); } catch {}
  try { db.exec("ALTER TABLE participants ADD COLUMN shift_time TEXT NOT NULL DEFAULT '9:30 ص – 11:30 ص';"); } catch {}

  // Initialize the 5 core Registration Days (Sunday - Thursday) with 4 empty supervisor slots
  const daysCount = db.prepare('SELECT COUNT(*) AS count FROM registration_days').get().count;
  if (daysCount === 0) {
    const coreDays = [
      { key: 'sunday', name: 'الأحد', order: 1 },
      { key: 'monday', name: 'الاثنين', order: 2 },
      { key: 'tuesday', name: 'الثلاثاء', order: 3 },
      { key: 'wednesday', name: 'الأربعاء', order: 4 },
      { key: 'thursday', name: 'الخميس', order: 5 }
    ];

    const insertDay = db.prepare(`
      INSERT INTO registration_days (day_key, day_name, display_order, is_active, notes, created_at, updated_at)
      VALUES (?, ?, ?, 1, '', ?, ?)
    `);
    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
      VALUES (?, ?, ?, NULL, ?)
    `);

    for (const d of coreDays) {
      const info = insertDay.run(d.key, d.name, d.order, now, now);
      const dayId = info.lastInsertRowid;
      insertSlot.run(dayId, 1, 1, now);
      insertSlot.run(dayId, 1, 2, now);
      insertSlot.run(dayId, 2, 3, now);
      insertSlot.run(dayId, 2, 4, now);
    }
  } else {
    const existingDays = db.prepare('SELECT id FROM registration_days').all();
    const insertSlot = db.prepare(`
      INSERT OR IGNORE INTO day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
      VALUES (?, ?, ?, NULL, ?)
    `);
    for (const d of existingDays) {
      insertSlot.run(d.id, 1, 1, now);
      insertSlot.run(d.id, 1, 2, now);
      insertSlot.run(d.id, 2, 3, now);
      insertSlot.run(d.id, 2, 4, now);
    }
  }

  // Seed Official ICDS 2026 Supervisors & Day/Shift Assignments if supervisors table is empty
  const supCount = db.prepare('SELECT COUNT(*) AS count FROM supervisors').get().count;
  if (supCount === 0) {
    const officialSchedule = [
      {
        day_key: 'sunday',
        slots: [
          { shift: 1, slot: 1, name: 'هنا أبو حسانة' },
          { shift: 1, slot: 2, name: 'أروى فوزي' },
          { shift: 2, slot: 3, name: 'آرام القرني' },
          { shift: 2, slot: 4, name: 'وديدة السكوني' }
        ]
      },
      {
        day_key: 'monday',
        slots: [
          { shift: 1, slot: 1, name: 'عبدالمؤمن بن عون' },
          { shift: 1, slot: 2, name: 'أحمد المشاي' },
          { shift: 2, slot: 3, name: 'منة إنيبة' },
          { shift: 2, slot: 4, name: 'وعد القماطي' }
        ]
      },
      {
        day_key: 'tuesday',
        slots: [
          { shift: 1, slot: 1, name: 'سلمى المراعيش' },
          { shift: 1, slot: 2, name: 'شهد التويبي' },
          { shift: 2, slot: 3, name: 'ملك إنيبة' },
          { shift: 2, slot: 4, name: 'يقين بالقاسم' }
        ]
      },
      {
        day_key: 'wednesday',
        slots: [
          { shift: 1, slot: 1, name: 'أميرة الرقيق' },
          { shift: 1, slot: 2, name: 'منال يونس' },
          { shift: 2, slot: 3, name: null },
          { shift: 2, slot: 4, name: 'الشيماء خالد' }
        ]
      },
      {
        day_key: 'thursday',
        slots: [
          { shift: 1, slot: 1, name: 'سلبيل صقر' },
          { shift: 1, slot: 2, name: 'ميار الفريقة' },
          { shift: 2, slot: 3, name: 'منصور أحشاد' },
          { shift: 2, slot: 4, name: 'معاذ المبروك' }
        ]
      }
    ];

    const insertSup = db.prepare(`
      INSERT INTO supervisors (name, phone, access_pin, notes, is_active, created_at, updated_at)
      VALUES (?, '', '', '', 1, ?, ?)
    `);
    const upsertSlot = db.prepare(`
      INSERT INTO day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(day_id, slot_number) DO UPDATE SET
        shift_number = excluded.shift_number,
        supervisor_id = excluded.supervisor_id,
        updated_at = excluded.updated_at
    `);
    const allDays = db.prepare('SELECT id, day_key FROM registration_days').all();
    for (const dayPlan of officialSchedule) {
      const dayRow = allDays.find((d) => d.day_key === dayPlan.day_key);
      if (!dayRow) continue;
      for (const s of dayPlan.slots) {
        let supId = null;
        if (s.name) {
          const info = insertSup.run(s.name, now, now);
          supId = info.lastInsertRowid;
        }
        upsertSlot.run(dayRow.id, s.shift, s.slot, supId, now);
      }
    }
  }
}

function getSettingsMap() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const map = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }
  return map;
}

function setSetting(key, value) {
  const now = getLibyaDateTime().fullTimestamp;
  db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), now);
}

function logAudit({ actorRole, actorName, actionType, targetType, targetId = '', description, metadata = {} }) {
  const now = getLibyaDateTime().fullTimestamp;
  db.prepare(`
    INSERT INTO audit_logs (actor_role, actor_name, action_type, target_type, target_id, description, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorRole || 'system',
    actorName || 'النظام',
    actionType,
    targetType,
    String(targetId),
    description,
    JSON.stringify(metadata),
    now
  );
}

function generateNextRegistrationNumber() {
  const settings = getSettingsMap();
  const prefix = (settings.reg_number_prefix || 'ICDS4').trim();
  const rows = db.prepare('SELECT registration_number FROM participants').all();
  let maxSeq = 0;
  const regex = new RegExp(`^${prefix}-(\\d+)$`, 'i');
  for (const r of rows) {
    const m = String(r.registration_number).match(regex);
    if (m) {
      const num = parseInt(m[1], 10);
      if (!isNaN(num) && num > maxSeq) maxSeq = num;
    }
  }
  const nextSeq = maxSeq + 1;
  return `${prefix}-${String(nextSeq).padStart(4, '0')}`;
}

initDatabase();

module.exports = {
  db,
  DATA_DIR,
  RECEIPTS_DIR,
  hashPassword,
  verifyPassword,
  getLibyaDateTime,
  getSettingsMap,
  setSetting,
  logAudit,
  generateNextRegistrationNumber
};
