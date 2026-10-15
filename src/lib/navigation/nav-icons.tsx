/**
 * Single-stroke navigation icons for divination methods and tools.
 *
 * They follow the design boards: 24px grid, 1.6 stroke, round caps, currentColor,
 * so they sit at the same visual weight as the surrounding sidebar text.
 */
import type { ReactNode } from 'react';

type NavIconProps = { className?: string; size?: number | string };

function createNavIcon(name: string, body: ReactNode, strokeWidth = 1.6) {
    function Icon({ className, size = 24 }: NavIconProps) {
        return (
            <svg
                aria-hidden
                width={size}
                height={size}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={className}
            >
                {body}
            </svg>
        );
    }
    Icon.displayName = `NavIcon(${name})`;
    return Icon;
}

export const BaziIcon = createNavIcon('bazi', <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a4.5 4.5 0 0 1 0 9 4.5 4.5 0 0 0 0 9" />
</>);

export const HepanIcon = createNavIcon('hepan', <>
    <circle cx="9" cy="12" r="6" />
    <circle cx="15" cy="12" r="6" />
</>);

export const ZiweiIcon = createNavIcon('ziwei', <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z" />);

export const TarotIcon = createNavIcon('tarot', <>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <circle cx="12" cy="12" r="3" />
</>);

export const LiuyaoIcon = createNavIcon('liuyao', <path d="M5 5h14M5 9.7h5M14 9.7h5M5 14.3h14M5 19h5M14 19h5" />, 1.8);

export const QimenIcon = createNavIcon('qimen', <>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16" />
</>);

export const DaliurenIcon = createNavIcon('daliuren', <>
    <circle cx="12" cy="12" r="9" />
    <rect x="8" y="8" width="8" height="8" rx="1" />
</>);

export const MeihuaIcon = createNavIcon('meihua', <>
    <circle cx="12" cy="6.8" r="2.7" />
    <circle cx="6.9" cy="10.6" r="2.7" />
    <circle cx="17.1" cy="10.6" r="2.7" />
    <circle cx="8.9" cy="16.7" r="2.7" />
    <circle cx="15.1" cy="16.7" r="2.7" />
</>);

export const XiaoliurenIcon = createNavIcon('xiaoliuren', <>
    <circle cx="6" cy="18" r="2" />
    <circle cx="12" cy="7" r="2" />
    <circle cx="18" cy="16" r="2" />
    <path d="M7.2 16.4l3.6-7.6M13.6 8.4l3.4 6" />
</>);

export const FaceIcon = createNavIcon('face', <>
    <ellipse cx="12" cy="12" rx="7" ry="9" />
    <path d="M9.5 10.5h.01M14.5 10.5h.01M9.5 15.5q2.5 1.8 5 0" />
</>);

export const PalmIcon = createNavIcon('palm', <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11V5.5a1.5 1.5 0 0 1 3 0V13M8 13l-1.6-2a1.5 1.5 0 0 0-2.4 1.8L7 17a6 6 0 0 0 5 3h1a5 5 0 0 0 5-5v-2" />);

export const MbtiIcon = createNavIcon('mbti', <>
    <rect x="4" y="4" width="16" height="16" rx="3" />
    <path d="M12 4v16M4 12h16" />
</>);

export const DailyIcon = createNavIcon('daily', <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
</>);

export const MonthlyIcon = createNavIcon('monthly', <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);

export const RecordsIcon = createNavIcon('records', <>
    <path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4z" />
    <path d="M8 9h8M8 13h6" />
</>);

export const CommunityIcon = createNavIcon('community', <>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M3 20a6 6 0 0 1 12 0" />
    <path d="M16 4.5a3.5 3.5 0 0 1 0 7M21 20a6 6 0 0 0-4-5.6" />
</>);
