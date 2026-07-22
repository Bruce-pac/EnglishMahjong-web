/**
 * 音效。**用 Web Audio 实时合成，不加任何音频文件**——零体积、零版权风险
 * （这个仓库是开源的）、随时能微调。落牌声本质就是一段极短的滤波噪声，
 * 恰恰是合成最擅长的那类声音。
 *
 * 对外只有 `play(name)` 和静音开关这几个函数：哪天想换成真实麦将牌的采样，
 * 换掉这里的实现即可，调用方一行都不用动（ROADMAP.md v0.2）。
 */

export type SoundName = "deal" | "discard" | "chi" | "reveal" | "win" | "exhausted";

const STORAGE_KEY = "emj-sound";

/** 默认开。整体音量压得比较低——牌局里声音密集，吵了反而想关掉 */
const MASTER_GAIN = 0.32;

let muted = localStorage.getItem(STORAGE_KEY) === "off";
let ctx: AudioContext | null = null;
let noise: AudioBuffer | null = null;

export function isMuted() {
  return muted;
}

export function setMuted(next: boolean) {
  muted = next;
  localStorage.setItem(STORAGE_KEY, next ? "off" : "on");
}

/**
 * AudioContext 必须懒建：浏览器不允许在用户交互之前出声。
 * 这个游戏进牌局前必然点过按钮，所以第一次 play() 时创建总是合法的。
 */
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;   // 老浏览器没有 Web Audio：静默降级，不该因为没声音就崩
    ctx = new Ctor();
  }
  // 切后台再回来时 context 会被挂起，不 resume 就再也不出声了
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

/** 白噪声缓冲，建一次反复用 */
function noiseBuffer(ac: AudioContext): AudioBuffer {
  if (!noise) {
    const len = Math.floor(ac.sampleRate * 0.25);
    noise = ac.createBuffer(1, len, ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

interface ClackOpts {
  /** 带通中心频率：越高越清脆，越低越闷、越有分量 */
  freq: number;
  /** 衰减时长（秒）。真实牌声很短，长了就像敲鼓 */
  decay: number;
  gain: number;
  /** 低频「body」，给清脆的噪声垫一点厚度 */
  thump?: number;
  delay?: number;
}

/** 一次「牌撞桌面」：带通滤过的噪声爆发 + 一点低频身体感 */
function clack(ac: AudioContext, out: GainNode, o: ClackOpts) {
  const t = ac.currentTime + (o.delay ?? 0);

  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);

  const bp = ac.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = o.freq;
  bp.Q.value = 1.4;

  const env = ac.createGain();
  env.gain.setValueAtTime(o.gain, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + o.decay);

  src.connect(bp).connect(env).connect(out);
  src.start(t);
  src.stop(t + o.decay + 0.02);

  if (o.thump) {
    const osc = ac.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(o.thump, t);
    osc.frequency.exponentialRampToValueAtTime(o.thump * 0.6, t + 0.06);
    const g = ac.createGain();
    g.gain.setValueAtTime(o.gain * 0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.09);
  }
}

interface ToneOpts {
  freq: number;
  dur: number;
  gain: number;
  delay?: number;
  type?: OscillatorType;
  /** 滑到这个频率，做上扬/下沉 */
  to?: number;
}

function tone(ac: AudioContext, out: GainNode, o: ToneOpts) {
  const t = ac.currentTime + (o.delay ?? 0);
  const osc = ac.createOscillator();
  osc.type = o.type ?? "triangle";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);

  const g = ac.createGain();
  // 起音留 8ms 斜坡，直接给值会「啪」一声爆音
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);

  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

export function play(name: SoundName) {
  if (muted) return;
  const ac = audio();
  if (!ac) return;

  const out = ac.createGain();
  out.gain.value = MASTER_GAIN;
  out.connect(ac.destination);

  switch (name) {
    // 发牌：十来声又轻又碎的牌响叠在一起，就是码牌/洗牌那阵窸窣声。
    // 音高和间隔都随机，整齐划一反而假——真发牌不可能踩着节拍器。
    case "deal":
      for (let i = 0; i < 11; i++) {
        clack(ac, out, {
          freq: 1300 + Math.random() * 1300,
          decay: 0.045 + Math.random() * 0.03,
          gain: 0.3 + Math.random() * 0.2,
          delay: i * 0.042 + Math.random() * 0.025,
        });
      }
      break;

    // 打牌：干脆利落的一声，全场最高频，宁可轻也别吵
    case "discard":
      clack(ac, out, { freq: 2000, decay: 0.09, gain: 0.9, thump: 190 });
      break;

    // 吃牌：抢牌该有重量——两声叠在一起（抓起 + 放下），比打牌闷一点
    case "chi":
      clack(ac, out, { freq: 1500, decay: 0.07, gain: 0.55 });
      clack(ac, out, { freq: 1100, decay: 0.12, gain: 0.9, thump: 150, delay: 0.075 });
      break;

    // 亮词：上扬的两个音，成功感
    case "reveal":
      tone(ac, out, { freq: 660, dur: 0.1, gain: 0.22 });
      tone(ac, out, { freq: 990, dur: 0.16, gain: 0.22, delay: 0.09 });
      break;

    // 胡牌：大三和弦琶音 + 收尾的高八度，短促但要够喜庆
    case "win":
      [523.25, 659.25, 783.99].forEach((f, i) =>
        tone(ac, out, { freq: f, dur: 0.28, gain: 0.2, delay: i * 0.085 }),
      );
      tone(ac, out, { freq: 1046.5, dur: 0.5, gain: 0.24, delay: 0.26 });
      break;

    // 荒牌：低沉下沉音，收场但不悲情
    case "exhausted":
      tone(ac, out, { freq: 320, to: 160, dur: 0.5, gain: 0.2, type: "sine" });
      break;
  }
}
