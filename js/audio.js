// audio.js — סאונד שנוצר בקוד (בלי קבצים): רוח שמתחזקת עם המהירות,
// ורעש "חריצה" של המגלשיים בשלג שמתחזק בפניות ובבלימות.

export class SkiAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    // רעש לבן באורך 2 שניות שחוזר בלופ
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(ctx.destination);

    // רוח
    const wind = ctx.createBufferSource();
    wind.buffer = buf;
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.master);
    wind.start();

    // מגלשיים על השלג
    const carve = ctx.createBufferSource();
    carve.buffer = buf;
    carve.loop = true;
    this.carveFilter = ctx.createBiquadFilter();
    this.carveFilter.type = 'bandpass';
    this.carveFilter.Q.value = 0.7;
    this.carveFilter.frequency.value = 1000;
    this.carveGain = ctx.createGain();
    this.carveGain.gain.value = 0;
    carve.connect(this.carveFilter).connect(this.carveGain).connect(this.master);
    carve.start(0, 0.7);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend();
      else ctx.resume();
    });
  }

  update(speed, grounded, skid) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(1, speed / 35);
    this.windGain.gain.setTargetAtTime(sp * sp * 0.45, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 45, t, 0.15);
    const carve = grounded ? Math.min(0.5, sp * 0.18 + skid * 0.45 * Math.min(1, speed / 8)) : 0;
    this.carveGain.gain.setTargetAtTime(carve, t, 0.06);
    this.carveFilter.frequency.setTargetAtTime(700 + speed * 25 + skid * 1600, t, 0.08);
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
}
