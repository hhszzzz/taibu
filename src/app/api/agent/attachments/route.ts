import { randomUUID,createHash } from 'node:crypto';
import sharp from 'sharp';
import { type NextRequest } from 'next/server';
import { jsonError,jsonOk,requireUserContext } from '@/lib/api-utils';
import { ATTACHMENT_IMAGE_FORMATS,ATTACHMENT_MAX_FILE_BYTES,ATTACHMENT_MAX_REQUEST_BYTES,ATTACHMENT_TEXT_EXTENSION_PATTERN,attachmentDto,insertAgentAttachment,markAgentAttachmentReady,uploadAttachmentBytes,type AttachmentRow } from '@/lib/agent/attachments.server';
export const runtime='nodejs';
export async function POST(request:NextRequest){
    const auth=await requireUserContext(request);
    if('error' in auth) return jsonError(auth.error.message,auth.error.status);
    if(process.env.AGENT_ATTACHMENTS_ENABLED==='false') return jsonError('资料附件已关闭',503);
    const reader=request.body?.getReader(); if(!reader) return jsonError('请选择文件',400);
    const chunks:Uint8Array[]=[];let total=0;
    try { while(true){const next=await reader.read();if(next.done) break;total+=next.value.length;if(total>ATTACHMENT_MAX_REQUEST_BYTES){await reader.cancel();return jsonError('文件超过 10MB 限制',413);}chunks.push(next.value);} } finally { reader.releaseLock(); }
    let form:FormData;try{form=await new Response(Buffer.concat(chunks),{headers:{'Content-Type':request.headers.get('content-type')??''}}).formData();}catch{return jsonError('文件请求无效',400);}
    const file=form.get('file');if(!(file instanceof File) || !file.size || file.size>ATTACHMENT_MAX_FILE_BYTES) return jsonError('文件大小无效（最多 10MB）',400);
    let bytes=Buffer.from(await file.arrayBuffer());let kind:'image'|'text';let mime:string;let width:number|undefined;let height:number|undefined;
    try {
        if(file.type.startsWith('image/')){
            const image=sharp(bytes,{limitInputPixels:40_000_000,failOn:'error'});
            const metadata=await image.metadata();
            if(!(ATTACHMENT_IMAGE_FORMATS as readonly string[]).includes(metadata.format??'') || !metadata.width || !metadata.height || metadata.pages && metadata.pages>1) return jsonError('仅支持静态 JPEG、PNG、WebP 图片',400);
            const resized=await image.rotate().resize({width:2048,height:2048,fit:'inside',withoutEnlargement:true}).jpeg({quality:88}).toBuffer({resolveWithObject:true});
            bytes=resized.data;width=resized.info.width;height=resized.info.height;mime='image/jpeg';kind='image';
        } else {
            if(bytes.length>2*1024*1024 || !(file.type.startsWith('text/') || ATTACHMENT_TEXT_EXTENSION_PATTERN.test(file.name))) return jsonError('请使用文本资料，其他文档由已有提取流程解析',400);
            const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(text.includes('\u0000')) return jsonError('文本包含二进制数据',400);
            bytes=Buffer.from(text,'utf-8');mime='text/plain';kind='text';
        }
    }catch{return jsonError('文件格式或尺寸无效',400);}
    const id=randomUUID();
    const row={id,user_id:auth.user.id,object_path:`${auth.user.id}/${id}`,name:file.name.slice(0,200),kind,mime_type:mime,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),width,height,status:'uploading'};
    try { await insertAgentAttachment(row); }
    catch { return jsonError('创建资料失败',500); }
    try { await uploadAttachmentBytes(row.object_path,bytes,mime); }
    catch(error) { console.error('上传附件失败:',error); return jsonError('上传失败，请重试',500); }
    let saved: AttachmentRow;
    try { saved=await markAgentAttachmentReady(id); }
    catch { return jsonError('资料保存失败，请重试',500); }
    return jsonOk({attachment:attachmentDto(saved)},201);
}
