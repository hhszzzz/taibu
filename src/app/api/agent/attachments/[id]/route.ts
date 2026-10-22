import { type NextRequest } from 'next/server';
import { jsonError,jsonOk,requireUserContext } from '@/lib/api-utils';
import { isValidUUID } from '@/lib/validation';
import { attachmentDto,attachmentBytes,validateAttachmentIds } from '@/lib/agent/attachments.server';
export async function GET(request:NextRequest,{params}:{params:Promise<{id:string}>}){
    const auth=await requireUserContext(request);if('error' in auth) return jsonError(auth.error.message,auth.error.status);
    const {id}=await params;if(!isValidUUID(id)) return jsonError('资料 ID 无效',400);
    const db=auth.db;
    try{
        const [row]=await validateAttachmentIds(db,auth.user.id,[id]);
        if(request.nextUrl.searchParams.get('content')==='1'){
            const bytes=await attachmentBytes(row);
            if(row.kind==='image') return new Response(Buffer.from(bytes),{headers:{'Content-Type':row.mime_type,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
            const text=new TextDecoder().decode(bytes);const offset=Math.max(0,Math.min(text.length,Number(request.nextUrl.searchParams.get('offset'))||0));const length=Math.min(16000,Math.max(1,Number(request.nextUrl.searchParams.get('length'))||8000));
            return jsonOk({attachment:attachmentDto(row),text:text.slice(offset,offset+length),offset,total:text.length,nextOffset:offset+length<text.length?offset+length:null});
        }
        return jsonOk({attachment:attachmentDto(row)});
    }catch{return jsonError('资料不存在、已过期或无权访问',404);}
}
