import 'server-only';
import { createHash } from 'node:crypto';
import { systemDb,type ScopedDb } from '@/lib/db/context.server';
import { getSystemAdminClient } from '@/lib/supabase-server';
import type { ModelMessage } from 'ai';
import type { PrivateAttachment } from '@/types';
import { ATTACHMENT_MARKER } from './attachment-input';
export const ATTACHMENT_BUCKET = 'agent-attachments';
export type AttachmentRow = { id:string;user_id:string;object_path:string;name:string;kind:'image'|'text';mime_type:string;size:number;sha256:string;width?:number;height?:number;status:string };
export function attachmentDto(row:AttachmentRow):PrivateAttachment { return { id:row.id,name:row.name,kind:row.kind,mimeType:row.mime_type,size:row.size,sha256:row.sha256,width:row.width,height:row.height }; }
export async function validateAttachmentIds(db:ScopedDb,userId:string,value:unknown):Promise<AttachmentRow[]> {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length>12 || value.some(id => typeof id!=='string' || !/^[0-9a-f-]{36}$/iu.test(id)) || new Set(value).size!==value.length) throw new Error('资料引用无效');
    if (!value.length) return [];
    const data=await db.tx(trx=>trx.selectFrom('agent_attachments').selectAll()
        .where('user_id','=',userId).where('status','=','ready').where('id','in',value as string[]).execute());
    if(data.length!==value.length) throw new Error('资料不存在、已过期或无权访问');
    if(data.filter(row=>row.kind==='image').length>4) throw new Error('每条消息最多 4 张图片');
    return data as unknown as AttachmentRow[];
}
export async function attachmentBytes(row:AttachmentRow):Promise<Uint8Array> {
    const {data,error}=await getSystemAdminClient().storage.from(ATTACHMENT_BUCKET).download(row.object_path);
    if(error || !data) throw new Error('读取资料失败');
    const bytes=new Uint8Array(await data.arrayBuffer());
    if(bytes.length!==row.size || createHash('sha256').update(bytes).digest('hex')!==row.sha256) throw new Error('资料完整性校验失败');
    return bytes;
}
export async function resolveAttachmentImages(db:ScopedDb,userId:string,conversationId:string,messages:ModelMessage[]):Promise<ModelMessage[]> {
    const cache=new Map<string,Promise<Uint8Array>>();
    const output: ModelMessage[] = [];
    let totalBytes = 0;
    for (const message of messages) {
        if(message.role!=='user' || typeof message.content!=='string') { output.push(message); continue; }
        const ids=[...message.content.matchAll(ATTACHMENT_MARKER)].map(match=>match[1]);
        if(!ids.length) { output.push(message); continue; }
        const rows=await validateAttachmentIds(db,userId,[...new Set(ids)]);
        const imageRows=rows.filter(row=>row.kind==='image');
        if(!imageRows.length) { output.push(message); continue; }
        const refs=await db.tx(trx=>trx.selectFrom('agent_attachment_refs').select('attachment_id')
            .where('conversation_id','=',conversationId).where('attachment_id','in',imageRows.map(row=>row.id)).execute());
        if(refs.length!==imageRows.length) throw new Error('图片未绑定当前会话');
        const images=await Promise.all(imageRows.map(async row=>{
            let bytes=cache.get(row.id);
            if (!bytes) {
                totalBytes += row.size;
                if (totalBytes > 64 * 1024 * 1024) throw new Error('本轮图片资料过多，请压缩对话后重试');
                bytes=attachmentBytes(row); cache.set(row.id,bytes);
            }
            return {type:'image' as const,image:await bytes,mediaType:row.mime_type};
        }));
        output.push({role:'user' as const,content:[{type:'text' as const,text:message.content},...images]});
    }
    return output;
}
export type AttachmentInsert = Omit<AttachmentRow,'width'|'height'|'status'> & {width?:number;height?:number;status:string};
/** Attachment rows are written by the system context because `agent_attachments` has no user-facing write policy. */
export async function insertAgentAttachment(row:AttachmentInsert):Promise<void> {
    await systemDb().tx(trx=>trx.insertInto('agent_attachments').values(row).execute());
}
export async function markAgentAttachmentReady(id:string):Promise<AttachmentRow> {
    return await systemDb().tx(trx=>trx.updateTable('agent_attachments').set({status:'ready'}).where('id','=',id).returningAll().executeTakeFirstOrThrow()) as unknown as AttachmentRow;
}
export async function cleanupAgentAttachments():Promise<number> {
    const db=systemDb();
    const data=await db.rpc('claim_agent_attachment_cleanup',{p_limit:50});
    let removed=0;
    for(const row of data as unknown as AttachmentRow[]){
        const result=await getSystemAdminClient().storage.from(ATTACHMENT_BUCKET).remove([row.object_path]);
        if(result.error) continue;
        await db.tx(trx=>trx.deleteFrom('agent_attachments').where('id','=',row.id).where('status','=','deleting').execute());
        removed++;
    }
    return removed;
}
