'use client';

import { useState } from 'react';
import { readSessionJSON, writeSessionJSON } from '@/lib/cache/session-storage';
import type { LiuQin } from '@/lib/divination/liuyao';

type LiuyaoQuestionSession = {
    question: string;
    yongShenTargets: LiuQin[];
};

function readQuestion(): LiuyaoQuestionSession {
    if (typeof window === 'undefined') return { question: '', yongShenTargets: [] };
    const payload = readSessionJSON<LiuyaoQuestionSession | string>('liuyao_question');
    if (!payload) return { question: '', yongShenTargets: [] };
    if (typeof payload === 'string') return { question: payload, yongShenTargets: [] };
    return {
        question: payload.question || '',
        yongShenTargets: Array.isArray(payload.yongShenTargets) ? payload.yongShenTargets : [],
    };
}

/** 六爻入口页带来的所问之事与分析目标；起卦页补选的目标写回会话。 */
export function useLiuyaoQuestion() {
    const [initial] = useState(readQuestion);
    const [yongShenTargets, setTargets] = useState<LiuQin[]>(initial.yongShenTargets);
    const question = initial.question;

    const setYongShenTargets = (targets: LiuQin[]) => {
        setTargets(targets);
        writeSessionJSON('liuyao_question', { question, yongShenTargets: targets });
    };

    return {
        question,
        yongShenTargets,
        setYongShenTargets,
        /** 填了问题却没选目标时，必须先补选才能起卦。 */
        needsTargets: question.trim().length > 0 && yongShenTargets.length === 0,
    };
}
