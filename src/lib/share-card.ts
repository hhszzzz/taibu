/**
 * 运势分享卡片图片生成工具
 * 
 * 使用 html2canvas 将运势卡片内容转换为可分享的图片
 */

import html2canvas from 'html2canvas';

export interface ShareCardOptions {
    /** 卡片容器元素 */
    element: HTMLElement;
    /** 图片质量 (0-1) */
    quality?: number;
    /** 背景色，默认白色 */
    backgroundColor?: string;
    /** 缩放比例，默认 2 以获得高清图 */
    scale?: number;
}

/**
 * 将 DOM 元素转换为图片 Blob
 */
async function captureToBlob(options: ShareCardOptions): Promise<Blob> {
    const {
        element,
        quality = 0.95,
        backgroundColor = '#ffffff',
        scale = 2
    } = options;

    const canvas = await html2canvas(element, {
        backgroundColor,
        scale,
        useCORS: true,
        logging: false,
        allowTaint: true,
    });

    return new Promise((resolve, reject) => {
        canvas.toBlob(
            (blob) => {
                if (blob) {
                    resolve(blob);
                } else {
                    reject(new Error('无法生成图片'));
                }
            },
            'image/png',
            quality
        );
    });
}

/**
 * 下载分享卡片图片
 */
export async function downloadShareCard(
    options: ShareCardOptions,
    filename: string = 'fortune-card.png'
): Promise<void> {
    downloadBlob(await captureToBlob(options), filename);
}

function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
}

/**
 * 分享到社交平台（使用 Web Share API，若不支持则下载）
 */
export async function shareCard(
    options: ShareCardOptions,
    shareData: {
        title?: string;
        text?: string;
    } = {}
): Promise<boolean> {
    try {
        const blob = await captureToBlob(options);
        const file = new File([blob], 'fortune-card.png', { type: 'image/png' });

        // 检查是否支持 Web Share API
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            await navigator.share({
                title: shareData.title || '太卜 运势卡片',
                text: shareData.text || '查看我的今日运势',
                files: [file],
            });
            return true;
        }

        // 不支持 Web Share API，退回下载已经生成的图片
        downloadBlob(blob, 'fortune-card.png');
        return false;
    } catch (error) {
        console.error('分享失败:', error);
        throw error;
    }
}
