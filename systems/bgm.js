function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

const BASE_TRACKS = {
  micro: "./bgm/宇宙.mp3",
  spring: "./bgm/春.mp3",
  summer: "./bgm/夏.mp3",
  autumn: "./bgm/秋.mp3",
  winter: "./bgm/冬.mp3",
};

const OVERLAY_TRACKS = {
  rainy: "./bgm/雨.mp3",
  snowy: "./bgm/雪.mp3",
  drought: "./bgm/日照り.mp3",
};

const SFX_TRACKS = {
  reincarnate: "./bgm/転生.mp3",
};

function createChannel() {
  const audio = new Audio();
  audio.loop = true;
  audio.preload = "auto";
  audio.volume = 0;
  return {
    audio,
    currentId: null,
    pendingId: null,
    gain: 0,
  };
}

export class BgmManager {
  constructor({ fadeSeconds = 1.0, overlayVolumeMul = 0.3, volume01 = 0.7 } = {}) {
    this.fadeSeconds = Math.max(0.05, Number(fadeSeconds) || 1);
    this.overlayVolumeMul = clamp01(overlayVolumeMul);
    this.volume01 = clamp01(volume01);
    this.unlocked = false;
    this.base = createChannel();
    this.overlay = createChannel();
    this.desiredBaseId = null;
    this.desiredOverlayId = null;
  }

  setVolume01(nextVolume) {
    this.volume01 = clamp01(nextVolume);
  }

  unlock() {
    this.unlocked = true;
    this._ensurePlaying(this.base);
    this._ensurePlaying(this.overlay);
  }

  playSfx(id, volumeMul = 1) {
    if (!this.unlocked) return;
    const src = SFX_TRACKS[id];
    if (!src) return;
    try {
      const audio = new Audio(src);
      audio.preload = "auto";
      audio.loop = false;
      audio.volume = clamp01(this.volume01 * Math.max(0, Number(volumeMul) || 0));
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
    } catch {
      // ignore autoplay / decode failures
    }
  }

  sync({ viewMode, seasonKind, weatherKind } = {}) {
    if (viewMode === "micro") {
      this.desiredBaseId = "micro";
      this.desiredOverlayId = null;
      return;
    }

    const season = String(seasonKind || "").toLowerCase();
    if (season === "spring" || season === "summer" || season === "autumn" || season === "winter") {
      this.desiredBaseId = season;
    } else {
      this.desiredBaseId = "spring";
    }

    const weather = String(weatherKind || "").toLowerCase();
    this.desiredOverlayId = weather === "rainy" || weather === "snowy" || weather === "drought" ? weather : null;
  }

  update(dt) {
    const delta = Math.max(0, Number(dt) || 0);
    this._stepChannel(this.base, this.desiredBaseId, this.volume01, BASE_TRACKS, delta);
    this._stepChannel(this.overlay, this.desiredOverlayId, this.volume01 * this.overlayVolumeMul, OVERLAY_TRACKS, delta);
  }

  _stepChannel(channel, desiredId, desiredGain, trackMap, dt) {
    const audio = channel.audio;
    const targetId = desiredId && trackMap[desiredId] ? desiredId : null;

    if (targetId == null) {
      channel.pendingId = null;
      channel.gain = this._approach(channel.gain, 0, dt);
      audio.volume = clamp01(channel.gain);
      if (channel.gain <= 0.0001 && channel.currentId != null) {
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
        channel.currentId = null;
      }
      return;
    }

    if (channel.currentId == null) {
      this._swapTrack(channel, targetId, trackMap);
    } else if (channel.currentId !== targetId) {
      channel.pendingId = targetId;
      channel.gain = this._approach(channel.gain, 0, dt);
      audio.volume = clamp01(channel.gain);
      if (channel.gain <= 0.0001) {
        this._swapTrack(channel, targetId, trackMap);
        channel.pendingId = null;
      }
      return;
    }

    channel.gain = this._approach(channel.gain, desiredGain, dt);
    audio.volume = clamp01(channel.gain);
    this._ensurePlaying(channel);
  }

  _swapTrack(channel, trackId, trackMap) {
    const src = trackMap[trackId];
    if (!src) return;
    const audio = channel.audio;
    channel.currentId = trackId;
    channel.gain = 0;
    audio.pause();
    audio.src = src;
    audio.currentTime = 0;
    audio.volume = 0;
    audio.load();
    this._ensurePlaying(channel);
  }

  _ensurePlaying(channel) {
    if (!this.unlocked) return;
    const audio = channel.audio;
    if (!audio.src) return;
    const shouldBeAudible = channel.gain > 0.0001 || channel.currentId != null;
    if (!shouldBeAudible) return;
    try {
      const playResult = audio.play();
      if (playResult && typeof playResult.catch === "function") {
        playResult.catch(() => {});
      }
    } catch {
      // ignore autoplay / decode failures
    }
  }

  _approach(current, target, dt) {
    const cur = clamp01(current);
    const dst = clamp01(target);
    if (cur === dst) return cur;
    const step = dt / this.fadeSeconds;
    if (cur < dst) return Math.min(dst, cur + step);
    return Math.max(dst, cur - step);
  }
}
