const state = {
  basePrompts: null,
  history: [],
  currentBundle: null,
  lastRendered: null,
  currentRecordId: null,
  renderToken: 0,
  renderTimer: null,
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
}

function bindEvents() {
  elements.imsSelect.addEventListener("change", async (event) => {
    if (!event.target.value) {
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
    setStatus("기본 프롬프트로 복원했습니다.", "success")
    scheduleRender(0)
  })

  elements.tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab))
  })
}

async function init() {
  elements.modelInput.value = document.body.dataset.defaultModel || ""
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
    model: document.body.dataset.defaultModel || "",
    title: "",
    notes: "",
  }

  if (history.length > 0) {
    const latestRecord = await fetchJSON(`/api/prompts/history/${history[0].id}`)
    initialPromptSource = latestRecord
    state.currentRecordId = latestRecord.id
  }

  applyPromptSource(initialPromptSource)

  const preferredIMS = initialPromptSource.ims_no
  if (preferredIMS && Array.from(elements.imsSelect.options).some((option) => option.value === preferredIMS)) {
    elements.imsSelect.value = preferredIMS
  }

  if (elements.imsSelect.value) {
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
}

function populateIMSList(imsList) {
  elements.imsSelect.innerHTML = ""

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
  if (!state.currentBundle) {
    elements.dataPreview.textContent = "IMS 데이터를 찾지 못했습니다."
    elements.missingSections.innerHTML = ""
    return
  }

  elements.dataPreview.textContent = JSON.stringify(state.currentBundle, null, 2)
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
  setStatus("모델 실행 중...", "")

  const payload = {
    ims_no: elements.imsSelect.value,
    system_template: elements.systemPrompt.value,
    user_template: elements.userPrompt.value,
    model: elements.modelInput.value.trim() || null,
    temperature: Number(elements.temperatureInput.value || "0.2"),
    max_output_tokens: Number(elements.maxTokensInput.value || "1200"),
  }

  try {
    const response = await fetchJSON("/api/test/run", {
      method: "POST",
      body: JSON.stringify(payload),
    })
    state.lastRendered = {
      rendered_system: response.rendered_system,
      rendered_user: response.rendered_user,
      render_errors: response.render_errors || {},
    }
    renderRenderedView(state.lastRendered)
    renderRunResponse(response)

    if (response.error) {
      setStatus(`실행 실패: ${response.error}`, "error")
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
      const payload = await response.json()
      detail = payload.detail || JSON.stringify(payload)
    } catch (_) {
      detail = await response.text()
    }
    throw new Error(detail)
  }

  return response.json()
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
