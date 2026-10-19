const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Parse .env manually if exists
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const parts = trimmed.split('=');
      const key = parts[0].trim();
      const val = parts.slice(1).join('=').trim();
      if (key && !process.env[key]) {
        process.env[key] = val;
      }
    }
  });
}

const PORT = process.env.PORT || 8080;

// Mock JIRA database for offline/demo testing
const MOCK_JIRA_TICKETS = {
  'JIRA-121': {
    key: 'JIRA-121',
    summary: 'Implement OAuth 2.0 User Authentication & Single Sign-On (SSO)',
    description: `Target System: Customer Portal Web App.
Requirements:
1. User can log in using Google OAuth 2.0 and SAML 2.0 SSO.
2. System must issue a JWT bearer token upon successful authentication with 60-minute expiration.
3. Failed login attempts exceeding 5 consecutive attempts within 15 minutes must lock the account for 30 minutes.
4. Password policy: Minimum 10 characters, at least 1 uppercase letter, 1 number, 1 special character (@#$%^&*).
5. Refresh token lifetime is 7 days.
6. Error response for invalid credentials must return HTTP 401 with body {"error": "INVALID_CREDENTIALS"}.

Acceptance Criteria:
- Successful OAuth login redirects to /dashboard with valid JWT cookie.
- Account lockout triggers after 5th failed attempt with email notification to user.
- Unauthenticated API requests return 401 Unauthorized.`,
    issueType: 'Story',
    priority: 'High',
    status: 'In Progress',
    assignee: 'Dev Team'
  },
  'QA-1042': {
    key: 'QA-1042',
    summary: 'User can reset password via email link',
    description: `Feature: Password reset flow triggered via email tokenized link.
Flow: User enters registered email on /forgot-password page.
System sends email containing single-use tokenized URL valid for 24 hours.
User clicks link, enters new password matching policy (min 8 chars, 1 uppercase, 1 number, 1 special char).

Constraints & Rules:
- Rate limit: Maximum 3 reset requests per hour per email address.
- Used token must immediately be invalidated upon password submit.
- Attempting to reuse an expired or used token must display "Token expired or invalid".`,
    issueType: 'Feature',
    priority: 'Critical',
    status: 'Ready for Test',
    assignee: 'QA Team'
  },
  'PROJ-789': {
    key: 'PROJ-789',
    summary: 'Shopping Cart Checkout & Stripe Payment Processing',
    description: `Allow registered users to checkout items in cart using Stripe API.
Rules:
- Order total must include item price + 8% state tax + $5 flat shipping.
- Cart items must be reserved for 15 minutes during checkout session.
- If payment fails, order status stays "Pending Payment" and stock reservation releases after timeout.
- Successful payment returns 200 OK with order confirmation ID and triggers confirmation email.`,
    issueType: 'Epic Requirement',
    priority: 'High',
    status: 'In Development',
    assignee: 'Backend Team'
  },
  'JIRA-EMPTY': {
    key: 'JIRA-EMPTY',
    summary: '',
    description: '',
    issueType: 'Story',
    priority: 'Low',
    status: 'Open',
    assignee: 'Unassigned'
  }
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // Enable CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 1: /api/jira/connect
  if (pathname === '/api/jira/connect' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    let { jiraUrl, jiraEmail, jiraApiToken } = body;

    jiraUrl = jiraUrl || process.env.JIRA_URL;
    jiraEmail = jiraEmail || process.env.JIRA_EMAIL;
    jiraApiToken = jiraApiToken || process.env.JIRA_API_TOKEN;

    if (!jiraUrl || !jiraEmail || !jiraApiToken) {
      return sendJson(res, 400, {
        success: false,
        message: 'Missing required JIRA details. Please enter JIRA Base URL, Email, and API Token.'
      });
    }

    let cleanUrl = jiraUrl.replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
      const response = await fetch(`${cleanUrl}/rest/api/3/myself`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const userData = await response.json();
        return sendJson(res, 200, {
          success: true,
          message: `Successfully connected to JIRA platform! Connected as: ${userData.displayName || userData.emailAddress || jiraEmail} (${cleanUrl})`,
          user: {
            name: userData.displayName,
            email: userData.emailAddress,
            timeZone: userData.timeZone
          }
        });
      } else {
        const errorText = await response.text();
        let detail = 'Authentication failed';
        if (response.status === 401) detail = 'Invalid Email or API Token';
        if (response.status === 404) detail = 'JIRA instance not found at specified URL';
        return sendJson(res, response.status, {
          success: false,
          message: `Connection failed (HTTP ${response.status}): ${detail}.`,
          rawError: errorText
        });
      }
    } catch (err) {
      return sendJson(res, 200, {
        success: true,
        isDemoMode: true,
        message: `Connected in Demo/Offline Mode for JIRA URL (${cleanUrl}). Mock tickets (JIRA-121, QA-1042, PROJ-789) are ready for testing!`
      });
    }
  }

  // API 2: /api/jira/issue
  if (pathname === '/api/jira/issue' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    let { issueKey, jiraUrl, jiraEmail, jiraApiToken } = body;

    if (!issueKey) {
      return sendJson(res, 200, { success: false, message: 'JIRA Issue Key is required. Type something like: please create test cases for JIRA-121' });
    }

    const cleanKey = issueKey.trim().toUpperCase();

    // 1. Check mock DB first (always works, no credentials needed)
    if (MOCK_JIRA_TICKETS[cleanKey]) {
      return sendJson(res, 200, {
        success: true,
        ticket: MOCK_JIRA_TICKETS[cleanKey],
        source: 'Mock JIRA Database'
      });
    }

    // 2. Try live JIRA if credentials are provided
    jiraUrl = (jiraUrl && jiraUrl.trim()) || process.env.JIRA_URL || '';
    jiraEmail = (jiraEmail && jiraEmail.trim()) || process.env.JIRA_EMAIL || '';
    jiraApiToken = (jiraApiToken && jiraApiToken.trim()) || process.env.JIRA_API_TOKEN || '';

    const hasCredentials = jiraUrl && jiraEmail && jiraApiToken &&
      jiraEmail !== 'user@example.com' && jiraApiToken.length > 4;

    if (!hasCredentials) {
      // No credentials — return a helpful error so the UI can show what to do
      return sendJson(res, 200, {
        success: false,
        notFound: true,
        message: `Ticket '${cleanKey}' was not found in the demo database.`,
        hint: `Demo tickets available: JIRA-121, QA-1042, PROJ-789. To fetch live JIRA tickets, open Settings (⚙️), enter your JIRA URL, email and API token, then click Connect.`
      });
    }

    let cleanUrl = jiraUrl.replace(/\/+$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    try {
      const authHeader = 'Basic ' + Buffer.from(`${jiraEmail}:${jiraApiToken}`).toString('base64');
      const response = await fetch(`${cleanUrl}/rest/api/3/issue/${cleanKey}`, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        const fields = data.fields || {};

        let descText = '';
        if (typeof fields.description === 'string') {
          descText = fields.description;
        } else if (fields.description && fields.description.content) {
          descText = extractAdfText(fields.description);
        }

        return sendJson(res, 200, {
          success: true,
          ticket: {
            key: data.key,
            summary: fields.summary || 'No summary provided',
            description: descText || 'No description provided in JIRA ticket.',
            issueType: fields.issuetype ? fields.issuetype.name : 'Story',
            priority: fields.priority ? fields.priority.name : 'Medium',
            status: fields.status ? fields.status.name : 'Open',
            assignee: fields.assignee ? fields.assignee.displayName : 'Unassigned'
          },
          source: 'Live JIRA Platform API'
        });
      } else {
        let detail = 'Could not fetch the ticket.';
        if (response.status === 401) detail = 'Invalid credentials. Check your JIRA Email and API Token in Settings.';
        if (response.status === 403) detail = 'Access denied. You may not have permission to view this issue.';
        if (response.status === 404) detail = `Issue '${cleanKey}' does not exist on your JIRA instance.`;
        return sendJson(res, 200, {
          success: false,
          message: `JIRA returned HTTP ${response.status}: ${detail}`
        });
      }
    } catch (err) {
      // Network error (wrong URL, DNS, etc.)
      return sendJson(res, 200, {
        success: false,
        message: `Could not reach JIRA at '${cleanUrl}'. Check the JIRA URL in Settings. (${err.message})`
      });
    }
  }

  // API 3: /api/generate-testcases
  if (pathname === '/api/generate-testcases' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const { ticket, includeAllCases, maxCases = 15 } = body;

    if (!ticket || !ticket.key) {
      return sendJson(res, 400, { success: false, message: 'Ticket details required.' });
    }

    try {
      const result = generateStrictRicpotTestCases(ticket, includeAllCases, maxCases);
      return sendJson(res, 200, { success: true, data: result });
    } catch (err) {
      return sendJson(res, 500, { success: false, message: `Generation error: ${err.message}` });
    }
  }

  // Static File Server (Serving files from ./public or root)
  let reqPath = pathname === '/' ? '/index.html' : pathname;
  let filePath = path.join(__dirname, 'public', reqPath);

  if (!fs.existsSync(filePath)) {
    filePath = path.join(__dirname, reqPath);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

function parseJsonBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function extractAdfText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.content && Array.isArray(node.content)) {
    return node.content.map(extractAdfText).join('\n');
  }
  return '';
}

// Deterministic RICPOT Engine with Hallucination Prevention
function generateStrictRicpotTestCases(ticket, includeAllCases = false, maxLimit = 15) {
  const key = ticket.key;
  const summary = (ticket.summary || '').trim();
  const desc = (ticket.description || '').trim();

  // Check if ticket is empty (no summary and no description provided, or default placeholders)
  const isPlaceholderSummary = !summary || summary.toLowerCase() === 'no summary provided';
  const isPlaceholderDesc = !desc || desc.toLowerCase() === 'no description provided in jira ticket.' || desc.toLowerCase() === 'no description provided';

  if (isPlaceholderSummary && isPlaceholderDesc) {
    return {
      isEmptyTicket: true,
      message: "JIRA ticket is empty and does not have anything mentioned. No test cases generated as no details were provided.",
      ticketSummary: {
        key: key,
        summary: summary || 'Empty Ticket',
        issueType: ticket.issueType || 'Story',
        priority: ticket.priority || 'Low',
        overview: `JIRA ticket ${key} is empty. No summary, description, or acceptance criteria details were provided in the ticket.`,
        keyRequirements: [],
        missingInfo: [
          'JIRA ticket content is completely empty.',
          'No summary, acceptance criteria, or requirement details are available.',
          'Strict anti-hallucination policy applied: Test cases were NOT generated by assumption.'
        ]
      },
      testCases: [],
      totalCount: 0,
      displayedCount: 0,
      hasMore: false,
      continuationMessage: null
    };
  }

  const requirements = [];
  const lines = desc.split('\n').map(l => l.trim()).filter(Boolean);

  lines.forEach(line => {
    if (line.match(/^(\d+\.|\-|\*|Requirements:|Rules:|Constraints:|Acceptance Criteria:)/i)) {
      requirements.push(line.replace(/^(\d+\.|\-|\*)\s*/, ''));
    }
  });

  const missingInfo = [];
  if (!desc || desc.length < 25) {
    missingInfo.push('Detailed acceptance criteria and technical specifications are sparse in the ticket description.');
  }
  if (!desc.toLowerCase().includes('environment') && !desc.toLowerCase().includes('staging')) {
    missingInfo.push('Target deployment environment (Staging/Production/Browser matrix) not specified in ticket text.');
  }
  if (!desc.toLowerCase().includes('data') && !desc.toLowerCase().includes('test')) {
    missingInfo.push('Specific test account credentials and sample datasets are not defined in ticket text.');
  }

  const allScenarios = [];
  let tcIndex = 1;

  // 1. Critical Happy Path Scenarios (Strictly from text)
  allScenarios.push({
    id: `TC-${key}-001`,
    title: `Verify primary requirement: ${summary}`,
    type: 'Critical / Functional',
    preconditions: `Target system accessible. Ticket ${key} requirements configured.`,
    steps: `1. Execute primary action specified in ${key}: "${summary}".\n2. Verify system accepts input according to ticket description.`,
    expectedResult: `System successfully completes workflow as defined in ticket ${key}.`,
    priority: 'Critical',
    confidence: 'Verified (Direct requirement)'
  });

  // Extract explicit rules from text
  lines.forEach(line => {
    if (line.toLowerCase().includes('must') || line.toLowerCase().includes('should') || line.toLowerCase().includes('policy') || line.toLowerCase().includes('error')) {
      tcIndex++;
      const idStr = String(tcIndex).padStart(3, '0');
      let type = 'Major / Functional';
      let priority = 'High';

      if (line.toLowerCase().includes('error') || line.toLowerCase().includes('failed') || line.toLowerCase().includes('lock') || line.toLowerCase().includes('limit')) {
        type = 'Negative / Boundary';
      }

      allScenarios.push({
        id: `TC-${key}-${idStr}`,
        title: `Validate rule: ${line.substring(0, 75)}${line.length > 75 ? '...' : ''}`,
        type: type,
        preconditions: `System in state ready for rule evaluation [${key}]`,
        steps: `1. Trigger condition related to: "${line}".\n2. Observe system response and validation logic.`,
        expectedResult: `System enforces requirement: "${line}" accurately.`,
        priority: priority,
        confidence: 'Verified (Direct requirement)'
      });
    }
  });

  // Inferred edge cases (labeled explicitly as per prompt instructions)
  const inferredCases = [
    {
      title: `Empty or null payload handling for ${key} workflow`,
      type: 'Negative / Boundary',
      preconditions: 'API / Form endpoint initialized.',
      steps: '1. Submit request with empty or null fields.\n2. Observe response status.',
      expectedResult: 'System gracefully rejects invalid payload with structured error message.',
      priority: 'Major',
      confidence: '[Inference (low confidence)] — Inferred boundary validation'
    },
    {
      title: `Concurrent execution & duplicate request handling`,
      type: 'Concurrency / Edge',
      preconditions: 'Multiple simultaneous user sessions active.',
      steps: '1. Trigger simultaneous duplicate requests for key action.\n2. Check backend state for race conditions.',
      expectedResult: 'System handles concurrency safely without duplicate state creation.',
      priority: 'Medium',
      confidence: '[Inference (low confidence)] — Inferred concurrency scenario'
    },
    {
      title: `Session timeout & expired token response`,
      type: 'Security / Session',
      preconditions: 'User session or token active.',
      steps: '1. Wait for session expiration or invalidate auth token.\n2. Attempt protected action.',
      expectedResult: 'System denies access and returns 401 Unauthorized or redirects to login.',
      priority: 'Major',
      confidence: '[Inference (low confidence)] — Inferred session security'
    }
  ];

  inferredCases.forEach(inf => {
    tcIndex++;
    const idStr = String(tcIndex).padStart(3, '0');
    allScenarios.push({
      id: `TC-${key}-${idStr}`,
      title: inf.title,
      type: inf.type,
      preconditions: inf.preconditions,
      steps: inf.steps,
      expectedResult: inf.expectedResult,
      priority: inf.priority,
      confidence: inf.confidence
    });
  });

  const totalAvailable = allScenarios.length;
  let displayedScenarios = allScenarios;
  let hasMore = false;

  if (!includeAllCases && totalAvailable > maxLimit) {
    displayedScenarios = allScenarios.slice(0, maxLimit);
    hasMore = true;
  }

  const ticketSummary = {
    key: key,
    summary: summary,
    issueType: ticket.issueType || 'Story',
    priority: ticket.priority || 'High',
    overview: `This ticket (${key}) covers: "${summary}". It specifies requirements for ${ticket.issueType || 'feature'} implementation with priority ${ticket.priority || 'Medium'}.`,
    keyRequirements: requirements.length > 0 ? requirements : [summary],
    missingInfo: missingInfo
  };

  return {
    ticketSummary,
    testCases: displayedScenarios,
    totalCount: totalAvailable,
    displayedCount: displayedScenarios.length,
    hasMore: hasMore,
    continuationMessage: hasMore
      ? "⚠️ Note: Additional test cases are required for full coverage. Would you like to generate the remaining test cases?"
      : null
  };
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`============================================================`);
  console.log(`🚀 RICPOT JIRA Test Case Generator Web App`);
  console.log(`Listening on http://127.0.0.1:${PORT}`);
  console.log(`Open http://127.0.0.1:${PORT} in your browser`);
  console.log(`============================================================`);
});
