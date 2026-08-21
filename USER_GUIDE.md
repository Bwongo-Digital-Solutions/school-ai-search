# e-School — User Guide

A practical, task-based guide to using e-School (SchoolBot AI): student records, attendance, fees,
report cards, ID cards, lesson planning, exam authoring, branding, and — for platform operators —
onboarding whole schools.

For architecture, endpoints and deployment, see [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md).

---

## 1. Who can do what (roles)

Every person signs in with one of three roles. The first account ever created becomes the
**Administrator** automatically.

| Role | Sees | Can do |
| --- | --- | --- |
| **Administrator** | Everything | Manage students, records, fees, settings, staff accounts, reports; approve new sign-ups. |
| **Teacher** | Student records (view), records workspace, teaching tools | View students; record attendance, academic, discipline, admissions, allocations, lifecycle; plan lessons; write and bank exam questions; use the AI assistant. |
| **Support staff** | School Fees Status only | Look up a student's fee balance/status (by search or by scanning an ID card). Nothing else. |

Support staff are non-teaching staff — gatekeepers, bursary desk, cooks, drivers — who need to
confirm whether fees are cleared and nothing more.

---

## 2. Getting started

### Creating the first (admin) account
Open the app and choose **Sign Up**. The **first** account created is an approved administrator and
can sign in immediately.

### New accounts need approval
Every account created **after** the first one is **pending**: the person can register but **cannot
sign in** until an administrator approves them. As an admin:

1. Go to **Staff** (top navigation).
2. New sign-ups appear under **Pending Approval**.
3. Click **Approve** to let them in, or **Reject** to delete the account permanently.
4. Approved users appear under **Active Users**, where you can set each to Administrator, Teacher, or
   Support Staff.

If someone tries to sign in before approval, they see *"Your account is awaiting administrator
approval."*

---

## 3. Students

**Student Management** (top navigation) lists all students with search, filters and sorting.

### Add or edit a student
- Click **Add Student** (or the pencil on a row).
- Fill in the details. **Student Photo** (top of the form) is optional; when set it appears on the
  student's ID card and report card automatically — you upload it once.
- Student numbers are unique; the app will not let two students share one.

### Student ID cards
- From a student row, open the **ID card** preview, or use **Print ID Cards** to produce a batch
  (ten per A4 sheet, or one plastic-card-sized page each).
- Each card carries the school name, logo and theme colour (from Settings), the student's photo, and
  a QR code. Scanning the QR opens that student's **fee status**.

---

## 4. Student records (Records workspace)

The **Records** workspace holds everything time-based for one selected student: admissions,
attendance, academic history, discipline, class allocation, and lifecycle (promotion/transfer).

### Admissions — and billing on admission
When you record an admission for a student:

- **Save Admission** records the application/decision.
- **Admit & Bill Tuition** (administrators only) admits the student **and immediately raises a
  tuition invoice** from the fee structure that matches their grade and term. You are shown the exact
  amount (after any bursary) and asked to confirm before the invoice is created.
- If no matching fee structure exists, you are told to create one first (see Fees → Fee Structures).
- A student is **not billed twice** for the same fee structure — re-running it is safe.
- The app warns you if the student **already has an admission**, so the same student is not admitted
  multiple times by mistake.

### Attendance
Mark a student present/absent/late/excused for a date. **Only one record is kept per student per
day** — marking the same student again for the same date **updates** that day's record instead of
adding a duplicate. Tick *notify parent* to queue an SMS alert (delivery is a school-configured
channel).

---

## 5. Fees

There are two fee screens:

- **Fees** — a read-only **School Fees Status** table (who owes what). Support staff see only this.
- **Finance** — full fee management (administrators only).

### Fee Management (admin) — the tabs
1. **Fee Structures** — define what a cohort is charged: name, grade, day/boarding, term, year,
   amount, currency, due date. Leave the grade blank to bill all grades. A structure that has
   already produced invoices is *archived* (not deleted) so history stays intact.
2. **Billing Run** — pick a structure, **Preview** exactly who will be billed and for how much
   (bursaries shown), then **Confirm & Bill**. Running it again never double-bills.
3. **Record Payment** — take a cash/bank/cheque/mobile-money payment against a student. It settles
   the oldest due invoice first (or one you pick), issues a **numbered receipt** (downloadable PDF),
   and reports any overpayment as credit.
4. **Student Ledger** — every invoice and payment for a student with a running balance, plus a
   **Download Statement** PDF, and the student's **payment rating** (below).
5. **Arrears** — outstanding balances aged into *not-due / 1–30 / 31–60 / 61–90 / 90+ days* buckets,
   with a CSV export.
6. **Bursaries** — scholarships and discounts (percentage or fixed), per student, optionally scoped
   to a structure/term/year. Applied automatically to future invoices; already-issued invoices keep
   the discount they were raised with.
7. **Payment Ratings** — each student is scored 0–100 and graded A–E from their own payment history
   (how promptly settled invoices were paid, how much due money is unpaid, how overdue the oldest
   unpaid invoice is). An admin can **override** the computed rating with a manual standing plus a
   required reason and an optional review date; the override applies everywhere while the computed
   score stays visible for reference.

### Financial report
On the **Finance** header (and, for admins, on **School Fees Status**) use **Financial Report** to
download a branded PDF: total invoiced/collected/outstanding, the payment-standing distribution, and
the arrears ageing table.

---

## 6. Report cards

From **Student Management**, open a student and choose **Build PDF Report Card**.

- School name, tagline, address, logo and theme colour come from **Settings** automatically; you can
  override any of them for a single card.
- The student's stored **photo** is used automatically (or upload a one-off).
- Choose the term, academic year and grading scheme — including **Uganda's competency-based
  curriculum (A–E)** alongside the classic UNEB D1–F9 scale and other country presets.
- Add teacher/head-teacher names and comments, then download the PDF.

---

## 7. Settings (admin)

Open **Settings** from the user menu. Administrators only. It has two tabs.

### Branding

Set your school's identity **once**: name, tagline, address, **logo**, **theme colour**, and contact
phone/email.

These are applied everywhere: report cards, ID cards, fee receipts, statements, the financial
report, exam papers, lesson plans, and the app header. Changing them here updates every document
going forward.

### MCP servers

Optional. Connect an external service so the AI assistant can use its tools — a curriculum service,
a document store, whatever speaks the Model Context Protocol.

Add one with a name, its URL and (if it needs one) an access token, then press **Test** to check the
connection and see which tools it offers. Teachers can then switch it on per message from the chat
composer.

> Only connect servers you trust. Their tools run on your teachers' behalf, and what they return
> reaches the assistant. Access tokens are stored on the server and never shown again — editing a
> server's URL keeps its saved token unless you type a new one.

e-School's own tools also work the other way round: with a server token configured, tools like
student search and curriculum lookup can be used from Claude Desktop, Claude Code or another MCP
client. See [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) for setup.

---

## 8. Teaching tools

Teachers and administrators get two teaching modules, both under **Teaching** in the top bar.
Everything they produce is written from your school's **curriculum library**, and every draft shows
the syllabus passages it came from — so you can check it rather than take it on trust.

### The curriculum library

e-School ships with topic outlines for the **Uganda syllabus** (NCDC lower secondary, UACE, PLE) and
**International GCSE** (Cambridge, Edexcel) across the core subjects, so both tools work the moment
you sign in.

You should still add your own material. Any teacher can upload a scheme of work, a topic breakdown
or past-paper notes, and it is indexed alongside the bundled outlines — where it will usually rank
*above* them for your own topics, because it is a closer match. Only an administrator can remove a
bundled outline, since that affects every teacher.

> Uploaded and bundled material is a starting point, not an authority. Check anything
> exam-critical against the current NCDC or Cambridge syllabus for the series you are teaching.

### 8a. Lesson Planner

**Plan Builder** — choose the curriculum, year, subject and topic, set the lesson length, and press
**Draft this lesson**. You get back learning outcomes, competencies, teaching aids, a stage-by-stage
sequence with minutes, assessment, differentiation and homework.

Everything is editable. A generated plan is a *first draft* to adapt to your class — edit it, then
**Save changes**, **Approve** it when you are happy, and **Export PDF** for a printable plan with a
signature line.

**My Plans** — filter by status, term or subject; approve, mark delivered, duplicate (useful for
teaching the same lesson to another stream), export, or delete.

**Scheme of Work** — list a term's topics, one per line, and get a lesson plan for each. If a topic
has no syllabus material behind it, that one is reported and skipped; the rest still come through.

### 8b. Digital Examiner

Writes test questions, assignments and exams to the standard of the curriculum you pick, tuned by
**year, subject, topic and grade**.

**Blueprints** — a blueprint is the tuning. It fixes the curriculum, year, subject, grade,
assessment type and total marks, plus how questions spread across **difficulty**, **Bloom levels**
and **question types**. Save one per recurring assessment and reuse it each term. Anything you leave
blank is filled in from the curriculum's own paper structure.

**Generate** — pick the topics and how many questions you want. Tick **Target weak topics** to
weight the paper towards whatever this cohort scored lowest on in the gradebook.

Every question comes back as **Awaiting review**, showing its type, marks, difficulty, Bloom level,
assessment objective, the expected answer, the mark-by-mark scheme, and the syllabus passage behind
it. Approve the ones you want; retire the ones you do not.

**Question Bank** — your approved questions, reusable across terms and years. Filter by status,
topic or subject, tick the ones you want, and assemble them into a paper.

**Papers** — set the title, duration and candidate instructions, then create the paper. Total marks
are counted from the questions themselves, so the printed total always matches the paper. From here
you can:

- **Paper** — download the question paper, with writing space sized to each question's marks.
- **Scheme** — download the confidential marking scheme, with answers, award points and sources.
- **Publish** — add it to the school's real exam records, optionally with a date, class and room.

> Publishing is blocked until **every** question on the paper is approved, and a retired question
> cannot be put on a paper at all. Once published, the exam appears to the timetable and gradebook
> like any other, and the action is recorded in the audit log.

---

## 9. AI assistant & audit

**Chat** provides a natural-language student search ("top 5 by GPA", "who has attendance below
85%"). By default it answers only from student records.

Three switches above the message box change what a message can do:

| Switch | Effect |
| --- | --- |
| **Agent** | The assistant looks things up before answering — searching students, aggregating gradebook results, reading the curriculum — instead of answering from what it was handed. |
| **Curriculum** | Searches the curriculum library and cites it, so syllabus answers carry sources. |
| **MCP** | Brings in tools from any external services your administrator has connected. |

Under each reply you will see the **sources** it used, and a collapsed **tool calls** line you can
open to see exactly what it looked up. If the assistant could not reach a connected service, or ran
out of steps, it says so rather than quietly returning less.

Agent and MCP need a model that supports tools — pick one from the model menu; the built-in
**Local Rules** engine searches student records only, without any network or API key.

**Audit** (admin) shows a history of sensitive actions — billing runs, payments, bursaries, standing
overrides, account approvals, exam publishing, settings changes — each with who did it and when.

---

## 10. For platform operators — onboarding schools

e-School can run many schools from one deployment, each with its **own isolated database**, reached
at its **own subdomain** (`your-school.eschool.app`).

### Self-service sign-up
A school signs itself up at the public page **`/signup`** (e.g. `apply.eschool.app/signup`):

1. Enter the school name, pick a web address (subdomain — availability is checked live), and an admin
   email.
2. Choose a payment method (MTN MoMo, Airtel Money, or bank) and pay the subscription.
3. When the payment confirms, the school's space is **provisioned automatically** and an *"your
   school is ready"* email is sent with the link. The page also activates on its own once payment
   lands.
4. Opening the new school, the **first** account created becomes its administrator (Section 2).

### Subscriptions
Access is tied to the subscription. When a paid period ends the school moves to a grace period and
then, if unpaid, is **suspended** — its subdomain shows a renewal notice until it pays again.
Renewing (sign up again with the same subdomain → pay) reactivates it.

### What operators configure (once)
Wildcard DNS/TLS for the root domain, a control database, subscription pricing, live payment-provider
keys, and (optionally) an email provider for the activation email. See
[TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) → *Multi-Tenancy and Self-Service Provisioning*.

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| *"Your account is awaiting administrator approval."* | Ask an admin to approve you under **Staff → Pending Approval**. |
| **Admit & Bill** says no fee structure matches | Create an active fee structure for that grade/term under **Finance → Fee Structures** first. |
| A student can't be marked twice for the same day | Expected — attendance keeps one record per day; marking again updates that day. |
| A school's page shows *"subscription has lapsed"* | The subscription is unpaid/suspended — renew from `/signup`. |
| Report card / ID card shows the wrong school name or colours | Update **Settings**; documents read the global branding. |
| Support staff sees only the fees screen | Expected — that role is limited to fee status by design. |
| **Draft this lesson** / **Write questions** is greyed out | Pick a configured AI model in the chat composer first. The **Local Rules** engine searches student records only and cannot write. |
| The **Agent** or **MCP** switch is greyed out | The selected model cannot call tools. Choose one that can, or check that a model with an API key is selected. |
| A generated plan or question says the syllabus does not cover something | The curriculum library has nothing on that topic. Upload your scheme of work for it under the curriculum library, then try again. |
| Answers cite IGCSE outlines when you teach the Uganda syllabus | Set the curriculum on the form, and upload your own material — your uploads rank above the bundled outlines for your topics. |
| **Publish** on a paper is refused | Every question on the paper must be approved first. Open the Question Bank and approve the remaining ones. |
| An MCP server shows a connection error | Check the URL and token under **Settings → MCP Servers** and press **Test**. Chat still works without it; the failure is reported alongside the answer. |

---

*Powered by e-School.*
