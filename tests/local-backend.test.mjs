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
      message: 'tell me about Emma',
      conversationId: null,
      modelId: 'local-rules',
    });
    assert.equal(partialStudentSearch.status, 200);
    assert.match(partialStudentSearch.body.data.message, /Emma Johnson/);
    assert.equal(partialStudentSearch.body.data.studentsFound, 1);

    const studentIdSearch = await dispatch(runtime, 'POST', '/api/functions/ai-chat', {
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

test('grading schemes resolve by country and academic level', () => {
  const ugandaSecondary = resolveGradingScheme({
    country: 'uganda',
    academicLevel: 'secondary',
  });

  assert.equal(ugandaSecondary.label, 'Uganda Secondary UNEB Scale');
  assert.deepEqual(gradeScore(88, ugandaSecondary), {
    grade: 'D2',
    remark: 'Very Good',
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

    // A support-staff browser must not be able to pull a full fee statement.
    for (const role of ['support_staff', 'teacher']) {
      const denied = await runtime.dispatch({
        method: 'GET',
        pathname: `/api/fees/statements/${invoice.student_id}.pdf`,
        searchParams: new URLSearchParams({ requesterRole: role }),
      });
      assert.equal(denied.status, 403);
    }

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
  assert.equal(resolveTenantId('kampala-high.eschool.app'), 'kampala-high');
  assert.equal(resolveTenantId('Gulu-SS.eschool.app'), 'gulu-ss');
  assert.equal(resolveTenantId('kampala-high.eschool.app:8787'), 'kampala-high');

  // Apex, www, localhost and IPs fall back to the default tenant.
  assert.equal(resolveTenantId('eschool.app'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('www.eschool.app'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('localhost'), DEFAULT_TENANT);
  assert.equal(resolveTenantId('127.0.0.1:8787'), DEFAULT_TENANT);
  assert.equal(resolveTenantId(''), DEFAULT_TENANT);
  assert.equal(resolveTenantId(undefined), DEFAULT_TENANT);

  // An explicit X-Tenant header wins over the host.
  assert.equal(resolveTenantId('kampala-high.eschool.app', 'gulu-ss'), 'gulu-ss');

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
  assert.equal((await singleTenant.resolve('anything.eschool.app', undefined, sentinel)).database, sentinel);
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

    const a = await tenants.resolve('kampala-high.eschool.app', undefined, null);
    const b = await tenants.resolve('gulu-ss.eschool.app', undefined, null);
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
    const aAgain = await tenants.resolve('kampala-high.eschool.app', undefined, null);
    assert.equal(aAgain.database, a.database);

    // An unknown subdomain has no database, so the server would 404 it.
    const unknown = await tenants.resolve('ghost-school.eschool.app', undefined, null);
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
  const P = (body) => runtime.dispatch({ method: 'POST', pathname: '/api/provision', body });

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
    let route = await runtime.resolveDatabase('kampala-high.eschool.app', undefined);
    assert.equal(route.status, 'pending');
    assert.equal(route.database, null);

    // The paid callback provisions the school and activates it.
    const paid = await P({ action: 'callback', externalReference: reference, status: 'successful' });
    assert.equal(paid.body.data.provisioned, true);
    assert.equal((await P({ action: 'status', subdomain: 'kampala-high' })).body.data.tenant.status, 'active');

    // Its subdomain now routes to a real (isolated) database.
    route = await runtime.resolveDatabase('kampala-high.eschool.app', undefined);
    assert.equal(route.status, 'active');
    assert.ok(route.database);
    assert.equal((await route.database.query('SELECT COUNT(*)::int AS n FROM students')).rows[0].n, 15);

    // Replaying the callback is idempotent — no double provisioning.
    assert.equal((await P({ action: 'callback', externalReference: reference, status: 'successful' })).body.data.alreadyProcessed, true);

    // An unknown subdomain has no database (server 404s it).
    const ghost = await runtime.resolveDatabase('ghost.eschool.app', undefined);
    assert.equal(ghost.database, null);
    assert.equal(ghost.status, 'unknown');

    // Lapse the subscription and sweep: the school is suspended and its subdomain stops serving.
    await runtime.control.query("UPDATE tenants SET current_period_end = NOW() - INTERVAL '400 days', status = 'past_due' WHERE subdomain = 'kampala-high'");
    const swept = await P({ action: 'sweep', requesterRole: 'admin' });
    assert.equal(swept.body.data.suspended, 1);
    const suspended = await runtime.resolveDatabase('kampala-high.eschool.app', undefined);
    assert.equal(suspended.status, 'suspended');
    assert.equal(suspended.database, null);

    // list/sweep are admin-only.
    assert.equal((await P({ action: 'list', requesterRole: 'teacher' })).body.error, 'Unauthorized');
    assert.equal((await P({ action: 'sweep', requesterRole: 'teacher' })).body.error, 'Unauthorized');
    assert.equal((await P({ action: 'list', requesterRole: 'admin' })).body.data.tenants.length, 1);

    // Renewal reactivates the suspended school.
    const renew = await P({ action: 'signup', subdomain: 'kampala-high', provider: 'mtn_momo', phoneNumber: '+256700000000' });
    await P({ action: 'callback', externalReference: renew.body.data.reference, status: 'successful' });
    assert.equal((await P({ action: 'status', subdomain: 'kampala-high' })).body.data.tenant.status, 'active');
  } finally {
    await runtime.close();
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
  const message = email.renderActivationEmail({ schoolName: 'Kampala High', subdomain: 'kampala-high', rootDomain: 'eschool.app' });
  assert.match(message.subject, /Kampala High is ready/);
  assert.equal(message.url, 'https://kampala-high.eschool.app');
  assert.match(message.html, /kampala-high\.eschool\.app/);

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
