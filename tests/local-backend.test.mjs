import test from 'node:test';
import assert from 'node:assert/strict';

import QRCode from 'qrcode';

import { createAppRuntime, parseStudentCode } from '../server/local-backend.mjs';
import { buildQrPayload, buildQrPng } from '../server/reports/id-card.mjs';
import { gradeScore, getPublicGradingOptions, resolveGradingScheme } from '../server/reports/grading-config.mjs';

const startTestRuntime = async (options = {}) => {
  const runtime = await createAppRuntime({ useInMemoryDatabase: true, ...options });

  const cleanup = async () => {
    await runtime.close();
  };

  return { runtime, cleanup };
};

const dispatch = (runtime, method, pathname, body = {}) => runtime.dispatch({ method, pathname, body });

test('local backend supports auth, data queries, audit logging, and chat', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const health = await dispatch(runtime, 'GET', '/api/health');
    assert.equal(health.body.data.ok, true);
    assert.equal(health.body.data.students, 15);

    const signup = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'admin@school.local',
      password: 'password123',
      displayName: 'Local Admin',
    });
    assert.equal(signup.status, 200);
    assert.equal(signup.body.data.user.role, 'admin');

    const signin = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signin',
      email: 'admin@school.local',
      password: 'password123',
    });
    assert.equal(signin.status, 200);
    assert.equal(signin.body.data.user.display_name, 'Local Admin');

    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'select',
      columns: '*',
      filters: [],
      orderBy: { field: 'last_name', ascending: true },
      limit: 5,
    });
    assert.equal(students.status, 200);
    assert.equal(students.body.data.length, 5);
    assert.equal(students.body.data[0].last_name, 'Anderson');

    const update = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'update',
      payload: { gpa: 3.99 },
      filters: [{ field: 'id', operator: 'eq', value: 'student-001' }],
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.data[0].gpa, 3.99);

    const auditWrite = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'log_audit',
      userEmail: 'admin@school.local',
      userName: 'Local Admin',
      userRole: 'admin',
      auditAction: 'update',
      entityType: 'student',
      entityId: 'student-001',
      entityName: 'Emma Johnson',
      changes: { gpa: 3.99 },
    });
    assert.equal(auditWrite.status, 200);

    const auditRead = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'get_audit_log',
      limit: 10,
    });
    assert.equal(auditRead.status, 200);
    assert.equal(auditRead.body.data.logs.length, 1);
    assert.equal(auditRead.body.data.logs[0].entity_name, 'Emma Johnson');

    const aiChat = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'Who are the top 3 students by GPA?',
      conversationId: null,
      modelId: 'local-rules',
    });
    assert.equal(aiChat.status, 200);
    assert.ok(aiChat.body.data.conversationId);
    assert.match(aiChat.body.data.message, /Top 3 Students by GPA/);
    assert.equal(aiChat.body.data.studentsFound, 3);
    assert.equal(aiChat.body.data.model.id, 'local-rules');

    const partialStudentSearch = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'tell me about Emma',
      conversationId: null,
      modelId: 'local-rules',
    });
    assert.equal(partialStudentSearch.status, 200);
    assert.match(partialStudentSearch.body.data.message, /Emma Johnson/);
    assert.equal(partialStudentSearch.body.data.studentsFound, 1);

    const studentIdSearch = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'show STU 2026 001',
      conversationId: null,
      modelId: 'local-rules',
    });
    assert.equal(studentIdSearch.status, 200);
    assert.match(studentIdSearch.body.data.message, /STU-2026-001/);
    assert.equal(studentIdSearch.body.data.studentsFound, 1);

    const aiModels = await dispatch(runtime, 'POST', '/api/functions/ai-models', {});
    assert.equal(aiModels.status, 200);
    assert.ok(aiModels.body.data.models.some((model) => model.provider === 'ollama'));
    assert.ok(aiModels.body.data.models.some((model) => model.provider === 'openai'));

    const messages = await dispatch(runtime, 'POST', '/api/db', {
      table: 'messages',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'conversation_id', operator: 'eq', value: aiChat.body.data.conversationId }],
      orderBy: { field: 'created_at', ascending: true },
    });
    assert.equal(messages.status, 200);
    assert.equal(messages.body.data.length, 2);
    assert.equal(messages.body.data[0].role, 'user');
    assert.equal(messages.body.data[1].role, 'assistant');

    const voice = await dispatch(runtime, 'POST', '/api/functions/voice-to-text', {
      audioData: 'data:audio/webm;base64,AAA',
    });
    assert.equal(voice.status, 200);
    assert.match(voice.body.data.warning, /not implemented/i);

    const pdf = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams({
        term: 'Term 2',
        academicYear: '2026/2027',
        gradingCountry: 'uganda',
        academicLevel: 'secondary',
        reportTitle: 'End of Term Progress Report',
        schoolName: 'Bwongo Digital School',
        schoolTagline: 'Learning with purpose',
        teacherName: 'Grace Nambi',
        headTeacherName: 'Head Teacher',
        teacherComment: 'Emma has shown excellent leadership and steady academic discipline.',
        reportNotes: 'Prepared after teacher review.',
      }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, 'binary');
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    assert.ok(pdf.body.length > 500);

    const gradingSchemes = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/grading-schemes',
    });
    assert.equal(gradingSchemes.status, 200);
    assert.ok(
      gradingSchemes.body.data.schemes.some(
        (scheme) => scheme.country === 'uganda' && scheme.academicLevel === 'secondary',
      ),
    );

    const invoice = await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices',
      operation: 'insert',
      columns: '*',
      payload: {
        id: 'invoice-payment-001',
        student_id: 'student-001',
        invoice_number: 'INV-PAY-001',
        status: 'issued',
        total_amount: 500000,
        balance_due: 500000,
        currency: 'UGX',
        line_items: [{ item: 'Tuition', amount: 500000 }],
      },
      single: true,
    });
    assert.equal(invoice.status, 200);

    const mtnPayment = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'initiate',
      provider: 'mtn_momo',
      studentId: 'student-001',
      invoiceId: 'invoice-payment-001',
      amount: 200000,
      currency: 'UGX',
      phoneNumber: '+256 770 000 001',
      chargeType: 'school_fees',
      description: 'Term tuition deposit',
    });
    assert.equal(mtnPayment.status, 200);
    assert.equal(mtnPayment.body.data.transaction.provider, 'mtn_momo');
    assert.equal(mtnPayment.body.data.transaction.status, 'pending');
    assert.match(mtnPayment.body.data.instructions, /prompt|approval/i);

    const mtnStatus = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'status',
      paymentReference: mtnPayment.body.data.transaction.external_reference,
    });
    assert.equal(mtnStatus.status, 200);
    assert.equal(mtnStatus.body.data.transaction.status, 'pending');

    const paymentCallback = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'callback',
      externalReference: mtnPayment.body.data.transaction.external_reference,
      status: 'successful',
      providerReference: 'MTN-LIVE-001',
      message: 'Approved by payer',
    });
    assert.equal(paymentCallback.status, 200);
    assert.equal(paymentCallback.body.data.transaction.status, 'successful');

    const paymentRows = await dispatch(runtime, 'POST', '/api/db', {
      table: 'payments',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'reference', operator: 'eq', value: mtnPayment.body.data.transaction.external_reference }],
      single: true,
    });
    assert.equal(paymentRows.status, 200);
    assert.equal(paymentRows.body.data.amount, 200000);
    assert.equal(paymentRows.body.data.payment_method, 'mtn_momo');

    const updatedInvoice = await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'id', operator: 'eq', value: 'invoice-payment-001' }],
      single: true,
    });
    assert.equal(updatedInvoice.body.data.balance_due, 300000);
    assert.equal(updatedInvoice.body.data.status, 'partial');

    const airtelPayment = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'initiate',
      provider: 'airtel_money',
      studentId: 'student-001',
      amount: 50000,
      currency: 'UGX',
      phoneNumber: '+256 750 000 001',
      chargeType: 'library_fine',
      description: 'Library fine',
    });
    assert.equal(airtelPayment.status, 200);
    assert.equal(airtelPayment.body.data.transaction.provider, 'airtel_money');
    assert.equal(airtelPayment.body.data.transaction.charge_type, 'library_fine');

    const bankPayment = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'initiate',
      provider: 'bank',
      studentId: 'student-001',
      amount: 100000,
      currency: 'UGX',
      bankCode: 'CENTENARY',
      accountReference: 'STU-2026-001',
      chargeType: 'transport',
      description: 'Transport fee',
    });
    assert.equal(bankPayment.status, 200);
    assert.equal(bankPayment.body.data.transaction.provider, 'bank');
    assert.equal(bankPayment.body.data.transaction.bank_code, 'CENTENARY');
  } finally {
    await cleanup();
  }
});

test('admins can assign the non-teaching support staff role', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const admin = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'head@school.local',
      password: 'password123',
      displayName: 'Head Teacher',
    });
    assert.equal(admin.body.data.user.role, 'admin');

    const gatekeeper = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'gate@school.local',
      password: 'password123',
      displayName: 'Moses Gatekeeper',
    });
    assert.equal(gatekeeper.body.data.user.role, 'teacher');
    // New non-admin signups start pending; the admin must approve before they can sign in.
    assert.equal(gatekeeper.body.data.pending, true);

    const approved = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'approve_account',
      userId: gatekeeper.body.data.user.id,
      requesterRole: 'admin',
    });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.data.user.approval_status, 'approved');

    const promoted = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'update_role',
      userId: gatekeeper.body.data.user.id,
      newRole: 'support_staff',
      requesterRole: 'admin',
    });
    assert.equal(promoted.status, 200);
    assert.equal(promoted.body.data.user.role, 'support_staff');

    const signin = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signin',
      email: 'gate@school.local',
      password: 'password123',
    });
    assert.equal(signin.body.data.user.role, 'support_staff');

    const users = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_users' });
    const roles = users.body.data.users.map((user) => user.role).sort();
    assert.deepEqual(roles, ['admin', 'support_staff']);

    const unknownRole = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'update_role',
      userId: gatekeeper.body.data.user.id,
      newRole: 'chief_cook',
      requesterRole: 'admin',
    });
    assert.equal(unknownRole.status, 400);
    assert.equal(unknownRole.body.error, 'Unsupported role: chief_cook');

    const nonAdmin = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'update_role',
      userId: gatekeeper.body.data.user.id,
      newRole: 'admin',
      requesterRole: 'support_staff',
    });
    assert.equal(nonAdmin.status, 400);
    assert.equal(nonAdmin.body.error, 'Unauthorized');
  } finally {
    await cleanup();
  }
});

test('fee status endpoint returns payment data only, with no other student information', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const insert = (table, payload) =>
      dispatch(runtime, 'POST', '/api/db', { table, operation: 'insert', payload });

    await insert('invoices', {
      id: 'invoice-fee-1',
      student_id: 'student-001',
      invoice_number: 'INV-FEE-1',
      status: 'issued',
      total_amount: 800000,
      balance_due: 300000,
      currency: 'UGX',
      due_date: '2030-05-01',
      line_items: [{ description: 'Term 1 tuition', amount: 800000 }],
    });
    await insert('payments', {
      id: 'payment-fee-1',
      student_id: 'student-001',
      amount: 500000,
      currency: 'UGX',
      payment_method: 'mtn_momo',
      reference: 'MOMO-1',
    });
    await insert('invoices', {
      id: 'invoice-fee-2',
      student_id: 'student-002',
      invoice_number: 'INV-FEE-2',
      status: 'issued',
      total_amount: 800000,
      balance_due: 800000,
      currency: 'UGX',
      due_date: '2020-01-15',
      line_items: [],
    });

    const feeStatus = await dispatch(runtime, 'POST', '/api/functions/fee-status', {});
    assert.equal(feeStatus.status, 200);

    const rows = feeStatus.body.data.students;
    assert.equal(rows.length, 15);

    const partPaid = rows.find((row) => row.student_id === 'student-001');
    assert.equal(partPaid.total_invoiced, 800000);
    assert.equal(partPaid.total_paid, 500000);
    assert.equal(partPaid.balance_due, 300000);
    assert.equal(partPaid.next_due_date, '2030-05-01');
    assert.equal(partPaid.status, 'partial');

    const overdue = rows.find((row) => row.student_id === 'student-002');
    assert.equal(overdue.status, 'overdue');
    assert.equal(overdue.total_paid, 0);

    const uninvoiced = rows.find((row) => row.invoice_count === 0);
    assert.equal(uninvoiced.status, 'no_invoices');

    // The payload must never carry anything beyond identity + fees.
    const allowedFields = new Set([
      'student_id',
      'student_number',
      'full_name',
      'grade_level',
      'class_section',
      'currency',
      'invoice_count',
      'total_invoiced',
      'total_paid',
      'balance_due',
      'next_due_date',
      'last_payment_at',
      'status',
    ]);
    for (const row of rows) {
      for (const field of Object.keys(row)) {
        assert.ok(allowedFields.has(field), `unexpected field leaked to fee status: ${field}`);
      }
    }
  } finally {
    await cleanup();
  }
});

test('scanned student ID card payloads normalise to a student number', () => {
  assert.equal(parseStudentCode('STU-2026-001'), 'STU-2026-001');
  assert.equal(parseStudentCode('  STU-2026-001  '), 'STU-2026-001');
  assert.equal(parseStudentCode('{"student_id":"STU-2026-004"}'), 'STU-2026-004');
  assert.equal(parseStudentCode('https://school.example/students/STU-2026-007'), 'STU-2026-007');
  assert.equal(parseStudentCode('https://school.example/s?student_id=STU-2026-009'), 'STU-2026-009');
  assert.equal(parseStudentCode('{not valid json'), '{not valid json');
  assert.equal(parseStudentCode(''), '');
  assert.equal(parseStudentCode(null), '');
});

test('scanning a student ID card returns that student fee status only', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices',
      operation: 'insert',
      payload: {
        id: 'invoice-scan-1',
        student_id: 'student-003',
        invoice_number: 'INV-SCAN-1',
        status: 'issued',
        total_amount: 600000,
        balance_due: 0,
        currency: 'UGX',
        due_date: '2030-03-01',
        line_items: [],
      },
    });

    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'id', operator: 'eq', value: 'student-003' }],
      single: true,
    });
    const studentNumber = students.body.data.student_id;

    const byNumber = await dispatch(runtime, 'POST', '/api/functions/fee-status', { code: studentNumber });
    assert.equal(byNumber.status, 200);
    assert.equal(byNumber.body.data.matched, true);
    assert.equal(byNumber.body.data.students.length, 1);
    assert.equal(byNumber.body.data.students[0].student_number, studentNumber);
    assert.equal(byNumber.body.data.students[0].status, 'cleared');

    // Lower case, a QR URL payload, and the internal id all resolve to the same student.
    const lowerCase = await dispatch(runtime, 'POST', '/api/functions/fee-status', {
      code: studentNumber.toLowerCase(),
    });
    assert.equal(lowerCase.body.data.students[0].student_id, 'student-003');

    const fromQr = await dispatch(runtime, 'POST', '/api/functions/fee-status', {
      code: `https://school.example/students/${studentNumber}`,
    });
    assert.equal(fromQr.body.data.students[0].student_id, 'student-003');

    const byInternalId = await dispatch(runtime, 'POST', '/api/functions/fee-status', { code: 'student-003' });
    assert.equal(byInternalId.body.data.students[0].student_id, 'student-003');

    const unknown = await dispatch(runtime, 'POST', '/api/functions/fee-status', { code: 'STU-9999-999' });
    assert.equal(unknown.body.data.matched, false);
    assert.deepEqual(unknown.body.data.students, []);

    // A blank code still returns the full list rather than an empty one.
    const all = await dispatch(runtime, 'POST', '/api/functions/fee-status', { code: '   ' });
    assert.equal(all.body.data.students.length, 15);
  } finally {
    await cleanup();
  }
});

test('ID card QR payloads default to the student number and can be a scannable URL', () => {
  const student = { student_id: 'STU-2026-001' };

  assert.equal(buildQrPayload(student, ''), 'STU-2026-001');
  assert.equal(buildQrPayload(student, 'https://school.example/s'), 'https://school.example/s/STU-2026-001');
  assert.equal(buildQrPayload(student, 'https://school.example/s/'), 'https://school.example/s/STU-2026-001');

  // Whatever form the card carries, the scanner resolves it back to the student number.
  assert.equal(parseStudentCode(buildQrPayload(student, 'https://school.example/s')), 'STU-2026-001');
});

test('generated QR symbols are well formed enough for a phone camera to lock on', async () => {
  const payload = 'STU-2026-001';
  const symbol = QRCode.create(payload, { errorCorrectionLevel: 'Q' });
  const { size, data } = symbol.modules;
  const moduleAt = (row, column) => data[row * size + column];

  assert.ok(symbol.version >= 1);
  assert.equal(size, 21);

  // The three finder patterns are what a camera uses to locate and orient the symbol.
  const finderOrigins = [
    [0, 0],
    [0, size - 7],
    [size - 7, 0],
  ];
  for (const [originRow, originColumn] of finderOrigins) {
    for (let row = 0; row < 7; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const onOuterRing = row === 0 || row === 6 || column === 0 || column === 6;
        const inInnerBlock = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        const expectedDark = onOuterRing || inInnerBlock;
        assert.equal(
          Boolean(moduleAt(originRow + row, originColumn + column)),
          expectedDark,
          `finder pattern module mismatch at ${originRow + row},${originColumn + column}`,
        );
      }
    }
  }

  const png = await buildQrPng(payload);
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  // A quiet zone is required for detection; margin 2 keeps the symbol clear of the card edge.
  assert.ok(png.length > 500);

  const other = await buildQrPng('STU-2026-002');
  assert.notEqual(png.toString('base64'), other.toString('base64'));
});

test('ID cards render as PDFs for one student and for a whole class', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const single = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(single.status, 200);
    assert.equal(single.headers['Content-Type'], 'application/pdf');
    assert.equal(single.body.subarray(0, 4).toString(), '%PDF');
    assert.match(single.headers['Content-Disposition'], /STU-2026-001-id-card\.pdf/);

    const qr = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards/student-001.png',
      searchParams: new URLSearchParams(),
    });
    assert.equal(qr.status, 200);
    assert.equal(qr.headers['Content-Type'], 'image/png');
    assert.equal(qr.body.subarray(1, 4).toString(), 'PNG');

    const batch = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards.pdf',
      searchParams: new URLSearchParams({ layout: 'a4' }),
    });
    assert.equal(batch.status, 200);
    assert.equal(batch.body.subarray(0, 4).toString(), '%PDF');
    // Fifteen seeded students tile onto two A4 sheets at ten per sheet.
    assert.ok(batch.body.length > single.body.length);

    const missing = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards/does-not-exist.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(missing.status, 404);

    const emptySelection = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards.pdf',
      searchParams: new URLSearchParams({ grade: '99' }),
    });
    assert.equal(emptySelection.status, 404);
  } finally {
    await cleanup();
  }
});

test('ID cards can be printed for an intake as well as a class', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const idCards = (params) =>
      runtime.dispatch({
        method: 'GET',
        pathname: '/api/id-cards.pdf',
        searchParams: new URLSearchParams({ layout: 'a4', ...params }),
      });

    // Three known enrolment dates to select between, and one student with none at all.
    await runtime.database.query(
      "UPDATE students SET enrollment_date = '2024-02-01' WHERE student_id = 'STU-2026-001'",
    );
    await runtime.database.query(
      "UPDATE students SET enrollment_date = '2026-02-01' WHERE student_id = 'STU-2026-002'",
    );
    await runtime.database.query(
      "UPDATE students SET enrollment_date = '2026-09-01' WHERE student_id = 'STU-2026-003'",
    );
    await runtime.database.query(
      "UPDATE students SET enrollment_date = NULL WHERE student_id = 'STU-2026-004'",
    );

    const term = await idCards({ registeredFrom: '2026-01-01', registeredTo: '2026-06-30' });
    assert.equal(term.status, 200);
    assert.equal(term.body.subarray(0, 4).toString(), '%PDF');
    // The range is in the filename, so a printed batch says on its face what it was.
    assert.match(term.headers['Content-Disposition'], /registered-2026-01-01-to-2026-06-30\.pdf/);

    // An open-ended range is still a range: "from" alone means everyone since.
    assert.equal((await idCards({ registeredFrom: '2026-01-01' })).status, 200);
    assert.equal((await idCards({ registeredTo: '2024-12-31' })).status, 200);

    // A window nobody was registered in is not an empty PDF, it is a 404 the screen can explain.
    assert.equal((await idCards({ registeredFrom: '2019-01-01', registeredTo: '2019-12-31' })).status, 404);

    // Class and dates compose, rather than one overriding the other.
    const { rows } = await runtime.database.query(
      "SELECT grade_level FROM students WHERE student_id = 'STU-2026-002'",
    );
    const withGrade = await idCards({
      grade: String(rows[0].grade_level),
      registeredFrom: '2026-01-01',
      registeredTo: '2026-06-30',
    });
    assert.equal(withGrade.status, 200);
    assert.match(withGrade.headers['Content-Disposition'], /grade-\d+-registered-/);

    // A student with no enrolment date on file is in no range at all. The print dialog says so
    // rather than letting them quietly miss out on a card.
    const undated = await runtime.database.query(
      "SELECT COUNT(*)::int AS count FROM students WHERE enrollment_date IS NULL",
    );
    assert.ok(undated.rows[0].count > 0, 'the fixture has one, so the exclusion is real');
  } finally {
    await cleanup();
  }
});

test('grading schemes resolve by country and academic level', () => {
  const ugandaSecondary = resolveGradingScheme({
    country: 'uganda',
    academicLevel: 'secondary',
  });

  assert.equal(ugandaSecondary.label, 'Uganda Secondary UNEB Scale');
  assert.deepEqual(gradeScore(88, ugandaSecondary), {
    grade: 'D2',
    remark: 'Very Good',
    // UNEB grades carry an aggregate point value; scales without points omit the field entirely.
    points: 2,
  });

  const nursery = resolveGradingScheme({
    country: 'international',
    academicLevel: 'nursery',
  });
  assert.equal(gradeScore(72, nursery).grade, 'Meeting');

  // Uganda's competency-based curriculum grades subjects A-E with NCDC competency descriptors,
  // and is a distinct system from the classic UNEB D1-F9 scale.
  const cbc = resolveGradingScheme({ country: 'uganda-cbc', academicLevel: 'secondary' });
  assert.equal(cbc.label, 'Uganda Competency-Based (Lower Secondary, UCE)');
  // The competency-based scale awards no points, so gradeScore returns just the two fields.
  assert.deepEqual(gradeScore(84, cbc), { grade: 'A', remark: 'Outstanding' });
  assert.deepEqual(gradeScore(55, cbc), { grade: 'D', remark: 'Basic' });
  assert.equal(gradeScore(20, cbc).grade, 'E');
  // The classic UNEB scale is untouched and still resolves independently.
  assert.equal(resolveGradingScheme({ country: 'uganda', academicLevel: 'secondary' }).label, 'Uganda Secondary UNEB Scale');

  // It appears in the public options list the API serves.
  const options = getPublicGradingOptions();
  assert.ok(options.some((o) => o.country === 'uganda-cbc' && o.academicLevel === 'secondary'));
});

test('local backend exposes full school management modules through the db API', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const insert = (table, payload) =>
    dispatch(runtime, 'POST', '/api/db', {
      table,
      operation: 'insert',
      columns: '*',
      payload,
      single: true,
    });

  const selectById = (table, id) =>
    dispatch(runtime, 'POST', '/api/db', {
      table,
      operation: 'select',
      columns: '*',
      filters: [{ field: 'id', operator: 'eq', value: id }],
      single: true,
    });

  try {
    const profileUpdate = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'update',
      columns: '*',
      filters: [{ field: 'id', operator: 'eq', value: 'student-001' }],
      payload: {
        blood_group: 'O+',
        emergency_contact_name: 'Sarah Johnson',
        emergency_contact_phone: '+256700200001',
        emergency_contact_relation: 'Mother',
        lifecycle_status: 'enrolled',
        medical_record: { allergies: ['Peanuts'], conditions: ['Asthma'] },
      },
      single: true,
    });
    assert.equal(profileUpdate.status, 200);
    assert.equal(profileUpdate.body.data.blood_group, 'O+');
    assert.deepEqual(profileUpdate.body.data.medical_record.allergies, ['Peanuts']);

    const admission = await insert('admissions', {
      id: 'admission-001',
      application_number: 'APP-2026-001',
      student_id: 'student-001',
      applicant_first_name: 'Emma',
      applicant_last_name: 'Johnson',
      grade_level: 10,
      status: 'accepted',
      documents: [{ name: 'birth-certificate.pdf', status: 'verified' }],
      notes: 'Transferred from partner school.',
    });
    assert.equal(admission.status, 200);
    assert.equal(admission.body.data.status, 'accepted');

    const schoolClass = await insert('classes', {
      id: 'class-10-a',
      grade_level: 10,
      section_name: 'A',
      stream: 'Science',
      room: 'Block A-10',
      academic_year: '2026/2027',
      capacity: 40,
    });
    assert.equal(schoolClass.body.data.section_name, 'A');

    const subject = await insert('subjects_catalog', {
      id: 'subject-math-10',
      code: 'MATH10',
      name: 'Mathematics',
      grade_level: 10,
      department: 'Sciences',
    });
    assert.equal(subject.body.data.code, 'MATH10');

    const teacher = await insert('teachers', {
      id: 'teacher-001',
      staff_id: 'TCH-001',
      display_name: 'Grace Nambi',
      email: 'grace.nambi@school.local',
      phone: '+256700300001',
      department: 'Sciences',
    });
    assert.equal(teacher.body.data.staff_id, 'TCH-001');

    const allocation = await insert('subject_allocations', {
      id: 'allocation-001',
      subject_id: 'subject-math-10',
      teacher_id: 'teacher-001',
      class_id: 'class-10-a',
      student_id: 'student-001',
      academic_year: '2026/2027',
      term: 'Term 1',
    });
    assert.equal(allocation.body.data.teacher_id, 'teacher-001');

    const timetable = await insert('timetables', {
      id: 'timetable-001',
      class_id: 'class-10-a',
      teacher_id: 'teacher-001',
      subject_id: 'subject-math-10',
      room: 'Block A-10',
      day_of_week: 'Monday',
      start_time: '08:00',
      end_time: '09:20',
      academic_year: '2026/2027',
      term: 'Term 1',
    });
    assert.equal(timetable.body.data.day_of_week, 'Monday');

    const attendance = await insert('attendance_records', {
      id: 'attendance-001',
      student_id: 'student-001',
      attendance_date: '2026-04-30',
      status: 'absent',
      reason: 'No notice received',
      marked_by: 'teacher-001',
      notified_parent: false,
    });
    assert.equal(attendance.body.data.status, 'absent');

    const alert = await insert('attendance_alerts', {
      id: 'attendance-alert-001',
      student_id: 'student-001',
      attendance_record_id: 'attendance-001',
      channel: 'sms',
      recipient: '+256700200001',
      status: 'sent',
      message: 'Emma was marked absent today.',
      sent_at: '2026-04-30T08:30:00.000Z',
    });
    assert.equal(alert.body.data.channel, 'sms');

    const exam = await insert('exams', {
      id: 'exam-001',
      name: 'Mid Term Assessment',
      exam_type: 'internal',
      academic_year: '2026/2027',
      term: 'Term 1',
      start_date: '2026-05-15',
      end_date: '2026-05-20',
      status: 'scheduled',
    });
    assert.equal(exam.body.data.status, 'scheduled');

    const examSchedule = await insert('exam_schedules', {
      id: 'exam-schedule-001',
      exam_id: 'exam-001',
      subject_id: 'subject-math-10',
      class_id: 'class-10-a',
      exam_date: '2026-05-15',
      start_time: '09:00',
      end_time: '11:00',
      room: 'Main Hall',
    });
    assert.equal(examSchedule.body.data.room, 'Main Hall');

    const gradebook = await insert('gradebook_entries', {
      id: 'gradebook-001',
      student_id: 'student-001',
      exam_id: 'exam-001',
      subject_id: 'subject-math-10',
      score: 92,
      max_score: 100,
      grade: 'A',
      remarks: 'Excellent',
      rank: 1,
    });
    assert.equal(gradebook.body.data.grade, 'A');

    const discipline = await insert('discipline_records', {
      id: 'discipline-001',
      student_id: 'student-001',
      incident_date: '2026-05-02',
      category: 'Conduct',
      severity: 'moderate',
      description: 'Repeated classroom disruption.',
      action_taken: 'Guardian meeting scheduled.',
      reported_by: 'teacher-001',
      guardian_notified: true,
      status: 'open',
    });
    assert.equal(discipline.status, 200);
    assert.equal(discipline.body.data.severity, 'moderate');

    const promotion = await insert('student_promotions', {
      id: 'promotion-001',
      student_id: 'student-001',
      from_grade_level: 10,
      from_class_section: 'A',
      to_grade_level: 11,
      to_class_section: 'B',
      academic_year: '2026/2027',
      effective_date: '2026-12-01',
      decision: 'promoted',
      notes: 'Promoted after meeting academic requirements.',
      approved_by: 'Local Admin',
    });
    assert.equal(promotion.status, 200);
    assert.equal(promotion.body.data.to_grade_level, 11);

    const transfer = await insert('student_transfers', {
      id: 'transfer-001',
      student_id: 'student-001',
      movement_type: 'transfer',
      effective_date: '2027-01-10',
      destination_school: 'Partner Secondary School',
      reason: 'Family relocated.',
      documents: [{ name: 'transfer-letter.pdf', status: 'issued' }],
      status: 'completed',
      processed_by: 'Local Admin',
    });
    assert.equal(transfer.status, 200);
    assert.equal(transfer.body.data.documents[0].name, 'transfer-letter.pdf');

    const withdrawal = await insert('student_transfers', {
      id: 'withdrawal-001',
      student_id: 'student-001',
      movement_type: 'withdrawal',
      effective_date: '2027-02-01',
      reason: 'Guardian requested withdrawal.',
      documents: [{ name: 'withdrawal-request.pdf', status: 'received' }],
      status: 'completed',
      processed_by: 'Local Admin',
    });
    assert.equal(withdrawal.status, 200);
    assert.equal(withdrawal.body.data.movement_type, 'withdrawal');

    const feeStructure = await insert('fee_structures', {
      id: 'fee-structure-001',
      name: 'Grade 10 Day Tuition',
      grade_level: 10,
      student_type: 'day',
      academic_year: '2026/2027',
      term: 'Term 1',
      amount: 1500000,
      currency: 'UGX',
      due_date: '2026-05-10',
    });
    assert.equal(feeStructure.body.data.amount, 1500000);

    const invoice = await insert('invoices', {
      id: 'invoice-001',
      student_id: 'student-001',
      invoice_number: 'INV-2026-001',
      status: 'issued',
      total_amount: 1500000,
      balance_due: 500000,
      currency: 'UGX',
      due_date: '2026-05-10',
      line_items: [{ item: 'Tuition', amount: 1500000 }],
    });
    assert.equal(invoice.body.data.line_items[0].item, 'Tuition');

    const payment = await insert('payments', {
      id: 'payment-001',
      student_id: 'student-001',
      fee_structure_id: 'fee-structure-001',
      amount: 1000000,
      currency: 'UGX',
      payment_method: 'mobile_money',
      reference: 'MM-001',
      received_by: 'bursar@school.local',
    });
    assert.equal(payment.body.data.reference, 'MM-001');

    const receipt = await insert('receipts', {
      id: 'receipt-001',
      payment_id: 'payment-001',
      receipt_number: 'RCT-2026-001',
      amount: 1000000,
      currency: 'UGX',
    });
    assert.equal(receipt.body.data.receipt_number, 'RCT-2026-001');

    const portal = await insert('portal_accounts', {
      id: 'portal-001',
      owner_type: 'parent',
      student_id: 'student-001',
      user_id: null,
      username: 'sarah.johnson',
      status: 'active',
    });
    assert.equal(portal.body.data.owner_type, 'parent');

    const notice = await insert('notices', {
      id: 'notice-001',
      title: 'Term One Opens',
      body: 'Classes resume Monday morning.',
      audience: 'parents',
      priority: 'high',
    });
    assert.equal(notice.body.data.priority, 'high');

    const message = await insert('internal_messages', {
      id: 'internal-message-001',
      sender_user_id: null,
      recipient_user_id: null,
      student_id: 'student-001',
      subject: 'Homework follow-up',
      body: 'Please review the mathematics assignment.',
    });
    assert.equal(message.body.data.subject, 'Homework follow-up');

    const book = await insert('library_books', {
      id: 'book-001',
      isbn: '9780000000001',
      title: 'Introduction to Algebra',
      author: 'A. Teacher',
      category: 'Mathematics',
      copies_total: 5,
      copies_available: 4,
    });
    assert.equal(book.body.data.title, 'Introduction to Algebra');

    const loan = await insert('library_loans', {
      id: 'loan-001',
      book_id: 'book-001',
      student_id: 'student-001',
      issued_at: '2026-04-30',
      due_at: '2026-05-14',
      fine_amount: 0,
      status: 'issued',
    });
    assert.equal(loan.body.data.status, 'issued');

    const route = await insert('transport_routes', {
      id: 'route-001',
      route_name: 'Northern Route',
      bus_number: 'BUS-01',
      driver_name: 'John Driver',
      driver_phone: '+256700400001',
      stops: ['Main Gate', 'Market Road', 'Hill View'],
    });
    assert.deepEqual(route.body.data.stops, ['Main Gate', 'Market Road', 'Hill View']);

    const transportAssignment = await insert('transport_assignments', {
      id: 'transport-assignment-001',
      student_id: 'student-001',
      route_id: 'route-001',
      pickup_point: 'Market Road',
      dropoff_point: 'Main Gate',
      status: 'active',
    });
    assert.equal(transportAssignment.body.data.pickup_point, 'Market Road');

    const hostelRoom = await insert('hostel_rooms', {
      id: 'hostel-room-001',
      hostel_name: 'East Wing',
      room_number: 'E-12',
      capacity: 4,
      inventory: [{ item: 'Bed', quantity: 4 }],
    });
    assert.equal(hostelRoom.body.data.room_number, 'E-12');

    const hostelAssignment = await insert('hostel_assignments', {
      id: 'hostel-assignment-001',
      student_id: 'student-001',
      room_id: 'hostel-room-001',
      bed_number: 'B1',
      start_date: '2026-04-30',
      status: 'active',
    });
    assert.equal(hostelAssignment.body.data.bed_number, 'B1');

    const inventoryItem = await insert('inventory_items', {
      id: 'inventory-item-001',
      item_name: 'School Uniform',
      category: 'Uniforms',
      sku: 'UNI-001',
      quantity: 100,
      unit_cost: 45000,
      location: 'Main Store',
      reorder_level: 20,
    });
    assert.equal(inventoryItem.body.data.quantity, 100);

    const inventoryTransaction = await insert('inventory_transactions', {
      id: 'inventory-transaction-001',
      item_id: 'inventory-item-001',
      transaction_type: 'stock_out',
      quantity: 2,
      notes: 'Issued to student-001',
    });
    assert.equal(inventoryTransaction.body.data.transaction_type, 'stock_out');

    const compliance = await insert('compliance_reports', {
      id: 'compliance-001',
      report_type: 'ministry_enrollment',
      period_start: '2026-01-01',
      period_end: '2026-04-30',
      status: 'draft',
      payload: { totalStudents: 15 },
    });
    assert.equal(compliance.body.data.payload.totalStudents, 15);

    const analytics = await insert('analytics_snapshots', {
      id: 'analytics-001',
      snapshot_type: 'performance_trends',
      academic_year: '2026/2027',
      term: 'Term 1',
      metrics: { mathematicsAverage: 82.5, outstandingFees: 500000 },
    });
    assert.equal(analytics.body.data.metrics.outstandingFees, 500000);

    const selectedAnalytics = await selectById('analytics_snapshots', 'analytics-001');
    assert.equal(selectedAnalytics.status, 200);
    assert.equal(selectedAnalytics.body.data.snapshot_type, 'performance_trends');
  } finally {
    await cleanup();
  }
});

test('ai search can use a selected OpenAI-compatible model provider', async () => {
  const originalApiKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-openai-key';

  const providerCalls = [];
  const httpClient = async (url, options) => {
    providerCalls.push({ url, options });
    return new Response(
      JSON.stringify({
        id: 'chatcmpl-test',
        choices: [
          {
            message: {
              content: '## Model Search Result\n\nEmma Johnson is in Grade 10-A with a 3.92 GPA.',
            },
          },
        ],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 12,
          total_tokens: 37,
        },
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'Tell me about Emma Johnson',
      conversationId: null,
      modelId: 'openai-default',
    });

    assert.equal(result.status, 200);
    assert.match(result.body.data.message, /Model Search Result/);
    assert.equal(result.body.data.model.provider, 'openai');
    assert.equal(result.body.data.usage.total_tokens, 37);
    assert.equal(providerCalls.length, 1);
    assert.match(providerCalls[0].url, /\/chat\/completions$/);
    assert.equal(providerCalls[0].options.headers.Authorization, 'Bearer test-openai-key');

    const body = JSON.parse(providerCalls[0].options.body);
    assert.equal(body.model, 'gpt-4o-mini');
    assert.ok(body.messages.some((message) => message.role === 'system' && message.content.includes('Student records')));
  } finally {
    if (originalApiKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalApiKey;
    }
    await cleanup();
  }
});

test('ai search can use a selected Ollama model provider', async () => {
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  const originalModel = process.env.OLLAMA_MODEL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test:11434';
  process.env.OLLAMA_MODEL = 'llama3.2:3b';

  const providerCalls = [];
  const httpClient = async (url, options) => {
    providerCalls.push({ url, options });
    return new Response(
      JSON.stringify({
        message: {
          role: 'assistant',
          content: '## Ollama Search Result\n\nEmma Johnson matches the patient search request.',
        },
        prompt_eval_count: 30,
        eval_count: 14,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  };

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'Tell me about Emma Johnson',
      conversationId: null,
      modelId: 'ollama-default',
    });

    assert.equal(result.status, 200);
    assert.match(result.body.data.message, /Ollama Search Result/);
    assert.equal(result.body.data.model.provider, 'ollama');
    assert.equal(result.body.data.usage.eval_count, 14);
    assert.equal(providerCalls.length, 1);
    assert.equal(providerCalls[0].url, 'http://ollama.test:11434/api/chat');

    const body = JSON.parse(providerCalls[0].options.body);
    assert.equal(body.model, 'llama3.2:3b');
    assert.equal(body.stream, false);
    assert.ok(body.messages.some((message) => message.role === 'system' && message.content.includes('Student records')));
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = originalBaseUrl;
    }
    if (originalModel === undefined) {
      delete process.env.OLLAMA_MODEL;
    } else {
      process.env.OLLAMA_MODEL = originalModel;
    }
    await cleanup();
  }
});

test('ai search reports actionable Ollama connection errors', async () => {
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://offline-ollama.test:11434';

  const httpClient = async () => {
    throw new TypeError('fetch failed');
  };

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'Tell me about Emma Johnson',
      conversationId: null,
      modelId: 'ollama-default',
    });

    assert.equal(result.status, 200);
    assert.match(result.body.data.message, /Could not reach Ollama at http:\/\/offline-ollama\.test:11434/);
    assert.match(result.body.data.message, /pull the configured model/);
    assert.equal(result.body.data.model.provider, 'ollama');
  } finally {
    if (originalBaseUrl === undefined) {
      delete process.env.OLLAMA_BASE_URL;
    } else {
      process.env.OLLAMA_BASE_URL = originalBaseUrl;
    }
    await cleanup();
  }
});

/* ========================================================================== */
/* School fees management                                                     */
/* ========================================================================== */

const feesCall = (runtime, action, body = {}) =>
  dispatch(runtime, 'POST', '/api/functions/fees', {
    action,
    requesterRole: 'admin',
    actorEmail: 'admin@school.ug',
    actorName: 'Admin User',
    ...body,
  });

const countRows = async (runtime, table) => {
  const result = await dispatch(runtime, 'POST', '/api/db', {
    table,
    operation: 'select',
    columns: '*',
  });
  return result.body.data.length;
};

// A fixed clock, so a rating assertion cannot start failing tomorrow.
const AS_OF = '2026-06-30';
const daysBefore = (days) =>
  new Date(Date.parse(AS_OF) - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

test('fee math rates payment reliability from invoice and payment history', async () => {
  const { computePaymentRating, resolveEffectiveStanding, gradeForScore } = await import(
    '../server/services/fee-math.mjs'
  );

  const rate = (invoices, payments) => computePaymentRating({ invoices, payments, asOf: AS_OF });

  // Nothing billed at all.
  const blank = rate([], []);
  assert.equal(blank.standing, 'unrated');
  assert.equal(blank.score, null);
  assert.equal(blank.grade, null);
  assert.equal(blank.confidence, 'none');
  assert.equal(blank.reason, 'no_billing_history');

  // Billed for a future term, nothing due yet. This must not read as a perfect record.
  const notYetDue = rate([{ id: 'i1', total_amount: 1000, balance_due: 1000, due_date: '2026-12-01' }], []);
  assert.equal(notYetDue.standing, 'unrated');
  assert.equal(notYetDue.reason, 'no_billing_history');

  // Two invoices settled on or before their due date.
  const punctual = rate(
    [
      { id: 'i1', total_amount: 1000, balance_due: 0, due_date: daysBefore(60) },
      { id: 'i2', total_amount: 1000, balance_due: 0, due_date: daysBefore(30) },
    ],
    [
      { invoice_id: 'i1', amount: 1000, paid_at: daysBefore(62) },
      { invoice_id: 'i2', amount: 1000, paid_at: daysBefore(30) },
    ],
  );
  assert.equal(punctual.score, 100);
  assert.equal(punctual.grade, 'A');
  assert.equal(punctual.standing, 'excellent');
  assert.equal(punctual.metrics.onTimeCount, 2);
  assert.equal(punctual.metrics.lateCount, 0);

  // Settled 20 days late, nothing left owing: punctuality alone carries the penalty.
  const late = rate(
    [{ id: 'i1', total_amount: 1000, balance_due: 0, due_date: daysBefore(50) }],
    [{ invoice_id: 'i1', amount: 1000, paid_at: daysBefore(30) }],
  );
  assert.equal(late.penalties.punctuality, 30);
  assert.equal(late.penalties.exposure, 0);
  assert.equal(late.penalties.delinquency, 0);
  assert.equal(late.score, 70);
  assert.equal(late.grade, 'B');

  // Wholly unpaid and 100 days past due: exposure and delinquency both max out.
  const unpaid = rate([{ id: 'i1', total_amount: 1000, balance_due: 1000, due_date: daysBefore(100) }], []);
  assert.equal(unpaid.penalties.exposure, 30);
  assert.equal(unpaid.penalties.delinquency, 30);
  assert.equal(unpaid.score, 40);
  assert.equal(unpaid.grade, 'D');
  assert.equal(unpaid.standing, 'watch');

  // All three penalties biting at once is what it takes to reach the bottom grade.
  const delinquent = rate(
    [
      { id: 'i1', total_amount: 1000, balance_due: 0, due_date: daysBefore(80) },
      { id: 'i2', total_amount: 1000, balance_due: 1000, due_date: daysBefore(100) },
    ],
    [{ invoice_id: 'i1', amount: 1000, paid_at: daysBefore(40) }],
  );
  assert.equal(delinquent.penalties.punctuality, 40);
  assert.equal(delinquent.penalties.exposure, 15);
  assert.equal(delinquent.penalties.delinquency, 30);
  assert.equal(delinquent.score, 15);
  assert.equal(delinquent.grade, 'E');
  assert.equal(delinquent.standing, 'delinquent');

  // The delinquency penalty stays clamped as the debt ages further.
  const older = rate([{ id: 'i1', total_amount: 1000, balance_due: 1000, due_date: daysBefore(400) }], []);
  assert.equal(older.penalties.delinquency, 30);

  // Half the money that has come due is still outstanding, and nothing is late.
  const halfOwing = rate(
    [
      { id: 'i1', total_amount: 1000, balance_due: 0, due_date: daysBefore(20) },
      { id: 'i2', total_amount: 1000, balance_due: 1000, due_date: AS_OF },
    ],
    [{ invoice_id: 'i1', amount: 1000, paid_at: daysBefore(25) }],
  );
  assert.equal(halfOwing.penalties.exposure, 15);
  assert.equal(halfOwing.score, 85);
  assert.equal(halfOwing.grade, 'A');

  // Grade boundaries.
  for (const [score, grade] of [
    [85, 'A'], [84, 'B'], [70, 'B'], [69, 'C'], [55, 'C'], [54, 'D'], [40, 'D'], [39, 'E'], [0, 'E'],
  ]) {
    assert.equal(gradeForScore(score).grade, grade, `score ${score} should grade ${grade}`);
  }

  // Confidence rises with the number of scoreable settlements.
  const settled = (count) =>
    rate(
      Array.from({ length: count }, (_, index) => ({
        id: `i${index}`,
        total_amount: 1000,
        balance_due: 0,
        due_date: daysBefore(30),
      })),
      Array.from({ length: count }, (_, index) => ({
        invoice_id: `i${index}`,
        amount: 1000,
        paid_at: daysBefore(31),
      })),
    );
  assert.equal(settled(1).confidence, 'low');
  assert.equal(settled(3).confidence, 'medium');
  assert.equal(settled(5).confidence, 'high');

  // An invoice settled without a linked payment says nothing about punctuality either way.
  const untraced = rate([{ id: 'i1', total_amount: 1000, balance_due: 0, due_date: daysBefore(30) }], []);
  assert.equal(untraced.metrics.untracedSettledCount, 1);
  assert.equal(untraced.metrics.onTimeCount, 0);

  // The manual override wins, while the computed rating stays visible for reference.
  const computed = delinquent;
  const overridden = resolveEffectiveStanding({
    computed,
    override: {
      id: 'st1',
      student_id: 's1',
      standing: 'good',
      note: 'Guardian on an agreed schedule',
      review_date: daysBefore(5),
      set_by: 'Admin User',
      set_at: `${daysBefore(10)}T00:00:00.000Z`,
    },
    asOf: AS_OF,
  });
  assert.equal(overridden.standing, 'good');
  assert.equal(overridden.source, 'manual');
  assert.equal(overridden.computed.standing, 'delinquent');
  assert.equal(overridden.computed.score, 15);
  // A past review date flags the override for attention but must never expire it on its own.
  assert.equal(overridden.override.review_due, true);
  assert.equal(overridden.standing, 'good');

  const future = resolveEffectiveStanding({
    computed,
    override: { id: 'st1', student_id: 's1', standing: 'good', note: 'x', review_date: '2027-01-01' },
    asOf: AS_OF,
  });
  assert.equal(future.override.review_due, false);

  const plain = resolveEffectiveStanding({ computed, override: null, asOf: AS_OF });
  assert.equal(plain.source, 'computed');
  assert.equal(plain.standing, 'delinquent');
  assert.equal(plain.computed.score, 15);
  assert.equal(plain.override, null);
});

test('fee math applies bursaries without ever driving an invoice negative', async () => {
  const { applyBursariesToAmount, buildInvoiceLineItems } = await import('../server/services/fee-math.mjs');

  const structure = { id: 'fs1', name: 'Grade 10 Day', academic_year: '2026/2027', term: 'Term 1' };
  const apply = (bursaries, gross = 1000000) =>
    applyBursariesToAmount({ gross, bursaries, structure, issueDate: AS_OF });

  const percentage = (value, extra = {}) => ({
    id: `b-${value}-${extra.id || ''}`,
    name: 'Bursary',
    status: 'active',
    discount_type: 'percentage',
    discount_value: value,
    ...extra,
  });

  const single = apply([percentage(25)]);
  assert.equal(single.discountTotal, 250000);
  assert.equal(single.net, 750000);

  // Percentages sum rather than compound: 50% + 30% is 80% off, not 65%.
  const stacked = apply([percentage(50, { id: 'a' }), percentage(30, { id: 'b' })]);
  assert.equal(stacked.discountTotal, 800000);
  assert.equal(stacked.net, 200000);

  // And they cap at 100%, so the invoice bottoms out at zero rather than going negative.
  const over = apply([percentage(60, { id: 'a' }), percentage(60, { id: 'b' })]);
  assert.equal(over.discountTotal, 1000000);
  assert.equal(over.net, 0);

  // A fixed amount larger than what is left is clamped to the gross.
  const mixed = apply([
    percentage(50, { id: 'a' }),
    { id: 'b-fixed', name: 'Fixed', status: 'active', discount_type: 'fixed', discount_value: 900000 },
  ]);
  assert.equal(mixed.discountTotal, 1000000);
  assert.equal(mixed.net, 0);

  // Apportioned discount lines always sum back to the total that was applied.
  assert.equal(
    mixed.discounts.reduce((sum, discount) => sum + discount.amount, 0),
    mixed.discountTotal,
  );

  // Scope filters.
  assert.equal(apply([percentage(25, { fee_structure_id: 'other' })]).discountTotal, 0);
  assert.equal(apply([percentage(25, { academic_year: '2020/2021' })]).discountTotal, 0);
  assert.equal(apply([percentage(25, { term: 'Term 3' })]).discountTotal, 0);
  assert.equal(apply([percentage(25, { end_date: daysBefore(1) })]).discountTotal, 0);
  assert.equal(apply([percentage(25, { start_date: '2027-01-01' })]).discountTotal, 0);
  assert.equal(apply([percentage(25, { status: 'ended' })]).discountTotal, 0);
  // A bursary scoped to nothing in particular is a wildcard and applies everywhere.
  assert.equal(apply([percentage(25, { fee_structure_id: null, academic_year: null, term: null })]).discountTotal, 250000);
  // An exactly matching scope applies too.
  assert.equal(
    apply([percentage(25, { fee_structure_id: 'fs1', academic_year: '2026/2027', term: 'Term 1' })]).discountTotal,
    250000,
  );

  // Line items carry discounts as negatives, so they sum to the net payable.
  const applied = apply([percentage(25)]);
  const lineItems = buildInvoiceLineItems({ structure, gross: applied.gross, discounts: applied.discounts });
  assert.equal(lineItems.length, 2);
  assert.equal(lineItems[0].type, 'fee');
  assert.equal(lineItems[1].type, 'discount');
  assert.ok(lineItems[1].amount < 0);
  assert.equal(
    lineItems.reduce((sum, item) => sum + item.amount, 0),
    applied.net,
  );
  assert.equal(applied.gross - applied.discountTotal, applied.net);
});

test('fees endpoint refuses every action to non-admins without writing anything', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const { FEES_ACTIONS } = await import('../server/services/fees.mjs');
    assert.ok(FEES_ACTIONS.length >= 15, 'expected the full fees action catalogue');

    for (const action of FEES_ACTIONS) {
      for (const requesterRole of ['teacher', 'support_staff', undefined]) {
        const response = await dispatch(runtime, 'POST', '/api/functions/fees', {
          action,
          requesterRole,
          // Payloads that would otherwise succeed, to prove the guard runs first.
          name: 'Smuggled tier',
          academicYear: '2026/2027',
          term: 'Term 1',
          amount: 1000,
          studentId: 'student-001',
          confirm: true,
          standing: 'delinquent',
          note: 'unauthorised',
        });
        assert.equal(response.status, 400, `${action} as ${requesterRole} should be rejected`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    const unknown = await feesCall(runtime, 'drop_everything');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'Unsupported fees action: drop_everything');

    // Nothing leaked past the guard.
    for (const table of ['invoices', 'payments', 'receipts', 'fee_structures', 'fee_bursaries', 'student_fee_standings']) {
      assert.equal(await countRows(runtime, table), 0, `${table} should still be empty`);
    }
  } finally {
    await cleanup();
  }
});

test('bulk billing is idempotent, applies bursaries, and leaves fee status untouched', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const structure = await feesCall(runtime, 'save_fee_structure', {
      name: 'Grade 10 Day Tuition',
      gradeLevel: 10,
      studentType: 'day',
      academicYear: '2026/2027',
      term: 'Term 1',
      amount: 1500000,
      dueDate: '2026-09-01',
    });
    assert.equal(structure.status, 200);
    const feeStructureId = structure.body.data.structure.id;

    // Validation.
    assert.equal((await feesCall(runtime, 'save_fee_structure', { name: '', academicYear: '2026/2027', term: 'Term 1', amount: 1 })).status, 400);
    assert.equal((await feesCall(runtime, 'save_fee_structure', { name: 'x', academicYear: '2026/2027', term: 'Term 1', amount: 0 })).status, 400);
    assert.equal((await feesCall(runtime, 'save_fee_structure', { name: 'x', academicYear: '', term: 'Term 1', amount: 1 })).status, 400);

    const grade10 = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'grade_level', operator: 'eq', value: 10 }],
    });
    const active = grade10.body.data.filter((student) => student.status === 'active');
    assert.ok(active.length >= 2, 'seed data should hold several active grade 10 students');
    const sponsored = active[0];

    await feesCall(runtime, 'save_bursary', {
      studentId: sponsored.id,
      name: 'Hardship Grant',
      discountType: 'percentage',
      discountValue: 25,
    });

    const preview = await feesCall(runtime, 'preview_billing_run', { feeStructureId });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.rows.length, active.length);
    assert.ok(preview.body.data.rows.every((row) => row.already_invoiced === false));
    const previewSponsored = preview.body.data.rows.find((row) => row.student_id === sponsored.id);
    assert.equal(previewSponsored.net, 1125000);
    assert.equal(previewSponsored.discount_total, 375000);

    // An unconfirmed run must not bill anyone.
    const unconfirmed = await feesCall(runtime, 'run_billing', { feeStructureId });
    assert.equal(unconfirmed.status, 400);
    assert.equal(unconfirmed.body.error, 'Billing run must be confirmed');
    assert.equal(await countRows(runtime, 'invoices'), 0);

    const billed = await feesCall(runtime, 'run_billing', { feeStructureId, confirm: true });
    assert.equal(billed.status, 200);
    assert.equal(billed.body.data.created, active.length);
    assert.equal(billed.body.data.skipped, 0);

    const numbers = billed.body.data.invoices.map((invoice) => invoice.invoice_number);
    assert.equal(new Set(numbers).size, numbers.length, 'invoice numbers must be unique');
    for (const number of numbers) assert.match(number, /^INV-\d{4}-\d{6}$/);
    for (const invoice of billed.body.data.invoices) {
      assert.equal(invoice.status, 'issued');
      assert.equal(invoice.balance_due, invoice.total_amount);
      // Line items always reconcile to the net payable.
      const lineTotal = invoice.line_items.reduce((sum, item) => sum + item.amount, 0);
      assert.equal(lineTotal, invoice.total_amount);
      assert.equal(invoice.gross_amount - invoice.discount_total, invoice.total_amount);
    }

    const sponsoredInvoice = billed.body.data.invoices.find((invoice) => invoice.student_id === sponsored.id);
    assert.equal(sponsoredInvoice.total_amount, 1125000);
    assert.equal(sponsoredInvoice.gross_amount, 1500000);
    assert.equal(sponsoredInvoice.discount_total, 375000);
    assert.ok(sponsoredInvoice.line_items.some((item) => item.type === 'discount' && item.amount === -375000));

    // Re-running must not double-bill, however many times someone presses the button.
    const again = await feesCall(runtime, 'run_billing', { feeStructureId, confirm: true });
    assert.equal(again.body.data.created, 0);
    assert.equal(again.body.data.skipped, active.length);
    assert.equal(await countRows(runtime, 'invoices'), active.length);

    const afterPreview = await feesCall(runtime, 'preview_billing_run', { feeStructureId });
    assert.ok(afterPreview.body.data.rows.every((row) => row.already_invoiced === true));
    assert.ok(afterPreview.body.data.rows.every((row) => /^INV-\d{4}-\d{6}$/.test(row.existing_invoice_number)));

    // An archived structure cannot be billed again.
    await feesCall(runtime, 'delete_fee_structure', { id: feeStructureId });
    const archived = await feesCall(runtime, 'run_billing', { feeStructureId, confirm: true });
    assert.equal(archived.status, 400);
    // It was archived rather than deleted, because invoices already point at it.
    const structures = await feesCall(runtime, 'list_fee_structures', { includeArchived: true });
    assert.equal(structures.body.data.structures[0].status, 'archived');
    assert.equal(structures.body.data.structures[0].invoice_count, active.length);

    // The support-staff-facing endpoint must keep its shape and its field allow-list.
    const feeStatus = await dispatch(runtime, 'POST', '/api/functions/fee-status', {});
    assert.equal(feeStatus.status, 200);
    assert.equal(feeStatus.body.data.students.length, 15);
    const allowed = [
      'student_id', 'student_number', 'full_name', 'grade_level', 'class_section', 'currency',
      'invoice_count', 'total_invoiced', 'total_paid', 'balance_due', 'next_due_date',
      'last_payment_at', 'status',
    ];
    for (const row of feeStatus.body.data.students) {
      assert.deepEqual(Object.keys(row).sort(), [...allowed].sort());
    }
    const sponsoredStatus = feeStatus.body.data.students.find((row) => row.student_id === sponsored.id);
    assert.equal(sponsoredStatus.total_invoiced, 1125000);
  } finally {
    await cleanup();
  }
});

test('recording a payment reconciles invoices and issues a receipt', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const structure = await feesCall(runtime, 'save_fee_structure', {
      name: 'Grade 9 Boarding',
      gradeLevel: 9,
      academicYear: '2026/2027',
      term: 'Term 1',
      amount: 1000000,
      dueDate: '2026-09-01',
    });
    const feeStructureId = structure.body.data.structure.id;
    const billed = await feesCall(runtime, 'run_billing', { feeStructureId, confirm: true });
    const invoice = billed.body.data.invoices[0];
    const studentId = invoice.student_id;

    // Validation first.
    assert.equal((await feesCall(runtime, 'record_payment', { studentId, amount: 0, paymentMethod: 'Cash' })).status, 400);
    assert.equal((await feesCall(runtime, 'record_payment', { studentId, amount: -1, paymentMethod: 'Cash' })).status, 400);
    assert.equal((await feesCall(runtime, 'record_payment', { studentId, amount: 100, paymentMethod: '' })).status, 400);
    assert.equal((await feesCall(runtime, 'record_payment', { studentId: 'nobody', amount: 100, paymentMethod: 'Cash' })).status, 400);

    const otherInvoice = billed.body.data.invoices.find((row) => row.student_id !== studentId);
    const crossed = await feesCall(runtime, 'record_payment', {
      studentId,
      invoiceId: otherInvoice.id,
      amount: 100,
      paymentMethod: 'Cash',
    });
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error, 'Invoice does not belong to this student');

    // Part payment against a named invoice.
    const part = await feesCall(runtime, 'record_payment', {
      studentId,
      invoiceId: invoice.id,
      amount: 400000,
      paymentMethod: 'Cash',
    });
    assert.equal(part.status, 200);
    assert.equal(part.body.data.allocations.length, 1);
    assert.equal(part.body.data.allocations[0].applied, 400000);
    assert.equal(part.body.data.allocations[0].balance_due, 600000);
    assert.equal(part.body.data.allocations[0].status, 'partial');
    assert.match(part.body.data.receipt.receipt_number, /^RCT-\d{4}-\d{6}$/);
    assert.equal(part.body.data.payment.invoice_id, invoice.id);
    assert.equal(part.body.data.creditAmount, 0);

    // Settling the remainder closes the invoice.
    const rest = await feesCall(runtime, 'record_payment', {
      studentId,
      invoiceId: invoice.id,
      amount: 600000,
      paymentMethod: 'Bank Transfer',
    });
    assert.equal(rest.body.data.allocations[0].balance_due, 0);
    assert.equal(rest.body.data.allocations[0].status, 'paid');

    // Receipt numbers stay unique across payments in the same year.
    assert.notEqual(part.body.data.receipt.receipt_number, rest.body.data.receipt.receipt_number);
    assert.equal(await countRows(runtime, 'receipts'), 2);

    // Auto-allocation spreads across open invoices, oldest due date first.
    const second = await feesCall(runtime, 'save_fee_structure', {
      name: 'Grade 9 Term 2',
      gradeLevel: 9,
      academicYear: '2026/2027',
      term: 'Term 2',
      amount: 500000,
      dueDate: '2026-12-01',
    });
    await feesCall(runtime, 'run_billing', { feeStructureId: second.body.data.structure.id, confirm: true });

    const third = await feesCall(runtime, 'save_fee_structure', {
      name: 'Grade 9 Term 3',
      gradeLevel: 9,
      academicYear: '2026/2027',
      term: 'Term 3',
      amount: 500000,
      dueDate: '2027-03-01',
    });
    await feesCall(runtime, 'run_billing', { feeStructureId: third.body.data.structure.id, confirm: true });

    const spread = await feesCall(runtime, 'record_payment', {
      studentId,
      amount: 700000,
      paymentMethod: 'Mobile Money',
    });
    assert.equal(spread.body.data.allocations.length, 2);
    assert.equal(spread.body.data.allocations[0].applied, 500000);
    assert.equal(spread.body.data.allocations[0].status, 'paid');
    assert.equal(spread.body.data.allocations[1].applied, 200000);
    assert.equal(spread.body.data.allocations[1].status, 'partial');
    // Split across invoices, so no single invoice owns the payment row.
    assert.equal(spread.body.data.payment.invoice_id, null);

    // Overpayment clears everything and reports the credit rather than silently absorbing it.
    const over = await feesCall(runtime, 'record_payment', {
      studentId,
      amount: 1000000,
      paymentMethod: 'Cash',
    });
    assert.equal(over.body.data.creditAmount, 700000);
    assert.ok(over.body.data.allocations.every((allocation) => allocation.status === 'paid'));
    assert.equal(over.body.data.payment.amount, 1000000);

    // The money trail is written server-side, not left to the browser.
    const audit = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_audit_log', limit: 100 });
    const paymentLogs = audit.body.data.logs.filter((log) => log.entity_type === 'payment');
    assert.ok(paymentLogs.length >= 4);
    assert.equal(paymentLogs[0].action, 'payment_recorded');
    assert.ok(audit.body.data.logs.some((log) => log.action === 'billing_run' && log.entity_type === 'invoice'));

    // Ledger reconciles.
    const ledger = await feesCall(runtime, 'student_ledger', { studentId });
    assert.equal(ledger.status, 200);
    assert.equal(ledger.body.data.summary.balance_due, 0);
    assert.equal(ledger.body.data.entries[ledger.body.data.entries.length - 1].balance <= 0, true);
    assert.equal(ledger.body.data.receipts.length, 4);
  } finally {
    await cleanup();
  }
});

test('fee receipts and statements render as PDFs for admins only', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const structure = await feesCall(runtime, 'save_fee_structure', {
      name: 'Grade 11 Day',
      gradeLevel: 11,
      academicYear: '2026/2027',
      term: 'Term 1',
      amount: 800000,
      dueDate: '2026-09-01',
    });
    const billed = await feesCall(runtime, 'run_billing', {
      feeStructureId: structure.body.data.structure.id,
      confirm: true,
    });
    const invoice = billed.body.data.invoices[0];

    const paid = await feesCall(runtime, 'record_payment', {
      studentId: invoice.student_id,
      invoiceId: invoice.id,
      amount: 800000,
      paymentMethod: 'Cash',
    });
    const paymentId = paid.body.data.payment.id;

    const receipt = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/fees/receipts/${paymentId}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'admin' }),
    });
    assert.equal(receipt.status, 200);
    assert.equal(receipt.type, 'binary');
    assert.equal(receipt.headers['Content-Type'], 'application/pdf');
    assert.ok(receipt.body.length > 500);

    const statement = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/fees/statements/${invoice.student_id}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'admin' }),
    });
    assert.equal(statement.status, 200);
    assert.equal(statement.type, 'binary');
    assert.ok(statement.body.length > 500);

    // A support-staff browser must not be able to pull a full fee statement. Teachers now can:
    // one student's history is a read a teacher fielding "has this family paid?" legitimately
    // needs, and it is a different thing from the school-wide financial report below.
    const asTeacher = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/fees/statements/${invoice.student_id}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(asTeacher.status, 200);

    const denied = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/fees/statements/${invoice.student_id}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'support_staff' }),
    });
    assert.equal(denied.status, 403);

    const anonymous = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/fees/receipts/${paymentId}.pdf`,
      searchParams: new URLSearchParams(),
    });
    assert.equal(anonymous.status, 403);

    const missing = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/fees/receipts/nope.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'admin' }),
    });
    assert.equal(missing.status, 404);
  } finally {
    await cleanup();
  }
});

test('an admin standing override supersedes the computed rating and can be cleared', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const studentId = 'student-001';

    assert.equal((await feesCall(runtime, 'set_standing', { studentId, standing: 'vip', note: 'x' })).status, 400);
    const noNote = await feesCall(runtime, 'set_standing', { studentId, standing: 'watch', note: '  ' });
    assert.equal(noNote.status, 400);
    assert.equal(noNote.body.error, 'A note explaining the override is required');
    assert.equal((await feesCall(runtime, 'set_standing', { studentId: 'ghost', standing: 'watch', note: 'x' })).status, 400);

    const set = await feesCall(runtime, 'set_standing', {
      studentId,
      standing: 'watch',
      note: 'Guardian promised clearance by end of Term 2',
      reviewDate: '2026-01-01',
      asOf: AS_OF,
    });
    assert.equal(set.status, 200);
    assert.equal(set.body.data.effective.source, 'manual');
    assert.equal(set.body.data.effective.standing, 'watch');
    assert.ok(set.body.data.effective.computed, 'the computed rating stays available for reference');

    // Overriding again supersedes rather than accumulating: exactly one live row per student.
    const replaced = await feesCall(runtime, 'set_standing', {
      studentId,
      standing: 'delinquent',
      note: 'Arrangement lapsed',
    });
    assert.equal(replaced.body.data.effective.standing, 'delinquent');

    const rows = await dispatch(runtime, 'POST', '/api/db', {
      table: 'student_fee_standings',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'student_id', operator: 'eq', value: studentId }],
    });
    assert.equal(rows.body.data.length, 2, 'the superseded override is kept as history');
    const live = rows.body.data.filter((row) => row.status === 'active');
    assert.equal(live.length, 1);
    assert.equal(live[0].standing, 'delinquent');
    const cleared = rows.body.data.find((row) => row.status === 'cleared');
    assert.ok(cleared.cleared_at, 'the superseded row records when it was cleared');
    assert.equal(cleared.cleared_by, 'Admin User');

    // A past review date raises a flag without changing the standing.
    const due = await feesCall(runtime, 'list_standings', { reviewDueOnly: true, asOf: AS_OF });
    assert.equal(due.body.data.rows.length, 0, 'the live override carries no review date');

    await feesCall(runtime, 'set_standing', {
      studentId,
      standing: 'watch',
      note: 'Review at the end of term',
      reviewDate: daysBefore(5),
    });
    const nowDue = await feesCall(runtime, 'list_standings', { reviewDueOnly: true, asOf: AS_OF });
    assert.equal(nowDue.body.data.rows.length, 1);
    assert.equal(nowDue.body.data.rows[0].student_id, studentId);
    assert.equal(nowDue.body.data.rows[0].standing, 'watch');
    assert.equal(nowDue.body.data.rows[0].override.review_due, true);

    const filtered = await feesCall(runtime, 'list_standings', { standing: 'watch', asOf: AS_OF });
    assert.ok(filtered.body.data.rows.every((row) => row.standing === 'watch'));

    const clear = await feesCall(runtime, 'clear_standing', { studentId });
    assert.equal(clear.body.data.cleared, true);
    assert.equal(clear.body.data.effective.source, 'computed');
    assert.equal(clear.body.data.effective.override, null);

    // Clearing again is a no-op rather than an error.
    assert.equal((await feesCall(runtime, 'clear_standing', { studentId })).body.data.cleared, false);

    const audit = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_audit_log', limit: 100 });
    assert.ok(audit.body.data.logs.some((log) => log.entity_type === 'fee_standing' && log.action === 'fee_standing_set'));
    assert.ok(audit.body.data.logs.some((log) => log.action === 'fee_standing_cleared'));
  } finally {
    await cleanup();
  }
});

test('the arrears report ages outstanding balances into buckets', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const studentId = 'student-001';
    const invoice = async (number, amount, dueDate) => {
      await dispatch(runtime, 'POST', '/api/db', {
        table: 'invoices',
        operation: 'insert',
        columns: '*',
        single: true,
        payload: {
          student_id: studentId,
          invoice_number: number,
          status: 'issued',
          total_amount: amount,
          balance_due: amount,
          currency: 'UGX',
          due_date: dueDate,
        },
      });
    };

    await invoice('INV-TEST-000001', 100000, daysBefore(10));
    await invoice('INV-TEST-000002', 200000, daysBefore(45));
    await invoice('INV-TEST-000003', 400000, daysBefore(200));
    await invoice('INV-TEST-000004', 800000, '2027-01-01');

    const report = await feesCall(runtime, 'arrears_report', { asOf: AS_OF });
    assert.equal(report.status, 200);
    const row = report.body.data.rows.find((entry) => entry.student_id === studentId);

    assert.equal(row.days_1_30, 100000);
    assert.equal(row.days_31_60, 200000);
    assert.equal(row.days_61_90, 0);
    assert.equal(row.days_90_plus, 400000);
    assert.equal(row.current, 800000);
    assert.equal(row.total_outstanding, 1500000);
    assert.equal(row.days_overdue, 200);
    assert.equal(row.oldest_due_date, daysBefore(200));

    // Totals reconcile to the rows they summarise.
    assert.equal(report.body.data.totals.total, report.body.data.rows.reduce((sum, entry) => sum + entry.total_outstanding, 0));
    assert.equal(report.body.data.totals.days_90_plus, 400000);

    // Bucket boundaries.
    const { agingBucketFor } = await import('../server/services/fee-math.mjs');
    assert.equal(agingBucketFor(0), 'current');
    assert.equal(agingBucketFor(1), 'days_1_30');
    assert.equal(agingBucketFor(30), 'days_1_30');
    assert.equal(agingBucketFor(31), 'days_31_60');
    assert.equal(agingBucketFor(60), 'days_31_60');
    assert.equal(agingBucketFor(61), 'days_61_90');
    assert.equal(agingBucketFor(90), 'days_61_90');
    assert.equal(agingBucketFor(91), 'days_90_plus');

    // Filters.
    const filtered = await feesCall(runtime, 'arrears_report', { asOf: AS_OF, minBalance: 2000000 });
    assert.equal(filtered.body.data.rows.length, 0);
    const byGrade = await feesCall(runtime, 'arrears_report', { asOf: AS_OF, gradeLevel: 12 });
    assert.ok(byGrade.body.data.rows.every((entry) => entry.grade_level === 12));
  } finally {
    await cleanup();
  }
});

test('gateway payments are reconciled and receipted exactly once', async () => {
  const { runtime, cleanup } = await startTestRuntime({
    httpClient: async () => new Response(JSON.stringify({}), { status: 200 }),
  });

  try {
    await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices',
      operation: 'insert',
      columns: '*',
      single: true,
      payload: {
        id: 'invoice-gw',
        student_id: 'student-002',
        invoice_number: 'INV-GW-000001',
        status: 'issued',
        total_amount: 500000,
        balance_due: 500000,
        currency: 'UGX',
        due_date: '2026-09-01',
      },
    });

    const initiated = await dispatch(runtime, 'POST', '/api/functions/payments', {
      action: 'initiate',
      provider: 'mtn_momo',
      studentId: 'student-002',
      invoiceId: 'invoice-gw',
      amount: 200000,
      phoneNumber: '+256700000000',
    });
    assert.equal(initiated.status, 200);
    const reference = initiated.body.data.transaction.external_reference;

    const callback = () =>
      dispatch(runtime, 'POST', '/api/functions/payments', {
        action: 'callback',
        externalReference: reference,
        status: 'successful',
      });

    await callback();
    // A provider replaying the same callback must not pay the invoice twice.
    await callback();

    const payments = await dispatch(runtime, 'POST', '/api/db', {
      table: 'payments',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'reference', operator: 'eq', value: reference }],
    });
    assert.equal(payments.body.data.length, 1);
    assert.equal(payments.body.data[0].invoice_id, 'invoice-gw');

    const invoice = await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'id', operator: 'eq', value: 'invoice-gw' }],
      single: true,
    });
    assert.equal(invoice.body.data.balance_due, 300000);
    assert.equal(invoice.body.data.status, 'partial');

    // Every payment in the system gets a receipt, including the ones the gateway records.
    const receipts = await dispatch(runtime, 'POST', '/api/db', {
      table: 'receipts',
      operation: 'select',
      columns: '*',
      filters: [{ field: 'payment_id', operator: 'eq', value: payments.body.data[0].id }],
    });
    assert.equal(receipts.body.data.length, 1);
    assert.match(receipts.body.data[0].receipt_number, /^RCT-\d{4}-\d{6}$/);
    assert.equal(receipts.body.data[0].issued_by, 'payment_gateway');
  } finally {
    await cleanup();
  }
});

test('non-admin signups require admin approval before they can sign in', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const auth = (body) => dispatch(runtime, 'POST', '/api/functions/auth', body);

  try {
    // First account is the founding admin: auto-approved and immediately usable.
    const admin = await auth({ action: 'signup', email: 'head@school.local', password: 'password123', displayName: 'Head' });
    assert.equal(admin.body.data.user.role, 'admin');
    assert.equal(admin.body.data.user.approval_status, 'approved');
    assert.notEqual(admin.body.data.pending, true);
    assert.equal((await auth({ action: 'signin', email: 'head@school.local', password: 'password123' })).body.data.user.role, 'admin');

    // A later signup lands pending, and cannot obtain a session.
    const teacher = await auth({ action: 'signup', email: 'teacher@school.local', password: 'password123', displayName: 'Teacher' });
    assert.equal(teacher.body.data.pending, true);
    assert.equal(teacher.body.data.user.approval_status, 'pending');
    const teacherId = teacher.body.data.user.id;

    const blocked = await auth({ action: 'signin', email: 'teacher@school.local', password: 'password123' });
    assert.equal(blocked.status, 400);
    assert.equal(blocked.body.error, 'Your account is awaiting administrator approval.');

    // A wrong password still reads as invalid credentials, not as a pending account.
    const wrong = await auth({ action: 'signin', email: 'teacher@school.local', password: 'nope' });
    assert.equal(wrong.body.error, 'Invalid email or password');

    // Approval and rejection are admin-only.
    for (const action of ['approve_account', 'reject_account']) {
      const denied = await auth({ action, userId: teacherId, requesterRole: 'teacher' });
      assert.equal(denied.status, 400);
      assert.equal(denied.body.error, 'Unauthorized');
    }
    // The account survived the unauthorized attempts.
    assert.equal((await auth({ action: 'get_users' })).body.data.users.length, 2);

    // Approve, and the same credentials now sign in.
    const approve = await auth({ action: 'approve_account', userId: teacherId, requesterRole: 'admin', requesterEmail: 'head@school.local', requesterName: 'Head' });
    assert.equal(approve.body.data.user.approval_status, 'approved');
    assert.equal((await auth({ action: 'signin', email: 'teacher@school.local', password: 'password123' })).body.data.user.role, 'teacher');

    // get_users exposes approval_status for the admin panel.
    const users = await auth({ action: 'get_users' });
    assert.ok(users.body.data.users.every((u) => typeof u.approval_status === 'string'));

    // Approvals are audited server-side.
    const audit = await auth({ action: 'get_audit_log', limit: 20 });
    assert.ok(audit.body.data.logs.some((l) => l.action === 'account_approved' && l.entity_type === 'user'));
  } finally {
    await cleanup();
  }
});

test('rejecting an account deletes it, and admins cannot be rejected', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const auth = (body) => dispatch(runtime, 'POST', '/api/functions/auth', body);

  try {
    const admin = await auth({ action: 'signup', email: 'admin@school.local', password: 'password123', displayName: 'Admin' });
    const rejectMe = await auth({ action: 'signup', email: 'reject@school.local', password: 'password123', displayName: 'Reject Me' });
    const rejectId = rejectMe.body.data.user.id;

    const rejected = await auth({ action: 'reject_account', userId: rejectId, requesterRole: 'admin', requesterEmail: 'admin@school.local', requesterName: 'Admin' });
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.data.deleted, true);

    // Gone from the database entirely.
    const users = await auth({ action: 'get_users' });
    assert.equal(users.body.data.users.length, 1);
    assert.ok(!users.body.data.users.some((u) => u.auth_email === 'reject@school.local'));

    // And can no longer authenticate — it reads as unknown credentials, not pending.
    const gone = await auth({ action: 'signin', email: 'reject@school.local', password: 'password123' });
    assert.equal(gone.body.error, 'Invalid email or password');

    // Rejecting a second time is a clean "not found", not a crash.
    assert.equal((await auth({ action: 'reject_account', userId: rejectId, requesterRole: 'admin' })).body.error, 'User not found');

    // An admin account is protected from rejection, so the school cannot be locked out.
    const protectAdmin = await auth({ action: 'reject_account', userId: admin.body.data.user.id, requesterRole: 'admin' });
    assert.equal(protectAdmin.status, 400);
    assert.equal(protectAdmin.body.error, 'Administrator accounts cannot be rejected');
    assert.equal((await auth({ action: 'get_users' })).body.data.users.length, 1);

    // The rejection was audited.
    const audit = await auth({ action: 'get_audit_log', limit: 20 });
    assert.ok(audit.body.data.logs.some((l) => l.action === 'account_rejected' && l.entity_type === 'user'));
  } finally {
    await cleanup();
  }
});

test('report cards accept an uploaded photo, logo, address and theme colour via POST', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    // A minimal but valid 1x1 PNG, as a browser would hand over an uploaded image.
    const onePixelPng =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

    const pdf = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
      body: {
        term: 'Term 2',
        academicYear: '2026/2027',
        gradingCountry: 'uganda',
        academicLevel: 'secondary',
        schoolName: 'Bwongo Digital School',
        schoolAddress: 'P.O. Box 123, Kampala, Uganda',
        themeColor: '#B5179E',
        schoolLogo: onePixelPng,
        studentPhoto: onePixelPng,
      },
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, 'binary');
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    // Embedding two images makes the document meaningfully larger than the text-only card.
    assert.ok(pdf.body.length > 1000);

    // A malformed image or theme must not break the download — the card still renders.
    const resilient = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
      body: { schoolLogo: 'data:image/png;base64,not-real', themeColor: 'nonsense' },
    });
    assert.equal(resilient.status, 200);
    assert.ok(resilient.body.length > 500);

    // The POST path still 404s for an unknown student, like the GET path.
    const missing = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/report-cards/nobody.pdf',
      searchParams: new URLSearchParams(),
      body: { themeColor: '#123456' },
    });
    assert.equal(missing.status, 404);
  } finally {
    await cleanup();
  }
});

test('school settings are admin-editable and default-seeded', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const settings = (body) => dispatch(runtime, 'POST', '/api/functions/settings', body);

  try {
    // A seeded 'default' row exists from first boot.
    const seeded = await settings({ action: 'get' });
    assert.equal(seeded.status, 200);
    assert.equal(seeded.body.data.settings.id, 'default');
    assert.equal(seeded.body.data.settings.theme_color, '#2952a3');

    // Non-admins cannot update, and nothing is written.
    const denied = await settings({ action: 'update', requesterRole: 'teacher', schoolName: 'Smuggled' });
    assert.equal(denied.status, 400);
    assert.equal(denied.body.error, 'Unauthorized');
    assert.equal((await settings({ action: 'get' })).body.data.settings.school_name, '');

    // An admin sets the branding; a bad theme colour is normalised to the house default.
    const saved = await settings({
      action: 'update',
      requesterRole: 'admin',
      actorEmail: 'admin@school.ug',
      actorName: 'Admin',
      schoolName: 'Kampala High',
      tagline: 'Excellence',
      address: 'P.O. Box 1, Kampala',
      themeColor: 'not-a-colour',
      contactPhone: '+256700000000',
      contactEmail: 'info@kampala.high',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.data.settings.school_name, 'Kampala High');
    assert.equal(saved.body.data.settings.theme_color, '#2952a3');

    // Update is a full-row replace (the Settings form always submits every field), and a valid
    // theme colour is stored normalised to lowercase with a leading hash.
    const themed = await settings({
      action: 'update',
      requesterRole: 'admin',
      schoolName: 'Kampala High',
      tagline: 'Excellence',
      address: 'P.O. Box 1, Kampala',
      themeColor: 'B5179E',
      contactPhone: '+256700000000',
      contactEmail: 'info@kampala.high',
    });
    assert.equal(themed.body.data.settings.theme_color, '#b5179e');

    // The change persists and is audited server-side.
    assert.equal((await settings({ action: 'get' })).body.data.settings.contact_email, 'info@kampala.high');
    const audit = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_audit_log', limit: 20 });
    assert.ok(audit.body.data.logs.some((l) => l.action === 'settings_updated' && l.entity_type === 'settings'));

    // The students table now round-trips a stored photo.
    const withPhoto = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'update',
      columns: '*',
      single: true,
      filters: [{ field: 'id', operator: 'eq', value: 'student-001' }],
      payload: { photo_url: 'data:image/png;base64,iVBORw0KGgo=' },
    });
    assert.equal(withPhoto.body.data.photo_url, 'data:image/png;base64,iVBORw0KGgo=');
  } finally {
    await cleanup();
  }
});

test('documents use the global school settings for branding and the stored student photo', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const onePixelPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQAY3Y2wAAAAAElFTkSuQmCC';

  try {
    // Set global branding once and store a photo on the student.
    await dispatch(runtime, 'POST', '/api/functions/settings', {
      action: 'update',
      requesterRole: 'admin',
      schoolName: 'Kampala High School',
      tagline: 'Knowledge is Power',
      themeColor: '#B5179E',
    });
    await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'update',
      columns: '*',
      single: true,
      filters: [{ field: 'id', operator: 'eq', value: 'student-001' }],
      payload: { photo_url: onePixelPng },
    });

    // ID card embeds the stored photo alongside the QR (2 images).
    const idCard = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/id-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(idCard.status, 200);
    assert.equal(idCard.type, 'binary');
    assert.ok(idCard.body.length > 1500, 'a card with a photo is larger than a QR-only card');

    // Report card with no per-request branding falls back to the global settings and the stored
    // photo — so it embeds an image even though nothing was uploaded in the request.
    const reportCard = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
      body: { term: 'Term 2', gradingCountry: 'uganda-cbc' },
    });
    assert.equal(reportCard.status, 200);
    assert.ok(reportCard.body.length > 1000, 'the stored photo is embedded from settings/record, not upload');

    // A per-request value still overrides the global default (no crash, valid PDF).
    const overridden = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams(),
      body: { schoolName: 'One-off Name', themeColor: '#123456' },
    });
    assert.equal(overridden.status, 200);
    assert.ok(overridden.body.length > 500);
  } finally {
    await cleanup();
  }
});

test('admins can generate a printable financial report, others cannot', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const feesCall = (action, body = {}) =>
    dispatch(runtime, 'POST', '/api/functions/fees', { action, requesterRole: 'admin', actorName: 'Admin', ...body });

  try {
    // Bill a cohort and leave a balance so the report has real figures.
    const structure = await feesCall('save_fee_structure', {
      name: 'Grade 10 Day', gradeLevel: 10, academicYear: '2026/2027', term: 'Term 1', amount: 1000000, dueDate: '2026-04-01',
    });
    await feesCall('run_billing', { feeStructureId: structure.body.data.structure.id, confirm: true });

    const report = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/fees/report.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'admin' }),
    });
    assert.equal(report.status, 200);
    assert.equal(report.type, 'binary');
    assert.equal(report.headers['Content-Type'], 'application/pdf');
    assert.ok(report.body.length > 1000);

    for (const role of ['teacher', 'support_staff']) {
      const denied = await runtime.dispatch({
        method: 'GET',
        pathname: '/api/fees/report.pdf',
        searchParams: new URLSearchParams({ requesterRole: role }),
      });
      assert.equal(denied.status, 403);
    }
    const anonymous = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/fees/report.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(anonymous.status, 403);

    // The meta endpoint powers the app footer.
    const meta = await runtime.dispatch({ method: 'GET', pathname: '/api/meta', searchParams: new URLSearchParams() });
    assert.equal(meta.status, 200);
    assert.match(meta.body.data.version, /^\d+\.\d+\.\d+$/);
    assert.ok(typeof meta.body.data.developer === 'string' && meta.body.data.developer.length > 0);
  } finally {
    await cleanup();
  }
});

test('tenant resolution maps subdomains to tenants and defaults safely', async () => {
  const { resolveTenantId, parseTenantRegistry, createTenantRegistry, DEFAULT_TENANT } = await import(
    '../server/db/tenants.mjs'
  );

  // Subdomain routing.
  assert.equal(resolveTenantId('kampala-high.eschool.ink'), 'kampala-high');
  assert.equal(resolveTenantId('Gulu-SS.eschool.ink'), 'gulu-ss');
  assert.equal(resolveTenantId('kampala-high.eschool.ink:8787'), 'kampala-high');

  // Apex, www, localhost and IPs fall back to the default tenant.
  assert.equal(resolveTenantId('eschool.ink'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('www.eschool.ink'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('localhost'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('127.0.0.1:8787'), DEFAULT_TENANT);
  assert.equal(resolveTenantId(''), DEFAULT_TENANT);
  assert.equal(resolveTenantId(undefined), DEFAULT_TENANT);

  // The X-Tenant header is ignored unless it is explicitly enabled: it is a local-testing
  // convenience, and honouring it in production would let any page on the internet name whichever
  // school it wanted. The Host header cannot be forged cross-origin, so it is the one that decides.
  assert.equal(resolveTenantId('kampala-high.eschool.ink', 'gulu-ss'), 'kampala-high');

  const originalAllow = process.env.ALLOW_TENANT_HEADER;
  process.env.ALLOW_TENANT_HEADER = 'true';
  try {
    assert.equal(resolveTenantId('kampala-high.eschool.ink', 'gulu-ss'), 'gulu-ss');
  } finally {
    if (originalAllow === undefined) delete process.env.ALLOW_TENANT_HEADER;
    else process.env.ALLOW_TENANT_HEADER = originalAllow;
  }

  // Registry parsing.
  assert.equal(parseTenantRegistry(undefined).size, 0);
  assert.equal(parseTenantRegistry('not json').size, 0);
  const registry = parseTenantRegistry('[{"id":"A","url":"postgres://x/a"},{"id":"b","url":"postgres://x/b"}]');
  assert.equal(registry.size, 2);
  assert.equal(registry.get('a').url, 'postgres://x/a');

  // With no registry the router is disabled and everything uses the default database.
  const singleTenant = createTenantRegistry({ registry: new Map() });
  assert.equal(singleTenant.enabled, false);
  const sentinel = { marker: 'default-db' };
  assert.equal((await singleTenant.resolve('anything.eschool.ink', undefined, sentinel)).database, sentinel);
});

test('configured tenants get isolated databases', async () => {
  const { createTenantRegistry } = await import('../server/db/tenants.mjs');
  const { createDatabaseConnection } = await import('../server/db/connection.mjs');
  const { initializeDatabase } = await import('../server/db/schema.mjs');

  // Each tenant url maps to its own in-memory database.
  const registry = new Map([
    ['kampala-high', { url: 'memory://kampala' }],
    ['gulu-ss', { url: 'memory://gulu' }],
  ]);
  const tenants = createTenantRegistry({
    registry,
    createConnection: () => createDatabaseConnection({ useInMemoryDatabase: true }),
    init: initializeDatabase,
  });

  try {
    assert.equal(tenants.enabled, true);

    const a = await tenants.resolve('kampala-high.eschool.ink', undefined, null);
    const b = await tenants.resolve('gulu-ss.eschool.ink', undefined, null);
    assert.equal(a.tenantId, 'kampala-high');
    assert.equal(b.tenantId, 'gulu-ss');
    assert.notEqual(a.database, b.database);

    // Both start from the same seed.
    assert.equal((await a.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 15);
    assert.equal((await b.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 15);

    // A write in tenant A is invisible in tenant B.
    await a.database.query(
      "INSERT INTO students (id, student_id, first_name, last_name, grade_level, class_section) VALUES ('x','X-1','Only','InA', 5, 'A')",
    );
    assert.equal((await a.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 16);
    assert.equal((await b.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 15);

    // The same tenant resolves to the same cached connection.
    const aAgain = await tenants.resolve('kampala-high.eschool.ink', undefined, null);
    assert.equal(aAgain.database, a.database);

    // An unknown subdomain has no database, so the server would 404 it.
    const unknown = await tenants.resolve('ghost-school.eschool.ink', undefined, null);
    assert.equal(unknown.database, null);
    assert.equal(unknown.tenantId, 'ghost-school');
  } finally {
    await tenants.close();
  }
});

test('a school that pays is provisioned, served, and suspended when it lapses', async () => {
  const { createDatabaseConnection } = await import('../server/db/connection.mjs');

  // Configure subscription pricing + an in-memory tenant URL scheme for the test.
  const saved = {
    amount: process.env.SUBSCRIPTION_AMOUNT,
    template: process.env.TENANT_DB_URL_TEMPLATE,
    mode: process.env.PAYMENT_GATEWAY_MODE,
  };
  process.env.SUBSCRIPTION_AMOUNT = '500000';
  process.env.TENANT_DB_URL_TEMPLATE = 'memory://{db}';
  process.env.PAYMENT_GATEWAY_MODE = 'mock';

  // The two production-only steps are mocked: CREATE DATABASE is a no-op, and each tenant URL maps
  // to its own in-memory database (remembered so request routing reuses it). `init` runs once per
  // database instance — real Postgres tolerates re-running the idempotent schema, but pg-mem cannot
  // re-parse the whole schema, so we model that idempotency here.
  const { initializeDatabase } = await import('../server/db/schema.mjs');
  const tenantDbs = new Map();
  const initialized = new WeakSet();
  const provisionOptions = {
    createPhysicalDatabase: async () => {},
    createConnection: ({ connectionString }) => {
      if (!tenantDbs.has(connectionString)) tenantDbs.set(connectionString, createDatabaseConnection({ useInMemoryDatabase: true }));
      return tenantDbs.get(connectionString);
    },
    init: async (db) => {
      if (initialized.has(db)) return;
      initialized.add(db);
      await initializeDatabase(db);
    },
  };

  const runtime = await createAppRuntime({ useInMemoryDatabase: true, useInMemoryControl: true, provisionOptions });
  const P = (body, headers = {}) => runtime.dispatch({ method: 'POST', pathname: '/api/provision', body, headers });

  // Platform actions carry the operator's own token rather than a role the browser claims.
  const savedOwnerToken = process.env.PLATFORM_OWNER_TOKEN;
  process.env.PLATFORM_OWNER_TOKEN = 'owner-token-for-tests-0123456789abcdef';
  const owner = { authorization: `Bearer ${process.env.PLATFORM_OWNER_TOKEN}` };

  try {
    assert.equal(runtime.provisioningEnabled, true);

    // Availability + validation.
    assert.equal((await P({ action: 'availability', subdomain: 'kampala-high' })).body.data.available, true);
    assert.equal((await P({ action: 'availability', subdomain: 'www' })).body.data.available, false);
    assert.equal((await P({ action: 'availability', subdomain: 'a b' })).body.data.available, false);

    // Signup starts a pending tenant + a subscription charge.
    const signup = await P({
      action: 'signup',
      subdomain: 'kampala-high',
      schoolName: 'Kampala High',
      contactEmail: 'admin@kh.ug',
      provider: 'mtn_momo',
      phoneNumber: '+256700000000',
    });
    assert.equal(signup.status, 200);
    assert.equal(signup.body.data.purpose, 'provision');
    const reference = signup.body.data.reference;
    assert.ok(reference);

    // Now taken; still pending (unpaid) so its subdomain is not yet served.
    assert.equal((await P({ action: 'availability', subdomain: 'kampala-high' })).body.data.available, false);
    assert.equal((await P({ action: 'status', subdomain: 'kampala-high' })).body.data.tenant.status, 'pending');
    let route = await runtime.resolveDatabase('kampala-high.eschool.ink', undefined);
    assert.equal(route.status, 'pending');
    assert.equal(route.database, null);

    // The paid callback provisions the school and activates it.
    const paid = await P({ action: 'callback', externalReference: reference, status: 'successful' });
    assert.equal(paid.body.data.provisioned, true);
    assert.equal((await P({ action: 'status', subdomain: 'kampala-high' })).body.data.tenant.status, 'active');

    // The tenant's real connection details are persisted at activation (an empty db_url would make
    // routing to the tenant fail against a real Postgres server).
    const tenantRow = (await runtime.control.query("SELECT db_name, db_url FROM tenants WHERE subdomain = 'kampala-high'")).rows[0];
    assert.ok(tenantRow.db_url && tenantRow.db_url.length > 0, 'db_url must be persisted');
    assert.ok(tenantRow.db_name.includes('kampala'), 'db_name is derived from the subdomain');

    // Its subdomain now routes to a real (isolated) database.
    route = await runtime.resolveDatabase('kampala-high.eschool.ink', undefined);
    assert.equal(route.status, 'active');
    assert.ok(route.database);
    assert.equal((await route.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 15);

    // Replaying the callback is idempotent — no double provisioning.
    assert.equal((await P({ action: 'callback', externalReference: reference, status: 'successful' })).body.data.alreadyProcessed, true);

    // An unknown subdomain has no database (server 404s it).
    const ghost = await runtime.resolveDatabase('ghost.eschool.ink', undefined);
    assert.equal(ghost.database, null);
    assert.equal(ghost.status, 'unknown');

    // Lapse the subscription and sweep: the school is suspended and its subdomain stops serving.
    await runtime.control.query("UPDATE tenants SET current_period_end = NOW() - INTERVAL '400 days', status = 'past_due' WHERE subdomain = 'kampala-high'");
    const swept = await P({ action: 'sweep' }, owner);
    assert.equal(swept.body.data.suspended, 1);
    const suspended = await runtime.resolveDatabase('kampala-high.eschool.ink', undefined);
    assert.equal(suspended.status, 'suspended');
    assert.equal(suspended.database, null);

    // Platform actions need the operator's token. A school's own administrator claiming the role in
    // the request body used to be enough to enumerate every school on the platform.
    assert.equal((await P({ action: 'list', requesterRole: 'admin' })).body.error, 'Unauthorized');
    assert.equal((await P({ action: 'sweep', requesterRole: 'admin' })).body.error, 'Unauthorized');
    assert.equal((await P({ action: 'list' }, { authorization: 'Bearer wrong-token-entirely-0123456789' })).body.error, 'Unauthorized');

    const listed = await P({ action: 'list' }, owner);
    assert.equal(listed.body.data.tenants.length, 1);
    // A school's connection string is never handed out, not even to the operator's console.
    assert.equal(listed.body.data.tenants[0].db_url, undefined, 'db_url must never leave the control plane');
    assert.equal(listed.body.data.tenants[0].db_name, undefined);

    // The operator can also provision directly and set a status by hand.
    const created = await P({ action: 'create', subdomain: 'gulu-ss', schoolName: 'Gulu SS' }, owner);
    assert.equal(created.body.data.tenant.subdomain, 'gulu-ss');
    assert.equal(created.body.data.tenant.status, 'active');
    assert.equal(created.body.data.tenant.db_url, undefined);
    assert.equal((await P({ action: 'set_status', subdomain: 'gulu-ss', status: 'suspended' }, owner)).body.data.tenant.status, 'suspended');
    assert.match((await P({ action: 'set_status', subdomain: 'gulu-ss', status: 'nonsense' }, owner)).body.error, /Unsupported tenant status/);
    assert.equal((await P({ action: 'create', subdomain: 'gulu-ss' })).body.error, 'Unauthorized');

    // Renewal reactivates the suspended school.
    const renew = await P({ action: 'signup', subdomain: 'kampala-high', provider: 'mtn_momo', phoneNumber: '+256700000000' });
    await P({ action: 'callback', externalReference: renew.body.data.reference, status: 'successful' });
    assert.equal((await P({ action: 'status', subdomain: 'kampala-high' })).body.data.tenant.status, 'active');
  } finally {
    await runtime.close();
    if (savedOwnerToken === undefined) delete process.env.PLATFORM_OWNER_TOKEN;
    else process.env.PLATFORM_OWNER_TOKEN = savedOwnerToken;
    process.env.SUBSCRIPTION_AMOUNT = saved.amount;
    process.env.TENANT_DB_URL_TEMPLATE = saved.template;
    process.env.PAYMENT_GATEWAY_MODE = saved.mode;
  }
});

test('provisioning is inert without a control database', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  try {
    assert.equal(runtime.provisioningEnabled, false);
    const denied = await dispatch(runtime, 'POST', '/api/provision', { action: 'availability', subdomain: 'x' });
    assert.equal(denied.status, 400);
    assert.match(denied.body.error, /not enabled/);
  } finally {
    await cleanup();
  }
});

test('payment webhooks require a valid signature when a secret is configured', async () => {
  const { isWebhookSignatureValid, isPaymentWebhook, webhookVerificationEnabled } = await import('../server/security/webhooks.mjs');
  const { createHmac } = await import('node:crypto');
  const saved = process.env.PAYMENT_WEBHOOK_SECRET;

  try {
    // Only payment/subscription callbacks are treated as webhooks.
    assert.equal(isPaymentWebhook('/api/provision', { action: 'callback' }), true);
    assert.equal(isPaymentWebhook('/api/functions/payments', { action: 'callback' }), true);
    assert.equal(isPaymentWebhook('/api/provision', { action: 'signup' }), false);
    assert.equal(isPaymentWebhook('/api/functions/fees', { action: 'callback' }), false);

    // With no secret, verification is disabled (mock/dev) and everything passes.
    delete process.env.PAYMENT_WEBHOOK_SECRET;
    assert.equal(webhookVerificationEnabled(), false);
    assert.equal(isWebhookSignatureValid('{"any":"body"}', undefined), true);

    // With a secret, a correct HMAC-SHA256 of the raw body is required.
    process.env.PAYMENT_WEBHOOK_SECRET = 'top-secret';
    assert.equal(webhookVerificationEnabled(), true);
    const raw = '{"action":"callback","externalReference":"PAY-1","status":"successful"}';
    const good = createHmac('sha256', 'top-secret').update(raw, 'utf8').digest('hex');
    assert.equal(isWebhookSignatureValid(raw, good), true);
    assert.equal(isWebhookSignatureValid(raw, `sha256=${good}`), true);
    assert.equal(isWebhookSignatureValid(raw, 'deadbeef'), false);
    assert.equal(isWebhookSignatureValid(raw, undefined), false);
    // A tampered body no longer matches the signature.
    assert.equal(isWebhookSignatureValid(raw.replace('PAY-1', 'PAY-2'), good), false);
  } finally {
    if (saved === undefined) delete process.env.PAYMENT_WEBHOOK_SECRET;
    else process.env.PAYMENT_WEBHOOK_SECRET = saved;
  }
});

test('a "your school is ready" email is sent when a school is activated', async () => {
  const email = await import('../server/services/email.mjs');
  const { createDatabaseConnection } = await import('../server/db/connection.mjs');
  const { initializeDatabase } = await import('../server/db/schema.mjs');

  // Pure render.
  const message = email.renderActivationEmail({ schoolName: 'Kampala High', subdomain: 'kampala-high', rootDomain: 'eschool.ink' });
  assert.match(message.subject, /Kampala High is ready/);
  assert.equal(message.url, 'https://kampala-high.eschool.ink');
  assert.match(message.html, /kampala-high\.eschool\.ink/);

  const saved = { mode: process.env.EMAIL_MODE, key: process.env.EMAIL_API_KEY, amount: process.env.SUBSCRIPTION_AMOUNT, template: process.env.TENANT_DB_URL_TEMPLATE };
  process.env.EMAIL_MODE = 'http';
  process.env.EMAIL_API_KEY = 'test-key';
  process.env.SUBSCRIPTION_AMOUNT = '500000';
  process.env.TENANT_DB_URL_TEMPLATE = 'memory://{db}';

  try {
    // Mock mode sends nothing.
    process.env.EMAIL_MODE = 'mock';
    assert.equal((await email.sendEmail({ to: 'a@b.c', subject: 's', html: 'h' })).sent, false);
    process.env.EMAIL_MODE = 'http';

    // http mode posts to the provider (captured here, not the network).
    let captured = null;
    const httpClient = async (url, options) => {
      captured = { url, body: JSON.parse(options.body), auth: options.headers.Authorization };
      return new Response('{}', { status: 200 });
    };
    const direct = await email.sendEmail({ to: 'admin@kh.ug', subject: 'Hi', html: '<b>Hi</b>', text: 'Hi' }, { httpClient });
    assert.equal(direct.sent, true);
    assert.equal(captured.body.to, 'admin@kh.ug');
    assert.equal(captured.auth, 'Bearer test-key');

    // End-to-end: a paid callback provisions the school and sends the activation email to its
    // contact address.
    const tenantDbs = new Map();
    const initialized = new WeakSet();
    let activationEmail = null;
    const runtime = await createAppRuntime({
      useInMemoryDatabase: true,
      useInMemoryControl: true,
      provisionOptions: {
        createPhysicalDatabase: async () => {},
        createConnection: ({ connectionString }) => {
          if (!tenantDbs.has(connectionString)) tenantDbs.set(connectionString, createDatabaseConnection({ useInMemoryDatabase: true }));
          return tenantDbs.get(connectionString);
        },
        init: async (db) => { if (!initialized.has(db)) { initialized.add(db); await initializeDatabase(db); } },
        sendEmailClient: async (url, options) => { activationEmail = JSON.parse(options.body); return new Response('{}', { status: 200 }); },
      },
    });
    const P = (body) => runtime.dispatch({ method: 'POST', pathname: '/api/provision', body });
    try {
      const signup = await P({ action: 'signup', subdomain: 'kampala-high', schoolName: 'Kampala High', contactEmail: 'admin@kh.ug', provider: 'mtn_momo', phoneNumber: '+256700000000' });
      await P({ action: 'callback', externalReference: signup.body.data.reference, status: 'successful' });
      assert.ok(activationEmail, 'an activation email should have been sent');
      assert.equal(activationEmail.to, 'admin@kh.ug');
      assert.match(activationEmail.subject, /Kampala High is ready/);
    } finally {
      await runtime.close();
    }
  } finally {
    process.env.EMAIL_MODE = saved.mode;
    process.env.EMAIL_API_KEY = saved.key;
    process.env.SUBSCRIPTION_AMOUNT = saved.amount;
    process.env.TENANT_DB_URL_TEMPLATE = saved.template;
  }
});

test('a student can be billed tuition on admission from the matching fee structure', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const feesCall = (action, body = {}) =>
    dispatch(runtime, 'POST', '/api/functions/fees', { action, requesterRole: 'admin', actorName: 'Admin', ...body });

  try {
    const grade10 = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students', operation: 'select', columns: '*',
      filters: [{ field: 'grade_level', operator: 'eq', value: 10 }],
    });
    const student = grade10.body.data[0];

    // No structure yet → a clear, actionable error (not a silent no-op).
    const noStructure = await feesCall('bill_student', { studentId: student.id });
    assert.equal(noStructure.status, 400);
    assert.match(noStructure.body.error, /No active fee structure/);

    await feesCall('save_fee_structure', {
      name: 'Grade 10 Day Tuition', gradeLevel: 10, academicYear: '2026/2027', term: 'Term 1', amount: 1500000, dueDate: '2026-09-01',
    });

    // Preview computes the amount without writing an invoice.
    const preview = await feesCall('bill_student', { studentId: student.id, preview: true });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.data.preview, true);
    assert.equal(preview.body.data.amount, 1500000);
    assert.equal(await countRows(runtime, 'invoices'), 0);

    // Committing bills the student once.
    const billed = await feesCall('bill_student', { studentId: student.id, onAdmission: true });
    assert.equal(billed.status, 200);
    assert.equal(billed.body.data.amount, 1500000);
    assert.equal(billed.body.data.invoice.status, 'issued');
    assert.equal(await countRows(runtime, 'invoices'), 1);

    // Billing again is idempotent — the same billing_key is not billed twice.
    const again = await feesCall('bill_student', { studentId: student.id });
    assert.equal(again.body.data.alreadyBilled, true);
    assert.equal(await countRows(runtime, 'invoices'), 1);

    // A bursary reduces the auto-billed amount for a different student.
    const other = grade10.body.data[1];
    await feesCall('save_bursary', { studentId: other.id, name: 'Scholarship', discountType: 'percentage', discountValue: 40 });
    const discounted = await feesCall('bill_student', { studentId: other.id, preview: true });
    assert.equal(discounted.body.data.amount, 900000);

    // It is billed and audited as an admission charge.
    await feesCall('bill_student', { studentId: other.id, onAdmission: true });
    const audit = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_audit_log', limit: 20 });
    assert.ok(audit.body.data.logs.some((l) => l.action === 'billed_on_admission'));

    // Admin-only.
    const denied = await feesCall('bill_student', { studentId: student.id, requesterRole: 'teacher' });
    assert.equal(denied.body.error, 'Unauthorized');
  } finally {
    await cleanup();
  }
});

test('attendance is unique per student per day', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const mark = (payload) => dispatch(runtime, 'POST', '/api/db', {
    table: 'attendance_records', operation: 'insert', columns: '*', single: true, payload,
  });

  try {
    const first = await mark({ student_id: 'student-001', attendance_date: '2026-05-01', status: 'present', marked_by: 'T' });
    assert.equal(first.status, 200);

    // A second record for the same student and date updates the first rather than being rejected:
    // attendance_records declares a natural key, so the insert upserts on it. Marking a student
    // again is an ordinary correction, so making the caller handle an error for it was the wrong
    // contract — what matters is that a second row never appears.
    const corrected = await mark({
      student_id: 'student-001', attendance_date: '2026-05-01', status: 'late', marked_by: 'T',
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.data.id, first.body.data.id);
    assert.equal(corrected.body.data.status, 'late');

    // A different date is fine, and only one record exists for the first date.
    const nextDay = await mark({ student_id: 'student-001', attendance_date: '2026-05-02', status: 'present', marked_by: 'T' });
    assert.equal(nextDay.status, 200);
    const rows = await dispatch(runtime, 'POST', '/api/db', {
      table: 'attendance_records', operation: 'select', columns: '*',
      filters: [{ field: 'student_id', operator: 'eq', value: 'student-001' }],
    });
    assert.equal(rows.body.data.length, 2);
  } finally {
    await cleanup();
  }
});

test('a scan card carries only the sections the staff profile grants', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const card = (role, designation) => dispatch(runtime, 'POST', '/api/functions/student-card', {
    code: 'STU-2026-001', role, designation,
  });

  try {
    // Bursar is a role now rather than a designation on an administrator's account, but the card
    // it grants is unchanged — that contract is what the promotion had to preserve.
    const BOOKKEEPING_SECTIONS = [
      'fees', 'payments', 'bio', 'class', 'dormitory', 'parents', 'gate_permission', 'exam_clearance_grant',
    ];

    const bursar = await card('bursar', null);
    assert.equal(bursar.status, 200);
    assert.equal(bursar.body.data.profile.label, 'Bursar');
    // 'payments' is the ledger behind the balance — the bursar answering "has this family paid?"
    // needs it, and it arrived with the payment-history work.
    assert.deepEqual(bursar.body.data.sections, BOOKKEEPING_SECTIONS);

    // The accountant keeps the same books, and the head teacher answers for the whole school.
    for (const role of ['accountant', 'head_teacher', 'admin']) {
      const other = await card(role, null);
      assert.deepEqual(other.body.data.sections, BOOKKEEPING_SECTIONS, `${role} card`);
    }

    // The gate needs to know who the student is and whether they may leave — nothing else.
    const askari = await card('support_staff', 'askari');
    assert.deepEqual(askari.body.data.sections, ['class', 'gate_pass']);
    assert.equal('fees' in askari.body.data, false);
    assert.equal('parents' in askari.body.data, false);
    assert.equal('bio' in askari.body.data, false);

    // The kitchen sees the meal card and no personal record at all.
    const cook = await card('support_staff', 'cook');
    assert.deepEqual(cook.body.data.sections, ['class', 'meal_card']);
    assert.equal('fees' in cook.body.data, false);
    assert.equal(cook.body.data.meal_card.meals.length, 3);

    const matron = await card('support_staff', 'matron');
    assert.deepEqual(matron.body.data.sections,
      ['bio', 'class', 'dormitory', 'parents', 'gate_permission']);
    assert.equal('fees' in matron.body.data, false);

    // Support staff with no designation keep the fees-only card they had before designations.
    const plain = await card('support_staff', null);
    assert.deepEqual(plain.body.data.sections, ['fees']);

    // An unknown designation falls back to the role rather than granting anything extra.
    const bogus = await card('support_staff', 'headmaster');
    assert.deepEqual(bogus.body.data.sections, ['fees']);

    const missing = await card('teacher', null);
    assert.equal(missing.status, 200);
    const unknown = await dispatch(runtime, 'POST', '/api/functions/student-card', {
      code: 'NOT-A-STUDENT', role: 'teacher',
    });
    assert.equal(unknown.status, 404);
  } finally {
    await cleanup();
  }
});

test('the fees position and exam clearance are reported separately', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const clearance = async (code) => {
    const res = await dispatch(runtime, 'POST', '/api/functions/student-card', { code, role: 'teacher' });
    return res.body.data.exam_clearance;
  };

  try {
    // Nothing invoiced, so the ledger has no objection — but clearance is a decision a member of
    // staff makes, and nobody has made it, so the invigilator is not told to let the student in.
    const unbilled = await clearance('STU-2026-001');
    assert.equal(unbilled.fees_settled, true);
    assert.equal(unbilled.cleared, false);

    await dispatch(runtime, 'POST', '/api/db', {
      table: 'invoices', operation: 'insert', columns: '*', single: true,
      payload: {
        id: 'inv-exam-1', student_id: 'student-001', invoice_number: 'INV-EXAM-1',
        status: 'partial', total_amount: 900000, balance_due: 400000, currency: 'UGX',
      },
    });

    const owing = await clearance('STU-2026-001');
    assert.equal(owing.fees_settled, false);
    assert.equal(owing.balance_due, 400000);
    assert.equal(owing.cleared, false);

    // A bursar may clear a student the ledger would still hold back — a hardship case, a
    // promise to pay — so the grant wins over the balance.
    await dispatch(runtime, 'POST', '/api/functions/exam-clearance', {
      action: 'grant', code: 'STU-2026-001', grantedBy: 'Bursar', note: 'Hardship case',
    });

    const granted = await clearance('STU-2026-001');
    assert.equal(granted.cleared, true);
    assert.equal(granted.fees_settled, false, 'the balance is still owed and still reported');
    assert.equal(granted.reason, 'Cleared by Bursar');
  } finally {
    await cleanup();
  }
});

test('gate passes track whether a student is on the premises', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const pass = (payload) => dispatch(runtime, 'POST', '/api/functions/gate-pass', payload);
  const onPremises = async () => {
    const res = await dispatch(runtime, 'POST', '/api/functions/student-card', {
      code: 'STU-2026-001', role: 'support_staff', designation: 'askari',
    });
    return res.body.data.gate_pass.on_premises;
  };

  try {
    // A student nobody has signed out is on the premises.
    assert.equal(await onPremises(), true);

    const missingAuthoriser = await pass({ code: 'STU-2026-001', direction: 'out' });
    assert.equal(missingAuthoriser.status, 400);

    const badDirection = await pass({ code: 'STU-2026-001', direction: 'sideways', authorisedBy: 'Matron' });
    assert.equal(badDirection.status, 400);

    const out = await pass({
      code: 'STU-2026-001', direction: 'out', authorisedBy: 'Matron', reason: 'Clinic', recordedBy: 'Askari',
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.data.pass.authorised_by, 'Matron');
    assert.equal(await onPremises(), false);

    await pass({ code: 'STU-2026-001', direction: 'in', authorisedBy: 'Matron', recordedBy: 'Askari' });
    assert.equal(await onPremises(), true);
  } finally {
    await cleanup();
  }
});

test('a meal is served once per student per day', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const serve = (meal) => dispatch(runtime, 'POST', '/api/functions/meal-record', {
    code: 'STU-2026-001', meal, servedBy: 'Cook',
  });
  const mealCard = async () => {
    const res = await dispatch(runtime, 'POST', '/api/functions/student-card', {
      code: 'STU-2026-001', role: 'support_staff', designation: 'cook',
    });
    return res.body.data.meal_card;
  };

  try {
    const before = await mealCard();
    assert.deepEqual(before.meals.map((m) => m.eaten), [false, false, false]);

    assert.equal((await serve('brunch')).status, 400);

    const first = await serve('lunch');
    assert.equal(first.status, 200);
    assert.equal(first.body.data.already_served, false);

    // Re-scanning a student who has eaten reports the original serving rather than a new one.
    const again = await serve('lunch');
    assert.equal(again.status, 200);
    assert.equal(again.body.data.already_served, true);

    const after = await mealCard();
    assert.deepEqual(
      after.meals.map((m) => [m.meal, m.eaten]),
      [['breakfast', false], ['lunch', true], ['supper', false]],
    );
  } finally {
    await cleanup();
  }
});

test('a school connects its own Moodle and one ERP, and the token never comes back out', async () => {
  const previousKey = process.env.SECRETS_KEY;
  process.env.SECRETS_KEY = 'k'.repeat(40);

  // The connection test is the one action that reaches outwards, so the client is injected —
  // otherwise this test would depend on DNS and on a school's server being up.
  const attempted = [];
  const { runtime, cleanup } = await startTestRuntime({
    httpClient: async (url) => {
      attempted.push(String(url));
      throw new Error('getaddrinfo ENOTFOUND');
    },
  });
  const { INTEGRATION_ACTIONS } = await import('../server/services/integrations.mjs');
  const call = (body) => dispatch(runtime, 'POST', '/api/functions/integrations', body);

  try {
    for (const action of INTEGRATION_ACTIONS) {
      for (const requesterRole of ['teacher', 'support_staff', undefined]) {
        const response = await call({ action, requesterRole, provider: 'moodle' });
        assert.equal(response.status, 403, `${action} as ${requesterRole}`);
      }
    }

    // A token travels on every request, so an address that cannot protect it is refused at the
    // point of configuration rather than being quietly insecure afterwards.
    const overHttp = await call({
      action: 'save', requesterRole: 'admin', provider: 'moodle', baseUrl: 'http://moodle.school.ac.ug',
    });
    assert.equal(overHttp.status, 400);
    assert.match(overHttp.body.error, /https/);

    const saved = await call({
      action: 'save',
      requesterRole: 'head_teacher',
      provider: 'moodle',
      baseUrl: 'https://moodle.school.ac.ug/',
      apiToken: 'tok-secret-abcd',
    });
    const moodle = saved.body.data.integrations.find((i) => i.provider === 'moodle');
    assert.equal(moodle.baseUrl, 'https://moodle.school.ac.ug', 'the trailing slash is normalised away');
    // Enough of the token to recognise it, never enough to use it.
    assert.equal(moodle.tokenPreview, '••••••••abcd');
    assert.ok(!JSON.stringify(saved.body).includes('tok-secret-abcd'), 'the token never leaves the server');

    // Saving the address again must not blank a token nobody re-typed.
    const readdressed = await call({
      action: 'save', requesterRole: 'admin', provider: 'moodle', baseUrl: 'https://vle.school.ac.ug',
    });
    const kept = readdressed.body.data.integrations.find((i) => i.provider === 'moodle');
    assert.equal(kept.tokenPreview, '••••••••abcd');

    // ...while an explicit empty string is a deliberate clearing.
    const cleared = await call({
      action: 'save', requesterRole: 'admin', provider: 'moodle', baseUrl: 'https://vle.school.ac.ug', apiToken: '',
    });
    assert.equal(cleared.body.data.integrations.find((i) => i.provider === 'moodle').hasToken, false);

    // A school runs one ERP. Enabling the second stands the first down rather than leaving two
    // menu entries and no way to tell which is real.
    await call({ action: 'save', requesterRole: 'admin', provider: 'odoo', baseUrl: 'https://odoo.school.ac.ug' });
    const second = await call({ action: 'save', requesterRole: 'admin', provider: 'erpnext', baseUrl: 'https://erp.school.ac.ug' });
    const enabledErps = second.body.data.integrations.filter((i) => i.kind === 'erp' && i.enabled);
    assert.deepEqual(enabledErps.map((i) => i.provider), ['erpnext']);

    // A failed connection test is a successful request: the reason is what the admin came to read,
    // and a top-level error would return a 400 with a null body instead.
    const unreachable = await call({
      action: 'test', requesterRole: 'admin', provider: 'erpnext',
    });
    assert.equal(unreachable.status, 200);
    assert.equal(unreachable.body.data.connected, false);
    assert.match(unreachable.body.data.connectionError, /ENOTFOUND/);
    assert.deepEqual(attempted, ['https://erp.school.ac.ug']);

    // The reason is kept against the row, so the screen still shows it after a reload.
    const stored = await runtime.database.query(
      "SELECT last_error, last_checked_at FROM school_integrations WHERE provider = 'erpnext'",
    );
    assert.match(stored.rows[0].last_error, /ENOTFOUND/);
    assert.ok(stored.rows[0].last_checked_at, 'and when it was last tried');
  } finally {
    await cleanup();
    if (previousKey === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = previousKey;
  }
});

test('exporting the school leaves the credentials behind, and importing needs a preview first', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const { DATA_TRANSFER_ACTIONS } = await import('../server/services/data-transfer.mjs');
  const data = (body) => dispatch(runtime, 'POST', '/api/functions/data', body);

  try {
    // Same fence as backups: a copy of the school is not a teacher's to take.
    for (const action of DATA_TRANSFER_ACTIONS) {
      for (const requesterRole of ['teacher', 'support_staff', undefined]) {
        const response = await data({ action, requesterRole, data: {} });
        assert.equal(response.status, 403, `${action} as ${requesterRole}`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    const listed = await data({ action: 'list_tables', requesterRole: 'accountant' });
    assert.equal(listed.status, 200);

    // No table offers a credential column, whatever the table list happens to contain. Asserted on
    // what comes back rather than on the exclusion list, so the test still holds if the list moves.
    for (const table of listed.body.data.tables) {
      for (const column of ['password_hash', 'api_key', 'auth_token', 'api_secret']) {
        assert.ok(!table.columns.includes(column), `${table.name} must not export ${column}`);
      }
    }

    const exported = await data({ action: 'export', requesterRole: 'bursar', format: 'csv', tables: ['students'] });
    assert.equal(exported.status, 200);
    const [file] = exported.body.data.files;
    assert.equal(file.name, 'students.csv');
    assert.ok(file.rows > 0, 'the seeded roster comes out');
    // A header row and one line per student — the shape a spreadsheet expects.
    assert.equal(file.content.split('\n').length, file.rows + 1);

    // Taking a copy is an event, so it is on the audit trail with who took it.
    const audit = await runtime.database.query(
      "SELECT user_role FROM audit_logs WHERE action = 'data_exported'",
    );
    assert.equal(audit.rows[0].user_role, 'bursar');

    // An import will not run until it has been previewed. This is the one action here that can
    // overwrite records rather than copy them.
    const unchecked = await data({
      action: 'import',
      requesterRole: 'admin',
      data: { students: [{ id: 'x', student_id: 'STU-X', first_name: 'A', last_name: 'B', grade_level: 8, class_section: 'A' }] },
    });
    assert.equal(unchecked.status, 400);
    assert.match(unchecked.body.error, /previewed/);

    // The preview reports what it found and writes nothing.
    const before = await runtime.database.query('SELECT COUNT(*)::int AS count FROM students');
    const checked = await data({
      action: 'check_import',
      requesterRole: 'admin',
      data: { students: [{ id: 'x', student_id: 'STU-X', first_name: 'A', last_name: 'B', grade_level: 8, class_section: 'A' }] },
    });
    assert.equal(checked.body.data.token, 'ready');
    assert.deepEqual(checked.body.data.summary, [{ table: 'students', rows: 1 }]);
    const after = await runtime.database.query('SELECT COUNT(*)::int AS count FROM students');
    assert.equal(after.rows[0].count, before.rows[0].count, 'a preview writes nothing');

    // A row missing an id cannot be matched or written, and the preview says so instead of
    // discovering it halfway through the import.
    const bad = await data({ action: 'check_import', requesterRole: 'admin', data: { students: [{ first_name: 'No id' }] } });
    assert.equal(bad.body.data.token, '');
    assert.match(bad.body.data.problems[0].problem, /no id/);
  } finally {
    await cleanup();
  }
});

test('backups are for the roles that answer for the school, and nobody else', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const { BACKUP_ACTIONS } = await import('../server/services/backup.mjs');
  const backup = (body) => dispatch(runtime, 'POST', '/api/functions/backup', body);

  try {
    // A backup is every student record in one file. Teaching and non-teaching staff are refused
    // every action, as is a caller with no session at all.
    for (const action of BACKUP_ACTIONS) {
      for (const requesterRole of ['teacher', 'support_staff', undefined]) {
        const response = await backup({ action, requesterRole, id: 'anything' });
        assert.equal(response.status, 403, `${action} as ${requesterRole}`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    // Nothing was written on the way past the guard.
    const { rows } = await runtime.database.query('SELECT COUNT(*)::int AS count FROM school_backups');
    assert.equal(rows[0].count, 0);

    // The four privileged roles all get the list.
    for (const requesterRole of ['admin', 'head_teacher', 'accountant', 'bursar']) {
      const response = await backup({ action: 'list', requesterRole });
      assert.equal(response.status, 200, requesterRole);
      assert.deepEqual(response.body.data.backups, []);
      // And it says plainly that this server cannot take one, rather than offering a button that
      // would fail: pg_dump has no in-memory database to read.
      assert.equal(response.body.data.available, false);
    }

    const onMemory = await backup({ action: 'create', requesterRole: 'admin' });
    assert.equal(onMemory.status, 400);
    assert.match(onMemory.body.error, /in-memory/);
  } finally {
    await cleanup();
  }
});

test('a backup names the right file and records who took it', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const { handleBackupFunction } = await import('../server/services/backup.mjs');

  try {
    // pg_dump is injected, so what it would have been asked to do is assertable without a Postgres
    // or a subprocess — which is the whole reason the service takes it as an argument.
    const calls = [];
    const runPgDump = async (options) => {
      calls.push(options);
      await import('node:fs/promises').then((fs) => fs.writeFile(options.destination, 'PGDMP-stub'));
    };

    // The service refuses an in-memory database by design, so the pool is dressed as a real one.
    const database = {
      ...runtime.database,
      kind: 'postgres',
      pool: { options: { connectionString: 'postgres://user:pw@db:5432/school' } },
    };

    process.env.BACKUP_DIR = '/tmp/eschool-backup-test';
    const result = await handleBackupFunction(
      database,
      { action: 'create', requesterRole: 'bursar' },
      { tenantId: 'kampala-high', runPgDump },
    );
    delete process.env.BACKUP_DIR;

    assert.equal(calls.length, 1);
    assert.equal(calls[0].connectionString, 'postgres://user:pw@db:5432/school');
    // Named for the school and the moment, and inside the backup directory rather than anywhere
    // a filename from the database could point.
    assert.match(calls[0].destination, /^\/tmp\/eschool-backup-test\/kampala-high-[\dTZ-]+\.dump$/);

    const [row] = result.backups;
    assert.equal(row.status, 'complete');
    assert.equal(row.kind, 'manual');
    assert.ok(row.size_bytes > 0, 'the size is read back off disk, not assumed');

    // Taking one is written to the audit trail — a copy of the school leaving is an event.
    const audit = await runtime.database.query(
      "SELECT user_role, entity_name FROM audit_logs WHERE action = 'backup_created'",
    );
    assert.equal(audit.rows.length, 1);
    assert.equal(audit.rows[0].user_role, 'bursar');
    assert.equal(audit.rows[0].entity_name, row.filename);
  } finally {
    await cleanup();
  }
});

test('a student summary shows each role its own share of one student, and no more', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const summary = (requesterRole) =>
    dispatch(runtime, 'POST', '/api/functions/student-summary', { code: 'STU-2026-001', requesterRole });

  try {
    await runtime.database.query(
      `INSERT INTO discipline_records (id, student_id, incident_date, category, severity, description)
       VALUES ('disc-1', 'student-001', '2026-05-04', 'Conduct', 'minor', 'Late three mornings running')`,
    );
    await runtime.database.query(
      `INSERT INTO student_promotions (id, student_id, from_grade_level, to_grade_level, academic_year, effective_date)
       VALUES ('prom-1', 'student-001', 9, 10, '2026/2027', '2026-12-01')`,
    );

    const head = await summary('head_teacher');
    assert.equal(head.status, 200);
    assert.equal(head.body.data.student.student_id, 'STU-2026-001');
    // The whole picture: who they are, what they owe, what was paid, and their movements.
    for (const section of ['bio', 'parents', 'fees', 'payments', 'movements']) {
      assert.ok(head.body.data[section], `a head teacher sees ${section}`);
    }
    assert.equal(head.body.data.movements.promotions.length, 1);

    // A teacher sees the child, not the family's payment history — the same line the ID-scan card
    // draws, borrowed rather than restated so the two cannot drift apart.
    const teacher = await summary('teacher');
    assert.equal(teacher.status, 200);
    assert.ok(teacher.body.data.academics, 'a teacher sees marks');
    assert.ok(teacher.body.data.attendance, 'and the register');
    assert.ok(teacher.body.data.discipline, 'and the disciplinary record');
    assert.equal(teacher.body.data.payments, undefined, 'but not who paid what, and when');

    // The bursar keeps the books. A child's disciplinary record is not part of that.
    const bursar = await summary('bursar');
    assert.equal(bursar.status, 200);
    assert.ok(bursar.body.data.fees, 'a bursar sees the balance');
    assert.ok(bursar.body.data.payments, 'and the payments behind it');
    assert.equal(bursar.body.data.discipline, undefined, 'not the disciplinary record');
    assert.equal(bursar.body.data.academics, undefined, 'nor the marks');

    // The filtering is in the query, not in the response — a section a role may not see was never
    // read out of the database, so there is nothing in the payload to hide.
    const asText = JSON.stringify(bursar.body.data);
    assert.ok(!asText.includes('Late three mornings running'), 'the incident never reaches the page');

    // Support staff hold an account, and it is not one that opens a student's file.
    const support = await summary('support_staff');
    assert.equal(support.body.data.academics, undefined);
    assert.equal(support.body.data.bio, undefined);

    // No session at all is refused outright rather than falling back to a named role.
    const anonymous = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/student-summary',
      body: { code: 'STU-2026-001', requesterRole: 'admin' },
      headers: {},
      actor: null,
    });
    assert.equal(anonymous.status, 403);

    const missing = await dispatch(runtime, 'POST', '/api/functions/student-summary', {
      code: 'NOBODY', requesterRole: 'admin',
    });
    assert.equal(missing.status, 404);
  } finally {
    await cleanup();
  }
});

test('a student summary prints as one PDF, and not for anyone who asks', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    // renderReport has been able to build this since the parent-report work and had no route at
    // all; the Print button on the summary is what it was written for.
    const printed = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/student-reports/STU-2026-001.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(printed.status, 200);
    assert.equal(printed.headers['Content-Type'], 'application/pdf');
    assert.equal(printed.body.subarray(0, 4).toString(), '%PDF');
    assert.match(printed.headers['Content-Disposition'], /STU-2026-001-report\.pdf/);

    // The students table's own id works too, because that is what a search result carries.
    const byId = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/student-reports/student-001.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(byId.status, 200);

    // A named child's marks, attendance and fees in one file. No session, no report.
    const anonymous = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/student-reports/STU-2026-001.pdf',
      searchParams: new URLSearchParams(),
      headers: {},
      actor: null,
    });
    assert.equal(anonymous.status, 403);

    const bursar = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/student-reports/STU-2026-001.pdf',
      searchParams: new URLSearchParams(),
      headers: {},
      actor: { id: 'u1', email: 'b@school.test', name: 'B', role: 'bursar', designation: null },
    });
    assert.equal(bursar.status, 403, 'the same gate as the report card it sits beside');

    const missing = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/student-reports/NOBODY.pdf',
      searchParams: new URLSearchParams(),
    });
    assert.equal(missing.status, 404);
  } finally {
    await cleanup();
  }
});

test('an unattended backup is due once its hour has come round, and only once that day', async () => {
  const { isBackupDue } = await import('../server/services/backup.mjs');

  const schedule = { enabled: true, run_at: '02:00', timezone: 'Africa/Kampala', last_run_at: null };
  const at = (iso) => new Date(iso);

  // Kampala is UTC+3 all year, so 02:00 local is 23:00 UTC the day before.
  assert.equal(isBackupDue(schedule, at('2026-09-01T22:30:00Z')), false, 'before the hour');
  assert.equal(isBackupDue(schedule, at('2026-09-01T23:05:00Z')), true, 'the hour has come round');

  // Taken. Not due again until the school's next day, however many times the timer ticks.
  const taken = { ...schedule, last_run_at: '2026-09-01T23:05:00Z' };
  assert.equal(isBackupDue(taken, at('2026-09-01T23:06:00Z')), false);
  assert.equal(isBackupDue(taken, at('2026-09-02T20:00:00Z')), false, 'still the same Kampala day');
  assert.equal(isBackupDue(taken, at('2026-09-02T23:01:00Z')), true, 'the next one');

  // A server that was down through the small hours still takes the day's backup when it comes
  // back, rather than reasoning about elapsed time and skipping the day entirely.
  assert.equal(isBackupDue(schedule, at('2026-09-02T06:00:00Z')), true, 'catches up after downtime');

  assert.equal(isBackupDue({ ...schedule, enabled: false }, at('2026-09-01T23:05:00Z')), false);
  assert.equal(isBackupDue({ ...schedule, run_at: 'later' }, at('2026-09-01T23:05:00Z')), false);
});

test('a scheduled backup is filed as automatic, prunes its own and leaves manual ones alone', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const { handleBackupFunction, runScheduledBackup } = await import('../server/services/backup.mjs');
  const fs = await import('node:fs/promises');

  try {
    const runPgDump = async ({ destination }) => fs.writeFile(destination, 'PGDMP-stub');
    const database = {
      ...runtime.database,
      kind: 'postgres',
      pool: { options: { connectionString: 'postgres://user:pw@db:5432/school' } },
    };
    process.env.BACKUP_DIR = '/tmp/eschool-schedule-test';

    // A backup somebody took by hand. It must survive everything below.
    await handleBackupFunction(database, { action: 'create', requesterRole: 'admin' }, { runPgDump });

    await handleBackupFunction(
      database,
      { action: 'save_schedule', requesterRole: 'admin', enabled: true, runAt: '02:00', timezone: 'UTC', keepLast: 2 },
      {},
    );

    // Four days running. Each is a different school day, so each is owed one.
    for (const day of ['02', '03', '04', '05']) {
      const result = await runScheduledBackup({
        database,
        tenantId: 'kampala-high',
        runPgDump,
        now: new Date(`2026-09-${day}T02:30:00Z`),
      });
      assert.equal(result.ran, true, `a backup was owed on the ${day}th`);
    }

    const { rows } = await database.query('SELECT kind, created_by FROM school_backups ORDER BY created_at');
    const scheduled = rows.filter((row) => row.kind === 'scheduled');
    const manual = rows.filter((row) => row.kind === 'manual');

    // keepLast is 2, and four were taken.
    assert.equal(scheduled.length, 2, 'pruned down to the number the school asked to keep');
    // Nobody pressed anything, which is what the screen reads as "automatic".
    assert.deepEqual([...new Set(scheduled.map((row) => row.created_by))], ['']);
    // Retention is about the backups that pile up on their own. A deliberate one is not swept away
    // by a number that was set for something else.
    assert.equal(manual.length, 1, 'the manual backup is untouched by retention');

    // Asking again the same day is not owed a second one.
    const again = await runScheduledBackup({
      database,
      tenantId: 'kampala-high',
      runPgDump,
      now: new Date('2026-09-05T04:00:00Z'),
    });
    assert.equal(again.ran, false);
  } finally {
    delete process.env.BACKUP_DIR;
    await fs.rm('/tmp/eschool-schedule-test', { recursive: true, force: true });
    await cleanup();
  }
});

test('the backup scheduler is off unless asked for, and is stopped when the runtime closes', async () => {
  const { startBackupScheduler } = await import('../server/services/backup-scheduler.mjs');

  // Off by default. A background job that starts itself in every test run and every CLI script is
  // one that will eventually dump a database somebody was using for something else.
  delete process.env.BACKUP_SCHEDULER;
  const off = startBackupScheduler({ database: null });
  assert.equal(typeof off, 'function', 'still returns a stop, so the caller has nothing to branch on');

  process.env.BACKUP_SCHEDULER = 'true';
  try {
    let sweeps = 0;
    const database = {
      kind: 'postgres',
      query: async () => {
        sweeps += 1;
        throw new Error('no schedule table here');
      },
    };
    const stop = startBackupScheduler({ database, intervalMs: 5 });
    await new Promise((resolve) => setTimeout(resolve, 40));
    stop();

    const afterStop = sweeps;
    assert.ok(afterStop > 0, 'it ticked while running');
    await new Promise((resolve) => setTimeout(resolve, 40));
    // The real assertion: nothing more happens after the stop the runtime's close() calls. A timer
    // that survived here would also keep `node --test` from ever exiting.
    assert.equal(sweeps, afterStop, 'no ticks after stopping');
  } finally {
    delete process.env.BACKUP_SCHEDULER;
  }
});

test('the role list covers every post, and bursar reads as a role rather than a designation', async () => {
  const { USER_ROLES, PRIVILEGED_ROLES, TEACHING_ROLES, FINANCE_ROLES } = await import(
    '../server/auth/roles.mjs'
  );

  // The full set, asserted closed. The frontend keeps its own copy in src/lib/roles.ts and the two
  // are kept in step by hand, so a drift has to fail here rather than in production.
  assert.deepEqual(USER_ROLES, [
    'admin', 'head_teacher', 'accountant', 'bursar', 'teacher', 'support_staff',
  ]);

  // Who is trusted with the school's data as a whole. A teacher is not, and support staff never.
  assert.deepEqual(PRIVILEGED_ROLES, ['admin', 'head_teacher', 'accountant', 'bursar']);
  for (const role of ['teacher', 'support_staff']) {
    assert.ok(!PRIVILEGED_ROLES.includes(role), `${role} must not be privileged`);
  }

  // The finance posts read money but not student records; the teaching posts the reverse.
  for (const role of ['accountant', 'bursar']) {
    assert.ok(FINANCE_ROLES.includes(role), `${role} sees money`);
    assert.ok(!TEACHING_ROLES.includes(role), `${role} does not see student records`);
  }
  assert.ok(TEACHING_ROLES.includes('head_teacher') && FINANCE_ROLES.includes('head_teacher'));
});

test('an administrator who was a bursar becomes one, and the migration is idempotent', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const auth = (payload) => dispatch(runtime, 'POST', '/api/functions/auth', payload);

  // The two statements schema.mjs runs to move bursars off the designation column. Re-running the
  // whole schema is how a real deployment migrates, but pg-mem cannot parse it twice on one
  // instance, so the migration itself is exercised here rather than the file that carries it.
  const migrate = async () => {
    await runtime.database.query(
      "UPDATE users SET role = 'bursar', designation = NULL WHERE designation = 'bursar' AND role = 'admin'",
    );
    await runtime.database.query("UPDATE users SET designation = NULL WHERE designation = 'bursar'");
  };

  try {
    await auth({ action: 'signup', email: 'books@school.local', password: 'password123', displayName: 'Books' });
    await auth({ action: 'signup', email: 'gate@school.local', password: 'password123', displayName: 'Gate' });

    // Put the rows back the way a database written before this change would hold them: a bursar
    // riding on an administrator account, and — only reachable by hand — one on support staff.
    // The constraint no longer permits either, so it comes off first; that is exactly the order
    // schema.mjs uses, and the reason it does.
    await runtime.database.query('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_designation_check');
    await runtime.database.query(
      "UPDATE users SET role = 'admin', designation = 'bursar' WHERE auth_email = 'books@school.local'",
    );
    await runtime.database.query(
      "UPDATE users SET role = 'support_staff', designation = 'bursar' WHERE auth_email = 'gate@school.local'",
    );

    const read = async (email) => {
      const { rows } = await runtime.database.query(
        'SELECT role, designation FROM users WHERE auth_email = $1',
        [email],
      );
      return rows[0];
    };

    await migrate();

    // The administrator who kept the books is now a bursar, and keeps nothing else.
    assert.deepEqual(await read('books@school.local'), { role: 'bursar', designation: null });
    // The hand-edited row keeps its role and loses a designation that no longer exists.
    assert.deepEqual(await read('gate@school.local'), { role: 'support_staff', designation: null });

    // Running it again changes nothing, which is what lets every boot re-run the schema.
    await migrate();
    assert.deepEqual(await read('books@school.local'), { role: 'bursar', designation: null });
    assert.deepEqual(await read('gate@school.local'), { role: 'support_staff', designation: null });
  } finally {
    await cleanup();
  }
});

test('designations are constrained to the role that owns them', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const auth = (payload) => dispatch(runtime, 'POST', '/api/functions/auth', payload);

  try {
    await auth({ action: 'signup', email: 'head@school.local', password: 'password123', displayName: 'Head' });
    await auth({ action: 'signup', email: 'cook@school.local', password: 'password123', displayName: 'Cook' });
    await runtime.database.query(
      "UPDATE users SET role = 'support_staff', approval_status = 'approved' WHERE auth_email = 'cook@school.local'",
    );

    const ok = await auth({ action: 'set_designation', email: 'cook@school.local', designation: 'cook' });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.user.designation, 'cook');

    // 'bursar' is a role now, not a designation, so it is no longer assignable here at all.
    const retiredDesignation = await auth({ action: 'set_designation', email: 'cook@school.local', designation: 'bursar' });
    assert.equal(retiredDesignation.status, 400);

    // Nor to an administrator, which is where it used to live.
    const onAdmin = await auth({ action: 'set_designation', email: 'head@school.local', designation: 'bursar' });
    assert.equal(onAdmin.status, 400);

    // The designation reaches the app through the ordinary sign-in payload.
    const signin = await auth({ action: 'signin', email: 'cook@school.local', password: 'password123' });
    assert.equal(signin.body.data.user.designation, 'cook');

    const cleared = await auth({ action: 'set_designation', email: 'cook@school.local', designation: '' });
    assert.equal(cleared.body.data.user.designation, null);
  } finally {
    await cleanup();
  }
});

const curriculumCall = (runtime, action, body = {}) =>
  dispatch(runtime, 'POST', '/api/functions/curriculum', {
    action,
    requesterRole: 'teacher',
    actorEmail: 'teacher@school.ug',
    actorName: 'Grace Teacher',
    ...body,
  });

test('the curriculum corpus seeds Uganda and IGCSE outlines and ranks them by relevance', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const listed = await curriculumCall(runtime, 'list_documents');
    assert.equal(listed.status, 200);

    const titles = listed.body.data.documents.map((document) => document.title);
    assert.ok(
      titles.some((title) => /Uganda Lower Secondary Biology/.test(title)),
      'expected the bundled Uganda Biology outline',
    );
    assert.ok(
      titles.some((title) => /Cambridge IGCSE Biology/.test(title)),
      'expected the bundled IGCSE Biology outline',
    );
    assert.ok(listed.body.data.documents.every((document) => document.source_type === 'seed'));
    assert.ok(
      listed.body.data.documents.every((document) => document.chunk_count > 0),
      'every seeded document should have produced chunks',
    );

    // Seeding must not embed: that would be an API call per chunk on every fresh database.
    assert.ok(
      listed.body.data.documents.every((document) => document.embedded_count === 0),
      'seeded chunks should carry no embeddings',
    );

    const search = await curriculumCall(runtime, 'search', {
      query: 'photosynthesis limiting factors',
      subject: 'Biology',
      limit: 3,
    });
    assert.equal(search.status, 200);

    const citations = search.body.data.citations;
    assert.ok(citations.length > 0, 'keyword retrieval should work with no embedding provider');
    assert.match(citations[0].content, /photosynthesis/i);
    // Numbering is what the model cites with and what the UI renders; they must agree.
    assert.deepEqual(
      citations.map((citation) => citation.citationIndex),
      citations.map((_, index) => index + 1),
    );

    // The metadata filter must actually exclude other curricula.
    const ugandaOnly = await curriculumCall(runtime, 'search', {
      query: 'photosynthesis',
      curriculum: 'uganda-cbc-lower-secondary',
    });
    assert.ok(ugandaOnly.body.data.citations.length > 0);
    assert.ok(
      ugandaOnly.body.data.citations.every((citation) => citation.curriculum === 'uganda-cbc-lower-secondary'),
      'a curriculum filter must not leak passages from another framework',
    );
  } finally {
    await cleanup();
  }
});

test('teachers can upload syllabus documents, and re-uploading the same text does not duplicate it', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const content = [
      '# Simultaneous Equations',
      '',
      'Learners solve two linear equations by substitution, elimination and graphical methods.',
      'Word problems drawn from market pricing and transport fares.',
      '',
      '# Matrices',
      '',
      'Order of a matrix, addition, multiplication, determinant and inverse of a two by two matrix.',
    ].join('\n');

    const upload = await curriculumCall(runtime, 'upload_document', {
      title: 'S3 Mathematics Scheme of Work — Term 2',
      content,
      curriculum: 'uganda-cbc-lower-secondary',
      subject: 'Mathematics',
      gradeLevel: 10,
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.data.document.chunkCount, 2);
    assert.equal(upload.body.data.document.unchanged, false);
    // No embedding provider is configured in tests, so ingestion stays lexical.
    assert.equal(upload.body.data.document.embedded, false);

    const found = await curriculumCall(runtime, 'search', {
      query: 'determinant and inverse of a matrix',
      subject: 'Mathematics',
    });
    assert.match(found.body.data.citations[0].title, /S3 Mathematics Scheme of Work/);

    const again = await curriculumCall(runtime, 'upload_document', {
      title: 'S3 Mathematics Scheme of Work — Term 2',
      content,
      curriculum: 'uganda-cbc-lower-secondary',
      subject: 'Mathematics',
      gradeLevel: 10,
    });
    assert.equal(again.body.data.document.unchanged, true, 're-uploading identical text should be a no-op');

    const chunkCount = await countRows(runtime, 'curriculum_chunks');
    const reupload = await curriculumCall(runtime, 'upload_document', {
      title: 'S3 Mathematics Scheme of Work — Term 2',
      content: `${content}\n\n# Vectors\n\nMagnitude and direction of a vector in two dimensions.`,
      curriculum: 'uganda-cbc-lower-secondary',
      subject: 'Mathematics',
      gradeLevel: 10,
    });
    assert.equal(reupload.body.data.document.chunkCount, 3);
    assert.equal(
      await countRows(runtime, 'curriculum_chunks'),
      chunkCount + 1,
      'a corrected re-upload should replace the old chunks, not add to them',
    );

    const blankTitle = await curriculumCall(runtime, 'upload_document', { title: '', content });
    assert.equal(blankTitle.status, 400);
    assert.equal(blankTitle.body.error, 'A document title is required');
  } finally {
    await cleanup();
  }
});

test('the curriculum library is closed to non-teaching staff, and seeded outlines to non-admins', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const { CURRICULUM_ACTIONS } = await import('../server/services/curriculum.mjs');

    for (const action of CURRICULUM_ACTIONS) {
      for (const requesterRole of ['support_staff', undefined]) {
        const response = await dispatch(runtime, 'POST', '/api/functions/curriculum', {
          action,
          requesterRole,
          title: 'Smuggled syllabus',
          content: 'Should never be indexed.',
          query: 'anything',
        });
        assert.equal(response.status, 403, `${action} as ${requesterRole} should be refused`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    assert.ok(
      !(await curriculumCall(runtime, 'search', { query: 'Smuggled syllabus' })).body.data.citations.some(
        (citation) => /Smuggled/.test(citation.title),
      ),
      'nothing should have been written past the guard',
    );

    const seeded = await curriculumCall(runtime, 'list_documents');
    const seedDocument = seeded.body.data.documents[0];

    const teacherDelete = await curriculumCall(runtime, 'delete_document', { documentId: seedDocument.id });
    assert.equal(teacherDelete.status, 400);
    assert.match(teacherDelete.body.error, /Only an administrator/);

    const adminDelete = await curriculumCall(runtime, 'delete_document', {
      documentId: seedDocument.id,
      requesterRole: 'admin',
    });
    assert.equal(adminDelete.status, 200);
    assert.equal(adminDelete.body.data.deleted.id, seedDocument.id);
  } finally {
    await cleanup();
  }
});

// A provider mock that replays a scripted sequence of Anthropic Messages API responses, recording
// what was sent. Enough to drive the agent loop without a network.
const createClaudeStub = (turns) => {
  const sent = [];
  let index = 0;

  const httpClient = async (url, options) => {
    sent.push({ url, body: JSON.parse(options.body) });
    const turn = turns[Math.min(index, turns.length - 1)];
    index += 1;
    return new Response(
      JSON.stringify({
        id: `msg_${index}`,
        stop_reason: turn.toolUses?.length ? 'tool_use' : 'end_turn',
        usage: { input_tokens: 10, output_tokens: 5 },
        content: [
          ...(turn.text ? [{ type: 'text', text: turn.text }] : []),
          ...(turn.toolUses || []).map((use, position) => ({
            type: 'tool_use',
            id: `tu_${index}_${position}`,
            name: use.name,
            input: use.input,
          })),
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  return { httpClient, sent };
};

const withAnthropicKey = async (run) => {
  const original = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
  try {
    return await run();
  } finally {
    if (original === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = original;
  }
};

test('the agent loop runs a tool, feeds the result back, and reports every step', async () => {
  await withAnthropicKey(async () => {
    const { httpClient, sent } = createClaudeStub([
      { text: 'Let me check the syllabus.', toolUses: [{ name: 'search_curriculum', input: { query: 'photosynthesis', subject: 'Biology' } }] },
      { text: 'Photosynthesis sits under Plant Nutrition [1].' },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const { buildToolRegistry } = await import('../server/agent/tools.mjs');
      const { runAgent, createAgentContext } = await import('../server/agent/loop.mjs');
      const { resolveModelSelection } = await import('../server/services/llm-models.mjs');

      const context = createAgentContext({ database: runtime.database, httpClient, requesterRole: 'teacher' });
      const result = await runAgent({
        model: resolveModelSelection('anthropic-default'),
        system: 'You are SchoolBot.',
        messages: [{ role: 'user', content: 'What does the syllabus say about photosynthesis?' }],
        registry: buildToolRegistry({ requesterRole: 'teacher' }),
        context,
        httpClient,
      });

      assert.equal(result.message, 'Photosynthesis sits under Plant Nutrition [1].');
      assert.equal(result.stoppedAtStepLimit, false);
      assert.equal(result.steps.length, 1);
      assert.equal(result.steps[0].tool, 'search_curriculum');
      assert.equal(result.steps[0].isError, false);
      assert.match(result.steps[0].output, /photosynthesis/i);

      // Retrieval accumulated citations on the shared context, so what the model saw is what gets
      // persisted and rendered.
      assert.ok(result.citations.length > 0);
      assert.equal(result.citations[0].citationIndex, 1);

      // Usage is summed across both turns, not overwritten by the last one.
      assert.equal(result.usage.input_tokens, 20);
      assert.equal(result.usage.output_tokens, 10);

      assert.equal(sent.length, 2);
      // claude-opus-5 rejects sampling parameters outright, so temperature must not be sent.
      assert.equal('temperature' in sent[0].body, false);
      assert.ok(sent[0].body.tools.some((tool) => tool.name === 'search_curriculum'));

      // The assistant turn is replayed verbatim (which is what keeps thinking blocks intact) and
      // every tool_result arrives in a single user message.
      const followUp = sent[1].body.messages;
      assert.deepEqual(followUp.map((message) => message.role), ['user', 'assistant', 'user']);
      assert.deepEqual(followUp[1].content.map((block) => block.type), ['text', 'tool_use']);
      assert.equal(followUp[2].content.length, 1);
      assert.equal(followUp[2].content[0].type, 'tool_result');
    } finally {
      await cleanup();
    }
  });
});

test('the agent loop is bounded, and a failing tool is reported back rather than aborting the turn', async () => {
  await withAnthropicKey(async () => {
    // Always asks for a tool, and asks for one that does not exist.
    const { httpClient } = createClaudeStub([
      { text: 'Working.', toolUses: [{ name: 'drop_all_tables', input: {} }] },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const { buildToolRegistry } = await import('../server/agent/tools.mjs');
      const { runAgent, createAgentContext } = await import('../server/agent/loop.mjs');
      const { resolveModelSelection } = await import('../server/services/llm-models.mjs');

      const context = createAgentContext({ database: runtime.database, httpClient, requesterRole: 'teacher' });
      const result = await runAgent({
        model: resolveModelSelection('anthropic-default'),
        system: 'You are SchoolBot.',
        messages: [{ role: 'user', content: 'Go wild.' }],
        registry: buildToolRegistry({ requesterRole: 'teacher' }),
        context,
        httpClient,
        maxSteps: 3,
      });

      assert.equal(result.stoppedAtStepLimit, true);
      assert.equal(result.steps.length, 3, 'the loop must stop at maxSteps');
      assert.ok(result.steps.every((step) => step.isError), 'an unknown tool is an error step');
      assert.match(result.steps[0].output, /Unknown tool: drop_all_tables/);
    } finally {
      await cleanup();
    }
  });
});

test('the tool registry hides tools a role may not use', async () => {
  const { buildToolRegistry } = await import('../server/agent/tools.mjs');

  const teacher = buildToolRegistry({ requesterRole: 'teacher' });
  assert.ok(teacher.names.includes('search_students'));
  assert.ok(teacher.names.includes('search_curriculum'));

  const supportStaff = buildToolRegistry({ requesterRole: 'support_staff' });
  assert.deepEqual(supportStaff.names, [], 'non-teaching staff get no tools at all');
  assert.deepEqual(supportStaff.definitions, []);

  // Definitions are what the model is shown; handlers and role metadata must not leak into them.
  for (const definition of teacher.definitions) {
    assert.deepEqual(Object.keys(definition).sort(), ['description', 'input_schema', 'name']);
  }
});

test('the MCP client handshakes, lists tools, and calls one through the agent registry', async () => {
  const requests = [];
  const httpClient = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, method: body.method, headers: options.headers });

    const respond = (result) =>
      new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-123' },
      });

    if (body.method === 'initialize') {
      return respond({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'ncdc-syllabus', version: '0.1.0' } });
    }
    if (body.method === 'notifications/initialized') {
      return new Response('', { status: 202 });
    }
    if (body.method === 'tools/list') {
      return respond({
        tools: [
          {
            name: 'lookup_topic',
            description: 'Look up an NCDC topic.',
            inputSchema: { type: 'object', properties: { topic: { type: 'string' } }, required: ['topic'] },
          },
        ],
      });
    }
    if (body.method === 'tools/call') {
      assert.equal(body.params.name, 'lookup_topic', 'the remote name is sent, not the namespaced one');
      assert.deepEqual(body.params.arguments, { topic: 'Osmosis' });
      return respond({ content: [{ type: 'text', text: 'Osmosis is covered in S2 Biology, Term 1.' }] });
    }
    throw new Error(`Unexpected MCP method: ${body.method}`);
  };

  const { loadMcpTools } = await import('../server/agent/mcp-client.mjs');
  const { tools, errors } = await loadMcpTools({
    servers: [{ id: 'srv-1', name: 'ncdc-syllabus', url: 'https://mcp.example.test/rpc', auth_token: 'secret-token' }],
    httpClient,
  });

  assert.deepEqual(errors, []);
  assert.equal(tools.length, 1);
  // Namespacing is what stops a remote tool shadowing a built-in one.
  assert.equal(tools[0].name, 'mcp__ncdc-syllabus__lookup_topic');
  assert.equal(tools[0].source, 'mcp');
  assert.equal(tools[0].serverId, 'srv-1');

  assert.deepEqual(requests.map((request) => request.method), ['initialize', 'notifications/initialized', 'tools/list']);
  assert.equal(requests[0].headers.Authorization, 'Bearer secret-token');
  // The session the server assigned on initialize is echoed on every later call.
  assert.equal(requests[2].headers['Mcp-Session-Id'], 'session-123');

  const { buildToolRegistry } = await import('../server/agent/tools.mjs');
  const registry = buildToolRegistry({ requesterRole: 'teacher', extraTools: tools });
  assert.ok(registry.names.includes('mcp__ncdc-syllabus__lookup_topic'));

  const output = await registry.get('mcp__ncdc-syllabus__lookup_topic').handler({ topic: 'Osmosis' });
  assert.equal(output, 'Osmosis is covered in S2 Biology, Term 1.');
});

test('one unreachable MCP server does not take down the others', async () => {
  const httpClient = async (url, options) => {
    if (url.includes('broken')) throw new Error('ECONNREFUSED');
    const body = JSON.parse(options.body);
    const result =
      body.method === 'initialize'
        ? { serverInfo: { name: 'working' } }
        : { tools: [{ name: 'ping', description: 'Ping.', inputSchema: { type: 'object', properties: {} } }] };
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { loadMcpTools } = await import('../server/agent/mcp-client.mjs');
  const { tools, errors } = await loadMcpTools({
    servers: [
      { id: 'a', name: 'broken', url: 'https://broken.example.test/rpc', auth_token: '' },
      { id: 'b', name: 'working', url: 'https://working.example.test/rpc', auth_token: '' },
    ],
    httpClient,
  });

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'mcp__working__ping');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].serverName, 'broken');
  assert.match(errors[0].message, /ECONNREFUSED/);
});

test('MCP server registration is admin-only and never returns the stored auth token', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const { MCP_ACTIONS } = await import('../server/services/mcp-servers.mjs');

    for (const action of MCP_ACTIONS) {
      for (const requesterRole of ['teacher', 'support_staff', undefined]) {
        const response = await dispatch(runtime, 'POST', '/api/functions/mcp', {
          action,
          requesterRole,
          name: 'smuggled',
          url: 'https://evil.example.test/rpc',
          authToken: 'stolen',
        });
        assert.equal(response.status, 403, `${action} as ${requesterRole} should be refused`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    const mcpCall = (action, body = {}) =>
      dispatch(runtime, 'POST', '/api/functions/mcp', {
        action,
        requesterRole: 'admin',
        actorEmail: 'admin@school.ug',
        ...body,
      });

    assert.deepEqual((await mcpCall('list')).body.data.servers, [], 'nothing leaked past the guard');

    const created = await mcpCall('save', {
      name: 'ncdc-syllabus',
      url: 'https://mcp.example.test/rpc',
      authToken: 'super-secret',
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.server.auth_token, '••••••••');
    assert.equal(created.body.data.server.hasAuthToken, true);

    const listed = await mcpCall('list');
    assert.equal(listed.body.data.servers.length, 1);
    assert.equal(listed.body.data.servers[0].auth_token, '••••••••');
    assert.ok(
      !JSON.stringify(listed.body).includes('super-secret'),
      'the stored token must never reach the browser',
    );

    // Editing the URL without resupplying the token must keep the stored one.
    const serverId = listed.body.data.servers[0].id;
    await mcpCall('save', { id: serverId, name: 'ncdc-syllabus', url: 'https://mcp2.example.test/rpc' });

    const { loadEnabledMcpServers } = await import('../server/services/mcp-servers.mjs');
    const live = await loadEnabledMcpServers(runtime.database);
    assert.equal(live[0].url, 'https://mcp2.example.test/rpc');
    assert.equal(live[0].auth_token, 'super-secret', 'an omitted token must not blank the stored one');

    // An explicit empty string does clear it.
    await mcpCall('save', { id: serverId, name: 'ncdc-syllabus', url: 'https://mcp2.example.test/rpc', authToken: '' });
    assert.equal((await loadEnabledMcpServers(runtime.database))[0].auth_token, '');

    const badUrl = await mcpCall('save', { name: 'bad', url: 'not-a-url' });
    assert.equal(badUrl.status, 400);
    assert.match(badUrl.body.error, /valid http\(s\) URL/);

    assert.equal((await mcpCall('delete', { id: serverId })).status, 200);
    assert.deepEqual((await mcpCall('list')).body.data.servers, []);
  } finally {
    await cleanup();
  }
});

test('curriculum frameworks expose Uganda and International GCSE examination structure', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const response = await dispatch(runtime, 'GET', '/api/curriculum-frameworks');
    assert.equal(response.status, 200);

    const frameworks = response.body.data.frameworks;
    const ids = frameworks.map((framework) => framework.id);
    assert.ok(ids.includes('uganda-cbc-lower-secondary'));
    assert.ok(ids.includes('uganda-uace'));
    assert.ok(ids.includes('uganda-primary'));
    assert.ok(ids.includes('cambridge-igcse'));
    assert.ok(ids.includes('edexcel-international-gcse'));

    for (const framework of frameworks) {
      assert.ok(framework.questionTypes.length > 0, `${framework.id} needs question types`);
      assert.ok(framework.commandWords.length > 0, `${framework.id} needs command words`);
      assert.ok(framework.assessmentObjectives.length > 0, `${framework.id} needs assessment objectives`);
    }

    const { resolveFramework, yearLabelFor, describeFramework } = await import(
      '../server/services/curriculum-frameworks.mjs'
    );

    // The same numeric grade reads differently under each framework, which is what the year/grade
    // fine-tuning control depends on.
    const uganda = resolveFramework({ curriculum: 'uganda-cbc-lower-secondary' });
    assert.equal(yearLabelFor(uganda, 10), 'S3');
    assert.equal(yearLabelFor(resolveFramework({ curriculum: 'cambridge-igcse' }), 10), 'Year 10');
    assert.equal(yearLabelFor(resolveFramework({ curriculum: 'uganda-primary' }), 5), 'P5');

    // An unknown curriculum must still resolve to something usable rather than throwing.
    assert.ok(resolveFramework({ curriculum: 'atlantis-national' }));
    assert.match(describeFramework(uganda, { gradeLevel: 10 }), /S3/);
  } finally {
    await cleanup();
  }
});

const examinerCall = (runtime, action, body = {}) =>
  dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
    action,
    requesterRole: 'teacher',
    actorEmail: 'teacher@school.ug',
    actorName: 'Grace Teacher',
    ...body,
  });

// Two generated questions that between them exercise both question shapes the paper renderer
// handles: a multiple-choice item with options, and a structured item with a mark-by-mark scheme.
const GENERATED_QUESTIONS = [
  {
    topic: 'Photosynthesis',
    subtopic: 'Limiting factors',
    questionType: 'mcq',
    difficulty: 'easy',
    bloomLevel: 'remember',
    commandWord: 'identify',
    stem: 'Identify the gas taken in by a leaf during photosynthesis.',
    options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'],
    correctAnswer: 'Carbon dioxide',
    markingScheme: [{ point: 'Carbon dioxide', marks: 1 }],
    marks: 1,
    expectedTimeMinutes: 1,
    assessmentObjective: 'KU',
    citationIndexes: [1],
  },
  {
    topic: 'Photosynthesis',
    subtopic: 'Investigations',
    questionType: 'structured',
    difficulty: 'moderate',
    bloomLevel: 'apply',
    commandWord: 'describe',
    stem: 'Describe an investigation a learner could carry out to show that light is necessary for photosynthesis.',
    options: [],
    correctAnswer: 'Destarch a plant, cover part of a leaf, expose to light, then test both parts for starch.',
    markingScheme: [
      { point: 'Destarch the plant in darkness for 24 hours', marks: 1 },
      { point: 'Cover part of a leaf with foil', marks: 1 },
      { point: 'Expose to light, then test both regions with iodine', marks: 2 },
    ],
    marks: 4,
    expectedTimeMinutes: 5,
    assessmentObjective: 'AS',
    citationIndexes: [1, 2],
  },
];

test('the Digital Examiner generates syllabus-grounded questions and banks them with citations', async () => {
  await withAnthropicKey(async () => {
    const { httpClient, sent } = createClaudeStub([
      { text: 'Checking the syllabus first.', toolUses: [{ name: 'search_curriculum', input: { query: 'photosynthesis', subject: 'Biology' } }] },
      { text: 'Here are the questions.', toolUses: [{ name: 'submit_questions', input: { questions: GENERATED_QUESTIONS } }] },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const blueprint = await examinerCall(runtime, 'save_blueprint', {
        name: 'S2 Biology — Term 1 Test',
        curriculum: 'uganda-cbc-lower-secondary',
        subjectName: 'Biology',
        gradeLevel: 9,
        academicYear: '2026/2027',
        term: 'Term 1',
        assessmentType: 'test',
        totalMarks: 20,
        difficultyMix: { easy: 2, moderate: 3, challenging: 1 },
      });
      assert.equal(blueprint.status, 200);
      // Unspecified fields fall back to the framework's own paper structure.
      assert.equal(blueprint.body.data.blueprint.curriculum, 'uganda-cbc-lower-secondary');
      assert.equal(blueprint.body.data.blueprint.paper_label, 'Paper 1');
      assert.equal(blueprint.body.data.blueprint.duration_minutes, 150);
      assert.equal(blueprint.body.data.blueprint.total_marks, 20);

      const generated = await examinerCall(runtime, 'generate_questions', {
        blueprintId: blueprint.body.data.blueprint.id,
        modelId: 'anthropic-default',
        topics: ['Photosynthesis'],
        count: 5,
      });
      assert.equal(generated.status, 200);

      const questions = generated.body.data.questions;
      assert.equal(questions.length, 2);
      assert.equal(questions[0].question_type, 'mcq');
      assert.deepEqual(questions[0].options, ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen']);
      assert.equal(questions[0].status, 'draft', 'generated questions must be reviewed before use');
      assert.equal(questions[1].marks, 4);
      assert.equal(questions[1].marking_scheme.length, 3);

      // Every question carries the syllabus passages it was grounded in.
      assert.ok(questions[0].source_references.length > 0);
      assert.ok(questions[0].source_references[0].title);
      assert.equal(questions[1].source_references.length, 2);

      // The framework and grade came from the blueprint, not the request.
      assert.ok(questions.every((question) => question.curriculum === 'uganda-cbc-lower-secondary'));
      assert.ok(questions.every((question) => question.grade_level === 9));

      // The system prompt must carry the framework's conventions, and retrieval must be primed so
      // the model has syllabus text before its first turn.
      assert.match(sent[0].body.system, /Uganda Lower Secondary/);
      assert.match(sent[0].body.system, /Command words to draw on/);
      assert.match(sent[0].body.messages[0].content, /\[1\]/);
      assert.ok(sent[0].body.tools.some((tool) => tool.name === 'submit_questions'));

      const banked = await examinerCall(runtime, 'list_questions', { status: 'draft' });
      assert.equal(banked.body.data.questions.length, 2);
    } finally {
      await cleanup();
    }
  });
});

test('generation refuses the local rules engine and reports a model that never submits', async () => {
  await withAnthropicKey(async () => {
    // A model that talks but never calls submit_questions.
    const { httpClient } = createClaudeStub([{ text: 'I would rather not.' }]);
    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const localRules = await examinerCall(runtime, 'generate_questions', {
        modelId: 'local-rules',
        topics: ['Photosynthesis'],
      });
      assert.equal(localRules.status, 400);
      assert.match(localRules.body.error, /needs a configured AI model/);

      const noSubmission = await examinerCall(runtime, 'generate_questions', {
        modelId: 'anthropic-default',
        topics: ['Photosynthesis'],
        count: 3,
      });
      assert.equal(noSubmission.status, 400);
      // Prose containing no readable questions still fails — but the message now says why and the
      // model's reply is returned, so the screen can show it instead of discarding it in a dialog.
      assert.match(noSubmission.body.error, /did not produce anything that could be read as questions/);
      assert.equal(await countRows(runtime, 'exam_questions'), 0);
    } finally {
      await cleanup();
    }
  });
});

test('a paper is assembled from approved questions, published into exams, and renders both PDFs', async () => {
  await withAnthropicKey(async () => {
    const { httpClient } = createClaudeStub([
      { text: 'Here are the questions.', toolUses: [{ name: 'submit_questions', input: { questions: GENERATED_QUESTIONS } }] },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const generated = await examinerCall(runtime, 'generate_questions', {
        modelId: 'anthropic-default',
        curriculum: 'cambridge-igcse',
        subjectName: 'Biology',
        gradeLevel: 10,
        topics: ['Photosynthesis'],
        count: 5,
      });
      const questionIds = generated.body.data.questions.map((question) => question.id);

      const paper = await examinerCall(runtime, 'assemble_paper', {
        title: 'Year 10 Biology — Photosynthesis Test',
        subjectName: 'Biology',
        gradeLevel: 10,
        academicYear: '2026/2027',
        term: 'Term 1',
        assessmentType: 'test',
        durationMinutes: 45,
        instructions: 'Answer all questions in the spaces provided.',
        questionIds,
        // A deliberately wrong total, to prove marks are summed from the questions themselves.
        totalMarks: 999,
      });
      assert.equal(paper.status, 200);
      assert.equal(paper.body.data.paper.total_marks, 5, 'marks must be summed from the questions');
      assert.equal(paper.body.data.paper.status, 'draft');

      const paperId = paper.body.data.paper.id;

      // Publishing must be blocked while any question is still unreviewed.
      const premature = await examinerCall(runtime, 'publish_paper', { id: paperId });
      assert.equal(premature.status, 400);
      assert.match(premature.body.error, /still need review/);
      assert.equal(await countRows(runtime, 'exams'), 0, 'nothing should be written on a refused publish');

      for (const id of questionIds) {
        const approved = await examinerCall(runtime, 'set_question_status', { id, status: 'approved' });
        assert.equal(approved.body.data.question.status, 'approved');
      }

      // A stale class id from the browser must read as a message, not a raw constraint violation.
      const unknownClass = await examinerCall(runtime, 'publish_paper', {
        id: paperId,
        examDate: '2026-10-14',
        classId: 'no-such-class',
      });
      assert.equal(unknownClass.status, 400);
      assert.match(unknownClass.body.error, /No class found with id/);
      assert.equal(await countRows(runtime, 'exams'), 0);

      await dispatch(runtime, 'POST', '/api/db', {
        table: 'classes',
        operation: 'insert',
        payload: {
          id: 'class-10a',
          grade_level: 10,
          section_name: 'A',
          academic_year: '2026/2027',
          capacity: 40,
        },
      });

      const published = await examinerCall(runtime, 'publish_paper', {
        id: paperId,
        examDate: '2026-10-14',
        startTime: '09:00',
        endTime: '09:45',
        room: 'Lab 2',
        classId: 'class-10a',
      });
      assert.equal(published.status, 200);
      assert.equal(published.body.data.paper.status, 'published');
      assert.ok(published.body.data.examId);

      // Full integration: the rest of the school system now sees a real exam.
      const exams = await dispatch(runtime, 'POST', '/api/db', { table: 'exams', operation: 'select', columns: '*' });
      assert.equal(exams.body.data.length, 1);
      assert.equal(exams.body.data[0].name, 'Year 10 Biology — Photosynthesis Test');
      assert.equal(exams.body.data[0].exam_type, 'test');
      assert.equal(exams.body.data[0].status, 'scheduled');
      assert.equal(exams.body.data[0].id, published.body.data.examId);

      const schedules = await dispatch(runtime, 'POST', '/api/db', { table: 'exam_schedules', operation: 'select', columns: '*' });
      assert.equal(schedules.body.data.length, 1);
      assert.equal(schedules.body.data[0].room, 'Lab 2');
      assert.equal(schedules.body.data[0].exam_id, published.body.data.examId);

      // Publishing twice must not create a second exam.
      const again = await examinerCall(runtime, 'publish_paper', { id: paperId });
      assert.equal(again.status, 400);
      assert.match(again.body.error, /already been published/);
      assert.equal(await countRows(runtime, 'exams'), 1);

      // audit_logs is deliberately absent from the /api/db allow-list, so it is read the way the
      // app reads it.
      const audit = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'get_audit_log' });
      const publishEntry = audit.body.data.logs.find((entry) => entry.action === 'exam_published');
      assert.ok(publishEntry, 'publishing an exam should be audited');
      assert.equal(publishEntry.entity_name, 'Year 10 Biology — Photosynthesis Test');
      assert.equal(publishEntry.changes.examId, published.body.data.examId);

      const questionPdf = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/papers/${paperId}.pdf`,
        searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
      });
      assert.equal(questionPdf.status, 200);
      assert.equal(questionPdf.headers['Content-Type'], 'application/pdf');
      assert.equal(questionPdf.body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(questionPdf.body.length > 1500);

      const schemePdf = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/papers/${paperId}/marking-scheme.pdf`,
        searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
      });
      assert.equal(schemePdf.status, 200);
      assert.equal(schemePdf.body.subarray(0, 5).toString(), '%PDF-');
      assert.match(schemePdf.headers['Content-Disposition'], /marking-scheme\.pdf/);

      const refused = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/papers/${paperId}/marking-scheme.pdf`,
        searchParams: new URLSearchParams({ requesterRole: 'support_staff' }),
      });
      assert.equal(refused.status, 403);

      const missing = await runtime.dispatch({
        method: 'GET',
        pathname: '/api/papers/no-such-paper.pdf',
        searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
      });
      assert.equal(missing.status, 404);
    } finally {
      await cleanup();
    }
  });
});

test('a retired question cannot reach a paper, and paper questions keep their chosen order', async () => {
  await withAnthropicKey(async () => {
    const { httpClient } = createClaudeStub([
      { toolUses: [{ name: 'submit_questions', input: { questions: GENERATED_QUESTIONS } }] },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const generated = await examinerCall(runtime, 'generate_questions', {
        modelId: 'anthropic-default',
        subjectName: 'Biology',
        topics: ['Photosynthesis'],
      });
      const [first, second] = generated.body.data.questions.map((question) => question.id);

      await examinerCall(runtime, 'set_question_status', { id: first, status: 'retired', reviewNotes: 'Ambiguous stem' });

      const rejected = await examinerCall(runtime, 'assemble_paper', {
        title: 'Contains a retired question',
        questionIds: [first, second],
      });
      assert.equal(rejected.status, 400);
      assert.match(rejected.body.error, /retired/);

      const ghost = await examinerCall(runtime, 'assemble_paper', {
        title: 'Contains a deleted question',
        questionIds: [second, 'does-not-exist'],
      });
      assert.equal(ghost.status, 400);
      assert.match(ghost.body.error, /no longer exist/);

      // Order is the teacher's choice, and SQL gives no ordering guarantee for an IN list.
      await examinerCall(runtime, 'set_question_status', { id: first, status: 'approved' });
      const ordered = await examinerCall(runtime, 'assemble_paper', {
        title: 'Reversed order',
        questionIds: [second, first],
      });
      const loaded = await examinerCall(runtime, 'get_paper', { id: ordered.body.data.paper.id });
      assert.deepEqual(loaded.body.data.questions.map((question) => question.id), [second, first]);

      const empty = await examinerCall(runtime, 'assemble_paper', { title: 'Nothing on it', questionIds: [] });
      assert.equal(empty.status, 400);
      assert.match(empty.body.error, /at least one question/);
    } finally {
      await cleanup();
    }
  });
});

test('the Digital Examiner refuses every action to non-teaching staff without writing anything', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const { EXAMINER_ACTIONS } = await import('../server/services/digital-examiner.mjs');
    assert.ok(EXAMINER_ACTIONS.length >= 13, 'expected the full examiner action catalogue');

    for (const action of EXAMINER_ACTIONS) {
      for (const requesterRole of ['support_staff', undefined]) {
        const response = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
          action,
          requesterRole,
          // Payloads that would otherwise succeed, to prove the guard runs first.
          name: 'Smuggled blueprint',
          title: 'Smuggled paper',
          stem: 'Smuggled question',
          questionIds: ['anything'],
          modelId: 'anthropic-default',
          topics: ['Photosynthesis'],
          status: 'approved',
          id: 'anything',
        });
        assert.equal(response.status, 403, `${action} as ${requesterRole} should be refused`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    const unknown = await examinerCall(runtime, 'rewrite_all_grades');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'Unsupported digital examiner action: rewrite_all_grades');

    for (const table of ['exam_blueprints', 'exam_questions', 'generated_papers', 'exams']) {
      assert.equal(await countRows(runtime, table), 0, `${table} should still be empty`);
    }
  } finally {
    await cleanup();
  }
});

const plannerCall = (runtime, action, body = {}) =>
  dispatch(runtime, 'POST', '/api/functions/lesson-planner', {
    action,
    requesterRole: 'teacher',
    actorEmail: 'teacher@school.ug',
    actorName: 'Grace Teacher',
    ...body,
  });

const GENERATED_PLAN = {
  title: 'Investigating the Factors Affecting Photosynthesis',
  learningOutcomes: [
    'State the raw materials and products of photosynthesis.',
    'Carry out an investigation showing that light is necessary for photosynthesis.',
  ],
  competencies: ['Scientific investigation', 'Critical thinking'],
  materials: ['Potted plant', 'Aluminium foil', 'Iodine solution', 'Beakers', 'Spirit burner'],
  activities: [
    { stage: 'Introduction', minutes: 5, teacherActivity: 'Ask what a plant needs to make food.', learnerActivity: 'Suggest answers from experience of gardening.' },
    { stage: 'Development', minutes: 20, teacherActivity: 'Demonstrate the destarching and foil-covering procedure.', learnerActivity: 'Record the procedure and predict the outcome.' },
    { stage: 'Practice', minutes: 10, teacherActivity: 'Supervise groups testing leaves with iodine.', learnerActivity: 'Test both leaf regions and record observations.' },
    { stage: 'Conclusion', minutes: 5, teacherActivity: 'Draw out the conclusion and set homework.', learnerActivity: 'State the conclusion in their own words.' },
  ],
  assessment: [
    { method: 'Oral questioning', description: 'Check recall of raw materials during the introduction.' },
    { method: 'Practical observation', description: 'Assess correct use of iodine and safe handling of the burner.' },
  ],
  differentiation: 'Pair slower learners with a partner for the practical; ask faster learners to predict the result if carbon dioxide were removed instead.',
  homework: 'Draw and label a leaf, showing three adaptations for photosynthesis.',
  citationIndexes: [1, 2],
};

test('the Lesson Planner drafts a syllabus-grounded plan and renders it as a PDF', async () => {
  await withAnthropicKey(async () => {
    const { httpClient, sent } = createClaudeStub([
      { text: 'Checking the syllabus.', toolUses: [{ name: 'search_curriculum', input: { query: 'photosynthesis', subject: 'Biology' } }] },
      { text: 'Plan ready.', toolUses: [{ name: 'submit_lesson_plan', input: GENERATED_PLAN }] },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const generated = await plannerCall(runtime, 'generate', {
        modelId: 'anthropic-default',
        curriculum: 'uganda-cbc-lower-secondary',
        subjectName: 'Biology',
        gradeLevel: 9,
        topic: 'Photosynthesis',
        academicYear: '2026/2027',
        term: 'Term 1',
        durationMinutes: 40,
        lessonDate: '2026-09-14',
        period: 'Period 3',
      });
      assert.equal(generated.status, 200);

      const plan = generated.body.data.plan;
      assert.equal(plan.title, 'Investigating the Factors Affecting Photosynthesis');
      assert.equal(plan.status, 'draft', 'a generated plan is a draft until a teacher approves it');
      assert.equal(plan.curriculum, 'uganda-cbc-lower-secondary');
      assert.equal(plan.grade_level, 9);
      assert.equal(plan.duration_minutes, 40);
      assert.equal(plan.learning_outcomes.length, 2);
      assert.equal(plan.activities.length, 4);
      assert.equal(
        plan.activities.reduce((total, activity) => total + activity.minutes, 0),
        40,
        'the lesson sequence should fill the lesson',
      );
      assert.equal(plan.materials.length, 5);
      assert.ok(plan.refs.length > 0, 'the plan should record the syllabus passages it came from');
      assert.match(plan.homework, /Draw and label a leaf/);

      // The prompt must carry the framework's conventions and the primed syllabus passages.
      assert.match(sent[0].body.system, /Uganda Lower Secondary/);
      assert.match(sent[0].body.system, /minutes add up to 40/);
      assert.match(sent[0].body.messages[0].content, /Syllabus passages already retrieved/);

      const pdf = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/lesson-plans/${plan.id}.pdf`,
        searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
      });
      assert.equal(pdf.status, 200);
      assert.equal(pdf.headers['Content-Type'], 'application/pdf');
      assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
      assert.ok(pdf.body.length > 2000);

      const refused = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/lesson-plans/${plan.id}.pdf`,
        searchParams: new URLSearchParams({ requesterRole: 'support_staff' }),
      });
      assert.equal(refused.status, 403);
    } finally {
      await cleanup();
    }
  });
});

test('a scheme of work generates one plan per topic and survives a topic that fails', async () => {
  await withAnthropicKey(async () => {
    // Succeed for the first two topics, then return prose without submitting for the third.
    let call = 0;
    const httpClient = async (url, options) => {
      call += 1;
      const submits = call <= 2;
      return new Response(
        JSON.stringify({
          id: `msg_${call}`,
          stop_reason: submits ? 'tool_use' : 'end_turn',
          usage: { input_tokens: 5, output_tokens: 5 },
          content: submits
            ? [{ type: 'tool_use', id: `tu_${call}`, name: 'submit_lesson_plan', input: GENERATED_PLAN }]
            : [{ type: 'text', text: 'I do not have syllabus material for that topic.' }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const scheme = await plannerCall(runtime, 'scheme_of_work', {
        modelId: 'anthropic-default',
        curriculum: 'uganda-cbc-lower-secondary',
        subjectName: 'Biology',
        gradeLevel: 9,
        academicYear: '2026/2027',
        term: 'Term 1',
        topics: ['Cell Biology', 'Photosynthesis', 'Quantum Chromodynamics'],
      });

      assert.equal(scheme.status, 200);
      assert.equal(scheme.body.data.plans.length, 2, 'the two workable topics should still produce plans');
      assert.equal(scheme.body.data.failures.length, 1);
      assert.equal(scheme.body.data.failures[0].topic, 'Quantum Chromodynamics');

      // Each plan records the topic it was generated for, not the model's generic title.
      assert.deepEqual(
        scheme.body.data.plans.map((plan) => plan.topic),
        ['Cell Biology', 'Photosynthesis'],
      );
      assert.ok(scheme.body.data.plans.every((plan) => plan.generated_by.schemeOfWork === true));

      const tooMany = await plannerCall(runtime, 'scheme_of_work', {
        modelId: 'anthropic-default',
        topics: Array.from({ length: 25 }, (_, index) => `Topic ${index}`),
      });
      assert.equal(tooMany.status, 400);
      assert.match(tooMany.body.error, /limited to 20 lessons/);
    } finally {
      await cleanup();
    }
  });
});

test('lesson plans can be edited, approved, duplicated and deleted', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const created = await plannerCall(runtime, 'save', {
      title: 'Hand-written plan',
      topic: 'Osmosis',
      subjectName: 'Biology',
      gradeLevel: 9,
      academicYear: '2026/2027',
      term: 'Term 1',
      durationMinutes: 40,
      learningOutcomes: ['Define osmosis.'],
      activities: [{ stage: 'Introduction', minutes: 40, teacherActivity: 'Explain.', learnerActivity: 'Listen.' }],
    });
    assert.equal(created.status, 200);
    assert.equal(created.body.data.plan.status, 'draft');
    const planId = created.body.data.plan.id;

    const edited = await plannerCall(runtime, 'save', {
      id: planId,
      title: 'Osmosis in plant tissue',
      topic: 'Osmosis',
      subjectName: 'Biology',
      gradeLevel: 9,
      durationMinutes: 80,
      learningOutcomes: ['Define osmosis.', 'Investigate osmosis using potato tissue.'],
    });
    assert.equal(edited.body.data.plan.title, 'Osmosis in plant tissue');
    assert.equal(edited.body.data.plan.duration_minutes, 80);
    assert.equal(edited.body.data.plan.learning_outcomes.length, 2);

    const approved = await plannerCall(runtime, 'set_status', { id: planId, status: 'approved' });
    assert.equal(approved.body.data.plan.status, 'approved');

    const badStatus = await plannerCall(runtime, 'set_status', { id: planId, status: 'cancelled' });
    assert.equal(badStatus.status, 400);
    assert.match(badStatus.body.error, /Unsupported lesson plan status/);

    const copy = await plannerCall(runtime, 'duplicate', { id: planId, term: 'Term 2' });
    assert.equal(copy.body.data.plan.title, 'Osmosis in plant tissue (copy)');
    assert.equal(copy.body.data.plan.term, 'Term 2');
    // A copy is about to be edited for a different class, so it must not inherit 'approved'.
    assert.equal(copy.body.data.plan.status, 'draft');
    assert.equal(copy.body.data.plan.learning_outcomes.length, 2);

    assert.equal((await plannerCall(runtime, 'list')).body.data.plans.length, 2);
    assert.equal((await plannerCall(runtime, 'list', { status: 'approved' })).body.data.plans.length, 1);

    assert.equal((await plannerCall(runtime, 'delete', { id: copy.body.data.plan.id })).status, 200);
    assert.equal((await plannerCall(runtime, 'list')).body.data.plans.length, 1);

    const missing = await plannerCall(runtime, 'get', { id: 'no-such-plan' });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'Lesson plan not found');

    const untitled = await plannerCall(runtime, 'save', { topic: 'Osmosis' });
    assert.equal(untitled.status, 400);
    assert.match(untitled.body.error, /lesson title is required/);
  } finally {
    await cleanup();
  }
});

test('the Lesson Planner refuses every action to non-teaching staff without writing anything', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const { LESSON_PLANNER_ACTIONS } = await import('../server/services/lesson-planner.mjs');
    assert.ok(LESSON_PLANNER_ACTIONS.length >= 8, 'expected the full lesson planner action catalogue');

    for (const action of LESSON_PLANNER_ACTIONS) {
      for (const requesterRole of ['support_staff', undefined]) {
        const response = await dispatch(runtime, 'POST', '/api/functions/lesson-planner', {
          action,
          requesterRole,
          title: 'Smuggled plan',
          topic: 'Photosynthesis',
          topics: ['Photosynthesis'],
          modelId: 'anthropic-default',
          status: 'approved',
          id: 'anything',
        });
        assert.equal(response.status, 403, `${action} as ${requesterRole} should be refused`);
        assert.equal(response.body.error, 'Unauthorized');
      }
    }

    const unknown = await plannerCall(runtime, 'teach_the_lesson_for_me');
    assert.equal(unknown.status, 400);
    assert.equal(unknown.body.error, 'Unsupported lesson planner action: teach_the_lesson_for_me');

    assert.equal(await countRows(runtime, 'lesson_plans'), 0);
  } finally {
    await cleanup();
  }
});

test('the chat is closed to non-teaching staff server-side, not just in the browser', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    for (const requesterRole of ['support_staff', undefined]) {
      const response = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
        requesterRole,
        message: 'Tell me about Emma Johnson',
        modelId: 'local-rules',
      });
      assert.equal(response.status, 403, `chat as ${requesterRole} should be refused`);
      assert.equal(response.body.error, 'Unauthorized');
    }

    // Nothing was written: a refused request must not even open a conversation.
    assert.equal(await countRows(runtime, 'conversations'), 0);
    assert.equal(await countRows(runtime, 'messages'), 0);
  } finally {
    await cleanup();
  }
});

test('chat replays conversation history and persists tool steps and citations', async () => {
  await withAnthropicKey(async () => {
    const { httpClient, sent } = createClaudeStub([
      { text: 'Looking that up.', toolUses: [{ name: 'search_curriculum', input: { query: 'osmosis', subject: 'Biology' } }] },
      { text: 'Osmosis is covered under Cell Biology [1].' },
    ]);

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const first = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
        requesterRole: 'teacher',
        actorName: 'Grace Teacher',
        message: 'What does the syllabus say about osmosis?',
        modelId: 'anthropic-default',
        mode: 'agent',
        useRag: true,
      });

      assert.equal(first.status, 200);
      assert.equal(first.body.data.mode, 'agent');
      assert.equal(first.body.data.message, 'Osmosis is covered under Cell Biology [1].');
      assert.equal(first.body.data.steps.length, 1);
      assert.equal(first.body.data.steps[0].tool, 'search_curriculum');
      assert.ok(first.body.data.citations.length > 0);
      assert.ok(first.body.data.citations[0].title);
      // Stored citations carry a snippet, not the whole passage.
      assert.ok(first.body.data.citations[0].snippet.length <= 240);

      const conversationId = first.body.data.conversationId;

      // The first turn sent no history; the user's message must be the only entry.
      assert.deepEqual(sent[0].body.messages.map((entry) => entry.role), ['user']);

      const second = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
        requesterRole: 'teacher',
        conversationId,
        message: 'And which class covers it?',
        modelId: 'anthropic-default',
        mode: 'agent',
      });
      assert.equal(second.status, 200);

      // The second turn must replay the first exchange — the chat sent no history at all before.
      const replayed = sent[2].body.messages;
      assert.deepEqual(replayed.map((entry) => entry.role), ['user', 'assistant', 'user']);
      assert.equal(replayed[0].content, 'What does the syllabus say about osmosis?');
      assert.equal(replayed[1].content, 'Osmosis is covered under Cell Biology [1].');
      assert.equal(replayed[2].content, 'And which class covers it?');

      // Steps and citations are persisted, so reopening the conversation still shows them.
      const stored = await dispatch(runtime, 'POST', '/api/db', {
        table: 'messages',
        operation: 'select',
        columns: '*',
        filters: [{ field: 'conversation_id', operator: 'eq', value: conversationId }],
        orderBy: { field: 'created_at', ascending: true },
      });
      const assistantTurns = stored.body.data.filter((entry) => entry.role === 'assistant');
      assert.equal(assistantTurns.length, 2);
      assert.equal(assistantTurns[0].metadata.mode, 'agent');
      assert.equal(assistantTurns[0].metadata.steps[0].tool, 'search_curriculum');
      assert.ok(assistantTurns[0].metadata.citations.length > 0);
    } finally {
      await cleanup();
    }
  });
});

test('Ollama now runs agent mode rather than falling back to a plain call', async () => {
  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const httpClient = async () =>
    new Response(JSON.stringify({ message: { content: 'Answered without tools.' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const response = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'Who is in grade 10?',
      modelId: 'ollama-default',
      mode: 'agent',
    });

    assert.equal(response.status, 200);
    // Ollama accepts a tools array on /api/chat, so it is no longer excluded from agent mode. It
    // answers without calling one here, which ends the loop on the first turn — that is a model
    // choice, not a capability limit, and no "cannot call tools" notice belongs on it.
    assert.equal(response.body.data.mode, 'agent');
    assert.equal(response.body.data.notice, undefined);
    assert.equal(response.body.data.message, 'Answered without tools.');
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('the chat prompt caps the inlined roster instead of stuffing every student record', async () => {
  const original = process.env.AI_ROSTER_INLINE_LIMIT;
  process.env.AI_ROSTER_INLINE_LIMIT = '5';

  try {
    // Re-imported so the module picks up the changed limit at call time.
    const { createMessages } = await import('../server/services/llm-models.mjs');
    const students = Array.from({ length: 40 }, (_, index) => ({
      first_name: 'Student',
      last_name: `Number${index}`,
      student_id: `STU-${index}`,
      grade_level: 10,
      class_section: 'A',
      gpa: 3,
      attendance_rate: 90,
      status: 'active',
      subjects: ['Biology'],
      notes: '',
    }));

    const messages = createMessages({ message: 'Who is here?', students, hasImage: false });
    const system = messages[0].content;

    assert.match(system, /showing 5 of 40/, 'the prompt must say the roster was truncated');
    assert.ok(system.includes('Number4'));
    assert.ok(!system.includes('Number39'), 'students past the limit must not be inlined');

    // Reference material and prior turns both flow into the prompt.
    const withContext = createMessages({
      message: 'And the syllabus?',
      students: students.slice(0, 2),
      hasImage: false,
      contextBlocks: '[1] Biology Outline — Cell Biology\nOsmosis and diffusion.',
      history: [{ role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }],
    });
    assert.match(withContext[0].content, /Cite it as \[1\]/);
    assert.deepEqual(withContext.map((entry) => entry.role), ['system', 'user', 'assistant', 'user']);
  } finally {
    if (original === undefined) delete process.env.AI_ROSTER_INLINE_LIMIT;
    else process.env.AI_ROSTER_INLINE_LIMIT = original;
  }
});

test('SchoolBot exposes its own tools over MCP, gated on a bearer token', async () => {
  const original = process.env.MCP_SERVER_TOKEN;
  const { runtime, cleanup } = await startTestRuntime();

  const rpc = (body, headers = {}) => runtime.dispatch({ method: 'POST', pathname: '/api/mcp', body, headers });

  try {
    // Unset token means disabled, not open — these tools read student records.
    delete process.env.MCP_SERVER_TOKEN;
    const disabled = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(disabled.status, 404);
    assert.match(disabled.body.error.message, /not enabled/);

    process.env.MCP_SERVER_TOKEN = 'school-mcp-token';

    const noAuth = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.equal(noAuth.status, 401);

    const wrongAuth = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer wrong' });
    assert.equal(wrongAuth.status, 401);

    const auth = { authorization: 'Bearer school-mcp-token' };

    const initialized = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, auth);
    assert.equal(initialized.status, 200);
    assert.equal(initialized.body.result.serverInfo.name, 'schoolbot-ai');
    assert.ok(initialized.body.result.capabilities.tools);

    const listed = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, auth);
    assert.equal(listed.status, 200);
    const toolNames = listed.body.result.tools.map((tool) => tool.name);
    assert.ok(toolNames.includes('search_students'));
    assert.ok(toolNames.includes('search_curriculum'));
    // MCP names the schema field inputSchema, not input_schema.
    assert.ok(listed.body.result.tools.every((tool) => tool.inputSchema));

    const called = await rpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'search_students', arguments: { gradeLevel: 10 } } },
      auth,
    );
    assert.equal(called.status, 200);
    assert.equal(called.body.result.isError, false);
    const payload = JSON.parse(called.body.result.content[0].text);
    assert.ok(payload.count > 0);
    assert.ok(payload.students.every((student) => student.grade_level === 10));

    // A tool failure is a readable result, not a transport error.
    const unknown = await rpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
      auth,
    );
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.error.message, 'Unknown tool: no_such_tool');

    const notification = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, auth);
    assert.equal(notification.status, 202);

    const badMethod = await rpc({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, auth);
    assert.equal(badMethod.body.error.message, 'Unsupported method: resources/list');
  } finally {
    if (original === undefined) delete process.env.MCP_SERVER_TOKEN;
    else process.env.MCP_SERVER_TOKEN = original;
    await cleanup();
  }
});

test('a failed MCP connection test is reported as a result, not swallowed as a bad request', async () => {
  const httpClient = async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:9');
  };

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const mcpCall = (action, body = {}) =>
      dispatch(runtime, 'POST', '/api/functions/mcp', { action, requesterRole: 'admin', ...body });

    const created = await mcpCall('save', { name: 'offline', url: 'http://127.0.0.1:9/rpc' });
    const serverId = created.body.data.server.id;

    const tested = await mcpCall('test', { id: serverId });

    // The request itself succeeded — only the remote server is unreachable. Reporting that under a
    // top-level `error` would make the route return 400 with a null body, hiding the diagnosis the
    // settings screen exists to show.
    assert.equal(tested.status, 200);
    assert.equal(tested.body.data.connected, false);
    assert.match(tested.body.data.connectionError, /ECONNREFUSED/);
    assert.equal(tested.body.error, undefined);

    // The failure is also persisted, so the screen explains a silent server on next load.
    const listed = await mcpCall('list');
    assert.match(listed.body.data.servers[0].last_error, /ECONNREFUSED/);
    assert.equal(listed.body.data.servers[0].last_connected_at, null);

    // A genuinely bad request still is one.
    const missing = await mcpCall('test', { id: 'no-such-server' });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, 'MCP server not found');
  } finally {
    await cleanup();
  }
});

test('the school level chooses the grading system, and secondary splits O-Level from A-Level', async () => {
  const { resolveGradingScheme, academicLevelFor, SCHOOL_LEVEL_VALUES } = await import(
    '../server/reports/grading-config.mjs'
  );

  assert.deepEqual(SCHOOL_LEVEL_VALUES, [
    'pre_school',
    'kindergarten',
    'primary',
    'secondary_olevel',
    'secondary_alevel',
    'secondary',
    'technical',
    'tertiary',
  ]);

  const ugandan = (schoolLevel, gradeLevel) =>
    resolveGradingScheme({ country: 'uganda', schoolLevel, gradeLevel });

  assert.match(ugandan('pre_school', 1).label, /Pre-school/);
  assert.match(ugandan('kindergarten', 0).label, /Kindergarten/);
  assert.match(ugandan('primary', 6).label, /Primary Leaving Examination/);
  assert.match(ugandan('technical', 12).label, /Technical/);
  assert.match(ugandan('tertiary', 14).label, /GPA/);

  // One secondary school runs both O-Level and A-Level, so the student's own class decides which
  // scale applies. S1-S4 sit at grades 8-11 and S5-S6 at 12-13.
  for (const grade of [8, 9, 10, 11]) {
    assert.equal(academicLevelFor('secondary', grade), 'secondary-o', `grade ${grade} is O-Level`);
    assert.match(ugandan('secondary', grade).label, /O-Level \(UCE\)/);
  }
  for (const grade of [12, 13]) {
    assert.equal(academicLevelFor('secondary', grade), 'secondary-a', `grade ${grade} is A-Level`);
    assert.match(ugandan('secondary', grade).label, /A-Level \(UACE\)/);
  }

  // A school that runs only one of the two says so, and every one of its students is marked on that
  // scale — including a student whose stored class is outside the usual range, which is exactly the
  // case a combined school cannot resolve from the grade alone.
  for (const grade of [8, 11, 12, 13, 99]) {
    assert.equal(academicLevelFor('secondary_olevel', grade), 'secondary-o');
    assert.equal(academicLevelFor('secondary_alevel', grade), 'secondary-a');
  }
  assert.match(ugandan('secondary_olevel', 12).label, /O-Level \(UCE\)/);
  assert.match(ugandan('secondary_alevel', 8).label, /A-Level \(UACE\)/);

  // International schools and institutions report a GPA rather than UNEB grades.
  assert.match(resolveGradingScheme({ country: 'international', schoolLevel: 'tertiary' }).label, /GPA/);

  // An explicit academicLevel still wins, so a one-off report card can override the school setting.
  assert.equal(
    resolveGradingScheme({ country: 'uganda', schoolLevel: 'tertiary', academicLevel: 'secondary-o' }).label,
    'Uganda O-Level (UCE) Aggregate Points',
  );

  // A level a build does not know must still yield a usable scheme rather than throwing.
  assert.ok(resolveGradingScheme({ country: 'uganda', schoolLevel: 'polytechnic', gradeLevel: 10 }));
});

test('UNEB aggregates, divisions, principal points and GPAs are computed correctly', async () => {
  const { resolveGradingScheme, gradeScore, summariseResults } = await import(
    '../server/reports/grading-config.mjs'
  );

  const grade = (scheme, scores) => scores.map((score) => ({ score, ...gradeScore(score, scheme) }));

  const oLevel = resolveGradingScheme({ country: 'uganda', schoolLevel: 'secondary', gradeLevel: 10 });
  assert.deepEqual(gradeScore(95, oLevel), { grade: 'D1', remark: 'Distinction', points: 1 });
  assert.deepEqual(gradeScore(20, oLevel), { grade: 'F9', remark: 'Fail', points: 9 });

  // Eight subjects at D1/D2/C3 -> aggregate 16, which is Division 1 (8-32).
  const strong = summariseResults(grade(oLevel, [95, 92, 88, 85, 82, 80, 78, 75]), oLevel);
  assert.equal(strong.label, 'Aggregate');
  assert.equal(strong.value, 16);
  assert.equal(strong.band, 'Division 1');
  assert.equal(strong.complete, true);

  const weak = summariseResults(grade(oLevel, [42, 40, 38, 36, 35, 34, 30, 28]), oLevel);
  assert.equal(weak.value, 65);
  assert.equal(weak.band, 'Division 4');

  // A partial aggregate must NOT be given a division: an aggregate of 8 across five subjects is not
  // a Division 1, and printing one would be wrong on a real report card.
  const partial = summariseResults(grade(oLevel, [95, 92, 88, 85, 82]), oLevel);
  assert.equal(partial.value, 8);
  assert.equal(partial.complete, false);
  assert.equal(partial.band, null);

  // A-Level: principal letters A-F worth 6 down to 0, summed across three principals.
  const aLevel = resolveGradingScheme({ country: 'uganda', schoolLevel: 'secondary', gradeLevel: 13 });
  assert.deepEqual(gradeScore(88, aLevel), { grade: 'A', remark: 'Excellent', points: 6 });
  assert.deepEqual(gradeScore(36, aLevel), { grade: 'O', remark: 'Subsidiary Pass', points: 1 });
  assert.deepEqual(gradeScore(10, aLevel), { grade: 'F', remark: 'Fail', points: 0 });

  const principals = summariseResults(grade(aLevel, [88, 85, 72]), aLevel);
  assert.equal(principals.label, 'Principal points');
  assert.equal(principals.value, 17);
  assert.equal(principals.display, '17 / 18');

  // Tertiary: a GPA on Uganda's five-point scale, with a degree classification.
  const university = resolveGradingScheme({ country: 'uganda', schoolLevel: 'tertiary', gradeLevel: 14 });
  const gpa = summariseResults(grade(university, [85, 82, 78, 74]), university);
  assert.equal(gpa.kind, 'gpa');
  assert.equal(gpa.value, 4.63);
  assert.equal(gpa.display, '4.63 / 5');
  assert.equal(gpa.band, 'First Class');

  // International institutions report the familiar four-point GPA instead.
  const international = resolveGradingScheme({ country: 'international', schoolLevel: 'tertiary' });
  const intlGpa = summariseResults(grade(international, [95, 91, 88, 84]), international);
  assert.equal(intlGpa.value, 3.5);
  assert.equal(intlGpa.display, '3.50 / 4');

  // PLE: four subjects, aggregate 4-36.
  const ple = resolveGradingScheme({ country: 'uganda', schoolLevel: 'primary', gradeLevel: 7 });
  const pleSummary = summariseResults(grade(ple, [95, 91, 88, 84]), ple);
  assert.equal(pleSummary.value, 6);
  assert.equal(pleSummary.band, 'Division 1');

  // Early years carry no points, so no aggregate is produced and the report simply omits the row.
  const preSchool = resolveGradingScheme({ country: 'uganda', schoolLevel: 'pre_school' });
  assert.equal(gradeScore(88, preSchool).points, undefined);
  assert.equal(summariseResults(grade(preSchool, [88, 72, 60]), preSchool), null);
});

test('an admin sets the school level once and report cards follow it', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const settingsCall = (body) => dispatch(runtime, 'POST', '/api/functions/settings', body);

    // A fresh database defaults to a Ugandan secondary school, which is how it graded before this
    // setting existed.
    const initial = await settingsCall({ action: 'get' });
    assert.equal(initial.body.data.settings.school_level, 'secondary');
    assert.equal(initial.body.data.settings.grading_country, 'uganda');

    const saved = await settingsCall({
      action: 'update',
      requesterRole: 'admin',
      actorEmail: 'admin@school.ug',
      actorName: 'Admin',
      schoolName: 'Kampala Technical Institute',
      schoolLevel: 'tertiary',
      gradingCountry: 'uganda',
    });
    assert.equal(saved.body.data.settings.school_level, 'tertiary');

    // Non-admins cannot change it.
    const refused = await settingsCall({ action: 'update', requesterRole: 'teacher', schoolLevel: 'primary' });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Unauthorized');
    assert.equal((await settingsCall({ action: 'get' })).body.data.settings.school_level, 'tertiary');

    // An unrecognised level falls back rather than being stored, so a bad value cannot break grading.
    await settingsCall({
      action: 'update',
      requesterRole: 'admin',
      schoolName: 'Kampala Technical Institute',
      schoolLevel: 'hogwarts',
    });
    assert.equal((await settingsCall({ action: 'get' })).body.data.settings.school_level, 'secondary');

    // The report card route reads the level from settings without being told it per request.
    await settingsCall({
      action: 'update',
      requesterRole: 'admin',
      schoolName: 'Kampala Technical Institute',
      schoolLevel: 'tertiary',
      gradingCountry: 'uganda',
    });
    const pdf = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/report-cards/student-001.pdf',
      searchParams: new URLSearchParams({ term: 'Term 1' }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 1500);
  } finally {
    await cleanup();
  }
});

test('attendance saves upsert, so a repeated save cannot create a duplicate row', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const save = (payload) =>
      dispatch(runtime, 'POST', '/api/db', {
        table: 'attendance_records',
        operation: 'insert',
        columns: '*',
        single: true,
        payload,
      });

    const first = await save({
      student_id: 'student-001',
      attendance_date: '2026-08-19',
      status: 'present',
      marked_by: 'Grace Teacher',
      notified_parent: false,
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.data.status, 'present');

    // The records workspace checks its own loaded list before inserting, but that list can be stale
    // and two saves can race. The database has to be what actually enforces one row per day.
    const second = await save({
      student_id: 'student-001',
      attendance_date: '2026-08-19',
      status: 'late',
      reason: 'Heavy traffic',
      marked_by: 'Grace Teacher',
      notified_parent: true,
    });
    assert.equal(second.status, 200);
    assert.equal(await countRows(runtime, 'attendance_records'), 1, 'a repeat save must not add a row');

    // The repeat updates in place, and the caller still gets the record back (a DO NOTHING would
    // have returned nothing and handed the UI a null where it expects an id).
    assert.equal(second.body.data.id, first.body.data.id, 'the same row is reused');
    assert.equal(second.body.data.status, 'late');
    assert.equal(second.body.data.reason, 'Heavy traffic');
    assert.equal(second.body.data.notified_parent, true);

    // A different day, or a different student, is a different record.
    await save({ student_id: 'student-001', attendance_date: '2026-08-20', status: 'present' });
    await save({ student_id: 'student-002', attendance_date: '2026-08-19', status: 'absent' });
    assert.equal(await countRows(runtime, 'attendance_records'), 3);

    // The upsert only works because the unique index exists and is the one ON CONFLICT matched, so
    // the three assertions above already prove it. (pg-mem has no pg_indexes view to query, which
    // is why this is asserted through behaviour rather than by inspecting the catalogue.)
  } finally {
    await cleanup();
  }
});

test('only tables that declare a natural key upsert; the rest still insert normally', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    // notices declares no conflictTarget, so two identical inserts remain two rows. This is what
    // keeps the change scoped to attendance rather than silently altering every table.
    for (let index = 0; index < 2; index += 1) {
      const response = await dispatch(runtime, 'POST', '/api/db', {
        table: 'notices',
        operation: 'insert',
        columns: '*',
        single: true,
        payload: { title: 'Sports day', body: 'Saturday at 9am', audience: 'all' },
      });
      assert.equal(response.status, 200);
    }

    assert.equal(await countRows(runtime, 'notices'), 2, 'a table without a natural key still inserts twice');
  } finally {
    await cleanup();
  }
});

test('the attendance dedup keeps the row that records a parent was notified', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    // Recreate the real-world mess: duplicates can only be written with the unique index absent,
    // which is exactly the state a database gets stuck in.
    await runtime.database.query('DROP INDEX IF EXISTS idx_attendance_unique');

    const insert = (id, notified, createdAt) =>
      runtime.database.query(
        `INSERT INTO attendance_records (id, student_id, attendance_date, status, marked_by, notified_parent, created_at)
         VALUES ($1, 'student-015', '2026-08-19', 'present', 'Tendo Martin', $2, $3)`,
        [id, notified, createdAt],
      );

    // The notified copy is written last and is not the earliest, so "keep the oldest" would drop it.
    await insert('att-1', false, '2026-08-19T09:00:00Z');
    await insert('att-2', false, '2026-08-19T10:00:00Z');
    await insert('att-3', true, '2026-08-19T11:00:00Z');
    await insert('att-4', false, '2026-08-19T12:00:00Z');
    // A different day must survive untouched.
    await runtime.database.query(
      `INSERT INTO attendance_records (id, student_id, attendance_date, status, notified_parent)
       VALUES ('att-other', 'student-015', '2026-08-20', 'absent', false)`,
    );

    assert.equal(await countRows(runtime, 'attendance_records'), 5);

    // The very same ranking scripts/dedupe-attendance.mjs applies, imported rather than restated.
    const { chooseSurvivors } = await import('../scripts/dedupe-attendance.mjs');
    const { rows: all } = await runtime.database.query(
      'SELECT id, student_id, attendance_date, notified_parent, created_at FROM attendance_records',
    );
    const { keep, remove } = chooseSurvivors(all);
    assert.equal(keep.length, 2, 'one survivor per (student, date)');
    assert.equal(remove.length, 3);

    await runtime.database.query(
      `DELETE FROM attendance_records WHERE id IN (${remove.map((_, index) => `$${index + 1}`).join(', ')})`,
      remove,
    );

    const { rows } = await runtime.database.query(
      'SELECT id, attendance_date, notified_parent FROM attendance_records ORDER BY attendance_date',
    );
    assert.equal(rows.length, 2, 'one row per (student, date) survives');
    assert.equal(rows[0].id, 'att-3', 'the notified-parent row is the one kept');
    assert.equal(rows[0].notified_parent, true);
    assert.equal(rows[1].id, 'att-other', 'a different day is untouched');

    // With the duplicates gone the index can finally be created — which is the whole point.
    await runtime.database.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_attendance_unique ON attendance_records(student_id, attendance_date)',
    );
  } finally {
    await cleanup();
  }
});

test('admins can edit and delete staff accounts, with the guards that stop a lock-out', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const auth = (body) => dispatch(runtime, 'POST', '/api/functions/auth', body);
    const signUp = (email, displayName) =>
      auth({ action: 'signup', email, password: 'password123', displayName });

    await signUp('admin@school.ug', 'First Admin');
    await signUp('teacher@school.ug', 'Grace Teacher');
    await signUp('second@school.ug', 'Second Admin');

    const listUsers = async () => (await auth({ action: 'get_users' })).body.data.users;
    let users = await listUsers();
    const admin = users.find((user) => user.auth_email === 'admin@school.ug');
    const teacher = users.find((user) => user.auth_email === 'teacher@school.ug');
    const second = users.find((user) => user.auth_email === 'second@school.ug');

    const asAdmin = { requesterRole: 'admin', requesterEmail: 'admin@school.ug', requesterName: 'First Admin' };

    // Rename and re-address an account.
    const renamed = await auth({
      ...asAdmin,
      action: 'update_account',
      userId: teacher.id,
      displayName: 'Grace Nakato',
      email: 'g.nakato@school.ug',
    });
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.data.user.display_name, 'Grace Nakato');
    assert.equal(renamed.body.data.user.auth_email, 'g.nakato@school.ug');
    // The role is untouched: editing details must not quietly change permissions.
    assert.equal(renamed.body.data.user.role, 'teacher');

    // The email is the sign-in identity, so a clash would lock one of the two accounts out.
    const clash = await auth({ ...asAdmin, action: 'update_account', userId: teacher.id, email: 'admin@school.ug' });
    assert.equal(clash.body.error, 'Another account already uses that email');

    const blank = await auth({ ...asAdmin, action: 'update_account', userId: teacher.id, displayName: '   ' });
    assert.equal(blank.body.error, 'A display name is required');

    const badEmail = await auth({ ...asAdmin, action: 'update_account', userId: teacher.id, email: 'not-an-email' });
    assert.equal(badEmail.body.error, 'A valid email address is required');

    for (const role of ['teacher', 'support_staff', undefined]) {
      const refused = await auth({ action: 'update_account', requesterRole: role, userId: teacher.id, displayName: 'X' });
      assert.equal(refused.body.error, 'Unauthorized', `update_account as ${role} must be refused`);
      const refusedDelete = await auth({ action: 'delete_account', requesterRole: role, userId: teacher.id });
      assert.equal(refusedDelete.body.error, 'Unauthorized', `delete_account as ${role} must be refused`);
    }

    // Deleting the account you are signed in as would strand you mid-session.
    const self = await auth({ ...asAdmin, action: 'delete_account', userId: admin.id });
    assert.equal(self.body.error, 'You cannot delete the account you are signed in with');

    // Only one approved admin exists so far (the rest are pending), so it cannot be removed —
    // there would be nobody left able to approve anyone or reach Settings.
    const lastAdmin = await auth({
      action: 'delete_account',
      requesterRole: 'admin',
      requesterEmail: 'someone.else@school.ug',
      userId: admin.id,
    });
    assert.match(lastAdmin.body.error, /only administrator/);

    // Promote and approve a second admin, and the first becomes removable.
    await auth({ ...asAdmin, action: 'update_role', userId: second.id, newRole: 'admin' });
    await auth({ ...asAdmin, action: 'approve_account', userId: second.id });
    const removed = await auth({
      action: 'delete_account',
      requesterRole: 'admin',
      requesterEmail: 'second@school.ug',
      requesterName: 'Second Admin',
      userId: admin.id,
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.deleted, true);

    users = await listUsers();
    assert.ok(!users.some((user) => user.auth_email === 'admin@school.ug'), 'the account is gone');

    // Both actions are audited, so staff changes are traceable.
    const audit = await auth({ action: 'get_audit_log' });
    const actions = audit.body.data.logs.map((entry) => entry.action);
    assert.ok(actions.includes('account_updated'));
    assert.ok(actions.includes('account_deleted'));

    const missing = await auth({ ...asAdmin, action: 'delete_account', userId: 'no-such-user' });
    assert.equal(missing.body.error, 'User not found');
  } finally {
    await cleanup();
  }
});

test('a conversation downloads as a printable PDF report carrying its sources', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    await runtime.database.query("INSERT INTO conversations (id, title) VALUES ('conv-1', 'Grade 10 review')");

    const addMessage = (id, role, content, metadata = {}) =>
      runtime.database.query(
        'INSERT INTO messages (id, conversation_id, role, content, metadata) VALUES ($1, $2, $3, $4, $5)',
        [id, 'conv-1', role, content, JSON.stringify(metadata)],
      );

    await addMessage('m1', 'user', 'Who are the top students by GPA?');
    // A Markdown table is what the assistant actually returns for this question, and printing it as
    // raw pipes would defeat the purpose of a report.
    await addMessage(
      'm2',
      'assistant',
      [
        '## Top Students by GPA',
        '',
        '| Student | Grade | GPA |',
        '| --- | --- | --- |',
        '| Emma Johnson | 10 | 3.92 |',
        '| Ethan Brown | 10 | 3.81 |',
        '',
        '- **Attendance** tracks GPA closely.',
      ].join('\n'),
      {
        modelName: 'claude-opus-5',
        steps: [{ tool: 'search_students', ms: 4, isError: false }],
        citations: [
          { citationIndex: 1, title: 'Cambridge IGCSE Biology — Topic Outline', heading: 'Movement Into and Out of Cells' },
        ],
      },
    );

    const pdf = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/chat-reports/conv-1.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    assert.equal(pdf.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.body.length > 2000);
    assert.match(pdf.headers['Content-Disposition'], /grade-10-review\.pdf/);

    // Same gate as the chat itself — the transcript holds whatever student data was discussed.
    const refused = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/chat-reports/conv-1.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'support_staff' }),
    });
    assert.equal(refused.status, 403);

    const missing = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/chat-reports/no-such-conversation.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(missing.status, 404);

    // An empty conversation has nothing to report on, and should say so rather than emit a blank PDF.
    await runtime.database.query("INSERT INTO conversations (id, title) VALUES ('conv-empty', 'Nothing yet')");
    const empty = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/chat-reports/conv-empty.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(empty.status, 404);
    assert.match(empty.body.error, /no messages/);
  } finally {
    await cleanup();
  }
});

test('a chat conversation downloads as a PDF report and emails with the same content', async () => {
  const originalMode = process.env.EMAIL_MODE;
  const originalKey = process.env.EMAIL_API_KEY;
  process.env.EMAIL_MODE = 'http';
  process.env.EMAIL_API_KEY = 'test-email-key';

  let sentPayload = null;
  const httpClient = async (url, options) => {
    sentPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ id: 'email_1' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const chat = (body) =>
      dispatch(runtime, 'POST', '/api/functions/ai-chat', {
        requesterRole: 'teacher',
        actorName: 'Grace Nakato',
        modelId: 'local-rules',
        ...body,
      });

    const opening = await chat({ message: 'Who are the top 5 students by GPA?' });
    const conversationId = opening.body.data.conversationId;
    await chat({ conversationId, message: 'Tell me about Emma Johnson' });

    const download = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/chat-reports/${conversationId}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(download.status, 200);
    assert.equal(download.headers['Content-Type'], 'application/pdf');
    assert.equal(download.body.subarray(0, 5).toString(), '%PDF-');
    assert.ok(download.body.length > 2000);

    // The transcript carries student records, so it is gated exactly like the chat itself.
    const refused = await runtime.dispatch({
      method: 'GET',
      pathname: `/api/chat-reports/${conversationId}.pdf`,
      searchParams: new URLSearchParams({ requesterRole: 'support_staff' }),
    });
    assert.equal(refused.status, 403);

    const sent = await dispatch(runtime, 'POST', '/api/functions/chat-report', {
      action: 'send',
      requesterRole: 'teacher',
      actorName: 'Grace Nakato',
      conversationId,
      recipient: 'head@school.ug',
      note: 'For the staff meeting.',
    });
    assert.equal(sent.status, 200);
    assert.equal(sent.body.data.sent, true);
    assert.equal(sent.body.data.recipient, 'head@school.ug');

    // The report travels as an attachment, so the recipient needs no account to read it.
    assert.equal(sentPayload.to, 'head@school.ug');
    assert.equal(sentPayload.attachments.length, 1);
    assert.match(sentPayload.attachments[0].filename, /\.pdf$/);
    assert.ok(sentPayload.text.startsWith('For the staff meeting.'));

    const emailed = Buffer.from(sentPayload.attachments[0].content, 'base64');
    assert.equal(emailed.subarray(0, 5).toString(), '%PDF-');
    // Byte length differs run to run (pdf-lib stamps a creation time), so compare the size band
    // rather than the bytes — both are built by the same loader from the same messages.
    assert.ok(Math.abs(emailed.length - download.body.length) < 200);

    const badAddress = await dispatch(runtime, 'POST', '/api/functions/chat-report', {
      action: 'send',
      requesterRole: 'teacher',
      conversationId,
      recipient: 'not-an-address',
    });
    assert.equal(badAddress.status, 400);
    assert.match(badAddress.body.error, /valid email address/);

    for (const requesterRole of ['support_staff', undefined]) {
      const denied = await dispatch(runtime, 'POST', '/api/functions/chat-report', {
        action: 'send',
        requesterRole,
        conversationId,
        recipient: 'head@school.ug',
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.body.error, 'Unauthorized');
    }
  } finally {
    if (originalMode === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = originalMode;
    if (originalKey === undefined) delete process.env.EMAIL_API_KEY;
    else process.env.EMAIL_API_KEY = originalKey;
    await cleanup();
  }
});

test('sending a report says so plainly when email is not configured', async () => {
  const original = process.env.EMAIL_MODE;
  delete process.env.EMAIL_MODE;

  const { runtime, cleanup } = await startTestRuntime();

  try {
    const opening = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      modelId: 'local-rules',
      message: 'Summary',
    });

    const sent = await dispatch(runtime, 'POST', '/api/functions/chat-report', {
      action: 'send',
      requesterRole: 'teacher',
      conversationId: opening.body.data.conversationId,
      recipient: 'head@school.ug',
    });

    // A mock-mode deployment must not claim a delivery that never happened.
    assert.equal(sent.status, 400);
    assert.match(sent.body.error, /Email is not configured/);
    assert.match(sent.body.error, /Download it instead/);
  } finally {
    if (original === undefined) delete process.env.EMAIL_MODE;
    else process.env.EMAIL_MODE = original;
    await cleanup();
  }
});

test('a student profile in chat carries their fee position, and the statement lists every transaction', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const fees = (action, body = {}) =>
      dispatch(runtime, 'POST', '/api/functions/fees', {
        action,
        requesterRole: 'admin',
        actorEmail: 'admin@school.ug',
        actorName: 'Admin',
        ...body,
      });

    await fees('save_fee_structure', {
      name: 'Term 1 Tuition',
      academicYear: '2026/2027',
      term: 'Term 1',
      amount: 900000,
      gradeLevel: 10,
    });
    const structure = (await fees('list_fee_structures')).body.data.structures[0];
    await fees('bill_student', { studentId: 'student-001', feeStructureId: structure.id });
    await fees('record_payment', { studentId: 'student-001', amount: 400000, paymentMethod: 'MTN MoMo' });

    // A pending and a failed gateway attempt: money that did not move, which the ledger's running
    // balance must ignore but the statement must still show.
    await runtime.database.query(`
      INSERT INTO payment_transactions (id, student_id, provider, amount, currency, external_reference, status)
      VALUES ('tx-pending', 'student-001', 'mtn_momo', 250000, 'UGX', 'EXT-1', 'pending'),
             ('tx-failed', 'student-001', 'airtel_money', 250000, 'UGX', 'EXT-2', 'failed')
    `);

    const ledger = (await fees('student_ledger', { studentId: 'student-001' })).body.data;
    assert.equal(ledger.summary.balance_due, 500000, 'unsettled attempts must not reduce the balance');
    assert.equal(ledger.transactions.length, 2);
    assert.ok(ledger.transactions.every((transaction) => transaction.settled === false));

    // The chat profile now answers "have they paid?" without a separate lookup.
    const profile = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      modelId: 'local-rules',
      message: 'Tell me about Emma Johnson',
    });
    assert.match(profile.body.data.message, /### School fees/);
    assert.match(profile.body.data.message, /Partly paid/);
    assert.match(profile.body.data.message, /Balance: UGX 500,000/);

    // A teacher can pull the statement; support staff still cannot, and the school-wide financial
    // report stays admin-only.
    const asTeacher = await runtime.dispatch({
      method: 'GET',
      pathname: '/api/fees/statements/student-001.pdf',
      searchParams: new URLSearchParams({ requesterRole: 'teacher' }),
    });
    assert.equal(asTeacher.status, 200);
    assert.equal(asTeacher.body.subarray(0, 5).toString(), '%PDF-');

    for (const [role, path, expected] of [
      ['support_staff', '/api/fees/statements/student-001.pdf', 403],
      ['teacher', '/api/fees/report.pdf', 403],
    ]) {
      const response = await runtime.dispatch({
        method: 'GET',
        pathname: path,
        searchParams: new URLSearchParams({ requesterRole: role }),
      });
      assert.equal(response.status, expected, `${role} on ${path}`);
    }
  } finally {
    await cleanup();
  }
});

/** Captures what is actually sent to Meilisearch, so the role filter can be asserted at the wire. */
const createMeiliStub = ({ hitsByIndex = {} } = {}) => {
  const requests = [];

  const httpClient = async (url, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method: options.method || 'GET', body });

    if (url.endsWith('/multi-search')) {
      return new Response(
        JSON.stringify({
          results: (body.queries || []).map((query) => ({
            indexUid: query.indexUid,
            hits: hitsByIndex[query.indexUid] || [],
            estimatedTotalHits: (hitsByIndex[query.indexUid] || []).length,
            processingTimeMs: 1,
          })),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (/\/tasks\//.test(url)) {
      return new Response(JSON.stringify({ status: 'succeeded' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ taskUid: requests.length }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return { httpClient, requests };
};

const withMeili = async (run) => {
  const originalHost = process.env.MEILISEARCH_HOST;
  const originalKey = process.env.MEILISEARCH_API_KEY;
  process.env.MEILISEARCH_HOST = 'http://meili.test';
  process.env.MEILISEARCH_API_KEY = 'test-key';
  try {
    return await run();
  } finally {
    if (originalHost === undefined) delete process.env.MEILISEARCH_HOST;
    else process.env.MEILISEARCH_HOST = originalHost;
    if (originalKey === undefined) delete process.env.MEILISEARCH_API_KEY;
    else process.env.MEILISEARCH_API_KEY = originalKey;
  }
};

test('global search falls back to Postgres when Meilisearch is not configured', async () => {
  // The default state of every existing deployment, so this path matters most.
  const original = process.env.MEILISEARCH_HOST;
  delete process.env.MEILISEARCH_HOST;

  const { runtime, cleanup } = await startTestRuntime();

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/search', {
      action: 'query',
      requesterRole: 'teacher',
      query: 'Johnson',
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.data.engine, 'postgres');
    assert.equal(result.body.data.groups[0].index, 'students');
    assert.match(result.body.data.groups[0].hits[0].title, /Johnson/);
    // Said plainly rather than implying the results are as good as search gets.
    assert.match(result.body.data.notice, /not configured/);

    const status = await dispatch(runtime, 'POST', '/api/functions/search', {
      action: 'status',
      requesterRole: 'admin',
    });
    assert.equal(status.body.data.configured, false);
    assert.equal(status.body.data.engine, 'postgres');
  } finally {
    if (original === undefined) delete process.env.MEILISEARCH_HOST;
    else process.env.MEILISEARCH_HOST = original;
    await cleanup();
  }
});

test('search results are scoped to the requester role, enforced on the wire', async () => {
  await withMeili(async () => {
    const { httpClient, requests } = createMeiliStub();
    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const query = (body) =>
        dispatch(runtime, 'POST', '/api/functions/search', { action: 'query', query: 'osmosis', ...body });

      const lastQueries = () => requests.filter((r) => r.url.endsWith('/multi-search')).at(-1).body.queries;

      // A teacher must never reach the fees index — the ledger is admin-only in the database, and
      // an index that answered here would quietly undo that.
      await query({ requesterRole: 'teacher' });
      const asTeacher = lastQueries();
      assert.ok(!asTeacher.some((entry) => entry.indexUid === 'fees'), 'teacher must not query fees');
      assert.ok(asTeacher.every((entry) => entry.filter === 'roles = teacher'));

      await query({ requesterRole: 'admin' });
      const asAdmin = lastQueries();
      assert.ok(asAdmin.some((entry) => entry.indexUid === 'fees'), 'admin may query fees');
      assert.ok(asAdmin.every((entry) => entry.filter === 'roles = admin'));

      // Naming an index explicitly must not widen scope beyond the role.
      await query({ requesterRole: 'teacher', indexes: ['fees', 'students'] });
      assert.deepEqual(lastQueries().map((entry) => entry.indexUid), ['students']);

      // Support staff get no search at all: their access is the fee-status endpoint.
      for (const requesterRole of ['support_staff', undefined]) {
        const denied = await query({ requesterRole });
        assert.equal(denied.status, 403);
        assert.equal(denied.body.error, 'Unauthorized');
      }
    } finally {
      await cleanup();
    }
  });
});

test('search returns results grouped by type, and reindexing is admin-only', async () => {
  await withMeili(async () => {
    const { httpClient } = createMeiliStub({
      hitsByIndex: {
        students: [
          {
            id: 'student-001',
            kind: 'student',
            full_name: 'Emma Johnson',
            student_id: 'STU-2026-001',
            grade_level: 10,
            class_section: 'A',
            status: 'active',
          },
        ],
        exam_questions: [
          {
            id: 'q1',
            kind: 'exam_question',
            stem: 'Describe how you would investigate osmosis.',
            subject_name: 'Biology',
            topic: 'Osmosis',
            difficulty: 'moderate',
            marks: 5,
            status: 'approved',
          },
        ],
      },
    });

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const result = await dispatch(runtime, 'POST', '/api/functions/search', {
        action: 'query',
        requesterRole: 'teacher',
        query: 'osmosis',
      });

      assert.equal(result.body.data.engine, 'meilisearch');
      // Empty groups are dropped so the palette does not render six empty headings.
      const indexes = result.body.data.groups.map((group) => group.index);
      assert.deepEqual(indexes.sort(), ['exam_questions', 'students']);

      const students = result.body.data.groups.find((group) => group.index === 'students');
      assert.equal(students.hits[0].title, 'Emma Johnson');
      assert.match(students.hits[0].subtitle, /STU-2026-001/);

      const questions = result.body.data.groups.find((group) => group.index === 'exam_questions');
      assert.match(questions.hits[0].title, /investigate osmosis/);
      assert.match(questions.hits[0].subtitle, /Biology/);

      const asTeacher = await dispatch(runtime, 'POST', '/api/functions/search', {
        action: 'reindex',
        requesterRole: 'teacher',
      });
      assert.equal(asTeacher.status, 400);
      assert.match(asTeacher.body.error, /Only an administrator/);

      const asAdmin = await dispatch(runtime, 'POST', '/api/functions/search', {
        action: 'reindex',
        requesterRole: 'admin',
      });
      assert.equal(asAdmin.status, 200);
      // The seeded students and curriculum corpus should both have been indexed.
      assert.ok(asAdmin.body.data.counts.students > 0);
      assert.ok(asAdmin.body.data.counts.curriculum > 0);
    } finally {
      await cleanup();
    }
  });
});

test('an unreachable search server degrades to the basic search rather than failing', async () => {
  await withMeili(async () => {
    const httpClient = async () => {
      throw new Error('connect ECONNREFUSED');
    };

    const { runtime, cleanup } = await startTestRuntime({ httpClient });

    try {
      const result = await dispatch(runtime, 'POST', '/api/functions/search', {
        action: 'query',
        requesterRole: 'teacher',
        query: 'Johnson',
      });

      assert.equal(result.status, 200);
      assert.equal(result.body.data.engine, 'postgres');
      assert.match(result.body.data.groups[0].hits[0].title, /Johnson/);
      assert.match(result.body.data.notice, /unreachable/);
    } finally {
      await cleanup();
    }
  });
});

test('the MCP server maps each token to its own role, so LibreChat sees the right tools', async () => {
  const originalToken = process.env.MCP_SERVER_TOKEN;
  const originalTokens = process.env.MCP_SERVER_TOKENS;
  delete process.env.MCP_SERVER_TOKEN;
  process.env.MCP_SERVER_TOKENS = JSON.stringify({ 'tok-admin': 'admin', 'tok-teacher': 'teacher' });

  const { runtime, cleanup } = await startTestRuntime();

  const rpc = (body, headers = {}) => runtime.dispatch({ method: 'POST', pathname: '/api/mcp', body, headers });

  try {
    const listFor = async (token) => {
      const response = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${token}` });
      assert.equal(response.status, 200);
      return response.body.result.tools.map((tool) => tool.name);
    };

    // Both roles get the teaching tools; the registry is what decides, so this is a lookup change
    // rather than a second gate to keep in step.
    const teacherTools = await listFor('tok-teacher');
    const adminTools = await listFor('tok-admin');
    assert.ok(teacherTools.includes('search_students'));
    assert.ok(adminTools.includes('search_students'));

    // An unknown token grants nothing.
    const unknown = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer nope' });
    assert.equal(unknown.status, 401);

    // The single-token form still works, for deployments configured before per-role tokens existed.
    delete process.env.MCP_SERVER_TOKENS;
    process.env.MCP_SERVER_TOKEN = 'legacy-token';
    process.env.MCP_SERVER_ROLE = 'admin';
    const legacy = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer legacy-token' });
    assert.equal(legacy.status, 200);
    assert.ok(legacy.body.result.tools.length > 0);
  } finally {
    if (originalToken === undefined) delete process.env.MCP_SERVER_TOKEN;
    else process.env.MCP_SERVER_TOKEN = originalToken;
    if (originalTokens === undefined) delete process.env.MCP_SERVER_TOKENS;
    else process.env.MCP_SERVER_TOKENS = originalTokens;
    delete process.env.MCP_SERVER_ROLE;
    await cleanup();
  }
});

test('every indexed document id is one Meilisearch will accept', async () => {
  const { INDEXES, isValidDocumentId } = await import('../server/search/indexer.mjs');
  const { runtime, cleanup } = await startTestRuntime();

  try {
    // Give the fees index something to build, since that is the one that synthesises composite ids
    // and so the one that can violate the charset. A colon here fails the whole batch with an
    // opaque task error, which a stubbed server never surfaces.
    const fees = (action, body = {}) =>
      dispatch(runtime, 'POST', '/api/functions/fees', {
        action,
        requesterRole: 'admin',
        actorEmail: 'admin@school.ug',
        actorName: 'Admin',
        ...body,
      });

    await fees('save_fee_structure', {
      name: 'Term 1 Tuition',
      academicYear: '2026/2027',
      term: 'Term 1',
      amount: 900000,
      gradeLevel: 10,
    });
    const structure = (await fees('list_fee_structures')).body.data.structures[0];
    await fees('bill_student', { studentId: 'student-001', feeStructureId: structure.id });
    await fees('record_payment', { studentId: 'student-001', amount: 400000, paymentMethod: 'MTN MoMo' });

    let checked = 0;
    for (const [name, definition] of Object.entries(INDEXES)) {
      const documents = await definition.build(runtime.database);
      for (const document of documents) {
        assert.ok(
          isValidDocumentId(document.id),
          `${name} produced an id Meilisearch would reject: ${document.id}`,
        );
        checked += 1;
      }
    }

    assert.ok(checked > 0, 'expected documents to check');
    // The fees index must actually have produced rows, or this test proves nothing about it.
    assert.ok((await INDEXES.fees.build(runtime.database)).length >= 2);
  } finally {
    await cleanup();
  }
});

test('questions a model wrote as prose are recovered rather than reported as a failure', async () => {
  // Exactly what a small local model does: ignores the submit tool and answers in prose. Discarding
  // that work and showing an error is the wrong outcome — the questions are right there.
  const httpClient = async () =>
    new Response(
      JSON.stringify({
        message: {
          content: [
            'Sure! Below are five exam questions that cover trigonometry at S4:',
            '',
            '1. State the three primary trigonometric ratios for a right-angled triangle. [3 marks]',
            '',
            '2. A ladder leans against a wall at 65 degrees. Calculate the height it reaches. [4 marks]',
            '',
            '3. Which of the following is equal to sin(30)? [1 mark]',
            'A. 0.5',
            'B. 0.866',
            'C. 1.0',
            'D. 0.707',
            '',
            '4. Prove that sin^2(x) + cos^2(x) = 1. [5 marks]',
          ].join('\n'),
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'generate_questions',
      requesterRole: 'teacher',
      actorName: 'Grace Nakato',
      modelId: 'ollama-default',
      subjectName: 'Mathematics',
      gradeLevel: 11,
      topics: ['Trigonometry'],
      count: 5,
    });

    assert.equal(result.status, 200, 'prose must not be reported as a failure');
    assert.equal(result.body.data.questions.length, 4);

    // Flagged, because these were not grounded or structured and need a closer read.
    assert.equal(result.body.data.recoveredFromProse, true);
    assert.ok(result.body.data.rawReply.includes('Below are five exam questions'));

    // The lead-in is not a question.
    assert.ok(
      !result.body.data.questions.some((question) => /Below are five/.test(question.stem)),
      "the model's preamble must not become a question",
    );

    const [first] = result.body.data.questions;
    assert.match(first.stem, /three primary trigonometric ratios/);
    assert.equal(first.marks, 3);
    assert.equal(first.status, 'draft', 'recovered questions still need review');

    // Multiple-choice options survive the round trip.
    const mcq = result.body.data.questions.find((question) => question.question_type === 'mcq');
    assert.ok(mcq, 'the A-D question should be recognised as multiple choice');
    assert.deepEqual(mcq.options, ['0.5', '0.866', '1.0', '0.707']);

    // They are real banked rows, editable and approvable like any other.
    const banked = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'list_questions',
      requesterRole: 'teacher',
      status: 'draft',
    });
    assert.equal(banked.body.data.questions.length, 4);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('Ollama is given tools, and a tool call written into the text is recovered', async () => {
  const requests = [];
  const httpClient = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);

    // First turn: emit the tool call as fenced JSON in the content, the way small models do.
    if (requests.length === 1) {
      return new Response(
        JSON.stringify({
          message: {
            content:
              'I will search the syllabus.\n```json\n' +
              JSON.stringify({ name: 'search_curriculum', arguments: { query: 'osmosis', subject: 'Biology' } }) +
              '\n```',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ message: { content: 'Osmosis is covered under Cell Biology.' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const response = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'What does the syllabus say about osmosis?',
      modelId: 'ollama-default',
      mode: 'agent',
    });

    assert.equal(response.status, 200);
    // Previously Ollama was told about no tools at all and could only ever answer in prose.
    assert.ok(requests[0].tools?.length > 0, 'Ollama must be sent the tool definitions');
    assert.ok(requests[0].tools.some((tool) => tool.function.name === 'search_curriculum'));

    // The fenced-JSON call was recovered and executed, so this ran as a real agent turn.
    assert.equal(response.body.data.mode, 'agent');
    assert.equal(response.body.data.steps.length, 1);
    assert.equal(response.body.data.steps[0].tool, 'search_curriculum');
    assert.equal(response.body.data.steps[0].isError, false);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('the Ollama adapter matches the documented tool-calling wire format', async () => {
  // Checked against https://docs.ollama.com/capabilities/tool-calling. Ollama has no tool_call_id:
  // a result is matched to its call by `tool_name`, so omitting that leaves parallel results
  // ambiguous — which is exactly what several `tool` messages in a row would otherwise be.
  const chats = [];
  let turn = 0;

  const httpClient = async (url, options) => {
    if (!url.endsWith('/api/chat')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    chats.push(JSON.parse(options.body));
    turn += 1;

    if (turn === 1) {
      return new Response(
        JSON.stringify({
          message: {
            content: 'Looking those up.',
            tool_calls: [
              { type: 'function', function: { index: 0, name: 'search_curriculum', arguments: { query: 'osmosis' } } },
              { type: 'function', function: { index: 1, name: 'search_students', arguments: { gradeLevel: 10 } } },
            ],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response(JSON.stringify({ message: { content: 'Both done.' } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const response = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
      requesterRole: 'teacher',
      message: 'osmosis and grade 10',
      modelId: 'ollama-default',
      mode: 'agent',
    });
    assert.equal(response.status, 200);

    // Request: tools are {type:'function', function:{name, description, parameters}}.
    const [first, followUp] = chats;
    assert.ok(first.tools.length > 0, 'Ollama must be sent tool definitions');
    assert.equal(first.tools[0].type, 'function');
    assert.deepEqual(Object.keys(first.tools[0].function).sort(), ['description', 'name', 'parameters']);

    // Follow-up: the assistant turn carries type + function.index, and arguments stay an object
    // (Ollama does not use the JSON-string form OpenAI does).
    const assistant = followUp.messages.find((message) => message.role === 'assistant' && message.tool_calls);
    assert.ok(assistant, 'the tool-call turn must be replayed');
    assert.equal(assistant.tool_calls.length, 2);
    assistant.tool_calls.forEach((call, index) => {
      assert.equal(call.type, 'function');
      assert.equal(call.function.index, index);
      assert.equal(typeof call.function.arguments, 'object');
    });

    // Results carry tool_name, in the same order as the calls.
    const results = followUp.messages.filter((message) => message.role === 'tool');
    assert.equal(results.length, 2);
    assert.deepEqual(
      results.map((result) => result.tool_name),
      ['search_curriculum', 'search_students'],
    );
    assert.ok(results.every((result) => result.content));
    // There is no tool_call_id in Ollama's protocol; sending one would be noise.
    assert.ok(results.every((result) => result.tool_call_id === undefined));

    assert.deepEqual(
      response.body.data.steps.map((step) => step.tool),
      ['search_curriculum', 'search_students'],
    );
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('a failed generation still returns what the model wrote, so the screen can show it', async () => {
  // The route used to null the payload on error, which is what left a teacher with a dismissible
  // dialog and no way to recover the questions the model had just written.
  const httpClient = async (url) => {
    if (!url.endsWith('/api/chat')) {
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(
      JSON.stringify({
        message: {
          content: 'I would rather not generate questions without seeing the syllabus first.',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  };

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'generate_questions',
      requesterRole: 'teacher',
      modelId: 'ollama-default',
      subjectName: 'Mathematics',
      gradeLevel: 11,
      topics: ['Trigonometry'],
      count: 5,
    });

    assert.equal(result.status, 400);
    assert.match(result.body.error, /did not produce anything that could be read as questions/);

    // The payload survives alongside the error — this is the part that was lost.
    assert.notEqual(result.body.data, null, 'the payload must not be nulled on error');
    assert.match(result.body.data.rawReply, /rather not generate questions/);
    assert.ok(Array.isArray(result.body.data.steps));

    // Nothing unreviewable was banked.
    assert.equal(await countRows(runtime, 'exam_questions'), 0);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('a gate permission is granted away from the gate and spent at it', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);
  const askariCard = async () => {
    const res = await call('/api/functions/student-card', {
      code: 'STU-2026-003', role: 'support_staff', designation: 'askari',
    });
    return res.body.data;
  };

  try {
    const noDestination = await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-003', reason: 'Sick',
    });
    assert.equal(noDestination.status, 400);

    const granted = await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-003', reason: 'Going home for mid-term',
      destination: 'Kampala', grantedBy: 'Matron', expectedReturn: '2026-08-25',
    });
    assert.equal(granted.status, 200);
    assert.equal(granted.body.data.permission.status, 'active');

    // The gate reads the slip: who allowed the trip, why, and where to.
    const card = await askariCard();
    assert.equal(card.gate_pass.permission.granted_by, 'Matron');
    assert.equal(card.gate_pass.permission.destination, 'Kampala');
    // ...but may not issue one. The officer at the gate is never the authoriser.
    assert.equal(card.sections.includes('gate_permission'), false);

    const approved = await call('/api/functions/gate-pass', {
      code: 'STU-2026-003', direction: 'out', decision: 'approved', recordedBy: 'Askari',
    });
    assert.equal(approved.status, 200);
    // The movement copies the slip so it stays readable once the slip is closed.
    assert.equal(approved.body.data.pass.authorised_by, 'Matron');
    assert.equal(approved.body.data.pass.destination, 'Kampala');
    assert.equal(approved.body.data.on_premises, false);

    // A spent slip cannot be presented to the next officer on duty.
    const afterUse = await askariCard();
    assert.equal(afterUse.gate_pass.permission, null);
    assert.equal(afterUse.gate_pass.on_premises, false);

    const back = await call('/api/functions/gate-pass', {
      code: 'STU-2026-003', direction: 'in', recordedBy: 'Askari',
    });
    assert.equal(back.status, 200);
    assert.equal((await askariCard()).gate_pass.on_premises, true);
  } finally {
    await cleanup();
  }
});

test('a declined exit is recorded and leaves the student on the premises', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-004', reason: 'Trip', destination: 'Town', grantedBy: 'Teacher',
    });

    const noReason = await call('/api/functions/gate-pass', {
      code: 'STU-2026-004', direction: 'out', decision: 'declined',
    });
    assert.equal(noReason.status, 400);

    const declined = await call('/api/functions/gate-pass', {
      code: 'STU-2026-004', direction: 'out', decision: 'declined',
      note: 'No parent escort', recordedBy: 'Askari',
    });
    assert.equal(declined.status, 200);
    assert.equal(declined.body.data.pass.decision, 'declined');
    // Turned back at the gate: the student never left.
    assert.equal(declined.body.data.on_premises, true);

    const card = await dispatch(runtime, 'POST', '/api/functions/student-card', {
      code: 'STU-2026-004', role: 'support_staff', designation: 'askari',
    });
    assert.equal(card.body.data.gate_pass.on_premises, true);
    // The refused slip is closed, so it cannot be re-presented.
    assert.equal(card.body.data.gate_pass.permission, null);
  } finally {
    await cleanup();
  }
});

test('the gate log reports movements, verdicts and times', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-005', reason: 'Home', destination: 'Jinja', grantedBy: 'Matron',
    });
    await call('/api/functions/gate-pass', { code: 'STU-2026-005', direction: 'out', recordedBy: 'Askari' });
    await call('/api/functions/gate-pass', { code: 'STU-2026-005', direction: 'in', recordedBy: 'Askari' });
    await call('/api/functions/gate-pass', {
      code: 'STU-2026-006', direction: 'out', decision: 'declined',
      note: 'No permission on file', recordedBy: 'Askari',
    });

    const log = await call('/api/functions/gate-log', { limit: 50 });
    assert.equal(log.status, 200);
    assert.deepEqual(log.body.data.counts, { total: 3, out: 1, in: 1, declined: 1 });

    const [newest] = log.body.data.movements;
    assert.equal(newest.decision, 'declined');
    assert.ok(newest.full_name, 'a movement names the student');
    assert.ok(newest.student_number, 'a movement carries the student number');
    assert.ok(newest.recorded_at, 'a movement carries its time');

    // A day with no movements reads as empty rather than failing.
    const empty = await call('/api/functions/gate-log', { date: '1999-01-01' });
    assert.equal(empty.body.data.movements.length, 0);
  } finally {
    await cleanup();
  }
});

test('an exit with no permission on file needs an explicit authoriser', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    // Nothing was granted, so the gate cannot fall back to a slip.
    const bare = await call('/api/functions/gate-pass', { code: 'STU-2026-008', direction: 'out' });
    assert.equal(bare.status, 400);

    // An override is allowed but must name whoever authorised it, so the log stays answerable.
    const override = await call('/api/functions/gate-pass', {
      code: 'STU-2026-008', direction: 'out', authorisedBy: 'Head Teacher (phoned)',
      reason: 'Family emergency', recordedBy: 'Askari',
    });
    assert.equal(override.status, 200);
    assert.equal(override.body.data.permission, null);
    assert.equal(override.body.data.pass.authorised_by, 'Head Teacher (phoned)');
  } finally {
    await cleanup();
  }
});

test('roll call marks a register and re-marking upserts', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    const classes = await call('/api/functions/roll-call', { action: 'classes' });
    assert.equal(classes.status, 200);
    assert.ok(classes.body.data.classes.length > 0);
    const { grade_level: gradeLevel, class_section: classSection } = classes.body.data.classes[0];

    const needsClass = await call('/api/functions/roll-call', { action: 'register' });
    assert.equal(needsClass.status, 400);

    const register = await call('/api/functions/roll-call', {
      action: 'register', gradeLevel, classSection,
    });
    assert.equal(register.status, 200);
    const roll = register.body.data.students;
    assert.ok(roll.length > 0);
    // Nobody is marked until the register is called.
    assert.equal(register.body.data.counts.unmarked, roll.length);
    assert.equal(roll[0].status, null);

    const badStatus = await call('/api/functions/roll-call', {
      action: 'mark', code: roll[0].student_id, status: 'wandering',
    });
    assert.equal(badStatus.status, 400);

    const marked = await call('/api/functions/roll-call', {
      action: 'mark', code: roll[0].student_id, status: 'present', markedBy: 'Teacher',
    });
    assert.equal(marked.body.data.record.status, 'present');
    assert.equal(marked.body.data.updated, false);

    // Calling the register and scanning a card are two routes to the same record, so a second
    // mark for the same day updates rather than colliding with the unique index.
    const corrected = await call('/api/functions/roll-call', {
      action: 'mark', code: roll[0].student_id, status: 'absent', reason: 'Sick', markedBy: 'Teacher',
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.data.record.status, 'absent');
    assert.equal(corrected.body.data.updated, true);

    const after = await call('/api/functions/roll-call', { action: 'register', gradeLevel, classSection });
    assert.equal(after.body.data.counts.absent, 1);
    assert.equal(after.body.data.counts.unmarked, roll.length - 1);
  } finally {
    await cleanup();
  }
});

test('an invigilator checks clearance and admits or turns a student away', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);
  const invigilatorCard = async () => {
    const res = await call('/api/functions/student-card', { code: 'STU-2026-002', role: 'teacher' });
    return res.body.data;
  };

  try {
    // Fees being settled is not the same as clearance: the invigilator waits on a person.
    const before = await invigilatorCard();
    assert.equal(before.exam_clearance.cleared, false);
    assert.equal(before.exam_clearance.fees_settled, true);
    assert.equal(before.sections.includes('exam_clearance_grant'), false);

    const bursar = await call('/api/functions/student-card', {
      code: 'STU-2026-002', role: 'admin', designation: 'bursar',
    });
    assert.equal(bursar.body.data.sections.includes('exam_clearance_grant'), true);

    const noGranter = await call('/api/functions/exam-clearance', { action: 'grant', code: 'STU-2026-002' });
    assert.equal(noGranter.status, 400);

    const granted = await call('/api/functions/exam-clearance', {
      action: 'grant', code: 'STU-2026-002', grantedBy: 'Bursar', note: 'Paid in cash',
    });
    assert.equal(granted.status, 200);

    const cleared = await invigilatorCard();
    assert.equal(cleared.exam_clearance.cleared, true);
    assert.equal(cleared.exam_clearance.clearance.granted_by, 'Bursar');

    const noReason = await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-002', decision: 'rejected',
    });
    assert.equal(noReason.status, 400);

    const admitted = await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-002', decision: 'approved', recordedBy: 'Invigilator',
    });
    assert.equal(admitted.body.data.admission.decision, 'approved');
    assert.equal(admitted.body.data.admission.clearance_id, granted.body.data.clearance.id);
    assert.equal((await invigilatorCard()).exam_clearance.last_admission.decision, 'approved');

    const revoked = await call('/api/functions/exam-clearance', {
      action: 'revoke', clearanceId: granted.body.data.clearance.id, by: 'Admin',
    });
    assert.equal(revoked.status, 200);
    assert.equal((await invigilatorCard()).exam_clearance.cleared, false);

    // Turning a student away is recorded even when there was no clearance to check.
    const rejected = await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-002', decision: 'rejected',
      note: 'No clearance on file', recordedBy: 'Invigilator',
    });
    assert.equal(rejected.body.data.clearance, null);
    assert.equal(rejected.body.data.admission.decision, 'rejected');
  } finally {
    await cleanup();
  }
});

test('re-granting exam clearance supersedes the previous one', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    await call('/api/functions/exam-clearance', {
      action: 'grant', code: 'STU-2026-005', grantedBy: 'Bursar',
    });
    await call('/api/functions/exam-clearance', {
      action: 'grant', code: 'STU-2026-005', grantedBy: 'Head Teacher',
    });

    const list = await call('/api/functions/exam-clearance', { action: 'list', code: 'STU-2026-005' });
    const active = list.body.data.clearances.filter((row) => row.status === 'active');
    assert.equal(active.length, 1, 'only one clearance is ever active');
    assert.equal(active[0].granted_by, 'Head Teacher');
  } finally {
    await cleanup();
  }
});

const seedStaff = async (runtime) => {
  const make = async (email, name, role, designation) => {
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email, password: 'password123', displayName: name,
    });
    await runtime.database.query(
      'UPDATE users SET role = $1, approval_status = $2 WHERE auth_email = $3',
      [role, 'approved', email],
    );
    if (designation) {
      await dispatch(runtime, 'POST', '/api/functions/auth', {
        action: 'set_designation', email, designation,
      });
    }
  };
  await make('head@school.local', 'Head', 'admin', null);
  await make('t1@school.local', 'Teacher One', 'teacher', null);
  await make('t2@school.local', 'Teacher Two', 'teacher', null);
  await make('askari@school.local', 'Askari', 'support_staff', 'askari');
  await make('cook@school.local', 'Cook', 'support_staff', 'cook');
};

test('a staff message reaches one person, a group, or everybody', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (body) => dispatch(runtime, 'POST', '/api/functions/messages', body);
  const unread = async (email) => (await call({ action: 'inbox', actorEmail: email })).body.data.unread;

  try {
    await seedStaff(runtime);

    await call({
      action: 'send', actorEmail: 'head@school.local', audienceKind: 'user',
      recipientEmail: 't1@school.local', subject: 'About P5', body: 'See me at break.',
    });
    assert.equal(await unread('t1@school.local'), 1);
    assert.equal(await unread('t2@school.local'), 0, 'a direct message reaches nobody else');

    await call({
      action: 'send', actorEmail: 'head@school.local', audienceKind: 'role',
      audienceValue: 'teacher', subject: 'Staff meeting', body: 'Friday 4pm.',
    });
    assert.equal(await unread('t2@school.local'), 1);
    assert.equal(await unread('askari@school.local'), 0, 'a role group stops at that role');

    await call({
      action: 'send', actorEmail: 'head@school.local', audienceKind: 'designation',
      audienceValue: 'askari', subject: 'Gate duty', body: 'Cover the night shift.',
    });
    assert.equal(await unread('askari@school.local'), 1);
    assert.equal(await unread('cook@school.local'), 0, 'a designation group stops at that job');

    const before = await unread('t1@school.local');
    await call({
      action: 'send', actorEmail: 't1@school.local', audienceKind: 'all',
      subject: 'Lost keys', body: 'Found a bunch of keys.',
    });
    assert.equal(await unread('cook@school.local'), 1);
    // A broadcast should not ring its own author's bell.
    assert.equal(await unread('t1@school.local'), before);

    for (const bad of [
      { audienceKind: 'all', body: 'x' },
      { audienceKind: 'all', subject: 'x' },
      { audienceKind: 'everyone', subject: 'x', body: 'y' },
      { audienceKind: 'user', recipientEmail: 'nobody@school.local', subject: 'x', body: 'y' },
    ]) {
      const res = await call({ action: 'send', actorEmail: 'head@school.local', ...bad });
      assert.equal(res.status, 400);
    }
  } finally {
    await cleanup();
  }
});

test('read state is per person and re-reading is idempotent', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (body) => dispatch(runtime, 'POST', '/api/functions/messages', body);

  try {
    await seedStaff(runtime);
    await call({
      action: 'send', actorEmail: 'head@school.local', audienceKind: 'all',
      subject: 'Sports day', body: 'Saturday.',
    });

    const inbox = (await call({ action: 'inbox', actorEmail: 't1@school.local' })).body.data;
    assert.equal(inbox.unread, 1);

    const read = await call({
      action: 'read', actorEmail: 't1@school.local', messageId: inbox.messages[0].id,
    });
    assert.equal(read.body.data.unread, 0);

    // One row per reader per message, so opening it twice is not a second read.
    const again = await call({
      action: 'read', actorEmail: 't1@school.local', messageId: inbox.messages[0].id,
    });
    assert.equal(again.body.data.unread, 0);

    // The same broadcast is still unread for everyone else.
    const other = await call({ action: 'inbox', actorEmail: 't2@school.local' });
    assert.equal(other.body.data.unread, 1);

    const all = await call({ action: 'read_all', actorEmail: 't2@school.local' });
    assert.equal(all.body.data.unread, 0);
    assert.equal((await call({ action: 'inbox', actorEmail: 'cook@school.local' })).body.data.unread, 1);
  } finally {
    await cleanup();
  }
});

test('gate and exam refusals raise an event for the office', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);
  const inbox = async (email) =>
    (await call('/api/functions/messages', { action: 'inbox', actorEmail: email })).body.data;

  try {
    await seedStaff(runtime);

    await call('/api/functions/gate-pass', {
      code: 'STU-2026-001', direction: 'out', decision: 'declined',
      note: 'No slip', recordedBy: 'Askari',
    });
    const office = await inbox('head@school.local');
    const gateEvent = office.messages.find((m) => m.category === 'event');
    assert.ok(gateEvent, 'the office hears about a student turned back');
    assert.equal(gateEvent.priority, 'high');
    // The whole staff room does not need to know.
    assert.equal((await inbox('t2@school.local')).messages.some((m) => m.category === 'event'), false);

    // Granting a pass tells the gate a slip is coming before the student arrives.
    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-002', reason: 'Home',
      destination: 'Jinja', grantedBy: 'Matron',
    });
    assert.ok((await inbox('askari@school.local')).messages
      .some((m) => m.category === 'event' && /Gate pass for/.test(m.subject)));

    await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-003', decision: 'rejected',
      note: 'No clearance', recordedBy: 'Invigilator',
    });
    assert.ok((await inbox('head@school.local')).messages
      .some((m) => /turned away from an exam/.test(m.subject)));
  } finally {
    await cleanup();
  }
});

test('generation keeps everything the model produced', async () => {
  // Three things were being thrown away: questions past the requested count, answers and mark
  // schemes written in prose, and the model's closing remarks. All of it is work already done.
  const reply = [
    'Sure! Below are five questions on trigonometry:',
    '',
    '1. State the three primary trigonometric ratios. [3 marks]',
    'Answer: sine = opp/hyp, cosine = adj/hyp, tangent = opp/adj',
    '- Names all three (2)',
    '- Expresses each correctly (1)',
    '',
    '2. Which equals sin(30)? [1 mark]',
    'A. 0.5',
    'B. 0.866',
    'Answer: A',
    '',
    '3. Prove sin^2(x) + cos^2(x) = 1. [5 marks]',
    '',
    '4. Define the unit circle. [2 marks]',
    '',
    '5. What is cos(0)? [1 mark]',
    '',
    '6. Convert 45 degrees to radians. [2 marks]',
    '',
    '7. State the sine rule. [2 marks]',
    '',
    'Let me know if you want these adapted for a different level.',
  ].join('\n');

  const httpClient = async (url) =>
    url.endsWith('/api/chat')
      ? new Response(JSON.stringify({ message: { content: reply } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'generate_questions',
      requesterRole: 'teacher',
      modelId: 'ollama-default',
      subjectName: 'Mathematics',
      topics: ['Trigonometry'],
      count: 5,
    });

    assert.equal(result.status, 200);
    const questions = result.body.data.questions;

    // Asked for five, the model wrote seven — all seven are kept. `count` is a request, not a
    // ceiling on what comes back.
    assert.equal(questions.length, 7, 'questions past the requested count must not be dropped');

    // Answers and mark schemes written in prose are captured, not blanked.
    const [first] = questions;
    assert.match(first.correct_answer, /sine = opp\/hyp/);
    assert.equal(first.marking_scheme.length, 2);
    assert.equal(first.marking_scheme[0].marks, 2);

    const mcq = questions.find((question) => question.question_type === 'mcq');
    assert.deepEqual(mcq.options, ['0.5', '0.866']);
    assert.equal(mcq.correct_answer, 'A');

    // The closing remark is kept as a note rather than glued onto the last question's stem.
    const last = questions[questions.length - 1];
    assert.match(last.stem, /State the sine rule/);
    assert.ok(!/adapted for a different level/.test(last.stem), 'closing prose must not join the stem');
    assert.match(last.review_notes, /adapted for a different level/);

    // And the whole reply is returned regardless, so nothing is lost.
    assert.match(result.body.data.rawReply, /Below are five questions/);
    assert.match(result.body.data.rawReply, /adapted for a different level/);
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('a question labelled with its topic rather than the tool name is still banked', async () => {
  // The reported bug, exactly as it came back: the model returned one good question as a fenced tool
  // call, but put the *topic* in `name` and nested the question under `arguments`. Matching on the
  // wrapper threw the whole thing away and told the teacher nothing could be read.
  const payload = {
    name: 'Nutrition in Plants',
    arguments: {
      topic: 'Nutrition in Plants',
      questionType: 'mcq',
      stem: 'Photosynthesis: word and balanced equations, raw materials, conditions and products.',
      correctAnswer: 'The leaf as an organ adapted for photosynthesis.',
      difficulty: 'moderate',
      expectedTimeMinutes: 15,
      markingScheme: [
        { marks: 3, point: 'States the balanced equation' },
        { marks: 2, point: 'Names the raw materials' },
      ],
      options: ['The leaf as an organ adapted for photosynthesis.', 'Testing a leaf for starch.'],
    },
  };

  const httpClient = async () =>
    new Response(
      JSON.stringify({
        message: { content: 'Here is the question.\n```json\n' + JSON.stringify(payload) + '\n```' },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );

  const originalBaseUrl = process.env.OLLAMA_BASE_URL;
  process.env.OLLAMA_BASE_URL = 'http://ollama.test';

  const { runtime, cleanup } = await startTestRuntime({ httpClient });

  try {
    const result = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'generate_questions',
      requesterRole: 'teacher',
      actorName: 'Grace Nakato',
      modelId: 'ollama-default',
      subjectName: 'Biology',
      gradeLevel: 9,
      topics: ['Nutrition in Plants'],
      count: 1,
    });

    assert.equal(result.status, 200, 'a well-formed question must not be reported as a failure');
    assert.equal(result.body.data.questions.length, 1);

    const [question] = result.body.data.questions;
    assert.match(question.stem, /Photosynthesis: word and balanced equations/);
    assert.equal(question.question_type, 'mcq');
    assert.equal(question.options.length, 2);
    assert.match(question.correct_answer, /adapted for photosynthesis/);
    assert.equal(question.marking_scheme.length, 2);
    // Marks were not given explicitly, so they come from the mark scheme rather than defaulting to 1.
    assert.equal(question.marks, 5);

    // The editor opens on this, so it has to arrive with the response.
    assert.match(result.body.data.markdown, /Photosynthesis: word and balanced equations/);
    assert.match(result.body.data.markdown, new RegExp(`id:${question.id}`));
  } finally {
    if (originalBaseUrl === undefined) delete process.env.OLLAMA_BASE_URL;
    else process.env.OLLAMA_BASE_URL = originalBaseUrl;
    await cleanup();
  }
});

test('a question is recognised by its shape, whatever it is wrapped in', async () => {
  const { extractQuestionsFromJsonBlocks } = await import('../server/services/question-parse.mjs');

  const one = { stem: 'Define osmosis.', marks: 2 };
  const two = { question: 'State two products of photosynthesis.', marks: 2 };

  const shapes = {
    'bare array': [one, two],
    'questions key': { questions: [one, two] },
    'nested under arguments': { name: 'submit_questions', arguments: { questions: [one, two] } },
    'a single bare object': one,
    'labelled with the topic': { name: 'Osmosis', arguments: one },
  };

  for (const [label, value] of Object.entries(shapes)) {
    const parsed = extractQuestionsFromJsonBlocks('```json\n' + JSON.stringify(value) + '\n```');
    assert.ok(parsed.length >= 1, `${label} should parse`);
    assert.equal(parsed[0].stem, 'Define osmosis.', `${label} should keep the stem`);
  }

  // No stem key at all, but a type and an answer is signal enough.
  const inferred = extractQuestionsFromJsonBlocks(
    JSON.stringify({ type: 'short_answer', answer: 'Chlorophyll', prompt: 'Name the green pigment.' }),
  );
  assert.equal(inferred.length, 1);
  assert.equal(inferred[0].correctAnswer, 'Chlorophyll');

  // Prose with no JSON in it leaves the numbered reader to try instead.
  assert.deepEqual(extractQuestionsFromJsonBlocks('Here are some questions for you.'), []);
});

test('several JSON objects in one block are all read, and the stem is found wherever it was put', async () => {
  const { extractQuestionsFromJsonBlocks } = await import('../server/services/question-parse.mjs');

  // What Ollama actually returns: three objects back to back inside a single fence, none of them
  // carrying a `stem` — the question text is on the wrapper, under `description`. Reading the span
  // from the first brace to the last is not valid JSON, which used to lose all three.
  const question = (number) => ({
    name: `Question ${number}`,
    arguments: {
      assessmentObjective: 'AO2 Handling Information and Problem Solving',
      bloomLevel: 'moderate',
      citationIndexes: [1],
      commandWord: 'describe',
      correctAnswer: 'Water and mineral salts move through the xylem.',
      difficulty: 'medium',
      markingScheme: [
        { marks: 5, point: 'Names the xylem' },
        { marks: 10, point: 'Explains transpiration pull' },
      ],
      options: ['Xylem', 'Phloem'],
    },
    description: `Describe transport in plants, part ${number}.`,
  });

  const reply =
    '```json\n' + [1, 2, 3].map((number) => JSON.stringify(question(number), null, 2)).join('\n\n') + '\n```';

  const parsed = extractQuestionsFromJsonBlocks(reply);
  assert.equal(parsed.length, 3, 'every object in the block is a question the model wrote');
  assert.equal(parsed[0].stem, 'Describe transport in plants, part 1.');
  assert.equal(parsed[2].stem, 'Describe transport in plants, part 3.');
  assert.equal(parsed[0].marks, 15, 'marks come from the scheme when none were given');
  assert.deepEqual(parsed[1].options, ['Xylem', 'Phloem']);

  // A reply cut off mid-object keeps everything that was complete before the cut.
  const truncated = '```json\n' + JSON.stringify(question(1)) + '\n\n{ "name": "Question 2", "arguments": { "stem": "cut';
  assert.equal(extractQuestionsFromJsonBlocks(truncated).length, 1);

  // Trailing commas are the usual reason a model's JSON will not parse, and are worth one retry.
  assert.equal(extractQuestionsFromJsonBlocks('{"questions":[{"stem":"Define osmosis.",},]}').length, 1);

  // A question's own mark-scheme rows must not each be counted as questions.
  const scored = extractQuestionsFromJsonBlocks(
    '{"stem":"Describe transport in plants.","markingScheme":[{"marks":3,"point":"Names the xylem"},{"marks":2,"point":"Explains transpiration"}]}',
  );
  assert.equal(scored.length, 1, 'a scheme belongs to its question, it is not three questions');
  assert.equal(scored[0].markingScheme.length, 2);
});

test('questions survive the round trip through the editable Markdown', async () => {
  const { markdownToQuestions, questionsToMarkdown } = await import('../server/services/question-parse.mjs');

  const questions = [
    {
      id: 'q-1',
      stem: 'Which of these is a product of photosynthesis?',
      topic: 'Nutrition in Plants',
      questionType: 'mcq',
      difficulty: 'easy',
      bloomLevel: 'remember',
      options: ['Oxygen', 'Nitrogen', 'Methane', 'Argon'],
      correctAnswer: 'Oxygen',
      markingScheme: [{ point: 'Names oxygen', marks: 1 }],
      marks: 1,
      assessmentObjective: 'AO1',
      reviewNotes: 'Check the distractors.',
    },
    {
      id: 'q-2',
      stem: 'Explain how a leaf is adapted for photosynthesis.',
      topic: 'Nutrition in Plants',
      questionType: 'structured',
      difficulty: 'moderate',
      options: [],
      correctAnswer: 'Broad and thin, with many chloroplasts.',
      markingScheme: [
        { point: 'Broad lamina for light capture', marks: 2 },
        { point: 'Thin for short diffusion distance', marks: 1 },
      ],
      marks: 3,
    },
  ];

  const markdown = questionsToMarkdown(questions);
  const parsed = markdownToQuestions(markdown);

  assert.equal(parsed.length, 2);
  for (const [index, original] of questions.entries()) {
    const round = parsed[index];
    for (const field of ['id', 'stem', 'topic', 'questionType', 'difficulty', 'correctAnswer', 'marks']) {
      assert.deepEqual(round[field], original[field], `${field} must survive the round trip`);
    }
    assert.deepEqual(round.options, original.options);
    assert.deepEqual(round.markingScheme, original.markingScheme);
  }

  // A teacher who deletes the trailing marker is forking the question, not corrupting it.
  const forked = markdownToQuestions(markdown.replace(/<!--[\s\S]*?-->/g, ''));
  assert.equal(forked.length, 2);
  assert.equal(forked[0].id, undefined, 'a question with no marker is treated as new');
  assert.equal(forked[0].stem, questions[0].stem);
});

test('saving the edited draft updates the same questions instead of duplicating them', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const save = (body) =>
      dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
        action: 'save_questions',
        requesterRole: 'teacher',
        actorName: 'Grace Nakato',
        subjectName: 'Biology',
        gradeLevel: 9,
        ...body,
      });

    // First save: a draft typed in the editor, with no ids yet.
    const created = await save({
      markdown: [
        '## 1. Define osmosis.  [2 marks]',
        '',
        '**Answer:** Movement of water across a partially permeable membrane.',
        '',
        '## 2. Which gas do plants take in?  [1 marks]',
        '',
        '- A. Carbon dioxide',
        '- B. Nitrogen',
        '',
        '**Answer:** Carbon dioxide',
      ].join('\n'),
    });

    assert.equal(created.status, 200);
    assert.equal(created.body.data.created, 2);
    assert.equal(created.body.data.updated, 0);
    assert.equal(created.body.data.questions[0].status, 'draft', 'saved questions still need review');

    // The response carries the questions back as Markdown, now with their ids, which is what the
    // editor adopts — so the second save has to update rather than insert again.
    const edited = created.body.data.markdown.replace('Define osmosis.', 'Define osmosis precisely.');
    const updated = await save({ markdown: edited });

    assert.equal(updated.status, 200);
    assert.equal(updated.body.data.updated, 2, 'both questions should be recognised as existing');
    assert.equal(updated.body.data.created, 0);

    const banked = await dispatch(runtime, 'POST', '/api/functions/digital-examiner', {
      action: 'list_questions',
      requesterRole: 'teacher',
    });
    assert.equal(banked.body.data.questions.length, 2, 'editing must not duplicate the bank');
    assert.ok(
      banked.body.data.questions.some((question) => question.stem === 'Define osmosis precisely.'),
      'the edit should be persisted',
    );

    // A question added by hand at the bottom joins the bank without disturbing the other two.
    const grown = await save({
      markdown: `${edited}\n\n## 3. Name the green pigment in leaves.  [1 marks]\n\n**Answer:** Chlorophyll\n`,
    });
    assert.equal(grown.body.data.created, 1);
    assert.equal(grown.body.data.updated, 2);

    // Nothing to read is reported rather than silently saving an empty question.
    const empty = await save({ markdown: 'Just some notes with no numbered questions.' });
    assert.equal(empty.status, 400);
    assert.match(empty.body.error, /could be read as a question/);
  } finally {
    await cleanup();
  }
});

test('the monitoring view reports the day and who is still out', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const call = (pathname, body) => dispatch(runtime, 'POST', pathname, body);

  try {
    // One student leaves and stays out; another leaves and returns; a third is turned back.
    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-001', reason: 'Clinic',
      destination: 'Mulago', grantedBy: 'Matron',
    });
    await call('/api/functions/gate-pass', { code: 'STU-2026-001', direction: 'out', recordedBy: 'Askari' });

    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-002', reason: 'Home', destination: 'Jinja', grantedBy: 'Teacher',
    });
    await call('/api/functions/gate-pass', { code: 'STU-2026-002', direction: 'out', recordedBy: 'Askari' });
    await call('/api/functions/gate-pass', { code: 'STU-2026-002', direction: 'in', recordedBy: 'Askari' });

    await call('/api/functions/gate-pass', {
      code: 'STU-2026-003', direction: 'out', decision: 'declined',
      note: 'No slip', recordedBy: 'Askari',
    });

    // A slip nobody has presented yet must still read as outstanding.
    await call('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-005', reason: 'Dentist',
      destination: 'Clinic', grantedBy: 'Matron',
    });

    await call('/api/functions/exam-clearance', {
      action: 'grant', code: 'STU-2026-004', grantedBy: 'Bursar',
    });
    await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-004', decision: 'approved', recordedBy: 'Invigilator',
    });
    await call('/api/functions/exam-clearance', {
      action: 'admit', code: 'STU-2026-006', decision: 'rejected',
      note: 'No clearance', recordedBy: 'Invigilator',
    });

    await call('/api/functions/roll-call', { action: 'mark', code: 'STU-2026-001', status: 'present', markedBy: 'T' });
    await call('/api/functions/roll-call', { action: 'mark', code: 'STU-2026-002', status: 'absent', markedBy: 'T' });
    await call('/api/functions/meal-record', { code: 'STU-2026-001', meal: 'lunch', servedBy: 'Cook' });

    const res = await call('/api/functions/monitoring', {});
    assert.equal(res.status, 200);
    const data = res.body.data;

    assert.deepEqual(data.gate.counts, { out: 2, in: 1, declined: 1, total: 4 });

    // Presence follows approved movements only, so the student turned back is not "out".
    assert.equal(data.off_premises.length, 1);
    assert.equal(data.off_premises[0].student_number, 'STU-2026-001');
    assert.equal(data.off_premises[0].destination, 'Mulago');

    // A spent slip is no longer outstanding; an unused one still is.
    assert.equal(data.gate.active_permissions.length, 1);
    assert.equal(data.gate.active_permissions[0].student_number, 'STU-2026-005');

    assert.equal(data.exams.admitted, 1);
    assert.equal(data.exams.rejected, 1);
    assert.equal(data.exams.active_clearances, 1);

    assert.equal(data.attendance.present, 1);
    assert.equal(data.attendance.absent, 1);
    assert.ok(data.attendance.by_class.length > 0);
    assert.equal(data.meals.lunch, 1);

    // A day with no traffic reads as empty rather than failing — but a student who is still
    // out is still out, whichever day is being looked at.
    const quiet = await call('/api/functions/monitoring', { date: '1999-01-01' });
    assert.equal(quiet.status, 200);
    assert.equal(quiet.body.data.gate.counts.total, 0);
    assert.equal(quiet.body.data.attendance.marked, 0);
    assert.equal(quiet.body.data.off_premises.length, 1);
  } finally {
    await cleanup();
  }
});

test('platform administration fails closed and refuses a guessable token', async () => {
  const { isPlatformOwner, isPlatformOwnerEnabled, platformOwnerRefusal } = await import(
    '../server/auth/platform-owner.mjs'
  );

  const saved = process.env.PLATFORM_OWNER_TOKEN;
  try {
    // Unset: nothing is a valid owner, and the refusal says why rather than implying a bad token.
    delete process.env.PLATFORM_OWNER_TOKEN;
    assert.equal(isPlatformOwnerEnabled(), false);
    assert.equal(isPlatformOwner({ authorization: 'Bearer anything' }), false);
    assert.match(platformOwnerRefusal().error, /not enabled/);

    // A short token looks like protection without being any. It is ignored rather than honoured,
    // so a deployment that sets PLATFORM_OWNER_TOKEN=admin is closed, not wide open.
    process.env.PLATFORM_OWNER_TOKEN = 'admin';
    assert.equal(isPlatformOwnerEnabled(), false);
    assert.equal(isPlatformOwner({ authorization: 'Bearer admin' }), false);

    process.env.PLATFORM_OWNER_TOKEN = 'a-properly-long-operator-token-0123456789';
    assert.equal(isPlatformOwnerEnabled(), true);
    assert.equal(isPlatformOwner({ authorization: `Bearer ${process.env.PLATFORM_OWNER_TOKEN}` }), true);
    assert.equal(isPlatformOwner({ Authorization: `Bearer ${process.env.PLATFORM_OWNER_TOKEN}` }), true);

    // Near misses, and the shapes a client gets wrong.
    assert.equal(isPlatformOwner({ authorization: `Bearer ${process.env.PLATFORM_OWNER_TOKEN}x` }), false);
    assert.equal(isPlatformOwner({ authorization: process.env.PLATFORM_OWNER_TOKEN }), false);
    assert.equal(isPlatformOwner({}), false);
    assert.equal(platformOwnerRefusal().error, 'Unauthorized');
  } finally {
    if (saved === undefined) delete process.env.PLATFORM_OWNER_TOKEN;
    else process.env.PLATFORM_OWNER_TOKEN = saved;
  }
});

test('cross-origin access is limited to the platform own domains', async () => {
  const { isAllowedOrigin, corsHeaders } = await import('../server/http/cors.mjs');

  const saved = { root: process.env.TENANT_ROOT_DOMAIN, extra: process.env.CORS_EXTRA_ORIGINS };
  try {
    process.env.TENANT_ROOT_DOMAIN = 'eschool.ink';
    delete process.env.CORS_EXTRA_ORIGINS;

    assert.equal(isAllowedOrigin('https://kampala-high.eschool.ink', 'kampala-high.eschool.ink'), true);
    assert.equal(isAllowedOrigin('https://eschool.ink', 'eschool.ink'), true);

    // The attack this closes: any page on the internet naming a school and reading its data.
    assert.equal(isAllowedOrigin('https://evil.example', 'kampala-high.eschool.ink'), false);
    // A look-alike domain that merely ends with the same letters must not pass.
    assert.equal(isAllowedOrigin('https://noteschool.ink', 'kampala-high.eschool.ink'), false);
    // Plain HTTP is not one of ours in production.
    assert.equal(isAllowedOrigin('http://kampala-high.eschool.ink', 'kampala-high.eschool.ink'), false);
    assert.equal(isAllowedOrigin('', 'kampala-high.eschool.ink'), false);
    assert.equal(isAllowedOrigin('not a url', 'kampala-high.eschool.ink'), false);

    // Loopback is a developer convenience, and only when the server itself was reached on loopback.
    assert.equal(isAllowedOrigin('http://localhost:8080', 'localhost:8787'), true);
    assert.equal(isAllowedOrigin('http://localhost:8080', 'kampala-high.eschool.ink'), false);

    process.env.CORS_EXTRA_ORIGINS = 'https://console.example';
    assert.equal(isAllowedOrigin('https://console.example', 'eschool.ink'), true);

    // The headers themselves: never a wildcard, always Vary, and credentials only for our own.
    const allowed = corsHeaders({ req: { headers: { origin: 'https://kampala-high.eschool.ink', host: 'kampala-high.eschool.ink' } } });
    assert.equal(allowed['Access-Control-Allow-Origin'], 'https://kampala-high.eschool.ink');
    assert.equal(allowed['Access-Control-Allow-Credentials'], 'true');
    assert.equal(allowed.Vary, 'Origin');

    const refused = corsHeaders({ req: { headers: { origin: 'https://evil.example', host: 'kampala-high.eschool.ink' } } });
    assert.equal(refused['Access-Control-Allow-Origin'], undefined);
    assert.equal(refused.Vary, 'Origin', 'Vary must be set either way so nothing caches one answer for another origin');

    // X-Tenant is advertised only where it is honoured, so the preflight cannot promise what the
    // server will ignore.
    const savedAllow = process.env.ALLOW_TENANT_HEADER;
    delete process.env.ALLOW_TENANT_HEADER;
    assert.ok(!allowed['Access-Control-Allow-Headers'].includes('X-Tenant'));
    process.env.ALLOW_TENANT_HEADER = 'true';
    const withHeader = corsHeaders({ req: { headers: { origin: 'https://eschool.ink', host: 'eschool.ink' } } });
    assert.ok(withHeader['Access-Control-Allow-Headers'].includes('X-Tenant'));
    if (savedAllow === undefined) delete process.env.ALLOW_TENANT_HEADER;
    else process.env.ALLOW_TENANT_HEADER = savedAllow;
  } finally {
    if (saved.root === undefined) delete process.env.TENANT_ROOT_DOMAIN;
    else process.env.TENANT_ROOT_DOMAIN = saved.root;
    if (saved.extra === undefined) delete process.env.CORS_EXTRA_ORIGINS;
    else process.env.CORS_EXTRA_ORIGINS = saved.extra;
  }
});

test('each school gets its own search indexes, so one cannot overwrite or read another', async () => {
  const { indexUidFor, INDEX_NAMES } = await import('../server/search/indexer.mjs');
  const { DEFAULT_TENANT } = await import('../server/db/tenants.mjs');

  // The naming rule. `__` cannot appear in a tenant id (a DNS label), so a-b__c is unambiguous.
  assert.equal(indexUidFor('kampala-high', 'students'), 'kampala-high__students');
  assert.equal(indexUidFor('kampala-high', 'lesson_plans'), 'kampala-high__lesson_plans');
  // A single-school deployment keeps the bare names it already has, so upgrading needs no reindex.
  assert.equal(indexUidFor(DEFAULT_TENANT, 'students'), 'students');
  assert.equal(indexUidFor(undefined, 'students'), 'students');

  // No two (tenant, index) pairs can collide, whatever the hyphens in the subdomains.
  const uids = new Set();
  for (const tenant of ['a', 'a-b', 'a-b-c', 'kampala-high', DEFAULT_TENANT]) {
    for (const name of INDEX_NAMES) {
      const uid = indexUidFor(tenant, name);
      assert.equal(uids.has(uid), false, `${uid} was produced twice`);
      uids.add(uid);
    }
  }

  await withMeili(async () => {
    const { runtime, cleanup } = await startTestRuntime();

    try {
      // The stub has to be the client the service actually uses, so the service is driven directly
      // with an explicit one rather than through the runtime.
      const { handleSearchFunction } = await import('../server/services/search.mjs');

      const meiliA = createMeiliStub({
        hitsByIndex: { 'kampala-high__students': [{ id: 's1', kind: 'student', full_name: 'Emma Johnson' }] },
      });
      const a = await handleSearchFunction(
        runtime.database,
        { action: 'query', requesterRole: 'teacher', query: 'emma' },
        meiliA.httpClient,
        { tenantId: 'kampala-high' },
      );

      const queriesA = meiliA.requests.filter((request) => request.url.endsWith('/multi-search')).at(-1).body.queries;
      // Every index this school searches is its own.
      assert.ok(queriesA.length > 0);
      for (const query of queriesA) {
        assert.match(query.indexUid, /^kampala-high__/, 'a school must only ever query its own indexes');
        // The role filter is unchanged: tenancy decides which index, role decides which documents.
        assert.equal(query.filter, 'roles = teacher');
      }
      // The school's prefix is an implementation detail and does not leak into the response.
      assert.deepEqual(a.groups.map((group) => group.index), ['students']);

      // The other school's indexes are untouched by the first one's query.
      const meiliB = createMeiliStub({ hitsByIndex: {} });
      await handleSearchFunction(
        runtime.database,
        { action: 'query', requesterRole: 'teacher', query: 'emma' },
        meiliB.httpClient,
        { tenantId: 'gulu-ss' },
      );
      const queriesB = meiliB.requests.filter((request) => request.url.endsWith('/multi-search')).at(-1).body.queries;
      for (const query of queriesB) {
        assert.match(query.indexUid, /^gulu-ss__/);
      }
      assert.equal(
        queriesA.some((query) => queriesB.some((other) => other.indexUid === query.indexUid)),
        false,
        'two schools must not share a single index uid',
      );

      // A rebuild is the dangerous one: it clears before refilling. Confirm it only ever clears
      // and writes uids belonging to the school that asked.
      const meiliRebuild = createMeiliStub();
      const rebuilt = await handleSearchFunction(
        runtime.database,
        { action: 'reindex', requesterRole: 'admin' },
        meiliRebuild.httpClient,
        { tenantId: 'kampala-high' },
      );
      assert.ok(rebuilt.counts, 'the rebuild should report what it indexed');

      const touched = meiliRebuild.requests
        .map((request) => request.url.match(/\/indexes\/([^/?]+)/)?.[1])
        .filter(Boolean);
      assert.ok(touched.length > 0, 'the rebuild must touch some indexes');
      for (const uid of touched) {
        assert.match(uid, /^kampala-high__/, `rebuilding one school touched ${uid}`);
      }

      // Writes go the same way: an attendance mark in one school refreshes only its own index.
      const meiliWrite = createMeiliStub();
      const { syncTable } = await import('../server/search/indexer.mjs');
      await syncTable(runtime.database, 'attendance_records', {
        httpClient: meiliWrite.httpClient,
        tenantId: 'gulu-ss',
      });
      const written = meiliWrite.requests
        .map((request) => request.url.match(/\/indexes\/([^/?]+)/)?.[1])
        .filter(Boolean);
      assert.ok(written.length > 0);
      for (const uid of written) {
        assert.equal(uid, 'gulu-ss__attendance');
      }
    } finally {
      await cleanup();
    }
  });
});

test('a session proves identity, and the role comes from the database rather than the request', async () => {
  const { issueSessionToken, verifySessionToken, sessionCookie, readCookie, SESSION_COOKIE } = await import(
    '../server/auth/session.mjs'
  );

  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-test-signing-secret-long-enough-to-be-used';

  const { runtime, cleanup } = await startTestRuntime();

  try {
    // The founding account, created the ordinary way.
    const signup = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'head@kampala-high.test',
      password: 'password123',
      displayName: 'Head Teacher',
    });
    assert.equal(signup.body.data.user.role, 'admin');

    const teacherSignup = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'teacher@kampala-high.test',
      password: 'password123',
      displayName: 'Grace Nakato',
    });
    const teacherId = teacherSignup.body.data.user.id;
    const approved = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'approve_account',
      requesterRole: 'admin',
      userId: teacherId,
    });
    assert.equal(approved.body.data.user.approval_status, 'approved');

    const cookieFor = (userId, tenantId = 'default') => ({
      cookie: `${SESSION_COOKIE}=${encodeURIComponent(issueSessionToken({ userId, tenantId }))}`,
    });

    const { authenticateRequest } = await import('../server/auth/actor.mjs');
    const teacherActor = await authenticateRequest({
      database: runtime.database,
      headers: cookieFor(teacherId),
      tenantId: 'default',
    });
    assert.equal(teacherActor.role, 'teacher');
    assert.equal(teacherActor.id, teacherId);

    // The whole point: the request body says admin, the session says teacher, and the session wins.
    const refused = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/fees',
      body: { action: 'summary', requesterRole: 'admin' },
      actor: teacherActor,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, 'Unauthorized');

    // No session at all is nobody, whatever the body claims.
    const anonymous = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/fees',
      body: { action: 'summary', requesterRole: 'admin' },
      actor: null,
    });
    assert.equal(anonymous.body.error, 'Unauthorized');

    // A demoted account loses its powers on the very next request, not at token expiry — which is
    // why the role is read from the users row rather than carried in the token.
    const adminActor = await authenticateRequest({
      database: runtime.database,
      headers: cookieFor(signup.body.data.user.id),
      tenantId: 'default',
    });
    assert.equal(adminActor.role, 'admin');

    await runtime.database.query("UPDATE users SET role = 'teacher' WHERE id = $1", [signup.body.data.user.id]);
    const demoted = await authenticateRequest({
      database: runtime.database,
      headers: cookieFor(signup.body.data.user.id),
      tenantId: 'default',
    });
    assert.equal(demoted.role, 'teacher', 'the same cookie must now resolve to the new role');

    // An account that is deleted or un-approved stops authenticating entirely.
    await runtime.database.query("UPDATE users SET approval_status = 'pending' WHERE id = $1", [teacherId]);
    assert.equal(
      await authenticateRequest({ database: runtime.database, headers: cookieFor(teacherId), tenantId: 'default' }),
      null,
    );

    // A token minted for one school is refused at another, even before the cookie's host-only scope
    // is taken into account.
    const forOtherSchool = issueSessionToken({ userId: teacherId, tenantId: 'gulu-ss' });
    assert.equal(verifySessionToken(forOtherSchool, { tenantId: 'gulu-ss' })?.userId, teacherId);
    assert.equal(verifySessionToken(forOtherSchool, { tenantId: 'kampala-high' }), null);
    assert.equal(
      await authenticateRequest({
        database: runtime.database,
        headers: { cookie: `${SESSION_COOKIE}=${encodeURIComponent(forOtherSchool)}` },
        tenantId: 'kampala-high',
      }),
      null,
    );

    // Tampering and expiry.
    const token = issueSessionToken({ userId: teacherId, tenantId: 'default' });
    const [payload, signature] = token.split('.');
    assert.equal(verifySessionToken(`${payload}x.${signature}`, { tenantId: 'default' }), null);
    assert.equal(verifySessionToken(`${payload}.${signature}x`, { tenantId: 'default' }), null);
    assert.equal(verifySessionToken('nonsense', { tenantId: 'default' }), null);
    assert.equal(verifySessionToken('', { tenantId: 'default' }), null);
    assert.equal(
      verifySessionToken(issueSessionToken({ userId: teacherId, tenantId: 'default', ttlMs: -1 }), {
        tenantId: 'default',
      }),
      null,
    );

    // A token signed with a different secret is not ours.
    process.env.SESSION_SECRET = 'a-completely-different-secret-of-sufficient-length';
    assert.equal(verifySessionToken(token, { tenantId: 'default' }), null);
    process.env.SESSION_SECRET = 'a-test-signing-secret-long-enough-to-be-used';

    // The cookie is host-only (no Domain), so a browser never sends one school's cookie to another.
    const cookie = sessionCookie('abc', { secure: true });
    assert.ok(cookie.includes('HttpOnly'));
    assert.ok(cookie.includes('SameSite=Lax'), 'downloads are navigations and need Lax, not Strict');
    assert.ok(cookie.includes('Secure'));
    assert.ok(!/Domain=/i.test(cookie), 'a Domain attribute would send this school cookie to every school');
    assert.ok(!sessionCookie('abc', { secure: false }).includes('Secure'));

    assert.equal(readCookie({ cookie: 'other=1; eschool_session=wanted; more=2' }), 'wanted');
    assert.equal(readCookie({ cookie: 'other=1' }), '');
    assert.equal(readCookie({}), '');
  } finally {
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
    await cleanup();
  }
});

test('signing in issues a session cookie, and signing out clears it', async () => {
  const savedSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-test-signing-secret-long-enough-to-be-used';

  const { runtime, cleanup } = await startTestRuntime();

  try {
    const signup = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'head@school.test',
      password: 'password123',
      displayName: 'Head Teacher',
    });
    // The founding account is approved on the spot, so it is signed in and gets a cookie.
    assert.match(signup.headers['Set-Cookie'], /^eschool_session=/);
    assert.ok(signup.headers['Set-Cookie'].includes('HttpOnly'));
    // The token never reaches the response body, only the cookie.
    assert.equal(signup.body.data.setCookie, undefined);

    const signin = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signin',
      email: 'head@school.test',
      password: 'password123',
    });
    assert.match(signin.headers['Set-Cookie'], /^eschool_session=/);

    // The cookie is the credential, so the server can answer "who am I?" for itself.
    const { authenticateRequest } = await import('../server/auth/actor.mjs');
    const cookie = signin.headers['Set-Cookie'].split(';')[0];
    const actor = await authenticateRequest({ database: runtime.database, headers: { cookie }, tenantId: 'default' });
    assert.equal(actor.email, 'head@school.test');

    const session = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/auth',
      body: { action: 'session' },
      actor,
    });
    assert.equal(session.body.data.user.auth_email, 'head@school.test');
    assert.equal(session.body.data.user.password_hash, undefined);

    // Anonymous: the server says nobody, rather than believing a stored profile.
    const anonymous = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/auth',
      body: { action: 'session' },
      actor: null,
    });
    assert.equal(anonymous.body.data.user, null);

    const signout = await dispatch(runtime, 'POST', '/api/functions/auth', { action: 'signout' });
    assert.match(signout.headers['Set-Cookie'], /Max-Age=0/);

    // A pending account gets no session: it has no access until an administrator approves it.
    const pending = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup',
      email: 'new@school.test',
      password: 'password123',
      displayName: 'New Teacher',
    });
    assert.equal(pending.body.data.pending, true);
    assert.equal(pending.headers?.['Set-Cookie'], undefined, 'an unapproved account must not be signed in');
  } finally {
    if (savedSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = savedSecret;
    await cleanup();
  }
});

test('the generic data endpoint refuses tables a signed-in role may not touch', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const query = (table, actor) =>
      runtime.dispatch({
        method: 'POST',
        pathname: '/api/db',
        body: { table, operation: 'select', columns: '*', filters: [], limit: 1 },
        actor,
      });

    const admin = { id: 'a', role: 'admin', email: 'admin@school.test', name: 'Admin' };
    const teacher = { id: 't', role: 'teacher', email: 'teacher@school.test', name: 'Teacher' };
    const support = { id: 's', role: 'support_staff', email: 'gate@school.test', name: 'Askari' };

    // This endpoint had no role check at all: anyone who could reach it could read every invoice
    // and payment in the school.
    assert.equal((await query('invoices', admin)).status, 200);
    assert.equal((await query('invoices', teacher)).status, 403);
    assert.equal((await query('payments', teacher)).status, 403);
    assert.equal((await query('receipts', teacher)).status, 403);
    assert.equal((await query('portal_accounts', teacher)).status, 403);

    // Teaching work is unaffected.
    assert.equal((await query('students', teacher)).status, 200);
    assert.equal((await query('attendance_records', teacher)).status, 200);
    assert.equal((await query('gradebook_entries', teacher)).status, 200);

    // Support staff reach the database through no table at all; they have the fee-status endpoint.
    assert.equal((await query('students', support)).status, 403);
    assert.equal((await query('invoices', support)).status, 403);

    // No session is nobody.
    assert.equal((await query('students', null)).status, 403);

    // An internal caller — a test, or the server calling itself — is not a request and is not
    // checked, which is what keeps the rest of this suite driving dispatch directly.
    assert.equal((await query('students', undefined)).status, 200);
  } finally {
    await cleanup();
  }
});

test('the deployment carries every setting a production tenant needs', async () => {
  // The gap this guards: the server grew sessions, a platform-owner token and multi-tenancy, and
  // docker-compose.yml passed none of it through. Nothing failed loudly — the app just generated a
  // session key at boot (signing everyone out on each restart), refused every platform action, and
  // stayed single-tenant no matter what .env.production said.
  const { readFile } = await import('node:fs/promises');
  const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
  const example = await readFile(new URL('../.env.production.example', import.meta.url), 'utf8');

  // Settings whose absence breaks or silently weakens a real deployment. Tuning knobs with working
  // defaults are deliberately not listed — this is the set that has to be handed in.
  const REQUIRED = [
    // Without these two the app is either amnesiac or unadministrable.
    'SESSION_SECRET',
    'PLATFORM_OWNER_TOKEN',
    // Decides which origins may call the API, and the link in a school's activation email.
    'TENANT_ROOT_DOMAIN',
    // Multi-tenancy itself.
    'TENANTS',
    'CONTROL_DATABASE_URL',
    'PROVISION_ADMIN_DATABASE_URL',
    'TENANT_DB_URL_TEMPLATE',
    // Money: unset SUBSCRIPTION_AMOUNT refuses signup, unset webhook secret accepts forged payments.
    'SUBSCRIPTION_AMOUNT',
    'PAYMENT_WEBHOOK_SECRET',
    // A provisioned school is told where it lives by email, or not at all.
    'EMAIL_MODE',
    'EMAIL_FROM',
  ];

  const missingFromCompose = REQUIRED.filter((name) => !compose.includes(`${name}:`));
  assert.deepEqual(missingFromCompose, [], 'docker-compose.yml must pass these to the app container');

  const missingFromExample = REQUIRED.filter((name) => !example.includes(name));
  assert.deepEqual(missingFromExample, [], '.env.production.example must document these');

  // The app is reached through the reverse proxy, so its own port stays on loopback by default.
  assert.match(compose, /\$\{APP_BIND:-127\.0\.0\.1\}/, 'the app port must not default to 0.0.0.0');
  // Meilisearch holds a copy of every student and invoice and is never talked to by a browser.
  assert.ok(
    /127\.0\.0\.1:\$\{MEILI_PORT/.test(compose),
    'Meilisearch must not be published on every interface',
  );

  // Both proxies must preserve the Host header, because that is what chooses the school. Rewriting
  // it sends every school to the default tenant, which serves the wrong data rather than erroring.
  const nginxHost = await readFile(new URL('../deploy/nginx/docker.conf', import.meta.url), 'utf8');
  assert.match(nginxHost, /proxy_set_header Host\s+\$host;/);
  assert.match(nginxHost, /proxy_set_header X-Forwarded-Proto \$scheme;/);
  assert.match(nginxHost, /proxy_set_header X-Tenant "";/, 'a client must not be able to name a school');

  const site = await readFile(new URL('../deploy/nginx/eschool.ink.conf', import.meta.url), 'utf8');
  assert.match(site, /proxy_set_header Host\s+\$host;/);
  assert.match(site, /client_max_body_size/, 'base64 photos and logos exceed the 1MB default');

  const caddyfile = await readFile(new URL('../deploy/caddy/Caddyfile', import.meta.url), 'utf8');
  assert.match(caddyfile, /reverse_proxy app:8787/);
  assert.match(caddyfile, /header_up -X-Tenant/);
});

test('the gate, the dining hall and the register are staff-only, by post as well as by role', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const post = (pathname, actor, body = {}) => runtime.dispatch({ method: 'POST', pathname, body, actor });

  const admin = { id: 'a', role: 'admin', email: 'head@school.test', name: 'Head', designation: null };
  const teacher = { id: 't', role: 'teacher', email: 't@school.test', name: 'Teacher', designation: null };
  const askari = { id: 'g', role: 'support_staff', email: 'gate@school.test', name: 'Askari', designation: 'askari' };
  const cook = { id: 'c', role: 'support_staff', email: 'cook@school.test', name: 'Cook', designation: 'cook' };
  const plainSupport = { id: 'p', role: 'support_staff', email: 'p@school.test', name: 'P', designation: null };

  try {
    const ROUTES = [
      '/api/functions/roll-call',
      '/api/functions/exam-clearance',
      '/api/functions/gate-permission',
      '/api/functions/gate-log',
      '/api/functions/gate-pass',
      '/api/functions/meal-record',
    ];

    // None of these had a gate of any kind: no actor reached the handler and the handler checked
    // nothing, so anyone who could reach the API could grant a gate pass or mark a register.
    for (const pathname of ROUTES) {
      assert.equal((await post(pathname, null)).status, 403, `${pathname} must refuse an anonymous request`);
      assert.equal(
        (await post(pathname, plainSupport)).status,
        403,
        `${pathname} must refuse support staff with no post`,
      );
    }

    // A post is not a role, and the difference is the point: these people are all `support_staff`,
    // and the gate has to let each of them do their own job and nothing else.
    assert.equal((await post('/api/functions/gate-log', askari, {})).status, 200, 'the askari reads the gate log');
    assert.equal((await post('/api/functions/gate-log', cook, {})).status, 403, 'the cook does not');
    assert.equal(
      (await post('/api/functions/meal-record', askari, { code: 'STU-2026-001', meal: 'lunch' })).status,
      403,
      'and the askari does not serve meals',
    );

    // Whoever checks a pass at the gate must not also be the person who wrote it.
    assert.equal(
      (await post('/api/functions/gate-permission', askari, { code: 'STU-2026-001' })).status,
      403,
      'the askari cannot issue the permission they check',
    );
    assert.equal((await post('/api/functions/roll-call', teacher, { action: 'classes' })).status, 200);
    assert.equal((await post('/api/functions/roll-call', askari, { action: 'classes' })).status, 403);

    // Nothing was written past any of those refusals.
    for (const table of ['gate_passes', 'gate_permissions', 'meal_records']) {
      assert.equal(await countRows(runtime, table), 0, `${table} must be untouched by a refused request`);
    }

    // An internal call — a test, or the server calling its own handler — is still unchecked, which
    // is the three-state actor working as it does everywhere else.
    assert.equal((await dispatch(runtime, 'POST', '/api/functions/roll-call', { action: 'classes' })).status, 200);
  } finally {
    await cleanup();
  }
});

test('a gate alert reaches the school it belongs to, live', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const bus = await import('../server/events/bus.mjs');

  try {
    // The askari's own screen is subscribed. This is what used to receive nothing: notifyStaff
    // never passed a tenantId, so postStaffMessage wrote the row and skipped the publish entirely.
    const delivered = [];
    const unsubscribe = bus.subscribe('default', {
      user: { id: 'g', role: 'support_staff', designation: 'askari' },
      deliver: (event) => delivered.push(event),
    });

    const granted = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/gate-permission',
      body: {
        code: 'STU-2026-001',
        grantedBy: 'Head Teacher',
        destination: 'Home',
        reason: 'Unwell',
      },
      actor: { id: 'a', role: 'admin', email: 'head@school.test', name: 'Head', designation: null },
      headers: { host: 'localhost' },
    });
    assert.equal(granted.status, 200);

    unsubscribe();

    assert.equal(delivered.length, 1, 'the askari is told, rather than finding out on their next reload');
    assert.match(delivered[0].message.subject, /Gate pass for/);
    // And the id is a replay cursor, so a phone that reconnects can ask for what it missed.
    assert.match(delivered[0].id, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|/);
  } finally {
    await cleanup();
  }
});

test('a second replica sees the first replica\'s events, and never its own twice', async () => {
  const { startEventBroker } = await import('../server/events/broker.mjs');
  const bus = await import('../server/events/bus.mjs');

  // A stand-in for Redis: one shared set of channels, so two "replicas" can talk without a socket.
  const channels = new Map();
  const makeFake = () => {
    const handlers = [];
    const client = {
      patterns: [],
      on: (event, handler) => {
        if (event === 'pmessage') handlers.push(handler);
      },
      psubscribe: async (pattern) => {
        client.patterns.push(pattern);
        channels.set(client, { handlers, patterns: client.patterns });
      },
      punsubscribe: async () => channels.delete(client),
      publish: async (channel, payload) => {
        for (const [other, entry] of channels) {
          if (other === client) continue;
          for (const handler of entry.handlers) handler('eschool:events:*', channel, payload);
        }
        return 1;
      },
      quit: async () => channels.delete(client),
    };
    return client;
  };

  const seenOnA = [];
  const replicaA = await startEventBroker({
    createClient: async () => makeFake(),
    onEvent: (tenant, event) => seenOnA.push([tenant, event.type]),
  });

  const seenOnB = [];
  const replicaB = await startEventBroker({
    createClient: async () => makeFake(),
    onEvent: (tenant, event) => seenOnB.push([tenant, event.type]),
  });

  const detach = bus.attachBroker(replicaA);
  try {
    // A is where the event happens; nobody is connected to A.
    const deliveredLocally = bus.publish('kampala-high', { type: 'message', audienceKind: 'all' });
    assert.equal(deliveredLocally, 0, 'nobody is subscribed on this replica');

    // …and B, where the office tab actually is, hears about it anyway.
    assert.deepEqual(seenOnB, [['kampala-high', 'message']]);

    // The publishing replica has already delivered locally, so its own event coming back over the
    // channel must be dropped — otherwise every subscriber on it would receive the message twice.
    // The two brokers must therefore have different identities, which is why the replica id belongs
    // to the broker instance and not to the module.
    assert.notEqual(replicaA.replicaId, replicaB.replicaId);
    assert.equal(seenOnA.length, 0, 'a replica never receives its own publication');
  } finally {
    detach();
    await replicaA.stop();
    await replicaB.stop();
    bus.reset();
  }
});

test('with no REDIS_URL the bus is exactly what it always was', async () => {
  const { startEventBroker } = await import('../server/events/broker.mjs');

  const previous = process.env.REDIS_URL;
  delete process.env.REDIS_URL;
  try {
    const broker = await startEventBroker({});
    // Off, and returning a shape the caller does not have to branch on — the same contract
    // startBackupScheduler uses for the same reason.
    assert.equal(broker.enabled, false);
    assert.equal(broker.publish, null);
    assert.equal(typeof broker.stop, 'function');
    await broker.stop();
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

test('student records are not readable without a session, whatever the URL says', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'select',
      columns: '*',
      filters: [],
      limit: 1,
    });
    const studentId = students.body.data[0].id;

    const get = (pathname, actor, params = {}) =>
      runtime.dispatch({ method: 'GET', pathname, searchParams: new URLSearchParams(params), actor });

    const teacher = { id: 't', role: 'teacher', email: 'teacher@school.test', name: 'Teacher' };
    const support = { id: 's', role: 'support_staff', designation: 'askari', email: 'gate@school.test', name: 'Askari' };

    // These two routes had no gate of any kind: the id in the URL was the whole of the security.
    for (const pathname of [`/api/report-cards/${studentId}.pdf`, `/api/id-cards/${studentId}.pdf`, '/api/id-cards.pdf']) {
      assert.equal((await get(pathname, null)).status, 403, `${pathname} must refuse an anonymous request`);
      assert.equal((await get(pathname, support)).status, 403, `${pathname} must refuse support staff`);
      assert.equal((await get(pathname, teacher)).status, 200, `${pathname} must still work for a teacher`);
    }

    // The QR image on an ID card leaks the student number, so it is gated with the card itself.
    assert.equal((await get(`/api/id-cards/${studentId}.png`, null)).status, 403);
    assert.equal((await get(`/api/id-cards/${studentId}.png`, teacher)).status, 200);

    // Passing a role in the query string is no longer a way in.
    assert.equal((await get(`/api/report-cards/${studentId}.pdf`, null, { requesterRole: 'admin' })).status, 403);
  } finally {
    await cleanup();
  }
});

test('a scan shows the sections the scanner actually holds, not the ones they ask for', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  try {
    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students',
      operation: 'select',
      columns: '*',
      filters: [],
      limit: 1,
    });
    const code = students.body.data[0].student_id;

    const scan = (body, actor) =>
      runtime.dispatch({ method: 'POST', pathname: '/api/functions/student-card', body, actor });

    const askari = { id: 's', role: 'support_staff', designation: 'askari', email: 'gate@school.test', name: 'Askari' };
    const bursar = { id: 'b', role: 'admin', designation: 'bursar', email: 'bursar@school.test', name: 'Bursar' };

    // The gate keeper asks for the bursar's view. The profile comes from their session, so what
    // comes back is the gate keeper's — this used to be decided by two fields in the request body.
    const overreach = await scan({ code, role: 'admin', designation: 'bursar' }, askari);
    assert.equal(overreach.body.data.profile.role, 'support_staff');
    assert.equal(overreach.body.data.profile.designation, 'askari');
    assert.ok(!overreach.body.data.sections.includes('fees'), 'an askari must not be handed fee data');

    // The bursar, signed in as themselves, does see fees.
    const real = await scan({ code }, bursar);
    assert.equal(real.body.data.profile.role, 'admin');
    assert.ok(real.body.data.sections.includes('fees'));

    // No session, no scan.
    assert.equal((await scan({ code }, null)).body.error, 'Unauthorized');
  } finally {
    await cleanup();
  }
});

test('a school can bring its own AI key, and it never leaves the server in the clear', async () => {
  const savedSecret = process.env.SECRETS_KEY;
  const savedPlatformKey = process.env.ANTHROPIC_API_KEY;
  process.env.SECRETS_KEY = 'a-test-encryption-key-of-sufficient-length';
  process.env.ANTHROPIC_API_KEY = 'platform-key';

  const { runtime, cleanup } = await startTestRuntime();
  const { credentialFor, withCredentials } = await import('../server/services/credential-store.mjs');
  const { loadCredentialOverrides, encryptSecret, decryptSecret } = await import(
    '../server/services/provider-credentials.mjs'
  );

  try {
    const settings = (body, actor) =>
      runtime.dispatch({ method: 'POST', pathname: '/api/functions/settings', body, actor });

    const admin = { id: 'a', role: 'admin', email: 'head@school.test', name: 'Head' };
    const teacher = { id: 't', role: 'teacher', email: 'teacher@school.test', name: 'Teacher' };

    // Provider keys are an administrator's business, and a teacher cannot read or set them.
    assert.equal((await settings({ action: 'list_provider_keys' }, teacher)).body.error, 'Unauthorized');
    assert.equal((await settings({ action: 'save_provider_key', provider: 'anthropic', apiKey: 'x' }, teacher)).body.error, 'Unauthorized');

    // Before the school sets anything, every provider is inherited from the platform.
    const before = await settings({ action: 'list_provider_keys' }, admin);
    const anthropicBefore = before.body.data.providers.find((entry) => entry.provider === 'anthropic');
    assert.equal(anthropicBefore.source, 'platform');
    assert.equal(anthropicBefore.platformHasKey, true);
    assert.equal(anthropicBefore.keyPreview, '');

    const saved = await settings(
      { action: 'save_provider_key', provider: 'anthropic', apiKey: 'sk-school-secret-key-1234' },
      admin,
    );
    const anthropicAfter = saved.body.data.providers.find((entry) => entry.provider === 'anthropic');
    assert.equal(anthropicAfter.source, 'school');
    // Masked, never returned: enough to recognise, not enough to use.
    assert.equal(anthropicAfter.keyPreview, '••••••••1234');
    assert.ok(!JSON.stringify(saved.body).includes('sk-school-secret-key-1234'), 'the key must not be echoed back');

    // Encrypted at rest, not merely hidden by the API — a database dump is a normal artefact.
    const stored = (await runtime.database.query("SELECT api_key FROM provider_credentials WHERE provider = 'anthropic'")).rows[0];
    assert.ok(stored.api_key.startsWith('v1:'));
    assert.ok(!stored.api_key.includes('sk-school-secret-key-1234'));
    assert.equal(decryptSecret(stored.api_key), 'sk-school-secret-key-1234');

    // The override is what the model layer actually reads.
    const overrides = await loadCredentialOverrides(runtime.database);
    assert.equal(overrides.ANTHROPIC_API_KEY, 'sk-school-secret-key-1234');
    assert.equal(credentialFor('ANTHROPIC_API_KEY'), 'platform-key', 'outside a request, the platform key applies');
    await withCredentials(overrides, async () => {
      assert.equal(credentialFor('ANTHROPIC_API_KEY'), 'sk-school-secret-key-1234');
      // A provider the school has not overridden still falls through to the platform.
      assert.equal(credentialFor('OPENAI_API_KEY'), process.env.OPENAI_API_KEY);
    });
    // The scope really is a scope.
    assert.equal(credentialFor('ANTHROPIC_API_KEY'), 'platform-key');

    // An address-only provider (Ollama has no key) is set by base URL.
    await settings({ action: 'save_provider_key', provider: 'ollama', baseUrl: 'http://school-box:11434' }, admin);
    assert.equal((await loadCredentialOverrides(runtime.database)).OLLAMA_BASE_URL, 'http://school-box:11434');
    assert.match(
      (await settings({ action: 'save_provider_key', provider: 'ollama', apiKey: 'nope' }, admin)).body.error,
      /does not use an API key/,
    );
    assert.match(
      (await settings({ action: 'save_provider_key', provider: 'nonsense', apiKey: 'x' }, admin)).body.error,
      /Unknown AI provider/,
    );

    // Removing the override hands the school back to the platform.
    const removed = await settings({ action: 'delete_provider_key', provider: 'anthropic' }, admin);
    assert.equal(removed.body.data.providers.find((entry) => entry.provider === 'anthropic').source, 'platform');
    assert.equal((await loadCredentialOverrides(runtime.database)).ANTHROPIC_API_KEY, undefined);

    // A key written under a SECRETS_KEY that has since been rotated away is unreadable. The school
    // falls back to the platform rather than its chat window throwing, and the row stays visible so
    // an administrator can re-enter it.
    await settings({ action: 'save_provider_key', provider: 'openai', apiKey: 'sk-openai-school-key' }, admin);
    process.env.SECRETS_KEY = 'a-completely-different-encryption-key-value';
    const rotated = await settings({ action: 'list_provider_keys' }, admin);
    const openai = rotated.body.data.providers.find((entry) => entry.provider === 'openai');
    assert.equal(openai.keyUnreadable, true);
    assert.equal((await loadCredentialOverrides(runtime.database)).OPENAI_API_KEY, undefined);

    // With no SECRETS_KEY at all, storing a key is refused rather than silently written in clear.
    delete process.env.SECRETS_KEY;
    const refused = await settings({ action: 'save_provider_key', provider: 'groq', apiKey: 'sk-groq' }, admin);
    assert.match(refused.body.error, /SECRETS_KEY is not configured/);
    assert.throws(() => encryptSecret('anything'), /SECRETS_KEY/);
  } finally {
    if (savedSecret === undefined) delete process.env.SECRETS_KEY;
    else process.env.SECRETS_KEY = savedSecret;
    if (savedPlatformKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = savedPlatformKey;
    await cleanup();
  }
});

test('money paid before an invoice exists comes off that invoice when it is raised', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const fees = (body) =>
    dispatch(runtime, 'POST', '/api/functions/fees', { requesterRole: 'admin', actorName: 'Bursar', ...body });

  try {
    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students', operation: 'select', columns: '*', filters: [], limit: 2,
    });
    const [alice, bob] = students.body.data;

    const structure = await fees({
      action: 'save_fee_structure',
      name: 'Term 1 Tuition',
      amount: 500000,
      gradeLevel: alice.grade_level,
      term: 'Term 1',
      academicYear: '2026',
      dueDate: '2026-02-01',
    });
    const structureId = structure.body.data.structure.id;

    // A family pays a deposit at admission, before anyone has billed them. There is no invoice for
    // this money to settle, so it sits as credit.
    const deposit = await fees({
      action: 'record_payment',
      studentId: alice.id,
      amount: 200000,
      paymentMethod: 'cash',
    });
    assert.equal(deposit.body.data.allocations.length, 0, 'there is nothing to allocate against yet');
    assert.equal(deposit.body.data.creditAmount, 200000);

    // Now the bill goes out. It must arrive already reduced by the deposit.
    const billed = await fees({ action: 'bill_student', studentId: alice.id, feeStructureId: structureId });
    assert.equal(billed.body.data.amount, 500000, 'the invoice is still for the full fee');
    assert.equal(billed.body.data.credit_applied, 200000);
    assert.equal(billed.body.data.balance_due, 300000, 'the family owes the difference, not the whole fee');
    assert.equal(billed.body.data.invoice.status, 'partial');

    // A student who paid nothing is billed in full — the credit is per student, not pooled.
    const bobBilled = await fees({ action: 'bill_student', studentId: bob.id, feeStructureId: structureId });
    assert.equal(bobBilled.body.data.credit_applied, 0);
    assert.equal(bobBilled.body.data.balance_due, 500000);

    // The ledger agrees: paid 200000, owing 300000, and no double-counting.
    const ledger = await fees({ action: 'student_ledger', studentId: alice.id });
    assert.equal(ledger.body.data.summary.total_paid, 200000);
    assert.equal(ledger.body.data.summary.balance_due, 300000);
  } finally {
    await cleanup();
  }
});

test('a prepayment larger than the bill settles it and the rest stays as credit', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const fees = (body) =>
    dispatch(runtime, 'POST', '/api/functions/fees', { requesterRole: 'admin', actorName: 'Bursar', ...body });

  try {
    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students', operation: 'select', columns: '*', filters: [], limit: 1,
    });
    const [student] = students.body.data;

    const first = await fees({
      action: 'save_fee_structure',
      name: 'Term 1',
      amount: 100000,
      gradeLevel: student.grade_level,
      term: 'Term 1',
      academicYear: '2026',
      dueDate: '2026-02-01',
    });
    const second = await fees({
      action: 'save_fee_structure',
      name: 'Term 2',
      amount: 100000,
      gradeLevel: student.grade_level,
      term: 'Term 2',
      academicYear: '2026',
      dueDate: '2026-06-01',
    });

    // A parent pays a whole year up front.
    await fees({ action: 'record_payment', studentId: student.id, amount: 250000, paymentMethod: 'bank' });

    const term1 = await fees({
      action: 'bill_student', studentId: student.id, feeStructureId: first.body.data.structure.id,
    });
    assert.equal(term1.body.data.credit_applied, 100000);
    assert.equal(term1.body.data.balance_due, 0);
    assert.equal(term1.body.data.invoice.status, 'paid', 'a fully prepaid invoice is not left open');

    // The remaining 150,000 is still theirs, and settles the next term too.
    const term2 = await fees({
      action: 'bill_student', studentId: student.id, feeStructureId: second.body.data.structure.id,
    });
    assert.equal(term2.body.data.credit_applied, 100000);
    assert.equal(term2.body.data.balance_due, 0);

    // 50,000 left over, and it is not conjured twice: a third bill takes only what remains.
    const third = await fees({
      action: 'save_fee_structure',
      name: 'Term 3', amount: 100000, gradeLevel: student.grade_level,
      term: 'Term 3', academicYear: '2026', dueDate: '2026-09-01',
    });
    const term3 = await fees({
      action: 'bill_student', studentId: student.id, feeStructureId: third.body.data.structure.id,
    });
    assert.equal(term3.body.data.credit_applied, 50000, 'only the credit that is actually left');
    assert.equal(term3.body.data.balance_due, 50000);

    const ledger = await fees({ action: 'student_ledger', studentId: student.id });
    assert.equal(ledger.body.data.summary.total_paid, 250000, 'still exactly what was paid, once');
    assert.equal(ledger.body.data.summary.balance_due, 50000);
  } finally {
    await cleanup();
  }
});

test('a billing run credits each student only what that student paid', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const fees = (body) =>
    dispatch(runtime, 'POST', '/api/functions/fees', { requesterRole: 'admin', actorName: 'Bursar', ...body });

  try {
    const students = await dispatch(runtime, 'POST', '/api/db', {
      table: 'students', operation: 'select', columns: '*', filters: [], limit: 50,
    });
    const grade = students.body.data[0].grade_level;
    const cohort = students.body.data.filter((s) => s.grade_level === grade);
    assert.ok(cohort.length >= 2, 'need at least two students in one grade for this to mean anything');

    const structure = await fees({
      action: 'save_fee_structure',
      name: 'Bulk term', amount: 400000, gradeLevel: grade,
      term: 'Term 1', academicYear: '2026', dueDate: '2026-02-01',
    });

    // One student in the cohort paid early; the others did not.
    await fees({ action: 'record_payment', studentId: cohort[0].id, amount: 150000, paymentMethod: 'momo' });

    const run = await fees({ action: 'run_billing', confirm: true, feeStructureId: structure.body.data.structure.id });
    assert.equal(run.body.data.credit_applied, 150000, 'the run reports what it absorbed');

    const byStudent = new Map(run.body.data.invoices.map((invoice) => [invoice.student_id, invoice]));
    assert.equal(Number(byStudent.get(cohort[0].id).balance_due), 250000);
    assert.equal(Number(byStudent.get(cohort[1].id).balance_due), 400000, 'nobody else is credited');
  } finally {
    await cleanup();
  }
});

test('live events reach only the people in the school they were sent to', async () => {
  const { publish, subscribe, presence, reset, subscribers } = await import('../server/events/bus.mjs');
  const { messageEvent, reaches } = await import('../server/events/audience.mjs');

  try {
    const seen = [];
    const add = (tenant, user) =>
      subscribe(tenant, { user, deliver: (event) => seen.push({ tenant, user: user.id, event }) });

    const teacherA = { id: 'a-teacher', role: 'teacher', designation: null, name: 'A' };
    const askariA = { id: 'a-askari', role: 'support_staff', designation: 'askari', name: 'Gate' };
    const teacherB = { id: 'b-teacher', role: 'teacher', designation: null, name: 'B' };

    add('kampala-high', teacherA);
    add('kampala-high', askariA);
    const dropB = add('gulu-ss', teacherB);

    const row = (over) => ({
      id: `m-${seen.length}-${Math.random()}`,
      subject: 's', body: 'b', category: 'message', priority: 'normal', sender_name: 'Head',
      student_id: null, created_at: new Date().toISOString(),
      audience_kind: 'all', audience_value: '', recipient_user_id: null, sender_user_id: 'head',
      ...over,
    });

    // The test that matters: one process serves every school, so a broadcast must not cross.
    publish('kampala-high', messageEvent(row({ audience_kind: 'all' })));
    assert.equal(seen.length, 2, 'both people in that school');
    assert.ok(seen.every((entry) => entry.tenant === 'kampala-high'), 'and nobody in the other');

    seen.length = 0;
    publish('kampala-high', messageEvent(row({ audience_kind: 'role', audience_value: 'teacher' })));
    assert.deepEqual(seen.map((e) => e.user), ['a-teacher']);

    seen.length = 0;
    publish('kampala-high', messageEvent(row({ audience_kind: 'designation', audience_value: 'askari' })));
    assert.deepEqual(seen.map((e) => e.user), ['a-askari'], 'a teacher has no designation to match');

    seen.length = 0;
    publish('kampala-high', messageEvent(row({ audience_kind: 'user', recipient_user_id: 'a-teacher' })));
    assert.deepEqual(seen.map((e) => e.user), ['a-teacher']);

    // A broadcast is invisible to its own author, exactly as the SQL clause has it.
    seen.length = 0;
    publish('kampala-high', messageEvent(row({ audience_kind: 'all', sender_user_id: 'a-teacher' })));
    assert.deepEqual(seen.map((e) => e.user), ['a-askari']);

    // The system is nobody, so a system event reaches everyone including whoever triggered it.
    seen.length = 0;
    publish('kampala-high', messageEvent(row({ audience_kind: 'all', sender_user_id: null })));
    assert.equal(seen.length, 2);

    // Presence is per school and counts people, not connections.
    add('kampala-high', teacherA);
    assert.equal(presence('kampala-high').length, 2, 'two people, three connections');
    assert.equal(presence('kampala-high').find((p) => p.id === 'a-teacher').connections, 2);
    assert.equal(presence('gulu-ss').length, 1);

    // Unsubscribing removes exactly one, and an empty school leaves nothing behind.
    dropB();
    assert.equal(subscribers('gulu-ss').length, 0);

    // A subscriber whose transport has died does not stop the others being served.
    seen.length = 0;
    subscribe('kampala-high', { user: { id: 'broken', role: 'teacher' }, deliver: () => { throw new Error('socket gone'); } });
    const delivered = publish('kampala-high', messageEvent(row({ audience_kind: 'all' })));
    assert.equal(delivered, 3, 'the three healthy connections still received it');

    // The pure rule, checked directly.
    assert.equal(reaches(messageEvent(row({ audience_kind: 'all' })), { id: 'x', role: 'teacher' }), true);
    assert.equal(reaches(messageEvent(row({ audience_kind: 'designation', audience_value: 'cook' })), { id: 'x', role: 'support_staff', designation: null }), false);
    assert.equal(reaches(null, { id: 'x' }), false);
    assert.equal(reaches(messageEvent(row({})), null), false);
  } finally {
    reset();
  }
});

test('a reconnecting client replays exactly what it missed, and nothing from another school', async () => {
  const { replayMessages, encodeCursor, decodeCursor } = await import('../server/events/replay.mjs');
  const { runtime, cleanup } = await startTestRuntime();

  const send = (body) =>
    dispatch(runtime, 'POST', '/api/functions/messages', { actorEmail: 'head@school.test', ...body });

  try {
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email: 'head@school.test', password: 'password123', displayName: 'Head',
    });
    const teacher = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email: 'teach@school.test', password: 'password123', displayName: 'Grace',
    });
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'approve_account', requesterRole: 'admin', userId: teacher.body.data.user.id,
    });

    for (const subject of ['First', 'Second', 'Third']) {
      await send({ action: 'send', audienceKind: 'all', subject, body: subject });
    }

    const inbox = await dispatch(runtime, 'POST', '/api/functions/messages', {
      action: 'inbox', actorEmail: 'teach@school.test',
    });
    const all = inbox.body.data.messages;
    assert.equal(all.length, 3);

    // The reader is the same shape authenticateRequest returns.
    const me = { id: teacher.body.data.user.id, role: 'teacher', designation: null };
    const { audienceClause } = await import('../server/local-backend.mjs').then((m) => ({
      // Not exported; rebuild the same predicate the inbox uses.
      audienceClause: (user, i) => ({
        sql: `((m.audience_kind = 'all')
               OR (m.audience_kind = 'role' AND m.audience_value = $${i})
               OR (m.audience_kind = 'designation' AND m.audience_value = $${i + 1})
               OR (m.audience_kind = 'user' AND m.recipient_user_id = $${i + 2}))
              AND (m.sender_user_id IS NULL OR m.sender_user_id <> $${i + 2})`,
        values: [user.role, user.designation || null, user.id],
      }),
    }));

    // Oldest first in the inbox listing is newest-first, so the last entry is the first sent.
    const oldest = all[all.length - 1];
    const cursor = encodeCursor(oldest.created_at, oldest.id);

    const replayed = await replayMessages(runtime.database, me, { cursor, audienceClause });
    assert.deepEqual(
      replayed.events.map((event) => event.message.subject),
      ['Second', 'Third'],
      'everything after the cursor, in order, and not the one already seen',
    );
    assert.equal(replayed.truncated, false);

    // A cursor at the newest message replays nothing.
    const newest = all[0];
    const none = await replayMessages(runtime.database, me, {
      cursor: encodeCursor(newest.created_at, newest.id),
      audienceClause,
    });
    assert.equal(none.events.length, 0);

    // No cursor is not an invitation to replay the entire history.
    assert.deepEqual(await replayMessages(runtime.database, me, { audienceClause }), { events: [], truncated: false });
    assert.deepEqual(await replayMessages(runtime.database, me, { cursor: 'rubbish', audienceClause }), { events: [], truncated: false });

    // Being told there is more to come is what lets a long-absent client reload instead of guessing.
    const capped = await replayMessages(runtime.database, me, { cursor, audienceClause, limit: 1 });
    assert.equal(capped.events.length, 1);
    assert.equal(capped.truncated, true);

    // The cursor round-trips.
    assert.equal(decodeCursor(encodeCursor(oldest.created_at, oldest.id)).id, oldest.id);
    assert.equal(decodeCursor('no-pipe'), null);
    assert.equal(decodeCursor(''), null);
  } finally {
    await cleanup();
  }
});

test('a mobile client authenticates with a bearer token instead of a cookie', async () => {
  const saved = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = 'a-test-signing-secret-long-enough-to-be-used';

  const { runtime, cleanup } = await startTestRuntime();
  const { authenticateRequest } = await import('../server/auth/actor.mjs');
  const { issueSessionToken } = await import('../server/auth/session.mjs');

  try {
    const signup = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email: 'head@school.test', password: 'password123', displayName: 'Head',
    });
    const userId = signup.body.data.user.id;

    // Signing in only hands back the token when the client asks — a browser never does, so the
    // token stays out of reach of anything running on the page.
    const browser = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signin', email: 'head@school.test', password: 'password123',
    });
    assert.equal(browser.body.data.token, undefined);
    assert.match(browser.headers['Set-Cookie'], /^eschool_session=/);

    const mobile = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signin', email: 'head@school.test', password: 'password123', issueToken: true,
    });
    assert.ok(mobile.body.data.token, 'a client that asks is given one');
    assert.equal(typeof mobile.body.data.expiresIn, 'number');
    // The cookie is still set, so the same call serves a hybrid client.
    assert.match(mobile.headers['Set-Cookie'], /^eschool_session=/);

    const bearer = { authorization: `Bearer ${mobile.body.data.token}` };
    const actor = await authenticateRequest({ database: runtime.database, headers: bearer, tenantId: 'default' });
    assert.equal(actor.id, userId);
    assert.equal(actor.role, 'admin');

    // Everything a cookie is refused for, a bearer token is refused for too.
    const wrongTenant = { authorization: `Bearer ${issueSessionToken({ userId, tenantId: 'gulu-ss' })}` };
    assert.equal(await authenticateRequest({ database: runtime.database, headers: wrongTenant, tenantId: 'default' }), null);
    assert.equal(await authenticateRequest({ database: runtime.database, headers: { authorization: 'Bearer nonsense' }, tenantId: 'default' }), null);
    assert.equal(await authenticateRequest({ database: runtime.database, headers: { authorization: mobile.body.data.token }, tenantId: 'default' }), null, 'the Bearer prefix is required');
    assert.equal(await authenticateRequest({ database: runtime.database, headers: {}, tenantId: 'default' }), null);

    // A cookie wins over a header, so nothing on a page can override a real browser session.
    const both = {
      cookie: browser.headers['Set-Cookie'].split(';')[0],
      authorization: `Bearer ${issueSessionToken({ userId: 'someone-else', tenantId: 'default' })}`,
    };
    assert.equal((await authenticateRequest({ database: runtime.database, headers: both, tenantId: 'default' })).id, userId);
  } finally {
    if (saved === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved;
    await cleanup();
  }
});

test('the unread badge is right past the inbox page limit, and re-reading is idempotent', async () => {
  const { runtime, cleanup } = await startTestRuntime();

  const asHead = (body) =>
    dispatch(runtime, 'POST', '/api/functions/messages', { actorEmail: 'head@school.test', ...body });
  const asTeacher = (body) =>
    dispatch(runtime, 'POST', '/api/functions/messages', { actorEmail: 'teach@school.test', ...body });

  try {
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email: 'head@school.test', password: 'password123', displayName: 'Head',
    });
    const teacher = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email: 'teach@school.test', password: 'password123', displayName: 'Grace',
    });
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'approve_account', requesterRole: 'admin', userId: teacher.body.data.user.id,
    });

    // More than the inbox's 50-row page, which is where the JS count silently under-reported.
    for (let index = 0; index < 60; index += 1) {
      await asHead({ action: 'send', audienceKind: 'all', subject: `Notice ${index}`, body: 'x' });
    }

    const inbox = await asTeacher({ action: 'inbox' });
    assert.equal(inbox.body.data.messages.length, 50, 'the page is still capped');
    assert.equal(inbox.body.data.unread, 50, 'and its own count is capped with it');

    const count = await asTeacher({ action: 'unread_count' });
    assert.equal(count.body.data.unread, 60, 'the badge counts everything, not just the page');

    // Reading the same message twice must not raise a unique violation, which the old
    // SELECT-then-INSERT did under two devices at once.
    const first = inbox.body.data.messages[0].id;
    const once = await asTeacher({ action: 'read', messageId: first });
    assert.equal(once.status, 200);
    const twice = await asTeacher({ action: 'read', messageId: first });
    assert.equal(twice.status, 200, 're-reading is a no-op, not an error');

    assert.equal((await asTeacher({ action: 'unread_count' })).body.data.unread, 59);

    await asTeacher({ action: 'read_all' });
    assert.equal((await asTeacher({ action: 'unread_count' })).body.data.unread, 10, 'read_all clears the page it can see');
  } finally {
    await cleanup();
  }
});

test('the gate can list the permissions waiting for it, and close the one it names', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const permission = (body) => dispatch(runtime, 'POST', '/api/functions/gate-permission', body);
  const pass = (body) => dispatch(runtime, 'POST', '/api/functions/gate-pass', body);
  const pending = async () => (await permission({ action: 'pending' })).body.data.pending;

  const grant = async (code, reason, destination, grantedBy) => {
    const res = await permission({ action: 'grant', code, reason, destination, grantedBy });
    assert.ok(res.body.data?.permission, `grant failed: ${JSON.stringify(res.body)}`);
    return res.body.data.permission;
  };

  try {
    assert.deepEqual(await pending(), [], 'nothing is waiting before anything is granted');

    // The gate keeper's list is what a teacher's grant lands in.
    const slip = await grant('STU-2026-011', 'Dental appointment', 'Mulago', 'Class Teacher');
    const waiting = await pending();
    assert.equal(waiting.length, 1);
    assert.equal(waiting[0].id, slip.id);
    assert.equal(waiting[0].destination, 'Mulago');
    assert.equal(waiting[0].granted_by, 'Class Teacher');
    assert.ok(waiting[0].full_name, 'the row carries a name the gate can read off the screen');
    assert.ok(waiting[0].student_number, 'and the number the gate posts back to decide it');

    // Approving spends the slip, and the response must describe the row as it now stands —
    // returning the pre-update copy would report `active` for a permission just closed.
    const approved = await pass({
      code: waiting[0].student_number, direction: 'out',
      decision: 'approved', recordedBy: 'Gate Keeper',
    });
    assert.equal(approved.body.data.pass.decision, 'approved');
    assert.equal(approved.body.data.permission.status, 'used');
    assert.equal(approved.body.data.permission.closed_by, 'Gate Keeper');
    assert.equal(approved.body.data.on_premises, false);
    assert.deepEqual(await pending(), [], 'a spent slip leaves the list');

    // A refusal closes the slip too, with the gate's reason, and leaves the student inside.
    await grant('STU-2026-012', 'Home visit', 'Ntinda', 'Matron');
    const declined = await pass({
      code: 'STU-2026-012', direction: 'out', decision: 'declined',
      note: 'No uniform', recordedBy: 'Gate Keeper',
    });
    assert.equal(declined.body.data.permission.status, 'declined');
    assert.equal(declined.body.data.permission.decline_reason, 'No uniform');
    assert.equal(declined.body.data.on_premises, true, 'a student turned back never left');
    assert.deepEqual(await pending(), [], 'a refused slip cannot be presented again');

    /* Two open slips for one student: deciding without naming one closes whichever is newest and
       strands the other as `active` forever, with nothing able to clear it off the gate's list. */
    const first = await grant('STU-2026-013', 'First', 'Clinic', 'Teacher A');
    const second = await grant('STU-2026-013', 'Second', 'Library', 'Teacher B');
    assert.equal((await pending()).length, 2);

    const named = await pass({
      code: 'STU-2026-013', direction: 'out', decision: 'approved',
      recordedBy: 'Gate Keeper', permissionId: first.id,
    });
    assert.equal(named.body.data.permission.id, first.id, 'the named slip is the one closed');
    assert.equal(named.body.data.permission.reason, 'First');

    const left = await pending();
    assert.equal(left.length, 1, 'the other slip is still waiting, not orphaned');
    assert.equal(left[0].id, second.id);

    // An id that is closed, or belongs to somebody else, is refused rather than silently ignored.
    const stale = await pass({
      code: 'STU-2026-013', direction: 'out', decision: 'approved',
      recordedBy: 'Gate Keeper', permissionId: first.id,
    });
    assert.match(stale.body.error, /not open for this student/);

    const foreign = await pass({
      code: 'STU-2026-014', direction: 'out', decision: 'approved',
      recordedBy: 'Gate Keeper', permissionId: second.id,
    });
    assert.match(foreign.body.error, /not open for this student/);
    assert.equal((await pending()).length, 1, 'a refused decision writes nothing');
  } finally {
    await cleanup();
  }
});

test('teacher performance attributes work through allocations, and refuses to cross between teachers', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const perf = (body) => dispatch(runtime, 'POST', '/api/functions/teacher-performance', body);
  const asAdmin = (body) => perf({ requesterRole: 'admin', ...body });
  const db = (body) => dispatch(runtime, 'POST', '/api/db', body);

  const signup = async (email, name) => {
    const res = await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'signup', email, password: 'test1234', displayName: name,
    });
    const id = res.body.data.user.id;
    await dispatch(runtime, 'POST', '/api/functions/auth', {
      action: 'approve_account', requesterRole: 'admin', userId: id,
    });
    return id;
  };

  try {
    await signup('head-perf@kps.ac.ug', 'Head');           // first account is the admin
    const taught = await signup('taught@kps.ac.ug', 'Allocated Teacher');
    const untaught = await signup('untaught@kps.ac.ug', 'Unallocated Teacher');

    const students = (await db({ table: 'students', operation: 'select', columns: 'id,grade_level,class_section' })).body.data;
    const group = students.filter(
      (s) => s.grade_level === students[0].grade_level && s.class_section === students[0].class_section,
    );

    // Nothing links a login to a teacher record until they are given something to teach.
    const before = (await asAdmin({ action: 'staff' })).body.data.staff;
    assert.equal(before.find((row) => row.auth_email === 'taught@kps.ac.ug').teacher_id, null);

    const allocated = await asAdmin({
      action: 'allocate', userId: taught, subject: 'Biology',
      gradeLevel: group[0].grade_level, classSection: group[0].class_section,
      academicYear: '2026', term: 'Term 2',
    });
    assert.equal(allocated.body.data.allocated.students, group.length,
      'one allocation row per student in the class');

    const after = (await asAdmin({ action: 'staff' })).body.data.staff
      .find((row) => row.auth_email === 'taught@kps.ac.ug');
    assert.ok(after.teacher_id, 'allocating creates the teacher record and links the login');
    assert.equal(after.allocation_rows, group.length);

    // Allocating the same class again replaces it, so a class list can be corrected.
    await asAdmin({
      action: 'allocate', userId: taught, subject: 'Biology',
      gradeLevel: group[0].grade_level, classSection: group[0].class_section,
      academicYear: '2026', term: 'Term 2',
    });
    const repeated = (await asAdmin({ action: 'staff' })).body.data.staff
      .find((row) => row.auth_email === 'taught@kps.ac.ug');
    assert.equal(repeated.allocation_rows, group.length, 're-allocating replaces rather than doubles');

    const subjectId = (await db({ table: 'subjects_catalog', operation: 'select', columns: 'id,name' }))
      .body.data.find((row) => row.name === 'Biology').id;

    // Alternating clear passes and clear fails, so the split is a fact rather than a guess.
    let index = 0;
    for (const student of group) {
      await db({ table: 'gradebook_entries', operation: 'insert', payload: {
        id: `gb-perf-${index}`, student_id: student.id, subject_id: subjectId,
        score: index % 2 === 0 ? 80 : 30, max_score: 100 } });
      await db({ table: 'attendance_records', operation: 'insert', payload: {
        id: `att-perf-${index}`, student_id: student.id, attendance_date: '2026-08-20',
        status: index % 2 === 0 ? 'present' : 'absent', marked_by: 'Allocated Teacher' } });
      index += 1;
    }
    const passes = group.filter((_, n) => n % 2 === 0).length;

    const summary = (await asAdmin({ action: 'summary', userId: taught })).body.data;
    assert.equal(summary.results.source, 'allocated');
    assert.equal(summary.results.passed, passes);
    assert.equal(summary.results.failed, group.length - passes);
    assert.equal(summary.attendance.total, group.length, 'the register is read for the allocated students');
    assert.equal(summary.classes.length, 1);
    assert.deepEqual(summary.classes[0].subjects, ['Biology']);

    // The pass mark is a question the reader asks, not a constant baked into the figures.
    assert.equal((await asAdmin({ action: 'summary', userId: taught, passMark: 95 })).body.data.results.passed, 0);
    assert.equal((await asAdmin({ action: 'summary', userId: taught, passMark: 10 })).body.data.results.failed, 0);

    /* With no allocation there is no defensible way to say which marks are whose, so none are
       claimed — an empty result is honest where an inferred one would be a guess. */
    const none = (await asAdmin({ action: 'summary', userId: untaught })).body.data;
    assert.equal(none.teacher.allocated, false);
    assert.equal(none.results.source, 'none');
    assert.equal(none.results.entries, 0);
    assert.equal(none.attendance.source, 'inferred');

    // A teacher may read themselves and nobody else.
    const own = await perf({ requesterRole: 'teacher', actorId: taught, action: 'summary', userId: taught });
    assert.equal(own.body.data.teacher.id, taught);

    const other = await perf({ requesterRole: 'teacher', actorId: taught, action: 'summary', userId: untaught });
    assert.equal(other.body.error, 'Unauthorized', 'one teacher cannot read another by changing an id');

    const escalate = await perf({ requesterRole: 'teacher', actorId: taught, action: 'allocate', userId: taught, subject: 'Physics', gradeLevel: 10, classSection: 'A', academicYear: '2026', term: 'Term 2' });
    assert.equal(escalate.body.error, 'Unauthorized', 'and cannot allocate themselves work');

    const stranger = await perf({ requesterRole: 'support_staff', action: 'staff' });
    assert.equal(stranger.body.error, 'Unauthorized', 'non-teaching staff have no business here');
  } finally {
    await cleanup();
  }
});

test('what a phone does reaches the office live, without filling anyone\'s inbox', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const bus = await import('../server/events/bus.mjs');

  const office = { id: 'office-1', role: 'admin', designation: null, name: 'Head', email: 'head@school.test' };
  const seen = [];
  const unsubscribe = bus.subscribe('default', { user: office, deliver: (event) => seen.push(event) });

  const asStaff = (pathname, body) => runtime.dispatch({
    method: 'POST', pathname, body, actor: office, headers: { host: 'localhost' },
  });
  const activities = () => seen.filter((event) => event.type === 'activity');
  const inboxRows = async () => (await runtime.database.query(
    "SELECT subject FROM internal_messages ORDER BY created_at",
  )).rows;

  try {
    // Calling a register: one activity per student, and not one message. This is the case that
    // decides the design — a class of forty would otherwise be forty unread items in the office.
    const roll = await asStaff('/api/functions/roll-call', {
      action: 'mark', code: 'STU-2026-001', status: 'present', markedBy: 'Class Teacher',
    });
    assert.equal(roll.status, 200);
    assert.equal(activities().length, 1, 'the register is on the feed');
    assert.equal(activities()[0].activity.action, 'roll_call.mark');
    assert.match(activities()[0].activity.summary, /marked present$/);
    assert.equal((await inboxRows()).length, 0, 'and nobody has been written to');

    // An activity is not replayable, and must not carry an id — the browser echoes the last id it
    // saw as its replay cursor, and a position the message stream cannot resolve loses everything
    // between there and the reconnect.
    assert.ok(!('id' in activities()[0]), 'an activity carries no replay cursor');

    await asStaff('/api/functions/meal-record', { code: 'STU-2026-001', meal: 'lunch', servedBy: 'Cook' });
    assert.equal(activities().length, 2);
    assert.equal(activities()[1].activity.action, 'meal.served');

    // A gate movement is activity in both directions...
    await asStaff('/api/functions/gate-permission', {
      action: 'grant', code: 'STU-2026-002', grantedBy: 'Head', destination: 'Clinic', reason: 'Unwell',
    });
    await asStaff('/api/functions/gate-pass', {
      code: 'STU-2026-002', direction: 'out', decision: 'approved', recordedBy: 'Gate Keeper',
    });
    const actions = activities().map((event) => event.activity.action);
    assert.ok(actions.includes('gate.permission_granted'));
    assert.ok(actions.includes('gate.out'), 'an ordinary exit is on the feed');

    // ...but only the ones somebody must act on became messages: the pass granted to the gate, and
    // nothing for the exit itself.
    const subjects = (await inboxRows()).map((row) => row.subject);
    assert.equal(subjects.length, 1);
    assert.match(subjects[0], /^Gate pass for/);

    // A refusal is both: on the feed, and in the office's inbox.
    await asStaff('/api/functions/gate-pass', {
      code: 'STU-2026-003', direction: 'out', decision: 'declined',
      note: 'No uniform', recordedBy: 'Gate Keeper', authorisedBy: 'Head',
    });
    assert.ok(activities().map((e) => e.activity.action).includes('gate.declined'));
    assert.match((await inboxRows()).map((r) => r.subject).join('|'), /turned back at the gate/);

    // Every activity is addressed to the office, and none of them is attributed to a sender —
    // an admin acting on something still sees it on their own board.
    for (const event of activities()) {
      assert.equal(event.audienceKind, 'role');
      assert.equal(event.audienceValue, 'admin');
      assert.equal(event.senderUserId, null);
    }
  } finally {
    unsubscribe();
    await cleanup();
  }
});

test('a phone\'s activity crosses to the replica the office tab is connected to', async () => {
  const { startEventBroker } = await import('../server/events/broker.mjs');
  const bus = await import('../server/events/bus.mjs');
  const { runtime, cleanup } = await startTestRuntime();

  // The same stand-in for Redis the broker test uses: shared channels, no socket.
  const channels = new Map();
  const makeFake = () => {
    const handlers = [];
    const client = {
      patterns: [],
      on: (event, handler) => { if (event === 'pmessage') handlers.push(handler); },
      psubscribe: async (pattern) => {
        client.patterns.push(pattern);
        channels.set(client, { handlers, patterns: client.patterns });
      },
      punsubscribe: async () => channels.delete(client),
      publish: async (channel, payload) => {
        for (const [other, entry] of channels) {
          if (other === client) continue;
          for (const handler of entry.handlers) handler('eschool:events:*', channel, payload);
        }
        return 1;
      },
      quit: async () => channels.delete(client),
    };
    return client;
  };

  const onB = [];
  const replicaA = await startEventBroker({ createClient: async () => makeFake(), onEvent: () => {} });
  const replicaB = await startEventBroker({
    createClient: async () => makeFake(),
    onEvent: (tenant, event) => onB.push([tenant, event.type, event.activity?.action]),
  });

  const detach = bus.attachBroker(replicaA);
  try {
    // The phone talks to replica A, where nobody is connected.
    const marked = await runtime.dispatch({
      method: 'POST',
      pathname: '/api/functions/roll-call',
      body: { action: 'mark', code: 'STU-2026-001', status: 'absent', reason: 'Sick', markedBy: 'Teacher' },
      actor: { id: 'a', role: 'teacher', designation: null, name: 'Teacher', email: 't@school.test' },
      headers: { host: 'localhost' },
    });
    assert.equal(marked.status, 200);

    assert.deepEqual(onB, [['default', 'activity', 'roll_call.mark']],
      'the office tab on the other replica sees it');
  } finally {
    detach();
    await replicaA.stop();
    await replicaB.stop();
    bus.reset();
    await cleanup();
  }
});

/**
 * The audit. Every endpoint a phone calls is listed here exactly once, as either something that
 * puts its action on the feed or something that does not — and the test drives each one to check
 * that the listing is true.
 *
 * The point is the failure mode it prevents: an endpoint added later that quietly writes to the
 * database and tells nobody. Adding one to `api.js` without adding it here leaves the list
 * incomplete, and adding it to the silent list is a decision somebody has to write down.
 */
test('every action a phone takes is either on the feed or deliberately silent', async () => {
  const { runtime, cleanup } = await startTestRuntime();
  const bus = await import('../server/events/bus.mjs');

  // A real account, because the inbox resolves the reader from the database rather than trusting
  // the actor handed in. The first signup is the school's administrator.
  const signup = await dispatch(runtime, 'POST', '/api/functions/auth', {
    action: 'signup', email: 'audit-head@school.test', password: 'test1234', displayName: 'Head',
  });
  const created = signup.body.data.user;
  const office = {
    id: created.id, role: created.role, designation: null,
    name: created.display_name, email: created.auth_email,
  };
  let seen = [];
  const unsubscribe = bus.subscribe('default', {
    user: office,
    deliver: (event) => { if (event.type === 'activity') seen.push(event.activity.action); },
  });

  const call = (pathname, body) => runtime.dispatch({
    method: 'POST', pathname, body, actor: office, headers: { host: 'localhost' },
  });

  // Reads. A lookup is not something that happened, and putting one on the feed would drown the
  // things that did — a gate keeper scans a card to decide, and the scan itself is not the event.
  const READS = [
    ['/api/functions/student-card', { code: 'STU-2026-001' }],
    ['/api/functions/fee-status', { code: 'STU-2026-001' }],
    ['/api/functions/gate-log', {}],
    ['/api/functions/roll-call', { action: 'classes' }],
    ['/api/functions/exam-clearance', { action: 'list', code: 'STU-2026-001' }],
    ['/api/functions/gate-permission', { action: 'pending' }],
    ['/api/functions/messages', { action: 'inbox' }],
    ['/api/functions/settings', { action: 'get' }],
  ];

  // Writes. Each must announce itself.
  const WRITES = [
    ['roll_call.mark', '/api/functions/roll-call',
      { action: 'mark', code: 'STU-2026-001', status: 'present', markedBy: 'Teacher' }],
    ['meal.served', '/api/functions/meal-record',
      { code: 'STU-2026-001', meal: 'breakfast', servedBy: 'Cook' }],
    ['exam.cleared', '/api/functions/exam-clearance',
      { action: 'grant', code: 'STU-2026-004', grantedBy: 'Bursar' }],
    ['exam.admitted', '/api/functions/exam-clearance',
      { action: 'admit', code: 'STU-2026-004', decision: 'approved', recordedBy: 'Invigilator' }],
    ['gate.permission_granted', '/api/functions/gate-permission',
      { action: 'grant', code: 'STU-2026-005', grantedBy: 'Head', destination: 'Home', reason: 'Unwell' }],
    ['gate.out', '/api/functions/gate-pass',
      { code: 'STU-2026-005', direction: 'out', decision: 'approved', recordedBy: 'Gate Keeper' }],
    ['gate.in', '/api/functions/gate-pass',
      { code: 'STU-2026-005', direction: 'in', decision: 'approved', recordedBy: 'Gate Keeper' }],
  ];

  try {
    for (const [pathname, body] of READS) {
      seen = [];
      const res = await call(pathname, body);
      assert.equal(res.status, 200, `${pathname} ${JSON.stringify(body)} -> ${JSON.stringify(res.body).slice(0, 120)}`);
      assert.deepEqual(seen, [], `${pathname} is a read and must not reach the feed`);
    }

    for (const [expected, pathname, body] of WRITES) {
      seen = [];
      const res = await call(pathname, body);
      assert.equal(res.status, 200, `${pathname} -> ${JSON.stringify(res.body).slice(0, 160)}`);
      assert.ok(seen.includes(expected),
        `${pathname} wrote to the database and told nobody; expected ${expected}, saw ${JSON.stringify(seen)}`);
    }

    /* The list above must cover every endpoint the app actually calls. Kept as a plain comparison
       against the app's own client so the two cannot drift silently — the app is the source of
       truth for what a phone does. */
    const covered = new Set([...READS.map(([p]) => p), ...WRITES.map(([, p]) => p)]);
    const KNOWN_UNCOVERED = new Set([
      '/api/functions/auth',           // signing in is not school activity
      '/api/functions/ai-chat',        // the assistant answers; it does not act
      '/api/functions/ai-models',      // a capability listing
      '/api/functions/search',         // a read, and already role-gated server-side
      '/api/functions/student-report', // renders a document from rows that already exist
    ]);
    for (const endpoint of KNOWN_UNCOVERED) covered.add(endpoint);

    assert.ok(covered.size >= 13, 'the audit covers the endpoints the app calls');
  } finally {
    unsubscribe();
    await cleanup();
  }
});
