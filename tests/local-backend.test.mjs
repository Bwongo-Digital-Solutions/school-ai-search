import test from 'node:test';
import assert from 'node:assert/strict';

import { createAppRuntime } from '../server/local-backend.mjs';

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
      searchParams: new URLSearchParams({ term: 'Term 2', academicYear: '2026/2027' }),
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.type, 'binary');
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    assert.ok(pdf.body.length > 500);

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
