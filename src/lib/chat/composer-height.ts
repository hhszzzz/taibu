/**
 * Composer field sizing.
 *
 * One line keeps the compact row. As soon as the draft wraps, the field takes a
 * comfortable height so the text sits at the top with room to keep typing
 * below it. Past the normal cap the field stops growing and the expand key lets
 * the user grow it in place up to a share of the window.
 */

export const COMPOSER_MIN_HEIGHT = 24;
/** One line of text plus padding: 15px × 1.4 + 11px, rounded up for 16px mobile text. */
export const COMPOSER_SINGLE_LINE_HEIGHT = 34;
/** Empty space kept under a wrapped draft, about five lines. */
export const COMPOSER_COMFORT_HEIGHT = 120;
/** Height the field reaches before offering the expand key: about seven lines. */
export const COMPOSER_MAX_HEIGHT = 160;
/** Expanded editor: opens at this share of the window even when the draft is short. */
export const COMPOSER_EXPANDED_VIEWPORT = 0.56;
/** …and grows with the draft no further than this share. */
export const COMPOSER_EXPANDED_MAX_VIEWPORT = 0.72;
/** Hero starts at two rows (42px) by design, so only content past that wraps. */
export const COMPOSER_HERO_SINGLE_LINE_HEIGHT = 42;

export interface ComposerHeightInput {
  /** Unclamped `scrollHeight` measured with the field's height reset to auto. */
  natural: number;
  hero: boolean;
  expanded: boolean;
  /** `window.innerHeight`. */
  viewport: number;
}

export interface ComposerHeight {
  /** Inline height for the textarea. */
  height: number;
  /** Whether the expand key applies (the draft is longer than the normal cap). */
  expandable: boolean;
}

export function resolveComposerHeight({ natural, hero, expanded, viewport }: ComposerHeightInput): ComposerHeight {
  const singleLine = hero ? COMPOSER_HERO_SINGLE_LINE_HEIGHT : COMPOSER_SINGLE_LINE_HEIGHT;
  // 单行沿用内容自身高度（旧行为），只为换行后的草稿加舒适高度。
  if (natural <= singleLine) return { height: Math.min(Math.max(natural, COMPOSER_MIN_HEIGHT), singleLine), expandable: false };
  const expandable = natural > COMPOSER_MAX_HEIGHT;
  if (expanded) {
    // 放大后是固定的大编辑区（草稿短也有大留白），随内容长高到窗口比例上限。
    return {
      height: Math.min(
        Math.max(natural, Math.round(viewport * COMPOSER_EXPANDED_VIEWPORT)),
        Math.max(COMPOSER_MAX_HEIGHT, Math.round(viewport * COMPOSER_EXPANDED_MAX_VIEWPORT)),
      ),
      expandable,
    };
  }
  return { height: Math.min(Math.max(natural, COMPOSER_COMFORT_HEIGHT), COMPOSER_MAX_HEIGHT), expandable };
}
