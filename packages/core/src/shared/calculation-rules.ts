/**
 * Reproducible calculation choices. They travel in the structured JSON (audit, replay, UI);
 * the model-facing text does not repeat them, since a rule that changes a fact is written as that fact.
 * Optional for historical saved results.
 */
export type CalculationRules = Record<string, unknown>;

export function getCalculationRules(result: object): CalculationRules | undefined {
  const source = result as Record<string, unknown>;
  for (const key of ['calculationOptions', 'inputSnapshot', 'drawOptions']) {
    if (source[key] && typeof source[key] === 'object') return JSON.parse(JSON.stringify({
      ...source[key],
      ...(typeof source.seed === 'string' ? { seed: source.seed } : {}),
      ...(source.trueSolarTimeInfo ? { trueSolarTime: source.trueSolarTimeInfo } : {}),
    })) as CalculationRules;
  }
  if (source.chartMeta && typeof source.chartMeta === 'object') {
    const meta = source.chartMeta as Record<string, unknown>;
    return Object.fromEntries(['zodiac', 'houseSystem', 'ephemeris', 'coordinateFrame', 'ayanamsa', 'aspectOrbs', 'ruleVersion'].filter(key => meta[key] !== undefined).map(key => [key, structuredClone(meta[key])]));
  }
  return undefined;
}

export function withRulesJSON<Args extends [object, ...unknown[]], Result extends object>(render: (...args: Args) => Result) {
  return (...args: Args): Result & { 计算规则?: CalculationRules; } => {
    const output = render(...args);
    const rules = getCalculationRules(args[0]);
    return rules ? { ...output, 计算规则: rules } : output;
  };
}
