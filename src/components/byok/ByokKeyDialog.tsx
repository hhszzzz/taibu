'use client';
// 需要输入框状态与本机 Key 存储

import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { BYOK_KEY_MAX } from '@/lib/byok/config';
import { setDeviceKey } from '@/lib/byok/device-keys';
import type { OwnModel } from '@/lib/byok/client';
import { openSettingsCenter } from '@/lib/settings-center';

/** The key error to show, or null when it can be kept. */
export function deviceKeyError(value: string): string | null {
    const key = value.trim();
    if (!key) return '请填写 API Key';
    if (key.length > BYOK_KEY_MAX || /\s/u.test(key)) return 'API Key 格式无效';
    return null;
}

/** Fills in the key of a connection whose key lives only in browsers, for this device. */
export function ByokKeyDialog({ model, userId, onClose, onSaved }: {
    model: OwnModel | null;
    userId: string;
    onClose: () => void;
    /** Called with the model once its key is kept here. */
    onSaved: (model: OwnModel) => void;
}) {
    const [value, setValue] = useState('');
    const [visible, setVisible] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const close = () => { setValue(''); setError(null); setVisible(false); onClose(); };
    const save = () => {
        if (!model) return;
        const invalid = deviceKeyError(value);
        if (invalid) { setError(invalid); return; }
        if (!setDeviceKey(userId, model.connection.id, value.trim())) { setError('浏览器拒绝保存，请检查是否禁用了本地存储'); return; }
        setValue(''); setError(null); setVisible(false);
        onSaved(model);
    };
    const toggleLabel = visible ? '隐藏 API Key' : '显示 API Key';
    return (
        <Dialog open={!!model} onClose={close} title="填写 API Key"
            description={model ? `「${model.connection.name}」的 Key 只保存在这台设备的浏览器里，退出登录时清除。` : undefined}
            footer={<>
                <Button variant="ghost" size="lg" className="mr-auto" onClick={() => { close(); openSettingsCenter('byok'); }}>管理自定义模型</Button>
                <Button variant="ghost" size="lg" onClick={close}>取消</Button>
                <Button size="lg" onClick={save}>保存</Button>
            </>}>
            <Field label="API Key" error={error}>
                {props => (
                    <div className="relative">
                        <Input {...props} type={visible ? 'text' : 'password'} value={value} autoComplete="off" spellCheck={false}
                            className="pr-11 font-mono placeholder:font-sans" placeholder="sk-..."
                            onChange={event => { setValue(event.target.value); setError(null); }}
                            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) save(); }} />
                        <span className="absolute inset-y-0 right-1.5 flex items-center">
                            <IconButton label={toggleLabel} title={toggleLabel} expand="none" className="h-8 w-8 rounded-lg" onClick={() => setVisible(current => !current)}>
                                {visible ? <EyeOff aria-hidden="true" className="h-4 w-4" /> : <Eye aria-hidden="true" className="h-4 w-4" />}
                            </IconButton>
                        </span>
                    </div>
                )}
            </Field>
        </Dialog>
    );
}
