// Model icon picker: follow the vendor's icon, or search every lobehub icon.
'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { LobeIcon } from '@/components/ui/LobeIcon';
import { ModelIcon } from '@/components/ui/ModelIcon';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover';
import { LOBE_ICONS, searchLobeIcons } from '@/lib/ai/lobe-icons';
import { getVendorName } from '@/lib/ai/vendor-labels';

/** 不搜索时先列模型类图标，再补几家常用供应商的标志。 */
const FEATURED_PROVIDERS = new Set(['OpenAI', 'Anthropic', 'Google', 'Meta', 'Moonshot', 'Kimi', 'Zhipu', 'XAI']);
const FEATURED = LOBE_ICONS.filter(icon => icon.group === 'model' || FEATURED_PROVIDERS.has(icon.id));
const RESULT_LIMIT = 60;

export function ModelIconPicker({ value, vendor, onChange }: {
    value: string | null;
    vendor: string;
    onChange: (icon: string | null) => void;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const results = useMemo(() => (query.trim() ? searchLobeIcons(query, RESULT_LIMIT) : FEATURED), [query]);
    const current = value ? LOBE_ICONS.find(icon => icon.id === value) ?? null : null;
    const vendorName = getVendorName(vendor);
    const choose = (icon: string | null) => {
        onChange(icon);
        setOpen(false);
        setQuery('');
    };
    return <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="ai-catalog-icon-trigger" title="模型图标"
            aria-label={`模型图标：${current ? current.title : `跟随供应商（${vendorName}）`}`}>
            <ModelIcon icon={value} vendor={vendor} size={20} />
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="ai-catalog-icon-panel" aria-label="选择模型图标">
            <div className="ai-catalog-icon-current">
                <span className="ai-catalog-icon-preview"><ModelIcon icon={value} vendor={vendor} size={26} /></span>
                <span className="ai-catalog-icon-current-text">
                    <strong>{current ? current.title : '跟随供应商'}</strong>
                    <small>{current ? '在输入框的模型菜单里显示这个图标' : `使用 ${vendorName} 的图标`}</small>
                </span>
                {value && <Button variant="ghost" size="xs" onClick={() => choose(null)}>跟随供应商</Button>}
            </div>
            <Input type="search" size="sm" value={query} onChange={event => setQuery(event.target.value)}
                placeholder={`搜索 ${LOBE_ICONS.length} 个图标，如 OpenAI、Kimi`} aria-label="搜索图标" />
            {results.length ? <div className="ai-catalog-icon-grid" role="group" aria-label={query.trim() ? '搜索结果' : '常用图标'}>
                {results.map(icon => <Button unstyled key={icon.id} type="button" className="ai-catalog-icon-option"
                    aria-pressed={icon.id === value} aria-label={icon.title} title={icon.title} onClick={() => choose(icon.id)}>
                    <LobeIcon id={icon.id} size={22} />
                </Button>)}
            </div> : <p className="ai-catalog-hint">没有匹配「{query.trim()}」的图标。</p>}
            <p className="ai-catalog-hint">{query.trim()
                ? results.length >= RESULT_LIMIT ? `只显示前 ${RESULT_LIMIT} 个，输入更完整的名称缩小范围。` : `找到 ${results.length} 个。`
                : `常用 ${FEATURED.length} 个；输入名称搜索全部 ${LOBE_ICONS.length} 个。`}</p>
        </PopoverContent>
    </Popover>;
}
