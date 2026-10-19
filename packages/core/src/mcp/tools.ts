import { almanacManifest } from './domains/almanac/tool.js';
import { astrologyManifest } from './domains/astrology/tool.js';
import { baziDayunManifest } from './domains/bazi-dayun/tool.js';
import { baziRelationsManifest } from './domains/bazi-relations/tool.js';
import { baziWuxingManifest } from './domains/bazi-wuxing/tool.js';
import { baziLiunianScanManifest } from './domains/bazi-liunian-scan/tool.js';
import { baziPillarsResolveManifest } from './domains/bazi-pillars-resolve/tool.js';
import { baziManifest } from './domains/bazi/tool.js';
import { daliurenLessonsManifest } from './domains/daliuren-lessons/tool.js';
import { daliurenManifest } from './domains/daliuren/tool.js';
import { liuyaoManifest } from './domains/liuyao/tool.js';
import { meihuaManifest } from './domains/meihua/tool.js';
import { qimenPalaceManifest } from './domains/qimen-palace/tool.js';
import { qimenManifest } from './domains/qimen/tool.js';
import { tarotManifest } from './domains/tarot/tool.js';
import { taiyiManifest } from './domains/taiyi/tool.js';
import { xiaoliurenManifest } from './domains/xiaoliuren/tool.js';
import { ziweiFlyingStarManifest } from './domains/ziwei-flying-star/tool.js';
import { ziweiHoroscopeManifest } from './domains/ziwei-horoscope/tool.js';
import { ziweiManifest } from './domains/ziwei/tool.js';
import { ziweiPalaceManifest } from './domains/ziwei-palace/tool.js';
import type { ToolContract } from './contract.js';

// Registry only needs the shared runtime surface, not each tool's concrete generic pair.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTool = ToolContract<any, any>;

export const tools: AnyTool[] = [
  astrologyManifest,
  baziManifest,
  baziPillarsResolveManifest,
  ziweiManifest,
  ziweiHoroscopeManifest,
  ziweiFlyingStarManifest,
  liuyaoManifest,
  meihuaManifest,
  tarotManifest,
  taiyiManifest,
  almanacManifest,
  baziDayunManifest,
  qimenManifest,
  daliurenManifest,
  xiaoliurenManifest,
  baziRelationsManifest,
  baziWuxingManifest,
  baziLiunianScanManifest,
  ziweiPalaceManifest,
  qimenPalaceManifest,
  daliurenLessonsManifest,
];

export const toolByName = new Map(tools.map((tool) => [tool.definition.name, tool] as const));
