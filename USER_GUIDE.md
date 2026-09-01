# e-School — User Guide

A practical, task-based guide to using e-School (SchoolBot AI): student records, attendance, fees,
report cards, ID cards, lesson planning, exam authoring, branding, and — for platform operators —
onboarding whole schools.

For architecture, endpoints and deployment, see [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md).

---

## 1. Who can do what (roles)

Every person signs in with one of six roles. The first account ever created becomes the
**Administrator** automatically; every role after that is assigned by an administrator under
**Staff Access**.

| Role | Sees | Can do |
| --- | --- | --- |
| **Administrator** | Everything | Everything below, plus staff accounts and roles, the audit trail, and the school settings. |
| **Head Teacher** | Everything except staff and settings | Every student record, the fees, the whole of monitoring, and the school's data — backups, export, import, and the connected systems. Cannot change roles or system settings. |
| **Accountant** | Fees, reports, school data | Fee structures, billing runs, payments, arrears, bursaries, ratings and financial reports. Backups, export and import. Does not see student records or the teaching tools. |
| **Bursar** | Fees, reports, school data | The same reach as the accountant, and the counter work that goes with it — receipting payments and answering on a family's account. |
| **Teacher** | Student records, teaching tools | View students; record attendance, academic, discipline, admissions, allocations and lifecycle; plan lessons; write and bank exam questions; use the AI assistant. |
| **Support staff** | School Fees Status only | Look up a student's fee balance or status, by search or by scanning an ID card. Nothing else. |

Two divisions run through that table. **Student records** are for the people who teach — the
administrator, the head teacher and teachers. **Money** is for the people who keep the books — the
administrator, the head teacher, the accountant and the bursar. The head teacher is in both,
because running a school means answering for both.

The third division is narrower: **the school's data as a whole** — a backup, or a bulk export — is
every student record in one file. That is for the four roles that answer for the institution, not
for a teacher who may perfectly well read any one of those records on their own.

Support staff are non-teaching staff — gatekeepers, matrons, cooks, drivers — who need to confirm
whether fees are cleared and nothing more. A support-staff account can be given a **post** (gate,
dormitory or kitchen) which decides what a student ID scan shows them.

> **A note if you are upgrading.** The bursar used to be a *post* on an administrator's account.
> It is a role now — keeping the books is a job, not a posting, and it should not require handing
> somebody the administrator's keys. Existing bursar accounts are moved across automatically the
> first time the new version starts.

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

### Staying signed in

Signing in gives you a session that lasts about **12 hours**, and it extends itself while you are
working, so a long day in the gradebook does not end in a sudden sign-out. Closing the browser does
not sign you out; **Sign Out** does, on the server as well as on your screen.

What you are allowed to do is decided by the server from your account each time you ask it for
something — not by the screen you happen to be looking at. Two things follow, and both are
deliberate:

- If an administrator changes your role, it takes effect on your **very next click**, not whenever
  you next sign in.
- Nothing you can change in your own browser will grant you access you have not been given.

Each school's sign-in is its own. A session at `kampala-high.eschool.ink` means nothing at any other
school on the platform, even for the same person — they sign in separately at each.

### Editing and removing accounts

Under **Staff → Active Users**, each person has two buttons beside their role:

- **Edit** (pencil) — change their **display name** and **sign-in email**. Changing the email means
  they must use the new address next time they sign in. Permissions are *not* touched here; use the
  role dropdown for that.
- **Delete** (bin) — remove the account permanently. They lose access immediately and would have to
  sign up again. Work they recorded — attendance, lesson plans, audit entries — is kept.

Two deletions are refused, both to stop you locking the school out:

- **your own account**, so you cannot sign yourself out mid-session (the button is hidden on your row);
- **the last remaining administrator** — promote someone else to Administrator first, then delete.

Both editing and deleting are written to the **Audit** log with who did it and when.

> Use **Delete** for staff who have left. **Reject**, on a pending sign-up, is the same removal for
> someone who never should have had an account.

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

### Payment history in chat

Ask the assistant about a student and their fee position now comes back with the profile — status,
invoiced, paid, balance, next due date and last payment. Ask for the statement to get the itemised
document.

Teachers as well as administrators can open a **single student's** statement. The school-wide
financial report stays administrator-only, and support staff still see payment status alone.

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

### Paying before the bill arrives

If a family pays before an invoice has been raised — a deposit at admission, a parent settling next
term early — that money is held as **credit** against the student. When the bill is finally raised
it comes out already reduced by what was paid, and the receipt shows how much was applied.

Nothing to remember and nothing to reconcile by hand: pay 200,000 against a 500,000 term and the
invoice is issued showing 300,000 outstanding. Pay more than the term costs and the remainder stays
as credit against the next one.

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

Open **Settings** from the user menu. Administrators only.

### Branding

Set your school's identity **once**: name, tagline, address, **logo**, **theme colour**, and contact
phone/email.

These are applied everywhere: report cards, ID cards, fee receipts, statements, the financial
report, exam papers, lesson plans, and the app header. Changing them here updates every document
going forward.

### Academic level & grading

Also on the Branding tab, set your **school level** and **examination system**. This is the single
setting that decides how every report card is graded — teachers never pick a scale per student.

| School level | What report cards show (Uganda / UNEB) |
| --- | --- |
| Pre-school | Development descriptors — Exceeding, Meeting, Approaching, Emerging. No marks or aggregate. |
| Kindergarten / Nursery | Development descriptors, as above. |
| Primary | PLE grades **D1–F9**, each worth 1–9 points, with an **aggregate** over the four subjects and a **Division**. |
| Secondary | **S1–S4 (O-Level):** UCE grades D1–F9 with an **aggregate** over the best eight subjects and a **Division**. **S5–S6 (A-Level):** principal letter grades **A–F** with **principal points** out of 18. |
| Technical / Vocational | Distinction / Credit / Pass. |
| Tertiary / University | **GPA** on the 5.0 scale, with the degree classification (First Class, Second Upper, and so on). |

Set the examination system to **International** instead and the same levels report letter grades,
with a **GPA** on the 4.0 scale at tertiary — which is what an international school or institution
expects.

> **A secondary school gets both scales automatically.** You do not choose between O-Level and
> A-Level: each student's own class decides. A Senior 2 is graded on the UCE aggregate and a Senior 6
> on UACE principal points, from the one setting.

Two things worth knowing:

- **Divisions need a full set of subjects.** A Division is only printed once the required subjects
  are recorded — eight for UCE, four for PLE. Below that the report card shows the aggregate so far
  and marks it *Provisional*, because an aggregate of 8 across five subjects is not a Division 1.
- **Percentage cut-offs are a guide.** UNEB awards on points and divisions rather than fixed
  percentage boundaries, so the mark ranges behind each grade are indicative. A deployment can
  replace the whole table — ask whoever runs your installation about `SCHOOL_GRADING_SCHEMES`.

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

### Integrations — your Moodle and your business system

Most schools already run something. **Settings → Integrations** records where those systems are, so
staff reach them from inside e-School instead of hunting for a bookmark.

**E-Learning.** Enter your Moodle's address and save. An **E-Learning** entry appears in the side
menu and opens Moodle inside the app. Some systems refuse to be shown inside another site — a
sensible thing for them to do, since it is what stops an untrusted page wrapping their login — and
when that happens you get a button that opens it in its own tab instead. Nothing is broken; that is
the system protecting itself.

**Business system.** One of Odoo, ERPNext or Dolibarr. One at a time on purpose: connecting a second
stands the first down, so the menu never shows two and leaves you guessing which one is real.

An API token is optional. If you set one it is encrypted before it is stored, and it never comes
back out — the screen shows only its last four characters, enough to recognise it and not enough to
use it. Saving the address again leaves the stored token alone; to remove it, clear the token box
explicitly and save.

Two things the screen enforces, both about that token:

- **The address must be https.** A token travels on every request, and one sent over plain http can
  be read by anyone on the same network. It is refused when you enter it rather than being quietly
  insecure afterwards.
- **The server needs `SECRETS_KEY` set** to store a token at all. Without it you can still save an
  address, and the screen says so rather than pretending to have saved a credential.

**Test** asks the system whether it is really there and shows what came back — an unreachable
address or an error code, kept against the row so it is still there after a reload.

### Your school's data — backups, export and import

**School Data** in the side menu, for the administrator, head teacher, accountant and bursar. Three
tabs, answering the same worry from different directions.

**Backups** are complete copies of your school's database, taken on the server. Press **Back up
now**, and the backup appears in the list with its size and who took it. **Download** brings it to
your computer.

> Be careful with a downloaded backup. It contains every student record, every payment, and the
> accounts your staff sign in with. Keep it wherever you would keep the paper register — not in a
> shared folder or an email attachment.

**Export** is different, and for a different purpose. A backup is for restoring this school; an
export is a readable copy for a spreadsheet or another system. Choose the tables you want, then CSV
(one file per table, opens in Excel or LibreOffice) or JSON (for another system to read). Credentials
are never exported: no password hashes, and no keys for the services you are connected to.

**Import** reads a JSON export back in. It always checks the file first and tells you what it found
before writing anything — how many rows in each table, and any problems, such as rows with no id
that could not be matched. Only once it is clean will the import button work.

> **Take a backup before an import.** An import writes over records that are already here, matching
> on their id. It is the one thing on this screen that cannot be undone.

Every one of these — taking a backup, downloading one, deleting one, exporting, importing — is
written to the audit trail with who did it and when.

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

What comes back opens in a **text editor**, as readable questions rather than as a machine format.
It is an ordinary document: retype a stem, add or delete an option, change the marks, remove a
question you do not want, or write a new one at the bottom by hand. The toolbar has bold, italic,
headings, bullet and numbered lists and links, with **Undo**/**Redo** and the usual **Ctrl+B** /
**Ctrl+I** shortcuts; **Preview** shows the paper as it reads, and **Ctrl+S** saves.

- **Save to question bank** writes the document back. Questions you edited are updated in place —
  editing does not create a second copy — and anything you added is banked as a new draft. It says
  how many were updated and how many added.
- **Download** takes the document as a Markdown file, and **Copy** puts it on the clipboard, so a
  draft is never trapped in the browser.

Nothing the model wrote is thrown away. If it answers in prose, or in a format that cannot be read
as questions at all, its reply opens in the same editor for you to shape and save, instead of
disappearing into an error message.

Below the editor, every question also appears as a card marked **Awaiting review**, showing its
type, marks, difficulty, Bloom level, assessment objective, the expected answer, the mark-by-mark
scheme, and the syllabus passage behind it. Approve the ones you want; retire the ones you do not.

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

### AI Providers

By default your school uses the platform's AI accounts, and there is nothing to set up. If your
school has its own account — an OpenAI or Anthropic key you pay for, or an Ollama machine on your
own network — enter it here and this school will use it instead. Only this school; no other school
on the platform is affected.

- A key you enter is **stored encrypted and never shown again** — the screen only ever shows the last
  four characters, so there is no way for anyone, including you, to read it back out of the app.
- **Use the platform's** removes your key and hands the school back to the shared account.
- Ollama needs only an address, not a key — point it at your own machine.

> If the screen says the server has no encryption key configured, provider keys cannot be stored at
> all. That is a platform-level setting; ask whoever runs it. You can still set a self-hosted address.

## 8c. Messages

**Messages** in the top navigation is the staff inbox. Colleagues' messages and school events — a
student refused at the gate, an exam admission rejected — share one list, because the bell is one
bell.

- **New messages arrive without refreshing.** The badge on the tab moves the moment someone sends
  one. A small **Live** marker shows the connection is up; if it says *Offline* the app still works
  exactly as before, it just waits until you next open the inbox.
- **Send to one person, a role, a team, or everybody.** Roles are Administrators, Teachers and
  Support staff; teams are designations like *askari* or *bursar*. You never receive your own
  broadcast.
- **Tick urgent** for something that cannot wait — it is marked in the list.
- **Read receipts**: when someone reads your message you see it, without reloading.
- **Online now** lists who is signed in at your school this minute.

Support staff are included — messaging is how the gate and the kitchen get told things.

## 9. Finding things — global search

Press **⌘K** (or **Ctrl+K**) anywhere in the app, or click **Search…** in the top bar. One box
searches across:

- **students** — by name, student number, email, parent name or subject;
- **the curriculum library** — syllabus passages by topic;
- **lesson plans** and **banked exam questions** — find the osmosis question you wrote last term;
- **attendance**, and for administrators **fees** — invoices, receipts and payment references.

Results are grouped by type; pick one to jump to it.

> **You only ever see what your role allows.** A teacher's search never returns fee records, even
> though they are indexed. Support staff have no search at all — they see fee status on their own
> screen. This is enforced on the server, not just hidden in the page.

Search is **typo-tolerant** once an administrator has connected Meilisearch — "Jonson" finds
"Johnson". Until then ⌘K still works, but falls back to a plain student-name match and says so.

**Administrators:** connect it under **Settings → Search & LibreChat**, then press **Rebuild search
index**. Records are indexed as they change; rebuild after a bulk import or if search looks stale.

---

## 10. Using LibreChat with your school data

If your school already runs [LibreChat](https://www.librechat.ai), it can answer questions from your
real records — students, fees, the curriculum, the gradebook — instead of guessing.

LibreChat connects *to* e-School rather than the other way round. Under **Settings → Search &
LibreChat** you will find a configuration block to paste into your `librechat.yaml`, plus the
address of this deployment.

An administrator issues an access token for it. Tokens carry a role, so a token issued for teachers
lets LibreChat see only what a teacher may see — it cannot reach the fee ledger. **Treat tokens like
passwords:** anyone holding one can read whatever that role can read.

> This is one-directional by design. LibreChat is a chat application that talks to AI providers; it
> is not itself something e-School can send messages to, so it does not appear in the model picker.

---

## 11. AI assistant & audit

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

### Saving a conversation

**Export → Printable Report (.pdf)** turns the current conversation into a branded PDF you can file
or hand over. It includes each question and answer, any tables the assistant produced, and — under
each answer — the **sources** it used and which tools it ran, so a printed answer can be checked
rather than taken on trust.

Send at least one message first; there is nothing to report on before that. The plain text, JSON and
CSV exports are still there for when you want the raw transcript.

### Keeping a chat answer

The **Export** button (top right) turns the current conversation into a branded PDF report carrying
the questions, the answers, and the sources and lookups behind each one:

- **Printable Report (.pdf)** — download it to file or hand over.
- **Print Report** — straight to the printer, without leaving the conversation.
- **Email Report…** — send it as a PDF attachment to any address, prefilled with your own. Add a
  short note if you like. The recipient needs no account to read it.

> The report contains whatever student data was discussed, so check the address before sending. If
> your school has not set up email, the app says so rather than pretending it sent.

Plain `.txt`, `.json` and `.csv` exports are still there for anyone who wants the raw text.

**Audit** (admin) shows a history of sensitive actions — billing runs, payments, bursaries, standing
overrides, account approvals, exam publishing, settings changes — each with who did it and when.

---

## 12. For platform operators — onboarding schools

e-School can run many schools from one deployment, each with its **own isolated database**, reached
at its **own subdomain** (`your-school.eschool.ink`).

### The operator's console

If you run the platform, **`/owner`** is your screen. It asks for the operator token set on the
server, then lists every school with its status and paid-to date, and lets you:

- **add a school directly**, with no payment — its subdomain is live immediately, and the first
  account created there becomes its administrator;
- **change a school's status** (active, past due, suspended, pending);
- **run the renewal sweep** by hand.

Nothing in a school's own screens can reach any of this. A school's administrator is an
administrator *of that school*: they cannot see that any other school exists.

> The token lives only in that browser tab — close it and it is gone. It is never saved to the
> browser, so there is nothing on your machine for anything else to read.

### Self-service sign-up

A school signs itself up at the public page **`/signup`** (e.g. `apply.eschool.ink/signup`):

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

Wildcard DNS and a wildcard TLS certificate for the root domain, a control database, subscription
pricing, live payment-provider keys, and (optionally) an email provider for the activation email.
Two secrets matter more than the rest:

- **`SESSION_SECRET`** — without it, everyone is signed out every time the server restarts.
- **`PLATFORM_OWNER_TOKEN`** — without it, `/owner` refuses everything and no school can be created.

Generate each with `openssl rand -hex 32`. The full runbook is in
[DEPLOYMENT.md](DEPLOYMENT.md); the design is in [TECHNICAL_OVERVIEW.md](TECHNICAL_OVERVIEW.md) →
*Multi-Tenancy and Self-Service Provisioning*.

### Running the servers

`./containers.sh` is the helper for all of it — an interactive menu, or direct commands:

```bash
PROXY=nginx ./containers.sh start        # start everything behind nginx, with TLS
PROXY=caddy ./containers.sh start        # or behind Caddy, which manages its own certificate
./containers.sh cert-status              # what certificate is installed and when it expires
./containers.sh cert-issue               # get a wildcard certificate (nginx)
./containers.sh cert-renew               # renew it and reload — safe to run from cron
./containers.sh status                   # what is running
./containers.sh logs                     # follow the logs
```

Every school is a subdomain, so the certificate has to be a **wildcard** (`*.eschool.ink`), and a
wildcard certificate can only be issued if the certificate authority can check a **DNS record** —
so `cert-issue` needs an API token for your domain's DNS. Caddy does the same thing by itself if you
would rather not think about renewals at all.

Once the wildcard is in place, **a new school needs no DNS work**: it is reachable the moment it is
created, at 10pm on a Sunday if that is when someone pays.

### Which database the stack uses

By default the stack brings its own PostgreSQL container — one machine, nothing else to look after.
That is the right choice for a single school on a single VPS.

You can point it at your own database instead: a managed Postgres from a cloud provider, one already
running on the host, or one on another machine. Set the connection in `.env.production` and choose
**option 17** in `./containers.sh`, or set `DB_MODE=external`:

```bash
DATABASE_URL=postgres://schoolapp:secret@db.example.org:5432/school_ai_search
DATABASE_SSL=true
```

For a Postgres running on the host rather than in Docker, use `host.docker.internal` as the host
name — the container is already set up to reach it.

Choosing external stops the bundled container from starting at all. The script checks the connection
before it starts anything, so a wrong address or password fails with a message rather than an app
container that restarts forever saying nothing useful.

`DATABASE_SSL=true` is almost always right for a managed database. Set
`DATABASE_SSL_REJECT_UNAUTHORIZED=false` only for a server presenting a self-signed certificate on a
network you trust — it turns off the check that the certificate belongs to the host you asked for.

### Backups

Backups are written inside the app container to `BACKUP_DIR` (`/var/backups/eschool`), which is a
named Docker volume — so they survive the container being rebuilt or replaced.

They are taken from the app itself, under **School Data**, by an administrator, head teacher,
accountant or bursar. There is nothing to run on the server for a routine backup.

Two things worth knowing:

- **A backup volume is not off-site.** It survives a container being replaced; it does not survive
  the machine being lost. Copy the volume somewhere else on whatever schedule the school's risk
  deserves.
- **A dump contains everything**, including password hashes and the tokens for any MCP servers the
  school has connected. Treat the volume and any downloaded copy as you would the database itself.

Restoring is an operator job on the server, with the ordinary PostgreSQL tools:

```bash
docker compose cp app:/var/backups/eschool/<file>.dump ./restore.dump
pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL" ./restore.dump
```

---

## 13. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| **"Backups cannot be taken on this server"** | The PostgreSQL client tools are missing from the image, or the app is running against an in-memory database. Rebuild the image (`./containers.sh build`) — `pg_dump` ships in it. |
| **A backup is stuck at "In progress"** | The dump was interrupted, usually by the container restarting. Delete that row and take another; a half-written file is deliberately never listed as complete. |
| **An import will not start** | It has not been checked yet, or the check found problems. The button stays off until the file reads cleanly — the list of problems above it says what to fix. |
| **A connected system shows "will not open inside the app"** | That system sends `X-Frame-Options`, refusing to be displayed inside another site. This is normal and is that system protecting its own login. Use the "Open in a new tab" button. |
| **"The stored token can no longer be decrypted"** | `SECRETS_KEY` changed on the server. The old value cannot be recovered; enter the token again under Settings → Integrations. |
| **A token will not save** | `SECRETS_KEY` is not set on the server, so there is nothing to encrypt it with. Set it (`openssl rand -hex 32`) and restart. An address alone still saves without it. |
| **The app will not start against my own Postgres** | Check `DATABASE_URL` is reachable from the container (`host.docker.internal` for a database on the host, not `localhost`), and that `DATABASE_SSL=true` if the server requires TLS — most managed ones do. `./containers.sh` option 17 tests the connection before starting anything. |
| *"Your account is awaiting administrator approval."* | Ask an admin to approve you under **Staff → Pending Approval**. |
| Everyone is signed out whenever the server restarts | `SESSION_SECRET` is not set on the server, so it invents a new signing key each time it starts. Set it (`openssl rand -hex 32`) and restart once more. |
| You are signed out after about half a day | Expected — a session lasts 12 hours and is extended while you are working. Sign in again. |
| A screen says *Unauthorized* even though you are signed in | Your role does not allow it. The server decides this from your account, not from the screen, so changing anything in the browser will not help — ask an administrator. |
| An admin was demoted but still had admin screens | No longer possible: the role is re-read from their account on every request, so a change takes effect on their very next click. |
| The operator console at `/owner` refuses the token | Either `PLATFORM_OWNER_TOKEN` is not set on the server (it fails closed), or the token is wrong. It is also refused if it is shorter than 24 characters. |
| A browser warns the certificate is invalid for `school.eschool.ink` | The certificate is not a wildcard. Run `./containers.sh cert-status` — *Covers* must list `*.eschool.ink`, not just the bare domain. Re-issue with `./containers.sh cert-issue`. |
| Every school shows the same school's data | The reverse proxy is rewriting the `Host` header, so every request looks like the apex. In nginx it must be `proxy_set_header Host $host;` — see `deploy/nginx/`. |
| Uploading a photo or logo fails with a 413 | The proxy's upload limit. `client_max_body_size 25m;` is already in the shipped nginx configs — check yours matches if you wrote your own. |
| A long AI generation ends in a 504 | The proxy's read timeout. The shipped configs use 300s; a 60s default will cut off a local model mid-paper. |
| No Delete button on a staff row | That is your own account — you cannot delete the account you are signed in with. Ask another administrator. |
| *"This is the only administrator account…"* | Promote a second person to Administrator under **Staff**, then delete the first. |
| A staff member cannot sign in after you edited them | Their sign-in email changed. Check it under **Staff → Edit**; that address is what they must use. |
| **Printable Report (.pdf)** says there is nothing to report | Send at least one chat message first — the report is built from the saved conversation. |
| **Admit & Bill** says no fee structure matches | Create an active fee structure for that grade/term under **Finance → Fee Structures** first. |
| A student can't be marked twice for the same day | Expected — attendance keeps one record per day; marking again updates that day. |
| A school's page shows *"subscription has lapsed"* | The subscription is unpaid/suspended — renew from `/signup`. |
| A parent says they paid by MoMo but the balance is unchanged | Open their **statement** — the Gateway Transactions section at the end lists every mobile money and bank attempt, including pending and failed ones, with the reason. |
| "Email is not configured on this deployment" when sending a report | Expected until an administrator sets `EMAIL_MODE` and `EMAIL_API_KEY`. Download or print the report instead. |
| ⌘K search misses a student I know exists | Search may be falling back to plain matching — check **Settings → Search & LibreChat**. If Meilisearch is connected, press **Rebuild search index**. |
| A teacher cannot find an invoice in search | Working as intended — fee records are visible to administrators only. Teachers can still open a single student's statement from their record. |
| LibreChat shows no SchoolBot tools | Check the token in its `SCHOOLBOT_MCP_TOKEN` matches one in the app's `MCP_SERVER_TOKENS`, and that the URL in `librechat.yaml` is reachable from the LibreChat container. |
| Report card / ID card shows the wrong school name or colours | Update **Settings**; documents read the global branding. |
| Report cards grade on the wrong scale | Set the **school level** and **examination system** under **Settings → Branding**. Secondary schools get O-Level and A-Level automatically from each student's class. |
| A report card shows an aggregate but no Division | Not enough subjects are recorded yet — a Division needs eight subjects at UCE, four at PLE. The card says *Provisional* until then. |
| An A-Level student is graded D1–F9 instead of A–F | Their class must be Senior 5 or 6 (grade level 12 or 13). Check the student's grade on their record. |
| Support staff sees only the fees screen | Expected — that role is limited to fee status by design. |
| **Draft this lesson** / **Write questions** is greyed out | Pick a configured AI model in the chat composer first. The **Local Rules** engine searches student records only and cannot write. |
| The **Agent** or **MCP** switch is greyed out | Only the built-in **Local Rules** engine cannot call tools — every real model can. Pick one from the model menu. |
| A local model writes questions as prose instead of filling in the form | They are read back automatically and flagged. Marks and answers may be missing — check each one in the editor before approving. |
| The Digital Examiner's reply does not look like questions | It opens in the editor as the model wrote it. Number each question (`1.`, `2.`) and give it a line of text, then **Save to question bank** — nothing is lost while it sits there. |
| A generated plan or question says the syllabus does not cover something | The curriculum library has nothing on that topic. Upload your scheme of work for it under the curriculum library, then try again. |
| Answers cite IGCSE outlines when you teach the Uganda syllabus | Set the curriculum on the form, and upload your own material — your uploads rank above the bundled outlines for your topics. |
| **Publish** on a paper is refused | Every question on the paper must be approved first. Open the Question Bank and approve the remaining ones. |
| An MCP server shows a connection error | Check the URL and token under **Settings → MCP Servers** and press **Test**. Chat still works without it; the failure is reported alongside the answer. |

---

*Powered by e-School.*
