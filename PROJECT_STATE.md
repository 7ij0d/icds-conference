# PROJECT_STATE.md — ICDS 4th Edition Dental Conference Registration & Management System

## 1. Project Overview & Tech Stack
- **Project**: ICDS Dental Conference – 4th Edition (`مؤتمر ICDS الدولي لطب الأسنان – النسخة الرابعة`) Registration & Supervisor Management System.
- **Live URLs**:
  - **GitHub Pages (Primary Web URL)**: `https://7ij0d.github.io/icds-conference/`
  - **GitHub Repository**: `https://github.com/7ij0d/icds-conference`
  - **Libyan Spider Cloud API & PostgreSQL (`kuro_cloud`)**: `https://api.kurofangs.id.ly/icds/api/*`
- **Architecture**:
  - **Cloud Backend**: Node.js + Express + `pg` (`vps_icds_server.js`) running on Libyan Spider VPS (`102.203.202.115:3400` via `icds-conference.service` and Caddy HTTPS proxy at `/icds/*`), connected to PostgreSQL database `kuro_cloud` (`icds_*` tables) and `/var/www/kuro-uploads/icds-receipts/` for payment receipt storage.
  - **Local Fallback Backend**: Node.js + Express + `better-sqlite3` (`server.js` + `database.js`) on `http://localhost:3400`.
  - **Frontend**: RTL Arabic Responsive UI (`index.html`, `styles.css`, `app.js`, mirrored in `public/`) replicating the exact Desktop & Mobile visual design from the user's reference image.
  - **Zero Pre-Populated Data**: Starts 100% clean without any fake participants, supervisors, receipts, or financial entries.

## 2. Done & Verified
- **2-Shift / 4-Supervisors-Per-Day System (`نظام توزيع المشرفين على فترتين يومياً`)**:
  - Divided each of the 5 registration days (`الأحد`, `الاثنين`, `الثلاثاء`, `الأربعاء`, `الخميس`) into **2 shifts (`فترتين زمنيتين`)** with **2 supervisors per shift (4 supervisors per day total)**:
    - **الفترة الأولى (`shift_number = 1`)**: `9:30 صباحاً – 11:30 صباحاً` (`9:30 ص – 11:30 ص`) — Slots `1` & `2`.
    - **الفترة الثانية (`shift_number = 2`)**: `11:30 صباحاً – 1:30 ظهراً` (`11:30 ص – 1:30 م`) — Slots `3` & `4`.
  - **Registration Interface (`تسجيل المشاركين`)**:
    - Step 1: Select Registration Day (`الأحد` – `الخميس`).
    - Step 2: Select Shift (`الفترة الأولى: 9:30 صباحاً – 11:30 صباحاً` or `الفترة الثانية: 11:30 صباحاً – 1:30 ظهراً`).
    - Step 3: Select Supervisor from the dropdown, which dynamically lists **only the 2 supervisors assigned to that specific day and shift**.
    - Immutable snapshot stored with every participant registration (`shift_number`, `shift_name`, `shift_time`, `supervisor_name`, `registration_day_name`, `registration_date`, `registration_time`) so replacing or reassigning a supervisor later never alters past registrations.
  - **Admin Panel (`لوحة الأدمن`)**:
    - **Tab 1 (`إدارة المشرفين والفترات الزمنية`)**: Per-day schedule table (`الفترة | الوقت | المشرفون`) to assign/replace/move 2 supervisors for الفترة الأولى and 2 supervisors for الفترة الثانية on each day, plus editable shift timings and full supervisor CRUD.
    - **Tab 2 (`إدارة التسجيلات`)**: Added filter by Shift (`الفترة الزمنية`) alongside Day, Supervisor, Category, and Academic Year, and displayed the shift badge on every registration record.
    - **Tab 4 (`التقارير`)**: Detailed counts and financial totals by Day, by Shift (`الفترة الأولى` vs `الفترة الثانية`), and by Supervisor.
- **Files Touched**:
  - `supabase_icds_schema.sql`
  - `vps_icds_server.js`
  - `database.js`
  - `server.js`
  - `index.html` & `public/index.html`
  - `styles.css` & `public/styles.css`
  - `app.js` & `public/app.js`
  - `PROJECT_STATE.md`

## 3. Immediate Next Step
- Ready for the user to add supervisors and assign 2 supervisors to Shift 1 and 2 supervisors to Shift 2 for each day from **لوحة الأدمن -> إدارة المشرفين والفترات الزمنية**, or provide legacy registration files when ready to run the historical import tool.
