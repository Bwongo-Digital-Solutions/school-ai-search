# School AI Search Technical Overview

School AI Search is a school administration, teaching and student-search application. It combines a React/Vite frontend, a local Node HTTP backend, PostgreSQL persistence, rule-based student analysis, a retrieval-grounded AI agent with Model Context Protocol support, audit logging, and PDF generation for report cards, exam papers and lesson plans.

## What the Project Does

- Lets users sign up and sign in as local school users.
- Stores and manages student records with grades, sections, contact details, GPA, attendance, subjects, and notes.
- Stores expanded student profile data including medical records, emergency contacts, blood group, lifecycle status, graduation, transfer, and alumni notes.
- Tracks admissions applications and uploaded document metadata.
- Manages academic setup for classes, sections, subjects, teachers, allocations, and timetables.
- Records daily attendance and parent alert delivery state.
- Manages exams, exam schedules, gradebook entries, report cards, and transcripts/progress data.
- Records discipline incidents, promotion/graduation decisions, transfers, and withdrawals.
- Supports bursar-office records for fee structures, invoices, payments, and receipts.
- Supports portal accounts, notices, and internal school messages.
- Tracks ancillary services: library loans, transport routes, hostel rooms, and store inventory.
- Stores compliance reports and analytics snapshots for performance and financial reporting.
- Provides a chat interface for student search and analysis questions, which can run as a bounded tool-calling agent with curriculum retrieval (RAG) and tools drawn from connected MCP servers.
- Persists conversations and chat messages, including the tool trace and the syllabus citations behind each answer.
- **Lesson Planner:** drafts individual lesson plans and whole schemes of work from the school's curriculum library, and exports them as printable PDFs.
- **Digital Examiner:** writes test questions, assignments and exams against the Uganda syllabus (NCDC/UNEB) and International GCSE standards, fine-tuned by year, subject, topic and grade. Questions bank for reuse, get reviewed, assemble into papers, and publish into the school's real exam records.
- Maintains a curriculum library: bundled Uganda and Cambridge IGCSE topic outlines plus syllabus documents teachers upload, chunked and indexed for retrieval.
- Acts as an MCP client (drawing tools from external MCP servers an admin registers) and an MCP server (exposing its own tools to Claude Desktop, Claude Code and other MCP clients).
- Records audit log entries for administrative actions.
- Generates formal PDF report cards (with student photo and school branding), QR ID cards, fee receipts, fee statements, and a school-wide financial report.
- Full admin fee management: fee structures, bulk and per-student invoicing, payment capture with numbered receipts, ledgers, arrears ageing, bursaries, and a computed payment rating with admin overrides.
- Global, admin-set school branding (name, tagline, address, logo, theme colour) applied across every document and the app header, configured under Settings.
- Account approval: non-admin sign-ups wait for an administrator to approve them before they can sign in.
- Multi-tenant capable: serves many schools from one deployment, each with an isolated database selected by subdomain, with self-service pay-to-provision onboarding and subscription lifecycle.
- Generates formal PDF report cards for individual students.
- Runs locally with npm or inside Docker for development and production-style deployments.

## Main Technical Stack

- Frontend: React 18, TypeScript, Vite, and IBM Carbon (`@carbon/react`) with SCSS modules.

  The UI was Tailwind and shadcn/ui until the Carbon migration; those, along with Radix, are gone.
  Component styling now lives in co-located `*.module.scss` files built on `src/styles/_vars.scss`,
  which carries the same token names and roles OpenMRS uses — a grey page (`$ui-01`) holding white
  cards (`$ui-02`) with `1px solid $ui-03` borders. Typography is always
  `@include type.type-style(...)` in SCSS and **never** a `cds--type-*` class: Carbon v11 ships no
  such utilities, so those classes style nothing at all while looking as though they do.

  A small set of shared pieces in `src/components/common/` — `CardHeader`, `WidgetCard`,
  `EmptyState`, `ErrorState`, `PageHeader`, `StatTile`, `AccessDenied`, `Field`, `StudentPicker` —
  is what makes screens by different hands look like one product. Compose from those rather than
  from raw divs.

  Two things about the Carbon stylesheet are load-bearing and non-obvious. `styles/carbon.scss` uses
  the **blanket** `@use '@carbon/react'`: importing only the components in use saves ~36KB gzipped
  and was tried, but `scss/layout` is easy to miss and emits no components of its own — yet Carbon
  sizes every control with `clamp(max(var(--cds-layout-size-height-min), …))`, so without it buttons
  keep their colours and lose all geometry. A component's directory index also does not forward its
  sub-partials, so `components/data-table` gives the table but not `data-table/sort`. Both faults
  look like design mistakes rather than missing imports, and neither shows up in a type check, a
  lint run or a build. Second: Carbon's own `@font-face` rules point at webpack-style `~@ibm/plex/…`
  paths Vite cannot resolve, so `$css--font-face: false` is set and IBM Plex is loaded from Google
  Fonts in `index.css` instead — without that the whole type scale silently renders in a fallback
  font.

  `src/main.tsx` imports the stylesheets **before** `App`. Vite emits CSS in import order, so with
  `App` first every component module landed ahead of Carbon's and lost every override at equal
  specificity.
- Backend: Node.js HTTP server using native `http` APIs.
- Database: PostgreSQL through `pg`; tests can run against `pg-mem`.
- AI: multi-provider tool calling over raw `fetch` (no vendor SDK), a bounded agent loop, and hybrid retrieval (embeddings with a BM25 fallback).
- Interoperability: Model Context Protocol over JSON-RPC 2.0, in both directions.
- PDF generation: `pdf-lib`.
- Containerization: Dockerfile plus production and development Docker Compose files.

## Application Flow

1. The frontend starts from `src/main.tsx` and renders `src/App.tsx`.
2. App-level providers manage auth, chat, theme, and shared state.
3. Chat and management screens call local backend endpoints.
4. The backend initializes the database schema on startup and seeds students when the student table is empty.
5. Student search requests are handled by a rule-based service that reads student records and formats Markdown responses, or by a selected AI model.
6. In agent mode, the backend runs a bounded tool-calling loop: the model calls school tools (student search, gradebook aggregation, curriculum retrieval) plus any MCP tools the teacher enabled, and each step is recorded and returned for display.
7. Lesson-plan and question generation retrieve syllabus passages first, then have the model return structured output by calling a submit tool whose schema is the output contract.
8. Report-card, exam-paper and lesson-plan requests load the relevant records and return a generated PDF.

## Backend Functions and Endpoints

The local backend lives in `server/local-backend.mjs`.

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/health` | `GET` | Health check with student count. |
| `/api/db` | `POST` | Generic database operations for allowed tables. |
| `/api/functions/auth` | `POST` | Sign up, sign in, audit-log read/write, user listing, role change, account approve/reject, and account edit/delete (`update_account`, `delete_account` — admin-only and audited; the last approved administrator and the account you are signed in as cannot be deleted). The first account becomes an approved admin; later sign-ups are `pending` and cannot sign in until an admin approves them (rejection deletes the account). |
| `/api/functions/fee-status` | `POST` | Per-student school fees payment status only; the sole student-facing endpoint the `support_staff` role reads. An optional `code` (scanned ID card payload) narrows the response to one student. |
| `/api/functions/ai-chat` | `POST` | Creates chat messages and returns a student-search response. Requires `requesterRole` of `admin` or `teacher`. Accepts `mode` (`direct` or `agent`), `useRag`, and `mcpServerIds`; returns the tool trace and citations alongside the answer. |
| `/api/functions/ai-models` | `POST` | Lists selectable AI search models and provider configuration state. |
| `/api/functions/backup` | `POST` | Database backups, dispatched by an `action` field: `list`, `create`, `delete`, `save_schedule`. `PRIVILEGED_ROLES` only. `pg_dump` is injected rather than called directly, so the argv, the filename and the audit row are testable without a subprocess. |
| `/api/backups/<id>.dump` | `GET` | Downloads one completed backup. Gated exactly as the service is rather than trusting that whoever holds the id was allowed to ask, and the download itself is audited. |
| `/api/functions/data` | `POST` | Export and import, dispatched by an `action` field: `list_tables`, `export`, `check_import`, `import`. `PRIVILEGED_ROLES` only. An import refuses to run until `check_import` has passed and its token is handed back. |
| `/api/functions/integrations` | `POST` | The school's Moodle and at most one ERP, dispatched by an `action` field: `list`, `save`, `disable`, `test`. `PRIVILEGED_ROLES` only. `test` returns `connected: false` with the reason rather than a top-level error, because the reason is what the screen exists to show. |
| `/api/functions/lesson-planner` | `POST` | Lesson planning, dispatched by an `action` field: `list`, `get`, `generate`, `scheme_of_work`, `save`, `set_status`, `duplicate`, `delete`. Requires `requesterRole` of `admin` or `teacher`. |
| `/api/functions/digital-examiner` | `POST` | Question and paper authoring, dispatched by an `action` field: blueprint CRUD, `generate_questions`, question-bank CRUD and review, `assemble_paper`, `publish_paper`, and paper listing/deletion. Requires `requesterRole` of `admin` or `teacher`. |
| `/api/functions/curriculum` | `POST` | Curriculum library, dispatched by an `action` field: `list_documents`, `upload_document`, `delete_document`, `search`, `reindex`, `frameworks`. Teaching staff only; deleting a bundled outline is admin-only. |
| `/api/functions/chat-report` | `POST` | Emails a chat conversation as a PDF attachment (`action: "send"` with `recipient` and an optional `note`). Teaching staff only. Reports plainly when email is unconfigured rather than claiming a delivery. |
| `/api/chat-reports/:conversationId.pdf` | `GET` | A conversation as a branded PDF for download or print, carrying the citations and tool trace behind each answer. Teaching staff only. |
| `/api/functions/search` | `POST` | Global search across students, curriculum, lesson plans, exam questions, fees and attendance (`query`), plus `reindex` (admin) and `status`. Teaching staff only. Results are scoped to the requester's role server-side. |
| `/api/functions/mcp` | `POST` | External MCP server registry, dispatched by an `action` field: `list`, `save`, `delete`, `test`. Admin-only. Stored auth tokens are masked on every read and never returned to the browser. |
| `/api/mcp` | `POST` | SchoolBot's own MCP server, speaking JSON-RPC 2.0 (`initialize`, `tools/list`, `tools/call`). Gated on a `Bearer` token matching `MCP_SERVER_TOKEN`; disabled (404) when that variable is unset. |
| `/api/curriculum-frameworks` | `GET` | The examination frameworks the deployment supports, with year labels, question types, command words, assessment objectives and paper structures. |
| `/api/functions/voice-to-text` | `POST` | Placeholder voice transcription response. |
| `/api/functions/payments` | `POST` | Initiates MTN MoMo, Airtel Money, or bank payment requests; checks status; records callbacks. The `callback` action is a signed webhook (see Payment Webhooks). |
| `/api/functions/fees` | `POST` | Admin-only fee administration, dispatched by an `action` field: fee-structure CRUD, billing preview and run, payment capture, student ledger, arrears aging, bursary CRUD, and payment-standing overrides. Every action requires `requesterRole: "admin"`. |
| `/api/functions/settings` | `POST` | Global school branding. `action:"get"` returns the settings row (any signed-in role); `action:"update"` is admin-only. Read by every document generator and the app header. |
| `/api/meta` | `GET` | Product version, build number and developer contacts for the app footer. |
| `/api/provision` | `POST` | Self-service school onboarding, dispatched by an `action` field: `availability`, `signup`, `callback` (signed webhook), `status`, `list` (admin), `sweep` (admin/cron). Inert unless a control database is configured. See Multi-Tenancy and Self-Service Provisioning. |
| `/api/functions/student-summary` | `POST` | One student's whole record — biodata, class, parents, grades, attendance, fees, payments, discipline, and every movement from admission to transfer. `ALL_STAFF_ROLES`, but which sections come back is decided by the caller's session role, and a section a role may not see is never queried. |
| `/api/student-reports/:code.pdf` | `GET` | The same record as one printable PDF, resolved by student number or row id. Teaching staff only — the same gate as the report card. |
| `/api/report-cards/:studentId.pdf` | `GET` | Generates a PDF report card for a student. |
| `/api/id-cards/:studentId.pdf` | `GET` | Printable QR ID card for one student. `layout=a4` tiles ten per sheet instead of one CR80 card per page. |
| `/api/id-cards.pdf` | `GET` | Batch ID cards, filtered by any combination of `grade`, `section`, `registeredFrom` and `registeredTo` (against `enrollment_date`). No filter prints the whole school. |
| `/api/id-cards/:studentId.png` | `GET` | The bare QR image, for on-screen preview and scan testing. |
| `/api/fees/receipts/:paymentId.pdf` | `GET` | Printable receipt for one payment. Requires `requesterRole=admin` in the query string. |
| `/api/fees/statements/:studentId.pdf` | `GET` | Full fee statement with running balance, optionally bounded by `from` and `to`, plus a Gateway Transactions section listing every mobile-money and bank attempt including pending and failed ones. Requires `requesterRole` of `admin` or `teacher` — one student's history, unlike the school-wide report below. |
| `/api/fees/report.pdf` | `GET` | School-wide financial report (collections, payment-standing distribution, arrears ageing). Requires `requesterRole=admin`. |
| `/api/papers/:paperId.pdf` | `GET` | The question paper a learner sits. Requires `requesterRole` of `admin` or `teacher`. |
| `/api/papers/:paperId/marking-scheme.pdf` | `GET` | The marking scheme, with the expected answer, mark-by-mark award points, and the syllabus passages each question was generated from. Same role gate. |
| `/api/lesson-plans/:planId.pdf` | `GET` | A printable lesson plan. Requires `requesterRole` of `admin` or `teacher`. |
| `/api/chat-reports/:conversationId.pdf` | `GET` | A saved AI conversation as a branded, printable report, including the sources and tools behind each answer. Requires `requesterRole` of `admin` or `teacher` — the same gate as the chat, since the transcript holds whatever student data was discussed. |
| Static files | `GET` | Serves the built frontend from `dist` in production mode. |

## Functional Coverage

The requested school-management areas are represented as backend database resources available through `/api/db`.

| Area | Current Support |
| --- | --- |
| Student Information Management | `students` for profiles/lifecycle/medical/emergency data, plus `admissions` for applications and document metadata. |
| Academic & Curriculum Management | `classes`, `subjects_catalog`, `teachers`, `subject_allocations`, and `timetables`. |
| Attendance Tracking | `attendance_records` and `attendance_alerts`. |
| Examination & Gradebooks | `exams`, `exam_schedules`, `gradebook_entries`, and PDF report-card generation. Publishing a Digital Examiner paper writes real `exams` and `exam_schedules` rows, so generated assessments appear to the gradebook and timetable like any other exam. |
| Lesson Planning | `lesson_plans`. Individual lessons and term-long schemes of work, generated against the curriculum library and exported as PDFs. |
| Assessment Authoring | `exam_blueprints`, `exam_questions`, and `generated_papers`. Blueprints fix the mark spread; questions bank for reuse across terms; papers assemble, print with a marking scheme, and publish into `exams`. |
| Curriculum Library | `curriculum_documents` and `curriculum_chunks`. Bundled Uganda and IGCSE topic outlines plus teacher uploads, chunked and ranked for retrieval. |
| AI Interoperability | `mcp_servers`. External MCP servers an admin has connected, whose tools teachers can bring into a chat message. |
| Student Conduct & Lifecycle | `discipline_records`, `student_promotions`, and `student_transfers` for behavior, promotion/graduation, transfer, and withdrawal history. |
| Financial Management | `fee_structures`, `invoices`, `payments`, `receipts`, and `fee_bursaries`. Admin fee management covers fee-structure CRUD, bulk invoicing, payment capture with numbered receipts, per-student ledgers, arrears aging, and bursaries. |
| Payment Rating | `student_fee_standings`. A reliability score computed from payment history, which an admin may override with a manual standing. |
| Communication & Portal Access | `portal_accounts`, `notices`, and `internal_messages`. |
| Ancillary Services | `library_books`, `library_loans`, `transport_routes`, `transport_assignments`, `hostel_rooms`, `hostel_assignments`, `inventory_items`, and `inventory_transactions`. |
| Reporting & Analytics | `compliance_reports` and `analytics_snapshots`. |

## Database Tables

Schema creation is handled by `server/db/schema.mjs`.

| Table | Purpose |
| --- | --- |
| `students` | Student profiles, GPA, attendance, subjects, and notes. |
| `users` | Local auth users with password hashes and a role of `admin`, `head_teacher`, `accountant`, `bursar`, `teacher`, or `support_staff`. `designation` is a support-staff post (`askari`, `matron`, `cook`) deciding what a student ID scan reveals. `bursar` was a designation before it was a role; `schema.mjs` migrates those rows. |
| `school_backup_schedule` | One row: whether unattended backups are on, the wall-clock time and IANA zone to take them at, how many to keep, and when the last one ran. Its own table rather than columns on `school_settings`, because `updateSettings` replaces that row whole. |
| `school_backups` | The index of backups taken, so the list survives a container restart. A row is written before `pg_dump` runs and completed after, so an interrupted dump leaves `running` rather than a file that reads as usable. |
| `school_integrations` | Where the school's Moodle and ERP are, with tokens encrypted at rest under `SECRETS_KEY`. A table rather than columns on `school_settings`, because that row is read on every request that renders anything and is serialised into documents. |
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
| `discipline_records` | Student discipline incidents, severity, action taken, notification state, and resolution status. |
| `student_promotions` | Promotion, repetition, and graduation decisions with source/destination class details. |
| `student_transfers` | Transfer and withdrawal records with destination, reason, documents, and processing status. |
| `fee_structures` | Tuition and service fee tiers by grade, student type, year, and term. |
| `payments` | Tuition, transport, lab, or other payment records. |
| `invoices` | Student invoices with balances and line items. |
| `receipts` | Issued receipts linked to payments, numbered `RCT-<year>-<sequence>`. |
| `school_settings` | The school's global branding (name, tagline, address, logo, theme colour, contacts), plus `school_level` and `grading_country` — the two fields that decide the grading system. One row per database, edited under Settings and read by every document and the app header. |
| `fee_bursaries` | Scholarships, sponsorships, and discounts. A blank fee structure, academic year, or term is a wildcard that matches every invoice. |
| `student_fee_standings` | Admin overrides of the computed payment rating, kept as an event log. A partial unique index allows only one `active` row per student; superseded rows remain as history. |
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
| `curriculum_documents` | Syllabus documents in the curriculum library: bundled topic outlines (`source_type` `seed`), teacher uploads, or material pulled in over MCP. A content hash makes re-ingesting idempotent, so re-uploading a corrected document replaces its chunks rather than duplicating them. |
| `curriculum_chunks` | One retrievable passage each, with curriculum/subject/grade denormalised from the parent for filtering without a join. `embedding` holds a plain JSONB float array, not a pgvector column — see Retrieval below. |
| `lesson_plans` | Generated and hand-written lesson plans: outcomes, competencies, materials, the stage-by-stage sequence, assessment, differentiation and homework, plus the syllabus passages the draft came from (`refs`). |
| `exam_blueprints` | The Digital Examiner's fine-tuning object: curriculum, year, subject and grade, plus how marks spread across topics, difficulty, Bloom levels and question types. |
| `exam_questions` | The reusable question bank. Each row carries its stem, options, expected answer, mark-by-mark scheme, tags, review status, and `source_references` — the citations it was generated from. Questions outlive the blueprint and the paper they were written for. |
| `generated_papers` | Assembled papers. `exam_id` is NULL until published, at which point a real `exams` row is written and linked. |
| `mcp_servers` | External MCP servers an admin has registered. `auth_token` is stored plaintext but never returned to the browser; `discovered_tools` caches the last successful `tools/list`. |

Important indexes are added for student names, grade searches, conversation ordering, message lookups, audit-log ordering, curriculum retrieval filters (curriculum/subject/grade), question-bank lookups, and lesson-plan listings.

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

### Chat modes

Chat orchestration lives in `server/agent/chat.mjs`, which picks one of three modes:

| Mode | What runs |
| --- | --- |
| `local` | The rule-based engine. No network, no keys. |
| `direct` | One model call with the roster (and any retrieved passages) in the prompt. |
| `agent` | A bounded tool-calling loop with the school tool registry plus any MCP servers the teacher enabled for that message. |

The teacher picks per message in the composer: an **Agent** toggle, a **Curriculum** (RAG) toggle, and an **MCP** multi-select. A provider that cannot call tools — Ollama, or the rules engine — falls back to a direct call with the retrieved context and says so in the reply, rather than silently doing nothing.

Conversation history is replayed (the last `AI_HISTORY_TURNS` turns, default 8). The inlined roster is capped at `AI_ROSTER_INLINE_LIMIT` students (default 50); past that the prompt states it is showing a subset, so the model reports "not in the records I can see" rather than "no such student".

## Global Search (Meilisearch)

Optional, and additive. With `MEILISEARCH_HOST` unset — the default — search falls back to the SQL
student-name query the app already used and reports `engine: 'postgres'`, so no existing deployment
changes behaviour by upgrading.

`server/search/meili.mjs` is a small REST client over raw `fetch` with an injectable `httpClient`,
matching the LLM and MCP layers. No new dependency. `server/search/indexer.mjs` defines six indexes
and builds their documents from Postgres, which stays the system of record.

| Index | Searchable | Visible to |
| --- | --- | --- |
| `students` | name, student number, email, parent name, subjects, notes | admin, teacher |
| `curriculum` | title, heading, passage text | admin, teacher |
| `lesson_plans` | title, topic, outcomes, competencies | admin, teacher |
| `exam_questions` | stem, topic, subject, command word | admin, teacher |
| `fees` | student name, invoice/receipt number, reference | **admin only** |
| `attendance` | student name, reason, status | admin, teacher |

### The role filter is the security boundary

Copying student, fee and attendance data into a second store means the index has to enforce the same
access rules the database does, or search becomes a way around them. Three things hold that:

- **Every document carries a `roles` array**, and `services/search.mjs` injects
  `filter: roles = <requesterRole>` into every query. A caller cannot widen it — naming an index the
  role may not see strips it from the request rather than honouring it.
- **The role also decides which indexes are queried at all**, so a teacher's request never reaches
  the `fees` index. Both layers matter: the index list is the coarse gate, the filter the fine one.
- **The browser never talks to Meilisearch.** The usual pattern is a public search key queried
  straight from the client, which is faster — but it cannot enforce per-role filtering, and with fees
  indexed that would expose the ledger. No key or host is exposed to the client.

Support staff appear in no `roles` array anywhere: their access is fee *status* through
`/api/functions/fee-status`, and search would be a way past it.

### Keeping the index current

`handleDbQuery` fires a sync after every insert, update and delete on an indexed table, and deletes
are mirrored so a removed student leaves the index. The sync is **deliberately not awaited and never
throws** — a search index falling behind must not fail or delay the payment or attendance mark that
triggered it. A full `reindex` from Settings is the backstop and rebuilds every index from Postgres.

## LibreChat

**LibreChat consumes AI providers; it does not expose one.** There is no endpoint for another
application to call, so it cannot be an entry in the model catalogue beside OpenAI and Anthropic.

What it does support is **MCP servers over streamable HTTP with bearer auth**, which is exactly what
this app already serves at `POST /api/mcp`. The integration therefore runs inward: LibreChat
connects to SchoolBot, and its users get student records, fees, curriculum and the gradebook as
tools. Settings → **Search & LibreChat** generates the `librechat.yaml` block; `librechat.yaml` in
the repo root is a working starting point, used by the optional compose profile.

`MCP_SERVER_TOKENS` maps a token to a role (`{"tok-admin":"admin","tok-teacher":"teacher"}`), so the
tools a LibreChat user sees match who they are. `buildToolRegistry()` already filters by role, so
this is a lookup rather than a second gate. `MCP_SERVER_TOKEN` + `MCP_SERVER_ROLE` remain supported.

Both services ship as opt-in compose profiles, so `docker compose up` is unchanged for anyone not
using them:

```bash
docker compose --profile search up -d      # Meilisearch only
docker compose --profile librechat up -d   # LibreChat, its MongoDB, and Meilisearch
```

## AI Agent, Retrieval, and MCP

### Tool registry and the agent loop

`server/agent/tools.mjs` defines the school tools as provider-neutral `{name, description, input_schema, roles, handler}` records — the same `{action → handler}` shape the fees and settings services already use, with a JSON schema attached:

`search_students`, `get_student_profile`, `class_performance`, `search_curriculum`, `list_curriculum_frameworks`, `describe_curriculum_year`, `get_timetable`.

**Roles are enforced in the registry, not in the prompt.** `buildToolRegistry()` filters by the caller's role before the definitions are serialised, so a model working for a teacher is never told an out-of-scope tool exists and cannot be talked into calling one. Non-teaching staff get an empty registry.

`server/agent/loop.mjs` runs the loop, bounded by `AI_AGENT_MAX_STEPS` (default 6). Parallel tool calls execute concurrently and all results return in one message. A failing tool becomes a readable error result the model can recover from rather than aborting the turn. Every step is recorded — tool, input, output, duration — and persisted on the assistant message, so reopening a past conversation still shows what the assistant did.

### Provider adapters

`server/agent/providers.mjs` translates the loop's normalised message shape into each provider's wire format and back:

| Family | Mechanism |
| --- | --- |
| Anthropic | `tools` with `input_schema`; `tool_use` blocks answered with `tool_result`. The assistant's raw content blocks are replayed verbatim, which is what keeps thinking blocks intact across a tool loop. |
| OpenAI-compatible (`openai`, `groq`, `mistral`, `openrouter`) | `tools` of type `function`; `tool_calls` answered with `role: "tool"` messages. |
| Google | `functionDeclarations`; `functionCall` answered with `functionResponse` parts. Annotation keywords Gemini rejects are stripped from the schema. |
| Ollama | `tools` of type `function` on `/api/chat`; results returned as `{role:'tool', tool_name, content}`. Ollama matches a result to its call by **name** — it has no `tool_call_id`, so omitting `tool_name` leaves parallel results ambiguous. A call the model writes into its message text as fenced JSON is recovered, which is how small local models usually emit one. |
| `local_rules` | Not a model, so no tools. Retrieval is folded into the prompt instead. |

Claude 4.6 and later removed the sampling parameters, so `temperature` is omitted for that family via a targeted deny-list; older pinned Claude models still receive it.

### Retrieval (RAG)

`server/rag/` holds chunking, embeddings, lexical ranking and the retriever.

Ranking is hybrid and deliberately filtered first: curriculum, subject and grade narrow the candidate set in SQL, and only then does scoring run in Node. Where embeddings exist, cosine similarity and BM25 are fused by reciprocal rank; where they do not, BM25 alone answers.

**Embeddings are stored as JSONB float arrays, not pgvector.** `pg-mem` backs both the test suite and the Vercel demo and supports no extensions, and one school's corpus is small enough to rank in Node. Embedding providers are OpenAI, Google, Mistral and Ollama, selected by `EMBEDDING_MODEL_ID` or by whichever has credentials. Anthropic is absent because the Messages API has no embeddings endpoint.

Retrieval works with **no embedding provider configured at all** — that is the normal case, and BM25 handles the exact topic names teachers actually search for well. Seeding deliberately does not embed: doing so would cost an API call per chunk on every fresh database, including each newly provisioned tenant. The `reindex` action backfills vectors later, a batch at a time, if a school configures a provider.

Citations are numbered once and that numbering is what the model is shown, what gets persisted, and what the UI renders — so `[2]` in an answer always resolves to the source the reader sees.

### Model Context Protocol

Both directions are supported.

**As a client** (`server/agent/mcp-client.mjs`): a minimal Streamable HTTP client speaking `initialize` → `tools/list` → `tools/call`. Discovered tools are namespaced `mcp__<server>__<tool>` so they cannot shadow a built-in, and merge into the same registry. One unreachable server does not take down the others or fail the chat — its failure is reported alongside the answer.

**As a server** (`server/mcp/server.mjs`, route `POST /api/mcp`): exposes the same tool registry to external MCP clients. Because the registry is shared, a tool added for the chat is automatically available here. Auth is a bearer token; **an unset `MCP_SERVER_TOKEN` means disabled, not open**, since these tools read student records.

## Lesson Planner

`server/services/lesson-planner.mjs`, reached through `POST /api/functions/lesson-planner`.

Generation retrieves syllabus passages for the topic first, then runs the agent loop with a `submit_lesson_plan` tool whose schema *is* the plan. That is the provider-neutral way to get structured JSON: every provider family supports tool schemas, whereas each has a different (or absent) native JSON mode.

A generated plan saves as `draft` with every field editable — it is a first draft a teacher adapts, not something to accept or discard whole — and records the passages it came from in `refs`.

`scheme_of_work` plans a term by running one generation per topic rather than asking for the whole term at once, which would overrun output limits and degrade every plan in it. A topic that fails is reported on its own; the rest still produce plans.

PDFs come from `server/reports/lesson-plan.mjs`.

## Digital Examiner

`server/services/digital-examiner.mjs`, reached through `POST /api/functions/digital-examiner`.

A **blueprint** is the fine-tuning object: curriculum, academic year, subject, grade and assessment type, plus `topic_weights`, `difficulty_mix`, `bloom_mix` and `question_type_mix`. Anything the teacher leaves unset is filled from the curriculum framework, so a blueprint with only a subject and a grade is still an examiner-shaped paper.

`generate_questions` retrieves first, then runs the agent loop with a `submit_questions` tool whose schema is the question array. With `targetWeakTopics`, it aggregates `gradebook_entries` for the cohort and weights the paper towards the topics they scored lowest on. Every generated question carries `source_references`.

### Reading what the model produced

`server/services/question-parse.mjs` is the single reader, used both by the recovery path and by the editor's save, so the two cannot drift.

The rule is **recognise a question by its shape, not by its wrapper**. Models nest the payload differently on every run — a bare array, `{questions: […]}`, `{name: …, arguments: {…}}` labelled with the *topic* rather than the tool name, or several objects back to back in one fenced block. `extractQuestions` walks any parsed value and collects everything question-shaped: a stem under any of its usual names (`stem`, `question`, `text`, `prompt`, `description`), or two other marks of a question — a mark scheme beside options, a difficulty beside a command word. Scalars on a wrapper are carried down onto what it wraps, because a model that puts the fields under `arguments` often leaves the question text beside it in `description`. Marks default to the mark scheme's total; the stem falls back to the scheme's first point.

`jsonValuesIn` scans for *balanced* JSON values rather than taking the span from the first brace to the last, which is what allows several concatenated objects to be read, and lets a reply truncated mid-object keep everything complete that came before the cut. Trailing commas get one repair attempt. Only when no JSON parses does the numbered-prose reader run.

`questionsToMarkdown` / `markdownToQuestions` are the round trip behind the editor. Each question ends with an HTML comment carrying the fields prose has no place for — `id`, topic, type, difficulty, Bloom level, objective. **The `id` is what makes Save an update rather than a duplicate**; delete the comment and that question is banked as new, which is a reasonable way to fork one. The round trip being lossless is a tested property.

`save_questions` takes the whole edited document in one call — `markdown` or a `questions` array, both read through the same parser — and returns `{ questions, markdown, saved, created, updated }`. The returned Markdown is the saved rows re-rendered, so the editor adopts the new ids and a second save updates the same rows. A row whose id no longer exists is inserted rather than dropped: a save must not lose the teacher's work. The editor itself is `src/components/chat/examiner/QuestionEditor.tsx` — a plain `textarea` driven through `selectionStart`/`selectionEnd`, with its own undo history because programmatic edits clear the browser's, and a preview that escapes HTML and strips the meta comments before rendering.

Questions save as `draft`. **A paper refuses to publish while any of its questions is unreviewed**, and a retired question cannot reach a paper at all. Paper totals are summed from the questions themselves rather than trusted from the client, so the printed total always matches what is on the page.

`publish_paper` writes a real `exams` row (and an `exam_schedules` row when a date and class are supplied) inside a transaction, and audits the action. Publishing twice is refused.

`server/reports/exam-paper.mjs` produces two documents from the same data — the question paper and the marking scheme — so they cannot drift apart. The question paper leaves writing space proportional to the marks; the marking scheme carries the expected answer, the mark-by-mark award points, the question's tags, and the syllabus source, which is what makes a generated paper auditable rather than taken on trust.

## Curriculum Frameworks

`server/services/curriculum-frameworks.mjs` holds the *structure* of an examination system — never syllabus prose, which lives in the RAG corpus.

Shipped frameworks: `uganda-cbc-lower-secondary` (S1–S4, UCE), `uganda-uace` (S5–S6), `uganda-primary` (P1–P7, PLE), `cambridge-igcse`, and `edexcel-international-gcse`. Each declares its year labels, `startGrade`, permitted question types, examiner command words, assessment objectives, paper structures and mark conventions.

`startGrade` is declared per framework rather than inferred: a UK "Year 10" *is* grade 10, while Uganda's S1 begins at grade 8, so the same stored `grade_level` reads differently under each. `SCHOOL_CURRICULUM_FRAMEWORKS` adds or overrides frameworks as JSON, matching the pattern `SCHOOL_GRADING_SCHEMES` already uses.

## School Level and Grading

An administrator sets the school's level once under Settings, and the grading system follows from
it — nobody picks a scale per report card. `school_settings.school_level` stores the choice and
`school_settings.grading_country` stores which national examination system it maps onto.

| School level | Uganda (UNEB) | International |
| --- | --- | --- |
| Pre-school | Development descriptors, no marks | Development descriptors |
| Kindergarten / Nursery | Development descriptors | Development descriptors |
| Primary | PLE: subject points 1–9, aggregate over 4 subjects, Divisions 1–4 / U | Letter grades |
| Secondary, S1–S4 | **UCE aggregate points**: D1–F9 worth 1–9, aggregate over the best 8 subjects, Divisions 1–4 / 9 | Letter grades |
| Secondary, S5–S6 | **UACE principal grades**: letters A–F worth 6–0, principal points over 3 subjects (max 18) | Letter grades |
| Technical / Vocational | Distinction / Credit / Pass (UBTEB) | Distinction / Merit / Pass |
| Tertiary / University | **GPA** on the 5.0 scale, with degree classification | **GPA** on the 4.0 scale |

**One school level can resolve to two scales.** A secondary school runs both O-Level and A-Level, so
`academicLevelFor(schoolLevel, gradeLevel)` uses the student's own grade to choose: S1–S4 sit at
grade levels 8–11 and S5–S6 at 12–13, matching the P1–P7 = grades 1–7 convention the rest of the app
assumes. Everything else maps on the level alone.

Bands follow UNEB practice as documented at
<https://www.scholaro.com/db/countries/Uganda/Grading-System>. UNEB awards on subject points and
division bands rather than flat percentage cut-offs, so the percentage thresholds in
`server/reports/grading-config.mjs` are indicative — the points, divisions and letters are the parts
that matter, and `SCHOOL_GRADING_SCHEMES` overrides the whole table.

### Aggregates

`gradeScore(score, scheme)` returns `{grade, remark}`, plus `points` on scales that award them.
`summariseResults(results, scheme)` rolls the subject results into the one headline figure the
system calls for, and returns `null` where there is no such concept (the early years), so the report
card omits the row rather than printing a meaningless zero.

Three aggregate kinds are supported:

- `points-total` / `lower-better` — PLE and UCE. Sums the best N subjects and maps the total onto a
  division band.
- `points-total` / `higher-better` — UACE. Sums principal points and reports them out of the maximum.
- `gpa` — mean of the per-subject grade points, with an optional classification band.

**A partial aggregate is never given a division.** An aggregate of 8 across five subjects is not a
Division 1, so when fewer than the required subjects are recorded the summary reports
`complete: false`, the band is withheld, and the report card prints "Provisional — N subject(s)
recorded" instead.

Resolution never returns null: `resolveGradingScheme` falls back through related levels
(`secondary-o` → `secondary`, `tertiary` → `university`, and so on), then the default country, so a
misconfigured school still produces a report card. An explicit `academicLevel` on a request still
overrides the school setting, which is what lets a one-off report card be graded on something else.

## AI Chat Reports

`server/reports/chat-report.mjs`, exposed at `GET /api/chat-reports/:conversationId.pdf`.

Built server-side from the persisted messages rather than from what the browser has on screen, so
the report carries `metadata.citations` and `metadata.steps` — the sources and tools behind each
answer — which is what makes a printed answer checkable rather than something to take on trust.

The assistant replies in Markdown, so the builder renders headings, bullet lists and pipe tables
properly instead of printing the raw syntax; a table of student GPAs as pipes and dashes would
defeat the purpose. Table columns are sized to their widest cell and truncated rather than wrapped,
because these are scan-and-compare tables and ragged row heights read worse.

## Report Cards

Report cards are generated by `server/reports/report-card.mjs` and exposed through `GET /api/report-cards/:studentId.pdf`.

Each PDF includes the school identity (name, tagline, address, logo and theme colour from the global settings), term information, student details, GPA, attendance, subject rows, teacher comments, and notes. The student's stored photo is shown in the header. Grades come from the scheme the school's level resolves to (see School Level and Grading above), including Uganda's competency-based `uganda-cbc` scale. Where the scheme awards points, a `Pts` column appears beside each subject and the aggregate, principal points or GPA is printed under the table with its division or classification; on scales without points the layout is unchanged. The generator accepts a `POST` body (so uploaded images and a per-card theme override can be sent); values not supplied fall back to the global settings and the student's record.

## Student ID Cards

ID cards are generated by `server/reports/id-card.mjs` using the open-source `qrcode` package (MIT) for the
symbol and `pdf-lib` for the card, so no external QR service is involved and generation works offline.

Each card carries the school name, logo and theme colour (from the global settings), the student's photo,
name, student number, class, and a QR code at error correction level Q with a two-module quiet zone, drawn
about 30mm square — comfortably within phone camera range.

By default the QR encodes the bare student number, which keeps the symbol coarse and leaks nothing if a
card is lost. Set `ID_CARD_QR_BASE_URL` to encode `<base>/<student number>` instead, so a phone's built-in
camera app offers to open a link rather than showing plain text. `parseStudentCode` in
`server/local-backend.mjs` accepts a bare number, a URL, or a JSON payload, so the in-app scanner keeps
working whichever form the cards carry.

A batch is selected by any combination of `grade`, `section`, `registeredFrom` and `registeredTo` on
`GET /api/id-cards.pdf`, built up one criterion at a time so an unfiltered request still prints the
whole school. Ten cards tile onto each A4 sheet and pagination is automatic, so an arbitrary
selection needs nothing from the renderer.

The registration date is `students.enrollment_date` — there is no `created_at` on that table. It is a
`DATE`, so a plain `YYYY-MM-DD` comparison is exact and avoids the timezone drift a timestamp would
bring. It is also **nullable**: a student with no enrolment date on file matches no range at all. The
print dialog counts those students and says so, rather than letting them quietly miss out on a card.

## Docker Operations

Use the root helper script:

```bash
./containers.sh
```

The script opens an interactive menu where you choose the environment and then select numbered actions for build, start, stop, restart, delete, status, and logs.
It also includes an endpoints option that shows where to find the frontend, backend API, backend health check, and database connection after containers are running — and, when a reverse proxy is selected, the HTTPS addresses schools actually use.
Options 10–14 cover the reverse proxy and its TLS certificate. Option 17 chooses the database.

### The database: bundled or external

The bundled PostgreSQL container sits behind a Compose profile (`bundled-db`), so a school running
its own database simply does not start one. `DB_MODE=external`, or option 17, drops the profile and
leaves `DATABASE_URL` pointing wherever you say — a managed Postgres, one on the host
(`host.docker.internal`), or one on another machine.

Nothing in `server/` needed changing for this: `connection.mjs` has always read `DATABASE_URL` and
honoured the two SSL variables. Three things in Compose blocked it, and all three are fixed:

- `DATABASE_SSL` was **hardcoded to `"false"`** in the app service, silently overriding whatever was
  in `.env`. Since managed Postgres almost always requires TLS, an external database was
  unreachable whatever `DATABASE_URL` said. It is now `${DATABASE_SSL:-false}`, and
  `DATABASE_SSL_REJECT_UNAUTHORIZED` is passed through at all.
- the `db` service had no profile, so it always started;
- `depends_on` waited on it unconditionally, so the app would not start without it. It now carries
  `required: false`, which Compose honours when the bundled database is running and ignores when it
  is not.

`containers.sh` checks the connection with `pg_isready` before starting anything, so a wrong address
or password fails with a message rather than an app container restarting forever.

You can also run commands directly:

```bash
./containers.sh build
./containers.sh start
./containers.sh stop
./containers.sh delete
./containers.sh endpoints
./containers.sh cert-status
```

By default the script targets the production stack in `docker-compose.yml`. Pass `dev` as the second argument to use `docker-compose.dev.yml`:

```bash
./containers.sh start dev
./containers.sh logs dev
./containers.sh delete dev
```

Production defaults:

- App: `http://127.0.0.1:8787` — **loopback only**, because a reverse proxy is meant to be the way
  in. Set `APP_BIND=0.0.0.0` to publish it directly.
- Database: internal `db` service

Development defaults:

- Frontend: `http://127.0.0.1:8080`
- Backend API: `http://127.0.0.1:8787`
- PostgreSQL: `127.0.0.1:5432`

### Which Compose the script uses

`containers.sh` detects it on first use: `docker compose` (the v2 CLI plugin) if present, otherwise
the `docker-compose` standalone, and a clear install message if neither is. Both take the same flags
for everything the script does. This matters because a missing plugin fails obscurely — the Docker
CLI stops recognising `compose` as a command and reads the next argument as one of its own, which is
where `unknown shorthand flag: 'p' in -p` comes from.

### The reverse proxy

nginx and Caddy are each a compose profile, selected by `PROXY` (or menu option 10, or a third
argument). The script sets `COMPOSE_PROFILES` rather than passing `--profile`, because the v1
standalone reads the variable but does not accept the flag.

```bash
PROXY=nginx ./containers.sh start        # TLS with a certificate you issue
PROXY=caddy ./containers.sh start        # TLS with a certificate Caddy issues and renews itself
./containers.sh start prod nginx         # the same, for a deploy script or a cron line
```

Selecting a proxy in development is refused and reset to `none`: `docker-compose.dev.yml` has no
proxy services, and Vite serves the frontend directly.

### Certificates

Every school is a subdomain, so the certificate must be a **wildcard** — and a wildcard cannot be
issued over the HTTP-01 challenge, because there is no single host for the ACME server to fetch a
file from. It has to be **DNS-01**, which means certbot needs an API token for the domain's DNS.

```bash
./containers.sh cert-status              # what is installed, when it expires, what it covers
PROXY=nginx ./containers.sh cert-issue   # certbot certonly --dns-<plugin>, then install + reload
PROXY=nginx ./containers.sh cert-renew   # certbot renew, then install + reload — safe on a cron
PROXY=nginx ./containers.sh proxy-reload # nginx -t, then reload only if it passes
```

`cert-install` copies with `cp -L`, because certbot's `live/` entries are symlinks into `archive/`
and the container mounts only `deploy/nginx/certs` — a copied symlink would dangle inside it. The
plugin and credentials path default to Cloudflare and are overridable with `CERTBOT_DNS_PLUGIN` and
`CERTBOT_DNS_CREDENTIALS`; the domain comes from `TENANT_ROOT_DOMAIN`, read from `.env.production`,
then `.env`, then the environment.

Under the Caddy profile these commands do nothing except explain that Caddy manages its own
certificate, given `ACME_EMAIL` and a DNS API token.

## Environment Variables

| Variable | Purpose |
| --- | --- |
| `SESSION_SECRET` | **Set this in production.** Signs every session cookie. Unset, a key is generated at startup: everyone is signed out on each restart and sessions break across replicas. `openssl rand -hex 32`. |
| `SESSION_TTL_HOURS` | Session lifetime. Default `12`, re-issued past the halfway mark so an active user is never signed out mid-task. |
| `PLATFORM_OWNER_TOKEN` | **Set this to host more than one school.** The operator's credential for `/owner` and the platform actions on `/api/provision`, sent as `Authorization: Bearer …`. Fails closed when unset, and refuses a token under 24 characters. |
| `TENANT_ROOT_DOMAIN` | The root domain (`eschool.ink`). Decides which origins may call the API cross-origin, and builds a school's link in its activation email. |
| `CORS_EXTRA_ORIGINS` | Comma-separated origins allowed cross-origin beyond `https://*.<root>`. For a separately hosted frontend. |
| `ALLOW_TENANT_HEADER` | Local testing only. `true` lets an `X-Tenant` header override the `Host` and choose the school. Never set it in production. |
| `HSTS_MAX_AGE` | `Strict-Transport-Security` max-age, sent only over HTTPS. Default 180 days. |
| `DATABASE_URL` | PostgreSQL connection string. |
| `DATABASE_SSL` | Enables PostgreSQL SSL when set to `true`. |
| `DATABASE_SSL_REJECT_UNAUTHORIZED` | Controls SSL certificate verification. Set `false` only for a self-signed certificate on a trusted network. |
| `DB_MODE` | `bundled` (default) starts the Postgres container in the compose file; `external` does not, and uses `DATABASE_URL` alone. |
| `BACKUP_DIR` | Where database dumps are written inside the container. Defaults to `/var/backups/eschool`, a named volume. |
| `DATABASE_POOL_SIZE` | PostgreSQL pool size. |
| `LOCAL_BACKEND_HOST` | Backend bind host. |
| `LOCAL_BACKEND_PORT` | Backend port. |
| `LOCAL_STATIC_ROOT` | Static frontend directory for production serving. |
| `SCHOOL_NAME` | Report-card and school branding name. |
| `FEE_INVOICE_PREFIX` | Invoice number prefix. Defaults to `INV`, producing `INV-2026-000001`. |
| `FEE_RECEIPT_PREFIX` | Receipt number prefix. Defaults to `RCT`, producing `RCT-2026-000001`. |
| `SCHOOL_ADDRESS` | Seed value for the school address in `school_settings` on first boot. |
| `BUILD_NUMBER` | Build number stamped on the app footer and PDF footers. Falls back to the git short hash. |
| `DEVELOPER_CONTACTS` | Developer contact string shown in the app footer. |
| `TENANTS` | Optional. JSON array `[{"id","url"}]` enabling static multi-tenant routing: the request subdomain selects a school's isolated database. Unset = single tenant. |
| `CONTROL_DATABASE_URL` | Control-plane database holding the tenant registry + subscription payments. Enables self-service provisioning. Unset = single tenant / static `TENANTS`. |
| `PROVISION_ADMIN_DATABASE_URL` | A Postgres role **with CREATEDB**, used only to run `CREATE DATABASE` for each new school. |
| `TENANT_DB_URL_TEMPLATE` | Template for a tenant's app connection URL; `{db}` is replaced with the generated database name (e.g. `postgres://schoolapp:pass@db:5432/{db}`). |
| `TENANT_DB_PREFIX` | Prefix for generated tenant database names. Default `school_`. |
| `SUBSCRIPTION_AMOUNT` | Subscription price. Sign-up is refused until this is set (> 0). |
| `SUBSCRIPTION_CURRENCY` | Subscription currency. Default `UGX`. |
| `SUBSCRIPTION_PERIOD_DAYS` | Length of a paid period. Default `120` (a term). |
| `SUBSCRIPTION_GRACE_DAYS` | Grace window after a period lapses before a school is suspended. Default `14`. |
| `TENANT_ROOT_DOMAIN` | Root domain used to build a school's link in the activation email. Default `eschool.ink`. |
| `VITE_TENANT_ROOT_DOMAIN` | Frontend build-time root domain for the public sign-up page. |
| `PAYMENT_WEBHOOK_SECRET` | If set, payment/subscription `callback` requests must carry `x-webhook-signature` = HMAC-SHA256(rawBody). Unset disables verification (mock/dev). |
| `EMAIL_MODE` | `mock` (default, no send) or `http` for the activation email. |
| `EMAIL_API_URL` | Email provider endpoint (Resend-compatible JSON API). Default `https://api.resend.com/emails`. |
| `EMAIL_API_KEY` | Bearer key for the email provider. |
| `EMAIL_FROM` | From address for the activation email. |
| `SCHOOL_GRADING_COUNTRY` / `SCHOOL_ACADEMIC_LEVEL` / `SCHOOL_GRADING_SCHEMES` | Fallback grading scheme, and optional JSON to add/override grading schemes (e.g. Uganda competency-based `uganda-cbc`). The stored `school_settings.school_level` and `grading_country` take precedence over these. |
| `SCHOOL_LEVEL` | Fallback school level for a database whose settings row predates the column. |
| `ID_CARD_QR_BASE_URL` | If set, ID-card QR encodes `<base>/<student number>` (a scannable URL) instead of the bare number. |
| `SCHOOL_TAGLINE` | Report-card and school branding tagline. |
| `APP_PORT` | Host port for the production Docker app. |
| `DEV_APP_PORT` | Host port for the development frontend. |
| `DEV_API_PORT` | Host port for the development API. |
| `DEV_DB_PORT` | Host port for the development database. |
| `AI_DEFAULT_MODEL_ID` | Default model selected by the backend, default `local-rules`. |
| `AI_MODEL_CATALOG` | Optional JSON array that **replaces** the built-in model catalogue. Prefer `AI_EXTRA_MODELS` — setting this drops Local Rules and any provider you do not restate. |
| `AI_EXTRA_MODELS` | Optional JSON array **added to** the built-in catalogue. An entry whose `id` matches a built-in replaces just that one. This is how you offer a local Ollama model and an Ollama cloud model side by side. |
| `AI_TEMPERATURE` | LLM sampling temperature, default `0.2`. Ignored for Claude 4.6 and later, which reject sampling parameters. |
| `AI_MAX_TOKENS` | Maximum response tokens for ordinary chat replies, default `900`. |
| `AI_AGENT_MAX_TOKENS` | Maximum response tokens for the agent loop and the two generators, default `16000`. A full exam paper does not fit in the chat default. |
| `AI_AGENT_MAX_STEPS` | Tool steps the agent may take before it stops and returns what it has, default `6`. |
| `AI_HISTORY_TURNS` | Prior conversation turns replayed into a chat request, default `8`. |
| `AI_ROSTER_INLINE_LIMIT` | Students inlined into the chat prompt before it switches to a stated subset, default `50`. |
| `AI_TOOL_RESULT_MAX_CHARS` | Truncation ceiling for a single tool result fed back to the model, default `12000`. |
| `EMBEDDING_MODEL_ID` | Embedding provider to use — `openai`, `google`, `mistral` or `ollama`. Unset picks the first with credentials; none configured means retrieval stays keyword-only, which is fully supported. |
| `OPENAI_EMBEDDING_MODEL` | OpenAI embedding model, default `text-embedding-3-small`. |
| `GOOGLE_EMBEDDING_MODEL` | Google embedding model, default `text-embedding-004`. |
| `MISTRAL_EMBEDDING_MODEL` | Mistral embedding model, default `mistral-embed`. |
| `OLLAMA_EMBEDDING_MODEL` | Ollama embedding model, default `nomic-embed-text`. |
| `EMBEDDING_BATCH_SIZE` | Texts per embedding request, default `64`. |
| `RAG_CHUNK_TOKENS` / `RAG_CHUNK_OVERLAP_TOKENS` | Target chunk size and overlap when indexing a document, defaults `800` and `100`. |
| `RAG_RETRIEVE_LIMIT` | Passages returned per retrieval, default `8`. |
| `RAG_CANDIDATE_LIMIT` | Ceiling on rows pulled into Node for scoring, default `600`. |
| `RAG_MAX_DOCUMENT_CHARS` | Largest single upload that will be indexed, default `2000000`. |
| `SCHOOL_CURRICULUM` | Default curriculum framework id when a request does not name one. |
| `SCHOOL_CURRICULUM_FRAMEWORKS` | Optional JSON to add or override examination frameworks, mirroring `SCHOOL_GRADING_SCHEMES`. |
| `EXAMINER_MAX_QUESTIONS` | Questions one generation request may produce, default `40`. |
| `PLANNER_MAX_SCHEME_LESSONS` | Lessons one scheme-of-work request may produce, default `20`. |
| `MCP_SERVER_TOKEN` | Bearer token for SchoolBot's own MCP server. **Unset disables the server rather than opening it.** |
| `MCP_SERVER_ROLE` | Role the single `MCP_SERVER_TOKEN` acts as, default `teacher`. |
| `MCP_SERVER_TOKENS` | JSON map of token to role, e.g. `{"tok-admin":"admin","tok-teacher":"teacher"}`, so different clients get different tool surfaces. Takes precedence alongside the single-token form. |
| `MEILISEARCH_HOST` | Meilisearch base URL. **Unset means global search falls back to the basic student query** — the feature is additive. |
| `MEILISEARCH_API_KEY` | Meilisearch master or admin key. |
| `MEILISEARCH_TIMEOUT_MS` | Per-request timeout, default `10000`. |
| `MEILISEARCH_BATCH` | Documents per indexing batch, default `500`. |
| `SEARCH_HIT_LIMIT` | Results returned per category, default `5`. |
| `MCP_TIMEOUT_MS` | Timeout for a call to an external MCP server, default `20000`. |
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
| `OLLAMA_MODEL` | Ollama model name for the built-in entry, default `qwen3.5:2b`. Ollama serves local and cloud models through the same endpoint — a `-cloud` suffixed model runs on Ollama Cloud after `ollama signin`, so both kinds can be listed together via `AI_EXTRA_MODELS`. |
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

## Fee Credit

A family that pays before it is billed used to be billed again in full. `recordPayment` spreads a payment across *open* invoices; with none open the remainder sat in `payments` doing nothing, and the next invoice went out for its whole amount as though the money had never arrived.

Credit is derived, never stored:

```
credit = (everything paid) - (everything an invoice absorbed)
```

where the second term is `total_amount - balance_due` summed over the student's invoices (`unallocatedCredit` in `server/services/fees.mjs`). Nothing to keep in sync, nothing that can disagree with the ledger, and it stays correct if an invoice is later adjusted. It is summed in JavaScript rather than with `SUM` over an expression — a student has a handful of invoices, and pg-mem is unreliable with aggregates over arithmetic, exactly the kind of difference that passes in tests and fails against real Postgres.

`applyCreditToInvoice` runs **inside the transaction that creates the invoice**, on both the single-student and bulk billing paths, so a family that paid first is never billed for money the school is already holding — not even for the instant between the two writes. The credit applied is reported on the response and recorded in the audit entry, so a bursar can see why a bill is not the full amount.

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

When a callback marks a transaction as `successful`, the backend creates a `payments` row and reduces the linked invoice balance. Invoices become `partial` or `paid` based on the remaining balance. The gateway payment insert, invoice update, and receipt issue run inside one transaction (`server/db/connection.mjs` `withTransaction`).

## Payment Webhooks

Payment/subscription `callback` requests tell the server "this payment succeeded", so they are authenticated. When `PAYMENT_WEBHOOK_SECRET` is set, the callbacks to `/api/functions/payments` and `/api/provision` must carry a header `x-webhook-signature` equal to `HMAC-SHA256(rawRequestBody, secret)` (a bare hex digest or `sha256=<hex>`). A missing or invalid signature returns `401` before anything is trusted. When the secret is unset (mock/dev), verification is disabled and behaviour is unchanged. Verification lives in `server/security/webhooks.mjs`.

## Multi-Tenancy and Self-Service Provisioning

The system can serve many schools from one deployment, each with an **isolated database**, selected by **subdomain**. It is fully non-breaking: with no `TENANTS` and no `CONTROL_DATABASE_URL`, the app is single-tenant exactly as before.

### Request routing

`server/db/tenants.mjs` resolves each request to a tenant:

1. `resolveTenantId(host, xTenant)` extracts the first subdomain label of the `Host` header (`kampala-high.eschool.ink` → `kampala-high`). Apex, `www`, `localhost` and IPs map to the `default` tenant. An `X-Tenant` header can override it, but **only when `ALLOW_TENANT_HEADER=true`** — it is a local-testing convenience, and honouring it in production would let any page on the internet name whichever school it liked. The `Host` header is set by the browser from the address bar and cannot be forged cross-origin, which is why it is the one that decides.
2. The registry returns that tenant's database URL and subscription `status` — from the static `TENANTS` env, or dynamically from the control database. Each tenant's connection pool is created and cached lazily on first use, and its schema self-builds via `initializeDatabase`.
3. The HTTP layer (`server/local-backend.mjs`) passes the resolved database into `dispatch`. An unknown subdomain returns `404`; a **suspended** school (lapsed subscription) returns `402` with a renewal notice.

### Control plane

When `CONTROL_DATABASE_URL` is set, a separate control database (`server/db/control.mjs`) holds the registry and billing:

| Control table | Purpose |
| --- | --- |
| `tenants` | id, `subdomain` (unique), school name/contact, `db_name`, `db_url`, `status` (`pending`/`active`/`past_due`/`suspended`), `current_period_end`. |
| `tenant_payments` | Subscription charges by `external_reference`, `purpose` (`provision`/`renewal`) and `status`. |

### Pay → provision flow

Implemented in `server/services/provisioning.mjs`, driven by `POST /api/provision`:

1. `availability` — validates a subdomain (3–40 chars `[a-z0-9-]`, not reserved) and checks it is free.
2. `signup` — records a `pending` tenant and starts a subscription charge through the shared gateway (`createSubscriptionCharge`, mock by default). Refused unless `SUBSCRIPTION_AMOUNT > 0`.
3. `callback` (signed webhook) — on a successful payment, `provisionTenant` runs `CREATE DATABASE` (idempotent, via the CREATEDB admin role), builds the schema, marks the tenant `active` with a fresh `current_period_end`, and a best-effort **activation email** is sent (`server/services/email.mjs`, mock by default). Idempotent by reference.
4. Because DNS/TLS are wildcards, the school's subdomain is live the instant the row is `active` — no per-school DNS work. The first sign-up on the fresh tenant becomes its approved admin.

### Subscription lifecycle

`sweep` (run by cron or the admin endpoint) moves schools whose paid period has ended from `active` → `past_due`, then `→ suspended` after `SUBSCRIPTION_GRACE_DAYS`. A suspended school's subdomain is blocked with `402` until it renews (`signup` again → pay → reactivated).

### The platform boundary

Listing, creating and suspending schools are the *operator's* actions, not a school administrator's. They authenticate with `PLATFORM_OWNER_TOKEN` (`server/auth/platform-owner.mjs`), sent as `Authorization: Bearer …`, and fail closed when it is unset — including refusing a token under 24 characters, so `PLATFORM_OWNER_TOKEN=admin` leaves the door shut rather than ajar. The token lives only in the environment and never touches a tenant database.

They were previously gated on `body.requesterRole === 'admin'`, which meant **any school's administrator could enumerate every school on the platform**, and the listing included each one's `db_url`. Connection details no longer leave the control plane at all (`publicTenant` in `server/db/control.mjs`).

The console is `/owner` in the React app. The token is held in React state for the life of the tab — never `localStorage`, never a cookie.

### Search is namespaced per school

Meilisearch index uids are `<tenant>__<index>` (`indexUidFor`, `server/search/indexer.mjs`); the `default` tenant keeps the bare names, so a single-school deployment needs no reindex. This is not cosmetic: both the incremental sync and the full rebuild *clear* an index before refilling it from one database, so while every school shared six indexes, an ordinary attendance mark in one school wiped another's documents and replaced them with its own — and those then passed the `roles` filter cleanly. Tenancy decides *which index*; the role filter decides *which documents in it*.

### Cloud deployment

- **Wildcard DNS** `*.eschool.ink` → the server; a **wildcard TLS** certificate, which can only be issued over a DNS-01 challenge; and a reverse proxy that preserves the `Host` header. Ready-made configurations for both nginx and Caddy are in [`deploy/`](deploy/), each behind a compose profile.
- One control database, and a Postgres role with **CREATEDB** for `PROVISION_ADMIN_DATABASE_URL`.
- Configure `SESSION_SECRET`, `PLATFORM_OWNER_TOKEN`, `CONTROL_DATABASE_URL`, `TENANT_DB_URL_TEMPLATE`, `SUBSCRIPTION_*`, and live `PAYMENT_GATEWAY_MODE` + provider keys. Schedule a daily `POST /api/provision {"action":"sweep"}` with the owner token.
- The public sign-up page is served at `/signup`, and the operator's console at `/owner`.

## Per-School AI Keys

Provider credentials were process-global environment variables — correct when one deployment meant one school, wrong now: every school spent the operator's budget, and a school with its own Anthropic account or its own Ollama box could not use it.

The platform's environment is the default; a row in the tenant's `provider_credentials` table overrides it for that school. `api_key` is **encrypted at rest** with AES-256-GCM under `SECRETS_KEY`, not merely masked on read, because a tenant database dump is a normal operational artefact. Without `SECRETS_KEY` the school is told it cannot store a key, rather than having one written in clear. A key encrypted under a `SECRETS_KEY` that has since been rotated decrypts to nothing, and the school quietly falls back to the platform's credentials instead of its chat window throwing.

How the override reaches the model layer is the interesting part. The reads are synchronous and deep inside it (`providerHasCredentials`, `baseUrlFor`, `requireKey`), while loading a school's row is a query — so threading a credentials object through `runAgent`, the chat pipeline, every provider adapter and the embedding batcher would change dozens of signatures for a value none of them care about. `server/services/credential-store.mjs` uses an `AsyncLocalStorage` instead: `dispatch` puts the school's overrides in scope for the paths that can reach a model, and `credentialFor(name)` reads them there or falls back to `process.env`. Async context follows awaits, so it survives a whole agent run. The store lives in its own import-free module because the service that populates it imports `PROVIDER_ENV` from the model layer, and putting the reader there too would make a load-order cycle.

Administered from **Settings → AI Providers**, admin-only. The key is write-only from the browser's point of view: the API returns a masked preview and nothing else.

## Live Events

`GET /api/events` is a Server-Sent Events stream. One endpoint serves browsers and the mobile apps: the traffic only goes one way, so a WebSocket would buy duplex nobody uses and cost an upgrade handler plus a proxy `Connection` header change that would undo the keep-alive fix.

There is **no broker**, deliberately. A broker carries events between processes; this deployment is one container, so the publisher and the subscriber share a heap. `server/events/bus.mjs` is a `Map` of tenant to subscribers and nothing else — it is the seam where a Redis backend would go if a second replica ever appeared, and nothing above it would change. Durability is not its problem: every message is already a row in Postgres, and an event is a notification that the row exists.

**Keyed by tenant first, always.** One process serves every school, so a bus keyed only by user id would deliver one school's broadcast into another's app.

`server/events/audience.mjs` holds `reaches(event, user)` — the in-memory twin of `audienceClause`. Recipients are never materialised in this schema: one row addresses `all`, a `role`, a `designation` or one `user`, and membership is decided against the reader. The inbox does that in SQL and fan-out does it in JavaScript, so the rule lives in one function and is tested against the clause's behaviour.

**Catch-up.** Every event carries an id; on reconnect a browser sends `Last-Event-ID` and a mobile client sends `?since=`. `server/events/replay.mjs` replays from Postgres using the same audience clause, so a client can never be replayed something it could not have seen by asking. The cursor is `created_at` plus `id` — time alone would make two messages written in the same microsecond unreachable — compared as two predicates rather than a row-value, which pg-mem does not implement.

**Held connections.** A 25-second heartbeat keeps the connection under the proxies' `proxy_read_timeout 300s` and makes a dead socket fail fast. Authentication is re-checked every minute: every request path re-reads the user's row, and a connection held for hours is the one place that would otherwise keep whatever it was granted when it opened.

`server/events/sse.mjs` is the only file that touches a socket, and it is handled in the HTTP layer ahead of `dispatch` — which returns plain objects and can only express one `writeHead` plus one `end`. Everything with a decision in it lives in the sibling modules, which are tested through the ordinary runtime.

### Bearer tokens

Most mobile HTTP clients will not keep an HttpOnly cookie, so `authenticateRequest` accepts the same session token from `Authorization: Bearer` when there is no cookie. Same signature, same tenant binding, same expiry — a transport difference, not a second credential. `signin` returns the token in the body only when the caller passes `issueToken: true`; browsers never ask, so it stays out of reach of anything running on the page. The cookie wins when both are present.

## Roles

Six roles, listed once in `server/auth/roles.mjs` and mirrored in `src/lib/roles.ts`:

| List | Roles | Gates |
| --- | --- | --- |
| `TEACHING_ROLES` | admin, head_teacher, teacher | Student records, the assistant, lesson planning, the examiner |
| `FINANCE_ROLES` | admin, head_teacher, accountant, bursar | Invoices, payments, arrears, the finance tables in `/api/db` |
| `PRIVILEGED_ROLES` | admin, head_teacher, accountant, bursar | Backups, export/import, integrations, monitoring, the audit trail |
| `ACCOUNT_ADMIN_ROLES` | admin | Staff accounts, roles, school settings |

The lists exist because `hasRole` is plain allowlist membership with no hierarchy — a role is
invisible to a gate until it is named in one. Spelling a list out at each call site is how a role
silently keeps access to one screen and loses it on another, so the lists are named once and
imported. The two copies are kept in step by hand, and the role test asserts the full set so a drift
fails there rather than in production.

`bursar` was a *designation* on an administrator's account before it was a role. Keeping the books
is a job rather than a posting, and it should not require handing somebody the administrator's keys.
`schema.mjs` widens the role constraint, moves the rows, then narrows the designation constraint —
in that order, because either half alone fails on live data.

### Where a new role fails silently

Worth knowing before adding a seventh, because none of these produce an error:

- `server/services/scan-profiles.mjs` — an unknown role falls back to support staff and is served
  the fees-only ID card. The safe direction, and a silent one.
- `server/search/indexer.mjs` — a role absent from an index's `roles` array gets **zero hits with a
  200**, indistinguishable from "nothing matched".
- `server/agent/tools.mjs` — an unknown role yields an empty tool list, so the agent answers with no
  tools and looks like a bad model rather than a permissions problem.
- `local-backend.mjs` `DB_TABLE_ROLES` — an unlisted role gets 403 on every table.
- `src/components/AppLayout.tsx` `VIEW_ROLES` — the structural fence in front of the router. The
  side rail hides what a role cannot use, but hiding a link is not a permission check: a saved view
  or a stale link arrives at the router directly.

## Backup and Restore

`server/services/backup.mjs`. A backup is a real `pg_dump` — `--format=custom --no-owner --no-acl` —
not a hand-rolled dump. Writing one is easy and restoring one correctly is not; foreign keys,
sequences and the order they must be applied in are exactly where a home-made restore loses data.

`pg_dump` is injected rather than called directly, the way `provisioning.mjs` injects
`createPhysicalDatabase`, so the argv, the filename, the role gate and the audit row are all
testable without a Postgres or a subprocess. The connection string comes from
`database.pool.options.connectionString`, which is the only place a request handler can reach it —
the control plane deliberately never hands `db_url` to a caller. `database.kind === 'postgres'`
gates the service, so pg-mem refuses cleanly rather than producing an empty file.

Dumps are written to `BACKUP_DIR` (`/var/backups/eschool`), a named volume. The runtime image gains
`postgresql16-client` for this, and it is the only thing the container writes to disk — the
Dockerfile comment that said nothing is written was corrected rather than left to mislead.

Three properties follow from what a dump contains — every student record, every password hash, and
the MCP tokens `mcp_servers` still stores in plaintext:

- the filename is validated against the backup directory before use, because it comes from a
  database row and joining it onto a path unchecked would let `../` out of the directory;
- it is reachable only by `PRIVILEGED_ROLES`, download included;
- taking, downloading, deleting one is audited.

Restoring is deliberately not in the app. It is `pg_restore` on the server, by an operator, against
a database they have chosen — the one operation where doing it by hand is the safer default.

### Unattended backups

`server/services/backup-scheduler.mjs`, and the only recurring job in the server. A school that has
to remember to press "Back up now" does not have backups, it has a good intention.

The schedule lives in `school_backup_schedule` — one row, in the tenant database, because the time
is the school's choice. Its own table rather than columns on `school_settings` for the reason
`school_integrations` is one: `updateSettings` replaces the whole row, so saving the school's logo
would silently blank a schedule nobody touched. `run_at` is `HH:MM` text and `timezone` an IANA
name, because this is a wall clock preference rather than an instant — two in the morning has to
stay two in the morning across a daylight-saving change, so the comparison is done by formatting the
current instant into the school's zone rather than by offset arithmetic.

`isBackupDue` asks *"has today's hour come round, and has today's backup been taken?"* — never *"how
long since the last one?"*. That is what makes it survive a restart. A container that comes back at
09:00 having missed 02:00 still takes the day's backup; one restarted at 01:59 does not skip the day.
`last_run_at` is stamped whether the dump succeeded or failed, so a database that cannot be dumped is
retried tomorrow rather than every minute for the rest of the day.

Started at the tail of `createAppRuntime` and stopped as the **first** statement of `runtime.close()`,
before any pool is closed — a sweep waking mid-shutdown would be querying a database on its way out,
and `tests/local-backend.test.mjs` tears down through `close()`, so a leaked interval would keep
`node --test` from ever exiting. The handle is `unref`'d as a second guard. A sweep never overlaps
itself: a large school's dump can outlast the tick, and two `pg_dump`s racing the same schedule would
write two backups and log one.

It is **off unless `BACKUP_SCHEDULER` is set**, and set on exactly one long-running process. Two
processes with it on would each take the day's backup and each believe it was the one that had. The
Backups screen reports whether a scheduler is actually running in the server it is talking to, so a
saved schedule cannot sit there looking armed on a deployment that never starts one.

Retention prunes **scheduled backups only**. A manual backup is a deliberate act — somebody took it
before a risky change — and having the machine delete it a week later because an unrelated retention
number said so would be its own kind of data loss. `kind = 'scheduled'` and a blank `created_by` are
what the screen reads as `· automatic`.

Multi-tenant deployments enumerate schools with `listTenants(control)` and open each through the
registry's `open(tenantId)`, which is `resolve()` without the Host-header parsing — a background job
has no request to derive a tenant from, and letting it name its own is safe for exactly the reason
letting a browser do so is not. `PUBLIC_TENANT_COLUMNS` still withholds `db_url`; nothing here asks
for it. Only `status = 'active'` schools are dumped.

## Data Export and Import

`server/services/data-transfer.mjs`. Pure SQL in Node, so it runs identically on pg-mem and is
tested end to end.

Distinct from a backup on purpose. A backup is opaque, complete, and for restoring this database. An
export is readable — CSV a bursar opens in a spreadsheet, JSON another system reads. Neither
replaces the other.

Never exported, by column name wherever they appear: `password_hash` (a hash is still a credential),
`api_key` and `api_secret` (ciphertext meaningless outside this deployment's `SECRETS_KEY`), and
`auth_token` (stored in plaintext, so exporting it hands over live tokens). Skipped as rebuildable:
`curriculum_chunks`, `analytics_snapshots`, `compliance_reports`, `internal_message_reads`. The
Meilisearch index is not exported either — Postgres is the system of record, and a restore ends by
reindexing rather than carrying a copy of something derived.

Import requires a dry run first and refuses without its token. `RESTORE_ORDER` fixes the write order
by foreign-key dependency — students before invoices, invoices before payments, payments before
receipts, permissions before gate passes. Existing rows are updated rather than rejected, because an
import is usually a re-import and failing the file because one student is already on the roll helps
nobody. The write is wrapped in `withTransaction`; note that the test suite must not assert rollback,
because pg-mem treats `BEGIN`/`COMMIT` as no-ops.

## Per-School Integrations

`server/services/integrations.mjs`, `school_integrations`. Where the school's Moodle and at most one
ERP (Odoo, ERPNext or Dolibarr) live, so they open from inside the app rather than from a bookmark.
This is a launcher, not a sync — no records move in either direction.

Credentials reuse `encryptSecret`/`decryptSecret` from `provider-credentials.mjs` rather than
repeating the cipher; see [Per-School AI Keys](#per-school-ai-keys) for the `SECRETS_KEY` posture,
which is identical. Two conventions are copied from `mcp-servers.mjs` because both were learned the
hard way there: an omitted token means *leave the stored one alone* while an explicit empty string
clears it, and `test` returns `connected: false` with the reason rather than a top-level `error` —
an error becomes a 400 with a null body, hiding the diagnosis the screen exists to show.

`http` addresses are refused for `base_url`. The token travels on every request, so an integration
configured over plain http would leak it to anyone on the same network; better to refuse at
configuration time than be quietly insecure afterwards. Enabling a second ERP stands the first down,
because a school runs one.

### Two addresses, and why

`base_url` is what the **browser** opens; `config.internal_url` is what the **server** calls. For a
system the school already runs these are the same address and only the first is set. For one
bootstrapped from `deploy/integrations/` they differ, and the difference matters: a bundled Moodle
lives on the Docker network as `http://moodle:8080`, which no browser can reach — a service name
resolves inside the bridge network and nowhere else.

`normalizeInternalUrl` permits plain http for a **single-label hostname** (and loopback), and holds
anything with a dot in it to the same https rule as the public address. The objection to http is that
a token can be read in transit; a service name has no route off the bridge network, so there is no
transit to read. The relaxation is deliberately confined to the server-side field and does not touch
the one the browser uses.

The connection test prefers `internal_url` when there is one — testing a bundled system by its public
address would check the reverse proxy in front of it rather than the system itself, and would fail
outright before that proxy is configured.

### Bundled systems

`deploy/integrations/{moodle,odoo,erpnext,dolibarr}.yml`, one complete stack per file, started from
`./containers.sh` option 18 or directly:

```bash
docker compose -f deploy/integrations/moodle.yml -p school-ai-search-moodle up -d
```

Separate files rather than more profiles in `docker-compose.yml`: ERPNext alone is seven services
(MariaDB, three Redis, the web process, a worker and a scheduler), and folding all four in would
roughly triple the length of the main file for something most schools never start. Each brings its
own database and named volumes; datastores publish no ports at all, and the application ports bind to
loopback, following `librechat`/`librechat-mongo`.

They meet the app on a shared network. `docker-compose.yml` names its default network `eschool_net`
and each integration file joins it as `external: true` — a default network belongs to the file that
created it, so without the explicit name a second file would silently get a second network and
nothing would resolve. The app must be up first; `containers.sh` checks the network exists and says
so rather than failing obscurely.

ERPNext is the one that is not usable when it comes up: Frappe has no site until one is created,
which is the `erpnext-create-site` one-shot behind a `setup` profile. It is deliberately not part of
`up` — it takes minutes and would fail noisily on every restart after the first.

Note that Compose will happily run all three ERPs at once while the app permits a school only one.
That is not a contradiction to fix; it is a deployment convenience for evaluating them.

The UI frames the system and falls back to a new tab on a timeout, since `X-Frame-Options` refusals
are not observable from script — no error event, no readable status, the `load` event simply never
fires. That is a guess, and it is the honest one available.

## Student Summary

`server/services/student-summary.mjs`, `src/components/chat/StudentSummary.tsx`. Where a search
result for a student lands: everything the school holds about one child on one screen, printable in
one click. Before it, answering a single question about a student meant visiting the roster, the
records workspace and the ledger.

**The role filtering is in the query, not the response.** A section the reader may not see is never
read out of the database, so there is nothing in the payload to hide — a bursar's copy has no
disciplinary record in it, and a teacher's has no payment history. The test asserts this on the
payload rather than on the component, because a component test would pass just as well against a
hidden `<div>`.

The section policy is **borrowed from `scan-profiles.mjs` rather than restated**. That module already
answers "what may this profile see of a student" for the ID-card scan, and two lists that were
supposed to agree would eventually stop agreeing. `EXTRA_SECTIONS` adds only what a scan has no
business showing — `discipline` (teaching roles) and `movements`, the passage through the school from
admission through promotions to transfer.

The academic and financial figures come from `loadReportData` in `student-report.mjs`, the same
loader the parent report PDF is built on, so a number on this screen and a number on that PDF cannot
disagree. Note this is *not* the report-card path: `buildSubjectResults` in `report-card.mjs`
manufactures marks deterministically from `gpa` and `attendance_rate`, which is right for a term
report card template and wrong for a record of what a student actually scored.

`GET /api/student-reports/:code.pdf` prints the whole thing. `renderReport` had been able to build
exactly this document since the parent-report work and simply had no route — it was imported in
`local-backend.mjs` and never called, reachable only by emailing it to a guardian. Print and download
go through the existing `printFromUrl` / `downloadFromUrl` in `src/lib/download.ts`.

## Authentication and Sessions

Identity used to be self-declared: the signed-in user was a JSON blob in `localStorage` and every request carried its own `requesterRole` in the body, so editing one word in devtools made a teacher an administrator. Two files replace that — `server/auth/session.mjs` (the token and cookie) and `server/auth/actor.mjs` (who a handler is acting for).

**The token proves identity, not privilege.** It is an HMAC-SHA256 signature over `{user id, tenant, expiry}` — no role. The role is read from the `users` row on *every* request, one primary-key lookup beside handlers that already issue dozens of queries. That buys what a role-in-the-token design cannot: a demoted, deleted or un-approved account loses its powers on the very next request rather than whenever the token happens to expire. It also means no session table and no revocation list.

**The cookie is host-only** — `HttpOnly; Secure; SameSite=Lax; Path=/`, and deliberately **no `Domain` attribute**. A cookie set by `kampala-high.eschool.ink` is therefore never *sent* to `gulu-ss.eschool.ink`: the browser enforces the boundary before the request is made, rather than the server checking after it arrives. The tenant claim inside the token is a second lock on the same door. `SameSite=Lax` rather than `Strict` because report cards and exam papers are downloaded by navigating to a URL, and `Strict` would strip the cookie from exactly those requests.

`SESSION_SECRET` signs the token. Unset, a random key is generated at startup — so sessions die on restart and break across replicas, which is survivable in development and not in production. A fixed fallback would have been worse: every unconfigured deployment would be forgeable.

### The three-state actor

`dispatch` carries an `actor`, and the three states are distinguished rather than collapsed into a mode flag:

| `actor` | Means | Behaviour |
| --- | --- | --- |
| `undefined` | Not a request at all — a test, or the server calling its own handler | Falls back to `body.requesterRole`, exactly as before |
| `null` | A real HTTP request carrying no valid session | Nobody. The body is ignored, so claiming a role in it achieves nothing |
| an object | An authenticated user | Used; the body is ignored for the same reason |

`requireRole(actor, roles)` in `server/auth/actor.mjs` is now the single gate. It replaced the same five lines copy-pasted into eight services.

Two endpoints had no gate at all and now do:

- **`POST /api/db`** — a generic CRUD endpoint over 48 tables with *no role check*, so anything that could reach it could read every invoice and payment in the school. It now requires a session, and each table carries a minimum role (finance and credentials are admin-only; support staff reach no table at all). A table-level rule cannot express "a teacher may edit their own class" — this is the floor, not the ceiling.
- **`POST /api/functions/fee-status`** — with no student code it listed every student and balance in the school to anyone. The by-code lookup stays open, because that is the gate scanner and parent path and the code *is* the credential; the listing form now needs a session.

### Cross-origin

`server/http/cors.mjs` echoes the request origin only when it is `https://<something>.<TENANT_ROOT_DOMAIN>` (or a `CORS_EXTRA_ORIGINS` entry, or loopback when the server itself was reached on loopback), and always sets `Vary: Origin`. The previous `Access-Control-Allow-Origin: *` — with `X-Tenant` in the allowed headers — let any page on the internet address any school. A wildcard is also simply illegal alongside `Access-Control-Allow-Credentials: true`, which the session cookie requires.

`server/http/security-headers.mjs` adds HSTS, `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` to every response; none of them existed before. `requestIsSecure` reads `X-Forwarded-Proto` to learn the external scheme behind the proxy — trusted without an allow-list because forging it can only make the answer *stricter* (a Secure cookie, an HSTS header) and is never used to skip a check.

## Quality Checks

Useful project commands:

```bash
npm run build
npm run lint
npm run test:backend
```

The backend test suite uses an in-memory PostgreSQL-compatible database and verifies auth, database queries, audit logging, chat, voice placeholder behaviour, and PDF generation, plus:

- the agent loop executing tools, feeding results back, bounding its steps, and reporting a failing tool rather than aborting;
- the tool registry hiding tools a role may not use;
- curriculum seeding, keyword retrieval with no embedding provider, metadata filtering, and idempotent re-uploads;
- the MCP client's `initialize` / `tools/list` / `tools/call` round trip, and one unreachable server not taking down the others;
- the MCP server's bearer gate, tool listing and tool calls;
- question generation honouring a blueprint and attaching citations, and paper publishing writing real `exams` and `exam_schedules` rows;
- every role gate refusing non-teaching staff **without writing anything**;
- exam papers, marking schemes and lesson plans rendering as valid PDFs;
- the role list asserted as a closed set, in both directions — that a teacher and support staff are
  not privileged, and that the finance posts see money but not student records. The frontend keeps
  its own copy in `src/lib/roles.ts`, so a drift between the two has to fail here;
- the bursar migration moving an administrator's designation to a role, clearing a hand-edited one
  on any other role, and changing nothing when it runs a second time;
- backups and export/import refusing every unprivileged role across every action, then a row count
  proving nothing was written past the guard;
- a backup building the right `pg_dump` arguments and filename, reading its size back off disk and
  auditing who took it — all without spawning a subprocess, because the runner is injected;
- an export carrying no `password_hash`, `api_key`, `auth_token` or `api_secret`, asserted against
  what comes back rather than against the exclusion list, so it still holds if the list moves;
- an import refusing to run before its dry run, and the dry run writing nothing;
- an integration token surviving a save that omits it, clearing on an explicit empty string, and
  never appearing in a response; one ERP standing another down; and a failed connection test
  returning `connected: false` with a reason rather than a 400 with a null body;
- an unattended backup coming due once its hour has come round and only once that school day,
  catching up after downtime rather than skipping the day, and a scheduled run filing itself as
  automatic, pruning its own and leaving manual backups alone;
- the backup scheduler being off unless asked for, and stopping when `runtime.close()` is called — a
  timer that survived would also keep `node --test` from ever exiting, so the leak is its own
  assertion;
- ID cards selected by class and by registration date, composing rather than overriding, and a
  window nobody was registered in returning a 404 the screen can explain rather than an empty PDF;
- a student summary showing each role its own share of one student: the incident text is absent from
  a bursar's payload entirely, asserted on the JSON rather than on the component, because a
  component test would pass equally against a hidden `<div>`.

Outbound model, embedding and MCP calls all go through an injectable `httpClient`, so every provider path is exercised without a network.

### Fetching data that needs a session

A bug worth not reintroducing, because it cost a release and no backend test could see it.

`ChatProvider` and the workspaces beneath it mount **above the sign-in screen**, before `AuthContext`
has restored the session. A `useCallback` that fetches a role-gated table and does not depend on
`user` therefore fires once, is refused as an anonymous read, and — because its identity never
changes — is never retried. Signing in does not retrigger it. The roster stayed empty until the
reader pressed refresh, and it looked like a school with no students rather than a failed load.

So: **any callback that reads a gated table takes `user` as a dependency**, and skips while
`isLoading` is true so no request is made during session restore.

```ts
const refreshStudents = useCallback(async () => {
  if (authLoading) return;
  if (!user || isSupportStaff) { setStudents([]); return; }
  ...
}, [authLoading, user, isSupportStaff]);
```

Gating on a derived boolean such as `isSupportStaff` is not enough: it is `false` before sign-in and
`false` after, so it never changes and never re-runs the effect.

The second half is that these loads swallowed their errors into `console.error` and rendered an empty
table, which is why a failed load was indistinguishable from an empty school. Each now holds an error
state and offers a retry.

### Two constraints worth knowing before changing the data layer

`pg-mem` backs both the test suite and the Vercel demo, and it is less capable than PostgreSQL in two ways this codebase has already hit:

- it does not implement `GROUP BY` on a primary key carrying the other selected columns (it returns `NULL` for them), and it rejects correlated subqueries. Aggregate with two plain queries merged in Node instead;
- it supports no extensions, which is why embeddings live in a JSONB column rather than pgvector.

Both are the reason certain queries look more verbose than they would need to be against PostgreSQL alone.
