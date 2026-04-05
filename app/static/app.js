
const state = {
  basePrompts: null,
  history: [],
  currentBundle: null,
  lastRendered: null,
  currentRecordId: null,
  renderToken: 0,
  renderTimer: null,
  selectedBatchIds: [],
}

const elements = {}

document.addEventListener("DOMContentLoaded", () => {
  cacheElements()
  bindEvents()
  init().catch((error) => {
    setStatus(`초기화 실패: ${error.message}`, "error")
  })
})

function cacheElements() {
  elements.imsSelect = document.getElementById("imsSelect")
  elements.modelInput = document.getElementById("modelInput")
  elements.temperatureInput = document.getElementById("temperatureInput")
  elements.maxTokensInput = document.getElementById("maxTokensInput")
  elements.titleInput = document.getElementById("titleInput")
  elements.notesInput = document.getElementById("notesInput")
  elements.systemPrompt = document.getElementById("systemPrompt")
  elements.userPrompt = document.getElementById("userPrompt")
  elements.renderButton = document.getElementById("renderButton")
  elements.runButton = document.getElementById("runButton")
  elements.saveButton = document.getElementById("saveButton")
  elements.restoreButton = document.getElementById("restoreButton")
  elements.statusBar = document.getElementById("statusBar")
  elements.dataPreview = document.getElementById("dataPreview")
  elements.missingSections = document.getElementById("missingSections")
  elements.renderErrors = document.getElementById("renderErrors")
  elements.renderedSystem = document.getElementById("renderedSystem")
  elements.renderedUser = document.getElementById("renderedUser")
  elements.responseStats = document.getElementById("responseStats")
  elements.runError = document.getElementById("runError")
  elements.modelOutput = document.getElementById("modelOutput")
  elements.historyList = document.getElementById("historyList")
  elements.tabButtons = Array.from(document.querySelectorAll(".tab-button"))
  elements.tabPanels = Array.from(document.querySelectorAll(".tab-panel"))

  elements.auditButton = document.getElementById("auditButton")
  elements.auditResults = document.getElementById("auditResults")
  elements.auditStatus = document.getElementById("auditStatus")
  elements.auditHistoryList = document.getElementById("auditHistoryList")
  elements.batchHistoryList = document.getElementById("batchHistoryList")
  elements.compareBatchesBtn = document.getElementById("compareBatchesBtn")
  elements.batchComparisonUI = document.getElementById("batchComparisonUI")
  elements.comparisonStats = document.getElementById("comparisonStats")
  elements.comparisonChart = document.getElementById("comparisonChart")
  elements.closeComparisonBtn = document.getElementById("closeComparisonBtn")
}

function bindEvents() {
  elements.imsSelect.addEventListener("change", async (event) => {
    if (!event.target.value) {
      state.currentBundle = null
      renderBundlePreview()
      await renderPrompts()
      return
    }
    if (event.target.value === "ALL") {
      state.currentBundle = null
      renderBundlePreview()
      await renderPrompts()
      return
    }
    await loadBundle(event.target.value)
    scheduleRender(50)
  })

  ;[elements.systemPrompt, elements.userPrompt].forEach((element) => {
    element.addEventListener("input", () => scheduleRender(250))
  })

  elements.renderButton.addEventListener("click", async () => {
    await renderPrompts()
  })

  elements.runButton.addEventListener("click", async () => {
    await runPromptTest()
  })

  elements.saveButton.addEventListener("click", async () => {
    await savePrompts()
  })

  elements.restoreButton.addEventListener("click", async () => {
    if (!state.basePrompts) {
      return
    }
    applyPromptSource({
      system_template: state.basePrompts.system_template,
      user_template: state.basePrompts.user_template,
      model: document.body.dataset.defaultModel || "",
      notes: "",
      title: "",
    })
    state.currentRecordId = null
    renderHistoryList()
    setStatus("기본 프롬프트로 복원했습니다.", "success")
    scheduleRender(0)
  })

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab))
  })

  elements.auditButton.addEventListener("click", async () => {
    await runAuditComparison()
  })

  elements.compareBatchesBtn.addEventListener("click", () => {
    compareBatches()
  })

  elements.closeComparisonBtn.addEventListener("click", () => {
    elements.batchComparisonUI.classList.remove("active")
  })
}

async function init() {
  const defaultModel = document.body.dataset.defaultModel || ""
  elements.modelInput.value = defaultModel
  const [imsList, basePrompts, history] = await Promise.all([
    fetchJSON("/api/ims"),
    fetchJSON("/api/prompts/base"),
    fetchJSON("/api/prompts/history"),
  ])

  populateIMSList(imsList)
  state.basePrompts = basePrompts
  state.history = history
  renderHistoryList()

  let initialPromptSource = {
    system_template: basePrompts.system_template,
    user_template: basePrompts.user_template,
    model: defaultModel,
    title: "",
    notes: "",
  }

  if (history.length > 0) {
    const latestRecord = await fetchJSON(`/api/prompts/history/${history[0].id}`)
    initialPromptSource = {
      ...latestRecord,
      model: defaultModel || latestRecord.model || "",
    }
    state.currentRecordId = latestRecord.id
  }

  applyPromptSource(initialPromptSource)

  const preferredIMS = initialPromptSource.ims_no
  if (preferredIMS && Array.from(elements.imsSelect.options).some((option) => option.value === preferredIMS)) {
    elements.imsSelect.value = preferredIMS
  }

  if (elements.imsSelect.value && elements.imsSelect.value !== "ALL") {
    await loadBundle(elements.imsSelect.value)
  } else {
    renderBundlePreview()
  }

  await renderPrompts()

  if (history.length > 0) {
    setStatus("가장 최근에 저장한 프롬프트를 로드했습니다.", "success")
  } else {
    setStatus("기본 프롬프트를 로드했습니다. IMS 번호를 선택하고 바로 수정할 수 있습니다.", "success")
  }
  loadAuditHistory()
  loadBatchAuditHistory()
}

function populateIMSList(imsList) {
  elements.imsSelect.innerHTML = ""

  const allOption = document.createElement("option")
  allOption.value = "ALL"
  allOption.textContent = "전체 (All Data)"
  elements.imsSelect.appendChild(allOption)

  if (imsList.length === 0) {
    const emptyOption = document.createElement("option")
    emptyOption.value = ""
    emptyOption.textContent = "사용 가능한 IMS 데이터 없음"
    elements.imsSelect.appendChild(emptyOption)
    return
  }

  imsList.forEach((item, index) => {
    const option = document.createElement("option")
    option.value = item.ims_no
    option.textContent = `${item.ims_no} (${item.available_sections.length}/${item.available_sections.length + item.missing_sections.length})`
    if (index === 0) {
      option.selected = true
    }
    elements.imsSelect.appendChild(option)
  })
}

async function loadBundle(imsNo) {
  state.currentBundle = await fetchJSON(`/api/ims/${imsNo}`)
  renderBundlePreview()
}

function renderBundlePreview() {
  if (elements.imsSelect.value === "ALL") {
    elements.dataPreview.textContent = "전체 데이터 실행 모드입니다. 프리뷰는 개별 선택 시에만 제공됩니다."
    elements.missingSections.innerHTML = ""
    return
  }

  if (!state.currentBundle) {
    elements.dataPreview.textContent = "IMS 데이터를 찾지 못했습니다."
    elements.missingSections.innerHTML = ""
    return
  }

  const displayBundle = { ...state.currentBundle }
  delete displayBundle.refer_info

  elements.dataPreview.textContent = JSON.stringify(displayBundle, null, 2)
  const missing = state.currentBundle.missing_sections || []
  elements.missingSections.innerHTML = ""

  if (missing.length === 0) {
    elements.missingSections.appendChild(buildBadge("모든 섹션 로드됨", true))
    return
  }

  missing.forEach((section) => {
    elements.missingSections.appendChild(buildBadge(`${section} 누락`, false))
  })
}

function buildBadge(label, isSuccess) {
  const badge = document.createElement("span")
  badge.className = `badge${isSuccess ? " success" : ""}`
  badge.textContent = label
  return badge
}

function applyPromptSource(source) {
  elements.systemPrompt.value = source.system_template || ""
  elements.userPrompt.value = source.user_template || ""
  elements.titleInput.value = source.title || ""
  elements.notesInput.value = source.notes || ""
  elements.modelInput.value = source.model || elements.modelInput.value || ""
}

function scheduleRender(delayMs) {
  window.clearTimeout(state.renderTimer)
  state.renderTimer = window.setTimeout(() => {
    renderPrompts().catch((error) => {
      setStatus(`렌더 실패: ${error.message}`, "error")
    })
  }, delayMs)
}

async function renderPrompts() {
  if (!elements.imsSelect.value) {
    state.lastRendered = null
    renderRenderedView({
      rendered_system: "",
      rendered_user: "",
      render_errors: { ims_no: "IMS 번호를 먼저 선택하세요." },
    })
    return
  }

  if (elements.imsSelect.value === "ALL") {
    state.lastRendered = null
    renderRenderedView({
      rendered_system: "전체 모드에서는 시스템 프롬프트가 동적으로 렌더링되지 않습니다. (각 IMS별로 다름)",
      rendered_user: "전체 모드에서는 사용자 프롬프트가 동적으로 렌더링되지 않습니다. (각 IMS별로 다름)",
      render_errors: {},
    })
    return
  }

  const token = ++state.renderToken
  setBusy(elements.renderButton, true)
  setStatus("프롬프트를 렌더링하는 중입니다...", "")

  const payload = {
    ims_no: elements.imsSelect.value,
    system_template: elements.systemPrompt.value,
    user_template: elements.userPrompt.value,
  }

  try {
    const response = await fetchJSON("/api/prompts/render", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    if (token !== state.renderToken) {
      return
    }

    state.lastRendered = response
    renderRenderedView(response)

    if (Object.keys(response.render_errors).length > 0) {
      setStatus("렌더링 에러가 있습니다. 오른쪽 Rendered 탭을 확인하세요.", "error")
    } else {
      setStatus("프롬프트 렌더링이 완료되었습니다.", "success")
    }
  } finally {
    setBusy(elements.renderButton, false)
  }
}

function renderRenderedView(response) {
  elements.renderErrors.textContent = formatObject(response.render_errors || {}, "에러 없음")
  elements.renderedSystem.textContent = response.rendered_system || ""
  elements.renderedUser.textContent = response.rendered_user || ""
}

async function runPromptTest() {
  activateTab("response")
  if (!elements.imsSelect.value) {
    setStatus("실행하려면 IMS 번호를 선택해야 합니다.", "error")
    return
  }

  setBusy(elements.runButton, true)

  const imsOptions = Array.from(elements.imsSelect.options)
    .map(opt => opt.value)
    .filter(val => val && val !== "ALL")
  const imsToRun = elements.imsSelect.value === "ALL" ? imsOptions : [elements.imsSelect.value]

  setStatus(`모델 실행 중... (0 / ${imsToRun.length})`, "")
  elements.modelOutput.textContent = ""
  elements.responseStats.textContent = "실행 대기중..."
  elements.runError.textContent = "에러 없음"

  try {
    const defaultModel = elements.modelInput.value.trim() || null
    const temperature = Number(elements.temperatureInput.value || "0.2")
    const maxTokens = Number(elements.maxTokensInput.value || "2048")
    let totalStats = { in: 0, out: 0, total: 0, latency: 0, errors: 0 }

    for (let i = 0; i < imsToRun.length; i++) {
        const currentIms = imsToRun[i]
        setStatus(`모델 실행 중... (${i + 1} / ${imsToRun.length}) - IMS ${currentIms}`, "")
        
        try {
            const payload = {
                ims_no: currentIms,
                system_template: elements.systemPrompt.value,
                user_template: elements.userPrompt.value,
                model: defaultModel,
                temperature: temperature,
                max_output_tokens: maxTokens,
            }
            const response = await fetchJSON("/api/test/run", {
                method: "POST",
                body: JSON.stringify(payload),
            })
            
            // Render view with latest (only meaningful for last run or if single)
            state.lastRendered = {
                rendered_system: response.rendered_system,
                rendered_user: response.rendered_user,
                render_errors: response.render_errors || {},
            }
            renderRenderedView(state.lastRendered)
            
            if (response.error) {
                elements.modelOutput.textContent += `\n\n=== IMS ${currentIms} [요청 실패] ===\n${response.error}\n`
                totalStats.errors++
            } else {
                elements.modelOutput.textContent += `\n\n=== IMS ${currentIms} ===\n${response.output_text}\n`
                saveSummaryToBackend(currentIms, elements.titleInput.value || 'Custom Run', response.output_text)
                if (response.usage && response.usage.total_tokens) {
                    totalStats.in += response.usage.input_tokens || 0
                    totalStats.out += response.usage.output_tokens || 0
                    totalStats.total += response.usage.total_tokens || 0
                }
                totalStats.latency += response.latency_ms || 0
            }
            // Auto scroll to bottom
            elements.modelOutput.scrollTop = elements.modelOutput.scrollHeight
        } catch(err) {
            elements.modelOutput.textContent += `\n\n=== IMS ${currentIms} [에러] ===\n${err.message}\n`
            totalStats.errors++
            // Auto scroll to bottom
            elements.modelOutput.scrollTop = elements.modelOutput.scrollHeight
        }
    }
    
    elements.responseStats.textContent = `전체 통계 | tokens: in ${totalStats.in}, out ${totalStats.out}, total ${totalStats.total} | 총 latency: ${totalStats.latency} ms`
    if (totalStats.errors > 0) {
        elements.runError.textContent = `${totalStats.errors}건의 에러 발생`
        setStatus(`실행이 완료되었으나 ${totalStats.errors}개의 에러가 발생했습니다.`, "error")
    } else {
        setStatus("모델 실행이 완료되었습니다.", "success")
    }
  } finally {
    setBusy(elements.runButton, false)
  }
}

function renderRunResponse(response) {
  const usage = response.usage || {}
  const stats = []
  if (response.provider_request_id) {
    stats.push(`request_id: ${response.provider_request_id}`)
  }
  if (typeof response.latency_ms === "number") {
    stats.push(`latency: ${response.latency_ms} ms`)
  }
  if (usage.total_tokens != null) {
    stats.push(
      `tokens: in ${usage.input_tokens ?? "-"}, out ${usage.output_tokens ?? "-"}, total ${usage.total_tokens}`,
    )
  }

  elements.responseStats.textContent = stats.length > 0 ? stats.join(" | ") : "실행 통계 없음"
  elements.runError.textContent = response.error || "에러 없음"
  elements.modelOutput.textContent = response.output_text || ""
}

async function savePrompts() {
  if (!elements.imsSelect.value) {
    setStatus("저장하려면 IMS 번호를 선택해야 합니다.", "error")
    return
  }

  setBusy(elements.saveButton, true)
  setStatus("프롬프트를 저장하는 중입니다...", "")

  const payload = {
    ims_no: elements.imsSelect.value,
    title: elements.titleInput.value,
    system_template: elements.systemPrompt.value,
    user_template: elements.userPrompt.value,
    model: elements.modelInput.value.trim() || null,
    notes: elements.notesInput.value,
  }

  try {
    const record = await fetchJSON("/api/prompts/save", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    state.currentRecordId = record.id
    elements.titleInput.value = record.title
    state.history = await fetchJSON("/api/prompts/history")
    renderHistoryList()
    setStatus("프롬프트를 저장했습니다. History 탭에서 다시 불러올 수 있습니다.", "success")
  } finally {
    setBusy(elements.saveButton, false)
  }
}

function renderHistoryList() {
  elements.historyList.innerHTML = ""

  if (state.history.length === 0) {
    const emptyState = document.createElement("div")
    emptyState.className = "response-stats"
    emptyState.textContent = "아직 저장된 프롬프트가 없습니다."
    elements.historyList.appendChild(emptyState)
    return
  }

  state.history.forEach((record) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = `history-item${state.currentRecordId === record.id ? " active" : ""}`
    const savedAt = new Date(record.saved_at).toLocaleString()
    const notes = record.notes ? ` | ${record.notes}` : ""
    button.innerHTML = `<strong>${escapeHtml(record.title)}</strong><small>IMS ${escapeHtml(record.ims_no)} | ${escapeHtml(record.model || "-")} | ${escapeHtml(savedAt)}</small><small>${escapeHtml(notes || "메모 없음")}</small>`
    button.addEventListener("click", async () => {
      const fullRecord = await fetchJSON(`/api/prompts/history/${record.id}`)
      state.currentRecordId = fullRecord.id
      applyPromptSource(fullRecord)
      if (Array.from(elements.imsSelect.options).some((option) => option.value === fullRecord.ims_no)) {
        elements.imsSelect.value = fullRecord.ims_no
        await loadBundle(fullRecord.ims_no)
      }
      renderHistoryList()
      await renderPrompts()
      setStatus(`저장본 "${fullRecord.title}" 를 불러왔습니다.`, "success")
    })
    elements.historyList.appendChild(button)
  })
}


function activateTab(tabName) {
  elements.tabButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === tabName)
  })
  elements.tabPanels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === `tab-${tabName}`)
  })
}

function setBusy(element, busy) {
  element.disabled = busy
}

function setStatus(message, variant) {
  elements.statusBar.textContent = message
  elements.statusBar.className = "status-bar"
  if (variant) {
    elements.statusBar.classList.add(variant)
  }
}

function formatObject(value, fallback) {
  if (!value || Object.keys(value).length === 0) {
    return fallback
  }
  return JSON.stringify(value, null, 2)
}

async function fetchJSON(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    let detail = response.statusText
    try {
      const text = await response.text()
      try {
        const payload = JSON.parse(text)
        detail = payload.detail || JSON.stringify(payload)
      } catch (_) {
        detail = text
      }
    } catch (_) {}
    throw new Error(detail)
  }

  const text = await response.text()
  return text ? JSON.parse(text) : {}
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

async function saveSummaryToBackend(imsNo, runType, outputText) {
  try {
    await fetchJSON("/api/test/save_summary", {
      method: "POST",
      body: JSON.stringify({
        ims_no: imsNo,
        run_type: runType,
        output_text: outputText
      })
    })
  } catch (err) {
    console.error("Failed to save summary to backend:", err)
  }
}

async function runAuditComparison() {
  if (!elements.imsSelect.value) {
    setStatus("Audit을 수행하려면 IMS 번호를 선택해야 합니다.", "error")
    return
  }

  if (elements.imsSelect.value === "ALL") {
      await runBatchAudit()
      return
  }

  setBusy(elements.auditButton, true)
  elements.auditStatus.textContent = "Reference와 비교 분석 중입니다..."
  elements.auditResults.innerHTML = ""

  try {
    const response = await fetchJSON(`/api/test/audit/${elements.imsSelect.value}`, {
      method: "POST",
      body: JSON.stringify({
          ims_no: elements.imsSelect.value,
          system_template: elements.systemPrompt.value,
          user_template: elements.userPrompt.value
      })
    })

    if (response.error) {
       elements.auditStatus.textContent = `오류: ${response.error}`
       if (response.reference || response.generated) {
           renderAuditResults(response)
       }
    } else {
       const score = response.audit_score || response.score
       elements.auditStatus.textContent = `분석 완료 (유사도 점수: ${score}/10)`
       renderAuditResults(response)
       loadAuditHistory()
    }
  } catch (err) {
    elements.auditStatus.textContent = `요청 실패: ${err.message}`
  } finally {
    setBusy(elements.auditButton, false)
  }
}

async function runBatchAudit() {
  setBusy(elements.auditButton, true)
  elements.auditResults.innerHTML = ""

  try {
    const imsList = await fetchJSON("/api/ims")
    const validIms = imsList.filter(item => item.available_sections.includes("refer_info"))
    
    if (validIms.length === 0) {
        setStatus("감사 가능한 (refer_info가 있는) IMS 데이터가 없습니다.", "error")
        return
    }

    const batchResults = []
    let totalScore = 0
    let processedCount = 0

    for (let i = 0; i < validIms.length; i++) {
        const item = validIms[i]
        elements.auditStatus.textContent = `배치 감사 진행 중... [${i + 1}/${validIms.length}] IMS ${item.ims_no} 분석 중`
        
        try {
            const result = await fetchJSON(`/api/test/audit/${item.ims_no}`, {
                method: "POST",
                body: JSON.stringify({
                    ims_no: item.ims_no,
                    system_template: elements.systemPrompt.value,
                    user_template: elements.userPrompt.value
                })
            })
            
            if (!result.error) {
                const score = result.audit_score || 0
                batchResults.push({
                    ims_no: item.ims_no,
                    score: score,
                    explanation: result.audit_explanation || "",
                    refer_info: result.refer_info,
                    generated_summary: result.generated_summary
                })
                totalScore += score
                processedCount++
            }
        } catch (e) {
            console.error(`Error auditing IMS ${item.ims_no}:`, e)
        }
    }

    if (processedCount === 0) {
        elements.auditStatus.textContent = "배치 감사 결과가 없습니다."
        return
    }

    const avgScore = (totalScore / processedCount).toFixed(2)
    const batchData = {
        avg_score: avgScore,
        results: batchResults,
        system_template: elements.systemPrompt.value,
        user_template: elements.userPrompt.value
    }

    // Save batch to history
    const savedRecord = await fetchJSON("/api/audit/batch/save", {
        method: "POST",
        body: JSON.stringify(batchData)
    })

    elements.auditStatus.textContent = `배치 감사 완료: 평균 유사도 ${avgScore}/10`
    renderBatchAuditResults(savedRecord)
    loadBatchAuditHistory()

  } catch (err) {
    elements.auditStatus.textContent = `배치 감사 오류: ${err.message}`
  } finally {
    setBusy(elements.auditButton, false)
  }
}

async function loadBatchAuditHistory() {
  try {
    const history = await fetchJSON("/api/audit/batch/list")
    renderBatchAuditHistory(history)
  } catch (err) {
    console.error("Failed to load batch audit history:", err)
  }
}

function renderBatchAuditHistory(history) {
  elements.batchHistoryList.innerHTML = ""
  if (!history || history.length === 0) {
    elements.batchHistoryList.innerHTML = '<p class="status-bar">배치 감사 내역이 없습니다.</p>'
    elements.compareBatchesBtn.style.display = "none"
    return
  }
  
  elements.compareBatchesBtn.style.display = "block"

  history.forEach((record) => {
    const item = document.createElement("div")
    const isSelected = state.selectedBatchIds.includes(record.id)
    item.className = `history-item audit-history-item selectable${isSelected ? " selected" : ""}`
    const savedAt = new Date(record.saved_at).toLocaleString()
    const scoreClass = record.avg_score >= 8 ? 'success' : record.avg_score >= 5 ? 'warning' : 'error'
    
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; flex-direction: column;">
           <span style="font-weight: 700;">Batch Audit (${record.count} items)</span>
           <small style="color: var(--ink-faint); font-size: 0.75rem;">${savedAt}</small>
        </div>
        <div class="score-pill ${scoreClass}" style="padding: 4px 10px; border-radius: 99px; font-weight: 700; font-size: 0.85rem;">
           Avg: ${record.avg_score}/10
        </div>
      </div>
    `
    
    // Toggle selection on click, but load record on double click or similar?
    // Let's use simple click for selection, and a specific load icon/button?
    // User asked "선택해서 2개를 비교" - so selection is primary.
    item.addEventListener("click", (e) => {
        if (state.selectedBatchIds.includes(record.id)) {
            state.selectedBatchIds = state.selectedBatchIds.filter(id => id !== record.id)
        } else {
            if (state.selectedBatchIds.length >= 2) {
                state.selectedBatchIds.shift() // Keep only latest 2
            }
            state.selectedBatchIds.push(record.id)
        }
        renderBatchAuditHistory(history)
        
        // Also load the clicked one to preview results
        loadBatchAuditRecord(record.id)
    })
    
    elements.batchHistoryList.appendChild(item)
  })
}

async function compareBatches() {
    if (state.selectedBatchIds.length < 2) {
        setStatus("비교하려면 최소 2개의 배치 기록을 선택해야 합니다.", "warning")
        return
    }
    
    try {
        const [batch1, batch2] = await Promise.all(
            state.selectedBatchIds.map(id => fetchJSON(`/api/audit/batch/${id}`))
        )
        
        renderBatchComparison(batch1, batch2)
        elements.batchComparisonUI.classList.add("active")
        elements.batchComparisonUI.scrollIntoView({ behavior: 'smooth' })
    } catch (err) {
        setStatus(`비교 로드 실패: ${err.message}`, "error")
    }
}

function renderBatchComparison(b1, b2) {
    // Update Header with Legend
    const headerEl = elements.batchComparisonUI.querySelector(".comparison-header h3")
    headerEl.innerHTML = `
        배치 수행 결과 비교
        <div class="comparison-legend" style="display: inline-flex; margin-left: 20px;">
            <div class="legend-item"><span class="legend-dot batch1"></span> ${new Date(b1.saved_at).toLocaleTimeString() || 'Batch 1'}</div>
            <div class="legend-item"><span class="legend-dot batch2"></span> ${new Date(b2.saved_at).toLocaleTimeString() || 'Batch 2'}</div>
        </div>
    `

    // 1. Render Stats
    elements.comparisonStats.innerHTML = `
        <div class="compare-avg-card batch1">
            <span class="compare-avg-label">${new Date(b1.saved_at).toLocaleTimeString()}</span>
            <span class="compare-avg-value">${b1.avg_score}</span>
            <small>평균 유사도</small>
        </div>
        <div class="compare-avg-card batch2">
            <span class="compare-avg-label">${new Date(b2.saved_at).toLocaleTimeString()}</span>
            <span class="compare-avg-value">${b2.avg_score}</span>
            <small>평균 유사도</small>
        </div>
    `
    
    // 2. Render Chart (Common IMS items)
    const b1Map = Object.fromEntries(b1.results.map(r => [r.ims_no, r.score]))
    const b2Map = Object.fromEntries(b2.results.map(r => [r.ims_no, r.score]))
    
    // All unique IMS IDs sorted
    const allIms = Array.from(new Set([...Object.keys(b1Map), ...Object.keys(b2Map)])).sort((a,b) => parseInt(a) - parseInt(b))
    
    elements.comparisonChart.innerHTML = allIms.map(ims => {
        const s1 = b1Map[ims] || 0
        const s2 = b2Map[ims] || 0
        return `
            <div class="comparison-bar-group">
                <div class="bar-score-group">
                    <span class="bar-score-label1">${s1}</span>
                    <span style="color: var(--muted)">:</span>
                    <span class="bar-score-label2">${s2}</span>
                </div>
                <div class="comparison-bar batch1" style="height: ${s1 * 10}%" title="Batch 1: ${s1}점"></div>
                <div class="comparison-bar batch2" style="height: ${s2 * 10}%" title="Batch 2: ${s2}점"></div>
                <span class="bar-label">${ims}</span>
            </div>
        `
    }).join("")
}

async function loadBatchAuditRecord(id) {
  try {
    setBusy(elements.auditButton, true)
    const record = await fetchJSON(`/api/audit/batch/${id}`)
    renderBatchAuditResults(record)
    
    elements.systemPrompt.value = record.system_template || ""
    elements.userPrompt.value = record.user_template || ""
    elements.imsSelect.value = "ALL" // Select ALL for batch context
    
    scheduleRender(0)
    setStatus(`배치 감사 기록 (${id})을 불러왔습니다.`, "success")
  } catch (err) {
    setStatus(`배치 감사 기록 로드 실패: ${err.message}`, "error")
  } finally {
    setBusy(elements.auditButton, false)
  }
}

function renderBatchAuditResults(data) {
  const chartHtml = data.results.map(res => {
      const height = res.score * 10 // 1-10 -> 10-100%
      return `
        <div class="chart-bar" style="height: ${height}%" title="IMS ${res.ims_no}: ${res.score}점">
            <span class="bar-score">${res.score}</span>
            <span class="bar-label">${res.ims_no}</span>
        </div>
      `
  }).join("")

  elements.auditResults.innerHTML = `
    <div class="batch-summary-card">
       <div class="avg-score-display">
          <span>최종 유사도 평균</span>
          <strong>${data.avg_score}</strong>
          <small>/ 10</small>
       </div>
       <div class="batch-chart">
          ${chartHtml}
       </div>
    </div>
    <div class="batch-details-grid">
       ${data.results.map(res => `
          <div class="batch-detail-item">
             <strong>IMS ${res.ims_no}</strong>: ${res.score}점
             <p>${escapeHtml(res.explanation)}</p>
          </div>
       `).join("")}
    </div>
  `
}

function renderAuditResults(data) {
  const score = data.audit_score !== undefined ? data.audit_score : (data.final_score || data.score)
  const explanation = data.audit_explanation || data.explanation
  const scoreClass = score >= 8 ? "success" : score >= 5 ? "warning" : "error"
  
  const subScoreHtml = [
    { l: "Semantic", v: data.semantic || 0 },
    { l: "Keyword", v: data.keyword || 0 },
    { l: "Structure", v: data.structure || 0 },
    { l: "Intent", v: data.intent || 0 }
  ].map(s => `
    <article class="sub-score-box">
      <span class="sub-score-label">${s.l}</span>
      <strong class="sub-score-val">${s.v}</strong>
    </article>
  `).join("")

  elements.auditResults.innerHTML = `
    <div class="audit-card">
      <div class="audit-score-section">
        <div class="score-circle ${scoreClass || ''}">
            <span class="score-value">${score !== undefined ? score : "?"}</span>
            <span class="score-max">/ 10</span>
        </div>
        <div class="sub-score-container">
            ${subScoreHtml}
        </div>
        <div class="audit-explanation">
            <strong>보고서 요약</strong>
            <p>${escapeHtml(explanation || "4가지 기준에 따른 정교한 유사도 평가가 완료되었습니다.")}</p>
        </div>
      </div>
      
      <div class="audit-comparison-grid">
        <div class="audit-col">
            <span class="compare-label">Reference Summary</span>
            <pre class="code-block">${escapeHtml(data.refer_info || data.reference || "Reference 정보가 없습니다.")}</pre>
        </div>
        <div class="audit-col">
            <span class="compare-label">Generated Summary</span>
            <pre class="code-block">${escapeHtml(data.generated_summary || data.generated || "생성된 정보가 없습니다.")}</pre>
        </div>
      </div>
      
      <div class="response-stats">
        latency: ${data.latency_ms || "-"} ms
      </div>
    </div>
  `
}

async function loadAuditHistory() {
  try {
    const history = await fetchJSON("/api/audit/history")
    renderAuditHistory(history)
  } catch (err) {
    console.error("Failed to load audit history:", err)
  }
}

function renderAuditHistory(history) {
  elements.auditHistoryList.innerHTML = ""
  if (!history || history.length === 0) {
    elements.auditHistoryList.innerHTML = '<p class="status-bar">감사 내역이 없습니다.</p>'
    return
  }

  history.forEach((record) => {
    const item = document.createElement("div")
    item.className = "history-item audit-history-item"
    const savedAt = new Date(record.saved_at).toLocaleString()
    const scoreClass = record.score >= 8 ? 'success' : record.score >= 5 ? 'warning' : 'error'
    
    item.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display: flex; flex-direction: column;">
           <span style="font-weight: 700;">IMS ${record.ims_no} Audit</span>
           <small style="color: var(--ink-faint); font-size: 0.75rem;">${savedAt}</small>
        </div>
        <div class="score-pill ${scoreClass}" style="padding: 4px 10px; border-radius: 99px; font-weight: 700; font-size: 0.85rem;">
           ${record.score}/10
        </div>
      </div>
    `
    item.style.cursor = "pointer"
    item.addEventListener("click", () => loadAuditRecord(record.id))
    elements.auditHistoryList.appendChild(item)
  })
}

async function loadAuditRecord(id) {
  try {
    setBusy(elements.auditButton, true)
    const record = await fetchJSON(`/api/audit/history/${id}`)
    renderAuditResults(record)
    
    elements.systemPrompt.value = record.system_template || ""
    elements.userPrompt.value = record.user_template || ""
    
    if (Array.from(elements.imsSelect.options).some(o => o.value === record.ims_no)) {
        elements.imsSelect.value = record.ims_no
        await loadBundle(record.ims_no)
    }
    
    scheduleRender(0)
    setStatus(`감사 기록 (${id})을 불러왔습니다.`, "success")
  } catch (err) {
    setStatus(`감사 기록 로드 실패: ${err.message}`, "error")
  } finally {
    setBusy(elements.auditButton, false)
  }
}
