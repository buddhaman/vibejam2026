import type { Game } from "./game.js";

type ChatUi = {
  update: () => void;
  destroy: () => void;
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const css = (strings: TemplateStringsArray, ...values: unknown[]) =>
  strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "").trim();

export function createChatUi(game: Game, getBottomInset: () => number): ChatUi {
  // ── Toggle button — sits inside the bottom bar on the left ────
  const toggleBtn = document.createElement("button");
  toggleBtn.type = "button";
  toggleBtn.setAttribute("aria-label", "Toggle chat");
  // Matches the bottom bar's lapis style + gold border like the BUILD button
  toggleBtn.style.cssText = css`
    position:fixed;
    left:8px;
    bottom:14px;
    z-index:32;
    width:34px;
    height:34px;
    border-radius:3px;
    border:1px solid #C9911E;
    background:rgba(10,20,42,0.90);
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    touch-action:manipulation;
    transition:border-color 0.15s,background 0.15s;
    padding:0;
  `;
  toggleBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F0C060" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block;flex-shrink:0;">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`;

  // Unread badge on the toggle button
  const badge = document.createElement("span");
  badge.style.cssText = css`
    display:none;
    position:absolute;
    top:-5px;
    right:-5px;
    min-width:16px;
    height:16px;
    padding:0 4px;
    border-radius:8px;
    background:#c9611e;
    color:#fff;
    font:700 9px/16px system-ui;
    text-align:center;
    pointer-events:none;
  `;
  toggleBtn.appendChild(badge);

  // ── Panel — opens above the bottom bar ────────────────────────
  const panel = document.createElement("div");
  panel.style.cssText = css`
    position:fixed;
    left:8px;
    bottom:76px;
    z-index:31;
    width:min(340px, calc(100vw - 16px));
    max-height:min(70vh, 480px);
    background:rgba(6,14,26,0.94);
    border:1px solid rgba(214,185,112,0.28);
    border-radius:16px;
    box-shadow:0 20px 60px rgba(0,0,0,0.55);
    backdrop-filter:blur(14px);
    display:flex;
    flex-direction:column;
    overflow:hidden;
    transform:translateY(12px) scale(0.97);
    opacity:0;
    pointer-events:none;
    transition:transform 0.22s cubic-bezier(0.34,1.56,0.64,1),opacity 0.18s ease;
    transform-origin:bottom left;
  `;

  // ── Header ─────────────────────────────────────────────────────
  const header = document.createElement("div");
  header.style.cssText = css`
    display:flex;
    align-items:center;
    justify-content:space-between;
    padding:13px 15px 11px;
    border-bottom:1px solid rgba(214,185,112,0.14);
    flex-shrink:0;
  `;

  const headerTitle = document.createElement("span");
  headerTitle.textContent = "Chat";
  headerTitle.style.cssText = "font:700 13px 'Cinzel',serif;letter-spacing:0.1em;color:#f2edd7;text-transform:uppercase;";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  closeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="#a09070" stroke-width="2" stroke-linecap="round"><line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/></svg>`;
  closeBtn.style.cssText = css`
    border:none;
    background:transparent;
    cursor:pointer;
    padding:5px;
    display:flex;
    align-items:center;
    justify-content:center;
    opacity:0.65;
    touch-action:manipulation;
    border-radius:6px;
    transition:opacity 0.15s;
  `;

  header.append(headerTitle, closeBtn);

  // ── Identity row ───────────────────────────────────────────────
  const identityRow = document.createElement("div");
  identityRow.style.cssText = css`
    display:flex;
    align-items:center;
    gap:8px;
    padding:9px 15px;
    border-bottom:1px solid rgba(214,185,112,0.1);
    background:rgba(255,255,255,0.02);
    flex-shrink:0;
  `;

  const identityIcon = document.createElement("span");
  identityIcon.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#8a7a5a" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
  identityIcon.style.cssText = "display:flex;align-items:center;flex-shrink:0;opacity:0.7;";

  const nameDisplay = document.createElement("span");
  nameDisplay.style.cssText = css`
    flex:1;
    font:600 12px 'Cinzel',serif;
    letter-spacing:0.04em;
    color:#c9a84c;
    overflow:hidden;
    text-overflow:ellipsis;
    white-space:nowrap;
  `;

  const editNameBtn = document.createElement("button");
  editNameBtn.type = "button";
  editNameBtn.setAttribute("aria-label", "Change name");
  editNameBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#a09070" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`;
  editNameBtn.style.cssText = css`
    border:none;
    background:transparent;
    cursor:pointer;
    padding:6px;
    display:flex;
    align-items:center;
    justify-content:center;
    opacity:0.65;
    touch-action:manipulation;
    border-radius:6px;
    flex-shrink:0;
    transition:opacity 0.15s;
  `;

  identityRow.append(identityIcon, nameDisplay, editNameBtn);

  // ── Name editor (hidden by default) ───────────────────────────
  const nameEditor = document.createElement("div");
  nameEditor.style.cssText = css`
    display:none;
    flex-direction:column;
    gap:9px;
    padding:12px 15px 14px;
    border-bottom:1px solid rgba(214,185,112,0.12);
    background:rgba(30,18,6,0.35);
    flex-shrink:0;
  `;

  const nameEditorLabel = document.createElement("div");
  nameEditorLabel.textContent = "Change your name";
  nameEditorLabel.style.cssText = "font:600 10px 'Cinzel',serif;letter-spacing:0.08em;color:#8a7a5a;text-transform:uppercase;";

  const nameEditorRow = document.createElement("div");
  nameEditorRow.style.cssText = "display:flex;gap:8px;";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 20;
  nameInput.placeholder = "Enter a name…";
  nameInput.autocomplete = "off";
  nameInput.spellcheck = false;
  nameInput.style.cssText = css`
    flex:1;
    min-width:0;
    padding:9px 11px;
    border-radius:9px;
    border:1px solid rgba(212,175,94,0.28);
    background:rgba(255,255,255,0.06);
    color:#f2edd7;
    font:500 13px system-ui;
    outline:none;
    transition:border-color 0.15s;
    -webkit-appearance:none;
  `;

  const nameSaveBtn = document.createElement("button");
  nameSaveBtn.type = "button";
  nameSaveBtn.textContent = "Save";
  nameSaveBtn.style.cssText = css`
    padding:9px 14px;
    border-radius:9px;
    border:1px solid rgba(212,175,94,0.4);
    background:rgba(201,145,30,0.22);
    color:#f0d080;
    font:700 11px 'Cinzel',serif;
    letter-spacing:0.06em;
    cursor:pointer;
    white-space:nowrap;
    touch-action:manipulation;
    transition:background 0.15s;
  `;

  nameEditorRow.append(nameInput, nameSaveBtn);
  nameEditor.append(nameEditorLabel, nameEditorRow);

  // ── Chat log ───────────────────────────────────────────────────
  const log = document.createElement("div");
  log.style.cssText = css`
    flex:1;
    overflow-y:auto;
    padding:10px 15px;
    display:flex;
    flex-direction:column;
    gap:8px;
    min-height:60px;
    scroll-behavior:smooth;
    overscroll-behavior:contain;
  `;

  const emptyState = document.createElement("div");
  emptyState.textContent = "No messages yet";
  emptyState.style.cssText = "font:12px system-ui;color:rgba(242,237,215,0.28);text-align:center;padding:18px 0;";
  log.append(emptyState);

  // ── Chat input row ─────────────────────────────────────────────
  const chatRow = document.createElement("div");
  chatRow.style.cssText = css`
    display:flex;
    gap:8px;
    padding:10px 12px 13px;
    border-top:1px solid rgba(214,185,112,0.12);
    flex-shrink:0;
    background:rgba(0,0,0,0.1);
  `;

  const chatInput = document.createElement("input");
  chatInput.type = "text";
  chatInput.maxLength = 280;
  chatInput.placeholder = "Send a message…";
  chatInput.autocomplete = "off";
  chatInput.spellcheck = false;
  chatInput.style.cssText = nameInput.style.cssText;

  const sendBtn = document.createElement("button");
  sendBtn.type = "button";
  sendBtn.setAttribute("aria-label", "Send");
  sendBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f0d080" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>`;
  sendBtn.style.cssText = css`
    width:42px;
    height:42px;
    flex-shrink:0;
    border-radius:10px;
    border:1px solid rgba(212,175,94,0.38);
    background:rgba(201,145,30,0.2);
    cursor:pointer;
    display:flex;
    align-items:center;
    justify-content:center;
    touch-action:manipulation;
    transition:background 0.15s;
    padding:0;
  `;

  chatRow.append(chatInput, sendBtn);

  panel.append(header, identityRow, nameEditor, log, chatRow);
  document.body.append(toggleBtn, panel);

  // ── State ──────────────────────────────────────────────────────
  let panelOpen = false;
  let nameEditorOpen = false;
  let lastRenderedKey = "";
  let lastKnownName = "";
  let unreadCount = 0;
  let lastSeenFeedLength = 0;
  let lastBottomInset = -1;

  function syncPosition(): void {
    const inset = Math.max(78, getBottomInset());
    if (Math.abs(inset - lastBottomInset) < 1) return;
    lastBottomInset = inset;
    toggleBtn.style.bottom = `${Math.round(inset + 10)}px`;
    panel.style.bottom = `${Math.round(inset + 56)}px`;
  }

  function openPanel() {
    syncPosition();
    panelOpen = true;
    panel.style.transform = "translateY(0) scale(1)";
    panel.style.opacity = "1";
    panel.style.pointerEvents = "auto";
    toggleBtn.style.borderColor = "#C9911E";
    toggleBtn.style.background = "#C9911E";
    const svg = toggleBtn.querySelector("svg");
    if (svg) svg.setAttribute("stroke", "#08102A");
    // Clear unread
    unreadCount = 0;
    badge.style.display = "none";
    badge.textContent = "";
    requestAnimationFrame(() => { log.scrollTop = log.scrollHeight; });
  }

  function closePanel() {
    panelOpen = false;
    panel.style.transform = "translateY(12px) scale(0.97)";
    panel.style.opacity = "0";
    panel.style.pointerEvents = "none";
    toggleBtn.style.borderColor = "#C9911E";
    toggleBtn.style.background = "rgba(10,20,42,0.90)";
    const svg = toggleBtn.querySelector("svg");
    if (svg) svg.setAttribute("stroke", "#F0C060");
    closeNameEditor();
  }

  function openNameEditor() {
    nameEditorOpen = true;
    nameEditor.style.display = "flex";
    nameInput.value = game.getMyPlayerName();
    editNameBtn.style.opacity = "1";
    requestAnimationFrame(() => nameInput.focus());
  }

  function closeNameEditor() {
    nameEditorOpen = false;
    nameEditor.style.display = "none";
    editNameBtn.style.opacity = "0.65";
  }

  function submitRename() {
    const v = nameInput.value.trim();
    if (!v) return;
    game.sendRename(v);
    closeNameEditor();
  }

  function submitChat() {
    const v = chatInput.value.trim();
    if (!v) return;
    game.sendChat(v);
    chatInput.value = "";
  }

  // ── Events ─────────────────────────────────────────────────────
  toggleBtn.addEventListener("click", () => {
    if (panelOpen) closePanel(); else openPanel();
  });

  closeBtn.addEventListener("click", closePanel);

  editNameBtn.addEventListener("click", () => {
    if (!panelOpen) openPanel();
    if (nameEditorOpen) closeNameEditor(); else openNameEditor();
  });

  nameSaveBtn.addEventListener("click", submitRename);
  sendBtn.addEventListener("click", submitChat);

  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitRename(); }
    if (e.key === "Escape") { e.preventDefault(); closeNameEditor(); }
  });

  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); submitChat(); }
    if (e.key === "Escape") { e.preventDefault(); chatInput.blur(); closePanel(); }
  });

  const onWindowKeyDown = (e: KeyboardEvent) => {
    const active = document.activeElement;
    const typingInField = active === nameInput || active === chatInput;
    if (e.key === "Enter" && !typingInField) {
      e.preventDefault();
      if (!panelOpen) openPanel();
      requestAnimationFrame(() => chatInput.focus());
    }
  };
  window.addEventListener("keydown", onWindowKeyDown);

  // Prevent game from receiving pointer events that land on the panel/button
  panel.addEventListener("pointerdown", (e) => e.stopPropagation());
  toggleBtn.addEventListener("pointerdown", (e) => e.stopPropagation());

  return {
    update() {
      syncPosition();
      // Sync name display
      const currentName = game.getMyPlayerName();
      if (currentName !== lastKnownName) {
        lastKnownName = currentName;
        nameDisplay.textContent = currentName || "Anonymous";
        if (document.activeElement !== nameInput) {
          nameInput.value = currentName;
        }
      }

      // Sync feed
      const feed = game.getUiFeed();
      const renderKey = feed.map((e) => e.id).join("|");
      if (renderKey === lastRenderedKey) return;
      lastRenderedKey = renderKey;

      // Track unread messages
      if (!panelOpen && feed.length > lastSeenFeedLength) {
        unreadCount += feed.length - lastSeenFeedLength;
        badge.textContent = unreadCount > 9 ? "9+" : String(unreadCount);
        badge.style.display = "block";
      }
      lastSeenFeedLength = feed.length;

      // Re-render log
      log.innerHTML = "";
      const entries = feed.slice(-24);
      if (entries.length === 0) {
        log.append(emptyState);
        return;
      }

      for (const entry of entries) {
        const line = document.createElement("div");

        if (entry.type === "system") {
          line.style.cssText = "font:italic 11px system-ui;color:rgba(159,211,255,0.68);padding:1px 0;line-height:1.45;";
          line.textContent = entry.text;
        } else {
          line.style.cssText = "display:flex;flex-direction:column;gap:2px;";

          const isMine = entry.senderId === game.room.sessionId;
          const sender = isMine ? "You" : entry.senderName;

          const meta = document.createElement("span");
          meta.style.cssText = `font:700 9px 'Cinzel',serif;letter-spacing:0.06em;text-transform:uppercase;color:${isMine ? "#d4af5e" : "#8fc8ff"};`;
          meta.textContent = `${sender} · ${fmtTime(entry.sentAt)}`;

          const text = document.createElement("span");
          text.style.cssText = "font:13px/1.45 system-ui;color:#f2edd7;word-break:break-word;";
          text.textContent = entry.text;

          line.append(meta, text);
        }

        log.append(line);
      }

      if (panelOpen) {
        log.scrollTop = log.scrollHeight;
      }
    },

    destroy() {
      window.removeEventListener("keydown", onWindowKeyDown);
      toggleBtn.remove();
      panel.remove();
    },
  };
}
