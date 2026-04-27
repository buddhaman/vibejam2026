import { getDecodedBufferFromUrl, getMusicGainNodeForRouting, resumeAudioOnUserGesture } from "./audio-mixer.js";
import { publicAssetUrl } from "./asset-url.js";

const THEME_URL = publicAssetUrl("audio/bgm/agi_theme.ogg");
/** Extra headroom on the music bus so the loop stays under battle‑cry peaks when they overlap. */
const THEME_INNER = 0.3;

type BgmState = "off" | "loading" | "on";

let state: BgmState = "off";

/**
 * Call each frame. Starts a single looping main theme the first time the
 * `AudioContext` is running; respects the same music fader and mute as battle audio.
 */
export function updateThemeBgm(): void {
  if (state === "on" || state === "loading") return;
  state = "loading";
  void (async () => {
    try {
      resumeAudioOnUserGesture();
      const bus = getMusicGainNodeForRouting();
      const ctx = bus.context;
      if (ctx.state === "suspended") {
        state = "off";
        return;
      }
      const buf = await getDecodedBufferFromUrl(THEME_URL);
      if (!buf) {
        state = "off";
        return;
      }
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      const g = ctx.createGain();
      g.gain.value = THEME_INNER;
      s.connect(g);
      g.connect(bus);
      s.start(0);
      state = "on";
    } catch {
      state = "off";
    }
  })();
}
