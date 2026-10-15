/**
 * 面相 / 手相共用的照片校验与压缩
 *
 * 上传前在浏览器端校验，并把照片压成最长边 1024px 的 JPEG，减小视觉模型请求体积。
 * 纯函数可在 Node 中测试；preparePhoto 依赖 DOM，只在客户端调用。
 */

export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const PHOTO_MAX_EDGE = 1024;
const PHOTO_JPEG_QUALITY = 0.8;

export interface PreparedPhoto {
    /** 用于预览的 data URL */
    dataUrl: string;
    /** 去掉 data URL 前缀后的 base64，直接作为接口的 imageBase64 */
    base64: string;
    mimeType: 'image/jpeg';
}

/** 返回面向用户的错误文案；文件可用时返回 null。 */
export function validatePhotoFile(file: Pick<File, 'type' | 'size'>): string | null {
    if (!file.type.startsWith('image/')) return '请上传图片文件';
    if (file.size > PHOTO_MAX_BYTES) return '图片大小不能超过 10MB';
    return null;
}

/** 等比缩放到最长边不超过 maxEdge，只缩小不放大；尺寸至少为 1px。 */
export function fitPhotoSize(width: number, height: number, maxEdge: number = PHOTO_MAX_EDGE): { width: number; height: number } {
    const longest = Math.max(width, height);
    const scale = longest > maxEdge ? maxEdge / longest : 1;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale)),
    };
}

/** 读取并压缩照片；读取或解码失败时以带用户文案的 Error 拒绝。 */
export function preparePhoto(file: File): Promise<PreparedPhoto> {
    return new Promise((resolve, reject) => {
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('无法读取这张图片，请换一张 JPG 或 PNG 照片'));
        };
        image.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const { width, height } = fitPhotoSize(image.naturalWidth, image.naturalHeight);
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const context = canvas.getContext('2d');
            if (!context) {
                reject(new Error('无法处理图片，请稍后重试'));
                return;
            }
            // 透明 PNG 转 JPEG 时默认变黑，先铺白底
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, width, height);
            context.drawImage(image, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_QUALITY);
            resolve({ dataUrl, base64: dataUrl.slice(dataUrl.indexOf(',') + 1), mimeType: 'image/jpeg' });
        };
        image.src = objectUrl;
    });
}
