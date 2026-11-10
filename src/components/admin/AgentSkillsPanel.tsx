/**
 * 平台技能：管理员添加的 Agent 技能，对所有用户开放。
 *
 * 'use client' 标记说明：
 * - 列表与编辑交给 SkillManager
 */
'use client';

import { SkillManager } from '@/components/settings/skills/SkillManager';
import { BuiltinMethods } from '@/components/settings/skills/BuiltinMethods';

const notice = () => (
  <p className="mcp-notice">
    技能按 pi 的 SKILL.md 格式编写。系统提示只列出名称和描述，Agent 在相关任务中用 load_skill 加载正文，用 read_skill_file 读取附属文件；用户也可以在输入框用 /skill:名称 直接调用。用户自己的同名技能不会生效。关闭工具范围里的「技能」会停用全部技能。
  </p>
);

export function AgentSkillsPanel() {
  return (
    <div className="flex flex-col gap-6">
      <SkillManager
        scope="platform"
        notice={notice}
        empty={{ title: '还没有平台技能', detail: '粘贴一份 SKILL.md，或上传包含 SKILL.md 的文件夹。' }}
      />
      <BuiltinMethods />
    </div>
  );
}
