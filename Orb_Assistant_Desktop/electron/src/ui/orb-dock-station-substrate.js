(function () {
  const root = document.getElementById("substrate-dock-extension");
  if (!root) return;

  const TAB_KEY = "orb.dock.substrate.activeTab.v1";
  const domains = [
    "spruked.com",
    "truemarkmint.com",
    "shilohridgekatahdins.com",
    "alphacertsig.com",
    "dragonithome.spruked.com",
  ];

  const state = {
    activeTab: localStorage.getItem(TAB_KEY) || "overview",
    status: null,
    lastResearch: null,
    lastSkill: null,
    lastService: null,
    lastBridgeType: "none",
    updatedAt: null,
  };

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "acp", label: "ACP I/O" },
    { id: "memory", label: "Memory" },
    { id: "skills", label: "Skills" },
    { id: "services", label: "Services" },
  ];

  function esc(value) {
    return String(value ?? "n/a")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function boolLabel(value, unknownLabel = "CHECKING") {
    if (value === true) return "ONLINE";
    if (value === false) return "OFF";
    return unknownLabel;
  }

  function runtimeLabel(statusValue, readyValue) {
    const normalized = String(statusValue || "").toLowerCase();
    if (readyValue === true) return "ONLINE";
    if (normalized === "loading" || normalized === "pending") return "CHECKING";
    if (normalized === "online") return "ONLINE";
    if (normalized === "error") return "ERROR";
    if (normalized === "unavailable") return "OFF";
    return boolLabel(readyValue);
  }

  function runtimeOk(statusValue, readyValue) {
    const normalized = String(statusValue || "").toLowerCase();
    if (readyValue === true || normalized === "online") return true;
    if (normalized === "loading" || normalized === "pending") return null;
    if (normalized === "error" || normalized === "unavailable" || readyValue === false) return false;
    return null;
  }

  function pill(label, value, ok) {
    const color = ok === false ? "#ffd740" : ok === true ? "#00e676" : "#00e5ff";
    return `
      <div class="substrate-pill">
        <span>${esc(label)}</span>
        <b style="color:${color}">${esc(value)}</b>
      </div>
    `;
  }

  function pathLine(label, value) {
    return `
      <div class="substrate-path">
        <span>${esc(label)}</span>
        <code>${esc(value || "n/a")}</code>
      </div>
    `;
  }

  function panel(title, body, badge) {
    return `
      <section class="substrate-panel">
        <div class="substrate-panel-head">
          <h2>${esc(title)}</h2>
          ${badge ? `<span>${esc(badge)}</span>` : ""}
        </div>
        ${body}
      </section>
    `;
  }

  function serviceRows(items) {
    return `
      <div class="substrate-list substrate-service-list">
        ${items.map((service) => {
          const id = service.id || service.domain;
          return `
            <div class="substrate-service-row">
              <span>${esc(service.domain || id)}</span>
              <div class="substrate-actions">
                <button data-service-id="${esc(id)}" data-service-action="status">Status</button>
                <button data-service-id="${esc(id)}" data-service-action="open">Open</button>
                <button data-service-id="${esc(id)}" data-service-action="start">Start</button>
                <button data-service-id="${esc(id)}" data-service-action="stop">Stop</button>
              </div>
            </div>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderTabBar(bridgeState) {
    return `
      <div class="substrate-tab-shell">
        <div class="substrate-title">
          <span>Substrate Dock</span>
          <b>${esc(bridgeState)}</b>
        </div>
        <div class="substrate-tabs">
          ${tabs.map((tab) => `
            <button
              class="${tab.id === state.activeTab ? "active" : ""}"
              data-substrate-tab="${esc(tab.id)}"
              type="button"
            >
              ${esc(tab.label)}
            </button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderTabContent(model) {
    const {
      acp,
      bridgeState,
      lastSkillDecision,
      notes,
      researchVault,
      services,
      serviceItems,
      skills,
      status,
      substrate,
    } = model;
    const audioRuntime = acp.audio_runtime_status || {};
    const adapterStatus = acp.adapter_import_status;

    if (state.activeTab === "acp") {
      return `
        <div class="substrate-grid three">
          ${panel("ACP Runtime", [
            pill("ACP ROOT", boolLabel(acp.acp3_root_exists), acp.acp3_root_exists),
            pill("SPEECH ADAPTER", runtimeLabel(adapterStatus, acp.speech_adapter_available), runtimeOk(adapterStatus, acp.speech_adapter_available)),
            pill("MIC RUNTIME", runtimeLabel(audioRuntime.speech, acp.speech_runtime_ready), runtimeOk(audioRuntime.speech, acp.speech_runtime_ready)),
            pill("VOICE ADAPTER", runtimeLabel(adapterStatus, acp.voice_adapter_available), runtimeOk(adapterStatus, acp.voice_adapter_available)),
            pill("VOICE RUNTIME", runtimeLabel(audioRuntime.voice, acp.voice_runtime_ready), runtimeOk(audioRuntime.voice, acp.voice_runtime_ready)),
            pill("TEXT FRAME", runtimeLabel(adapterStatus, acp.text_framing_available), runtimeOk(adapterStatus, acp.text_framing_available)),
          ].join(""), "HEARING")}
          ${panel("Input State", [
            pill("LISTENING", boolLabel(acp.listening_enabled), acp.listening_enabled),
            pill("ACP IMPORT", runtimeLabel(adapterStatus, adapterStatus === "online"), runtimeOk(adapterStatus, adapterStatus === "online")),
            pathLine("AUDIO SOURCE", acp.audio_input_source),
            pathLine("TEXT SOURCE", acp.text_input_source),
            pathLine("ACP 3.0", acp.acp3_root),
          ].join(""), "LIVE")}
          ${panel("Bridge", [
            pill("BRIDGE", bridgeState, bridgeState === "CONNECTED" ? true : bridgeState === "ERROR" ? false : null),
            status.error ? pathLine("ERROR", status.error) : pathLine("LAST EVENT", state.lastBridgeType),
            pathLine("UPDATED", state.updatedAt || "waiting"),
          ].join(""), "IPC")}
        </div>
      `;
    }

    if (state.activeTab === "memory") {
      return `
        <div class="substrate-grid three">
          ${panel("Research Vault", [
            pill("VAULT", boolLabel(researchVault.available), researchVault.available),
            pill("LAST RESULT", state.lastResearch ? "RECORDED" : "NONE", Boolean(state.lastResearch)),
            pathLine("ACTIVE LOG", researchVault.active_path),
            pathLine("INDEX", researchVault.index_path),
            pathLine("SHORT CACHE", substrate.short_term_cache_path),
          ].join(""), "AUDIT")}
          ${panel("Notes", [
            pill("TAKING NOTES", boolLabel(notes.taking_notes), notes.taking_notes),
            pill("PENDING NOTEPAD", boolLabel(notes.pending_notepad_summary), notes.pending_notepad_summary),
            pill("TOPIC", notes.active_topic || "none", Boolean(notes.active_topic)),
            pathLine("SESSION", notes.active_session),
            pathLine("LAST NOTEPAD", notes.last_notepad_path),
          ].join(""), "MEMORY")}
          ${panel("Substrate Paths", [
            pathLine("CALI SYSTEM", substrate.cali_system_root),
            pathLine("MEMORY", substrate.memory_root),
            pathLine("NOTES", substrate.notes_root),
            pathLine("VOICE CACHE", substrate.voice_cache_root),
          ].join(""), "R DRIVE")}
        </div>
      `;
    }

    if (state.activeTab === "skills") {
      return `
        <div class="substrate-grid three">
          ${panel("Skill Library", [
            pill("LIBRARY", boolLabel(skills.available), skills.available),
            pill("CATALOG", skills.catalog_count || 0, Number(skills.catalog_count || 0) > 0),
            pill("ACTIVE", (skills.active || []).length, (skills.active || []).length > 0),
            pathLine("DECISIONS", substrate.decisions_path),
          ].join(""), "ARBITER")}
          ${panel("Active Skills", `
            <div class="substrate-list">${(skills.active || []).map((skill) => `<div>${esc(skill)}</div>`).join("") || "<div>none</div>"}</div>
          `, "10")}
          ${panel("Last Skill Decision", state.lastSkill
            ? [
                pill("SKILL", state.lastSkill.data?.skill_id || state.lastSkill.data?.skill?.skill_id || "routed", true),
                pill("STATUS", state.lastSkill.data?.status || "received", true),
                pathLine("RESPONSE", state.lastSkill.data?.response_text || state.lastSkill.data?.result || "received"),
              ].join("")
            : lastSkillDecision
              ? [
                  pill("SKILL", lastSkillDecision.selected_skill || "none", Boolean(lastSkillDecision.selected_skill)),
                  pill("STATUS", lastSkillDecision.status || "recorded", lastSkillDecision.status === "success"),
                  pill("CONFIDENCE", lastSkillDecision.result_confidence ?? "n/a", true),
                  pathLine("COMMAND", lastSkillDecision.command || "n/a"),
                  pathLine("INTENT", lastSkillDecision.intent || "n/a"),
                ].join("")
              : pill("RESULT", "none received", false), "LIVE")}
        </div>
      `;
    }

    if (state.activeTab === "services") {
      return `
        <div class="substrate-grid two">
          ${panel("Sites / Services", [
            pill("MODE", services.mode || "local_manifest_required", true),
            pathLine("MANIFEST", services.manifest_path),
            serviceRows(serviceItems),
          ].join(""), "LOCAL")}
          ${panel("Last Service", state.lastService
            ? [
                pill("ACTION", state.lastService.action || "status", true),
                pill("STATUS", state.lastService.status || "received", state.lastService.status === "success"),
                pathLine("SERVICE", state.lastService.service?.domain || state.lastService.service_id || "n/a"),
                pathLine("DETAIL", state.lastService.error || state.lastService.result || state.lastService.url || "received"),
              ].join("")
            : pill("RESULT", "none received", false), "LIVE")}
        </div>
      `;
    }

    return `
      <div class="substrate-grid five">
        ${panel("Bridge", [
          pill("BRIDGE", bridgeState, bridgeState === "CONNECTED" ? true : bridgeState === "ERROR" ? false : null),
          pill("CACHE", boolLabel(substrate.short_term_cache_exists), substrate.short_term_cache_exists),
          pill("DECISIONS", boolLabel(substrate.decisions_exists), substrate.decisions_exists),
          status.error ? pathLine("ERROR", status.error) : pathLine("UPDATED", state.updatedAt || "waiting"),
        ].join(""), "R DRIVE")}
        ${panel("ACP", [
          pill("ROOT", boolLabel(acp.acp3_root_exists), acp.acp3_root_exists),
          pill("MIC", runtimeLabel(audioRuntime.speech, acp.speech_runtime_ready), runtimeOk(audioRuntime.speech, acp.speech_runtime_ready)),
          pill("VOICE", runtimeLabel(audioRuntime.voice, acp.voice_runtime_ready), runtimeOk(audioRuntime.voice, acp.voice_runtime_ready)),
          pill("TEXT", runtimeLabel(adapterStatus, acp.text_framing_available), runtimeOk(adapterStatus, acp.text_framing_available)),
        ].join(""), "I/O")}
        ${panel("Skills", [
          pill("LIBRARY", boolLabel(skills.available), skills.available),
          pill("CATALOG", skills.catalog_count || 0, Number(skills.catalog_count || 0) > 0),
          pill("ACTIVE", (skills.active || []).length, (skills.active || []).length > 0),
          pill("LAST", lastSkillDecision?.selected_skill || "none", Boolean(lastSkillDecision?.selected_skill)),
        ].join(""), "ARBITER")}
        ${panel("Memory", [
          pill("VAULT", boolLabel(researchVault.available), researchVault.available),
          pill("NOTES", notes.active_topic || "none", Boolean(notes.active_topic)),
          pill("NOTEPAD", boolLabel(notes.pending_notepad_summary), notes.pending_notepad_summary),
          pathLine("LOG", researchVault.active_path),
        ].join(""), "AUDIT")}
        ${panel("Services", [
          pill("MODE", services.mode || "local_manifest_required", true),
          pill("DOMAINS", serviceItems.length, serviceItems.length > 0),
          pathLine("MANIFEST", services.manifest_path),
        ].join(""), "LOCAL")}
      </div>
    `;
  }

  function render() {
    const status = state.status || {};
    const substrate = status.substrate || {};
    const acp = status.acp_io || {};
    const researchVault = status.research_vault || {};
    const skills = status.skills || {};
    const notes = status.notes || {};
    const services = status.services || { domains };
    const serviceDomains = services.domains || domains;
    const serviceItems = services.items || serviceDomains.map((domain) => ({ id: domain, domain }));
    const bridgePending = status.pending || status.ready === false;
    const bridgeState = status.error ? "ERROR" : bridgePending ? "STARTING" : status.running ? "CONNECTED" : "WAITING";
    const lastSkillDecision = skills.last_decision || null;

    root.innerHTML = `
      <style>
        #substrate-dock-extension {
          background: #020712;
          border-bottom: 1px solid rgba(0,229,255,.24);
          color: #e0f7fa;
          font-family: "Courier New", monospace;
          padding: 8px 16px 10px;
          max-height: 310px;
          overflow: auto;
          position: relative;
          z-index: 2;
        }
        .substrate-tab-shell {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 8px;
        }
        .substrate-title {
          display: flex;
          align-items: baseline;
          gap: 10px;
          min-width: 220px;
          color: #00e5ff;
          font-size: 12px;
          letter-spacing: 2px;
          text-transform: uppercase;
        }
        .substrate-title b {
          color: #00e676;
          font-size: 9px;
          letter-spacing: 1px;
        }
        .substrate-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          justify-content: flex-end;
        }
        .substrate-tabs button,
        .substrate-actions button {
          border: 1px solid rgba(0,229,255,.28);
          border-radius: 4px;
          background: rgba(0,229,255,.08);
          color: #b2ebf2;
          font-family: inherit;
          font-size: 9px;
          padding: 4px 8px;
          cursor: pointer;
        }
        .substrate-tabs button.active {
          border-color: rgba(0,230,118,.75);
          background: rgba(0,230,118,.16);
          color: #00e676;
        }
        .substrate-grid {
          display: grid;
          gap: 10px;
        }
        .substrate-grid.two { grid-template-columns: repeat(2, minmax(260px, 1fr)); }
        .substrate-grid.three { grid-template-columns: repeat(3, minmax(220px, 1fr)); }
        .substrate-grid.five { grid-template-columns: repeat(5, minmax(160px, 1fr)); }
        .substrate-panel {
          border: 1px solid rgba(0,229,255,.22);
          border-radius: 8px;
          background: rgba(0,10,25,.58);
          padding: 9px;
          min-height: 92px;
        }
        .substrate-panel-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          margin-bottom: 6px;
          border-bottom: 1px solid rgba(255,255,255,.08);
          padding-bottom: 5px;
        }
        .substrate-panel h2 {
          margin: 0;
          font-size: 10px;
          letter-spacing: 1.2px;
          color: #00e5ff;
          text-transform: uppercase;
        }
        .substrate-panel-head span {
          color: #00e676;
          font-size: 8px;
          letter-spacing: .8px;
        }
        .substrate-pill {
          display: flex;
          justify-content: space-between;
          gap: 8px;
          padding: 3px 0;
          border-bottom: 1px solid rgba(255,255,255,.05);
          font-size: 9px;
        }
        .substrate-pill span,
        .substrate-path span {
          color: rgba(255,255,255,.48);
        }
        .substrate-pill b {
          font-size: 9px;
          font-weight: 700;
          text-align: right;
        }
        .substrate-path {
          display: grid;
          gap: 3px;
          margin: 6px 0;
          font-size: 9px;
        }
        .substrate-path code {
          color: #b2ebf2;
          word-break: break-all;
          white-space: normal;
          font-size: 9px;
        }
        .substrate-list {
          display: grid;
          gap: 3px;
          margin-top: 5px;
          max-height: 154px;
          overflow: auto;
        }
        .substrate-list > div {
          font-size: 9px;
          color: #b2ebf2;
          border-bottom: 1px solid rgba(255,255,255,.05);
          padding-bottom: 3px;
        }
        .substrate-service-row {
          display: grid;
          gap: 5px;
        }
        .substrate-actions {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
        }
        .substrate-actions button {
          font-size: 8px;
          padding: 3px 5px;
        }
        .substrate-footer {
          font-size: 9px;
          color: rgba(255,255,255,.42);
          margin-top: 7px;
        }
        @media (max-width: 1180px) {
          .substrate-grid.five,
          .substrate-grid.three { grid-template-columns: repeat(2, minmax(220px, 1fr)); }
        }
        @media (max-width: 720px) {
          .substrate-tab-shell { align-items: flex-start; flex-direction: column; }
          .substrate-grid.five,
          .substrate-grid.three,
          .substrate-grid.two { grid-template-columns: 1fr; }
        }
      </style>
      ${renderTabBar(bridgeState)}
      ${renderTabContent({
        acp,
        bridgeState,
        lastSkillDecision,
        notes,
        researchVault,
        services,
        serviceItems,
        skills,
        status,
        substrate,
      })}
      <div class="substrate-footer">
        Last bridge event: ${esc(state.lastBridgeType)} | Updated: ${esc(state.updatedAt || "waiting")}
      </div>
    `;
  }

  async function refresh() {
    const api = window.electronAPI;
    if (!api || typeof api.getOrbStatus !== "function") {
      state.updatedAt = "electronAPI unavailable";
      render();
      return;
    }
    try {
      state.status = await api.getOrbStatus();
      state.updatedAt = new Date().toLocaleTimeString();
    } catch (error) {
      state.status = { ...(state.status || {}), ready: false, pending: true, error: error?.message || String(error) };
      state.updatedAt = new Date().toLocaleTimeString();
    }
    render();
  }

  render();
  refresh();
  setInterval(refresh, 5000);

  const api = window.electronAPI;
  if (api && typeof api.onOrbBridgeMessage === "function") {
    api.onOrbBridgeMessage((_event, message) => {
      state.lastBridgeType = message?.type || "unknown";
      if (message?.type === "status_response" && message.data) {
        state.status = message.data;
        state.updatedAt = new Date().toLocaleTimeString();
      }
      if (message?.type === "research_result") {
        state.lastResearch = message;
      }
      if (message?.type === "skill_result") {
        state.lastSkill = message;
      }
      render();
    });
  }

  if (api && typeof api.onOrbStatusChange === "function") {
    api.onOrbStatusChange((_event, status) => {
      if (status && typeof status === "object") {
        state.status = { ...(state.status || {}), ...status };
        state.updatedAt = new Date().toLocaleTimeString();
        render();
      }
    });
  }

  root.addEventListener("click", async (event) => {
    const tabButton = event.target.closest("button[data-substrate-tab]");
    if (tabButton) {
      state.activeTab = tabButton.getAttribute("data-substrate-tab") || "overview";
      localStorage.setItem(TAB_KEY, state.activeTab);
      render();
      return;
    }

    const button = event.target.closest("button[data-service-id]");
    if (!button) return;
    const api = window.electronAPI;
    if (!api || typeof api.serviceControl !== "function") {
      state.lastService = { status: "error", error: "serviceControl unavailable" };
      render();
      return;
    }
    const serviceId = button.getAttribute("data-service-id");
    const action = button.getAttribute("data-service-action") || "status";
    try {
      const result = await api.serviceControl(serviceId, action);
      state.lastService = result;
      if (action === "open" && result?.url && typeof api.openSearch === "function") {
        await api.openSearch(result.url, "web");
      }
    } catch (error) {
      state.lastService = {
        status: "error",
        action,
        service_id: serviceId,
        error: error?.message || String(error),
      };
    }
    render();
  });
})();
