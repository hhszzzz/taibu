/**
 * 聊天消息工具函数
 */

/**
 * 从可能带有附件与联网搜索前缀的用户消息中提取原始问题
 */
export function extractUserQuestion(rawUserContent: string): string {
    const marker = '【用户的问题如下】';
    const index = rawUserContent.lastIndexOf(marker);
    if (index >= 0) {
        return rawUserContent.slice(index + marker.length).trim();
    }
    return rawUserContent.trim();
}
