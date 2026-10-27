import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The chat entry rule as one place: /chat opens in 对话 unless the sidebar asked for the Agent. */
function initialAgentMode(mode: string | null): 'agent' | 'plain' {
    return mode === 'agent' ? 'agent' : 'plain';
}

test('the chat page starts in 对话 mode unless the URL asks for the Agent', () => {
    assert.equal(initialAgentMode(null), 'plain');
    assert.equal(initialAgentMode('plain'), 'plain');
    assert.equal(initialAgentMode('agent'), 'agent');
    // Only the exact value counts; anything else is a normal entry.
    assert.equal(initialAgentMode('Agent'), 'plain');
    assert.equal(initialAgentMode(''), 'plain');
});

test('the messaging hook reads that URL mode and the sidebar is the only writer of ?mode=agent', () => {
    const messaging = readFileSync(resolve(process.cwd(), 'src/lib/chat/use-chat-messaging.ts'), 'utf8');
    assert.match(messaging, /searchParams\.get\('mode'\) === 'agent' \? 'agent' as const : 'plain' as const/u);
    assert.match(messaging, /useAgentChat\(state, userId, refreshViewerState, initialAgentMode\)/u);

    const sidebar = readFileSync(resolve(process.cwd(), 'src/components/layout/Sidebar.tsx'), 'utf8');
    assert.match(sidebar, /router\.push\(mode === 'agent' \? '\/chat\?mode=agent' : '\/chat'\)/u);
});

test('a saved mode is no longer restored on load, and an existing run switches the view to the Agent', () => {
    const hook = readFileSync(resolve(process.cwd(), 'src/lib/agent/use-agent-chat.ts'), 'utf8');
    // No read-back of taibu:agent-mode on mount; only setMode still writes it for the sidebar.
    assert.doesNotMatch(hook, /localStorage\.getItem\(`taibu:agent-mode:/u);
    assert.match(hook, /localStorage\.setItem\(`taibu:agent-mode:/u);
    // Readiness no longer flips the mode; adopting a conversation's run does.
    assert.doesNotMatch(hook, /value\.ready \? "agent" : "plain"/u);
    assert.match(hook, /latestRuns\.current\.set\(view\.conversationId, view\);[\s\S]{0,200}setModeState\("agent"\)/u);
});
