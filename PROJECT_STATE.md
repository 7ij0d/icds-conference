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
- **Exact Redesign of "سجل التسجيلات" (Registration Records) matching the Attached Reference Image**:
  - **Desktop / Laptop View**:
    - **Right Sidebar Navigation**: Brand header with dental tooth icon + title, active `سجل التسجيلات` button, links for `الرئيسية`, `إدارة المشرفين والفترات`, `التقارير والإحصائيات`, `استيراد البيانات`, `الإعدادات`, and red `تسجيل الخروج` at the bottom.
    - **Header & Topbar**: Topbar with `المدير العام` pill + notification bell with red alert dot, centered title `سجل التسجيلات` with clipboard icon and subtitle.
    - **Filters Row Card**: Date filter (`التاريخ`), Day filter (`اليوم`), Period filter (`الفترة: جميع الفترات / الفترة الأولى / الفترة الثانية`), and teal submit button (`عرض السجل` with magnifying glass icon).
    - **4 Summary Statistic Cards**:
      1. `إجمالي المسجلين` (Green tint with users icon)
      2. `الفترة الأولى` (Teal tint with single user icon)
      3. `الفترة الثانية` (Blue tint with single user icon)
      4. `إجمالي المبالغ` (Purple tint with currency icon)
    - **Toolbar**: Quick search input (`بحث بالاسم أو رقم التسجيل ...`), `تصدير CSV` button, and green `تصدير Excel` button.
    - **Detailed Table**: Columns: `#`, `الاسم بالعربي`, `الاسم بالإنجليزي`, `نوع المشارك`, `السنة الدراسية`, `رسوم التسجيل`, `المشرف`, `الفترة`, `وقت التسجيل`, `الإيصال` with thumbnail hover eye-overlay to open lightbox.
    - **Pagination Bar**: Rows per page picker (`10`, `25`, `50`, `100`), total results count, and numeric pagination controls (`«`, `‹`, page numbers, `›`, `»`).
  - **Mobile Smartphone View**:
    - Mobile header bar with sidebar toggle button.
    - Stacked vertical filters (Date, Day, Period) and full-width `عرض السجل` button.
    - 2x2 grid summary statistics cards.
    - Search bar and two-column CSV / Excel export buttons.
    - Compact, neat participant cards matching the reference image with index circle, Arabic & English names, registration time, shift badge, and interactive receipt thumbnail preview.
    - Full mobile touch pagination controls.
  - **Functional Filtering**: Filters by date, day, shift, and search update live from both frontend and backend queries.
- **Files Touched**:
  - `index.html` & `public/index.html`
  - `styles.css` & `public/styles.css`
  - `app.js` & `public/app.js`
  - `server.js` & `vps_icds_server.js`
  - `PROJECT_STATE.md`

## 3. Immediate Next Step
- The redesigned Registration Records page is fully deployed and active on GitHub Pages and the Libyan Spider cloud server.
