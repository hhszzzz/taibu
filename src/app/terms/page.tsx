/**
 * 服务条款页面
 *
 * 阐述太卜服务的使用条款和条件
 */
import type { Metadata } from 'next';
import { LegalDocument, type LegalDocumentContent } from '@/components/common/LegalDocument';
import { getSettingsCenterRouteTarget } from '@/lib/settings-center';

export const metadata: Metadata = { title: '服务条款' };

const TERMS_OF_SERVICE: LegalDocumentContent = {
    title: '服务条款',
    updatedAt: '2026 年 2 月 13 日',
    intro: '欢迎使用太卜（以下简称"本服务"）。本服务条款是您与太卜之间的法律协议，规定了使用本服务的条款和条件。在使用本服务前，请仔细阅读以下条款。您使用本服务即表示您同意接受本服务条款的约束。',
    sections: [
        {
            id: 'services',
            title: '服务说明',
            lead: '太卜提供以下命理相关服务：',
            items: [
                '八字命理排盘与分析',
                '紫微斗数命盘分析',
                '塔罗占卜与六爻占卜',
                'AI 智能对话与命理咨询',
                '每日/每月运势预测',
                '面相、手相分析',
                'MBTI 人格测试与分析',
            ],
            paragraphs: ['我们保留随时修改、暂停或终止任何服务的权利，并将通过适当的方式通知用户。'],
        },
        {
            id: 'eligibility',
            title: '用户资格',
            lead: '使用本服务，您必须：',
            items: [
                '年满 18 周岁，或已获得监护人的同意',
                '具有签订法律协议的完全行为能力',
                '同意本服务条款和隐私政策',
                '提供真实、准确的注册信息',
            ],
        },
        {
            id: 'obligations',
            title: '用户义务',
            lead: '您在使用本服务时，不得：',
            items: [
                '违反任何适用的法律法规',
                '侵犯他人知识产权、隐私权或其他合法权益',
                '上传或传播病毒、木马或其他恶意代码',
                '试图未经授权访问本服务或相关系统',
                '进行任何可能损害、干扰本服务正常运作的行为',
                '将本服务用于任何商业目的（除非获得明确授权）',
            ],
        },
        {
            id: 'disclaimer',
            title: '免责声明',
            lead: '本服务按"现状"提供，我们不做任何明示或暗示的保证：',
            items: [
                '本服务的内容、分析和建议仅供参考，不构成任何决策依据',
                '命理分析结果仅供参考，不能替代专业的人生建议',
                '我们不保证服务完全不中断或无错误',
                '对于因使用本服务造成的任何直接或间接损失，我们不承担责任',
            ],
            paragraphs: ['用户应理性看待命理分析结果，将其作为参考而非决策的唯一依据。'],
        },
        {
            id: 'ip',
            title: '知识产权',
            paragraphs: [
                '本服务及其内容（包括但不限于文字、图片、图标、设计、代码）的知识产权归太卜所有或已获得合法授权。未经我们书面许可，您不得复制、修改、传播、公开展示或使用本服务的任何内容。我们尊重他人的知识产权，如果您认为您的作品被侵权，请联系我们进行处理。',
            ],
        },
        {
            id: 'termination',
            title: '终止服务',
            paragraphs: [
                '我们保留在任何时候终止或暂停您对本服务的访问权限的权利，无需事先通知。如果您违反本服务条款，我们可能会立即终止您的账户。对于已付费的会员服务，终止后我们不会退还剩余费用。您也可以随时通过账户设置删除您的账户。',
            ],
        },
        {
            id: 'updates',
            title: '条款更新',
            paragraphs: [
                '我们可能会不时更新本服务条款。更新后的条款将在本页面上公布，并标明最新修订日期。我们鼓励您定期查阅本页面，以了解最新的服务条款。如有重大变更，我们将通过电子邮件或网站公告的方式通知您。继续使用本服务即表示您接受更新后的条款。',
            ],
        },
        {
            id: 'contact',
            title: '联系我们',
            paragraphs: ['如果您对本服务条款有任何疑问，欢迎随时联系我们。'],
            email: 'support@mingai.fun',
        },
    ],
};

export default function TermsPage() {
    return <LegalDocument content={TERMS_OF_SERVICE} backHref={getSettingsCenterRouteTarget('help')} backLabel="帮助" />;
}
