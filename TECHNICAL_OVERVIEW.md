# School AI Search Technical Overview

School AI Search is a school administration and student-search application. It combines a React/Vite frontend, a local Node HTTP backend, PostgreSQL persistence, rule-based student analysis, audit logging, and PDF report-card generation.

## What the Project Does

- Lets users sign up and sign in as local school users.
- Stores and manages student records with grades, sections, contact details, GPA, attendance, subjects, and notes.
- Stores expanded student profile data including medical records, emergency contacts, blood group, lifecycle status, graduation, transfer, and alumni notes.
- Tracks admissions applications and uploaded document metadata.
- Manages academic setup for classes, sections, subjects, teachers, allocations, and timetables.
- Records daily attendance and parent alert delivery state.
- Manages exams, exam schedules, gradebook entries, report cards, and transcripts/progress data.
- Supports bursar-office records for fee structures, invoices, payments, and receipts.
- Supports portal accounts, notices, and internal school messages.
- Tracks ancillary services: library loans, transport routes, hostel rooms, and store inventory.
- Stores compliance reports and analytics snapshots for performance and financial reporting.
- Provides a chat interface for student search and analysis questions.
- Persists conversations and chat messages.
- Records audit log entries for administrative actions.
- Generates formal PDF report cards for individual students.
- Runs locally with npm or inside Docker for development and production-style deployments.

## Main Technical Stack

- Frontend: React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui-style components, Radix UI primitives.
- Backend: Node.js HTTP server using native `http` APIs.
- Database: PostgreSQL through `pg`; tests can run against `pg-mem`.
- PDF generation: `pdf-lib`.
- Containerization: Dockerfile plus production and development Docker Compose files.

## Application Flow

1. The frontend starts from `src/main.tsx` and renders `src/App.tsx`.
2. App-level providers manage auth, chat, theme, and shared state.
3. Chat and management screens call local backend endpoints.
4. The backend initializes the database schema on startup and seeds students when the student table is empty.
5. Student search requests are handled by a rule-based service that reads student records and formats Markdown responses.
6. Report-card requests load a student record and return a generated PDF.

## Backend Functions and Endpoints

The local backend lives in `server/local-backend.mjs`.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Health check with student count. |
| `/api/db` | `POST` | Generic database operations for allowed tables. |
| `/api/functions/auth` | `POST` | Sign up, sign in, audit-log write, and audit-log read actions. |
| `/api/functions/ai-chat` | `POST` | Creates chat messages and returns a student-search response. |
| `/api/functions/ai-models` | `POST` | Lists selectable AI search models and provider configuration state. |
| `/api/functions/voice-to-text` | `POST` | Placeholder voice transcription response. |
| `/api/functions/payments` | `POST` | Initiates MTN MoMo, Airtel Money, or bank payment requests; checks status; records callbacks. |
| `/api/report-cards/:studentId.pdf` | `GET` | Generates a PDF report card for a student. |
| Static files | `GET` | Serves the built frontend from `dist` in production mode. |

## Functional Coverage

The requested school-management areas are represented as backend database resources available through `/api/db`.

| Area | Current Support |
| --- | --- |
| Student Information Management | `students` for profiles/lifecycle/medical/emergency data, plus `admissions` for applications and document metadata. |
| Academic & Curriculum Management | `classes`, `subjects_catalog`, `teachers`, `subject_allocations`, and `timetables`. |
| Attendance Tracking | `attendance_records` and `attendance_alerts`. |
| Examination & Gradebooks | `exams`, `exam_schedules`, `gradebook_entries`, and PDF report-card generation. |
| Financial Management | `fee_structures`, `invoices`, `payments`, and `receipts`. |
| Communication & Portal Access | `portal_accounts`, `notices`, and `internal_messages`. |
| Ancillary Services | `library_books`, `library_loans`, `transport_routes`, `transport_assignments`, `hostel_rooms`, `hostel_assignments`, `inventory_items`, and `inventory_transactions`. |
| Reporting & Analytics | `compliance_reports` and `analytics_snapshots`. |

## Database Tables

Schema creation is handled by `server/db/schema.mjs`.

| Table | Purpose |
| --- | --- |
| `students` | Student profiles, GPA, attendance, subjects, and notes. |
| `users` | Local auth users with roles and password hashes. |
| `conversations` | Chat conversation metadata. |
| `messages` | User and assistant chat messages. |
| `audit_logs` | Administrative action history. |
| `admissions` | Applications, registration state, document metadata, and admissions notes. |
| `classes` | Grade, section, stream, room, year, and capacity setup. |
| `subjects_catalog` | Subject codes, names, grade levels, and departments. |
| `teachers` | Teacher/staff identity and department records. |
| `subject_allocations` | Links subjects to teachers, classes, students, years, and terms. |
| `timetables` | Class schedules with subject, teacher, room, day, and time. |
| `attendance_records` | Daily present, absent, late, and excused records. |
| `attendance_alerts` | SMS/email parent notification tracking for attendance events. |
| `exams` | Internal or external assessment definitions. |
| `exam_schedules` | Assessment datesheets by class, subject, room, and time. |
| `gradebook_entries` | Scores, grades, remarks, rankings, and assessment results. |
| `fee_structures` | Tuition and service fee tiers by grade, student type, year, and term. |
| `payments` | Tuition, transport, lab, or other payment records. |
| `invoices` | Student invoices with balances and line items. |
| `receipts` | Issued receipts linked to payments. |
| `payment_transactions` | Gateway transaction tracking for MTN MoMo, Airtel Money, and bank collections. |
| `portal_accounts` | Parent and student portal login records. |
| `notices` | Digital notice-board announcements. |
| `internal_messages` | Teacher, parent, and school-office communication records. |
| `library_books` | Book catalog and availability. |
| `library_loans` | Book issues, returns, due dates, and fines. |
| `transport_routes` | Bus routes, drivers, buses, and route stops. |
| `transport_assignments` | Student pickup and drop-off assignments. |
| `hostel_rooms` | Boarding room capacity and room inventory. |
| `hostel_assignments` | Student room and bed assignments. |
| `inventory_items` | School store, uniform, stationery, and supply stock. |
| `inventory_transactions` | Stock-in, stock-out, and adjustment history. |
| `compliance_reports` | Ministry/regulatory reporting payloads and status. |
| `analytics_snapshots` | Performance, attendance, and financial analytics metrics. |

Important indexes are added for student names, grade searches, conversation ordering, message lookups, and audit-log ordering.

## Student Chat Capabilities

AI search supports selectable models. The local rule-based search service lives in `server/services/student-chat.mjs`; multi-provider model routing lives in `server/services/llm-models.mjs`.

Built-in model providers:

- `local_rules` for offline deterministic student search.
- `openai` through the Chat Completions API.
- `anthropic` through the Messages API.
- `google` through Gemini `generateContent`.
- `groq`, `mistral`, and `openrouter` through OpenAI-compatible chat endpoints.
- `ollama` through the local Ollama `/api/chat` endpoint for open-source local models.

The frontend model picker calls `/api/functions/ai-models`, then sends the selected `modelId` to `/api/functions/ai-chat`.

Local Rules can answer prompts for:

- A specific student by full name or student ID.
- Top students by GPA.
- Honor roll or GPA threshold searches.
- Low-attendance searches.
- Subject-based searches.
- Grade and section filters.
- Full student lists.
- Dataset summaries such as total students, active students, average GPA, and average attendance.

Image uploads are stored with the conversation metadata, but OCR/image understanding is still a placeholder.
Remote multimodal models can be added to the catalog, but the default prompt currently sends text student context only.

## Report Cards

Report cards are generated by `server/reports/report-card.mjs` and exposed through `GET /api/report-cards/:studentId.pdf`.

Each PDF includes school identity, term information, student details, GPA, attendance, subject rows, teacher comments, and notes.

## Docker Operations

Use the root helper script:

```bash
./containers.sh
```

The script opens an interactive menu where you choose the environment and then select numbered actions for build, start, stop, restart, delete, status, and logs.
It also includes an endpoints option that shows where to find the frontend, backend API, backend health check, and database connection after containers are running.

You can also run commands directly:

```bash
./containers.sh build
./containers.sh start
./containers.sh stop
./containers.sh delete
./containers.sh endpoints
```

By default the script targets the production stack in `docker-compose.yml`. Pass `dev` as the second argument to use `docker-compose.dev.yml`:

```bash
./containers.sh start dev
./containers.sh logs dev
./containers.sh delete dev
```

Production defaults:

- App: `http://127.0.0.1:8787`
- Database: internal `db` service

Development defaults:

- Frontend: `http://127.0.0.1:8080`
- Backend API: `http://127.0.0.1:8787`
- PostgreSQL: `127.0.0.1:5432`

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATABASE_SSL` | Enables PostgreSQL SSL when set to `true`. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Controls SSL certificate verification. |
| `DATABASE_POOL_SIZE` | PostgreSQL pool size. |
| `LOCAL_BACKEND_HOST` | Backend bind host. |
| `LOCAL_BACKEND_PORT` | Backend port. |
| `LOCAL_STATIC_ROOT` | Static frontend directory for production serving. |
| `SCHOOL_NAME` | Report-card and school branding name. |
| `SCHOOL_TAGLINE` | Report-card and school branding tagline. |
| `APP_PORT` | Host port for the production Docker app. |
| `DEV_APP_PORT` | Host port for the development frontend. |
| `DEV_API_PORT` | Host port for the development API. |
| `DEV_DB_PORT` | Host port for the development database. |
| `AI_DEFAULT_MODEL_ID` | Default model selected by the backend, default `local-rules`. |
| `AI_MODEL_CATALOG` | Optional JSON array that replaces the built-in model catalog. |
| `AI_TEMPERATURE` | LLM sampling temperature, default `0.2`. |
| `AI_MAX_TOKENS` | Maximum response tokens for remote providers, default `900`. |
| `OPENAI_API_KEY` | OpenAI API key. |
| `OPENAI_MODEL` | OpenAI model name, default `gpt-4o-mini`. |
| `OPENAI_BASE_URL` | OpenAI-compatible base URL for OpenAI. |
| `ANTHROPIC_API_KEY` | Anthropic API key. |
| `ANTHROPIC_MODEL` | Anthropic model name. |
| `ANTHROPIC_BASE_URL` | Anthropic API base URL. |
| `ANTHROPIC_VERSION` | Anthropic API version header. |
| `GOOGLE_GEMINI_API_KEY` | Google Gemini API key. |
| `GOOGLE_GEMINI_MODEL` | Gemini model name. |
| `GOOGLE_GEMINI_BASE_URL` | Gemini REST base URL. |
| `GROQ_API_KEY` | Groq API key. |
| `GROQ_MODEL` | Groq model name. |
| `GROQ_BASE_URL` | Groq OpenAI-compatible base URL. |
| `MISTRAL_API_KEY` | Mistral API key. |
| `MISTRAL_MODEL` | Mistral model name. |
| `MISTRAL_BASE_URL` | Mistral API base URL. |
| `OPENROUTER_API_KEY` | OpenRouter API key. |
| `OPENROUTER_MODEL` | OpenRouter model slug. |
| `OPENROUTER_BASE_URL` | OpenRouter OpenAI-compatible base URL. |
| `OPENROUTER_HTTP_REFERER` | Optional OpenRouter referer header. |
| `OPENROUTER_APP_TITLE` | Optional OpenRouter title header. |
| `OLLAMA_BASE_URL` | Ollama base URL, default points to host machine in Docker. |
| `OLLAMA_MODEL` | Ollama local model name, default `llama3.1`. |
| `PAYMENT_GATEWAY_MODE` | `mock` for local simulation or live mode for configured providers. |
| `PAYMENT_CURRENCY` | Default payment currency, usually `UGX`. |
| `PAYMENT_CALLBACK_URL` | Public callback URL registered with payment providers. |
| `MTN_MOMO_BASE_URL` | MTN MoMo API base URL. |
| `MTN_MOMO_SUBSCRIPTION_KEY` | MTN MoMo collection subscription key. |
| `MTN_MOMO_API_USER` | MTN MoMo API user. |
| `MTN_MOMO_API_KEY` | MTN MoMo API key. |
| `MTN_MOMO_TARGET_ENVIRONMENT` | MTN MoMo target environment, such as `sandbox`. |
| `AIRTEL_MONEY_BASE_URL` | Airtel Money API base URL from the Airtel developer portal. |
| `AIRTEL_MONEY_CLIENT_ID` | Airtel Money client ID. |
| `AIRTEL_MONEY_CLIENT_SECRET` | Airtel Money client secret. |
| `AIRTEL_MONEY_COUNTRY` | Airtel Money country code, default `UG`. |
| `AIRTEL_MONEY_TOKEN_PATH` | Airtel Money OAuth token path. |
| `AIRTEL_MONEY_COLLECTION_PATH` | Airtel Money collection request path. |
| `BANK_PAYMENT_GATEWAY_URL` | Bank or aggregator endpoint for bank payment collection requests. |
| `BANK_PAYMENT_API_KEY` | API key for the bank payment gateway. |

## Payment Gateway Flow

Payment gateway integration is implemented in `server/services/payment-gateway.mjs` and exposed through `POST /api/functions/payments`.

Supported actions:

```json
{ "action": "initiate" }
{ "action": "status" }
{ "action": "callback" }
```

Supported providers:

- `mtn_momo`
- `airtel_money`
- `bank`

Local development uses `PAYMENT_GATEWAY_MODE=mock` by default. Mock mode records the transaction and returns student-facing instructions without contacting a live provider. Live mode uses provider credentials from environment variables and stores every request in `payment_transactions`.

Example MTN MoMo school-fee request:

```json
{
  "action": "initiate",
  "provider": "mtn_momo",
  "studentId": "student-001",
  "invoiceId": "invoice-001",
  "amount": 200000,
  "currency": "UGX",
  "phoneNumber": "+256770000001",
  "chargeType": "school_fees",
  "description": "Term tuition deposit"
}
```

When a callback marks a transaction as `successful`, the backend creates a `payments` row and reduces the linked invoice balance. Invoices become `partial` or `paid` based on the remaining balance.

## Quality Checks

Useful project commands:

```bash
npm run build
npm run lint
npm run test:backend
```

The backend test uses an in-memory PostgreSQL-compatible database and verifies auth, database queries, audit logging, chat, voice placeholder behavior, and PDF generation.
