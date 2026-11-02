/**
 * 帮助：常见问题与联系方式
 *
 * 'use client' 标记说明：
 * - 需要 useState 记录当前展开的问题
 */
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import Link from 'next/link';
import { ChevronDown, Github, Mail } from 'lucide-react';
import { useCurrentUserProfile } from '@/lib/hooks/useCurrentUserProfile';

interface FAQItem {
  question: string;
  answer: string;
}

const FAQ_LIST: FAQItem[] = [
  {
    question: 'AI 服务怎么收费？',
    answer: '平台模型按实际用量计费：输入、输出的 token 数乘以模型单价，以美元结算，单价写在模型菜单里；生图按张计费。订阅额度先扣，用完再扣余额。标为「免费」的模型不扣费。使用自己的 API Key 时由你的服务商计费，本站不扣费。',
  },
  {
    question: '余额用完了怎么办？',
    answer: '在「设置 › 钱包」里兑换兑换码、购买订阅，开启在线支付时也可以直接充值。费用在每次调用结束后结算，最后一次调用可能让余额略低于零，下次充值时抵扣。也可以改用免费模型，或在模型菜单里使用自己的 API。',
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
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
const PROJECT_REPO_URL = 'https://github.com/hhszzzz/taibu';
const CONTACT_LINK = 'inline-flex h-10 min-w-0 items-center gap-2 rounded-xl border border-border-hover px-3.5 text-sm text-foreground transition-colors duration-150 hover:bg-background-secondary';
const FOOTER_LINK = 'text-foreground-secondary underline decoration-border-hover underline-offset-4 transition-colors duration-150 hover:text-foreground';

export default function HelpPanel() {
  const [expandedFAQ, setExpandedFAQ] = useState<number | null>(null);
  // The running release is for administrators only.
  const isAdmin = useCurrentUserProfile().profile?.is_admin === true;

  return (
    <div>
      <section aria-labelledby="help-faq-heading" className="settings-section">
        <div className="settings-section-heading">
          <h3 id="help-faq-heading" className="settings-section-title">常见问题</h3>
          <p className="settings-section-description">关于 AI 服务、计费与命盘的常见疑问。</p>
        </div>
        <div className="settings-section-body">
          <div className="overflow-hidden rounded-2xl border border-border bg-surface">
            {FAQ_LIST.map((faq, index) => {
              const expanded = expandedFAQ === index;
              const answerId = `help-faq-answer-${index}`;
              return (
                <div key={faq.question} className="[&+div]:border-t [&+div]:border-border">
                  <h4>
                    <Button unstyled
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={answerId}
                      onClick={() => setExpandedFAQ(expanded ? null : index)}
                      className={`flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left text-[15px] text-foreground transition-colors duration-150 hover:bg-background-secondary/60 ${expanded ? 'font-medium' : ''}`}
                    >
                      {faq.question}
                      <ChevronDown aria-hidden="true" className={`h-4 w-4 flex-shrink-0 text-foreground-tertiary transition-transform duration-150 ${expanded ? 'rotate-180' : ''}`} />
                    </Button>
                  </h4>
                  <div id={answerId} hidden={!expanded} className="px-5 pb-5 text-sm leading-[1.75] text-foreground-secondary">
                    {faq.answer}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section aria-labelledby="help-contact-heading" className="settings-section">
        <div className="settings-section-heading">
          <h3 id="help-contact-heading" className="settings-section-title">联系我们</h3>
          <p className="settings-section-description">没有找到答案时，继续向我们反馈。</p>
        </div>
        <div className="settings-section-body">
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-5">
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
        </div>
      </section>

      <footer className="settings-help-footer">
        <Link href="/privacy" className={FOOTER_LINK}>隐私政策</Link>
        <Link href="/terms" className={FOOTER_LINK}>服务条款</Link>
        {isAdmin && APP_VERSION && (
          <a href={`${PROJECT_REPO_URL}/releases`} target="_blank" rel="noreferrer" className={FOOTER_LINK} aria-label={`版本 ${APP_VERSION}，查看更新记录`}>
            v{APP_VERSION}
          </a>
        )}
      </footer>
    </div>
  );
}
