import type { DataSourceType } from '@/lib/data-sources/types';
import type { DataSourceProvider } from '@/lib/data-sources/provider.server';

export { DATA_SOURCE_TYPES, type DataSourceType } from '@/lib/data-sources/types';

type DataSourceLoader = () => Promise<DataSourceProvider>;

export const DATA_SOURCE_LOADERS: Record<DataSourceType, DataSourceLoader> = {
    bazi_chart: async () => (await import('@/lib/data-sources/bazi')).baziProvider,
    ziwei_chart: async () => (await import('@/lib/data-sources/ziwei')).ziweiProvider,
    tarot_reading: async () => (await import('@/lib/data-sources/tarot')).tarotProvider,
    liuyao_divination: async () => (await import('@/lib/data-sources/liuyao')).liuyaoProvider,
    mbti_reading: async () => (await import('@/lib/data-sources/mbti')).mbtiProvider,
    hepan_chart: async () => (await import('@/lib/data-sources/hepan')).hepanProvider,
    face_reading: async () => (await import('@/lib/data-sources/face')).faceProvider,
    palm_reading: async () => (await import('@/lib/data-sources/palm')).palmProvider,
    ming_record: async () => (await import('@/lib/data-sources/record')).recordProvider,
    daily_fortune: async () => (await import('@/lib/data-sources/fortune')).dailyFortuneProvider,
    monthly_fortune: async () => (await import('@/lib/data-sources/fortune')).monthlyFortuneProvider,
    qimen_chart: async () => (await import('@/lib/data-sources/qimen')).qimenProvider,
    daliuren_divination: async () => (await import('@/lib/data-sources/daliuren')).daliurenProvider,
    meihua_divination: async () => (await import('@/lib/data-sources/meihua')).meihuaProvider,
    xiaoliuren_divination: async () => (await import('@/lib/data-sources/xiaoliuren')).xiaoliurenProvider,
};
