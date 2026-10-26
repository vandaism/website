import { Component } from '@theme/component';

/**
 * EAA risk-exposure calculator.
 *
 * Progressive enhancement over server-rendered markup: the Liquid snippet
 * computes and prints the default outputs, so the tile is meaningful without JS.
 * This component wires the three hybrid slider/text pairs and the posture radio
 * group, then recomputes on every change.
 *
 * Formula constants and bounds are read from `data-*` attributes set by the
 * section schema; nothing numeric is hard-coded here.
 *
 * @typedef {object} Refs
 * @property {HTMLInputElement} revenueSlider
 * @property {HTMLInputElement} revenueInput
 * @property {HTMLInputElement} pagesSlider
 * @property {HTMLInputElement} pagesInput
 * @property {HTMLInputElement} marketsSlider
 * @property {HTMLInputElement} marketsInput
 * @property {HTMLInputElement[]} postureInputs
 * @property {HTMLElement} postureValue
 * @property {HTMLElement} fineValue
 * @property {HTMLElement} fineSub
 * @property {HTMLElement} fineGauge
 * @property {HTMLElement} penaltyValue
 * @property {HTMLElement} penaltySub
 * @property {HTMLElement} penaltyGauge
 * @property {HTMLElement} [roiAnchor]
 *
 * @extends Component<Refs>
 */
class RiskCalculator extends Component {
  requiredRefs = [
    'revenueSlider',
    'revenueInput',
    'pagesSlider',
    'pagesInput',
    'marketsSlider',
    'marketsInput',
    'postureInputs',
    'postureValue',
    'fineValue',
    'fineSub',
    'fineGauge',
    'penaltyValue',
    'penaltySub',
    'penaltyGauge',
  ];

  /** @type {Intl.NumberFormat} */
  #currency = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

  /** @type {Intl.NumberFormat} */
  #integer = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

  connectedCallback() {
    super.connectedCallback();

    const lang = document.documentElement.lang || undefined;
    this.#currency = new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
    this.#integer = new Intl.NumberFormat(lang, { maximumFractionDigits: 0 });

    this.recalculate();
  }

  updatedCallback() {
    super.updatedCallback();
    this.recalculate();
  }

  /* ---------- Config from data attributes ---------- */

  /**
   * @param {string} name - data attribute name without the `data-` prefix
   * @param {number} fallback
   * @returns {number}
   */
  #num(name, fallback) {
    const raw = this.dataset[name];
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  get #config() {
    return {
      finePctMin: this.#num('finePctMin', 0.01),
      finePctMax: this.#num('finePctMax', 0.05),
      penaltyFloor: this.#num('penaltyFloor', 50000),
      penaltyCeiling: this.#num('penaltyCeiling', 1000000),
      crossBorderMax: this.#num('crossBorderMax', 0.5),
      mitigationCost: this.#num('mitigationCost', 500),
    };
  }

  /* ---------- Hybrid slider / text input ---------- */

  /**
   * @param {'revenue' | 'pages' | 'markets'} field
   * @returns {{ slider: HTMLInputElement, input: HTMLInputElement }}
   */
  #pair(field) {
    return {
      slider: /** @type {HTMLInputElement} */ (this.refs[`${field}Slider`]),
      input: /** @type {HTMLInputElement} */ (this.refs[`${field}Input`]),
    };
  }

  /**
   * @param {'revenue' | 'pages' | 'markets'} field
   * @param {number} value
   * @returns {string}
   */
  #formatField(field, value) {
    return field === 'revenue' ? this.#currency.format(value) : this.#integer.format(value);
  }

  /**
   * Slider dragged: mirror into the text field and recompute.
   * @param {'revenue' | 'pages' | 'markets'} field
   */
  onSliderInput(field) {
    const { slider, input } = this.#pair(field);
    input.value = this.#formatField(field, Number(slider.value));
    this.recalculate();
  }

  /**
   * Text field focused: swap the formatted display for the raw number and select it.
   * @param {'revenue' | 'pages' | 'markets'} field
   */
  onValueFocus(field) {
    const { slider, input } = this.#pair(field);
    input.value = String(Number(slider.value));
    input.select();
  }

  /**
   * Text field blurred: parse, clamp to the slider's bounds, commit to both.
   * @param {'revenue' | 'pages' | 'markets'} field
   */
  onValueBlur(field) {
    const { slider, input } = this.#pair(field);
    const min = Number(slider.min);
    const max = Number(slider.max);
    const parsed = Number(String(input.value).replace(/[^\d]/g, '')) || 0;
    const clamped = Math.min(max, Math.max(min, parsed));

    slider.value = String(clamped);
    input.value = this.#formatField(field, clamped);
    this.recalculate();
  }

  /**
   * Enter commits the text field (blur triggers the parse).
   * @param {'revenue' | 'pages' | 'markets'} field
   * @param {KeyboardEvent} event
   */
  onValueKeydown(field, event) {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    this.#pair(field).input.blur();
  }

  /* ---------- Posture (native radio group) ---------- */

  onPostureChange() {
    this.recalculate();
  }

  /** @returns {{ label: string, discount: number }} */
  #posture() {
    const checked = this.refs.postureInputs.find((input) => input.checked) ?? this.refs.postureInputs[0];
    if (!checked) return { label: '', discount: 0 };

    return {
      label: checked.dataset.label ?? '',
      discount: Number(checked.value) || 0,
    };
  }

  /* ---------- Formula ---------- */

  recalculate() {
    const cfg = this.#config;
    const { revenueSlider, pagesSlider, marketsSlider } = this.refs;

    const revenue = Number(revenueSlider.value);
    const pages = Number(pagesSlider.value);
    const markets = Number(marketsSlider.value);
    const posture = this.#posture();

    const complexFraction = fraction(pages, Number(pagesSlider.min), Number(pagesSlider.max));
    const marketFraction = fraction(markets, Number(marketsSlider.min), Number(marketsSlider.max));
    const crossBorderMultiplier = 1 + marketFraction * cfg.crossBorderMax;
    const postureMultiplier = 1 - posture.discount;

    this.refs.postureValue.textContent = posture.label;

    // Turnover-based fine, capped at the ceiling percentage.
    const finePctBase = cfg.finePctMin + complexFraction * (cfg.finePctMax - cfg.finePctMin);
    const fine = Math.min(revenue * cfg.finePctMax, revenue * finePctBase * crossBorderMultiplier * postureMultiplier);
    const finePctEffective = revenue > 0 ? fine / revenue : 0;

    this.refs.fineValue.textContent = this.#currency.format(fine);
    this.refs.fineSub.textContent = this.#template('textFineSub', {
      pct: this.#pct(finePctEffective * 100, 1),
      ceiling: this.#pct(cfg.finePctMax * 100, 0),
    });
    this.refs.fineGauge.style.setProperty('--fc-gauge-fill', `${Math.min(100, (finePctEffective / cfg.finePctMax) * 100)}%`);

    // Administrative penalty, capped at the statutory ceiling.
    const penaltyBase = cfg.penaltyFloor + complexFraction * (cfg.penaltyCeiling - cfg.penaltyFloor);
    const penalty = Math.min(cfg.penaltyCeiling, penaltyBase * crossBorderMultiplier * postureMultiplier);

    this.refs.penaltyValue.textContent = this.#currency.format(penalty);
    this.refs.penaltySub.textContent = this.#template('textPenaltySub', {
      ceiling: this.#currency.format(cfg.penaltyCeiling),
    });
    this.refs.penaltyGauge.style.setProperty('--fc-gauge-fill', `${Math.min(100, (penalty / cfg.penaltyCeiling) * 100)}%`);

    if (this.refs.roiAnchor) {
      const roiPct = penalty > 0 ? (cfg.mitigationCost / penalty) * 100 : 0;
      this.refs.roiAnchor.textContent = this.#template('textRoi', { pct: this.#pct(roiPct, 2) });
    }
  }

  /* ---------- Formatting helpers ---------- */

  /**
   * @param {number} value
   * @param {number} digits
   * @returns {string}
   */
  #pct(value, digits) {
    return new Intl.NumberFormat(document.documentElement.lang || undefined, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  }

  /**
   * Fills a translated template from `data-text-*` (placeholders written as `[key]`).
   * @param {string} name
   * @param {Record<string, string>} values
   * @returns {string}
   */
  #template(name, values) {
    let text = this.dataset[name] ?? '';
    for (const [key, value] of Object.entries(values)) {
      text = text.replaceAll(`[${key}]`, value);
    }
    return text;
  }
}

/**
 * Position of `value` inside [min, max] as 0..1; 0 when the range is degenerate.
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function fraction(value, min, max) {
  const span = max - min;
  return span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
}

if (!customElements.get('risk-calculator')) {
  customElements.define('risk-calculator', RiskCalculator);
}
