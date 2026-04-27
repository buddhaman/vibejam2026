import { createStreamedMusicTrack, resumeAudioOnUserGesture, type StreamedMusicTrack } from "./audio-mixer.js";
import { publicAssetUrl } from "./asset-url.js";

const THEME_URL = publicAssetUrl("audio/bgm/agi_theme.ogg");
/** Extra headroom on the music bus so the loop stays under battle‑cry peaks when they overlap. */
const THEME_INNER = 0.3;

type BgmState = "off" | "loading" | "on";

let state: BgmState = "off";
let track: StreamedMusicTrack | null = null;

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
      if (!track) track = createStreamedMusicTrack(THEME_URL, THEME_INNER);
      const ctx = track.gain.context;
      if (ctx.state !== "running") {
        state = "off";
        return;
      }
      const started = await track.play();
      if (!started) {
        state = "off";
        return;
      }
      state = "on";
    } catch {
      state = "off";
    }
  })();
}
