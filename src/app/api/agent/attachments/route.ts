import { randomUUID,createHash } from 'node:crypto';
import sharp from 'sharp';
import { type NextRequest } from 'next/server';
import { getSystemAdminClient,jsonError,jsonOk,readUploadedFile,requireUserContext } from '@/lib/api-utils';
import { ATTACHMENT_BUCKET,attachmentDto,insertAgentAttachment,markAgentAttachmentReady,type AttachmentRow } from '@/lib/agent/attachments.server';
import { MAX_DOCUMENT_BYTES } from '@/lib/ai/document-formats';
import { DOCUMENT_TEXT_RATE_LIMIT,DocumentTextError,documentTextErrorStatus,extractDocumentText } from '@/lib/ai/document-text.server';
import { checkRateLimit } from '@/lib/rate-limit';
export const runtime='nodejs';
export async function POST(request:NextRequest){
    const auth=await requireUserContext(request);
    if('error' in auth) return jsonError(auth.error.message,auth.error.status);
    if(process.env.AGENT_ATTACHMENTS_ENABLED==='false') return jsonError('资料附件已关闭',503);
    // Images share the document size limit.
    const upload=await readUploadedFile(request,MAX_DOCUMENT_BYTES);
    if('error' in upload) return jsonError(upload.error.message,upload.error.status);
    const file=upload.file;
    let bytes=Buffer.from(await file.arrayBuffer());let name=file.name.slice(0,200);let kind:'image'|'text';let mime:string;let width:number|undefined;let height:number|undefined;
    if(file.type.startsWith('image/')){
        try {
            const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'});
            const metadata=await image.metadata();
            if(!['jpeg','png','webp'].includes(metadata.format??'') || !metadata.width || !metadata.height || metadata.pages && metadata.pages>1) return jsonError('仅支持静态 JPEG、PNG、WebP 图片',400);
            const resized=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer({resolveWithObject:true});
            bytes=resized.data;width=resized.info.width;height=resized.info.height;mime='image/jpeg';kind='image';
        }catch{return jsonError('文件格式或尺寸无效',400);}
    } else {
        if(!(await checkRateLimit(auth.user.id,DOCUMENT_TEXT_RATE_LIMIT.endpoint,DOCUMENT_TEXT_RATE_LIMIT)).allowed) return jsonError('请求过于频繁，请稍后再试',429);
        try {
            const document=await extractDocumentText({name:file.name,bytes},request.signal);
            bytes=Buffer.from(document.text,'utf-8');name=document.name;mime='text/plain';kind='text';
        }catch(error){
            if(error instanceof DocumentTextError) return jsonError(error.message,documentTextErrorStatus(error),{code:error.code});
            if(!request.signal.aborted) console.error('[agent/attachments]',error instanceof Error?error.name:typeof error);
            return jsonError('文件解析失败，请重试',500);
        }
    }
    const id=randomUUID();
    const row={id,user_id:auth.user.id,object_path:`${auth.user.id}/${id}`,name,kind,mime_type:mime,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width,height,status:'uploading'};
    try { await insertAgentAttachment(row); }
    catch { return jsonError('创建资料失败',500); }
    const uploaded=await getSystemAdminClient().storage.from(ATTACHMENT_BUCKET).upload(row.object_path,bytes,{contentType:mime,upsert:false});
    if(uploaded.error) return jsonError('上传失败，请重试',500);
    let saved: AttachmentRow;
    try { saved=await markAgentAttachmentReady(id); }
    catch { return jsonError('资料保存失败，请重试',500); }
    return jsonOk({attachment:attachmentDto(saved)},201);
}
