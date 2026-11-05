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
- **Direct Supervisor Access (واجهة تسجيل المشاركين تفتح مباشرة)**:
  - المشرفون يدخلون مباشرة إلى صفحة **تسجيل المشاركين** دون أي كلمة مرور أو رمز دخول أو اسم مستخدم.
  - بمجرد فتح الموقع تظهر استمارة التسجيل مباشرة: يختار المشرف اليوم $\leftarrow$ يختار الفترة الزمنية $\leftarrow$ يختار اسمه مباشرة من قائمة المشرفين المخصصين.
- **Unified Admin Code (`00icds4`, No Username)**:
  - تم إلغاء خانة اسم المستخدم بالكامل من لوحة الأدمن.
  - الدخول إلى **لوحة الأدمن** برمز الدخول الموحد فقط: `00icds4`.
  - يقبل الرمز بحروف صغيرة أو كبيرة أو مختلطة (`00icds4` ، `00ICDS4` ، `00IcDs4`).
- **Official ICDS 2026 Supervisors Schedule Seeded in Cloud PostgreSQL**:
  - جميع المشرفين موزعين بدقة على الأيام الخمسة والفترتين الصباحية والمسائية.
- **Files Touched**:
  - `index.html` & `public/index.html`
  - `app.js` & `public/app.js`
  - `server.js` & `vps_icds_server.js`
  - `PROJECT_STATE.md`

## 3. Immediate Next Step
- النظام جاهز بالكامل للتسجيل المباشر من المشرفين ولإدارة الأدمن باستخدام الرمز الموحد `00icds4`.
