import { FeatureGate } from '@/components/layout/FeatureGate';

export default function Layout({ children }: { children: React.ReactNode }) {
    return <FeatureGate featureId="notifications">{children}</FeatureGate>;
}
