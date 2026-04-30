import { randomUUID } from 'node:crypto';

const DEFAULT_CURRENCY = process.env.PAYMENT_CURRENCY || 'UGX';
const PAYMENT_MODE = process.env.PAYMENT_GATEWAY_MODE || 'mock';
const SUCCESS_STATUSES = new Set(['successful', 'success', 'completed', 'paid']);
const FAILED_STATUSES = new Set(['failed', 'rejected', 'cancelled', 'expired', 'timeout']);

const jsonHeaders = (extra = {}) => ({
  'Content-Type': 'application/json',
  ...extra,
});

const encodeBasicAuth = (username, password) => Buffer.from(`${username}:${password}`).toString('base64');

const normalizePhone = (phoneNumber = '') => phoneNumber.replace(/[^\d+]/g, '');

const normalizeStatus = (status = '') => {
  const normalized = String(status).trim().toLowerCase();
  if (SUCCESS_STATUSES.has(normalized)) return 'successful';
  if (FAILED_STATUSES.has(normalized)) return 'failed';
  if (normalized === 'pending' || normalized === 'processing') return 'pending';
  return normalized || 'pending';
};

const readJson = async (response) => {
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const requestJson = async (httpClient, url, options) => {
  const response = await httpClient(url, options);
  const body = await readJson(response);

  if (!response.ok) {
    const message = body?.message || body?.error || `Payment provider request failed with ${response.status}`;
    throw new Error(message);
  }

  return body;
};

const createPaymentReference = () => `PAY-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${randomUUID()}`;

const assertPaymentPayload = ({ studentId, provider, amount, phoneNumber, bankCode }) => {
  if (!studentId) throw new Error('studentId is required');
  if (!['mtn_momo', 'airtel_money', 'bank'].includes(provider)) throw new Error(`Unsupported payment provider: ${provider}`);
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('amount must be greater than zero');
  if ((provider === 'mtn_momo' || provider === 'airtel_money') && !phoneNumber) {
    throw new Error('phoneNumber is required for mobile money payments');
  }
  if (provider === 'bank' && !bankCode) throw new Error('bankCode is required for bank payments');
};

const mockInitiatePayment = async ({ transaction }) => ({
  status: 'pending',
  providerReference: `mock-${transaction.external_reference}`,
  customerMessage:
    transaction.provider === 'bank'
      ? 'Use the returned account reference at your bank or bank app to complete the payment.'
      : 'A mobile money approval prompt would be sent to the payer phone in live mode.',
  metadata: {
    mode: 'mock',
    approvalRequired: transaction.provider !== 'bank',
  },
});

const initiateMtnMomoPayment = async ({ transaction, description, callbackUrl, httpClient }) => {
  const baseUrl = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
  const apiUser = process.env.MTN_MOMO_API_USER;
  const apiKey = process.env.MTN_MOMO_API_KEY;
  const targetEnvironment = process.env.MTN_MOMO_TARGET_ENVIRONMENT || 'sandbox';

  if (!subscriptionKey || !apiUser || !apiKey) {
    throw new Error('MTN MoMo credentials are missing');
  }

  const token = await requestJson(httpClient, `${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodeBasicAuth(apiUser, apiKey)}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
  });

  const providerReference = randomUUID();
  const headers = {
    Authorization: `Bearer ${token.access_token}`,
    'Ocp-Apim-Subscription-Key': subscriptionKey,
    'X-Reference-Id': providerReference,
    'X-Target-Environment': targetEnvironment,
    ...jsonHeaders(callbackUrl ? { 'X-Callback-Url': callbackUrl } : {}),
  };

  await requestJson(httpClient, `${baseUrl}/collection/v1_0/requesttopay`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      amount: String(transaction.amount),
      currency: transaction.currency,
      externalId: transaction.external_reference,
      payer: {
        partyIdType: 'MSISDN',
        partyId: normalizePhone(transaction.phone_number),
      },
      payerMessage: description,
      payeeNote: description,
    }),
  });

  return {
    status: 'pending',
    providerReference,
    customerMessage: 'MTN MoMo payment request sent. Approve the prompt on the payer phone.',
    metadata: { targetEnvironment },
  };
};

const initiateAirtelMoneyPayment = async ({ transaction, description, callbackUrl, httpClient }) => {
  const baseUrl = process.env.AIRTEL_MONEY_BASE_URL;
  const clientId = process.env.AIRTEL_MONEY_CLIENT_ID;
  const clientSecret = process.env.AIRTEL_MONEY_CLIENT_SECRET;
  const country = process.env.AIRTEL_MONEY_COUNTRY || 'UG';
  const currency = transaction.currency || DEFAULT_CURRENCY;

  if (!baseUrl || !clientId || !clientSecret) {
    throw new Error('Airtel Money credentials are missing');
  }

  const tokenPath = process.env.AIRTEL_MONEY_TOKEN_PATH || '/auth/oauth2/token';
  const collectPath = process.env.AIRTEL_MONEY_COLLECTION_PATH || '/merchant/v1/payments/';

  const token = await requestJson(httpClient, `${baseUrl}${tokenPath}`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  const providerReference = randomUUID();
  const response = await requestJson(httpClient, `${baseUrl}${collectPath}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      'X-Country': country,
      'X-Currency': currency,
      ...jsonHeaders(),
    },
    body: JSON.stringify({
      reference: transaction.external_reference,
      subscriber: {
        country,
        currency,
        msisdn: normalizePhone(transaction.phone_number),
      },
      transaction: {
        amount: Number(transaction.amount),
        country,
        currency,
        id: providerReference,
      },
      description,
      callback_url: callbackUrl,
    }),
  });

  return {
    status: normalizeStatus(response?.status?.message || response?.status || 'pending'),
    providerReference: response?.data?.transaction?.id || response?.transaction?.id || providerReference,
    customerMessage: 'Airtel Money payment request sent. Approve the prompt on the payer phone.',
    metadata: { country, providerResponse: response },
  };
};

const initiateBankPayment = async ({ transaction, description, callbackUrl, httpClient }) => {
  const endpoint = process.env.BANK_PAYMENT_GATEWAY_URL;
  const apiKey = process.env.BANK_PAYMENT_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error('Bank payment gateway credentials are missing');
  }

  const response = await requestJson(httpClient, endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...jsonHeaders(),
    },
    body: JSON.stringify({
      reference: transaction.external_reference,
      account_reference: transaction.account_reference,
      bank_code: transaction.bank_code,
      amount: Number(transaction.amount),
      currency: transaction.currency,
      description,
      callback_url: callbackUrl,
      metadata: transaction.metadata,
    }),
  });

  return {
    status: normalizeStatus(response.status || 'pending'),
    providerReference: response.provider_reference || response.transaction_id || transaction.external_reference,
    customerMessage:
      response.customer_message || 'Bank payment request created. Complete payment using the returned bank reference.',
    metadata: { providerResponse: response },
  };
};

const initiateProviderPayment = async (params) => {
  if (PAYMENT_MODE === 'mock') return mockInitiatePayment(params);
  if (params.transaction.provider === 'mtn_momo') return initiateMtnMomoPayment(params);
  if (params.transaction.provider === 'airtel_money') return initiateAirtelMoneyPayment(params);
  return initiateBankPayment(params);
};

const fetchInvoice = async (database, invoiceId) => {
  if (!invoiceId) return null;
  const { rows } = await database.query('SELECT * FROM invoices WHERE id = $1 LIMIT 1', [invoiceId]);
  return rows[0] || null;
};

const fetchTransaction = async (database, paymentReference) => {
  const { rows } = await database.query(
    `
      SELECT *
      FROM payment_transactions
      WHERE id = $1 OR external_reference = $1 OR provider_reference = $1
      LIMIT 1
    `,
    [paymentReference],
  );
  return rows[0] || null;
};

const recordSuccessfulPayment = async (database, transaction) => {
  const existing = await database.query('SELECT id FROM payments WHERE reference = $1 LIMIT 1', [
    transaction.external_reference,
  ]);
  if (existing.rows[0]) return existing.rows[0].id;

  const paymentId = randomUUID();
  await database.query(
    `
      INSERT INTO payments (
        id, student_id, fee_structure_id, amount, currency, payment_method, reference, received_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      paymentId,
      transaction.student_id,
      null,
      transaction.amount,
      transaction.currency,
      transaction.provider,
      transaction.external_reference,
      'payment_gateway',
    ],
  );

  if (transaction.invoice_id) {
    await database.query(
      `
        UPDATE invoices
        SET
          balance_due = GREATEST(balance_due - $1, 0),
          status = CASE WHEN GREATEST(balance_due - $1, 0) = 0 THEN 'paid' ELSE 'partial' END
        WHERE id = $2
      `,
      [transaction.amount, transaction.invoice_id],
    );
  }

  return paymentId;
};

const updateTransactionStatus = async (database, transaction, status, patch = {}) => {
  const metadata = {
    ...(transaction.metadata || {}),
    ...(patch.metadata || {}),
  };

  const { rows } = await database.query(
    `
      UPDATE payment_transactions
      SET
        status = $1,
        status_reason = $2,
        customer_message = COALESCE($3, customer_message),
        provider_reference = COALESCE($4, provider_reference),
        metadata = $5,
        updated_at = NOW()
      WHERE id = $6
      RETURNING *
    `,
    [
      status,
      patch.statusReason || transaction.status_reason || null,
      patch.customerMessage || null,
      patch.providerReference || null,
      JSON.stringify(metadata),
      transaction.id,
    ],
  );

  const updated = rows[0];
  if (updated && updated.status === 'successful') {
    await recordSuccessfulPayment(database, updated);
  }

  return updated;
};

export const initiatePayment = async ({ database, body, httpClient = fetch }) => {
  const provider = String(body.provider || '').trim();
  const studentId = String(body.studentId || '').trim();
  const invoiceId = body.invoiceId ? String(body.invoiceId).trim() : null;
  const phoneNumber = body.phoneNumber ? normalizePhone(body.phoneNumber) : null;
  const bankCode = body.bankCode ? String(body.bankCode).trim() : null;
  const amount = Number(body.amount);
  const currency = String(body.currency || DEFAULT_CURRENCY).trim().toUpperCase();
  const chargeType = String(body.chargeType || 'school_fees').trim();
  const description = String(body.description || 'School payment').trim();
  const callbackUrl = body.callbackUrl ? String(body.callbackUrl).trim() : process.env.PAYMENT_CALLBACK_URL || null;

  assertPaymentPayload({ studentId, provider, amount, phoneNumber, bankCode });

  const student = await database.query('SELECT id, student_id, first_name, last_name FROM students WHERE id = $1 LIMIT 1', [
    studentId,
  ]);
  if (!student.rows[0]) throw new Error('Student not found');

  const invoice = await fetchInvoice(database, invoiceId);
  if (invoiceId && !invoice) throw new Error('Invoice not found');
  if (invoice && invoice.student_id !== studentId) throw new Error('Invoice does not belong to this student');

  const externalReference = createPaymentReference();
  const transaction = {
    id: randomUUID(),
    student_id: studentId,
    invoice_id: invoiceId,
    provider,
    charge_type: chargeType,
    amount,
    currency,
    phone_number: phoneNumber,
    bank_code: bankCode,
    account_reference: body.accountReference || student.rows[0].student_id,
    external_reference: externalReference,
    provider_reference: null,
    status: 'pending',
    status_reason: null,
    customer_message: null,
    metadata: {
      description,
      studentName: `${student.rows[0].first_name} ${student.rows[0].last_name}`,
      invoiceNumber: invoice?.invoice_number || null,
    },
  };

  await database.query(
    `
      INSERT INTO payment_transactions (
        id, student_id, invoice_id, provider, charge_type, amount, currency, phone_number, bank_code,
        account_reference, external_reference, status, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `,
    [
      transaction.id,
      transaction.student_id,
      transaction.invoice_id,
      transaction.provider,
      transaction.charge_type,
      transaction.amount,
      transaction.currency,
      transaction.phone_number,
      transaction.bank_code,
      transaction.account_reference,
      transaction.external_reference,
      transaction.status,
      JSON.stringify(transaction.metadata),
    ],
  );

  const providerResult = await initiateProviderPayment({
    transaction,
    description,
    callbackUrl,
    httpClient,
  });

  const updated = await updateTransactionStatus(database, transaction, providerResult.status, {
    providerReference: providerResult.providerReference,
    customerMessage: providerResult.customerMessage,
    metadata: providerResult.metadata,
  });

  return {
    transaction: updated,
    instructions: providerResult.customerMessage,
  };
};

export const getPaymentStatus = async ({ database, paymentReference, httpClient = fetch }) => {
  const transaction = await fetchTransaction(database, paymentReference);
  if (!transaction) throw new Error('Payment transaction not found');

  if (PAYMENT_MODE === 'mock' || transaction.status !== 'pending') {
    return { transaction };
  }

  if (transaction.provider !== 'mtn_momo' || !transaction.provider_reference) {
    return { transaction };
  }

  const baseUrl = process.env.MTN_MOMO_BASE_URL || 'https://sandbox.momodeveloper.mtn.com';
  const subscriptionKey = process.env.MTN_MOMO_SUBSCRIPTION_KEY;
  const apiUser = process.env.MTN_MOMO_API_USER;
  const apiKey = process.env.MTN_MOMO_API_KEY;
  const targetEnvironment = process.env.MTN_MOMO_TARGET_ENVIRONMENT || 'sandbox';

  const token = await requestJson(httpClient, `${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${encodeBasicAuth(apiUser, apiKey)}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
  });

  const providerStatus = await requestJson(
    httpClient,
    `${baseUrl}/collection/v1_0/requesttopay/${transaction.provider_reference}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'X-Target-Environment': targetEnvironment,
      },
    },
  );

  const updated = await updateTransactionStatus(database, transaction, normalizeStatus(providerStatus.status), {
    statusReason: providerStatus.reason || null,
    metadata: { statusResponse: providerStatus },
  });

  return { transaction: updated };
};

export const recordPaymentCallback = async ({ database, body }) => {
  const reference = body.externalReference || body.external_reference || body.reference || body.transactionId;
  if (!reference) throw new Error('Payment reference is required');

  const transaction = await fetchTransaction(database, reference);
  if (!transaction) throw new Error('Payment transaction not found');

  const status = normalizeStatus(body.status || body.transactionStatus || body.state);
  const updated = await updateTransactionStatus(database, transaction, status, {
    providerReference: body.providerReference || body.provider_reference || body.transactionId || null,
    statusReason: body.reason || body.message || null,
    metadata: { callback: body },
  });

  return { transaction: updated };
};
