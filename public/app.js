/* ============================================================
   RICPOT JIRA Test Case Generator — Frontend Application Logic
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const connectConnBtn = document.getElementById('connectConnBtn');
  const cancelConnBtn = document.getElementById('cancelConnBtn');
  const connMessage = document.getElementById('connMessage');

  const jiraUrlInput = document.getElementById('jiraUrlInput');
  const jiraEmailInput = document.getElementById('jiraEmailInput');
  const jiraTokenInput = document.getElementById('jiraTokenInput');
  const statusText = document.getElementById('statusText');
  const connectionBadge = document.getElementById('connectionBadge');

  const queryForm = document.getElementById('queryForm');
  const queryInput = document.getElementById('queryInput');
  const submitBtn = document.getElementById('submitBtn');

  const loadingSpinner = document.getElementById('loadingSpinner');
  const loadingText = document.getElementById('loadingText');
  const outputSection = document.getElementById('outputSection');
  const errorPanel = document.getElementById('errorPanel');
  const errorPanelMsg = document.getElementById('errorPanelMsg');
  const errorPanelHint = document.getElementById('errorPanelHint');

  // Summary elements
  const ticketKey = document.getElementById('ticketKey');
  const ticketType = document.getElementById('ticketType');
  const ticketPriority = document.getElementById('ticketPriority');
  const ticketStatus = document.getElementById('ticketStatus');
  const ticketSummaryTitle = document.getElementById('ticketSummaryTitle');
  const ticketOverviewText = document.getElementById('ticketOverviewText');
  const ticketReqList = document.getElementById('ticketReqList');
  const missingInfoBox = document.getElementById('missingInfoBox');
  const missingInfoList = document.getElementById('missingInfoList');

  // Table elements
  const testCaseTableBody = document.getElementById('testCaseTableBody');
  const caseCountBadge = document.getElementById('caseCountBadge');
  const continuationBox = document.getElementById('continuationBox');
  const continuationText = document.getElementById('continuationText');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const copyMarkdownBtn = document.getElementById('copyMarkdownBtn');
  const downloadCsvBtn = document.getElementById('downloadCsvBtn');

  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');

  // State
  let activeAbortController = null;
  let currentTicketData = null;
  let currentTestCasesResult = null;

  // Load saved credentials from localStorage
  loadSavedSettings();

  // Quick ticket chips
  document.querySelectorAll('.chip-ticket').forEach(chip => {
    chip.addEventListener('click', () => {
      const key = chip.dataset.key;
      queryInput.value = `please create test cases for ${key}`;
      handleQuerySubmit();
    });
  });

  // Modal Open/Close
  settingsBtn.addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    connMessage.classList.add('hidden');
  });

  document.getElementById('openSettingsFromError').addEventListener('click', () => {
    settingsModal.classList.remove('hidden');
    connMessage.classList.add('hidden');
  });

  closeModalBtn.addEventListener('click', closeModal);
  cancelConnBtn.addEventListener('click', () => {
    if (activeAbortController) {
      activeAbortController.abort();
      activeAbortController = null;
      showConnMessage('Connection test operation cancelled by user.', 'error');
    }
    closeModal();
  });

  function closeModal() {
    settingsModal.classList.add('hidden');
  }

  // Save & Load settings
  function loadSavedSettings() {
    const savedUrl = localStorage.getItem('jira_url') || 'https://your-domain.atlassian.net';
    const savedEmail = localStorage.getItem('jira_email') || '';
    const savedToken = localStorage.getItem('jira_token') || '';

    jiraUrlInput.value = savedUrl;
    jiraEmailInput.value = savedEmail;
    jiraTokenInput.value = savedToken;

    if (savedEmail && savedToken) {
      updateStatusBadge('Connected', 'green');
    } else {
      updateStatusBadge('Demo / Local Mode', 'yellow');
    }
  }

  function saveSettings() {
    localStorage.setItem('jira_url', jiraUrlInput.value.trim());
    localStorage.setItem('jira_email', jiraEmailInput.value.trim());
    localStorage.setItem('jira_token', jiraTokenInput.value.trim());
  }

  function updateStatusBadge(text, color) {
    statusText.textContent = `JIRA: ${text}`;
    const dot = connectionBadge.querySelector('.status-dot');
    dot.className = `status-dot dot-${color}`;
  }

  // Connect Button Handler
  connectConnBtn.addEventListener('click', async () => {
    const jiraUrl = jiraUrlInput.value.trim();
    const jiraEmail = jiraEmailInput.value.trim();
    const jiraToken = jiraTokenInput.value.trim();

    if (!jiraUrl || !jiraEmail || !jiraToken) {
      showConnMessage('Please fill in JIRA Base URL, Email, and API Token.', 'error');
      return;
    }

    saveSettings();
    showConnMessage('Connecting to JIRA platform... Please wait.', 'loading');

    // Create abort controller for cancel action
    activeAbortController = new AbortController();

    try {
      const response = await fetch('/api/jira/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jiraUrl, jiraEmail, jiraApiToken: jiraToken }),
        signal: activeAbortController.signal
      });

      const data = await response.json();
      activeAbortController = null;

      if (data.success) {
        if (data.isDemoMode) {
          showConnMessage(`⚠️ ${data.message}`, 'loading');
          updateStatusBadge('Demo Mode', 'yellow');
        } else {
          showConnMessage(`✅ ${data.message}`, 'success');
          updateStatusBadge('Connected', 'green');
        }
        showToast('JIRA connection test completed!');
      } else {
        showConnMessage(`❌ ${data.message}`, 'error');
        updateStatusBadge('Connection Failed', 'gray');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return; // Handled in cancel
      }
      activeAbortController = null;
      showConnMessage(`❌ Connection Error: ${err.message}`, 'error');
      updateStatusBadge('Error', 'gray');
    }
  });

  function showConnMessage(msg, type) {
    connMessage.textContent = msg;
    connMessage.className = `conn-message ${type}`;
    connMessage.classList.remove('hidden');
  }

  // Query Form Submit
  queryForm.addEventListener('submit', (e) => {
    e.preventDefault();
    handleQuerySubmit();
  });

  async function handleQuerySubmit(includeAll = false) {
    const userQuery = queryInput.value.trim();
    if (!userQuery) return;

    // Extract JIRA issue key (e.g. JIRA-121, QA-1042, PROJ-789)
    const match = userQuery.match(/([A-Za-z][A-Za-z0-9]*-\d+)/i);
    let key = match ? match[1].toUpperCase() : null;

    if (!key) {
      showError(
        'No JIRA ticket ID found in your message.',
        'Include a ticket key in your message, e.g.: "please create test cases for JIRA-121"'
      );
      return;
    }

    // UI Loading state
    hideError();
    loadingSpinner.classList.remove('hidden');
    outputSection.classList.add('hidden');
    loadingText.textContent = `Fetching JIRA ticket ${key} & applying RICPOT anti-hallucination rules...`;

    try {
      // Step 1: Fetch Ticket
      const ticketRes = await fetch('/api/jira/issue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          issueKey: key,
          jiraUrl: jiraUrlInput.value.trim(),
          jiraEmail: jiraEmailInput.value.trim(),
          jiraApiToken: jiraTokenInput.value.trim()
        })
      });

      const ticketData = await ticketRes.json();

      if (!ticketData.success) {
        loadingSpinner.classList.add('hidden');
        showError(
          ticketData.message || `Could not fetch ticket ${key}.`,
          ticketData.hint || 'Check the ticket ID and ensure your JIRA credentials are configured in Settings.'
        );
        return;
      }

      currentTicketData = ticketData.ticket;

      // Step 2: Generate RICPOT Test Cases
      const genRes = await fetch('/api/generate-testcases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticket: currentTicketData,
          includeAllCases: includeAll,
          maxCases: 15
        })
      });

      const genData = await genRes.json();
      if (!genData.success) {
        loadingSpinner.classList.add('hidden');
        showError(genData.message || 'Test case generation failed.', 'Please try again or choose a different ticket.');
        return;
      }

      currentTestCasesResult = genData.data;

      // Render results
      renderResults(currentTicketData, currentTestCasesResult);
      loadingSpinner.classList.add('hidden');
      outputSection.classList.remove('hidden');
      outputSection.scrollIntoView({ behavior: 'smooth' });

    } catch (err) {
      loadingSpinner.classList.add('hidden');
      showError(
        `Network error: ${err.message}`,
        'Make sure the local server is running (node server.js) and try again.'
      );
    }
  }

  // Load More Button
  loadMoreBtn.addEventListener('click', () => {
    handleQuerySubmit(true);
  });

  // Render Function
  function renderResults(ticket, result) {
    // 1. Ticket Summary Header
    ticketKey.textContent = ticket.key;
    ticketType.textContent = ticket.issueType || 'Story';
    ticketPriority.textContent = ticket.priority || 'High';
    ticketStatus.textContent = ticket.status || 'Open';
    ticketSummaryTitle.textContent = ticket.summary;

    const summary = result.ticketSummary;
    ticketOverviewText.textContent = summary.overview;

    // Key requirements
    ticketReqList.innerHTML = '';
    summary.keyRequirements.forEach(req => {
      const li = document.createElement('li');
      li.textContent = req;
      ticketReqList.appendChild(li);
    });

    // Missing Info Box
    if (summary.missingInfo && summary.missingInfo.length > 0) {
      missingInfoList.innerHTML = '';
      summary.missingInfo.forEach(info => {
        const li = document.createElement('li');
        li.textContent = info;
        missingInfoList.appendChild(li);
      });
      missingInfoBox.classList.remove('hidden');
    } else {
      missingInfoBox.classList.add('hidden');
    }

    // 2. Test Cases Table
    caseCountBadge.textContent = `${result.displayedCount} / ${result.totalCount} Cases`;
    testCaseTableBody.innerHTML = '';

    if (result.isEmptyTicket || result.testCases.length === 0) {
      const emptyTr = document.createElement('tr');
      emptyTr.innerHTML = `
        <td colspan="8" style="text-align: center; padding: 2.5rem; background: rgba(239, 68, 68, 0.05); border: 1px dashed rgba(239, 68, 68, 0.3); border-radius: 8px;">
          <div style="font-size: 1.1rem; font-weight: 600; color: #ef4444; margin-bottom: 0.5rem;">
            ⚠️ JIRA Ticket is Empty
          </div>
          <div style="color: var(--text-muted); font-size: 0.9rem;">
            This JIRA ticket does not have any summary or description details provided.<br>
            <strong>Anti-Hallucination Policy:</strong> Test cases are not generated based on assumptions when no details are present.
          </div>
        </td>
      `;
      testCaseTableBody.appendChild(emptyTr);
    } else {
      result.testCases.forEach(tc => {
        const tr = document.createElement('tr');

        const isPrioCritical = tc.priority === 'Critical';
        const isPrioHigh = tc.priority === 'High';

        const prioClass = isPrioCritical ? 'badge-prio-critical' : isPrioHigh ? 'badge-prio-high' : 'badge-prio-medium';

        const isInferred = tc.confidence.includes('[Inference');
        const confBadge = isInferred
          ? `<span class="badge-conf-inferred">🏷️ [Inference (low confidence)]</span>`
          : `<span class="badge-conf-verified">✅ Verified Requirement</span>`;

        tr.innerHTML = `
          <td class="tc-id">${tc.id}</td>
          <td class="tc-title">${escapeHtml(tc.title)}</td>
          <td><span class="badge-jira-type">${escapeHtml(tc.type)}</span></td>
          <td style="color: var(--text-muted); font-size: 0.8rem;">${escapeHtml(tc.preconditions)}</td>
          <td class="tc-steps">${escapeHtml(tc.steps)}</td>
          <td>${escapeHtml(tc.expectedResult)}</td>
          <td><span class="${prioClass}">${tc.priority}</span></td>
          <td>${confBadge}</td>
        `;

        testCaseTableBody.appendChild(tr);
      });
    }

    // 3. Continuation Box
    if (result.hasMore) {
      continuationText.textContent = result.continuationMessage;
      continuationBox.classList.remove('hidden');
    } else {
      continuationBox.classList.add('hidden');
    }
  }

  // Copy Markdown
  copyMarkdownBtn.addEventListener('click', () => {
    if (!currentTestCasesResult) return;

    let md = `# RICPOT Test Cases for JIRA Ticket ${currentTicketData.key}\n\n`;
    md += `## 📋 Ticket Summary\n- **Summary:** ${currentTicketData.summary}\n- **Priority:** ${currentTicketData.priority}\n\n`;
    md += `## 🧪 Test Cases Matrix\n\n`;
    md += `| TC ID | Title | Scenario Type | Preconditions | Test Steps | Expected Result | Priority | Confidence |\n`;
    md += `|---|---|---|---|---|---|---|---|\n`;

    currentTestCasesResult.testCases.forEach(tc => {
      const stepsFormatted = tc.steps.replace(/\n/g, '<br>');
      md += `| ${tc.id} | ${tc.title} | ${tc.type} | ${tc.preconditions} | ${stepsFormatted} | ${tc.expectedResult} | ${tc.priority} | ${tc.confidence} |\n`;
    });

    if (currentTestCasesResult.hasMore) {
      md += `\n> ${currentTestCasesResult.continuationMessage}\n`;
    }

    navigator.clipboard.writeText(md).then(() => {
      showToast('Markdown copied to clipboard!');
    });
  });

  // Export CSV
  downloadCsvBtn.addEventListener('click', () => {
    if (!currentTestCasesResult) return;

    let csv = 'TC ID,Title,Type,Preconditions,Test Steps,Expected Result,Priority,Confidence\n';
    currentTestCasesResult.testCases.forEach(tc => {
      const row = [
        tc.id,
        `"${tc.title.replace(/"/g, '""')}"`,
        `"${tc.type.replace(/"/g, '""')}"`,
        `"${tc.preconditions.replace(/"/g, '""')}"`,
        `"${tc.steps.replace(/"/g, '""')}"`,
        `"${tc.expectedResult.replace(/"/g, '""')}"`,
        `"${tc.priority.replace(/"/g, '""')}"`,
        `"${tc.confidence.replace(/"/g, '""')}"`
      ];
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${currentTicketData.key}_RICPOT_TestCases.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showToast('Exported CSV file!');
  });

  // Toast
  function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }

  // Inline error panel
  function showError(message, hint) {
    errorPanelMsg.textContent = message;
    errorPanelHint.textContent = hint || '';
    errorPanelHint.style.display = hint ? 'block' : 'none';
    errorPanel.classList.remove('hidden');
    errorPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function hideError() {
    errorPanel.classList.add('hidden');
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
});
