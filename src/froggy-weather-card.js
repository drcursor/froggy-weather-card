// Froggy Weather Card: the weather frog scene (a background plus a Flare animation) that matches
// the current weather and time of day, for Home Assistant dashboards.
// https://github.com/drcursor/froggy-weather-card
//
// Artwork from github.com/R0rt1z2/Froggy, originally Google's; see the README. Rendered with a
// patched Flare-JS and CanvasKit. Every file sits next to this one (HACS serves them from
// /hacsfiles/froggy-weather-card/). The frog is drawn live with WebGL. Where the browser has no
// WebGL (or the renderer does not start), the scene plays as a pre-rendered video instead, cut
// portrait, landscape or square to match the card's shape, which is smooth even on slow smart
// displays. Where video cannot play either, the frog is drawn live in software; where even that
// cannot run (no WebAssembly) the card shows a still of the frog and a short note why.
//
// type: custom:froggy-weather-card
// entity: weather.x          (default: the first weather entity)
// sun: sun.sun               (default)
// scene: fields | hill | mushroom | random   (default fields; random picks one per scene change)
// show_weather: true         (weather over the scene)
// overlay: simple | nest     (simple: temperature and condition; nest: date, clock, now and the
//                             next days, as on a Google Nest Hub; default simple)
// forecast_days: 2           (nest: days after today)
// time_format: 24 | 12       (nest clock; default follows the Home Assistant profile)
// status_entity: sensor.x    (nest: one line under the clock with this sensor's text)
// status_ok_prefix: All good (status text starting with this is green with a check, else orange)
// icons: meteocons | mdi     (nest: colour Meteocons by Bas Milius, or plain Material Design icons)
// aspect_ratio: 1            (width / height)
// full_height: false         (true fills the window below the card's top, for a panel view)
// height: 30vh               (any CSS height; overrides aspect_ratio and full_height)
// border_radius: 0           (corner radius in px; default the theme's card radius)
// focus_y: 0.5               (which height of the square scene stays in view when cropped, 0 top to 1 bottom)
// video: auto | always | never  (pre-rendered videos: auto plays them only where WebGL is missing
//                             or fails; always plays them first; never draws live only; default auto)
// software_max_side: 800     (without WebGL: canvas size cap in px; lower is smoother)
// software_fps: 30           (without WebGL: frame rate cap)

const CARD_VERSION = "1.1.0";
const BASE = new URL(".", import.meta.url).href;
// The card's own ?v=, passed on so a new version also reloads the runtime scripts.
const VERSION = new URL(import.meta.url).search;
const SCENES = ["fields", "hill", "mushroom"];
const ANIMATION = "Hero-Action";

// The video cuts and the card shapes they cover without losing any of the square scene:
// portrait 1200x1920 (width / height 0.625 and narrower), landscape 1920x1200 (1.6 and wider),
// and the whole scene, 1080x1080, in between.
const VIDEO_PORTRAIT = 0.63;
const VIDEO_LANDSCAPE = 1.59;

// Software drawing costs CPU per pixel: cap its canvas size and frame rate (both settable).
const SOFTWARE_MAX_SIDE = 800;
const SOFTWARE_FPS = 30;

// Home Assistant weather states to Froggy conditions.
const CONDITIONS = {
  "clear-night": "sunny", sunny: "sunny",
  partlycloudy: "cloudy", cloudy: "cloudy", windy: "cloudy", "windy-variant": "cloudy", exceptional: "cloudy",
  fog: "hazy",
  rainy: "rainy", pouring: "rainy", lightning: "rainy", "lightning-rainy": "rainy", hail: "rainy",
  snowy: "snowy", "snowy-rainy": "snowy",
};

const LABELS = {
  "clear-night": "Clear", sunny: "Sunny", partlycloudy: "Partly cloudy", cloudy: "Cloudy",
  windy: "Windy", "windy-variant": "Windy", exceptional: "Exceptional", fog: "Fog",
  rainy: "Rain", pouring: "Heavy rain", lightning: "Thunderstorm", "lightning-rainy": "Thunderstorm",
  hail: "Hail", snowy: "Snow", "snowy-rainy": "Sleet",
};

// Home Assistant weather states to Material Design weather icons.
const ICONS = {
  "clear-night": "mdi:weather-night", sunny: "mdi:weather-sunny", partlycloudy: "mdi:weather-partly-cloudy",
  cloudy: "mdi:weather-cloudy", fog: "mdi:weather-fog", hail: "mdi:weather-hail", lightning: "mdi:weather-lightning",
  "lightning-rainy": "mdi:weather-lightning-rainy", pouring: "mdi:weather-pouring", rainy: "mdi:weather-rainy",
  snowy: "mdi:weather-snowy", "snowy-rainy": "mdi:weather-snowy-rainy", windy: "mdi:weather-windy",
  "windy-variant": "mdi:weather-windy-variant", exceptional: "mdi:alert-circle-outline",
};

// Home Assistant weather states to Meteocons files (meteocons-<name>.svg), day and night.
const METEOCONS = {
  "clear-night": ["clear-night", "clear-night"], sunny: ["clear-day", "clear-night"],
  partlycloudy: ["partly-cloudy-day", "partly-cloudy-night"], cloudy: ["cloudy", "cloudy"],
  fog: ["fog-day", "fog-night"], hail: ["hail", "hail"], lightning: ["thunderstorms", "thunderstorms"],
  "lightning-rainy": ["thunderstorms-rain", "thunderstorms-rain"], pouring: ["extreme-rain", "extreme-rain"],
  rainy: ["rain", "rain"], snowy: ["snow", "snow"], "snowy-rainy": ["sleet", "sleet"],
  windy: ["wind", "wind"], "windy-variant": ["wind", "wind"], exceptional: ["not-available", "not-available"],
};

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// Froggy's dayPartFor, with today's sunrise and sunset taken from sun.sun, which only
// carries the next ones.
function dayPart(sun, now = Date.now()) {
  const rising = Date.parse(sun?.attributes?.next_rising);
  const setting = Date.parse(sun?.attributes?.next_setting);
  if (isNaN(rising) || isNaN(setting)) {
    const h = new Date(now).getHours();
    if (h >= 6 && h < 9) return "morning";
    if (h >= 9 && h < 17) return "day";
    if (h >= 17 && h < 19) return "sunset";
    return "night";
  }
  if (sun.state === "above_horizon") {
    const sunrise = rising - DAY;
    if (now < sunrise + 150 * 60 * 1000) return "morning";
    if (now < setting - HOUR) return "day";
    return "sunset";
  }
  // Below the horizon: still in the sunset part for 30 minutes after the last sunset.
  if (now < setting - DAY + 30 * 60 * 1000) return "sunset";
  return "night";
}

let runtime = null;
let webgl = null;

// Whether the browser can draw with WebGL; without it the live drawing is software only.
function hasWebGL() {
  if (webgl === null) {
    try {
      const canvas = document.createElement("canvas");
      webgl = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
    } catch (err) {
      webgl = false;
    }
  }
  return webgl;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`could not load ${src}`));
    document.head.appendChild(s);
  });
}

// Flare and CanvasKit are classic scripts with globals; load them once for every card.
function loadRuntime() {
  if (!runtime) {
    runtime = (async () => {
      if (!window.CanvasKitInit) await loadScript(BASE + "canvaskit.js" + VERSION);
      if (!window.Flare) await loadScript(BASE + "Flare.min.js" + VERSION);
    })();
  }
  return runtime;
}

class FroggyCard extends HTMLElement {
  setConfig(config) {
    this._config = {
      sun: "sun.sun",
      scene: "fields",
      show_weather: true,
      aspect_ratio: 1,
      full_height: false,
      focus_y: 0.5,
      overlay: "simple",
      forecast_days: 2,
      icons: "meteocons",
      status_ok_prefix: "All good",
      software_max_side: SOFTWARE_MAX_SIDE,
      software_fps: SOFTWARE_FPS,
      video: "auto",
      ...config,
    };
    // true and false as in the first 1.1.0 build.
    if (this._config.video === true) this._config.video = "always";
    if (this._config.video === false) this._config.video = "never";
    if (this._config.scene !== "random" && !SCENES.includes(this._config.scene)) {
      throw new Error(`scene must be one of ${SCENES.join(", ")} or random`);
    }
    this._build();
  }

  set hass(hass) {
    this._hass = hass;
    this._subscribe();
    this._update();
  }

  // The nest overlay's days come from the weather entity's daily forecast, which Home Assistant
  // only hands out by subscription.
  _subscribe() {
    if (this._forecastSub || !this._hass?.connection || !this.isConnected) return;
    if (this._config.overlay !== "nest" || !this._config.show_weather) return;
    const entity = this._entity();
    this._forecastSub = this._hass.connection
      .subscribeMessage((msg) => {
        this._forecast = msg.forecast || [];
        this._renderNest();
      }, { type: "weather/subscribe_forecast", forecast_type: "daily", entity_id: entity })
      .catch((err) => {
        console.warn("froggy-card: no daily forecast for", entity, err);
        this._forecastSub = null;
      });
  }

  _unsubscribe() {
    const sub = this._forecastSub;
    this._forecastSub = null;
    sub?.then((unsub) => unsub && unsub()).catch(() => {});
  }

  _hour12() {
    const fmt = String(this._config.time_format ?? this._hass?.locale?.time_format ?? "");
    if (fmt === "12") return true;
    if (fmt === "24") return false;
    const lang = this._hass?.locale?.language || this._hass?.language || undefined;
    return new Intl.DateTimeFormat(lang, { hour: "numeric" }).resolvedOptions().hour12 === true;
  }

  // Home Assistant's own time zone, not the browser's: a display's browser can run on UTC
  // (LANovo's does), which put the clock an hour behind in Swiss winter time.
  _zone() {
    const zone = this._hass?.config?.time_zone;
    try {
      if (zone) new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone || undefined;
    } catch (err) {
      return undefined;
    }
  }

  // A calendar day in Home Assistant's time zone, for comparing dates.
  _day(date) {
    return date.toLocaleDateString("en-CA", { timeZone: this._zone() });
  }

  _renderClock() {
    if (!this._hass || this._nest.hidden) return;
    const lang = this._hass.locale?.language || this._hass.language || undefined;
    const now = new Date();
    this._root.querySelector(".date").textContent =
      now.toLocaleDateString(lang, { weekday: "short", month: "short", day: "numeric", timeZone: this._zone() });
    // Like the Nest Hub: no AM or PM after a 12-hour time.
    this._root.querySelector(".time").textContent = now
      .toLocaleTimeString(lang, { hour: "numeric", minute: "2-digit", hour12: this._hour12(), timeZone: this._zone() })
      .replace(/\s?[AaPp]\.?\s?[Mm]\.?$/, "");
  }

  _renderStatus() {
    const line = this._root.querySelector(".status");
    const entity = this._config.status_entity;
    const state = entity ? this._hass.states[entity]?.state : undefined;
    line.hidden = state == null;
    if (line.hidden) return;
    const ok = state.startsWith(this._config.status_ok_prefix);
    line.style.setProperty("--tone", ok ? "var(--success-color, #43a047)" : "var(--warning-color, #ffa600)");
    line.querySelector("ha-icon").icon = ok ? "mdi:check-circle-outline" : "mdi:alert-circle-outline";
    line.querySelector("span").textContent = state;
  }

  _renderNest() {
    if (!this._hass) return;
    const weather = this._hass.states[this._entity()];
    if (!weather) return;
    const lang = this._hass.locale?.language || this._hass.language || undefined;
    const degrees = (t) => (t == null || isNaN(Number(t)) ? "--" : `${Math.round(Number(t))}°`);
    const today = this._day(new Date());
    const night = dayPart(this._hass.states[this._config.sun]) === "night";
    const color = this._config.icons !== "mdi";
    const icon = (state, isNight) => {
      if (color) return `${BASE}meteocons-${(METEOCONS[state] || METEOCONS.cloudy)[isNight ? 1 : 0]}.svg`;
      if (state === "partlycloudy" && isNight) return "mdi:weather-night-partly-cloudy";
      return ICONS[state] || "mdi:weather-cloudy";
    };
    const slots = [{ label: "NOW", icon: icon(weather.state, night), temp: weather.attributes.temperature }];
    const days = Math.max(0, Number(this._config.forecast_days) || 0);
    for (const f of this._forecast || []) {
      if (slots.length > days) break;
      const when = new Date(f.datetime);
      if (this._day(when) <= today) continue;
      slots.push({
        label: when.toLocaleDateString(lang, { weekday: "short", timeZone: this._zone() }).toUpperCase(),
        icon: icon(f.condition, false),
        temp: f.temperature,
      });
    }
    this._renderStatus();
    const box = this._root.querySelector(".slots");
    box.replaceChildren(...slots.map((slot) => {
      const el = document.createElement("div");
      el.className = "slot";
      el.innerHTML = `<div class="label"></div><div class="row">${color ? "<img alt=\"\">" : "<ha-icon></ha-icon>"}<span></span></div>`;
      el.querySelector(".label").textContent = slot.label;
      if (color) el.querySelector("img").src = slot.icon;
      else el.querySelector("ha-icon").icon = slot.icon;
      el.querySelector("span").textContent = degrees(slot.temp);
      return el;
    }));
  }

  getCardSize() {
    return 6;
  }

  getGridOptions() {
    return { columns: 12, rows: 6, min_rows: 3 };
  }

  _build() {
    if (this._root) {
      this._shape();
      return;
    }
    this._root = this.attachShadow({ mode: "open" });
    this._root.innerHTML = `
      <style>
        :host { display: block; height: 100%; background: #000; border-radius: var(--froggy-radius, var(--ha-card-border-radius, 12px)); }
        ha-card { overflow: hidden; height: 100%; background: #000; border: none;
                  border-radius: var(--froggy-radius, var(--ha-card-border-radius, 12px)); }
        .box { position: relative; width: 100%; min-height: 200px; container-type: size;
               background-size: cover; background-position: center;
               transition: background-image 0.6s; }
        canvas { position: absolute; inset: 0; width: 100%; height: 100%; visibility: hidden; }
        canvas.live { visibility: visible; }
        video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; visibility: hidden; }
        video.live { visibility: visible; }
        .note { position: absolute; top: 8px; left: 8px; right: 8px; color: rgba(255,255,255,0.75);
                font: 12px var(--ha-font-family-body, sans-serif); text-shadow: 0 1px 2px rgba(0,0,0,0.8); }
        .weather { position: absolute; left: 0; right: 0; bottom: 0; padding: 48px 20px 16px;
                   color: #fff; background: linear-gradient(to top, rgba(0,0,0,0.55), transparent);
                   text-shadow: 0 1px 3px rgba(0,0,0,0.6); font-family: var(--ha-font-family-body, sans-serif); }
        .temp { font-size: 44px; font-weight: 300; line-height: 1; }
        .cond { font-size: 18px; margin-top: 4px; }
        .nest { position: absolute; left: 0; right: 0; bottom: 0; display: flex; flex-direction: column;
                align-items: stretch; gap: min(2.4cqh, 1.8cqw); padding: min(10cqh, 8cqw) min(5cqw, 7cqh) min(4cqh, 3cqw);
                color: #fff; background: linear-gradient(to top, rgba(0,0,0,0.5), transparent);
                text-shadow: 0 1px 4px rgba(0,0,0,0.6); font-family: var(--ha-font-family-body, sans-serif);
                line-height: 1; white-space: nowrap; }
        .nest[hidden], .status[hidden] { display: none; }
        .nest-row { display: flex; align-items: flex-end; gap: min(5cqw, 7cqh); }
        .status { display: flex; align-items: center; gap: min(1.4cqh, 1cqw); overflow: hidden;
                  font-size: min(3.4cqh, 2.6cqw); font-weight: 500; }
        .status span { overflow: hidden; text-overflow: ellipsis; }
        .status ha-icon { --mdc-icon-size: min(4.6cqh, 3.5cqw); flex: none; color: var(--tone);
                          filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); }
        .date { font-size: min(3.4cqh, 2.6cqw); font-weight: 500; margin-bottom: min(1.2cqh, 0.9cqw); }
        /* Large digits carry side bearing: pull the clock left to line up with the date. */
        .time { font-size: min(13cqh, 10cqw); font-weight: 400; letter-spacing: -0.02em; margin-left: -0.04em; }
        .slots { display: flex; gap: min(4cqw, 6cqh); padding-bottom: min(1cqh, 0.8cqw); }
        .slot .label { font-size: min(3.2cqh, 2.4cqw); font-weight: 600; text-align: center;
                       margin-bottom: min(1.4cqh, 1cqw); }
        .slot .row { display: flex; align-items: center; gap: min(0.8cqh, 0.6cqw);
                     font-size: min(5.6cqh, 4.3cqw); font-weight: 500; }
        .slot ha-icon { --mdc-icon-size: min(6.4cqh, 4.9cqw); filter: drop-shadow(0 1px 3px rgba(0,0,0,0.5)); }
        /* Meteocons draw inside generous padding, so they need a larger box than the text. */
        .slot img { width: min(10cqh, 7.6cqw); height: min(10cqh, 7.6cqw); margin: max(-2cqh, -1.5cqw) 0;
                    filter: drop-shadow(0 1px 3px rgba(0,0,0,0.4)); }
      </style>
      <ha-card><div class="box"><canvas></canvas><video muted playsinline disablepictureinpicture preload="auto"></video><div class="note" hidden></div>
        <div class="weather"><div class="temp"></div><div class="cond"></div></div>
        <div class="nest" hidden>
          <div class="nest-row"><div class="clock"><div class="date"></div><div class="time"></div></div>
            <div class="slots"></div></div>
          <div class="status" hidden><ha-icon></ha-icon><span></span></div></div>
      </div></ha-card>`;
    this._box = this._root.querySelector(".box");
    this._canvas = this._root.querySelector("canvas");
    this._video = this._root.querySelector("video");
    this._weather = this._root.querySelector(".weather");
    this._nest = this._root.querySelector(".nest");
    this._shape();
  }

  _shape() {
    const { height, full_height: full } = this._config;
    this._box.style.aspectRatio = height || full ? "" : String(this._config.aspect_ratio);
    this._box.style.height = height || (full ? this._fullHeight() : "");
    this._box.style.minHeight = height ? "0" : "";
    this._box.style.backgroundPosition = `center ${this._focus() * 100}%`;
    this._video.style.objectPosition = `center ${this._focus() * 100}%`;
    const radius = this._config.border_radius;
    if (radius == null) this.style.removeProperty("--froggy-radius");
    else this.style.setProperty("--froggy-radius", `${Number(radius) || 0}px`);
  }

  connectedCallback() {
    this._visible = true;
    this._resize = new ResizeObserver(() => {
      this._fit();
      if (this._videoMode) this._showVideo();
    });
    this._resize.observe(this._box);
    this._onWindow = () => this._config.full_height && !this._config.height && this._shape();
    window.addEventListener("resize", this._onWindow);
    requestAnimationFrame(() => this._onWindow());
    this._seen = new IntersectionObserver((entries) => {
      this._visible = entries.some((e) => e.isIntersecting);
      this._resume();
    });
    this._seen.observe(this._box);
    this._onVisibility = () => this._resume();
    document.addEventListener("visibilitychange", this._onVisibility);
    // Time of day moves on without any state change, so check the scene every minute.
    this._tick = setInterval(() => this._update(), 60 * 1000);
    this._clock = setInterval(() => this._renderClock(), 5000);
    this._subscribe();
    if (this._config.video === "always" || (this._config.video === "auto" && !hasWebGL())) this._startVideo();
    else this._start();
  }

  disconnectedCallback() {
    this._resize?.disconnect();
    window.removeEventListener("resize", this._onWindow);
    this._seen?.disconnect();
    document.removeEventListener("visibilitychange", this._onVisibility);
    clearInterval(this._tick);
    clearInterval(this._clock);
    this._unsubscribe();
    clearTimeout(this._replay);
    cancelAnimationFrame(this._frame);
    this._frame = null;
    this._video.pause();
  }

  async _start() {
    if (this._graphics || this._failed) return this._loop();
    if (this._starting) return;
    this._starting = true;
    try {
      if (typeof WebAssembly !== "object") throw new Error("this browser has no WebAssembly");
      await loadRuntime();
      const graphics = new window.Flare.Graphics(this._canvas);
      // CanvasKit reports a failed start by throwing inside a timer, so the callback
      // never comes; give up after 20 seconds.
      await Promise.race([
        new Promise((resolve) => graphics.initialize(resolve, BASE)),
        new Promise((_, reject) => setTimeout(() => reject(new Error("the renderer did not start")), 20000)),
      ]);
      this._graphics = graphics;
      this._fit();
      if (this._name) this._show(this._name);
    } catch (err) {
      if (this._config.video !== "never" && this._videoMode === undefined) {
        console.warn("froggy-card: the live drawing did not start, playing the video instead:", err.message);
        this._failed = true;
        this._failReason = err.message;
        this._startVideo();
      } else {
        this._fail(err.message);
      }
    } finally {
      this._starting = false;
    }
  }

  _fail(reason) {
    this._failed = true;
    console.warn("froggy-card: still picture only:", reason);
    const note = this._root.querySelector(".note");
    note.textContent = `Still picture: ${reason}.`;
    note.hidden = false;
  }

  // The scene as pictures: the background, and the frog's resting pose until the animation draws.
  _still(name, frog) {
    const bg = `url(${BASE}${name}_bg.webp)`;
    this._box.style.backgroundImage = frog ? `url(${BASE}${name}_frog.webp), ${bg}` : bg;
    this._canvas.classList.toggle("live", !frog);
  }

  // The window height below the card's top edge, so it fills the screen with or without a
  // header (a kiosk or LANovo view hides it).
  _fullHeight() {
    const top = this.isConnected ? this._box.getBoundingClientRect().top + window.scrollY : 56;
    return `calc(100vh - ${Math.max(0, Math.round(top))}px)`;
  }

  // The configured weather entity, or the first one Home Assistant has.
  _entity() {
    return (
      this._config.entity ||
      Object.keys(this._hass?.states || {}).find((id) => id.startsWith("weather.")) ||
      ""
    );
  }

  _focus() {
    const f = Number(this._config.focus_y);
    return isNaN(f) ? 0.5 : Math.min(1, Math.max(0, f));
  }

  _sceneName() {
    const state = this._hass?.states[this._entity()]?.state;
    const condition = CONDITIONS[state] || "cloudy";
    const part = dayPart(this._hass?.states[this._config.sun]);
    return { condition, part, state };
  }

  _update(force = false) {
    if (!this._hass || !this._config) return;
    const { condition, part, state } = this._sceneName();
    const weather = this._hass.states[this._entity()];

    const nest = this._config.overlay === "nest";
    this._weather.style.display = this._config.show_weather && weather && !nest ? "" : "none";
    this._nest.hidden = !(this._config.show_weather && weather && nest);
    if (!this._nest.hidden) {
      this._renderClock();
      this._renderNest();
    }
    if (weather) {
      const t = weather.attributes.temperature;
      const unit = weather.attributes.temperature_unit || "°C";
      this._root.querySelector(".temp").textContent = t == null ? "" : `${Math.round(t)}${unit.replace("C", "").replace("F", "")}`;
      this._root.querySelector(".cond").textContent = LABELS[state] || state || "";
    }

    const key = `${part}_${condition}`;
    if (!force && key === this._key) return;
    this._key = key;
    let scene = this._config.scene;
    if (scene === "random") scene = SCENES[Math.floor(Math.random() * SCENES.length)];
    this._name = `${scene}_${part}_${condition}`;
    this._still(this._name, true);
    if (this._videoMode) this._showVideo();
    else if (this._graphics) this._show(this._name);
  }

  // Back on screen: carry on with the video or the live drawing; off screen: pause the video.
  _resume() {
    if (!this._videoMode) {
      if (this._visible && !document.hidden) this._loop();
      return;
    }
    const v = this._video;
    if (!this._visible || document.hidden || !this.isConnected) v.pause();
    else if (v.classList.contains("live") && !v.ended && !this._waiting) this._play();
  }

  // Video playback: the scene's video for the card's shape plays once, holds its last frame like
  // the animation, and plays again after 2.5 to 10 seconds. Any failure falls back to drawing.
  _startVideo() {
    if (this._videoMode !== undefined) return;
    const v = this._video;
    if (!v.canPlayType('video/webm; codecs="vp9"')) return this._noVideo();
    this._videoMode = true;
    v.addEventListener("loadeddata", () => {
      v.classList.add("live");
      this._play();
    });
    v.addEventListener("ended", () => {
      this._waiting = true;
      clearTimeout(this._replay);
      this._replay = setTimeout(() => {
        this._waiting = false;
        v.currentTime = 0;
        this._resume();
      }, 2500 + Math.random() * 7500);
    });
    v.addEventListener("error", () => this._noVideo(`code ${v.error?.code}`));
    this._showVideo();
  }

  // Video failed: draw the frog live, or, when that has already failed, keep the still.
  _noVideo(reason) {
    if (reason) console.warn("froggy-card: video failed:", reason);
    this._videoMode = false;
    clearTimeout(this._replay);
    this._video.classList.remove("live");
    this._video.removeAttribute("src");
    this._video.load();
    if (this._failReason) this._fail(this._failReason);
    else this._start();
  }

  // The cut that covers the card's shape: portrait, landscape, or the whole square scene.
  _cut() {
    const r = this._box.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    const ratio = r.width / r.height;
    if (ratio <= VIDEO_PORTRAIT) return "portrait";
    if (ratio >= VIDEO_LANDSCAPE) return "landscape";
    return "square";
  }

  _showVideo() {
    const cut = this._cut();
    if (!this._name || !cut) return;
    const src = `${BASE}${this._name}_${cut}.webm${VERSION}`;
    if (src === this._videoSrc) return;
    this._videoSrc = src;
    clearTimeout(this._replay);
    this._waiting = false;
    this._video.classList.remove("live");
    this._video.src = src;
    this._video.load();
  }

  _play() {
    if (!this._visible || document.hidden || !this.isConnected) return;
    // Autoplay of a muted video is allowed; a refusal leaves the still, which is fine.
    this._video.play().catch(() => {});
  }

  _show(name) {
    const loading = (this._loading = name);
    new window.Flare.ActorLoader().load(`${BASE}${name}_frog.flr`, (actor) => {
      if (loading !== this._loading || name !== this._name) return;
      if (!actor || actor.error) {
        console.warn("froggy-card: could not load", name, actor && actor.error);
        return;
      }
      try {
        this._setActor(name, actor);
      } catch (err) {
        this._fail(`the animation could not be drawn (${err.message})`);
      }
    });
  }

  _setActor(name, actor) {
    const g = this._graphics;
    this._artboard?.dispose(g);
    this._actor?.dispose(g);
    actor.initialize(g);
    const artboard = actor.makeInstance();
    artboard.initialize(g);
    const anim = artboard._Animations.find((a) => a._Name === ANIMATION) || artboard._Animations[0];
    this._actor = actor;
    this._artboard = artboard;
    this._anim = anim ? new window.Flare.AnimationInstance(anim._Actor, anim) : null;
    if (this._anim) this._anim.loop = false;
    // Draw the first pose at once, so the frog shows even before the first animation frame.
    if (this._anim) this._anim.apply(artboard, 1.0);
    artboard.advance(0);
    this._draw();
    this._still(name, false);
    this._playing = true;
    this._last = performance.now();
    this._loop();
  }

  _fit() {
    if (!this._graphics) return;
    const r = this._box.getBoundingClientRect();
    let scale = Math.min(window.devicePixelRatio || 1, 2);
    const side = Number(this._config.software_max_side) || SOFTWARE_MAX_SIDE;
    if (this._graphics.isSoftware) scale = Math.min(1, side / Math.max(r.width, r.height, 1));
    const w = Math.max(1, Math.round(r.width * scale));
    const h = Math.max(1, Math.round(r.height * scale));
    if (this._graphics.setSize(w, h)) this._draw();
  }

  _loop() {
    if (this._frame || !this._artboard || !this._visible || document.hidden || !this.isConnected) return;
    this._last = performance.now();
    const step = (now) => {
      this._frame = null;
      if (!this._visible || document.hidden || !this.isConnected) return;
      const fps = Number(this._config.software_fps) || SOFTWARE_FPS;
      if (this._graphics.isSoftware && now - this._last < 1000 / fps - 2) {
        this._frame = requestAnimationFrame(step);
        return;
      }
      // Keep real time when frames come slowly (a slow device skips poses rather than playing in
      // slow motion); only a long gap such as a hidden tab is cut short.
      const elapsed = Math.min((now - this._last) / 1000, 0.5);
      this._last = now;
      if (this._playing && this._anim) {
        this._anim.time = this._anim.time + elapsed;
        this._anim.apply(this._artboard, 1.0);
        if (this._anim.isOver) this._finished();
      }
      this._artboard.advance(elapsed);
      this._draw();
      if (this._playing) this._frame = requestAnimationFrame(step);
    };
    this._frame = requestAnimationFrame(step);
  }

  // Like Froggy: hold the last pose, then play again after 2.5 to 10 seconds.
  _finished() {
    this._playing = false;
    clearTimeout(this._replay);
    this._replay = setTimeout(() => {
      if (!this._anim) return;
      this._anim.reset();
      this._playing = true;
      this._loop();
    }, 2500 + Math.random() * 7500);
  }

  _draw() {
    const g = this._graphics;
    const ab = this._artboard;
    if (!g || !ab) return;
    const W = g.viewportWidth;
    const H = g.viewportHeight;
    const w = ab.width;
    const h = ab.height;
    const x0 = -ab.origin[0] * w;
    const y0 = -ab.origin[1] * h;
    // BoxFit.cover as Froggy draws it, centred across and at focus_y down, like the
    // background's CSS position.
    const s = Math.max(W / w, H / h);
    const tx = (W - w * s) / 2 - x0 * s;
    const ty = (H - h * s) * this._focus() - y0 * s;
    g.clear([0, 0, 0, 0]);
    g.setView([s, 0, 0, s, tx, ty]);
    ab.draw(g);
    g.flush();
  }

  static getStubConfig(hass) {
    const entity = Object.keys(hass?.states || {}).find((id) => id.startsWith("weather."));
    return { entity, scene: "fields" };
  }

  // Home Assistant draws the visual editor from this schema.
  static getConfigForm() {
    const select = (options) => ({ select: { mode: "dropdown", options } });
    return {
      schema: [
        { name: "entity", selector: { entity: { domain: "weather" } } },
        { name: "scene", selector: select(["fields", "hill", "mushroom", "random"]) },
        {
          type: "grid",
          name: "",
          schema: [
            { name: "show_weather", selector: { boolean: {} } },
            { name: "overlay", selector: select(["simple", "nest"]) },
            { name: "forecast_days", selector: { number: { min: 0, max: 5, mode: "box" } } },
            { name: "time_format", selector: select(["24", "12"]) },
            { name: "icons", selector: select(["meteocons", "mdi"]) },
          ],
        },
        { name: "status_entity", selector: { entity: {} } },
        { name: "status_ok_prefix", selector: { text: {} } },
        {
          type: "expandable",
          name: "",
          title: "Layout",
          schema: [
            { name: "full_height", selector: { boolean: {} } },
            { name: "height", selector: { text: {} } },
            { name: "aspect_ratio", selector: { number: { min: 0.3, max: 3, step: 0.05, mode: "box" } } },
            { name: "focus_y", selector: { number: { min: 0, max: 1, step: 0.05, mode: "slider" } } },
            { name: "border_radius", selector: { number: { min: 0, max: 40, mode: "box" } } },
          ],
        },
        {
          type: "expandable",
          name: "",
          title: "Playback",
          schema: [
            { name: "video", selector: select(["auto", "always", "never"]) },
            { name: "software_max_side", selector: { number: { min: 320, max: 1600, step: 40, mode: "box" } } },
            { name: "software_fps", selector: { number: { min: 10, max: 60, mode: "box" } } },
          ],
        },
      ],
      computeLabel: (field) =>
        ({
          entity: "Weather entity",
          scene: "Scene",
          show_weather: "Show weather",
          overlay: "Overlay",
          forecast_days: "Forecast days (nest)",
          time_format: "Clock format (nest)",
          icons: "Icons (nest)",
          status_entity: "Status line entity (nest)",
          status_ok_prefix: "Status text that means all is well",
          full_height: "Fill the window height",
          height: "Height (CSS, e.g. 30vh)",
          aspect_ratio: "Aspect ratio (width / height)",
          focus_y: "Vertical focus when cropped",
          border_radius: "Corner radius (px)",
          video: "Pre-rendered videos (auto: where WebGL is missing)",
          software_max_side: "Without WebGL: largest canvas side (px)",
          software_fps: "Without WebGL: frame rate cap",
        })[field.name],
    };
  }
}

customElements.define("froggy-weather-card", FroggyCard);
// The card's name before it was published.
if (!customElements.get("froggy-card")) customElements.define("froggy-card", class extends FroggyCard {});
window.customCards = window.customCards || [];
window.customCards.push({
  type: "froggy-weather-card",
  name: "Froggy Weather Card",
  description: "The weather frog scene for the current weather and time of day, animated",
  preview: true,
  documentationURL: "https://github.com/drcursor/froggy-weather-card",
});
console.info(`%c FROGGY-WEATHER-CARD %c ${CARD_VERSION} `, "color:#fff;background:#3f8f4f;font-weight:600", "color:#3f8f4f;background:#fff");
