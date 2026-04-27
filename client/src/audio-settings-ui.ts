import "./audio-settings-ui.css";
import {
  getMusicLevel01,
  getSfxLevel01,
  isMusicMuted,
  isSfxMuted,
  resumeAudioOnUserGesture,
  setMusicLevel01,
  setMusicMuted,
  setSfxLevel01,
  setSfxMuted,
} from "./audio-mixer.js";

let uiMounted = false;

/**
 * Injects a fixed HTML layer: small gear (top-left) and a real popover for SFX / music.
 * Safe to call once; subsequent calls are no-ops.
 */
export function createAudioSettingsUi(): void {
  if (uiMounted) return;
  if (typeof document === "undefined") return;
  uiMounted = true;

  const root = document.createElement("div");
  root.className = "audio-settings-layer";
  root.setAttribute("data-audio-ui", "1");

  const backdrop = document.createElement("div");
  backdrop.className = "audio-settings-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  const dock = document.createElement("div");
  dock.className = "audio-settings-dock";

  const gear = document.createElement("button");
  gear.type = "button";
  gear.className = "audio-settings-gear";
  gear.title = "Audio & settings";
  gear.setAttribute("aria-label", "Open audio settings");
  gear.setAttribute("aria-haspopup", "dialog");
  gear.setAttribute("aria-expanded", "false");
  gear.innerHTML = '<span class="as-gear-icon" aria-hidden="true">⚙</span>';

  const pop = document.createElement("div");
  pop.className = "audio-settings-popover";
  pop.setAttribute("role", "dialog");
  pop.setAttribute("aria-label", "Audio");
  pop.setAttribute("aria-modal", "true");
  pop.hidden = true;

  pop.innerHTML = `
    <div class="as-popover-head">
      <h2>Audio</h2>
      <button type="button" class="as-popover-close" aria-label="Close" data-as-close>×</button>
    </div>
    <div class="as-popover-body">
      <p class="as-hint">SFX: unit barks. Music: main theme, battle atmosphere — both on the same bus.</p>
      <div class="as-row">
        <label for="as-sfx">SFX</label>
        <input type="range" id="as-sfx" name="sfx" min="0" max="1" step="0.01" />
        <label class="as-mute as-mute-sfx" title="Mute SFX">
          <input type="checkbox" id="as-sfx-m" />
          <span>Mute</span>
        </label>
      </div>
      <div class="as-row as-row--music">
        <label for="as-mu">Music</label>
        <input type="range" id="as-mu" name="music" min="0" max="1" step="0.01" />
        <label class="as-mute as-mute-mu" title="Mute music bus">
          <input type="checkbox" id="as-mu-m" />
          <span>Mute</span>
        </label>
      </div>
    </div>
  `;

  dock.appendChild(gear);
  dock.appendChild(pop);
  root.appendChild(backdrop);
  root.appendChild(dock);
  document.body.appendChild(root);

  const sRange = pop.querySelector<HTMLInputElement>("#as-sfx");
  const mRange = pop.querySelector<HTMLInputElement>("#as-mu");
  const sMute = pop.querySelector<HTMLInputElement>("#as-sfx-m");
  const mMute = pop.querySelector<HTMLInputElement>("#as-mu-m");
  const closeEl = pop.querySelector<HTMLButtonElement>("[data-as-close]");

  if (!sRange || !mRange || !sMute || !mMute || !closeEl) {
    return;
  }

  function pullFromModel(): void {
    sRange.value = String(getSfxLevel01());
    mRange.value = String(getMusicLevel01());
    sMute.checked = isSfxMuted();
    mMute.checked = isMusicMuted();
  }

  function isOpen(): boolean {
    return !pop.hidden;
  }

  function setOpen(v: boolean): void {
    pop.hidden = !v;
    gear.setAttribute("aria-expanded", v ? "true" : "false");
    backdrop.setAttribute("aria-hidden", v ? "false" : "true");
    if (v) {
      pullFromModel();
    }
  }

  function onGearClick(ev: Event): void {
    ev.stopPropagation();
    ev.preventDefault();
    resumeAudioOnUserGesture();
    setOpen(!isOpen());
  }

  function onBackdropClick(ev: Event): void {
    if (isOpen() && ev.target === backdrop) {
      setOpen(false);
    }
  }

  function onCloseClick(ev: Event): void {
    ev.stopPropagation();
    setOpen(false);
  }

  sRange.addEventListener("input", () => {
    setSfxLevel01(Number.parseFloat(sRange.value));
  });
  mRange.addEventListener("input", () => {
    setMusicLevel01(Number.parseFloat(mRange.value));
  });
  sMute.addEventListener("change", () => {
    setSfxMuted(sMute.checked);
    pullFromModel();
  });
  mMute.addEventListener("change", () => {
    setMusicMuted(mMute.checked);
    pullFromModel();
  });

  gear.addEventListener("click", onGearClick);
  backdrop.addEventListener("click", onBackdropClick);
  closeEl.addEventListener("click", onCloseClick);
  pop.addEventListener("click", (e) => e.stopPropagation());
  pop.addEventListener("pointerdown", (e) => e.stopPropagation());

  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && isOpen()) {
        e.preventDefault();
        setOpen(false);
      }
    },
    true
  );
}
