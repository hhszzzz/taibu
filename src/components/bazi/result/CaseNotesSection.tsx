/**
 * 断事笔记模块 - 极简属性版
 * 
 * 对齐 Notion 风格：
 * 1. 属性收纳：所有标签、选项不再平铺展示，仅显示已选内容，通过下拉添加。
 * 2. 喜忌合并：五行喜忌保持紧凑网格，并允许按五行补充具体字项。
 * 3. 布局收敛：移除大段摘要输入，仅保留关键事件与属性记录。
 */
'use client';

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { BookOpenText, CalendarDays, Plus, Save, Trash2, Sparkles, Tag, LayoutGrid, type LucideIcon } from 'lucide-react';
import {
    BAZI_CASE_BASIC_ELEMENTS,
    BAZI_CASE_EDUCATION_OPTIONS,
    BAZI_CASE_EVENT_CATEGORY_OPTIONS,
    BAZI_CASE_FAMILY_TAG_OPTIONS,
    BAZI_CASE_HEALTH_STATUS_OPTIONS,
    BAZI_CASE_MARRIAGE_STATUS_OPTIONS,
    BAZI_CASE_OCCUPATION_OPTIONS,
    BAZI_CASE_PATTERN_OPTIONS,
    BAZI_CASE_STRENGTH_LEVELS,
    BAZI_CASE_TEMPERAMENT_TAG_OPTIONS,
    BAZI_CASE_WEALTH_LEVEL_OPTIONS,
    createEmptyBaziCaseProfile,
    type BaziCaseAdvancedGod,
    type BaziCaseBasicElement,
    type BaziCaseEvent,
    type BaziCaseProfile,
} from '@/lib/bazi-case-profile';
import { loadBaziCaseProfile, saveBaziCaseProfile } from '@/lib/bazi-case-profile-client';
import { useToast } from '@/components/ui/Toast';
import { SoundWaveLoader } from '@/components/ui/SoundWaveLoader';

type NotesTab = 'owner' | 'master';
type GodKey = 'yongShen' | 'xiShen' | 'jiShen' | 'xianShen';

function cx(...values: Array<string | false | null | undefined>) {
    return values.filter(Boolean).join(' ');
}

const GOD_KEYS: readonly GodKey[] = ['yongShen', 'xiShen', 'jiShen', 'xianShen'] as const;

const ELEMENT_ADVANCED_OPTIONS = {
    金: [
        { label: '庚', values: ['庚', '庚金'] },
        { label: '辛', values: ['辛', '辛金'] },
        { label: '申', values: ['申', '申金'] },
        { label: '酉', values: ['酉', '酉金'] },
    ],
    木: [
        { label: '甲', values: ['甲', '甲木'] },
        { label: '乙', values: ['乙', '乙木'] },
        { label: '寅', values: ['寅', '寅木'] },
        { label: '卯', values: ['卯', '卯木'] },
    ],
    水: [
        { label: '壬', values: ['壬', '壬水'] },
        { label: '癸', values: ['癸', '癸水'] },
        { label: '亥', values: ['亥', '亥水'] },
        { label: '子', values: ['子', '子水'] },
    ],
    火: [
        { label: '丙', values: ['丙', '丙火'] },
        { label: '丁', values: ['丁', '丁火'] },
        { label: '巳', values: ['巳', '巳火'] },
        { label: '午', values: ['午', '午火'] },
    ],
    土: [
        { label: '戊', values: ['戊', '戊土'] },
        { label: '己', values: ['己', '己土'] },
        { label: '辰', values: ['辰', '辰土'] },
        { label: '戌', values: ['戌', '戌土'] },
        { label: '丑', values: ['丑', '丑土'] },
        { label: '未', values: ['未', '未土'] },
    ],
} as const satisfies Record<
    BaziCaseBasicElement,
    readonly { label: string; values: readonly BaziCaseAdvancedGod[] }[]
>;

type ElementAdvancedOption = (typeof ELEMENT_ADVANCED_OPTIONS)[keyof typeof ELEMENT_ADVANCED_OPTIONS][number];

function uniqueText(values: readonly string[]): string[] {
    return Array.from(new Set(values));
}

function parseTagInput(value: string): string[] {
    return uniqueText(
        value
            .split(/[、，,\n]/u)
            .map((item) => item.trim().slice(0, 24))
            .filter(Boolean),
    );
}

/** Notion 风格的属性行 (单选) */
function PropertyRow<T extends string>({
    label,
    icon: Icon,
    value,
    options,
    onChange,
}: {
    label: string;
    icon: LucideIcon;
    value: T | null;
    options: readonly T[];
    onChange: (value: T | null) => void;
}) {
    return (
        <div className="flex items-center gap-3 py-1.5 px-1 group transition-colors">
            <div className="flex items-center gap-2 w-24 shrink-0 text-[11px] font-bold text-foreground-secondary uppercase tracking-widest">
                <Icon className="w-3.5 h-3.5" />
                {label}
            </div>
            <div className="flex-1 relative">
                <select
                    value={value ?? ''}
                    onChange={(e) => onChange((e.target.value || null) as T | null)}
                    className="w-full appearance-none bg-transparent text-sm text-foreground/80 outline-none cursor-pointer hover:bg-background-secondary px-2 py-0.5 rounded transition-colors"
                >
                    <option value="">未设置</option>
                    {options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                </select>
            </div>
        </div>
    );
}

/** 动态多选属性 (仅显示已选，下拉添加) */
function PropertyTags<T extends string>({
    label,
    options = [],
    values,
    onChange,
    colorClass = "bg-foreground text-background border-transparent",
    allowCustom = false,
    placeholder = '输入后按回车',
}: {
    label: string;
    options?: readonly T[];
    values: string[];
    onChange: (values: string[]) => void;
    colorClass?: string;
    allowCustom?: boolean;
    placeholder?: string;
}) {
    const [draft, setDraft] = useState('');
    const availableOptions = options.filter((option) => !values.includes(option));

    const commitDraft = () => {
        if (!allowCustom) {
            return;
        }
        const nextItems = parseTagInput(draft);
        if (nextItems.length === 0) {
            setDraft('');
            return;
        }
        onChange(uniqueText([...values, ...nextItems]));
        setDraft('');
    };

    return (
        <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2 px-1 text-[11px] font-bold text-foreground-secondary uppercase tracking-widest">
                <Tag className="w-3.5 h-3.5" />
                {label}
            </div>
            <div className="flex flex-wrap items-center gap-1.5 px-1">
                {values.map((value) => (
                    <button
                        key={value}
                        type="button"
                        onClick={() => onChange(values.filter((item) => item !== value))}
                        className={cx("px-1.5 py-0.5 text-[10px] rounded border transition-all hover:opacity-80 flex items-center gap-1", colorClass)}
                        title="点击移除"
                    >
                        {value}
                        <span className="opacity-50 text-[8px]">×</span>
                    </button>
                ))}

                {availableOptions.length > 0 ? (
                    <select
                        value=""
                        onChange={(e) => {
                            const nextValue = e.target.value as T;
                            if (nextValue && !values.includes(nextValue)) {
                                onChange([...values, nextValue]);
                            }
                        }}
                        className="appearance-none bg-transparent border border-dashed border-border text-foreground-secondary text-[10px] px-2 py-0.5 rounded cursor-pointer outline-none hover:bg-background-secondary hover:text-foreground transition-colors"
                    >
                        <option value="" disabled>+ 选择</option>
                        {availableOptions.map((option) => (
                            <option key={option} value={option}>{option}</option>
                        ))}
                    </select>
                ) : null}

                {allowCustom ? (
                    <input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                commitDraft();
                            }
                        }}
                        onBlur={commitDraft}
                        placeholder={placeholder}
                        className="min-w-[120px] flex-1 bg-transparent border-b border-dashed border-border text-[11px] text-foreground-secondary px-1 py-1 outline-none placeholder:text-foreground-tertiary focus:border-foreground/30"
                    />
                ) : null}
            </div>
        </div>
    );
}

/** 紧凑合并版五行喜忌选择器 */
const GOD_ROLES = [
    { value: '', label: '未设' },
    { value: 'yongShen', label: '用神' },
    { value: 'xiShen', label: '喜神' },
    { value: 'jiShen', label: '忌神' },
    { value: 'xianShen', label: '闲神' }
] as const;

function ElementsPreferences({ profile, setProfile }: { profile: BaziCaseProfile, setProfile: Dispatch<SetStateAction<BaziCaseProfile>> }) {
    const hasAdvancedSelection = (role: GodKey, el: BaziCaseBasicElement) =>
        ELEMENT_ADVANCED_OPTIONS[el].some((option) =>
            option.values.some((value) => profile.masterReview[role].advanced.includes(value)),
        );

    const getRole = (el: BaziCaseBasicElement): GodKey | '' => {
        if (profile.masterReview.yongShen.basic.includes(el) || hasAdvancedSelection('yongShen', el)) return 'yongShen';
        if (profile.masterReview.xiShen.basic.includes(el) || hasAdvancedSelection('xiShen', el)) return 'xiShen';
        if (profile.masterReview.jiShen.basic.includes(el) || hasAdvancedSelection('jiShen', el)) return 'jiShen';
        if (profile.masterReview.xianShen.basic.includes(el) || hasAdvancedSelection('xianShen', el)) return 'xianShen';
        return '';
    };

    const setRole = (el: BaziCaseBasicElement, role: string) => {
        setProfile((prev: BaziCaseProfile) => {
            const next = { ...prev, masterReview: { ...prev.masterReview } };
            const relatedAdvanced = ELEMENT_ADVANCED_OPTIONS[el].flatMap((option) => option.values) as BaziCaseAdvancedGod[];
            const carriedAdvanced = uniqueText(
                GOD_KEYS.flatMap((key) =>
                    next.masterReview[key].advanced.filter((item) => relatedAdvanced.includes(item)),
                ),
            ) as BaziCaseAdvancedGod[];

            GOD_KEYS.forEach((key) => {
                next.masterReview[key] = {
                    ...next.masterReview[key],
                    basic: next.masterReview[key].basic.filter((item) => item !== el),
                    advanced: next.masterReview[key].advanced.filter((item) => !relatedAdvanced.includes(item)),
                };
            });

            if (role) {
                const roleKey = role as GodKey;
                next.masterReview[roleKey] = {
                    ...next.masterReview[roleKey],
                    basic: uniqueText([...next.masterReview[roleKey].basic, el]) as BaziCaseBasicElement[],
                    advanced: uniqueText([...next.masterReview[roleKey].advanced, ...carriedAdvanced]) as BaziCaseAdvancedGod[],
                };
            }

            return next;
        });
    };

    const setAdvancedOption = (el: BaziCaseBasicElement, option: ElementAdvancedOption, selected: boolean) => {
        const role = getRole(el);
        if (!role) return;

        setProfile((prev) => {
            const next = { ...prev, masterReview: { ...prev.masterReview } };
            const current = next.masterReview[role];
            const optionValues = option.values as readonly BaziCaseAdvancedGod[];
            const filtered = current.advanced.filter((value) => !optionValues.includes(value));

            next.masterReview[role] = {
                ...current,
                basic: uniqueText([...current.basic, el]) as BaziCaseBasicElement[],
                advanced: selected
                    ? filtered
                    : uniqueText([...filtered, optionValues[0]]) as BaziCaseAdvancedGod[],
            };

            return next;
        });
    };

    return (
        <div className="space-y-3 pt-4 border-t-[0.5px] border-border">
             <div className="flex items-center gap-2 px-1 text-[11px] font-bold text-foreground-secondary uppercase tracking-widest">
                 <Sparkles className="w-3.5 h-3.5" />
                 五行喜忌
             </div>
             <div className="grid grid-cols-5 gap-1.5 px-1">
                 {BAZI_CASE_BASIC_ELEMENTS.map((el) => {
                     const role = getRole(el);
                     const selectedOptions = role
                         ? ELEMENT_ADVANCED_OPTIONS[el].filter((option) =>
                             option.values.some((value) => profile.masterReview[role].advanced.includes(value)),
                         )
                         : [];
                     const availableOptions = ELEMENT_ADVANCED_OPTIONS[el].filter((option) =>
                         !selectedOptions.some((selected) => selected.label === option.label),
                     );
                     return (
                         <div key={el} className="flex flex-col gap-2 p-2 rounded-md hover:bg-background-secondary/50 transition-colors border border-transparent hover:border-border/60">
                             <span className="text-xs font-bold text-center text-foreground/80">{el}</span>
                             <select 
                                 value={role} 
                                 onChange={(e) => setRole(el, e.target.value)}
                                 className={cx(
                                     "w-full appearance-none text-center text-[10px] py-0.5 rounded cursor-pointer outline-none transition-colors",
                                     role === 'yongShen' ? 'bg-success/10 text-success font-bold' :
                                     role === 'xiShen' ? 'bg-accent/10 text-accent font-bold' :
                                     role === 'jiShen' ? 'bg-danger/10 text-danger font-bold' :
                                     role === 'xianShen' ? 'bg-warning/10 text-warning font-bold' :
                                     'bg-transparent text-foreground-secondary hover:bg-background-secondary'
                                 )}
                                 style={{ textAlignLast: 'center' }}
                             >
                                 {GOD_ROLES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
                             </select>
                             {role ? (
                                 <>
                                     {selectedOptions.length > 0 ? (
                                         <div className="min-h-8 flex flex-wrap justify-center gap-1">
                                             {selectedOptions.map((option) => (
                                                 <button
                                                     key={`${el}-${option.label}`}
                                                     type="button"
                                                     onClick={() => setAdvancedOption(el, option, true)}
                                                     className={cx(
                                                         "rounded px-1.5 py-0.5 text-[10px] text-on-accent transition-opacity hover:opacity-80",
                                                         role === 'yongShen' ? 'bg-success' :
                                                         role === 'xiShen' ? 'bg-accent' :
                                                         role === 'jiShen' ? 'bg-danger' :
                                                         'bg-warning'
                                                     )}
                                                     title="点击移除字项"
                                                 >
                                                     {option.label}
                                                 </button>
                                             ))}
                                         </div>
                                     ) : null}
                                     <select
                                         value=""
                                         disabled={availableOptions.length === 0}
                                         onChange={(e) => {
                                             const nextOption = ELEMENT_ADVANCED_OPTIONS[el].find((option) => option.label === e.target.value);
                                             if (nextOption) {
                                                 setAdvancedOption(el, nextOption, false);
                                             }
                                         }}
                                         className={cx(
                                             "w-full appearance-none rounded border border-dashed px-1 py-0.5 text-center text-[10px] outline-none transition-colors",
                                             availableOptions.length > 0
                                                 ? 'border-border text-foreground-secondary hover:bg-background-secondary'
                                                 : 'cursor-not-allowed border-border text-foreground-tertiary'
                                         )}
                                         style={{ textAlignLast: 'center' }}
                                     >
                                         <option value="" disabled>
                                             {availableOptions.length === 0 ? '已选完' : '+ 添加字项'}
                                         </option>
                                         {availableOptions.map((option) => (
                                             <option key={`${el}-${option.label}-option`} value={option.label}>{option.label}</option>
                                         ))}
                                     </select>
                                 </>
                             ) : null}
                         </div>
                     );
                 })}
             </div>
        </div>
    );
}

export function CaseNotesSection({ chartId }: { chartId?: string | null }) {
    const { showToast } = useToast();
    const [activeTab, setActiveTab] = useState<NotesTab>('owner');
    const [profile, setProfile] = useState<BaziCaseProfile>(createEmptyBaziCaseProfile());
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!chartId) { setProfile(createEmptyBaziCaseProfile()); return; }
        setLoading(true);
        loadBaziCaseProfile(chartId)
            .then((p) => setProfile(p || { ...createEmptyBaziCaseProfile(), chartId }))
            .finally(() => setLoading(false));
    }, [chartId]);

    const handleSave = async () => {
        if (!chartId) return;
        setSaving(true);
        try {
            await saveBaziCaseProfile({ chartId, ...profile });
            showToast('success', '笔记已更新');
        } catch { showToast('error', '保存失败'); } finally { setSaving(false); }
    };

    if (loading) return <SoundWaveLoader variant="block" />;

    if (!chartId) {
        return (
            <div className="px-4 py-12 text-center space-y-4">
                <BookOpenText className="w-8 h-8 text-foreground/10 mx-auto" />
                <p className="text-sm text-foreground-secondary">保存当前命盘后即可开启断事笔记</p>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-fade-in">
            {/* 顶栏操作 */}
            <div className="flex items-center justify-between gap-4 border-b-[0.5px] border-border pb-4">
                <div className="flex gap-6">
                    {[
                        { id: 'owner', label: '命主真实反馈' },
                        { id: 'master', label: '师傅专业点评' },
                    ].map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as NotesTab)}
                            className={cx(
                                "text-sm font-bold transition-colors border-b-2 -mb-[18px] pb-4",
                                activeTab === tab.id ? "border-accent text-foreground" : "border-transparent text-foreground-tertiary hover:text-foreground-secondary"
                            )}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex h-9 items-center gap-1.5 rounded-[10px] bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                    {saving ? <SoundWaveLoader variant="inline" /> : <Save className="w-3.5 h-3.5" />}
                    保存
                </button>
            </div>

            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* 左侧：关键事件 */}
                <div>
                    <div className="space-y-6">
                        <div className="flex items-center justify-between text-foreground-tertiary">
                            <div className="flex items-center gap-2">
                                <CalendarDays className="w-4 h-4" />
                                <span className="text-xs font-bold uppercase tracking-[0.2em]">关键事件</span>
                            </div>
                            <button
                                onClick={() => setProfile(prev => ({
                                    ...prev,
                                    events: [{ eventDate: new Date().toISOString().slice(0, 10), category: '其他', title: '', detail: '' }, ...prev.events]
                                }))}
                                className="p-1 hover:bg-background-secondary rounded text-accent transition-colors"
                            >
                                <Plus className="w-4 h-4" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            {profile.events.length === 0 ? (
                                <p className="text-xs text-foreground-tertiary italic py-4">点击上方“+”号添加重要历史事件，辅助 AI 精准断事</p>
                            ) : profile.events.map((ev, idx) => (
                                <div key={idx} className="group rounded-md border border-border/60 px-3 py-3 hover:bg-background-secondary/40 transition-colors">
                                    <div className="flex items-start gap-4">
                                        <input
                                            type="date"
                                            value={ev.eventDate}
                                            onChange={(e) => setProfile(prev => ({
                                                ...prev,
                                                events: prev.events.map((item, i) => i === idx ? { ...item, eventDate: e.target.value } : item)
                                            }))}
                                            className="bg-transparent text-[11px] font-mono text-foreground-secondary outline-none w-24 shrink-0 mt-1 cursor-pointer hover:bg-background rounded px-1 transition-colors"
                                        />
                                        <div className="flex-1 space-y-2">
                                            <div className="flex items-center gap-3">
                                                <select
                                                    value={ev.category}
                                                    onChange={(e) => setProfile(prev => ({
                                                        ...prev,
                                                        events: prev.events.map((item, i) => i === idx ? { ...item, category: e.target.value as BaziCaseEvent['category'] } : item)
                                                    }))}
                                                    className="bg-transparent text-[11px] font-bold text-foreground-secondary uppercase outline-none cursor-pointer hover:bg-background rounded px-1 transition-colors"
                                                >
                                                    {BAZI_CASE_EVENT_CATEGORY_OPTIONS.map((option) => (
                                                        <option key={option} value={option}>{option}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    value={ev.title}
                                                    onChange={(e) => setProfile(prev => ({
                                                        ...prev,
                                                        events: prev.events.map((item, i) => i === idx ? { ...item, title: e.target.value } : item)
                                                    }))}
                                                    placeholder="事件标题..."
                                                    className="w-full bg-transparent text-sm font-bold text-foreground/80 outline-none placeholder:text-foreground/15"
                                                />
                                            </div>
                                            <textarea
                                                value={ev.detail}
                                                onChange={(e) => setProfile(prev => ({
                                                    ...prev,
                                                    events: prev.events.map((item, i) => i === idx ? { ...item, detail: e.target.value } : item)
                                                }))}
                                                placeholder="补充详情..."
                                                rows={2}
                                                className="w-full bg-transparent text-xs leading-6 text-foreground-secondary outline-none resize-none overflow-hidden placeholder:text-foreground/15"
                                            />
                                        </div>
                                        <button
                                            onClick={() => setProfile(prev => ({ ...prev, events: prev.events.filter((_, i) => i !== idx) }))}
                                            className="opacity-0 group-hover:opacity-100 p-1.5 rounded text-foreground-tertiary hover:text-danger hover:bg-danger/10 transition-all"
                                        >
                                            <Trash2 className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* 右侧：属性侧边栏 (Properties) */}
                <div className="space-y-8 pb-10">
                    {activeTab === 'master' ? (
                        <div className="space-y-2">
                            <div className="px-1 text-[10px] font-bold text-foreground-tertiary uppercase tracking-widest mb-4">命理属性</div>
                            <PropertyRow label="旺衰" icon={Sparkles} value={profile.masterReview.strengthLevel} options={BAZI_CASE_STRENGTH_LEVELS} onChange={(v) => setProfile(p => ({ ...p, masterReview: { ...p.masterReview, strengthLevel: v } }))} />
                            
                            <PropertyTags
                                label="格局"
                                options={BAZI_CASE_PATTERN_OPTIONS}
                                values={profile.masterReview.patterns}
                                onChange={(patterns) => setProfile(p => ({ ...p, masterReview: { ...p.masterReview, patterns } }))}
                                allowCustom
                                placeholder="输入格局后按回车，可用逗号或顿号连续输入"
                            />

                            <ElementsPreferences profile={profile} setProfile={setProfile} />
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="px-1 text-[10px] font-bold text-foreground-tertiary uppercase tracking-widest mb-4">基本信息</div>
                            <PropertyRow label="职业" icon={LayoutGrid} value={profile.ownerFeedback.occupation} options={BAZI_CASE_OCCUPATION_OPTIONS} onChange={(v) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, occupation: v ?? null } }))} />
                            <PropertyRow label="学历" icon={BookOpenText} value={profile.ownerFeedback.education} options={BAZI_CASE_EDUCATION_OPTIONS} onChange={(v) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, education: v ?? null } }))} />
                            <PropertyRow label="财富" icon={Sparkles} value={profile.ownerFeedback.wealthLevel} options={BAZI_CASE_WEALTH_LEVEL_OPTIONS} onChange={(v) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, wealthLevel: v ?? null } }))} />
                            <PropertyRow label="婚姻" icon={Tag} value={profile.ownerFeedback.marriageStatus} options={BAZI_CASE_MARRIAGE_STATUS_OPTIONS} onChange={(v) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, marriageStatus: v ?? null } }))} />
                            <PropertyRow label="健康" icon={Sparkles} value={profile.ownerFeedback.healthStatus} options={BAZI_CASE_HEALTH_STATUS_OPTIONS} onChange={(v) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, healthStatus: v ?? null } }))} />
                            
                            <div className="pt-4 border-t-[0.5px] border-border">
                                <PropertyTags
                                    label="六亲反馈"
                                    options={BAZI_CASE_FAMILY_TAG_OPTIONS}
                                    values={profile.ownerFeedback.familyStatusTags}
                                    onChange={(tags) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, familyStatusTags: tags } }))}
                                    colorClass="bg-accent/10 text-accent border-accent/20"
                                    allowCustom
                                    placeholder="可补充父子关系紧张、婆媳牵绊等"
                                />
                                <PropertyTags
                                    label="性格印证"
                                    options={BAZI_CASE_TEMPERAMENT_TAG_OPTIONS}
                                    values={profile.ownerFeedback.temperamentTags}
                                    onChange={(tags) => setProfile(p => ({ ...p, ownerFeedback: { ...p.ownerFeedback, temperamentTags: tags } }))}
                                    colorClass="bg-success/10 text-success border-success/20"
                                    allowCustom
                                    placeholder="可补充嘴硬心软、执行力强等"
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
