/**
 * 帮助：常见问题与联系方式
 *
 * 'use client' 标记说明：
 * - 需要 useState 记录当前展开的问题
 */
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Github, Mail } from 'lucide-react';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_LIST: FAQItem[] = [
  {
    question: 'AI 服务是否免费？',
    answer: 'AI 服务目前基于公益站提供，用户可以免费使用，但会存在次数限制或模型不可访问等情况。如果公益站关闭，AI 服务可能会受到影响，我们会尽力寻找替代方案。',
  },
  {
    question: 'AI 对话次数有多少？',
    answer: '每次 AI 对话或解读消耗 1 积分，请求失败会退回。积分上限随会员等级为 10 / 20 / 50，可在「订阅」里每日签到（免费用户随机 1–3 积分，Plus 翻倍，Pro 三倍）或用激活码补充。使用自定义模型（自己的 API Key）不消耗积分。',
  },
  {
    question: 'AI 分析结果为什么有时不够准确？',
    answer: 'AI 分析基于大量数据和算法，但仍可能存在误差。建议结合自身情况和专业命理师建议综合参考。',
  },
  {
    question: '为什么我的日运/月运功能缺少了？',
    answer: '日运、月运和每日早报都依据默认八字命盘生成。没有设置默认命盘时无法给出个性化分析，请先在「设置 › 命盘」中把一张八字命盘设为默认。',
  },
  {
    question: '为什么真太阳时和出生时间不一致？',
    answer: '真太阳时会根据出生地经度进行校正，因此可能与填写的出生时间不同。真太阳时计算依赖高德地图 API，额度不足时也可能出现误差。',
  },
  {
    question: '紫微斗数和八字有什么区别？',
    answer: '八字命理基于天干地支推算命运，侧重五行生克；紫微斗数则以紫微星系与十二宫位分析人生不同领域。两者各有特色，可互相参照。',
  },
];

const SUPPORT_EMAIL = 'support@mingai.fun';
const PROJECT_REPO_URL = 'https://github.com/hhszzzz/taibu';
const CONTACT_LINK = 'inline-flex h-10 min-w-0 items-center gap-2 rounded-[10px] border border-border-hover px-3.5 text-sm text-foreground transition-colors duration-150 hover:bg-background-secondary';
const FOOTER_LINK = 'text-foreground-secondary underline decoration-border-hover underline-offset-4 transition-colors duration-150 hover:text-foreground';

export default function HelpPanel() {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-9">
      <section aria-labelledby="help-faq-heading" className="flex flex-col gap-3">
        <h3 id="help-faq-heading" className="text-[13px] font-medium text-foreground-tertiary">常见问题</h3>
        <div className="overflow-hidden rounded-[14px] border border-border bg-surface">
          {FAQ_LIST.map((faq, index) => {
            const expanded = expandedFAQ === index;
            const answerId = `help-faq-answer-${index}`;
            return (
              <div key={faq.question} className="[&+div]:border-t [&+div]:border-border">
                <h4>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={answerId}
                    onClick={() => setExpandedFAQ(expanded ? null : index)}
                    className={`flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left text-[15px] text-foreground transition-colors duration-150 hover:bg-background-secondary/60 ${expanded ? 'font-medium' : ''}`}
                  >
                    {faq.question}
                    <ChevronDown aria-hidden="true" className={`h-4 w-4 flex-shrink-0 text-foreground-tertiary transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
                  </button>
                </h4>
                <div id={answerId} hidden={!expanded} className="px-5 pb-5 text-sm leading-[1.75] text-foreground-secondary">
                  {faq.answer}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="help-contact-heading" className="flex flex-col gap-3">
        <h3 id="help-contact-heading" className="text-[13px] font-medium text-foreground-tertiary">联系我们</h3>
        <div className="flex flex-col gap-4 rounded-[14px] border border-border bg-surface p-5">
          <p className="text-pretty text-sm leading-relaxed text-foreground">没有找到答案？可以发邮件，或在 GitHub 仓库提 Issue。</p>
          <div className="flex flex-wrap gap-2">
            <a href={`mailto:${SUPPORT_EMAIL}`} className={CONTACT_LINK}>
              <Mail aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-foreground-secondary" />
              <span className="truncate">{SUPPORT_EMAIL}</span>
            </a>
            <a href={PROJECT_REPO_URL} target="_blank" rel="noreferrer" className={CONTACT_LINK}>
              <Github aria-hidden="true" className="h-4 w-4 flex-shrink-0 text-foreground-secondary" />
              <span className="truncate">github.com/hhszzzz/taibu</span>
            </a>
          </div>
        </div>
      </section>

      <footer className="flex justify-center gap-6 border-t border-border pt-5 text-[13px]">
        <Link href="/privacy" className={FOOTER_LINK}>隐私政策</Link>
        <Link href="/terms" className={FOOTER_LINK}>服务条款</Link>
      </footer>
    </div>
  );
}
