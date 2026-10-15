import { AlertCircle, Check } from 'lucide-react';

export function StatusBanner({ error, success }: { error: string; success: string }) {
    return (
        <>
            {error && (
                <div role="alert" className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-danger">
                    <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {error}
                </div>
            )}
            {success && (
                <div role="status" className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-success">
                    <Check className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                    {success}
                </div>
            )}
        </>
    );
}
