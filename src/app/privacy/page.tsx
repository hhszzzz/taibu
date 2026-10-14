/**
 * 隐私政策页面
 *
 * 阐述太卜如何收集、使用、保护用户个人信息
 */
import type { Metadata } from 'next';
import { LegalDocument, type LegalDocumentContent } from '@/components/common/LegalDocument';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';

export const metadata: Metadata = { title: '隐私政策' };

const PRIVACY_POLICY: LegalDocumentContent = {
    title: '隐私政策',
    updatedAt: '2026 年 2 月 13 日',
    intro: '太卜（以下简称"我们"）非常重视用户的隐私保护。本隐私政策阐述了我们如何收集、使用、存储和保护您的个人信息。我们承诺按照相关法律法规的要求，为用户提供安全可靠的服务。',
    sections: [
        {
            id: 'collection',
            title: '信息收集',
            lead: '我们可能会收集以下类型的个人信息：',
            items: [
                { term: '账户信息', text: '包括邮箱地址、昵称、头像等注册信息' },
                { term: '出生信息', text: '用于命理分析，包括出生日期、出生时间、出生地点等' },
                { term: '使用数据', text: '包括使用记录、对话历史、查询历史等' },
                { term: '设备信息', text: '包括设备类型、操作系统、浏览器类型等' },
            ],
        },
        {
            id: 'usage',
            title: '信息使用',
            lead: '我们收集的信息将用于以下目的：',
            items: [
                '提供、运营和维护我们的服务',
                '生成个性化的命理分析报告和建议',
                '改进我们的服务质量和用户体验',
                '向您发送服务通知、更新信息和营销内容',
                '处理您的账户安全和防止欺诈行为',
            ],
        },
        {
            id: 'protection',
            title: '信息保护',
            lead: '我们采用多种安全措施来保护您的个人信息：',
            items: [
                '使用 SSL/TLS 加密技术保护数据传输',
                '实施严格的访问控制和权限管理',
                '定期进行安全审计和漏洞检测',
                '存储用户敏感信息时使用加密处理',
            ],
        },
        {
            id: 'sharing',
            title: '信息共享',
            lead: '我们不会出售、交易或以其他方式转让您的个人信息给第三方，以下情况除外：',
            items: [
                '经您同意后，与服务提供商共享必要信息',
                '遵守法律法规或政府机构的合法要求',
                '保护我们或用户的权利、财产或安全',
            ],
        },
        {
            id: 'rights',
            title: '用户权利',
            lead: '根据适用的数据保护法律，您享有以下权利：',
            items: [
                '访问您的个人信息和使用记录',
                '更正不准确或不完整的个人信息',
                '删除您的个人信息和账户',
                '撤回您对信息处理的同意',
                '导出您的个人数据',
            ],
        },
        {
            id: 'updates',
            title: '政策更新',
            paragraphs: [
                '我们可能会不时更新本隐私政策。更新后的政策将在本页面上公布，并标明最新修订日期。我们鼓励您定期查阅本页面，以了解我们如何保护您的信息。如有重大变更，我们将通过电子邮件或网站公告的方式通知您。',
            ],
        },
        {
            id: 'contact',
            title: '联系我们',
            paragraphs: ['如果您对本隐私政策有任何疑问、意见或建议，欢迎随时联系我们。'],
            email: 'support@mingai.fun',
        },
    ],
};

export default function PrivacyPage() {
    return <LegalDocument content={PRIVACY_POLICY} backHref={getSettingsCenterRouteTarget('help')} backLabel="帮助" />;
}
