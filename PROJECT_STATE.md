# PROJECT_STATE.md — ICDS 4th Edition Dental Conference Registration & Management System

## 1. Project Overview & Tech Stack
- **Project**: ICDS Dental Conference – 4th Edition (`مؤتمر ICDS الدولي لطب الأسنان – النسخة الرابعة`) Registration & Supervisor Management System.
- **Live URLs**:
  - **GitHub Pages (Primary Web URL)**: `https://7ij0d.github.io/icds-conference/`
  - **GitHub Repository**: `https://github.com/7ij0d/icds-conference`
  - **Libyan Spider Cloud API & PostgreSQL (`kuro_cloud`)**: `https://api.kurofangs.id.ly/icds/api/*`
- **Architecture**:
  - **Cloud Backend**: Node.js + Express + `pg` (`vps_icds_server.js`) running on Libyan Spider VPS (`102.203.202.115:3400` via `icds-conference.service` and Caddy HTTPS proxy at `/icds/*`), connected to PostgreSQL database `kuro_cloud` (`icds_*` tables) and `/var/lib/kuro-cloud/storage/icds-receipts/` for payment receipt storage.
  - **Local Fallback Backend**: Node.js + Express + `node:sqlite` (`server.js` + `database.js`) on `http://localhost:3400`.
  - **Frontend**: RTL Arabic Responsive UI (`index.html`, `styles.css`, `app.js`, mirrored in `public/`) replicating the exact Desktop & Mobile visual design from the user's reference image.

## 2. Done & Verified
- **Unified Supervisor Access Code (`00icds4`, Case-Insensitive, Zero Username)**:
  - Removed the `اسم المستخدم (Username)` field completely across the system.
  - Added the **Supervisor Unified Access Gate (`#supervisor-gate-card`)** before entering the Registration Interface (`واجهة التسجيل`).
  - Supervisors enter only the unified code `00icds4` (case-insensitive: `00icds4`, `00ICDS4`, `00IcDs4` are all valid) without any username or separate supervisor accounts.
  - Entering the valid code transitions immediately to the Registration Form (`واجهة التسجيل`) where the supervisor selects Day -> Shift -> Supervisor Name.
  - Entering an invalid code shows a clear error alert (`رمز الدخول غير صحيح. يرجى التأكد من الرمز والمحاولة مرة أخرى.`).
- **Official ICDS 2026 Supervisors Schedule Seeded & Assigned Across 5 Days & 2 Shifts**:
  - **الأحد**:
    - الفترة الأولى (9:30 – 11:30): `هنا أبو حسانة` ، `أروى فوزي`
    - الفترة الثانية (11:30 – 1:30): `آرام القرني` ، `وديدة السكوني`
  - **الاثنين**:
    - الفترة الأولى (9:30 – 11:30): `عبدالمؤمن بن عون` ، `أحمد المشاي`
    - الفترة الثانية (11:30 – 1:30): `منة إنيبة` ، `وعد القماطي`
  - **الثلاثاء**:
    - الفترة الأولى (9:30 – 11:30): `سلمى المراعيش` ، `شهد التويبي`
    - الفترة الثانية (11:30 – 1:30): `ملك إنيبة` ، `يقين بالقاسم`
  - **الأربعاء**:
    - الفترة الأولى (9:30 – 11:30): `أميرة الرقيق` ، `منال يونس`
    - الفترة الثانية (11:30 – 1:30): (شاغر قابل للتعيين من لوحة الأدمن) ، `الشيماء خالد`
  - **الخميس**:
    - الفترة الأولى (9:30 – 11:30): `سلبيل صقر` ، `ميار الفريقة`
    - الفترة الثانية (11:30 – 1:30): `منصور أحشاد` ، `معاذ المبروك`
- **Files Touched**:
  - `vps_icds_server.js`
  - `database.js`
  - `server.js`
  - `index.html` & `public/index.html`
  - `app.js` & `public/app.js`
  - `PROJECT_STATE.md`

## 3. Immediate Next Step
- Ready for supervisors to log in with `00icds4` and begin participant registration, and for the Admin to assign the remaining Wednesday Shift 2 slot (`؟؟`) whenever ready or import historical participant records when provided.
