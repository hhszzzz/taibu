import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildVisualSrcdoc,
    clampVisualHeight,
    VISUAL_FRAME_CSP,
    VISUAL_FRAME_MAX_HEIGHT,
    VISUAL_FRAME_MIN_HEIGHT,
} from '@/lib/visualization/visual-frame';

test('visual srcdoc carries the sandbox CSP, theme variables, content and height reporter', () => {
    const doc = buildVisualSrcdoc('<p>图</p>', { '--color-background': '#101010' });
    assert.ok(doc.includes(`content="${VISUAL_FRAME_CSP}"`));
    assert.ok(VISUAL_FRAME_CSP.includes("default-src 'none'"));
    assert.ok(VISUAL_FRAME_CSP.includes("script-src 'unsafe-inline'"));
    assert.ok(VISUAL_FRAME_CSP.includes("img-src data: blob:"));
    assert.ok(doc.includes('--color-background:#101010'));
    assert.ok(doc.includes('taibu-visual:height'));
    assert.ok(doc.includes('taibu-visual:theme'));
    assert.ok(doc.includes('<p>图</p>'));
});

test('visual theme values cannot break out of the injected style or script', () => {
    const doc = buildVisualSrcdoc('<p>图</p>', { '--color-foreground': 'red}</style><script>alert(1)</script>' });
    assert.ok(!doc.includes('<script>alert'));
    assert.ok(!doc.includes('</style><script>alert'));
    assert.ok(doc.includes('--color-foreground:red/stylescriptalert(1)/script'));
});

test('visual srcdoc falls back to light theme variables', () => {
    const doc = buildVisualSrcdoc('<p>图</p>');
    assert.ok(doc.includes('--color-background:#ffffff'));
    assert.ok(doc.includes('--color-foreground:#1f1f1f'));
});

test('visual heights are clamped to the frame range', () => {
    assert.equal(clampVisualHeight(300), 300);
    assert.equal(clampVisualHeight(1), VISUAL_FRAME_MIN_HEIGHT);
    assert.equal(clampVisualHeight(99999), VISUAL_FRAME_MAX_HEIGHT);
    assert.equal(clampVisualHeight('300'), null);
    assert.equal(clampVisualHeight(Number.NaN), null);
    assert.equal(clampVisualHeight(undefined), null);
});
