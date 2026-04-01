const COT_PRESETS = {
  baseline: {
    key: "baseline",
    label: "Baseline",
    description: "답만 빠르게 요약하는 기본형",
    focus: "빠른 결론, 최소 구조",
    observe: "시점과 증상은 잡을 수 있어도 불확실성, 근거, 다음 조치가 빠지기 쉽습니다.",
    traits: ["짧은 답", "요약 중심", "근거 노출 적음"],
    notes: "Baseline preset loaded from CoT Experiment.",
    systemTemplate: `당신은 사고 상황을 짧게 정리하는 요약 어시스턴트입니다.

규칙:
1. 제공된 데이터만 사용하세요.
2. 원인을 추정하지 마세요.
3. 가장 중요한 사실만 1~2문장으로 요약하세요.
4. 장황한 설명, 단계별 추론, 가설 목록은 쓰지 마세요.
`,
    userTemplate: `IMS {{ ims_no }} 데이터를 바탕으로 상황 요약만 작성하세요.

포함할 것:
- 시점 또는 변화가 감지된 구간
- 영향을 받는 대상
- 현재 관찰된 증상

출력 형식:
상황 요약: 1~2문장

데이터:
{{ bundle | to_pretty_json }}
`,
  },
  visible_cot: {
    key: "visible_cot",
    label: "Visible CoT",
    description: "추론 단계를 그대로 드러내는 설명형",
    focus: "근거와 사고 흐름을 노출",
    observe: "모델이 어떤 관찰에서 어떤 해석으로 넘어갔는지 읽을 수 있지만 응답이 길어집니다.",
    traits: ["단계별 추론", "가설 비교", "불확실성 표시"],
    notes: "Visible CoT preset loaded from CoT Experiment.",
    systemTemplate: `당신은 IMS 조사 분석가입니다.

규칙:
1. 제공된 데이터만 사용하세요.
2. 사실, 해석, 가설, 다음 조치를 분리하세요.
3. 추론 단계를 번호로 명시하세요.
4. 증거가 약하면 약하다고 밝히세요.
`,
    userTemplate: `IMS {{ ims_no }}를 분석하세요.

반드시 아래 구조로 답하세요:

## 상황 요약
- 3개 이하 불릿

## 핵심 증거
- 데이터에서 직접 확인되는 사실

## 추론 체인
1. 관찰
2. 해석
3. 의미

## 미확인 사항
- 아직 확정할 수 없는 점

## 다음 확인 포인트
1. 가장 먼저 볼 항목
2. 두 번째로 볼 항목
3. 세 번째로 볼 항목

데이터:
{{ bundle | to_pretty_json }}
`,
  },
  structured_cot: {
    key: "structured_cot",
    label: "Structured CoT",
    description: "내부적으로 단계적 판단 후 최종 구조만 남기는 실무형",
    focus: "추론 discipline 유지, 출력은 간결",
    observe: "CoT의 장점은 유지하면서도 결과가 보고서나 RCA 초안처럼 정돈되는지 확인할 수 있습니다.",
    traits: ["구조화 출력", "근거와 미확인 분리", "다음 조치 중심"],
    notes: "Structured CoT preset loaded from CoT Experiment.",
    systemTemplate: `당신은 운영 사고 분석 어시스턴트입니다.

규칙:
1. 제공된 데이터만 사용하세요.
2. 내부적으로 단계적으로 판단하되, 최종 답변에는 구조화된 결과만 출력하세요.
3. 사실과 미확인 사항을 섞지 마세요.
4. 가장 가치 높은 다음 조사 조치를 우선순위로 제시하세요.
`,
    userTemplate: `IMS {{ ims_no }}를 분석하세요.

내부적으로는 단계적으로 판단하되, 최종 답변에는 아래만 출력하세요:

## 상황 요약
- 2~3개 불릿

## 근거
- 가장 중요한 사실 3개

## 미확인 사항
- 아직 특정되지 않은 점 2~3개

## 다음 조치
1. 가장 우선순위가 높은 확인
2. 두 번째 확인
3. 세 번째 확인

## 최종 평가
- 현재 시점의 가장 방어 가능한 결론 2~4문장

데이터:
{{ bundle | to_pretty_json }}
`,
  },
}

const COMPARE_PRESET_KEYS = ["baseline", "visible_cot", "structured_cot"]
const DEFAULT_PRESET_KEY = "structured_cot"

const OUTPUT_SIGNALS = [
  { label: "요약", pattern: /상황 요약|요약/i },
  { label: "추론 단계", pattern: /추론 체인|단계별 추론|^\s*1\.\s/m },
  { label: "불확실성", pattern: /미확인|불확실|부족한 증거|약점/i },
  { label: "다음 조치", pattern: /다음 조치|확인 포인트|가장 가치 높은 다음 조치|조치/i },
]

const TRACE_STAGE_INTERVAL_MS = 1400

const PRESET_TRACE_STAGES = {
  baseline: [
    {
      label: "사실 확인",
      description: "배포 시점, 영향 대상, 현재 증상을 입력 데이터에서 읽습니다.",
    },
    {
      label: "핵심 압축",
      description: "가장 중요한 신호만 남기고 짧은 결론 후보를 만듭니다.",
    },
    {
      label: "답변 생성",
      description: "추가 설명 없이 한두 문장 요약으로 마무리합니다.",
    },
  ],
  visible_cot: [
    {
      label: "관찰 추출",
      description: "데이터에서 직접 보이는 사실을 항목별로 모읍니다.",
    },
    {
      label: "증거 정리",
      description: "강한 신호와 약한 신호를 분리해 근거를 정렬합니다.",
    },
    {
      label: "추론 체인 구성",
      description: "관찰에서 해석으로 이어지는 단계를 명시합니다.",
    },
    {
      label: "미확인 사항 식별",
      description: "아직 확정할 수 없는 점과 반대 신호를 표시합니다.",
    },
    {
      label: "다음 액션 도출",
      description: "운영자가 바로 확인할 다음 조치를 우선순위로 제시합니다.",
    },
  ],
  structured_cot: [
    {
      label: "사실 정리",
      description: "입력 데이터에서 요약, 근거, 미확인 정보를 분리합니다.",
    },
    {
      label: "내부 단계 판단",
      description: "관찰과 의미를 내부적으로 연결해 결론 후보를 좁힙니다.",
    },
    {
      label: "실행형 구조화",
      description: "근거, 미확인 사항, 다음 조치를 보고서 형태로 정리합니다.",
    },
    {
      label: "최종 평가",
      description: "현재 시점의 가장 방어 가능한 결론으로 마무리합니다.",
    },
  ],
}

const state = {
  basePrompts: null,
  history: [],
  currentBundle: null,
  lastRendered: null,
  currentRecordId: null,
  renderToken: 0,
  renderTimer: null,
  selectedPresetKey: DEFAULT_PRESET_KEY,
  compareResults: [],
  compareRunAt: null,
  compareRunCompleted: 0,
  compareRunTotal: 0,
  compareTraceTimer: null,
}

const elements = {}

document.addEventListener("DOMContentLoaded", () => {
  cacheElements()
  bindEvents()
  selectPreset(DEFAULT_PRESET_KEY)
  renderCompareResults()
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
  elements.compareButton = document.getElementById("compareButton")
  elements.applyPresetButton = document.getElementById("applyPresetButton")
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
  elements.presetButtons = Array.from(document.querySelectorAll(".preset-card"))
  elements.presetDetails = document.getElementById("presetDetails")
  elements.compareStatus = document.getElementById("compareStatus")
  elements.compareSignals = document.getElementById("compareSignals")
  elements.compareGrid = document.getElementById("compareGrid")
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
    renderHistoryList()
    setStatus("기본 프롬프트로 복원했습니다.", "success")
    scheduleRender(0)
  })

  elements.compareButton.addEventListener("click", async () => {
    await runPresetComparison()
  })

  elements.applyPresetButton.addEventListener("click", () => {
    applySelectedPresetToEditor()
  })

  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      selectPreset(button.dataset.preset)
    })
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

function selectPreset(presetKey) {
  if (!COT_PRESETS[presetKey]) {
    return
  }

  state.selectedPresetKey = presetKey
  elements.presetButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === presetKey)
  })
  renderPresetDetails(COT_PRESETS[presetKey])
}

function renderPresetDetails(preset) {
  const traits = preset.traits
    .map((trait) => `<span class="hint-pill">${escapeHtml(trait)}</span>`)
    .join("")

  elements.presetDetails.innerHTML = `
    <div>
      <p class="detail-label">Selected Preset</p>
      <h3>${escapeHtml(preset.label)}</h3>
      <p>${escapeHtml(preset.description)}</p>
    </div>
    <div class="preset-points">
      <p><strong>관찰 포인트</strong> ${escapeHtml(preset.observe)}</p>
      <div class="hint-row">${traits}</div>
    </div>
  `
}

function applySelectedPresetToEditor() {
  const preset = COT_PRESETS[state.selectedPresetKey]
  if (!preset) {
    return
  }

  elements.systemPrompt.value = preset.systemTemplate
  elements.userPrompt.value = preset.userTemplate
  elements.titleInput.value = `[Preset] ${preset.label}`
  elements.notesInput.value = preset.notes
  state.currentRecordId = null
  renderHistoryList()
  setStatus(`${preset.label} 프리셋을 편집기에 로드했습니다. 현재 프롬프트 실행으로 단건 테스트할 수 있습니다.`, "success")
  scheduleRender(0)
}

async function runPresetComparison() {
  activateTab("compare")
  if (!elements.imsSelect.value) {
    setStatus("비교 실행을 하려면 IMS 번호를 선택해야 합니다.", "error")
    return
  }

  setBusy(elements.compareButton, true)
  setBusy(elements.applyPresetButton, true)
  setStatus("Baseline, Visible CoT, Structured CoT를 순서대로 실행하는 중입니다...", "")

  const sharedPayload = {
    ims_no: elements.imsSelect.value,
    model: elements.modelInput.value.trim() || null,
    temperature: Number(elements.temperatureInput.value || "0.2"),
    max_output_tokens: Number(elements.maxTokensInput.value || "1200"),
  }

  const presets = COMPARE_PRESET_KEYS.map((presetKey) => COT_PRESETS[presetKey])
  state.compareResults = presets.map((preset) => createPendingCompareResult(preset))
  state.compareRunAt = new Date()
  state.compareRunCompleted = 0
  state.compareRunTotal = presets.length
  startCompareTraceTimer()
  renderCompareResults()

  try {
    await Promise.all(
      presets.map(async (preset, index) => {
        try {
          const response = await fetchJSON("/api/test/run", {
            method: "POST",
            body: JSON.stringify({
              ...sharedPayload,
              system_template: preset.systemTemplate,
              user_template: preset.userTemplate,
            }),
          })

          state.compareResults[index] = buildCompareResult(preset, response, state.compareResults[index])
        } catch (error) {
          state.compareResults[index] = buildCompareErrorResult(
            preset,
            error instanceof Error ? error.message : String(error),
            state.compareResults[index],
          )
        } finally {
          state.compareRunCompleted += 1
          renderCompareResults()
        }
      }),
    )
  } finally {
    stopCompareTraceTimer()
    setBusy(elements.compareButton, false)
    setBusy(elements.applyPresetButton, false)
  }

  const failedRuns = state.compareResults.filter((result) => result.error && !result.pending)
  if (failedRuns.length > 0) {
    setStatus(`비교 실행은 완료되었지만 ${failedRuns.length}개 변형에서 오류가 있었습니다. Compare 탭을 확인하세요.`, "error")
  } else {
    setStatus("3가지 프롬프트 전략 비교가 완료되었습니다. Compare 탭에서 차이를 확인하세요.", "success")
  }
}

function createPendingCompareResult(preset) {
  return {
    key: preset.key,
    label: preset.label,
    description: preset.description,
    focus: preset.focus,
    observe: preset.observe,
    traits: preset.traits,
    response: {},
    error: "",
    outputText: "",
    outputLength: 0,
    signals: [],
    systemTemplate: preset.systemTemplate,
    userTemplate: preset.userTemplate,
    renderedSystem: "",
    renderedUser: "",
    traceStages: buildTraceStages(preset.key),
    startedAt: Date.now(),
    completedAt: null,
    pending: true,
  }
}

function buildCompareResult(preset, response, previousResult = null) {
  const renderErrors = response.render_errors || {}
  const error = response.error || (Object.keys(renderErrors).length > 0 ? formatObject(renderErrors, "렌더 에러") : "")
  const outputText = response.output_text || ""

  return {
    key: preset.key,
    label: preset.label,
    description: preset.description,
    focus: preset.focus,
    observe: preset.observe,
    traits: preset.traits,
    response,
    error,
    outputText,
    outputLength: outputText.trim().length,
    signals: collectOutputSignals(outputText),
    systemTemplate: preset.systemTemplate,
    userTemplate: preset.userTemplate,
    renderedSystem: response.rendered_system || "",
    renderedUser: response.rendered_user || "",
    traceStages: previousResult?.traceStages || buildTraceStages(preset.key),
    startedAt: previousResult?.startedAt || Date.now(),
    completedAt: Date.now(),
    pending: false,
  }
}

function buildCompareErrorResult(preset, errorMessage, previousResult = null) {
  return {
    key: preset.key,
    label: preset.label,
    description: preset.description,
    focus: preset.focus,
    observe: preset.observe,
    traits: preset.traits,
    response: {},
    error: errorMessage,
    outputText: "",
    outputLength: 0,
    signals: [],
    systemTemplate: preset.systemTemplate,
    userTemplate: preset.userTemplate,
    renderedSystem: "",
    renderedUser: "",
    traceStages: previousResult?.traceStages || buildTraceStages(preset.key),
    startedAt: previousResult?.startedAt || Date.now(),
    completedAt: Date.now(),
    pending: false,
  }
}

function buildTraceStages(presetKey) {
  return (PRESET_TRACE_STAGES[presetKey] || []).map((stage) => ({ ...stage }))
}

function startCompareTraceTimer() {
  stopCompareTraceTimer()
  state.compareTraceTimer = window.setInterval(() => {
    if (!state.compareResults.some((result) => result.pending)) {
      stopCompareTraceTimer()
      return
    }
    renderCompareResults()
  }, 450)
}

function stopCompareTraceTimer() {
  if (state.compareTraceTimer) {
    window.clearInterval(state.compareTraceTimer)
    state.compareTraceTimer = null
  }
}

function collectOutputSignals(outputText) {
  return OUTPUT_SIGNALS.map((signal) => ({
    label: signal.label,
    active: signal.pattern.test(outputText || ""),
  }))
}

function renderCompareResults() {
  elements.compareGrid.innerHTML = ""
  elements.compareSignals.innerHTML = ""

  if (state.compareResults.length === 0) {
    elements.compareStatus.textContent =
      '아직 비교 실험을 실행하지 않았습니다. 상단의 "3가지 비교 실행" 버튼으로 같은 입력에 대한 프롬프트 전략 차이를 확인하세요.'

    const placeholder = document.createElement("article")
    placeholder.className = "compare-card empty"
    placeholder.innerHTML = `
      <span class="compare-label">Waiting</span>
      <h3>비교 결과 없음</h3>
      <p>아직 Baseline, Visible CoT, Structured CoT 비교가 실행되지 않았습니다.</p>
    `
    elements.compareGrid.appendChild(placeholder)
    return
  }

  const runAt = state.compareRunAt ? state.compareRunAt.toLocaleString() : "-"
  const selectedModel = elements.modelInput.value.trim() || document.body.dataset.defaultModel || "-"
  const completedCount = state.compareRunCompleted || state.compareResults.filter((result) => !result.pending).length
  const successCount = state.compareResults.filter((result) => !result.pending && !result.error).length
  const pendingCount = state.compareResults.filter((result) => result.pending).length
  elements.compareStatus.textContent =
    `${runAt} | IMS ${elements.imsSelect.value} | model ${selectedModel} | completed ${completedCount}/${state.compareRunTotal || state.compareResults.length} | success ${successCount} | pending ${pendingCount}`

  renderCompareOverviewCards(state.compareResults.filter((result) => !result.pending))

  state.compareResults.forEach((result) => {
    const card = document.createElement("article")
    card.className = `compare-card${result.error ? " error" : ""}${result.pending ? " pending" : ""}`

    const stats = buildCompareStats(result.response)
      .map((item) => `<span class="stat-pill">${escapeHtml(item)}</span>`)
      .join("")

    const signals = (result.signals || [])
      .map(
        (signal) =>
          `<span class="signal-chip${signal.active ? " active" : ""}">${escapeHtml(signal.label)}</span>`,
      )
      .join("")

    const reasoningPreview = renderPreviewBlock("추론 스냅샷", extractReasoningPreview(result.outputText))
    const actionPreview = renderPreviewBlock("다음 액션", extractActionPreview(result.outputText))
    const traceTimeline = renderTraceTimeline(result)
    const promptDetails = renderPromptDetails(result)
    const bodyText = result.pending
      ? "실행 중입니다. 모델 응답이 도착하면 이 카드가 자동으로 갱신됩니다."
      : result.error || result.outputText || "응답 없음"

    card.innerHTML = `
      <div class="compare-card-head">
        <span class="compare-label">${escapeHtml(result.label)}</span>
        <span class="compare-focus">${escapeHtml(result.pending ? "실행 중" : result.focus)}</span>
      </div>
      <h3>${escapeHtml(result.description)}</h3>
      <p class="compare-observe">${escapeHtml(result.observe)}</p>
      ${traceTimeline}
      ${reasoningPreview}
      ${actionPreview}
      ${promptDetails}
      <div class="compare-stats">${stats}</div>
      <div class="signal-strip">${signals}</div>
      <pre class="code-block${result.error || result.pending ? " muted" : ""}">${escapeHtml(bodyText)}</pre>
    `

    elements.compareGrid.appendChild(card)
  })
}

function renderTraceTimeline(result) {
  const traceStages = result.traceStages || []
  if (traceStages.length === 0) {
    return ""
  }

  const markup = traceStages
    .map((stage, index) => {
      const phaseClass = getTracePhaseClass(result, index, traceStages.length)
      return `
        <div class="trace-step ${phaseClass}">
          <span class="trace-step-label">${escapeHtml(stage.label)}</span>
          <small>${escapeHtml(stage.description)}</small>
        </div>
      `
    })
    .join("")

  return `<div class="trace-timeline">${markup}</div>`
}

function getTracePhaseClass(result, index, totalSteps) {
  if (!result.pending) {
    if (!result.error) {
      return "done"
    }

    const finishedIndex = getReachedTraceIndex(result, totalSteps)
    if (index < finishedIndex) {
      return "done"
    }
    if (index === finishedIndex) {
      return "error"
    }
    return "pending"
  }

  const activeIndex = getReachedTraceIndex(result, totalSteps)
  if (index < activeIndex) {
    return "done"
  }
  if (index === activeIndex) {
    return "active"
  }
  return "pending"
}

function getReachedTraceIndex(result, totalSteps) {
  if (!totalSteps) {
    return 0
  }

  const startedAt = result.startedAt || Date.now()
  const finishedAt = result.pending ? Date.now() : result.completedAt || Date.now()
  const elapsed = Math.max(0, finishedAt - startedAt)
  return Math.min(Math.floor(elapsed / TRACE_STAGE_INTERVAL_MS), totalSteps - 1)
}

function renderPreviewBlock(title, items) {
  if (!items || items.length === 0) {
    return ""
  }

  const content = items
    .map((item) => `<div class="preview-item">${escapeHtml(item)}</div>`)
    .join("")

  return `
    <div class="preview-block">
      <span class="preview-title">${escapeHtml(title)}</span>
      <div class="preview-list">${content}</div>
    </div>
  `
}

function renderPromptDetails(result) {
  const renderedPromptNotice = result.pending
    ? "렌더된 프롬프트는 응답이 도착하면 표시됩니다."
    : "아래는 실제 비교 실행에 사용된 프롬프트입니다."

  return `
    <details class="prompt-details">
      <summary>Prompt 보기</summary>
      <p class="prompt-note">${escapeHtml(renderedPromptNotice)}</p>
      <div class="prompt-block">
        <span class="prompt-title">Template System Prompt</span>
        <pre class="code-block muted prompt-code">${escapeHtml(result.systemTemplate || "없음")}</pre>
      </div>
      <div class="prompt-block">
        <span class="prompt-title">Template User Prompt</span>
        <pre class="code-block muted prompt-code">${escapeHtml(result.userTemplate || "없음")}</pre>
      </div>
      <div class="prompt-block">
        <span class="prompt-title">Rendered System Prompt</span>
        <pre class="code-block muted prompt-code">${escapeHtml(result.renderedSystem || "대기 중")}</pre>
      </div>
      <div class="prompt-block">
        <span class="prompt-title">Rendered User Prompt</span>
        <pre class="code-block muted prompt-code">${escapeHtml(result.renderedUser || "대기 중")}</pre>
      </div>
    </details>
  `
}

function extractReasoningPreview(outputText) {
  const sections = parseMarkdownSections(outputText)
  const sectionText =
    findSectionByKeyword(sections, ["추론 체인", "단계별 추론", "근거", "핵심 증거"]) || outputText
  return extractPreviewLines(sectionText, 2)
}

function extractActionPreview(outputText) {
  const sections = parseMarkdownSections(outputText)
  const sectionText = findSectionByKeyword(sections, [
    "다음 조치",
    "다음 확인 포인트",
    "가장 가치 높은 다음 조치",
  ])
  return extractPreviewLines(sectionText, 3)
}

function parseMarkdownSections(outputText) {
  const sections = []
  if (!outputText) {
    return sections
  }

  let currentHeading = ""
  let buffer = []

  function pushSection() {
    if (!currentHeading && buffer.length === 0) {
      return
    }
    sections.push({
      heading: currentHeading,
      content: buffer.join("\n").trim(),
    })
  }

  outputText.split(/\r?\n/).forEach((line) => {
    const headingMatch = line.match(/^##\s+(.+)$/)
    if (headingMatch) {
      pushSection()
      currentHeading = headingMatch[1].trim()
      buffer = []
      return
    }
    buffer.push(line)
  })

  pushSection()
  return sections
}

function findSectionByKeyword(sections, keywords) {
  const matchedSection = sections.find((section) =>
    keywords.some((keyword) => section.heading.includes(keyword)),
  )
  return matchedSection?.content || ""
}

function extractPreviewLines(sectionText, limit) {
  if (!sectionText) {
    return []
  }

  const lines = sectionText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[-*]\s+/, "").replace(/^\d+\.\s+/, ""))
    .filter((line) => line.length > 0)

  return lines.slice(0, limit)
}

function renderCompareOverviewCards(results) {
  const successful = results.filter((result) => !result.error)
  if (successful.length === 0) {
    return
  }

  const shortest = successful.reduce((best, current) =>
    current.outputLength < best.outputLength ? current : best,
  )
  const richest = successful.reduce((best, current) =>
    getSignalScore(current) > getSignalScore(best) ? current : best,
  )
  const mostTokens = successful.reduce((best, current) => {
    const currentTokens = current.response.usage?.total_tokens ?? -1
    const bestTokens = best.response.usage?.total_tokens ?? -1
    return currentTokens > bestTokens ? current : best
  })

  const overviewCards = [
    {
      title: "가장 짧은 출력",
      body: `${shortest.label} · ${shortest.outputLength || 0} chars`,
    },
    {
      title: "가장 구조적인 출력",
      body: `${richest.label} · signal ${getSignalScore(richest)}/${OUTPUT_SIGNALS.length}`,
    },
    {
      title: "가장 많은 토큰",
      body: `${mostTokens.label} · ${mostTokens.response.usage?.total_tokens ?? "-"} tokens`,
    },
  ]

  elements.compareSignals.innerHTML = overviewCards
    .map(
      (card) => `
        <article class="signal-summary">
          <span>${escapeHtml(card.title)}</span>
          <strong>${escapeHtml(card.body)}</strong>
        </article>
      `,
    )
    .join("")
}

function getSignalScore(result) {
  return result.signals.filter((signal) => signal.active).length
}

function buildCompareStats(response) {
  const usage = response.usage || {}
  const stats = []

  if (typeof response.latency_ms === "number") {
    stats.push(`latency ${response.latency_ms} ms`)
  }

  if (usage.total_tokens != null) {
    stats.push(`tokens ${usage.total_tokens}`)
  }

  if (response.provider_request_id) {
    stats.push(`id ${response.provider_request_id}`)
  }

  return stats.length > 0 ? stats : ["통계 없음"]
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
