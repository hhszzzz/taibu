import { FeatureGate } from '@/components/layout/FeatureGate';

export default function Layout({ children }: { children: React.ReactNode }) {
    return <FeatureGate featureId="annual-report">{children}</FeatureGate>;
}
