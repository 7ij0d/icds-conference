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
  - Completely removed the `Username` requirement for supervisors.
  - Added the **Supervisor Unified Access Gate (`#supervisor-gate-card`)** before entering the Registration Interface.
  - Accepts the unified code `00icds4` case-insensitively (`00icds4`, `00ICDS4`, `00IcDs4`).
  - Correct code directly unlocks the registration interface; incorrect code presents a clear Arabic alert.
- **Official ICDS 2026 Supervisors Schedule Seeded & Verified in Cloud PostgreSQL**:
  - **الأحد**:
    - الفترة الأولى (9:30 ص – 11:30 ص): `هنا أبو حسانة` ، `أروى فوزي`
    - الفترة الثانية (11:30 ص – 1:30 م): `آرام القرني` ، `وديدة السكوني`
  - **الاثنين**:
    - الفترة الأولى (9:30 ص – 11:30 ص): `عبدالمؤمن بن عون` ، `أحمد المشاي`
    - الفترة الثانية (11:30 ص – 1:30 م): `منة إنيبة` ، `وعد القماطي`
  - **الثلاثاء**:
    - الفترة الأولى (9:30 ص – 11:30 ص): `سلمى المراعيش` ، `شهد التويبي`
    - الفترة الثانية (11:30 ص – 1:30 م): `ملك إنيبة` ، `يقين بالقاسم`
  - **الأربعاء**:
    - الفترة الأولى (9:30 ص – 11:30 ص): `أميرة الرقيق` ، `منال يونس`
    - الفترة الثانية (11:30 ص – 1:30 م): شاغر (`؟؟` قابل للتعيين من لوحة الأدمن) ، `الشيماء خالد`
  - **الخميس**:
    - الفترة الأولى (9:30 ص – 11:30 ص): `سلبيل صقر` ، `ميار الفريقة`
    - الفترة الثانية (11:30 ص – 1:30 م): `منصور أحشاد` ، `معاذ المبروك`
- **Zero Fake Participants**: The participants database remains 100% clean with `0` records, ready for live registration.
- **Files Touched**:
  - `vps_icds_server.js`
  - `database.js`
  - `server.js`
  - `index.html` & `public/index.html`
  - `app.js` & `public/app.js`
  - `seed_supervisors.sql`
  - `PROJECT_STATE.md`

## 3. Immediate Next Step
- The system is live, tested, and ready for supervisors to start registering participants using code `00icds4`, and for the admin to assign the open Wednesday slot or import past data whenever provided.
